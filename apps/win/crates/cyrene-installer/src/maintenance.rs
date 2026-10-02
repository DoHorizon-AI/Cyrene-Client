//! ┌─────────────────────────────────────────────────────────────────────┐
//! │  📄 maintenance.rs                                                   │
//! │  Module: installer::maintenance                                     │
//! │  Role: Query and fence Product updates through the local broker.    │
//! │                                                                      │
//! │  模块职责：通过本机维护 broker 查询任务状态并建立更新围栏。             │
//! └─────────────────────────────────────────────────────────────────────┘

use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write};
use std::process::Stdio;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const TARGET_KIND: &str = "PACKAGE_ONLY";
const BROKER_CONTAINER: &str = "cyrene-runtime-maintenance";
const BROKER_SOCKET: &str = "/run/cyrene/runtime-maintenance.sock";
const MAX_BROKER_STDOUT_BYTES: usize = 1_048_576;
const MAX_BROKER_STDERR_BYTES: usize = 65_536;
const BROKER_TIMEOUT: Duration = Duration::from_secs(30);
const DEFINITIVE_BEGIN_REFUSAL_PREFIX: &str = "MAINTENANCE_REJECTED:";

/// Complete source set required for Windows Product package updates.
pub const PRODUCT_ACTIVITY_SOURCES: &[&str] = &[
    "cyrene-catalyst",
    "cyrene-echo",
    "cyrene-exchange",
    "cyrene-reactor",
    "cyrene-yield",
];
const WORKSPACE_RUNTIME_COMPONENTS: &[&str] = &[
    "cy-workspace-authority-host",
    "cy-workspace-frontend-bridge",
    "cy-workspace-web-bff",
    "cy-workspace-relay",
    "cy-workspace-connector",
];

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ActiveTask {
    pub source_id: String,
    pub task_id: String,
    pub state: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ReadinessSnapshot {
    pub status: String,
    pub gate_generation: Option<u64>,
    pub install_catalog_generation: Option<u64>,
    pub active_task_count: u64,
    pub active_tasks: Vec<ActiveTask>,
    pub unknown_activity_sources: Vec<String>,
    pub active_worker_count: u64,
    pub active_allocation_count: u64,
    pub inflight_runtime_admission_count: u64,
    pub blocker_codes: Vec<String>,
    pub requires_restart_confirmation: bool,
    #[serde(skip)]
    expected_catalog_generation: Option<u64>,
    #[serde(default)]
    pub maintenance_token: Option<String>,
}

impl ReadinessSnapshot {
    /// Convert broker status to the shared helper result gate shape.
    pub fn contract_gate(&self) -> Value {
        let generation_valid = self.gate_generation.is_some()
            && self.install_catalog_generation.is_some()
            && self.install_catalog_generation == self.expected_catalog_generation;
        let sources_known = self.unknown_activity_sources.is_empty();
        let active_tasks = self.active_task_count > 0
            || !self.active_tasks.is_empty()
            || self.inflight_runtime_admission_count > 0;
        let state = match self.status.as_str() {
            "READY" | "USER_CONFIRMATION_REQUIRED"
                if generation_valid && sources_known && !active_tasks =>
            {
                "idle"
            }
            "ACTIVE_TASKS" => "busy",
            "IDLE_RUNTIME_REQUIRES_UNLOAD" => "idle_runtime_requires_unload",
            "MAINTENANCE_ACTIVE" => "maintenance_active",
            "UNKNOWN" | "STALE_READINESS" => "unknown",
            "READY" | "USER_CONFIRMATION_REQUIRED" => "unknown",
            _ => "unknown",
        };
        let unknown_sources = self.unknown_activity_sources.clone();
        let blockers = self
            .blocker_codes
            .iter()
            .map(|code| {
                json!({
                    "code": code,
                    "message": code,
                })
            })
            .collect::<Vec<_>>();

        json!({
            "state": state,
            "gateGeneration": self.gate_generation,
            "installCatalogGeneration": self.install_catalog_generation,
            "activeTaskCount": self.active_task_count,
            "activeTasks": self.active_tasks.iter().map(|task| json!({
                "sourceId": task.source_id,
                "taskId": task.task_id,
                "state": task.state,
            })).collect::<Vec<_>>(),
            "activeWorkerCount": self.active_worker_count,
            "activeAllocationCount": self.active_allocation_count,
            "inflightRuntimeAdmissionCount": self.inflight_runtime_admission_count,
            "unknownActivitySources": unknown_sources,
            "blockerCodes": self.blocker_codes,
            "requiresRestartConfirmation": self.requires_restart_confirmation,
            "blockers": blockers,
        })
    }

    fn expected_gate_generation(&self) -> Result<u64, String> {
        if self.contract_gate()["state"] != "idle" {
            return Err(format!(
                "维护 broker 状态 `{}` 不允许开始 Product 更新。",
                self.status
            ));
        }
        self.gate_generation
            .ok_or_else(|| "维护 broker 未提供 gate_generation；状态按 UNKNOWN 处理。".to_string())
    }
}

/// Query the authenticated local broker through a fixed Docker argv and private socket.
pub fn get_product_readiness(app_dir: &std::path::Path) -> Result<ReadinessSnapshot, String> {
    get_readiness(app_dir, PRODUCT_ACTIVITY_SOURCES)
}

/// Query the same atomic Product task gate for a Workspace runtime group transaction.
/// Workspace component digests are deliberately separate from the Product activity sources.
pub fn get_workspace_group_readiness(
    app_dir: &std::path::Path,
) -> Result<ReadinessSnapshot, String> {
    let sources = crate::windows_runtime::workspace_group_activity_sources()?;
    let refs = sources.iter().map(String::as_str).collect::<Vec<_>>();
    get_readiness(app_dir, &refs)
}

fn get_readiness(
    app_dir: &std::path::Path,
    expected_activity_sources: &[&str],
) -> Result<ReadinessSnapshot, String> {
    let catalog_generation = read_activity_catalog_generation(app_dir)?;
    let request = json!({
        "request_id": new_request_id("get"),
        "method": "GetUpdateReadiness",
        "params": {
            "target_kind": TARGET_KIND,
            "requires_restart": true,
            "expected_catalog_generation": catalog_generation,
            "expected_activity_sources": expected_activity_sources,
        },
    });
    let mut snapshot = broker_call(request).and_then(parse_readiness)?;
    snapshot.expected_catalog_generation = Some(catalog_generation);
    if snapshot.install_catalog_generation != Some(catalog_generation) {
        return Err(format!(
            "维护 broker catalog generation 不匹配（本机 {catalog_generation}，broker {:?}）；状态按 UNKNOWN 处理。",
            snapshot.install_catalog_generation
        ));
    }
    Ok(snapshot)
}

/// Atomically acquire the package-maintenance fence using the displayed gate generation.
pub fn begin_product_maintenance(
    snapshot: &ReadinessSnapshot,
    request_id: &str,
    plan_id: &str,
    plan_digest: &str,
    component_artifact_digests: &BTreeMap<String, String>,
    confirmed: bool,
) -> Result<String, String> {
    let expected_gate_generation = snapshot.expected_gate_generation()?;
    if !confirmed {
        return Err("Product 更新需要对明确计划进行用户确认。".to_string());
    }
    validate_plan_binding(
        plan_id,
        plan_digest,
        component_artifact_digests,
        PRODUCT_ACTIVITY_SOURCES,
    )?;
    begin_product_maintenance_with_generations(BeginMaintenanceRequest {
        request_id,
        expected_catalog_generation: snapshot.install_catalog_generation.ok_or_else(|| {
            "维护 broker 未提供 install_catalog_generation；状态按 UNKNOWN 处理。".to_string()
        })?,
        expected_gate_generation,
        plan_id,
        plan_digest,
        component_artifact_digests,
        confirmed,
        expected_activity_sources: PRODUCT_ACTIVITY_SOURCES,
        allowed_component_ids: PRODUCT_ACTIVITY_SOURCES,
    })
}

/// Atomically acquire the task-admission fence for the installer-owned Workspace group.
pub fn begin_workspace_group_maintenance(
    snapshot: &ReadinessSnapshot,
    request_id: &str,
    plan_id: &str,
    plan_digest: &str,
    component_artifact_digests: &BTreeMap<String, String>,
    confirmed: bool,
) -> Result<String, String> {
    let expected_gate_generation = snapshot.expected_gate_generation()?;
    if !confirmed {
        return Err("Workspace compatibility group 更新需要对明确计划进行用户确认。".to_string());
    }
    validate_plan_binding(
        plan_id,
        plan_digest,
        component_artifact_digests,
        WORKSPACE_RUNTIME_COMPONENTS,
    )?;
    let source_ids = crate::windows_runtime::workspace_group_activity_sources()?;
    let source_refs = source_ids.iter().map(String::as_str).collect::<Vec<_>>();
    begin_product_maintenance_with_generations(BeginMaintenanceRequest {
        request_id,
        expected_catalog_generation: snapshot.install_catalog_generation.ok_or_else(|| {
            "维护 broker 未提供 install_catalog_generation；状态按 UNKNOWN 处理。".to_string()
        })?,
        expected_gate_generation,
        plan_id,
        plan_digest,
        component_artifact_digests,
        confirmed,
        expected_activity_sources: &source_refs,
        allowed_component_ids: WORKSPACE_RUNTIME_COMPONENTS,
    })
}

/// Retry a journaled Begin using the exact durable request identity and generation snapshot.
pub fn resume_product_maintenance(
    request_id: &str,
    expected_catalog_generation: u64,
    expected_gate_generation: u64,
    plan_id: &str,
    plan_digest: &str,
    component_artifact_digests: &BTreeMap<String, String>,
) -> Result<String, String> {
    validate_plan_binding(
        plan_id,
        plan_digest,
        component_artifact_digests,
        PRODUCT_ACTIVITY_SOURCES,
    )?;
    begin_product_maintenance_with_generations(BeginMaintenanceRequest {
        request_id,
        expected_catalog_generation,
        expected_gate_generation,
        plan_id,
        plan_digest,
        component_artifact_digests,
        confirmed: true,
        expected_activity_sources: PRODUCT_ACTIVITY_SOURCES,
        allowed_component_ids: PRODUCT_ACTIVITY_SOURCES,
    })
}

/// Resume an uncertain group Begin with its exact durable identity and gate generations.
pub fn resume_workspace_group_maintenance(
    request_id: &str,
    expected_catalog_generation: u64,
    expected_gate_generation: u64,
    plan_id: &str,
    plan_digest: &str,
    component_artifact_digests: &BTreeMap<String, String>,
) -> Result<String, String> {
    validate_plan_binding(
        plan_id,
        plan_digest,
        component_artifact_digests,
        WORKSPACE_RUNTIME_COMPONENTS,
    )?;
    let source_ids = crate::windows_runtime::workspace_group_activity_sources()?;
    let source_refs = source_ids.iter().map(String::as_str).collect::<Vec<_>>();
    begin_product_maintenance_with_generations(BeginMaintenanceRequest {
        request_id,
        expected_catalog_generation,
        expected_gate_generation,
        plan_id,
        plan_digest,
        component_artifact_digests,
        confirmed: true,
        expected_activity_sources: &source_refs,
        allowed_component_ids: WORKSPACE_RUNTIME_COMPONENTS,
    })
}

struct BeginMaintenanceRequest<'a> {
    request_id: &'a str,
    expected_catalog_generation: u64,
    expected_gate_generation: u64,
    plan_id: &'a str,
    plan_digest: &'a str,
    component_artifact_digests: &'a BTreeMap<String, String>,
    confirmed: bool,
    expected_activity_sources: &'a [&'a str],
    allowed_component_ids: &'a [&'a str],
}

fn begin_product_maintenance_with_generations(
    request: BeginMaintenanceRequest<'_>,
) -> Result<String, String> {
    let BeginMaintenanceRequest {
        request_id,
        expected_catalog_generation,
        expected_gate_generation,
        plan_id,
        plan_digest,
        component_artifact_digests,
        confirmed,
        expected_activity_sources,
        allowed_component_ids,
    } = request;
    if request_id.is_empty()
        || request_id.len() > 128
        || !request_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-._".contains(&byte))
    {
        return Err("maintenance request_id 格式无效。".to_string());
    }
    if !confirmed {
        return Err("Product 更新需要对明确计划进行用户确认。".to_string());
    }
    validate_plan_binding(
        plan_id,
        plan_digest,
        component_artifact_digests,
        allowed_component_ids,
    )?;
    let request = json!({
        "request_id": request_id,
        "method": "BeginMaintenance",
        "params": {
            "target_kind": TARGET_KIND,
            "requires_restart": true,
            "expected_catalog_generation": expected_catalog_generation,
            "expected_activity_sources": expected_activity_sources,
            "expected_gate_generation": expected_gate_generation,
            "user_confirmed_restart": true,
            "plan_id": plan_id,
            "plan_digest": plan_digest,
            "component_artifact_digests": component_artifact_digests,
        },
    });
    begin_maintenance_token(broker_call(request)?)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct BeginMaintenanceResult {
    status: String,
    maintenance_token: Option<String>,
    gate_generation: u64,
    blocker_codes: Vec<String>,
}

fn begin_maintenance_token(result: Value) -> Result<String, String> {
    if result.get("maintenance_token").is_none() {
        return Err(
            "BeginMaintenance result 缺少 maintenance_token；状态按 UNKNOWN 处理。".to_string(),
        );
    }
    let result: BeginMaintenanceResult = serde_json::from_value(result).map_err(|error| {
        format!("BeginMaintenance result shape 无法识别；状态按 UNKNOWN 处理: {error}")
    })?;
    if let Some(token) = result.maintenance_token.as_deref() {
        if result.status == "MAINTENANCE_ACTIVE" && !token.is_empty() && token.len() <= 512 {
            return Ok(token.to_string());
        }
        return Err(format!(
            "BeginMaintenance status/token 组合无法识别；状态按 UNKNOWN 处理: status={} gate_generation={}",
            result.status, result.gate_generation
        ));
    }

    if is_known_begin_refusal_status(&result.status) {
        let blockers = if result.blocker_codes.is_empty() {
            "no blocker code".to_string()
        } else {
            result.blocker_codes.join(", ")
        };
        return Err(format!(
            "{DEFINITIVE_BEGIN_REFUSAL_PREFIX}{}: maintenance was not acquired at gate generation {}; blockers: {blockers}",
            result.status, result.gate_generation
        ));
    }

    Err(format!(
        "BeginMaintenance result status `{}` without a token is not a recognized refusal; state remains UNKNOWN.",
        result.status
    ))
}

fn is_known_begin_refusal_status(status: &str) -> bool {
    matches!(
        status,
        "ACTIVE_TASKS"
            | "UNKNOWN"
            | "IDLE_RUNTIME_REQUIRES_UNLOAD"
            | "MAINTENANCE_ACTIVE"
            | "STALE_READINESS"
            | "USER_CONFIRMATION_REQUIRED"
    )
}

pub fn is_definitive_begin_refusal(error: &str) -> bool {
    error.starts_with(DEFINITIVE_BEGIN_REFUSAL_PREFIX)
}

fn validate_plan_binding(
    plan_id: &str,
    plan_digest: &str,
    component_artifact_digests: &BTreeMap<String, String>,
    allowed_component_ids: &[&str],
) -> Result<(), String> {
    if plan_id.is_empty()
        || plan_id.len() > 128
        || !plan_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-._".contains(&byte))
    {
        return Err("plan_id 格式无效。".to_string());
    }
    if !is_contract_digest(plan_digest) {
        return Err("plan_digest 必须是 sha256:<64 位小写十六进制>。".to_string());
    }
    if component_artifact_digests.is_empty()
        || component_artifact_digests.len() > allowed_component_ids.len()
    {
        return Err("component_artifact_digests 必须包含本次计划中全部 Product 制品。".to_string());
    }
    for (component_id, digest) in component_artifact_digests {
        if !allowed_component_ids.contains(&component_id.as_str()) {
            return Err(format!(
                "组件 `{component_id}` 不属于本机 Product 更新目录。"
            ));
        }
        if !is_contract_digest(digest) {
            return Err(format!(
                "组件 `{component_id}` 制品 digest 必须是 sha256:<64 位小写十六进制>。"
            ));
        }
    }
    Ok(())
}

pub fn is_contract_digest(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|hex| {
        hex.len() == 64
            && hex
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

/// Release a completed fence only with an explicit health outcome.
///
/// The caller persists `request_id` in its durable update journal before sending this request so
/// it can recover the broker's receipt after a lost response.
pub fn end_product_maintenance(
    token: &str,
    maintenance_request_id: &str,
    end_request_id: &str,
    outcome: &str,
    healthy: bool,
) -> Result<(), String> {
    if token.is_empty() || token.len() > 512 {
        return Err("maintenance_token 格式无效。".to_string());
    }
    for (label, request_id) in [("Begin", maintenance_request_id), ("End", end_request_id)] {
        if request_id.is_empty()
            || request_id.len() > 128
            || !request_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"-._".contains(&byte))
        {
            return Err(format!("EndMaintenance {label} request_id 格式无效。"));
        }
    }
    if !["SUCCESS", "ROLLED_BACK", "FAILED"].contains(&outcome) {
        return Err(format!("未知维护结果 `{outcome}`。"));
    }
    let request = end_maintenance_request(
        token,
        maintenance_request_id,
        end_request_id,
        outcome,
        healthy,
    );
    let result = broker_call(request)?;
    if result.get("unlocked").and_then(Value::as_bool) != Some(true) {
        return Err("维护 broker 未确认围栏已解除。".to_string());
    }
    Ok(())
}

fn end_maintenance_request(
    token: &str,
    maintenance_request_id: &str,
    end_request_id: &str,
    outcome: &str,
    healthy: bool,
) -> Value {
    json!({
        "request_id": end_request_id,
        "method": "EndMaintenance",
        "params": {
            "request_id": maintenance_request_id,
            "maintenance_token": token,
            "outcome": outcome,
            "healthy": healthy,
        },
    })
}

fn parse_readiness(value: Value) -> Result<ReadinessSnapshot, String> {
    let parsed = if value.get("result").is_some() {
        value["result"].clone()
    } else {
        value
    };
    serde_json::from_value(parsed)
        .map_err(|error| format!("维护 broker readiness 响应无效: {error}"))
}

fn read_activity_catalog_generation(app_dir: &std::path::Path) -> Result<u64, String> {
    let path = app_dir
        .join("runtime-maintenance")
        .join("state")
        .join("activity-sources.json");
    let bytes = fs::read(&path).map_err(|error| {
        format!(
            "本机 Product 活动源 catalog 不可读取，状态按 UNKNOWN 处理 ({}): {error}",
            path.display()
        )
    })?;
    if bytes.len() > 262_144 {
        return Err("本机 Product 活动源 catalog 超过大小限制。".to_string());
    }
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("本机 Product 活动源 catalog JSON 无效: {error}"))?;
    if value.get("schema_version").and_then(Value::as_u64) != Some(1) {
        return Err("本机 Product 活动源 catalog schema 不受支持。".to_string());
    }
    let generation = value
        .get("generation")
        .and_then(Value::as_u64)
        .filter(|generation| *generation > 0)
        .ok_or_else(|| "本机 Product 活动源 catalog 缺少有效 generation。".to_string())?;
    let sources = value
        .get("sources")
        .and_then(Value::as_array)
        .ok_or_else(|| "本机 Product 活动源 catalog 缺少 sources。".to_string())?;
    let mut source_ids = sources
        .iter()
        .map(|source| {
            let source_id = source
                .get("source_id")
                .and_then(Value::as_str)
                .ok_or_else(|| "活动源 catalog 中存在缺少 source_id 的项目。".to_string())?;
            let token_digest = source
                .get("source_token_sha256")
                .and_then(Value::as_str)
                .ok_or_else(|| format!("活动源 `{source_id}` 缺少 token digest。"))?;
            if !is_hex_sha256(token_digest) {
                return Err(format!("活动源 `{source_id}` token digest 格式无效。"));
            }
            Ok(source_id.to_string())
        })
        .collect::<Result<Vec<_>, String>>()?;
    source_ids.sort();
    let mut expected_sources = PRODUCT_ACTIVITY_SOURCES
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    expected_sources.sort();
    if source_ids != expected_sources {
        return Err(format!(
            "本机活动源集合与五个已管理 Product 不匹配（实际 {:?}）；状态按 UNKNOWN 处理。",
            source_ids
        ));
    }
    Ok(generation)
}

fn is_hex_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn broker_call(request: Value) -> Result<Value, String> {
    let request_id = request["request_id"]
        .as_str()
        .ok_or_else(|| "维护请求缺少 request_id。".to_string())?
        .to_string();
    let mut child = crate::docker_command()
        .args([
            "exec",
            "-u",
            "0:0",
            "-i",
            BROKER_CONTAINER,
            "cyrene-runtime-maintenance",
            "request",
            "--socket",
            BROKER_SOCKET,
            "--operator",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("无法启动本机维护 broker 请求: {error}"))?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "维护 broker stdout pipe 不可用。".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "维护 broker stderr pipe 不可用。".to_string())?;
    let stdout_reader = thread::spawn(move || read_bounded(&mut stdout, MAX_BROKER_STDOUT_BYTES));
    let stderr_reader = thread::spawn(move || read_bounded(&mut stderr, MAX_BROKER_STDERR_BYTES));
    let input =
        serde_json::to_vec(&request).map_err(|error| format!("无法编码维护请求: {error}"))?;
    if let Some(stdin) = child.stdin.as_mut() {
        if let Err(error) = stdin
            .write_all(&input)
            .and_then(|()| stdin.write_all(b"\n"))
        {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err(format!("无法写入维护 broker 请求: {error}"));
        }
    }
    drop(child.stdin.take());
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < BROKER_TIMEOUT => {
                thread::sleep(Duration::from_millis(50));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err("维护 broker 请求超时；运行状态按 UNKNOWN 处理。".to_string());
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err(format!("无法读取维护 broker 进程状态: {error}"));
            }
        }
    };
    let (stdout_bytes, stdout_overflow) = stdout_reader
        .join()
        .map_err(|_| "读取维护 broker stdout 时线程失败。".to_string())??;
    let (stderr_bytes, _) = stderr_reader
        .join()
        .map_err(|_| "读取维护 broker stderr 时线程失败。".to_string())??;
    if stdout_overflow {
        return Err("维护 broker 响应超过 1 MiB 限制。".to_string());
    }
    if !status.success() {
        return Err(format!(
            "维护 broker 调用失败: {}",
            String::from_utf8_lossy(&stderr_bytes).trim()
        ));
    }
    let stdout = String::from_utf8(stdout_bytes)
        .map_err(|error| format!("维护 broker 响应不是 UTF-8: {error}"))?;
    let mut lines = stdout.lines().filter(|line| !line.trim().is_empty());
    let line = lines
        .next()
        .ok_or_else(|| "维护 broker 没有返回响应。".to_string())?;
    if lines.next().is_some() {
        return Err("维护 broker 返回了多行响应。".to_string());
    }
    let envelope: Value = serde_json::from_str(line)
        .map_err(|error| format!("维护 broker 返回无效 JSON: {error}"))?;
    if envelope.get("request_id").and_then(Value::as_str) != Some(request_id.as_str()) {
        return Err("维护 broker response request_id 不匹配。".to_string());
    }
    if let Some(error) = envelope.get("error") {
        let code = error
            .get("code")
            .and_then(Value::as_str)
            .unwrap_or("BROKER_REJECTED");
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("request rejected");
        return Err(format!("MAINTENANCE_BROKER_ERROR:{code}: {message}"));
    }
    envelope
        .get("result")
        .cloned()
        .ok_or_else(|| "维护 broker 响应缺少 result。".to_string())
}

fn read_bounded(reader: &mut impl Read, limit: usize) -> Result<(Vec<u8>, bool), String> {
    let mut output = Vec::new();
    let mut overflow = false;
    let mut buffer = [0u8; 8192];
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|error| format!("读取维护 broker pipe 失败: {error}"))?;
        if read == 0 {
            break;
        }
        let remaining = limit.saturating_sub(output.len());
        let retain = remaining.min(read);
        output.extend_from_slice(&buffer[..retain]);
        overflow |= retain != read;
    }
    Ok((output, overflow))
}

pub fn new_request_id(prefix: &str) -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{prefix}-{}-{timestamp:x}", std::process::id())
}

#[cfg(test)]
mod tests {
    use super::{
        begin_maintenance_token, end_maintenance_request, is_definitive_begin_refusal,
        validate_plan_binding, ActiveTask, ReadinessSnapshot, PRODUCT_ACTIVITY_SOURCES,
        WORKSPACE_RUNTIME_COMPONENTS,
    };
    use serde_json::json;
    use std::collections::BTreeMap;

    fn snapshot(status: &str, gate_generation: Option<u64>) -> ReadinessSnapshot {
        ReadinessSnapshot {
            status: status.to_string(),
            gate_generation,
            install_catalog_generation: Some(1),
            active_task_count: 0,
            active_tasks: Vec::<ActiveTask>::new(),
            unknown_activity_sources: vec![],
            active_worker_count: 3,
            active_allocation_count: 2,
            inflight_runtime_admission_count: 0,
            blocker_codes: vec![],
            requires_restart_confirmation: true,
            maintenance_token: None,
            expected_catalog_generation: Some(1),
        }
    }

    fn begin_result(status: &str, maintenance_token: Option<&str>) -> serde_json::Value {
        json!({
            "status": status,
            "maintenance_token": maintenance_token,
            "gate_generation": 42,
            "blocker_codes": if status == "STALE_READINESS" {
                vec!["READINESS_GENERATION_STALE"]
            } else if status == "ACTIVE_TASKS" {
                vec!["ACTIVE_TASKS_PRESENT"]
            } else {
                vec!["UPDATE_READINESS_BLOCKED"]
            },
        })
    }

    #[test]
    fn package_updates_allow_idle_workers_but_require_a_generation_and_confirmation() {
        let gate = snapshot("USER_CONFIRMATION_REQUIRED", Some(7));
        assert_eq!(gate.contract_gate()["state"], json!("idle"));
        assert_eq!(gate.contract_gate()["activeWorkerCount"], json!(3));
        assert_eq!(gate.contract_gate()["activeAllocationCount"], json!(2));
        assert!(gate.expected_gate_generation().is_ok());
    }

    #[test]
    fn missing_generation_and_unreachable_sources_fail_closed() {
        let mut gate = snapshot("READY", None);
        assert_eq!(gate.contract_gate()["state"], json!("unknown"));
        assert!(gate.expected_gate_generation().is_err());
        gate.gate_generation = Some(8);
        gate.unknown_activity_sources
            .push("cyrene-yield".to_string());
        assert_eq!(gate.contract_gate()["state"], json!("unknown"));
    }

    #[test]
    fn active_queued_tasks_block_without_cancelling_them() {
        let mut gate = snapshot("ACTIVE_TASKS", Some(9));
        gate.active_task_count = 1;
        gate.active_tasks.push(ActiveTask {
            source_id: "cyrene-yield".into(),
            task_id: "queued-1".into(),
            state: "queued".into(),
        });
        assert_eq!(gate.contract_gate()["state"], json!("busy"));
        assert_eq!(
            gate.contract_gate()["activeTasks"][0]["state"],
            json!("queued")
        );
    }

    #[test]
    fn runtime_admission_blocks_package_updates() {
        let mut gate = snapshot("READY", Some(10));
        gate.inflight_runtime_admission_count = 1;
        assert_eq!(gate.contract_gate()["state"], json!("unknown"));
        assert!(gate.expected_gate_generation().is_err());
    }

    #[test]
    fn known_no_token_begin_results_are_definitive_refusals() {
        for status in [
            "ACTIVE_TASKS",
            "UNKNOWN",
            "IDLE_RUNTIME_REQUIRES_UNLOAD",
            "MAINTENANCE_ACTIVE",
            "STALE_READINESS",
            "USER_CONFIRMATION_REQUIRED",
        ] {
            let error = begin_maintenance_token(begin_result(status, None)).unwrap_err();
            assert!(
                is_definitive_begin_refusal(&error),
                "{status} must be marked as a definitive no-acquire result: {error}"
            );
            assert!(error.contains(status));
        }
    }

    #[test]
    fn active_begin_result_requires_its_token_and_ready_without_token_is_indeterminate() {
        assert_eq!(
            begin_maintenance_token(begin_result("MAINTENANCE_ACTIVE", Some("broker-token")))
                .unwrap(),
            "broker-token"
        );

        let error = begin_maintenance_token(begin_result("READY", None)).unwrap_err();
        assert!(!is_definitive_begin_refusal(&error));
    }

    #[test]
    fn unknown_or_malformed_begin_results_remain_indeterminate() {
        let unknown_status =
            begin_maintenance_token(begin_result("FUTURE_STATUS", None)).unwrap_err();
        assert!(!is_definitive_begin_refusal(&unknown_status));

        let mut missing_token_field = begin_result("STALE_READINESS", None);
        missing_token_field
            .as_object_mut()
            .expect("BeginMaintenance result is an object")
            .remove("maintenance_token");
        let malformed = begin_maintenance_token(missing_token_field).unwrap_err();
        assert!(!is_definitive_begin_refusal(&malformed));
    }

    #[test]
    fn end_maintenance_reuses_journal_request_id_in_broker_params() {
        let begin_request_id = "begin-123-abc";
        let end_request_id = "end-0123456789abcdef0123456789abcdef";
        let request = end_maintenance_request(
            "maintenance-token",
            begin_request_id,
            end_request_id,
            "ROLLED_BACK",
            true,
        );

        assert_eq!(request["method"], json!("EndMaintenance"));
        assert_eq!(request["request_id"], json!(end_request_id));
        assert_eq!(request["params"]["request_id"], json!(begin_request_id));
        assert_ne!(request["request_id"], request["params"]["request_id"]);
    }

    #[test]
    fn workspace_group_digest_map_is_separate_from_product_activity_sources() {
        let plan_digest = format!("sha256:{}", "a".repeat(64));
        let digests = WORKSPACE_RUNTIME_COMPONENTS
            .iter()
            .map(|component| {
                (
                    (*component).to_string(),
                    format!("sha256:{}", "b".repeat(64)),
                )
            })
            .collect::<BTreeMap<_, _>>();
        assert!(validate_plan_binding(
            "plan-0123456789abcdef0123456789abcdef",
            &plan_digest,
            &digests,
            WORKSPACE_RUNTIME_COMPONENTS,
        )
        .is_ok());
        let product_digests = PRODUCT_ACTIVITY_SOURCES
            .iter()
            .map(|component| {
                (
                    (*component).to_string(),
                    format!("sha256:{}", "c".repeat(64)),
                )
            })
            .collect::<BTreeMap<_, _>>();
        assert!(validate_plan_binding(
            "plan-0123456789abcdef0123456789abcdef",
            &plan_digest,
            &product_digests,
            WORKSPACE_RUNTIME_COMPONENTS,
        )
        .is_err());
    }
}
