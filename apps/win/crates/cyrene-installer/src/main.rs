//! ┌─────────────────────────────────────────────────────────────────────┐
//! │  📄 main.rs                                                          │
//! │  Module: installer                                                   │
//! │  Role: Cyrene Modular Installer, Orchestrator & Clean Uninstaller   │
//! │  模块职责：Cyrene 统一模块化安装器、服务编排器与干净卸载工具。     │
//! └─────────────────────────────────────────────────────────────────────┘

use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::Read;
use std::io::{self, IsTerminal, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use fs2::FileExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

mod component_catalog;
mod github_updates;
mod maintenance;
mod release_update;

/// Resolve Docker to its fixed Windows installation path for elevated updater operations.
pub(crate) fn docker_command() -> Command {
    #[cfg(windows)]
    {
        Command::new(r"C:\Program Files\Docker\Docker\resources\bin\docker.exe")
    }
    #[cfg(not(windows))]
    {
        Command::new("docker")
    }
}

/// 编译期注入的默认 Exchange URL，若构建时未设置则回退至本地网关
const COMPILE_TIME_EXCHANGE_URL: Option<&str> = option_env!("CYRENE_DEFAULT_EXCHANGE_URL");
const FALLBACK_EXCHANGE_URL: &str = "http://127.0.0.1:8000";

fn get_default_exchange_url() -> String {
    env::var("CYRENE_EXCHANGE_URL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            COMPILE_TIME_EXCHANGE_URL
                .filter(|s| !s.trim().is_empty())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| FALLBACK_EXCHANGE_URL.to_string())
}

#[derive(Clone, Copy)]
enum ToolKind {
    LocalAgent,
    ContainerService,
}

struct ToolSpec {
    id: &'static str,
    title: &'static str,
    kind: ToolKind,
    image: Option<&'static str>,
    image_repository: Option<&'static str>,
    port: Option<u16>,
    desc: &'static str,
}

const TOOLS: &[ToolSpec] = &[
    ToolSpec {
        id: "navigator",
        title: "Cyrene Navigator (桌面 Agent & DeepSeek Harness 运行时)",
        kind: ToolKind::LocalAgent,
        image: None,
        image_repository: None,
        port: None,
        desc: "本地增强智能体环境、Native Host 进程调度与 Exchange 路由连接器",
    },
    ToolSpec {
        id: "exchange",
        title: "Cyrene Exchange (API 网关 & 路由分发中心)",
        kind: ToolKind::ContainerService,
        image: Some("ghcr.io/dohorizon-ai/cyrene-exchange:latest"),
        image_repository: Some("ghcr.io/dohorizon-ai/cyrene-exchange"),
        port: Some(8000),
        desc: "OpenAI 兼容端点、统一凭据认证与模型提供商连接器",
    },
    ToolSpec {
        id: "reactor",
        title: "Cyrene Reactor (模型推理与部署控制面)",
        kind: ToolKind::ContainerService,
        image: Some("ghcr.io/dohorizon-ai/cyrene-reactor-aca:latest"),
        image_repository: Some("ghcr.io/dohorizon-ai/cyrene-reactor-aca"),
        port: Some(19300),
        desc: "推理端点协调、模型放置策略与计算引擎连接",
    },
    ToolSpec {
        id: "yield",
        title: "Cyrene Yield (统一模型训练与微调服务)",
        kind: ToolKind::ContainerService,
        image: Some("ghcr.io/dohorizon-ai/cyrene-yield-aca:latest"),
        image_repository: Some("ghcr.io/dohorizon-ai/cyrene-yield-aca"),
        port: Some(8092),
        desc: "训练生命周期管理、检查点持久化与插件训练编排",
    },
    ToolSpec {
        id: "catalyst",
        title: "Cyrene Catalyst (数据集准备与血缘服务)",
        kind: ToolKind::ContainerService,
        image: Some("ghcr.io/dohorizon-ai/cyrene-catalyst:latest"),
        image_repository: Some("ghcr.io/dohorizon-ai/cyrene-catalyst"),
        port: Some(8014),
        desc: "数据集导入、指令映射、划分与训练格式发布",
    },
    ToolSpec {
        id: "echo",
        title: "Cyrene Echo (模型评测与质量门禁服务)",
        kind: ToolKind::ContainerService,
        image: Some("ghcr.io/dohorizon-ai/cyrene-echo:latest"),
        image_repository: Some("ghcr.io/dohorizon-ai/cyrene-echo"),
        port: Some(8094),
        desc: "评测套件执行、样本比对与 LLM Judge 质量判定",
    },
];

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.iter().any(|arg| arg == "--updates-stdio") {
        run_updates_stdio(&args, &get_cyrene_home());
        return;
    }

    println!("============================================================");
    println!("  Cyrene Installer - Modular Deployment & Clean Uninstaller  ");
    println!("  Cyrene 统一模块化安装器、服务编排与完全干净卸载工具       ");
    println!("============================================================\n");

    if args.contains(&"--help".to_string()) || args.contains(&"-h".to_string()) {
        print_usage(&args[0]);
        return;
    }

    let app_dir = get_cyrene_home();

    if let Some(option_index) = args.iter().position(|arg| arg == "--update-service") {
        let Some(service_id) = args
            .get(option_index + 1)
            .filter(|value| !value.starts_with('-'))
        else {
            eprintln!("--update-service 缺少服务名称。请运行 --help 查看用法。\n");
            std::process::exit(2);
        };

        if service_id.eq_ignore_ascii_case("navigator") {
            if let Err(error) = update_service_from_manifest(&app_dir, service_id, Path::new("")) {
                eprintln!("\n❌ {error}");
                std::process::exit(1);
            }
        }
        let manifest_path = option_value(&args, "--manifest");
        let Some(manifest_path) = manifest_path else {
            eprintln!("更新服务需要同时提供 --update-service <NAME> 和 --manifest <PATH>。请运行 --help 查看用法。\n");
            std::process::exit(2);
        };

        if let Err(error) =
            update_service_from_manifest(&app_dir, service_id, Path::new(&manifest_path))
        {
            eprintln!("\n❌ 服务更新失败: {error}");
            std::process::exit(1);
        }
        return;
    }

    if args
        .iter()
        .any(|arg| arg == "--initialize-runtime-maintenance")
    {
        if args.len() != 2 {
            eprintln!("--initialize-runtime-maintenance 不接受其他参数。\n");
            std::process::exit(2);
        }
        if let Err(error) = initialize_runtime_maintenance_from_compose(&app_dir) {
            eprintln!("\n❌ 维护 broker 初始化失败: {error}");
            std::process::exit(1);
        }
        return;
    }

    if args.contains(&"--manifest".to_string()) {
        eprintln!("--manifest 只能与 --update-service 一起使用。请运行 --help 查看用法。\n");
        std::process::exit(2);
    }

    // Check for uninstall commands
    if args.contains(&"--uninstall".to_string()) || args.contains(&"--clean-uninstall".to_string())
    {
        let silent = args.contains(&"--silent".to_string());
        let force = args.contains(&"--force".to_string()) || silent;
        perform_clean_uninstall(&app_dir, force);
        return;
    }

    let update_lock = match acquire_service_update_lock(&app_dir) {
        Ok(lock) => lock,
        Err(error) => {
            eprintln!("\n❌ 无法取得服务更新锁: {error}");
            std::process::exit(1);
        }
    };
    if let Err(error) = recover_interrupted_update(&app_dir) {
        eprintln!("\n❌ 无法恢复上次未完成的服务更新: {error}");
        std::process::exit(1);
    }
    drop(update_lock);

    if args.contains(&"--silent".to_string()) {
        run_silent(&args, &app_dir);
    } else {
        run_interactive(&app_dir);
    }
}

const UPDATE_PROTOCOL_VERSION: &str = "cyrene.component-updates.helper.v1";
const WINDOWS_TARGET_ID: &str = "windows-10.0-x86_64-docker-linux";

fn run_updates_stdio(args: &[String], app_dir: &Path) {
    let mut input = Vec::new();
    let mut stdin = io::stdin().take(1_048_577);
    let read_result = stdin.read_to_end(&mut input);
    let mut operation = "status".to_string();
    let outcome = match read_result {
        Err(error) => Err((
            "UPDATE_HELPER_INPUT",
            format!("读取更新请求失败: {error}"),
            true,
        )),
        Ok(_) if input.len() > 1_048_576 => Err((
            "UPDATE_HELPER_INPUT",
            "更新请求超过 1 MiB 限制。".to_string(),
            false,
        )),
        Ok(_) => match serde_json::from_slice::<serde_json::Value>(&input) {
            Err(error) => Err((
                "UPDATE_HELPER_JSON",
                format!("更新请求 JSON 无效: {error}"),
                false,
            )),
            Ok(request) => {
                if let Some(name) = request.get("operation").and_then(serde_json::Value::as_str) {
                    operation = name.to_string();
                }
                dispatch_update_request(args, app_dir, &request)
            }
        },
    };
    let envelope = match outcome {
        Ok(result) => serde_json::json!({
            "protocolVersion": UPDATE_PROTOCOL_VERSION,
            "ok": true,
            "operation": operation,
            "result": result,
        }),
        Err((code, message, retryable)) => serde_json::json!({
            "protocolVersion": UPDATE_PROTOCOL_VERSION,
            "ok": false,
            "operation": operation,
            "error": { "code": code, "message": message, "retryable": retryable },
        }),
    };
    // This process is a JSON stdio helper; diagnostics must never pollute stdout.
    match serde_json::to_string(&envelope) {
        Ok(line) => println!("{line}"),
        Err(error) => eprintln!("failed to encode update helper response: {error}"),
    }
}

fn dispatch_update_request(
    args: &[String],
    app_dir: &Path,
    request: &serde_json::Value,
) -> Result<serde_json::Value, (&'static str, String, bool)> {
    let operation = request
        .get("operation")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| {
            (
                "UPDATE_HELPER_PROTOCOL",
                "更新请求缺少 operation。".to_string(),
                false,
            )
        })?;
    if args.len() != 2 {
        return Err((
            "UPDATE_HELPER_PROTOCOL",
            "--updates-stdio 不接受其他 CLI 参数。".to_string(),
            false,
        ));
    }
    if request
        .get("protocolVersion")
        .and_then(serde_json::Value::as_str)
        != Some(UPDATE_PROTOCOL_VERSION)
    {
        return Err((
            "UPDATE_HELPER_PROTOCOL",
            "更新协议版本不受支持。".to_string(),
            false,
        ));
    }

    match operation {
        "status" => {
            if !has_only_keys(request, &["protocolVersion", "operation"]) {
                return Err((
                    "UPDATE_HELPER_PROTOCOL",
                    "status 请求含有不支持的字段。".to_string(),
                    false,
                ));
            }
            Ok(windows_update_status(app_dir))
        }
        "check" => {
            if !has_only_keys(
                request,
                &["protocolVersion", "operation", "componentIds", "channel"],
            ) {
                return Err((
                    "UPDATE_HELPER_PROTOCOL",
                    "check 请求含有不支持的字段。".to_string(),
                    false,
                ));
            }
            let catalog = component_catalog::trusted_catalog().map_err(|error| {
                (
                    "UPDATE_CATALOG_INVALID",
                    format!("无法载入受信 Workspace component catalog: {error}"),
                    false,
                )
            })?;
            let requested = request.get("componentIds");
            if let Some(component_ids) = requested {
                let Some(component_ids) = component_ids.as_array() else {
                    return Err((
                        "UPDATE_HELPER_PROTOCOL",
                        "componentIds 必须是数组。".to_string(),
                        false,
                    ));
                };
                if component_ids.is_empty() || component_ids.len() > 5 {
                    return Err((
                        "UPDATE_HELPER_PROTOCOL",
                        "componentIds 数量超出限制。".to_string(),
                        false,
                    ));
                }
                for component_id in component_ids {
                    let Some(component_id) = component_id.as_str() else {
                        return Err((
                            "UPDATE_HELPER_PROTOCOL",
                            "componentId 必须是字符串。".to_string(),
                            false,
                        ));
                    };
                    if !component_catalog::WINDOWS_PRODUCT_COMPONENT_IDS.contains(&component_id) {
                        return Err((
                            "UPDATE_COMPONENT_UNSUPPORTED",
                            format!("组件 `{component_id}` 不在 Windows Product 更新清单中。"),
                            false,
                        ));
                    }
                }
            }
            let channel = request
                .get("channel")
                .map(|value| value.as_str().unwrap_or_default())
                .unwrap_or("stable");
            if !matches!(channel, "stable" | "preview") {
                return Err((
                    "UPDATE_HELPER_PROTOCOL",
                    "channel 只接受 stable 或 preview。".to_string(),
                    false,
                ));
            }
            let _lock = acquire_service_update_lock(app_dir)
                .map_err(|error| ("UPDATE_LOCKED", error, true))?;
            recover_interrupted_update(app_dir)
                .map_err(|error| ("UPDATE_RECOVERY_REQUIRED", error, false))?;
            check_product_updates(app_dir, &catalog, channel, requested)
                .map_err(|error| ("UPDATE_CHECK_FAILED", error, true))
        }
        "stage" => {
            if !has_only_keys(
                request,
                &[
                    "protocolVersion",
                    "operation",
                    "planId",
                    "planDigest",
                    "channel",
                ],
            ) || request
                .get("planId")
                .and_then(serde_json::Value::as_str)
                .is_none()
                || request
                    .get("planDigest")
                    .and_then(serde_json::Value::as_str)
                    .is_none()
            {
                return Err((
                    "UPDATE_HELPER_PROTOCOL",
                    "stage 请求格式无效。".to_string(),
                    false,
                ));
            }
            let plan_id = request["planId"].as_str().unwrap_or_default();
            let plan_digest = request["planDigest"].as_str().unwrap_or_default();
            let channel = match request.get("channel") {
                None => None,
                Some(value) => match value.as_str() {
                    Some(channel @ ("stable" | "preview")) => Some(channel),
                    _ => {
                        return Err((
                            "UPDATE_HELPER_PROTOCOL",
                            "channel 只接受 stable 或 preview。".to_string(),
                            false,
                        ))
                    }
                },
            };
            let _lock = acquire_service_update_lock(app_dir)
                .map_err(|error| ("UPDATE_LOCKED", error, true))?;
            recover_interrupted_update(app_dir)
                .map_err(|error| ("UPDATE_RECOVERY_REQUIRED", error, false))?;
            let catalog = component_catalog::trusted_catalog()
                .map_err(|error| ("UPDATE_CATALOG_INVALID", error, false))?;
            stage_update_plan(app_dir, &catalog, plan_id, plan_digest, channel)
                .map_err(|error| ("UPDATE_STAGE_FAILED", error, true))
        }
        "apply" => {
            if !has_only_keys(
                request,
                &[
                    "protocolVersion",
                    "operation",
                    "planId",
                    "planDigest",
                    "channel",
                    "confirmation",
                ],
            ) || request
                .get("planId")
                .and_then(serde_json::Value::as_str)
                .is_none()
                || request
                    .get("planDigest")
                    .and_then(serde_json::Value::as_str)
                    .is_none()
            {
                return Err((
                    "UPDATE_HELPER_PROTOCOL",
                    "apply 请求格式无效。".to_string(),
                    false,
                ));
            }
            if !has_update_operator_authority() {
                return Err(("UPDATE_OPERATOR_REQUIRED", "应用更新需要本机 Windows Administrator 身份；远程 Workspace 成员不能获得本机更新权限。".to_string(), false));
            }
            let plan_id = request
                .get("planId")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default();
            let plan_digest = request
                .get("planDigest")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default();
            let confirmation = request
                .get("confirmation")
                .and_then(serde_json::Value::as_object);
            if !confirmation.is_some_and(|value| {
                value.len() == 3
                    && value.get("planId").and_then(serde_json::Value::as_str) == Some(plan_id)
                    && value.get("planDigest").and_then(serde_json::Value::as_str)
                        == Some(plan_digest)
                    && value.get("confirmed").and_then(serde_json::Value::as_bool) == Some(true)
            }) {
                return Err((
                    "UPDATE_CONFIRMATION_REQUIRED",
                    "apply 必须携带与计划 ID 和 digest 完全相同的用户确认。".to_string(),
                    false,
                ));
            }
            let channel = match request.get("channel") {
                None => None,
                Some(value) => match value.as_str() {
                    Some(channel @ ("stable" | "preview")) => Some(channel),
                    _ => {
                        return Err((
                            "UPDATE_HELPER_PROTOCOL",
                            "channel 只接受 stable 或 preview。".to_string(),
                            false,
                        ))
                    }
                },
            };
            let _lock = acquire_service_update_lock(app_dir)
                .map_err(|error| ("UPDATE_LOCKED", error, true))?;
            recover_interrupted_update(app_dir)
                .map_err(|error| ("UPDATE_RECOVERY_REQUIRED", error, false))?;
            let catalog = component_catalog::trusted_catalog()
                .map_err(|error| ("UPDATE_CATALOG_INVALID", error, false))?;
            apply_update_plan(app_dir, &catalog, plan_id, plan_digest, channel)
                .map_err(|error| ("UPDATE_APPLY_FAILED", error, false))
        }
        _ => Err((
            "UPDATE_HELPER_PROTOCOL",
            format!("未知更新操作 `{operation}`。"),
            false,
        )),
    }
}

fn has_only_keys(value: &serde_json::Value, allowed: &[&str]) -> bool {
    value
        .as_object()
        .is_some_and(|object| object.keys().all(|key| allowed.contains(&key.as_str())))
}

fn windows_update_status(app_dir: &Path) -> serde_json::Value {
    let catalog = match component_catalog::trusted_catalog() {
        Ok(catalog) => catalog,
        Err(error) => {
            eprintln!("trusted component catalog is unavailable: {error}");
            return serde_json::json!({"status": "unconfigured", "components": [], "plans": []});
        }
    };
    let check_report = read_check_report(app_dir).ok();
    let report_by_id = check_report
        .as_ref()
        .map(|report| {
            report
                .components
                .iter()
                .map(|component| (component.component_id.as_str(), component))
                .collect::<BTreeMap<_, _>>()
        })
        .unwrap_or_default();
    let plans = read_stored_plans(app_dir)
        .unwrap_or_default()
        .into_iter()
        .filter(|plan| validate_stored_plan_metadata(&catalog, plan).is_ok())
        .collect::<Vec<_>>();
    let readiness = maintenance::get_product_readiness(app_dir);
    let gate = match &readiness {
        Ok(snapshot) => snapshot.contract_gate(),
        Err(error) => serde_json::json!({
            "state": "unknown",
            "gateGeneration": null,
            "installCatalogGeneration": null,
            "activeTaskCount": 0,
            "activeTasks": [],
            "inflightRuntimeAdmissionCount": 0,
            "unknownActivitySources": maintenance::PRODUCT_ACTIVITY_SOURCES,
            "blockerCodes": ["MAINTENANCE_AUTHORITY_UNAVAILABLE"],
            "blockers": [{"code": "MAINTENANCE_AUTHORITY_UNAVAILABLE", "message": error}],
            "requiresRestartConfirmation": true
        }),
    };
    let is_idle = gate["state"].as_str() == Some("idle");
    let operator_authorized = has_update_operator_authority();
    let mut components = Vec::new();
    let catalog_components = catalog["components"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let windows_target = catalog["targets"]
        .as_array()
        .and_then(|targets| targets.iter().find(|target| target["id"].as_str() == Some(WINDOWS_TARGET_ID)))
        .and_then(|target| target.get("target"))
        .cloned()
        .unwrap_or_else(|| serde_json::json!({"os": "windows", "osVersion": "10.0", "architecture": "x86_64", "runtime": "docker-desktop:linux"}));

    for catalog_component in catalog_components {
        let Some(component_id) = catalog_component["componentId"].as_str() else {
            continue;
        };
        if catalog_component["role"].as_str() == Some("build-dependency") {
            continue;
        }
        let target_entry = catalog_component["targets"].as_array().and_then(|targets| {
            targets
                .iter()
                .find(|target| target["targetId"].as_str() == Some(WINDOWS_TARGET_ID))
        });
        let catalog_supported =
            target_entry.is_some_and(|target| target["support"].as_str() == Some("supported"));
        let artifact_kind = target_entry
            .and_then(|target| target["artifactKind"].as_str())
            .or_else(|| {
                catalog_component["artifactKinds"]
                    .as_array()?
                    .first()?
                    .as_str()
            });
        let managed = component_catalog::WINDOWS_PRODUCT_COMPONENT_IDS.contains(&component_id)
            || component_id == component_catalog::WINDOWS_MAINTENANCE_COMPONENT_ID;
        let supported = managed && catalog_supported && artifact_kind == Some("oci-image");
        let (installed, active_version) =
            if component_catalog::WINDOWS_PRODUCT_COMPONENT_IDS.contains(&component_id) {
                let tool = TOOLS
                    .iter()
                    .find(|tool| format!("cyrene-{}", tool.id) == component_id);
                match tool {
                    Some(tool) => (
                        is_product_installed(app_dir, tool.id),
                        installed_product_version(app_dir, tool),
                    ),
                    None => (false, None),
                }
            } else if component_id == component_catalog::WINDOWS_MAINTENANCE_COMPONENT_ID {
                (
                    docker_container_present(component_id),
                    docker_component_version(component_id),
                )
            } else {
                (false, None)
            };
        let matching_plan = plans.iter().find(|plan| {
            plan.components
                .iter()
                .any(|component| component.component_id == component_id)
                && matches!(plan.phase.as_str(), "checked" | "staged" | "applying")
        });
        let plan_component = matching_plan.and_then(|plan| {
            plan.components
                .iter()
                .find(|component| component.component_id == component_id)
        });
        let report = report_by_id.get(component_id).copied();
        let mut blockers = Vec::new();
        let phase;
        let mut update_available = false;
        let mut available_version = report.and_then(|item| item.available_version.clone());
        let mut staged_version = None;
        if !supported {
            phase = "unsupported";
            let message = if catalog_supported {
                "此 Windows 组件不属于当前 Installer 管理范围。"
            } else {
                "此原生目标当前没有受支持的 Windows 实现。"
            };
            blockers.push(
                serde_json::json!({"code": "UNSUPPORTED_WINDOWS_TARGET", "message": message}),
            );
        } else if let Some(component) = plan_component {
            update_available = true;
            available_version = Some(component.version.clone());
            if matching_plan.is_some_and(|plan| plan.phase == "staged") {
                phase = "staged";
                staged_version = Some(component.version.clone());
            } else if matching_plan.is_some_and(|plan| plan.phase == "applying") {
                phase = "applying";
            } else {
                phase = "checked";
            }
        } else if let Some(report) = report {
            phase = report.phase.as_str();
            blockers.extend(report.blockers.iter().cloned());
            update_available = report.update_available;
        } else if !installed {
            phase = "unknown";
            blockers.push(serde_json::json!({"code": "COMPONENT_NOT_INSTALLED", "message": "目标组件尚未安装在本机。"}));
        } else {
            phase = "current";
        }
        if !installed && supported {
            blockers.push(serde_json::json!({"code": "COMPONENT_NOT_INSTALLED", "message": "目标组件尚未安装在本机。"}));
        }
        let mut allowed_actions = Vec::new();
        if supported {
            allowed_actions.push("check");
            if matching_plan.is_some_and(|plan| plan.phase == "checked") && installed {
                allowed_actions.push("stage");
            }
            if matching_plan.is_some_and(|plan| plan.phase == "staged")
                && installed
                && is_idle
                && operator_authorized
            {
                allowed_actions.push("apply");
            }
            if component_id == component_catalog::WINDOWS_MAINTENANCE_COMPONENT_ID {
                blockers.push(serde_json::json!({"code": "BROKER_UPDATE_REQUIRES_COORDINATED_RESTART", "message": "维护 broker 更新需要独立的协调恢复流程。"}));
                allowed_actions.retain(|action| *action != "apply");
            }
        }
        if supported
            && !operator_authorized
            && matching_plan.is_some_and(|plan| plan.phase == "staged")
        {
            blockers.push(serde_json::json!({"code": "UPDATE_OPERATOR_REQUIRED", "message": "应用更新需要本机 Windows Administrator 身份。"}));
        }
        components.push(serde_json::json!({
            "componentId": component_id,
            "installed": installed,
            "supported": supported,
            "activeVersion": active_version,
            "availableVersion": available_version,
            "stagedVersion": staged_version,
            "phase": phase,
            "target": windows_target,
            "artifactKind": artifact_kind,
            "updateAvailable": update_available,
            "gate": gate,
            "blockers": blockers,
            "allowedActions": allowed_actions
        }));
    }

    let plans = plans.iter().map(stored_plan_contract).collect::<Vec<_>>();
    serde_json::json!({
        "status": if readiness.is_ok() { "ready" } else { "unknown" },
        "components": components,
        "plans": plans
    })
}

fn check_product_updates(
    app_dir: &Path,
    catalog: &serde_json::Value,
    channel: &str,
    requested: Option<&serde_json::Value>,
) -> Result<serde_json::Value, String> {
    if !matches!(channel, "stable" | "preview") {
        return Err(format!("不支持 release channel `{channel}`。"));
    }
    let component_ids = match requested.and_then(serde_json::Value::as_array) {
        Some(values) => values
            .iter()
            .filter_map(serde_json::Value::as_str)
            .map(str::to_string)
            .collect::<Vec<_>>(),
        None => component_catalog::WINDOWS_PRODUCT_COMPONENT_IDS
            .iter()
            .map(|id| id.to_string())
            .collect(),
    };
    remove_checked_plans_for_components(app_dir, &component_ids)?;
    let mut reports = Vec::new();
    for component_id in component_ids {
        let tool_id = component_id.strip_prefix("cyrene-").unwrap_or_default();
        if !is_product_installed(app_dir, tool_id) {
            reports.push(ComponentCheckReport {
                component_id,
                phase: "unknown".to_string(),
                available_version: None,
                update_available: false,
                blockers: vec![serde_json::json!({"code": "COMPONENT_NOT_INSTALLED", "message": "目标组件尚未安装在本机。"})],
            });
            continue;
        }
        match github_updates::discover_windows_candidate(app_dir, catalog, &component_id, channel) {
            Ok(Some(candidate)) => {
                let active_digest = docker_component_digest(&component_id);
                let update_available = active_digest.as_deref() != Some(candidate.verified.artifact_digest.as_str());
                if update_available {
                    if let Err(error) = ensure_runtime_broker_version_satisfies_manifest(
                        app_dir,
                        &candidate.verified.manifest,
                    ) {
                        reports.push(ComponentCheckReport {
                            component_id,
                            phase: "available".to_string(),
                            available_version: Some(candidate.verified.version),
                            update_available: true,
                            blockers: vec![serde_json::json!({
                                "code": "RUNTIME_DEPENDENCY_UNSATISFIED",
                                "message": error,
                            })],
                        });
                        continue;
                    }
                }
                if update_available {
                    let component_digest = release_update::PlanComponentDigest {
                        component_id: candidate.verified.component_id.clone(),
                        version: candidate.verified.version.clone(),
                        manifest_digest: candidate.verified.manifest_digest.clone(),
                        artifact_digest: candidate.verified.artifact_digest.clone(),
                        restart_group: candidate.verified.restart_group.clone(),
                    };
                    let (plan_id, plan_digest) = release_update::plan_id_and_digest(channel, &[component_digest])?;
                    let stored = StoredPlan {
                        schema_version: 1,
                        plan_id,
                        plan_digest,
                        channel: channel.to_string(),
                        phase: "checked".to_string(),
                        components: vec![StoredPlanComponent {
                            component_id: candidate.verified.component_id.clone(),
                            version: candidate.verified.version.clone(),
                            manifest_digest: candidate.verified.manifest_digest.clone(),
                            artifact_digest: candidate.verified.artifact_digest.clone(),
                            restart_group: candidate.verified.restart_group.clone(),
                            index_json: candidate.index_json,
                            manifest_json: candidate.manifest_json,
                        }],
                    };
                    save_stored_plan(app_dir, &stored)?;
                }
                reports.push(ComponentCheckReport {
                    component_id,
                    phase: if update_available { "checked" } else { "current" }.to_string(),
                    available_version: Some(candidate.verified.version),
                    update_available,
                    blockers: Vec::new(),
                });
            }
            Ok(None) => reports.push(ComponentCheckReport {
                component_id,
                phase: "unknown".to_string(),
                available_version: None,
                update_available: false,
                blockers: vec![serde_json::json!({"code": "RELEASE_INDEX_MISSING", "message": "发布仓库尚无适用于此 channel 的可信 release index。"})],
            }),
            Err(error) => reports.push(ComponentCheckReport {
                component_id,
                phase: "unknown".to_string(),
                available_version: None,
                update_available: false,
                blockers: vec![serde_json::json!({"code": "RELEASE_VERIFICATION_FAILED", "message": error})],
            }),
        }
    }
    let report = UpdateCheckReport {
        schema_version: 1,
        channel: channel.to_string(),
        components: reports,
    };
    write_json_atomically(&check_report_path(app_dir), &report)?;
    Ok(windows_update_status(app_dir))
}

fn stage_update_plan(
    app_dir: &Path,
    catalog: &serde_json::Value,
    plan_id: &str,
    plan_digest: &str,
    channel: Option<&str>,
) -> Result<serde_json::Value, String> {
    let mut plan = load_stored_plan(app_dir, plan_id)?;
    validate_stored_plan_metadata(catalog, &plan)?;
    if plan.plan_digest != plan_digest || channel.is_some_and(|channel| channel != plan.channel) {
        return Err("stage 请求与本机持久计划 digest/channel 不匹配。".to_string());
    }
    if plan.phase == "staged" {
        return Ok(windows_update_status(app_dir));
    }
    if plan.phase != "checked" {
        return Err(format!(
            "计划 `{plan_id}` 当前阶段 `{}` 不能暂存。",
            plan.phase
        ));
    }
    for component in &plan.components {
        let verified = github_updates::verify_candidate_bytes(
            catalog,
            &component.index_json,
            &component.manifest_json,
            &component.component_id,
            &plan.channel,
        )?;
        if verified.manifest_digest != component.manifest_digest
            || verified.artifact_digest != component.artifact_digest
        {
            return Err(format!(
                "计划 `{plan_id}` 的组件 `{}` 制品摘要不匹配。",
                component.component_id
            ));
        }
        run_docker_status(
            &["pull".to_string(), verified.image_reference.clone()],
            "下载并暂存 Product 镜像",
        )?;
        verify_product_image_dependencies(
            app_dir,
            catalog,
            &verified.manifest,
            &verified.image_reference,
            &plan.channel,
        )?;
    }
    plan.phase = "staged".to_string();
    save_stored_plan(app_dir, &plan)?;
    Ok(windows_update_status(app_dir))
}

fn apply_update_plan(
    app_dir: &Path,
    catalog: &serde_json::Value,
    plan_id: &str,
    plan_digest: &str,
    channel: Option<&str>,
) -> Result<serde_json::Value, String> {
    ensure_update_operator()?;
    let mut plan = load_stored_plan(app_dir, plan_id)?;
    validate_stored_plan_metadata(catalog, &plan)?;
    if plan.plan_digest != plan_digest || channel.is_some_and(|channel| channel != plan.channel) {
        return Err("apply 请求与本机持久计划 digest/channel 不匹配。".to_string());
    }
    if plan.phase != "staged" || plan.components.len() != 1 {
        return Err("apply 只接受一个已经暂存的 Windows Product 组件计划。".to_string());
    }
    let component = plan.components[0].clone();
    if !component_catalog::WINDOWS_PRODUCT_COMPONENT_IDS.contains(&component.component_id.as_str())
    {
        return Err("此组件不在 Windows Product restart allowlist 中。".to_string());
    }
    let verified = github_updates::verify_candidate_bytes(
        catalog,
        &component.index_json,
        &component.manifest_json,
        &component.component_id,
        &plan.channel,
    )?;
    if verified.manifest_digest != component.manifest_digest
        || verified.artifact_digest != component.artifact_digest
    {
        return Err("staged manifest/artifact digest 在 apply 前发生变化。".to_string());
    }
    let image = docker_inspect(&[
        "image".to_string(),
        "inspect".to_string(),
        verified.image_reference.clone(),
    ])
    .map_err(|error| format!("staged OCI digest 不在本机 Docker image store: {error}"))?;
    if !image["RepoDigests"].as_array().is_some_and(|digests| {
        digests
            .iter()
            .any(|value| value.as_str() == Some(verified.image_reference.as_str()))
    }) {
        return Err(
            "本机 Docker image store 没有与计划完全匹配的 RepoDigest；请重新暂存。".to_string(),
        );
    }
    let component_digests = BTreeMap::from([(
        component.component_id.clone(),
        component.artifact_digest.clone(),
    )]);
    let binding = LocalPlanBinding {
        plan_id: plan.plan_id.clone(),
        plan_digest: plan.plan_digest.clone(),
        manifest_digest: component.manifest_digest.clone(),
        component_artifact_digests: component_digests,
    };
    plan.phase = "applying".to_string();
    save_stored_plan(app_dir, &plan)?;
    let tool_id = component
        .component_id
        .strip_prefix("cyrene-")
        .unwrap_or_default();
    let tool = TOOLS
        .iter()
        .find(|tool| tool.id == tool_id)
        .ok_or_else(|| "计划包含未知 Product 服务。".to_string())?;
    match apply_product_image(
        app_dir,
        tool,
        &binding,
        &verified.image_reference,
        &component.version,
        &plan.channel,
    ) {
        Ok(()) => plan.phase = "succeeded".to_string(),
        Err(error) => {
            if maintenance::is_definitive_begin_refusal(&error) {
                finish_definitive_begin_refusal(app_dir, &update_journal_path(app_dir), &error)
                    .map_err(|cleanup_error| format!("{error}; {cleanup_error}"))?;
                plan.phase = "staged".to_string();
                return Err(error);
            }
            plan.phase = if error.contains("已恢复目标服务") {
                "rolled_back"
            } else {
                "failed"
            }
            .to_string();
            save_stored_plan(app_dir, &plan)?;
            return Err(error);
        }
    }
    save_stored_plan(app_dir, &plan)?;
    Ok(windows_update_status(app_dir))
}

fn stored_plan_contract(plan: &StoredPlan) -> serde_json::Value {
    serde_json::json!({
        "planId": plan.plan_id,
        "planDigest": plan.plan_digest,
        "channel": plan.channel,
        "phase": plan.phase,
        "components": plan.components.iter().map(|component| serde_json::json!({
            "componentId": component.component_id,
            "version": component.version,
            "manifestDigest": component.manifest_digest,
            "artifactDigest": component.artifact_digest,
            "restartGroup": component.restart_group,
        })).collect::<Vec<_>>(),
    })
}

fn check_report_path(app_dir: &Path) -> PathBuf {
    app_dir.join("updates").join("last-check.json")
}

fn update_plans_dir(app_dir: &Path) -> PathBuf {
    app_dir.join("updates").join("plans")
}

fn read_check_report(app_dir: &Path) -> Result<UpdateCheckReport, String> {
    let path = check_report_path(app_dir);
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if metadata.len() > 1_048_576 {
        return Err("本机检查状态超过大小限制。".to_string());
    }
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    serde_json::from_slice(&bytes).map_err(|error| format!("本机检查状态 JSON 无效: {error}"))
}

fn read_stored_plans(app_dir: &Path) -> Result<Vec<StoredPlan>, String> {
    let directory = update_plans_dir(app_dir);
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("无法读取更新计划目录: {error}")),
    };
    let mut plans = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| format!("无法读取更新计划目录项: {error}"))?;
        if entry
            .path()
            .extension()
            .and_then(|extension| extension.to_str())
            != Some("json")
        {
            continue;
        }
        let bytes = fs::read(entry.path()).map_err(|error| format!("无法读取更新计划: {error}"))?;
        if bytes.len() > 5 * 1_048_576 {
            continue;
        }
        if let Ok(plan) = serde_json::from_slice::<StoredPlan>(&bytes) {
            plans.push(plan);
        }
    }
    plans.sort_by(|left, right| left.plan_id.cmp(&right.plan_id));
    Ok(plans)
}

fn load_stored_plan(app_dir: &Path, plan_id: &str) -> Result<StoredPlan, String> {
    if plan_id.len() != 37
        || !plan_id.starts_with("plan-")
        || !plan_id[5..]
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err("planId 格式无效。".to_string());
    }
    let path = update_plans_dir(app_dir).join(format!("{plan_id}.json"));
    let bytes =
        fs::read(&path).map_err(|error| format!("无法读取本机计划 `{plan_id}`: {error}"))?;
    if bytes.len() > 5 * 1_048_576 {
        return Err("本机持久计划超过大小限制。".to_string());
    }
    serde_json::from_slice(&bytes).map_err(|error| format!("本机持久计划 JSON 无效: {error}"))
}

fn save_stored_plan(app_dir: &Path, plan: &StoredPlan) -> Result<(), String> {
    fs::create_dir_all(update_plans_dir(app_dir))
        .map_err(|error| format!("无法创建本机更新计划目录: {error}"))?;
    let path = update_plans_dir(app_dir).join(format!("{}.json", plan.plan_id));
    write_json_atomically(&path, plan)
}

fn validate_stored_plan_metadata(
    catalog: &serde_json::Value,
    plan: &StoredPlan,
) -> Result<(), String> {
    if plan.schema_version != 1
        || plan.components.len() != 1
        || !matches!(
            plan.phase.as_str(),
            "checked" | "staged" | "applying" | "succeeded" | "rolled_back" | "failed"
        )
    {
        return Err("本机计划 schema、组件数或 phase 无效。".to_string());
    }
    let component_digests = plan
        .components
        .iter()
        .map(|component| release_update::PlanComponentDigest {
            component_id: component.component_id.clone(),
            version: component.version.clone(),
            manifest_digest: component.manifest_digest.clone(),
            artifact_digest: component.artifact_digest.clone(),
            restart_group: component.restart_group.clone(),
        })
        .collect::<Vec<_>>();
    let (plan_id, plan_digest) =
        release_update::plan_id_and_digest(&plan.channel, &component_digests)?;
    if plan_id != plan.plan_id || plan_digest != plan.plan_digest {
        return Err("本机计划 planId/planDigest 与组件集合不匹配。".to_string());
    }
    for component in &plan.components {
        let index: serde_json::Value = serde_json::from_str(&component.index_json)
            .map_err(|error| format!("本机 release index JSON 无效: {error}"))?;
        let manifest: serde_json::Value = serde_json::from_str(&component.manifest_json)
            .map_err(|error| format!("本机 manifest JSON 无效: {error}"))?;
        let checked = release_update::validate_windows_oci_manifest(
            &index,
            &manifest,
            catalog,
            &component.component_id,
            &plan.channel,
        )?;
        if checked.manifest_digest != component.manifest_digest
            || checked.artifact_digest != component.artifact_digest
            || checked.version != component.version
            || checked.restart_group != component.restart_group
        {
            return Err("本机计划组件字段与其 immutable manifest 不匹配。".to_string());
        }
    }
    Ok(())
}

fn remove_checked_plans_for_components(
    app_dir: &Path,
    component_ids: &[String],
) -> Result<(), String> {
    for plan in read_stored_plans(app_dir)? {
        if plan.phase == "checked"
            && plan
                .components
                .iter()
                .any(|component| component_ids.contains(&component.component_id))
        {
            let _ =
                fs::remove_file(update_plans_dir(app_dir).join(format!("{}.json", plan.plan_id)));
        }
    }
    Ok(())
}

fn is_product_installed(app_dir: &Path, tool_id: &str) -> bool {
    let compose = fs::read_to_string(app_dir.join("docker-compose.yml")).unwrap_or_default();
    compose_service_image(&compose, &format!("cyrene-{tool_id}")).is_ok()
}

fn docker_container_present(component_id: &str) -> bool {
    docker_inspect(&[
        "container".to_string(),
        "inspect".to_string(),
        component_id.to_string(),
    ])
    .is_ok()
}

fn docker_component_digest(component_id: &str) -> Option<String> {
    let container = docker_inspect(&[
        "container".to_string(),
        "inspect".to_string(),
        component_id.to_string(),
    ])
    .ok()?;
    let image_id = container.get("Image")?.as_str()?;
    let repository = component_repository(component_id)?;
    let image = docker_inspect(&[
        "image".to_string(),
        "inspect".to_string(),
        image_id.to_string(),
    ])
    .ok()?;
    image
        .get("RepoDigests")?
        .as_array()?
        .iter()
        .filter_map(serde_json::Value::as_str)
        .find_map(|reference| {
            let (candidate_repository, digest) = reference.rsplit_once('@')?;
            (candidate_repository == repository && release_update::is_digest(digest))
                .then(|| digest.to_string())
        })
}

fn docker_component_version(component_id: &str) -> Option<String> {
    let container = docker_inspect(&[
        "container".to_string(),
        "inspect".to_string(),
        component_id.to_string(),
    ])
    .ok()?;
    let labels = container.get("Config")?.get("Labels")?;
    let version_label = if component_id == component_catalog::WINDOWS_MAINTENANCE_COMPONENT_ID {
        "io.cyrene.component.version"
    } else {
        "org.opencontainers.image.version"
    };
    labels.get(version_label)?.as_str().map(str::to_string)
}

fn runtime_broker_version_range(manifest: &serde_json::Value) -> Result<&str, String> {
    manifest
        .get("dependencies")
        .and_then(serde_json::Value::as_array)
        .and_then(|dependencies| {
            dependencies.iter().find(|dependency| {
                dependency
                    .get("componentId")
                    .and_then(serde_json::Value::as_str)
                    == Some(component_catalog::WINDOWS_MAINTENANCE_COMPONENT_ID)
            })
        })
        .and_then(|dependency| dependency.get("versionRange"))
        .and_then(serde_json::Value::as_str)
        .filter(|range| *range == ">=0.1.0, <0.2.0")
        .ok_or_else(|| {
            "Product manifest 缺少 catalog 要求的 runtime-maintenance >=0.1.0, <0.2.0 dependency。"
                .to_string()
        })
}

fn parse_semver_triplet(value: &str) -> Option<(u64, u64, u64)> {
    let mut parts = value.split('.');
    let parse_part = |part: &str| {
        if part.is_empty() || (part.len() > 1 && part.starts_with('0')) {
            return None;
        }
        part.parse::<u64>().ok()
    };
    let major = parse_part(parts.next()?)?;
    let minor = parse_part(parts.next()?)?;
    let patch = parse_part(parts.next()?)?;
    if parts.next().is_some() {
        return None;
    }
    Some((major, minor, patch))
}

fn version_satisfies_range(version: &str, range: &str) -> bool {
    let Some(version) = parse_semver_triplet(version) else {
        return false;
    };
    match range {
        "=0.1.0" => version == (0, 1, 0),
        ">=0.1.0, <0.2.0" => version >= (0, 1, 0) && version < (0, 2, 0),
        _ => false,
    }
}

fn installed_runtime_broker_identity(app_dir: &Path) -> Result<(String, String), String> {
    const BROKER_REPOSITORY: &str = "ghcr.io/dohorizon-ai/cyrene-runtime-maintenance";
    let compose = fs::read_to_string(app_dir.join("docker-compose.yml"))
        .map_err(|error| format!("无法读取本机 runtime-maintenance Compose 服务: {error}"))?;
    let configured_image = compose_service_image(&compose, "cyrene-runtime-maintenance")?;
    if image_reference_repository(&configured_image)? != BROKER_REPOSITORY {
        return Err(
            "本机 runtime-maintenance image repository 与 Workspace catalog 不匹配。".to_string(),
        );
    }
    let container = docker_inspect(&[
        "container".to_string(),
        "inspect".to_string(),
        "cyrene-runtime-maintenance".to_string(),
    ])
    .map_err(|error| format!("runtime-maintenance broker 未安装或不可检查: {error}"))?;
    let image_id = container
        .get("Image")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "无法读取 runtime-maintenance 容器 image ID。".to_string())?;
    let container_image = container
        .get("Config")
        .and_then(|config| config.get("Image"))
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "无法读取 runtime-maintenance 容器 image reference。".to_string())?;
    let immutable_image = immutable_repo_digest(image_id, &configured_image, container_image)?;
    let digest = immutable_image
        .rsplit_once('@')
        .map(|(_, digest)| digest)
        .filter(|digest| release_update::is_digest(digest))
        .ok_or_else(|| "runtime-maintenance broker 没有可验证的不可变 RepoDigest。".to_string())?
        .to_string();
    let image = docker_inspect(&[
        "image".to_string(),
        "inspect".to_string(),
        image_id.to_string(),
    ])?;
    let version = image
        .get("Config")
        .and_then(|config| config.get("Labels"))
        .and_then(|labels| labels.get("io.cyrene.component.version"))
        .and_then(serde_json::Value::as_str)
        .filter(|version| parse_semver_triplet(version).is_some())
        .ok_or_else(|| {
            "runtime-maintenance image 缺少有效 io.cyrene.component.version label。".to_string()
        })?
        .to_string();
    Ok((version, digest))
}

fn ensure_runtime_broker_version_satisfies_manifest(
    app_dir: &Path,
    manifest: &serde_json::Value,
) -> Result<(), String> {
    let range = runtime_broker_version_range(manifest)?;
    let (version, _) = installed_runtime_broker_identity(app_dir)?;
    if !version_satisfies_range(&version, range) {
        return Err(format!(
            "当前 runtime-maintenance broker 版本 `{version}` 不满足 Product dependency `{range}`。"
        ));
    }
    Ok(())
}

fn verify_product_image_dependencies(
    app_dir: &Path,
    catalog: &serde_json::Value,
    product_manifest: &serde_json::Value,
    product_image: &str,
    channel: &str,
) -> Result<(), String> {
    ensure_runtime_broker_version_satisfies_manifest(app_dir, product_manifest)?;
    let (broker_version, broker_digest) = installed_runtime_broker_identity(app_dir)?;
    let other_channel = if channel == "stable" {
        "preview"
    } else {
        "stable"
    };
    let broker_release = github_updates::verify_windows_image_digest(
        app_dir,
        catalog,
        component_catalog::WINDOWS_MAINTENANCE_COMPONENT_ID,
        &broker_digest,
        channel,
    )?;
    let broker_release = match broker_release {
        Some(release) => release,
        None => github_updates::verify_windows_image_digest(
            app_dir,
            catalog,
            component_catalog::WINDOWS_MAINTENANCE_COMPONENT_ID,
            &broker_digest,
            other_channel,
        )?
        .ok_or_else(|| {
            "已安装的 runtime-maintenance broker digest 未出现在受信 Workspace release index。"
                .to_string()
        })?,
    };
    if broker_release.version != broker_version {
        return Err(
            "runtime-maintenance broker version label 与受信 manifest 不匹配。".to_string(),
        );
    }
    let product = docker_inspect(&[
        "image".to_string(),
        "inspect".to_string(),
        product_image.to_string(),
    ])
    .map_err(|error| format!("无法读取已暂存 Product image labels: {error}"))?;
    let labels = product
        .get("Config")
        .and_then(|config| config.get("Labels"))
        .ok_or_else(|| "暂存 Product image 缺少 SDK dependency labels。".to_string())?;
    github_updates::verify_runtime_maintenance_sdk_dependency(app_dir, catalog, labels, channel)
}

fn component_repository(component_id: &str) -> Option<&'static str> {
    match component_id {
        "cyrene-catalyst" => Some("ghcr.io/dohorizon-ai/cyrene-catalyst"),
        "cyrene-echo" => Some("ghcr.io/dohorizon-ai/cyrene-echo"),
        "cyrene-exchange" => Some("ghcr.io/dohorizon-ai/cyrene-exchange"),
        "cyrene-reactor" => Some("ghcr.io/dohorizon-ai/cyrene-reactor"),
        "cyrene-yield" => Some("ghcr.io/dohorizon-ai/cyrene-yield"),
        "cyrene-runtime-maintenance" => Some("ghcr.io/dohorizon-ai/cyrene-runtime-maintenance"),
        _ => None,
    }
}

fn installed_product_version(app_dir: &Path, tool: &ToolSpec) -> Option<String> {
    let container = docker_inspect(&[
        "container".to_string(),
        "inspect".to_string(),
        format!("cyrene-{}", tool.id),
    ])
    .ok()?;
    let labels = container.get("Config")?.get("Labels");
    labels
        .and_then(|value| value.get("org.opencontainers.image.version"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            let image = container.get("Config")?.get("Image")?.as_str()?;
            image
                .rsplit_once(':')
                .map(|(_, tag)| tag.to_string())
                .or_else(|| image.rsplit_once('@').map(|(_, digest)| digest.to_string()))
        })
        .or_else(|| {
            let compose = fs::read_to_string(app_dir.join("docker-compose.yml")).ok()?;
            compose_service_image(&compose, &format!("cyrene-{}", tool.id)).ok()
        })
}

fn print_usage(prog: &str) {
    println!("Usage / 用法: {} [OPTIONS]", prog);
    println!("\nOptions / 选项:");
    println!("  --silent                以无交互静默模式运行安装");
    println!("  --uninstall             执行完全干净卸载 (停止容器、清理卷与本地所有数据)");
    println!("  --clean-uninstall       同 --uninstall");
    println!("  --force                 在卸载或部署时不进行二次交互确认");
    println!(
        "  --exchange-url <URL>    设置 Exchange 网关端点 (默认: {})",
        get_default_exchange_url()
    );
    println!("  --exchange-token <KEY>  设置统一访问 API Key 凭据");
    println!("  --deploy-tools <NAMES>  以逗号分隔下载部署的服务: all 或 navigator,exchange,reactor,yield,catalyst,echo");
    println!("  --update-service <NAME> 按不可变 digest 更新单个容器: exchange,reactor,yield,catalyst,echo");
    println!("  --manifest <PATH>       指向发布工作流产出的 service-update-manifest.json");
    println!("  --initialize-runtime-maintenance  验证已 pin broker release 并初始化本机五个 Product 活动源");
    println!("  --generate-compose <PATH> 生成统一 docker-compose.yml 部署清单");
    println!("  -h, --help              显示帮助信息\n");
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceUpdateManifest {
    schema_version: u32,
    service_id: String,
    version: String,
    source_commit: String,
    image: ServiceImageManifest,
    platform: ServicePlatformManifest,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredPlan {
    schema_version: u32,
    plan_id: String,
    plan_digest: String,
    channel: String,
    phase: String,
    components: Vec<StoredPlanComponent>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredPlanComponent {
    component_id: String,
    version: String,
    manifest_digest: String,
    artifact_digest: String,
    restart_group: String,
    index_json: String,
    manifest_json: String,
}

#[derive(Deserialize, Serialize)]
struct ServiceImageManifest {
    repository: String,
    digest: String,
}

#[derive(Deserialize, Serialize)]
struct ServicePlatformManifest {
    os: String,
    arch: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceUpdateJournal {
    schema_version: u32,
    service_id: String,
    previous_image: String,
    candidate_image: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    plan_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    plan_digest: Option<String>,
    #[serde(default)]
    component_artifact_digests: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    maintenance_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    maintenance_request_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    maintenance_end_request_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    expected_gate_generation: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    expected_catalog_generation: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    phase: Option<String>,
    #[serde(default)]
    user_confirmed_restart: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ComponentCheckReport {
    component_id: String,
    phase: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    available_version: Option<String>,
    update_available: bool,
    blockers: Vec<serde_json::Value>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateCheckReport {
    schema_version: u32,
    channel: String,
    components: Vec<ComponentCheckReport>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalPlanBinding {
    plan_id: String,
    plan_digest: String,
    manifest_digest: String,
    component_artifact_digests: BTreeMap<String, String>,
}

struct ServiceUpdateLock {
    _file: File,
}

fn option_value(args: &[String], option: &str) -> Option<String> {
    let index = args.iter().position(|arg| arg == option)?;
    args.get(index + 1)
        .filter(|value| !value.starts_with('-'))
        .cloned()
}

/// Updates one running Product container from a validated immutable image manifest.
///
/// The installed Compose file is edited only for the requested service. Its existing bind mount
/// remains in place, and a failed health check restores the previous registry digest.
fn update_service_from_manifest(
    app_dir: &Path,
    requested_id: &str,
    manifest_path: &Path,
) -> Result<(), String> {
    let tool = TOOLS
        .iter()
        .find(|tool| tool.id.eq_ignore_ascii_case(requested_id))
        .ok_or_else(|| {
            format!("未知服务 `{requested_id}`；可更新 exchange、reactor、yield、catalyst、echo。")
        })?;

    if matches!(tool.kind, ToolKind::LocalAgent) {
        return Err(
            "Navigator 当前只有本地配置，没有可下载的原生二进制制品；此命令不会声称更新 Navigator 二进制。需要刷新配置时请运行 --deploy-tools navigator。".to_string(),
        );
    }

    ensure_update_operator()?;

    let _update_lock = acquire_service_update_lock(app_dir)?;
    recover_interrupted_update(app_dir)?;

    let expected_repository = format!("ghcr.io/dohorizon-ai/cyrene-{}", tool.id);
    let expected_manifest_id = format!("cyrene-{}", tool.id);
    let manifest_text = fs::read_to_string(manifest_path)
        .map_err(|error| format!("无法读取清单 {}: {error}", manifest_path.display()))?;
    let manifest: ServiceUpdateManifest = serde_json::from_str(&manifest_text)
        .map_err(|error| format!("服务更新清单 JSON 无效: {error}"))?;

    validate_service_manifest(&manifest, &expected_manifest_id, &expected_repository)?;
    ensure_manifest_matches_docker_platform(&manifest.platform)?;
    verify_service_image_attestation(tool, &manifest)?;
    let plan = make_local_plan_binding(&expected_manifest_id, &manifest)?;
    confirm_local_plan(&manifest, &plan)?;
    let candidate_image = format!("{}@{}", manifest.image.repository, manifest.image.digest);
    let result = apply_product_image(
        app_dir,
        tool,
        &plan,
        &candidate_image,
        &manifest.version,
        "stable",
    );
    if let Err(error) = &result {
        if let Err(cleanup_error) =
            finish_definitive_begin_refusal(app_dir, &update_journal_path(app_dir), error)
        {
            return Err(format!("{error}; {cleanup_error}"));
        }
    }
    result
}

fn apply_product_image(
    app_dir: &Path,
    tool: &ToolSpec,
    plan: &LocalPlanBinding,
    candidate_image: &str,
    version: &str,
    channel: &str,
) -> Result<(), String> {
    ensure_update_operator()?;
    let compose_file = app_dir.join("docker-compose.yml");
    let compose_content = fs::read_to_string(&compose_file).map_err(|error| {
        format!(
            "未找到已安装服务的 Compose 清单 {}: {error}",
            compose_file.display()
        )
    })?;
    let compose_service = format!("cyrene-{}", tool.id);
    let candidate_compose =
        replace_compose_service_image(&compose_content, &compose_service, candidate_image)?;
    let configured_image = compose_service_image(&compose_content, &compose_service)?;
    let container_name = compose_service.clone();
    let current_container = docker_inspect(&[
        "container".to_string(),
        "inspect".to_string(),
        container_name.clone(),
    ])
    .map_err(|error| format!("目标容器 `{container_name}` 不存在或不可读取: {error}"))?;
    let image_id = current_container
        .get("Image")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| format!("无法从容器 `{container_name}` 读取当前镜像 ID。"))?;
    let container_image = current_container
        .get("Config")
        .and_then(|config| config.get("Image"))
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| format!("无法从容器 `{container_name}` 读取当前镜像引用。"))?;
    let previous_image = immutable_repo_digest(image_id, &configured_image, container_image)?;

    let catalog = component_catalog::trusted_catalog()?;
    let component_id = format!("cyrene-{}", tool.id);
    let candidate_digest = candidate_image
        .rsplit_once('@')
        .map(|(_, digest)| digest)
        .filter(|digest| release_update::is_digest(digest))
        .ok_or_else(|| "候选 Product image 必须固定为不可变 sha256 digest。".to_string())?;
    run_docker_status(
        &["pull".to_string(), candidate_image.to_string()],
        "确保候选 immutable digest 已在本机暂存",
    )?;
    let verified_candidate = github_updates::verify_windows_image_digest(
        app_dir,
        &catalog,
        &component_id,
        candidate_digest,
        channel,
    )?
    .ok_or_else(|| "候选 Product digest 未出现在受信 Workspace release index。".to_string())?;
    if verified_candidate.image_reference != candidate_image {
        return Err("候选 Product image 与受信 Workspace manifest 不一致。".to_string());
    }
    verify_product_image_dependencies(
        app_dir,
        &catalog,
        &verified_candidate.manifest,
        candidate_image,
        channel,
    )?;

    println!("目标服务: {} ({})", tool.id, format!("cyrene-{}", tool.id));
    println!("候选版本: {version}");
    println!("候选镜像: {candidate_image}");
    println!("当前镜像回滚点: {previous_image}");
    println!("计划 ID: {}", plan.plan_id);
    println!("计划 digest: {}", plan.plan_digest);

    let readiness = maintenance::get_product_readiness(app_dir).map_err(|error| {
        format!(
            "Product 运行状态门禁不可用；拒绝更新 `{}`: {error}",
            tool.id
        )
    })?;
    let gate = readiness.contract_gate();
    if gate["state"].as_str() != Some("idle") {
        return Err(format!(
            "Product 活动门禁为 `{}`；不会取消或排空任务。",
            gate["state"].as_str().unwrap_or("unknown")
        ));
    }
    let request_id = maintenance::new_request_id("begin");
    let expected_gate_generation = readiness
        .gate_generation
        .ok_or_else(|| "维护 broker 未提供 gate_generation；状态按 UNKNOWN 处理。".to_string())?;
    let expected_catalog_generation = readiness.install_catalog_generation.ok_or_else(|| {
        "维护 broker 未提供 install_catalog_generation；状态按 UNKNOWN 处理。".to_string()
    })?;
    let mut journal = ServiceUpdateJournal {
        schema_version: 1,
        service_id: format!("cyrene-{}", tool.id),
        previous_image: previous_image.clone(),
        candidate_image: candidate_image.to_string(),
        plan_id: Some(plan.plan_id.clone()),
        plan_digest: Some(plan.plan_digest.clone()),
        component_artifact_digests: plan.component_artifact_digests.clone(),
        maintenance_token: None,
        maintenance_request_id: Some(request_id.clone()),
        maintenance_end_request_id: Some(maintenance::new_request_id("end")),
        expected_gate_generation: Some(expected_gate_generation),
        expected_catalog_generation: Some(expected_catalog_generation),
        phase: Some("maintenance_pending".to_string()),
        user_confirmed_restart: true,
    };
    let journal_path = update_journal_path(app_dir);
    write_json_atomically(&journal_path, &journal)
        .map_err(|error| format!("无法持久化确认和回滚计划；目标容器未修改: {error}"))?;

    let maintenance_token = match maintenance::begin_product_maintenance(
        &readiness,
        &request_id,
        &plan.plan_id,
        &plan.plan_digest,
        &plan.component_artifact_digests,
        true,
    ) {
        Ok(token) => token,
        Err(error) if maintenance::is_definitive_begin_refusal(&error) => return Err(error),
        Err(error) => return Err(format!("维护 broker 未授予更新围栏: {error}")),
    };
    journal.maintenance_token = Some(maintenance_token.clone());
    journal.phase = Some("applying".to_string());
    write_json_atomically(&journal_path, &journal).map_err(|error| {
        format!("维护围栏已建立；无法持久化 token，恢复将使用同一 request_id 重试: {error}")
    })?;

    if let Err(error) = atomic_write(&compose_file, candidate_compose.as_bytes()) {
        journal.phase = Some("rollback_healthy".to_string());
        write_json_atomically(&journal_path, &journal).map_err(|journal_error| {
            format!("Compose 未修改但无法持久化结束状态，维护围栏保持活动: {journal_error}")
        })?;
        end_journaled_product_maintenance(
            app_dir,
            &mut journal,
            &maintenance_token,
            "ROLLED_BACK",
            true,
        )?;
        fs::remove_file(&journal_path)
            .map_err(|cleanup| format!("维护围栏已解除，但清除恢复记录失败: {cleanup}"))?;
        return Err(format!(
            "无法原子更新 Compose 文件；运行容器未修改: {error}"
        ));
    }

    let compose_path = compose_file.to_string_lossy().into_owned();
    let update_result = run_compose_up(&compose_path, &compose_service)
        .and_then(|()| wait_for_container_health(&container_name, Duration::from_secs(90)));
    match update_result {
        Ok(()) => {
            journal.phase = Some("candidate_healthy".to_string());
            write_json_atomically(&journal_path, &journal).map_err(|error| {
                format!("新容器已健康，但无法持久化恢复阶段；维护围栏保持活动: {error}")
            })?;
            end_journaled_product_maintenance(
                app_dir,
                &mut journal,
                &maintenance_token,
                "SUCCESS",
                true,
            )
            .map_err(|error| {
                format!("新容器已健康，但 broker 未确认成功结束；恢复记录保留: {error}")
            })?;
            fs::remove_file(&journal_path)
                .map_err(|error| format!("更新成功但无法清除回滚记录: {error}"))?;
            println!("\n✅ {} 已更新并通过 Docker HEALTHCHECK。", tool.id);
            println!("   只重建目标容器，服务数据卷保持原样。\n");
            Ok(())
        }
        Err(update_error) => {
            eprintln!("\n⚠️ 候选版本未通过启动或健康检查: {update_error}");
            match rollback_service(&compose_file, &compose_path, &compose_service, &container_name, &journal_path, &previous_image) {
                Ok(()) => {
                    journal.phase = Some("rollback_healthy".to_string());
                    write_json_atomically(&journal_path, &journal).map_err(|error| format!("旧镜像已健康但无法持久化回滚阶段；维护围栏保持活动: {error}"))?;
                    end_journaled_product_maintenance(
                        app_dir,
                        &mut journal,
                        &maintenance_token,
                        "ROLLED_BACK",
                        true,
                    )
                    .map_err(|error| format!("旧镜像已健康但 broker 未确认回滚: {error}"))?;
                    fs::remove_file(&journal_path).map_err(|error| format!("旧镜像已恢复但无法清除恢复记录: {error}"))?;
                    Err(format!("候选版本失败；已恢复目标服务到此前不可变镜像并通过健康检查。原始错误: {update_error}"))
                }
                Err(rollback_error) => Err(format!("候选版本失败且自动回滚未完成。请检查 `{container_name}`。更新错误: {update_error}; 回滚错误: {rollback_error}")),
            }
        }
    }
}

fn make_local_plan_binding(
    component_id: &str,
    manifest: &ServiceUpdateManifest,
) -> Result<LocalPlanBinding, String> {
    let manifest_bytes = serde_json::to_vec(manifest)
        .map_err(|error| format!("无法计算组件 manifest digest: {error}"))?;
    let manifest_digest = format!("sha256:{}", sha256_hex(&manifest_bytes));
    let component_artifact_digests =
        BTreeMap::from([(component_id.to_string(), manifest.image.digest.clone())]);
    let seed = format!(
        "{component_id}\n{manifest_digest}\n{}",
        manifest.image.digest
    );
    let plan_id = format!(
        "legacy-{}-{}",
        component_id.trim_start_matches("cyrene-"),
        &sha256_hex(seed.as_bytes())[..16]
    );
    let digest_input = serde_json::json!({
        "planId": &plan_id,
        "manifestDigest": &manifest_digest,
        "componentArtifactDigests": &component_artifact_digests,
    });
    let plan_digest = format!(
        "sha256:{}",
        sha256_hex(&serde_json::to_vec(&digest_input).map_err(|error| error.to_string())?)
    );
    Ok(LocalPlanBinding {
        plan_id,
        plan_digest,
        manifest_digest,
        component_artifact_digests,
    })
}

fn confirm_local_plan(
    manifest: &ServiceUpdateManifest,
    plan: &LocalPlanBinding,
) -> Result<(), String> {
    if !io::stdin().is_terminal() {
        return Err(
            "旧 --update-service 入口只允许交互确认；请使用本机更新面板或在终端重试。".to_string(),
        );
    }
    println!("\n此操作只会重建目标 Product 容器，不会取消或排空任务。已验证镜像 attestation。");
    println!("组件版本: {} / {}", manifest.service_id, manifest.version);
    println!("Plan ID: {}", plan.plan_id);
    println!("Plan digest: {}", plan.plan_digest);
    print!("输入完整 Plan digest 以确认安装: ");
    io::stdout()
        .flush()
        .map_err(|error| format!("无法显示确认提示: {error}"))?;
    let mut confirmation = String::new();
    io::stdin()
        .read_line(&mut confirmation)
        .map_err(|error| format!("读取确认失败: {error}"))?;
    if confirmation.trim() != plan.plan_digest {
        return Err("计划 digest 未匹配；更新未应用。".to_string());
    }
    Ok(())
}

fn verify_service_image_attestation(
    tool: &ToolSpec,
    manifest: &ServiceUpdateManifest,
) -> Result<(), String> {
    let repository = match tool.id {
        "catalyst" => "DoHorizon-AI/Cyrene-Catalyst",
        "echo" => "DoHorizon-AI/Cyrene-Echo",
        "exchange" => "DoHorizon-AI/Cyrene-Exchange",
        "reactor" => "DoHorizon-AI/Cyrene-Reactor",
        "yield" => "DoHorizon-AI/Cyrene-Yield",
        _ => return Err(format!("服务 `{}` 没有静态 release publisher。", tool.id)),
    };
    let workflow = format!("{repository}/.github/workflows/component-release.yml");
    let subject = format!(
        "oci://{}@{}",
        manifest.image.repository, manifest.image.digest
    );
    let mut failures = Vec::new();
    for source_ref in ["refs/heads/main", "refs/heads/release"] {
        let output = github_updates::github_command()
            .args([
                "attestation",
                "verify",
                &subject,
                "--repo",
                &repository,
                "--signer-workflow",
                &workflow,
                "--source-ref",
                source_ref,
                "--source-digest",
                &manifest.source_commit,
                "--format",
                "json",
            ])
            .output()
            .map_err(|error| format!("无法启动 GitHub CLI 以验证镜像 attestation: {error}"))?;
        if output.status.success() {
            return Ok(());
        }
        failures.push(format!(
            "{source_ref}: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Err(format!(
        "镜像 `{subject}` 未通过受信 release workflow attestation 验证: {}",
        failures.join("; ")
    ))
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn ensure_update_operator() -> Result<(), String> {
    if has_update_operator_authority() {
        Ok(())
    } else {
        Err("应用更新需要在本机以 Windows Administrator 身份运行；远程 Workspace 权限不能提升本机安装权限。".to_string())
    }
}

#[cfg(not(windows))]
fn has_update_operator_authority() -> bool {
    false
}

#[cfg(windows)]
fn has_update_operator_authority() -> bool {
    use std::ffi::c_void;

    #[repr(C)]
    struct SidAuthority([u8; 6]);

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetCurrentProcess() -> *mut c_void;
        fn CloseHandle(handle: *mut c_void) -> i32;
    }

    #[link(name = "advapi32")]
    unsafe extern "system" {
        fn OpenProcessToken(
            process: *mut c_void,
            desired_access: u32,
            token: *mut *mut c_void,
        ) -> i32;
        fn AllocateAndInitializeSid(
            authority: *const SidAuthority,
            sub_authority_count: u8,
            sub_authority_0: u32,
            sub_authority_1: u32,
            sub_authority_2: u32,
            sub_authority_3: u32,
            sub_authority_4: u32,
            sub_authority_5: u32,
            sub_authority_6: u32,
            sub_authority_7: u32,
            sid: *mut *mut c_void,
        ) -> i32;
        fn CheckTokenMembership(token: *mut c_void, sid: *mut c_void, is_member: *mut i32) -> i32;
        fn FreeSid(sid: *mut c_void) -> *mut c_void;
    }

    const TOKEN_QUERY: u32 = 0x0008;
    const SECURITY_BUILTIN_DOMAIN_RID: u32 = 0x20;
    const DOMAIN_ALIAS_RID_ADMINS: u32 = 0x220;
    let authority = SidAuthority([0, 0, 0, 0, 0, 5]);
    let mut token = std::ptr::null_mut();
    let mut admin_sid = std::ptr::null_mut();
    let mut is_member = 0;

    // The helper uses Windows token membership so a caller cannot grant itself update authority
    // by adding a local Control scope or changing request JSON.
    let opened = unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) };
    if opened == 0 {
        return false;
    }
    let allocated = unsafe {
        AllocateAndInitializeSid(
            &authority,
            2,
            SECURITY_BUILTIN_DOMAIN_RID,
            DOMAIN_ALIAS_RID_ADMINS,
            0,
            0,
            0,
            0,
            0,
            0,
            &mut admin_sid,
        )
    };
    let checked =
        allocated != 0 && unsafe { CheckTokenMembership(token, admin_sid, &mut is_member) } != 0;
    if allocated != 0 {
        unsafe {
            FreeSid(admin_sid);
        }
    }
    unsafe {
        CloseHandle(token);
    }
    checked && is_member != 0
}

fn validate_service_manifest(
    manifest: &ServiceUpdateManifest,
    expected_service_id: &str,
    expected_repository: &str,
) -> Result<(), String> {
    if manifest.schema_version != 1 {
        return Err(format!(
            "不支持清单 schemaVersion={}；当前仅接受 schemaVersion=1。",
            manifest.schema_version
        ));
    }
    if manifest.service_id != expected_service_id {
        return Err(format!(
            "清单 serviceId 为 `{}`，但本次目标是 `{expected_service_id}`。",
            manifest.service_id
        ));
    }
    if manifest.image.repository != expected_repository {
        return Err(format!(
            "清单镜像仓库 `{}` 与服务规范仓库 `{expected_repository}` 不一致。",
            manifest.image.repository
        ));
    }
    if !is_full_hex(&manifest.source_commit, 40) {
        return Err("清单 sourceCommit 必须是完整的 40 位 Git SHA。".to_string());
    }
    if manifest.version.is_empty()
        || manifest.version.len() > 128
        || !manifest
            .version
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "._-".contains(character))
    {
        return Err("清单 version 不是有效的镜像 tag。".to_string());
    }
    if !is_sha256_digest(&manifest.image.digest) {
        return Err("清单 image.digest 必须使用 sha256:<64 位十六进制摘要>。".to_string());
    }
    if manifest.platform.os != "linux" || manifest.platform.arch != "amd64" {
        return Err(format!(
            "清单平台为 {}/{}；Windows 安装器当前只接受 Linux/amd64 Product 镜像。",
            manifest.platform.os, manifest.platform.arch
        ));
    }
    Ok(())
}

fn is_full_hex(value: &str, length: usize) -> bool {
    value.len() == length && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn is_sha256_digest(value: &str) -> bool {
    value
        .strip_prefix("sha256:")
        .is_some_and(|digest| is_full_hex(digest, 64))
}

fn ensure_manifest_matches_docker_platform(
    platform: &ServicePlatformManifest,
) -> Result<(), String> {
    let output = docker_output(&[
        "info".to_string(),
        "--format".to_string(),
        "{{.OSType}}/{{.Architecture}}".to_string(),
    ])?;
    if !output.status.success() {
        return Err(format!(
            "无法读取 Docker 守护进程平台: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let daemon_platform = String::from_utf8_lossy(&output.stdout)
        .trim()
        .to_ascii_lowercase();
    let normalized = match daemon_platform.as_str() {
        "linux/x86_64" | "linux/x64" => "linux/amd64".to_string(),
        "linux/aarch64" => "linux/arm64".to_string(),
        other => other.to_string(),
    };
    let manifest_platform = format!("{}/{}", platform.os, platform.arch);
    if normalized != manifest_platform {
        return Err(format!(
            "清单平台 {manifest_platform} 与当前 Docker 守护进程平台 {normalized} 不匹配。"
        ));
    }
    Ok(())
}

fn docker_output(args: &[String]) -> Result<Output, String> {
    docker_command()
        .args(args)
        .output()
        .map_err(|error| format!("无法启动 Docker 命令: {error}"))
}

fn docker_inspect(args: &[String]) -> Result<serde_json::Value, String> {
    let output = docker_output(args)?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let value: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("Docker inspect 返回无效 JSON: {error}"))?;
    value
        .as_array()
        .and_then(|entries| entries.first())
        .cloned()
        .ok_or_else(|| "Docker inspect 没有返回目标对象。".to_string())
}

fn immutable_repo_digest(
    image_id: &str,
    configured_image: &str,
    container_image: &str,
) -> Result<String, String> {
    let configured_repository = image_reference_repository(configured_image)?;
    let container_repository = image_reference_repository(container_image)?;
    if configured_repository != container_repository {
        return Err(format!(
            "Compose 配置镜像仓库 `{configured_repository}` 与运行容器仓库 `{container_repository}` 不一致；为避免对错误版本回滚，更新已取消。"
        ));
    }

    let image = docker_inspect(&[
        "image".to_string(),
        "inspect".to_string(),
        image_id.to_string(),
    ])
    .map_err(|error| format!("无法读取当前镜像的不可变元数据: {error}"))?;
    let digests = image
        .get("RepoDigests")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| {
            "当前镜像没有 RepoDigests；为保证可回滚，更新已取消且未修改容器。".to_string()
        })?;
    digests
        .iter()
        .filter_map(serde_json::Value::as_str)
        .find(|reference| {
            reference.rsplit_once('@').is_some_and(|(repository, digest)| {
                repository == configured_repository && is_sha256_digest(digest)
            })
        })
        .map(str::to_string)
        .ok_or_else(|| {
            format!(
                "当前镜像没有仓库 `{configured_repository}` 对应的 sha256 RepoDigest；为保证可回滚，更新已取消。"
            )
        })
}

fn image_reference_repository(image_reference: &str) -> Result<&str, String> {
    let without_digest = image_reference
        .split_once('@')
        .map_or(image_reference, |(repository, _)| repository);
    let last_segment = without_digest.rsplit('/').next().unwrap_or(without_digest);
    if let Some(tag_start) = last_segment.rfind(':') {
        let repository_length = without_digest.len() - (last_segment.len() - tag_start);
        return Ok(&without_digest[..repository_length]);
    }
    if without_digest.is_empty() || !without_digest.contains('/') {
        return Err(format!("无效的容器镜像引用 `{image_reference}`。"));
    }
    Ok(without_digest)
}

fn compose_service_image(compose_content: &str, service_name: &str) -> Result<String, String> {
    let lines: Vec<&str> = compose_content.split('\n').collect();
    let heading = format!("  {service_name}:");
    let matches: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter_map(|(index, line)| (*line == heading).then_some(index))
        .collect();
    if matches.len() != 1 {
        return Err(format!(
            "Compose 文件中必须恰好包含一个 `{service_name}` 服务定义。"
        ));
    }
    let start = matches[0];
    let end = lines
        .iter()
        .enumerate()
        .skip(start + 1)
        .find_map(|(index, line)| {
            (line.starts_with("  ") && !line.starts_with("    ")).then_some(index)
        })
        .unwrap_or(lines.len());
    let images: Vec<&str> = lines[start + 1..end]
        .iter()
        .filter_map(|line| line.strip_prefix("    image:"))
        .map(str::trim)
        .collect();
    if images.len() != 1 || images[0].is_empty() {
        return Err(format!(
            "Compose 服务 `{service_name}` 必须恰好包含一个非空 image 配置。"
        ));
    }
    Ok(images[0].to_string())
}

fn replace_compose_service_image(
    compose_content: &str,
    service_name: &str,
    image_reference: &str,
) -> Result<String, String> {
    let lines: Vec<&str> = compose_content.split('\n').collect();
    let heading = format!("  {service_name}:");
    let matches: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter_map(|(index, line)| (*line == heading).then_some(index))
        .collect();
    if matches.len() != 1 {
        return Err(format!(
            "Compose 文件中必须恰好包含一个 `{service_name}` 服务定义。"
        ));
    }

    let start = matches[0];
    let end = lines
        .iter()
        .enumerate()
        .skip(start + 1)
        .find_map(|(index, line)| {
            (line.starts_with("  ") && !line.starts_with("    ")).then_some(index)
        })
        .unwrap_or(lines.len());
    let image_lines: Vec<usize> = (start + 1..end)
        .filter(|index| lines[*index].starts_with("    image:"))
        .collect();
    if image_lines.len() != 1 {
        return Err(format!(
            "Compose 服务 `{service_name}` 必须恰好包含一个 image 配置。"
        ));
    }

    let image_line = image_lines[0];
    let mut updated = lines;
    updated[image_line] = "";
    let replacement = format!("    image: {image_reference}");
    let mut output = updated.join("\n");
    let byte_position: usize = updated[..image_line]
        .iter()
        .map(|line| line.len() + 1)
        .sum();
    output.replace_range(byte_position..byte_position, &replacement);
    Ok(output)
}

fn update_journal_path(app_dir: &Path) -> PathBuf {
    app_dir.join("service-update-in-progress.json")
}

fn finish_definitive_begin_refusal(
    app_dir: &Path,
    journal_path: &Path,
    error: &str,
) -> Result<(), String> {
    if !maintenance::is_definitive_begin_refusal(error) {
        return Ok(());
    }
    let journal_text = match fs::read_to_string(journal_path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("无法读取被拒绝的更新记录，记录仍保留: {error}")),
    };
    let journal: ServiceUpdateJournal = serde_json::from_str(&journal_text)
        .map_err(|error| format!("被拒绝的更新记录无效，记录仍保留: {error}"))?;
    if let (Some(plan_id), Some(plan_digest)) =
        (journal.plan_id.as_deref(), journal.plan_digest.as_deref())
    {
        let plan_path = update_plans_dir(app_dir).join(format!("{plan_id}.json"));
        if plan_id.starts_with("plan-") {
            if !plan_path.exists() {
                return Err(format!(
                    "受控计划 `{plan_id}` 的持久文件缺失；拒绝清除维护恢复记录"
                ));
            }
            let mut plan = load_stored_plan(app_dir, plan_id)?;
            if plan.plan_digest != plan_digest {
                return Err(format!(
                    "计划 `{plan_id}` digest 与被拒绝的 Begin 记录不匹配；记录仍保留"
                ));
            }
            match plan.phase.as_str() {
                "applying" => {
                    plan.phase = "staged".to_string();
                    save_stored_plan(app_dir, &plan).map_err(|error| {
                        format!("无法恢复计划 `{plan_id}` 的 staged 状态，更新记录仍保留: {error}")
                    })?;
                }
                "staged" => {}
                phase => {
                    return Err(format!(
                        "计划 `{plan_id}` 阶段 `{phase}` 不允许从 Begin 拒绝恢复重试；更新记录仍保留"
                    ));
                }
            }
        } else if !plan_id.starts_with("legacy-") {
            return Err("拒绝清除绑定到未知 planId 格式的维护恢复记录".to_string());
        }
    }
    match fs::remove_file(journal_path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "计划已恢复到可重试状态，但无法清除明确拒绝后的 maintenance_pending 更新记录: {error}"
        )),
    }
}

fn derived_maintenance_end_request_id(identity: &str) -> String {
    let digest = sha256_hex(identity.as_bytes());
    format!("end-{}", &digest[..32])
}

/// Persist the EndMaintenance id before sending it so a lost broker response can be retried safely.
fn end_journaled_product_maintenance(
    app_dir: &Path,
    journal: &mut ServiceUpdateJournal,
    token: &str,
    outcome: &str,
    healthy: bool,
) -> Result<(), String> {
    let maintenance_request_id = journal.maintenance_request_id.as_deref().ok_or_else(|| {
        "回滚记录缺少 BeginMaintenance request_id，维护围栏保持活动。".to_string()
    })?;
    if journal.maintenance_end_request_id.is_none() {
        journal.maintenance_end_request_id =
            Some(derived_maintenance_end_request_id(maintenance_request_id));
    }
    let end_request_id = journal
        .maintenance_end_request_id
        .as_deref()
        .ok_or_else(|| "回滚记录缺少 EndMaintenance request_id。".to_string())?;
    write_json_atomically(&update_journal_path(app_dir), journal).map_err(|error| {
        format!("无法持久化 EndMaintenance request_id，维护围栏保持活动: {error}")
    })?;
    maintenance::end_product_maintenance(
        token,
        maintenance_request_id,
        end_request_id,
        outcome,
        healthy,
    )
}

fn acquire_service_update_lock(app_dir: &Path) -> Result<ServiceUpdateLock, String> {
    let parent = app_dir.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)
        .map_err(|error| format!("无法创建安装器父目录 {}: {error}", parent.display()))?;
    let canonical_parent = fs::canonicalize(parent)
        .map_err(|error| format!("无法解析安装器父目录 {}: {error}", parent.display()))?;
    let app_name = app_dir
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("安装器目录路径无效: {}", app_dir.display()))?;
    let lock_path = canonical_parent.join(format!(".{app_name}.service-update.lock"));
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&lock_path)
        .map_err(|error| format!("无法打开服务更新锁 {}: {error}", lock_path.display()))?;
    file.try_lock_exclusive().map_err(|error| {
        format!(
            "另一个更新或恢复操作正在运行，锁定文件为 {}: {error}",
            lock_path.display()
        )
    })?;
    Ok(ServiceUpdateLock { _file: file })
}

fn write_json_atomically<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let contents = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("无法序列化更新回滚记录: {error}"))?;
    atomic_write(path, &contents)
}

fn atomic_write(path: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("目标路径 {} 没有父目录。", path.display()))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("目标路径 {} 没有有效文件名。", path.display()))?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary_path = parent.join(format!(
        ".{file_name}.cyrene-{}-{nonce}.tmp",
        std::process::id()
    ));
    fs::create_dir_all(parent)
        .map_err(|error| format!("无法创建目标目录 {}: {error}", parent.display()))?;

    let write_result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)
            .map_err(|error| format!("无法创建临时文件 {}: {error}", temporary_path.display()))?;
        file.write_all(contents)
            .map_err(|error| format!("无法写入临时文件 {}: {error}", temporary_path.display()))?;
        file.sync_all()
            .map_err(|error| format!("无法同步临时文件 {}: {error}", temporary_path.display()))?;
        drop(file);
        replace_file_atomically(&temporary_path, path).map_err(|error| {
            format!(
                "无法原子替换 {} 为 {}: {error}",
                path.display(),
                temporary_path.display()
            )
        })
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    write_result
}

#[cfg(not(windows))]
fn replace_file_atomically(source: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(windows)]
fn replace_file_atomically(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(existing_file: *const u16, new_file: *const u16, flags: u32) -> i32;
    }

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
    let source_wide = source
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let destination_wide = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        MoveFileExW(
            source_wide.as_ptr(),
            destination_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn recover_interrupted_update(app_dir: &Path) -> Result<(), String> {
    let journal_path = update_journal_path(app_dir);
    if !journal_path.exists() {
        return Ok(());
    }

    let journal_text = fs::read_to_string(&journal_path)
        .map_err(|error| format!("无法读取回滚记录 {}: {error}", journal_path.display()))?;
    let mut journal: ServiceUpdateJournal = serde_json::from_str(&journal_text)
        .map_err(|error| format!("回滚记录 JSON 无效: {error}"))?;
    if journal.schema_version != 1 {
        return Err(format!(
            "不支持回滚记录 schemaVersion={}。",
            journal.schema_version
        ));
    }
    ensure_update_operator()?;
    let plan_id = journal.plan_id.as_deref().ok_or_else(|| {
        "旧版回滚记录没有用户确认计划绑定；为避免无确认重启，自动恢复已停止，请以管理员身份检查该回滚记录。".to_string()
    })?;
    let plan_digest = journal
        .plan_digest
        .as_deref()
        .ok_or_else(|| "回滚记录缺少 plan digest；拒绝无确认恢复。".to_string())?;
    if !journal.user_confirmed_restart {
        return Err(format!(
            "恢复记录 `{plan_id}` 没有持久化的用户确认，拒绝重启目标容器。"
        ));
    }
    if !maintenance::is_contract_digest(plan_digest) {
        return Err(format!("恢复记录 `{plan_id}` 的 plan digest 无效。"));
    }
    let tool = TOOLS
        .iter()
        .find(|tool| {
            matches!(tool.kind, ToolKind::ContainerService)
                && format!("cyrene-{}", tool.id) == journal.service_id
        })
        .ok_or_else(|| format!("回滚记录包含未知服务 `{}`。", journal.service_id))?;
    validate_journal_image(&journal.previous_image, tool, false)?;
    validate_journal_image(&journal.candidate_image, tool, true)?;

    let phase = journal.phase.clone().ok_or_else(|| {
        format!("恢复记录 `{plan_id}` 缺少阶段信息，维护围栏保留；请勿手动重启服务。")
    })?;
    let maintenance_token = match journal.maintenance_token.clone() {
        Some(token) => token,
        None if phase == "maintenance_pending" => {
            let request_id = journal.maintenance_request_id.as_deref().ok_or_else(|| {
                format!("恢复记录 `{plan_id}` 缺少 Begin request_id；维护围栏保持未知。")
            })?;
            let catalog_generation = journal.expected_catalog_generation.ok_or_else(|| {
                format!("恢复记录 `{plan_id}` 缺少 catalog generation；维护围栏保持未知。")
            })?;
            let gate_generation = journal.expected_gate_generation.ok_or_else(|| {
                format!("恢复记录 `{plan_id}` 缺少 gate generation；维护围栏保持未知。")
            })?;
            let token = match maintenance::resume_product_maintenance(
                request_id,
                catalog_generation,
                gate_generation,
                plan_id,
                plan_digest,
                &journal.component_artifact_digests,
            ) {
                Ok(token) => token,
                Err(error) => {
                    if let Err(cleanup_error) =
                        finish_definitive_begin_refusal(app_dir, &journal_path, &error)
                    {
                        return Err(format!(
                            "无法恢复已确认的维护 Begin: {error}; {cleanup_error}"
                        ));
                    }
                    return Err(format!("无法恢复已确认的维护 Begin: {error}"));
                }
            };
            journal.maintenance_token = Some(token.clone());
            journal.phase = Some("applying".to_string());
            write_json_atomically(&journal_path, &journal)
                .map_err(|error| format!("Begin token 已恢复但无法持久化恢复记录: {error}"))?;
            token
        }
        None => {
            return Err(format!(
                "恢复记录 `{plan_id}` 没有 maintenance token；拒绝重启目标容器。"
            ))
        }
    };
    if phase == "maintenance_pending" {
        let compose_file = app_dir.join("docker-compose.yml");
        let compose = fs::read_to_string(&compose_file)
            .map_err(|error| format!("无法读取 Compose 文件以检查待启动计划: {error}"))?;
        let service = format!("cyrene-{}", tool.id);
        if compose_service_image(&compose, &service).as_deref()
            == Ok(journal.previous_image.as_str())
        {
            end_journaled_product_maintenance(
                app_dir,
                &mut journal,
                &maintenance_token,
                "ROLLED_BACK",
                true,
            )?;
            fs::remove_file(&journal_path)
                .map_err(|error| format!("无法清除尚未修改容器的待启动恢复记录: {error}"))?;
            return Ok(());
        }
    }

    if phase == "candidate_healthy" || phase == "rollback_healthy" {
        let outcome = if phase == "candidate_healthy" {
            "SUCCESS"
        } else {
            "ROLLED_BACK"
        };
        end_journaled_product_maintenance(
            app_dir,
            &mut journal,
            &maintenance_token,
            outcome,
            true,
        )?;
        fs::remove_file(&journal_path)
            .map_err(|error| format!("无法清除已结束的恢复记录: {error}"))?;
        return Ok(());
    }
    if phase != "applying" {
        return Err(format!(
            "恢复记录 `{plan_id}` 阶段 `{phase}` 不受支持；维护围栏保持活动。"
        ));
    }

    let compose_file = app_dir.join("docker-compose.yml");
    let compose_content = fs::read_to_string(&compose_file)
        .map_err(|error| format!("无法读取 Compose 文件以恢复回滚: {error}"))?;
    let compose_service = format!("cyrene-{}", tool.id);
    let restored =
        replace_compose_service_image(&compose_content, &compose_service, &journal.previous_image)?;
    atomic_write(&compose_file, restored.as_bytes())?;

    let compose_path = compose_file.to_string_lossy().into_owned();
    let container_name = format!("cyrene-{}", tool.id);
    println!(
        "检测到未完成的 `{}` 更新；正在自动恢复到先前不可变镜像。",
        tool.id
    );
    run_compose_up(&compose_path, &compose_service)?;
    wait_for_container_health(&container_name, Duration::from_secs(90))?;
    let mut recovered = journal;
    recovered.phase = Some("rollback_healthy".to_string());
    write_json_atomically(&journal_path, &recovered).map_err(|error| {
        format!("旧镜像已健康，但无法持久化恢复结果；维护围栏保持活动: {error}")
    })?;
    end_journaled_product_maintenance(
        app_dir,
        &mut recovered,
        &maintenance_token,
        "ROLLED_BACK",
        true,
    )?;
    fs::remove_file(&journal_path)
        .map_err(|error| format!("无法清除已完成恢复的回滚记录: {error}"))?;
    println!("已恢复并验证 `{}` 的 Docker HEALTHCHECK。", tool.id);
    Ok(())
}

fn validate_journal_image(
    image_reference: &str,
    tool: &ToolSpec,
    is_candidate: bool,
) -> Result<(), String> {
    let (repository, digest) = image_reference
        .rsplit_once('@')
        .ok_or_else(|| format!("回滚记录中的镜像 `{image_reference}` 未固定 digest。"))?;
    if !is_sha256_digest(digest) {
        return Err(format!(
            "回滚记录中的镜像 `{image_reference}` digest 无效。"
        ));
    }
    let expected_candidate_repository = format!("ghcr.io/dohorizon-ai/cyrene-{}", tool.id);
    let valid_previous_repository =
        Some(repository) == tool.image_repository || repository == expected_candidate_repository;
    if (is_candidate && repository != expected_candidate_repository)
        || (!is_candidate && !valid_previous_repository)
    {
        return Err(format!(
            "回滚记录中的镜像仓库 `{repository}` 与服务规范仓库不匹配。"
        ));
    }

    let owner_and_repository = repository
        .strip_prefix("ghcr.io/")
        .ok_or_else(|| format!("回滚记录镜像必须来自 GHCR: `{repository}`。"))?;
    let (owner, image_name) = owner_and_repository
        .split_once('/')
        .ok_or_else(|| format!("回滚记录 GHCR 仓库格式无效: `{repository}`。"))?;
    let expected_name = format!("cyrene-{}", tool.id);
    let valid_previous_name = image_name == expected_name
        || (matches!(tool.id, "reactor" | "yield") && image_name == format!("{expected_name}-aca"));
    if owner.is_empty()
        || !owner.chars().all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || "-._".contains(character)
        })
        || !valid_previous_name
    {
        return Err(format!("回滚记录中的 GHCR 仓库不属于 `{}`。", tool.id));
    }
    Ok(())
}

fn run_docker_status(args: &[String], operation: &str) -> Result<(), String> {
    let status = docker_command()
        .args(args)
        .status()
        .map_err(|error| format!("{operation}时无法启动 Docker: {error}"))?;
    if !status.success() {
        return Err(format!("{operation}失败，Docker 退出状态为 {status}."));
    }
    Ok(())
}

fn run_compose_up(compose_path: &str, service_name: &str) -> Result<(), String> {
    println!("\n>> 仅重建目标服务 `{service_name}`...");
    run_docker_status(
        &[
            "compose".to_string(),
            "-f".to_string(),
            compose_path.to_string(),
            "up".to_string(),
            "-d".to_string(),
            "--no-deps".to_string(),
            "--force-recreate".to_string(),
            "--pull".to_string(),
            "never".to_string(),
            service_name.to_string(),
        ],
        "启动目标服务",
    )
}

fn wait_for_container_health(container_name: &str, timeout: Duration) -> Result<(), String> {
    let started = Instant::now();
    let mut last_inspect_error = None;
    while started.elapsed() < timeout {
        match docker_inspect(&[
            "container".to_string(),
            "inspect".to_string(),
            container_name.to_string(),
        ]) {
            Ok(container) => {
                let state = container.get("State").cloned().unwrap_or_default();
                let status = state
                    .get("Status")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("unknown");
                if status != "running" {
                    let exit_code = state
                        .get("ExitCode")
                        .and_then(serde_json::Value::as_i64)
                        .unwrap_or_default();
                    return Err(format!(
                        "容器 `{container_name}` 未保持运行，状态为 `{status}` (exit code {exit_code})。"
                    ));
                }
                let health = state
                    .get("Health")
                    .and_then(|health| health.get("Status"))
                    .and_then(serde_json::Value::as_str);
                match health {
                    Some("healthy") => return Ok(()),
                    Some("unhealthy") => {
                        return Err(format!(
                            "容器 `{container_name}` 的 Docker HEALTHCHECK 报告 unhealthy。"
                        ));
                    }
                    Some("starting") => {}
                    Some(other) => {
                        return Err(format!(
                            "容器 `{container_name}` 返回未知健康状态 `{other}`。"
                        ));
                    }
                    None => {
                        return Err(format!(
                            "容器 `{container_name}` 没有 Docker HEALTHCHECK，无法验证更新就绪状态。"
                        ));
                    }
                }
            }
            Err(error) => last_inspect_error = Some(error),
        }
        thread::sleep(Duration::from_secs(2));
    }
    match last_inspect_error {
        Some(error) => Err(format!(
            "等待容器 `{container_name}` 健康超时；最近的 inspect 错误: {error}"
        )),
        None => Err(format!(
            "等待容器 `{container_name}` 通过 Docker HEALTHCHECK 超时。"
        )),
    }
}

fn rollback_service(
    compose_file: &Path,
    compose_path: &str,
    compose_service: &str,
    container_name: &str,
    _journal_path: &Path,
    previous_image: &str,
) -> Result<(), String> {
    println!("\n>> 使用先前不可变镜像回滚 `{container_name}`: {previous_image}");
    let compose_content = fs::read_to_string(compose_file)
        .map_err(|error| format!("无法读取 Compose 文件以回滚: {error}"))?;
    let rollback_compose =
        replace_compose_service_image(&compose_content, compose_service, previous_image)?;
    atomic_write(compose_file, rollback_compose.as_bytes())?;
    run_compose_up(compose_path, compose_service)?;
    wait_for_container_health(container_name, Duration::from_secs(90))?;
    Ok(())
}

fn run_interactive(app_dir: &Path) {
    println!("📍 Cyrene 环境与数据存储路径: {}", app_dir.display());

    let mut exchange_url = get_default_exchange_url();
    let mut exchange_token = String::new();
    let mut selected_tools: BTreeSet<usize> = BTreeSet::new();

    // Default select navigator
    selected_tools.insert(0);

    loop {
        println!("\n--- [ 安装器功能导航 / Main Menu ] ---");
        println!(
            "1. [组件选装] 勾选/按需选择安装的组件 (当前已选 {}/{} 个)",
            selected_tools.len(),
            TOOLS.len()
        );
        println!(
            "2. [网关配置] 配置 Exchange 网关端点与凭据 (当前: {})",
            exchange_url
        );
        println!("3. [开始部署] 安装选定的本地环境并远程部署后端容器服务");
        println!("4. [环境状态] 查看本地服务与已部署组件运行状态");
        println!("5. [干净卸载] 完整卸载 Cyrene (停止容器/清理卷/删除所有本地配置)");
        println!("6. [完成退出] 保存配置并退出安装器");
        print!("\n请选择操作 [1-6]: ");
        io::stdout().flush().unwrap();

        let mut input = String::new();
        if io::stdin().read_line(&mut input).is_err() {
            break;
        }
        let choice = input.trim();

        match choice {
            "1" => {
                menu_select_tools(&mut selected_tools);
            }
            "2" => {
                println!("\n>> 配置 Exchange 网关端点:");
                println!("   默认端点: {}", get_default_exchange_url());
                print!("   请输入 Exchange URL (直接回车保持默认): ");
                io::stdout().flush().unwrap();
                let mut url_input = String::new();
                io::stdin().read_line(&mut url_input).unwrap();
                let trimmed_url = url_input.trim();
                if !trimmed_url.is_empty() {
                    exchange_url = trimmed_url.to_string();
                }

                print!("   请输入 Exchange API Bearer Token (可选): ");
                io::stdout().flush().unwrap();
                let mut token_input = String::new();
                io::stdin().read_line(&mut token_input).unwrap();
                exchange_token = token_input.trim().to_string();

                save_exchange_config(app_dir, &exchange_url, &exchange_token);
                println!("   ✅ Exchange 端点已保存: {}", exchange_url);
            }
            "3" => {
                if selected_tools.is_empty() {
                    println!("\n⚠️ 尚未勾选任何组件。请先在菜单 [1] 中选择要安装的组件。");
                    continue;
                }
                deploy_selected_tools(
                    app_dir,
                    &selected_tools,
                    &exchange_url,
                    &exchange_token,
                    true,
                );
            }
            "4" => {
                show_system_status(app_dir);
            }
            "5" => {
                perform_clean_uninstall(app_dir, false);
            }
            "6" => {
                println!("\n🎉 感谢使用 Cyrene Installer。配置已就绪！");
                break;
            }
            _ => {
                println!("无效选项，请输入 1 到 6。");
            }
        }
    }
}

fn menu_select_tools(selected: &mut BTreeSet<usize>) {
    loop {
        println!("\n--- [ 可用组件与服务列表 ] ---");
        for (idx, tool) in TOOLS.iter().enumerate() {
            let status = if selected.contains(&idx) {
                "[x] 已勾选"
            } else {
                "[ ] 未勾选"
            };
            let port_info = match tool.port {
                Some(p) => format!("(端口: {})", p),
                None => "(本地进程/运行时)".to_string(),
            };
            println!("  {}. {} {} {}", idx + 1, status, tool.title, port_info);
            if let Some(img) = tool.image {
                println!("     容器镜像: {}", img);
            }
            println!("     说明: {}", tool.desc);
        }
        println!("\n快捷操作: A. 全选所有组件 | C. 清空选择 | B. 确定并返回");
        print!("\n请输入编号切换勾选，或输入 A/C/B: ");
        io::stdout().flush().unwrap();

        let mut input = String::new();
        io::stdin().read_line(&mut input).unwrap();
        let cmd = input.trim();

        if cmd.eq_ignore_ascii_case("b") {
            break;
        } else if cmd.eq_ignore_ascii_case("a") {
            for i in 0..TOOLS.len() {
                selected.insert(i);
            }
            println!("✅ 已全选所有组件。");
        } else if cmd.eq_ignore_ascii_case("c") {
            selected.clear();
            println!("✅ 已清空选中的组件。");
        } else if let Ok(num) = cmd.parse::<usize>() {
            if num >= 1 && num <= TOOLS.len() {
                let tool_idx = num - 1;
                if selected.contains(&tool_idx) {
                    selected.remove(&tool_idx);
                    println!("➖ 取消勾选: {}", TOOLS[tool_idx].id);
                } else {
                    selected.insert(tool_idx);
                    println!("➕ 已勾选: {}", TOOLS[tool_idx].id);
                }
            } else {
                println!("请输入 1 到 {} 之间的数字", TOOLS.len());
            }
        }
    }
}

fn deploy_selected_tools(
    app_dir: &Path,
    selected: &BTreeSet<usize>,
    exchange_url: &str,
    exchange_token: &str,
    interactive: bool,
) {
    let _update_lock = match acquire_service_update_lock(app_dir) {
        Ok(lock) => lock,
        Err(error) => {
            eprintln!("\n❌ 无法取得部署锁，未修改 Compose 或容器: {error}");
            return;
        }
    };
    if let Err(error) = recover_interrupted_update(app_dir) {
        eprintln!("\n❌ 无法恢复上次未完成的服务更新，已取消部署: {error}");
        return;
    }

    println!("\n============================================================");
    println!("  开始部署所选组件 / Deploying Selected Components          ");
    println!("============================================================");

    // 1. Check if Navigator is selected
    if selected.contains(&0) {
        println!("\n>> [1/2] 正在配置 Navigator 本地 Agent 环境...");
        setup_agent_core(app_dir, exchange_url, exchange_token);
    }

    // 2. Filter container services
    let container_indices: Vec<usize> = selected
        .iter()
        .copied()
        .filter(|&idx| matches!(TOOLS[idx].kind, ToolKind::ContainerService))
        .collect();

    if container_indices.is_empty() {
        println!("\n✅ 本地环境配置已完成 (未选择远程容器服务)。");
        return;
    }

    println!(
        "\n>> [2/2] 正在编排 {} 个后端容器服务...",
        container_indices.len()
    );
    let catalog = match component_catalog::trusted_catalog() {
        Ok(catalog) => catalog,
        Err(error) => {
            eprintln!(
                "无法读取受信 Workspace component catalog；拒绝生成 Product Compose: {error}"
            );
            return;
        }
    };
    let broker_candidate = match github_updates::discover_windows_candidate(
        app_dir,
        &catalog,
        component_catalog::WINDOWS_MAINTENANCE_COMPONENT_ID,
        "stable",
    ) {
        Ok(Some(candidate)) => candidate,
        Ok(None) => {
            eprintln!("当前没有带可信 manifest 与 GitHub attestation 的不可变维护 broker release；拒绝生成可运行的 Product Compose。不会使用 latest 或占位 digest。");
            return;
        }
        Err(error) => {
            eprintln!("无法验证维护 broker release；拒绝生成 Product Compose: {error}");
            return;
        }
    };
    let broker_image = broker_candidate.verified.image_reference.clone();
    if let Err(error) = run_docker_status(
        &["pull".to_string(), broker_image.clone()],
        "下载经过验证的 runtime maintenance broker",
    ) {
        eprintln!("{error}");
        return;
    }

    let compose_file = app_dir.join("docker-compose.yml");
    let content = generate_docker_compose(&container_indices, &broker_image);
    fs::create_dir_all(app_dir).unwrap();
    fs::write(&compose_file, &content).expect("Failed to write docker-compose.yml");
    println!("   📄 已生成部署配置: {}", compose_file.display());

    println!("\n>> 正在检查本地 Docker 守护进程...");
    let docker_check = docker_command().arg("info").output();
    match docker_check {
        Ok(out) if out.status.success() => {
            println!("   ✅ Docker 正在运行。");
            let should_run = if interactive {
                print!("   是否立即拉取并启动服务容器？ (y/n): ");
                io::stdout().flush().unwrap();
                let mut run_now = String::new();
                io::stdin().read_line(&mut run_now).unwrap_or_default();
                run_now.trim().eq_ignore_ascii_case("y")
            } else {
                false
            };

            if should_run {
                if let Err(error) = initialize_runtime_maintenance_with_image(
                    app_dir,
                    &broker_image,
                    &container_indices
                        .iter()
                        .map(|index| format!("cyrene-{}", TOOLS[*index].id))
                        .collect::<Vec<_>>(),
                ) {
                    eprintln!("\n维护 broker 初始化或 Product 启动失败: {error}");
                } else {
                    println!("\n🚀 所选服务已完成 source provisioning 并启动！");
                }
            } else if !interactive {
                println!(
                    "   ℹ️ 已生成带 digest pin 的部署清单。运行 `{}` --initialize-runtime-maintenance 完成 broker source provisioning 后启动 Product。",
                    env::current_exe().unwrap_or_else(|_| PathBuf::from("installer.exe")).display()
                );
            } else {
                println!("   ℹ️ Compose 已固定到经过验证的 broker digest。稍后启动前请运行 installer.exe --initialize-runtime-maintenance。" );
            }
        }
        _ => {
            println!("   ℹ️ 本地未检测到运行中的 Docker 守护进程。");
            println!("   生成文件位于: {}", compose_file.display());
            println!("   安装/启动 Docker 后，可在该目录执行: docker compose up -d");
        }
    }
}

fn generate_docker_compose(indices: &[usize], broker_image: &str) -> String {
    let mut out = String::from("services:\n  cyrene-runtime-maintenance:\n");
    out.push_str(&format!("    image: {broker_image}\n"));
    out.push_str("    container_name: cyrene-runtime-maintenance\n");
    out.push_str("    restart: unless-stopped\n");
    out.push_str("    volumes:\n");
    out.push_str("      - ./runtime-maintenance/state:/var/lib/cyrene/runtime\n");
    out.push_str(
        "      - cyrene-runtime-maintenance-private:/var/lib/cyrene/runtime-maintenance-private\n",
    );
    out.push_str("      - cyrene-runtime-maintenance-socket:/run/cyrene\n\n");
    for &idx in indices {
        let tool = &TOOLS[idx];
        if let (Some(img), Some(port)) = (tool.image, tool.port) {
            out.push_str(&format!("  cyrene-{}:\n", tool.id));
            out.push_str(&format!("    image: {}\n", img));
            out.push_str(&format!("    container_name: cyrene-{}\n", tool.id));
            out.push_str("    restart: unless-stopped\n");
            out.push_str("    ports:\n");
            out.push_str(&format!("      - \"{}:{}\"\n", port, port));
            out.push_str("    volumes:\n");
            out.push_str(&format!("      - ./data/{}:/data\n", tool.id));
            out.push_str("      - type: bind\n");
            out.push_str(&format!(
                "        source: ./runtime-maintenance/state/source-tokens/cyrene-{}.token\n",
                tool.id
            ));
            out.push_str("        target: /run/secrets/cyrene-runtime-activity-token\n");
            out.push_str("        read_only: true\n");
            out.push_str("        bind:\n          create_host_path: false\n");
            out.push_str("      - cyrene-runtime-maintenance-socket:/run/cyrene:ro\n");
            out.push_str("    environment:\n");
            out.push_str(&format!(
                "      CYRENE_RUNTIME_ACTIVITY_SOURCE_ID: cyrene-{}\n",
                tool.id
            ));
            out.push_str("      CYRENE_RUNTIME_ACTIVITY_SOURCE_TOKEN_FILE: /run/secrets/cyrene-runtime-activity-token\n");
            out.push_str("      CYRENE_RUNTIME_ACTIVITY_CATALOG_GENERATION: ${CYRENE_RUNTIME_ACTIVITY_CATALOG_GENERATION:-0}\n");
            out.push_str(
                "      CYRENE_RUNTIME_MAINTENANCE_SOCKET: /run/cyrene/runtime-maintenance.sock\n\n",
            );
        }
    }
    out.push_str(
        "volumes:\n  cyrene-runtime-maintenance-private:\n  cyrene-runtime-maintenance-socket:\n",
    );
    out
}

fn initialize_runtime_maintenance_from_compose(app_dir: &Path) -> Result<(), String> {
    ensure_update_operator()?;
    let _lock = acquire_service_update_lock(app_dir)?;
    recover_interrupted_update(app_dir)?;
    let catalog = component_catalog::trusted_catalog()?;
    let compose_file = app_dir.join("docker-compose.yml");
    let compose = fs::read_to_string(&compose_file)
        .map_err(|error| format!("无法读取 Compose 配置 {}: {error}", compose_file.display()))?;
    let configured_broker = compose_service_image(&compose, "cyrene-runtime-maintenance")?;
    let candidate = github_updates::discover_windows_candidate(
        app_dir,
        &catalog,
        component_catalog::WINDOWS_MAINTENANCE_COMPONENT_ID,
        "stable",
    )?
    .ok_or_else(|| "没有可验证的 immutable runtime-maintenance release；不会启动未验证或 mutable broker image。".to_string())?;
    if candidate.verified.image_reference != configured_broker {
        return Err(format!(
            "Compose 中 broker image `{configured_broker}` 与当前受信 release `{}` 不匹配；请重新生成 Compose。",
            candidate.verified.image_reference
        ));
    }
    initialize_runtime_maintenance_with_image(
        app_dir,
        &configured_broker,
        &compose_product_services(&compose),
    )
}

fn initialize_runtime_maintenance_with_image(
    app_dir: &Path,
    broker_image: &str,
    product_services: &[String],
) -> Result<(), String> {
    ensure_update_operator()?;
    let compose_file = app_dir.join("docker-compose.yml");
    let compose_path = compose_file.to_string_lossy().into_owned();
    let compose = fs::read_to_string(&compose_file)
        .map_err(|error| format!("无法读取 Compose 配置 {}: {error}", compose_file.display()))?;
    if compose_service_image(&compose, "cyrene-runtime-maintenance")? != broker_image {
        return Err("Compose broker image 与已经验证的 immutable digest 不一致。".to_string());
    }
    let (repository, digest) = broker_image.rsplit_once('@').ok_or_else(|| {
        "runtime-maintenance broker image 必须固定为 repository@sha256 digest。".to_string()
    })?;
    if repository != "ghcr.io/dohorizon-ai/cyrene-runtime-maintenance"
        || !release_update::is_digest(digest)
    {
        return Err(
            "runtime-maintenance broker image 不符合受信 catalog 的 OCI identity。".to_string(),
        );
    }
    fs::create_dir_all(app_dir.join("runtime-maintenance").join("state"))
        .map_err(|error| format!("无法创建 runtime-maintenance 持久目录: {error}"))?;

    if docker_container_exists("cyrene-runtime-maintenance")? {
        let (_, installed_digest) = installed_runtime_broker_identity(app_dir)?;
        if installed_digest != digest {
            return Err("已存在的维护 broker 与受信 Compose digest 不一致；初始化不会隐式升级或重启 broker。".to_string());
        }
    } else {
        run_docker_status(
            &[
                "compose".to_string(),
                "-f".to_string(),
                compose_path.clone(),
                "up".to_string(),
                "-d".to_string(),
                "cyrene-runtime-maintenance".to_string(),
            ],
            "启动维护 broker",
        )?;
    }
    wait_for_container_health("cyrene-runtime-maintenance", Duration::from_secs(90))?;

    let mut args = vec![
        "exec".to_string(),
        "-u".to_string(),
        "0:0".to_string(),
        "-i".to_string(),
        "cyrene-runtime-maintenance".to_string(),
        "cyrene-runtime-maintenance".to_string(),
        "init-catalog".to_string(),
        "--catalog".to_string(),
        "/var/lib/cyrene/runtime/activity-sources.json".to_string(),
        "--token-dir".to_string(),
        "/var/lib/cyrene/runtime/source-tokens".to_string(),
    ];
    for source_id in maintenance::PRODUCT_ACTIVITY_SOURCES {
        args.push("--source".to_string());
        args.push(format!("{source_id}=0:0"));
    }
    let (status, stdout, stderr) =
        run_bounded_command(args, Duration::from_secs(60), 262_144, 65_536)?;
    if !status.success() {
        return Err(format!(
            "broker init-catalog 拒绝 source provisioning: {}",
            String::from_utf8_lossy(&stderr).trim()
        ));
    }
    let response: serde_json::Value = serde_json::from_slice(&stdout)
        .map_err(|error| format!("init-catalog 返回 JSON 无效: {error}"))?;
    if response
        .get("schema_version")
        .and_then(serde_json::Value::as_u64)
        != Some(1)
    {
        return Err("init-catalog schema_version 不受支持。".to_string());
    }
    let generation = response
        .get("generation")
        .and_then(serde_json::Value::as_u64)
        .filter(|generation| *generation > 0)
        .ok_or_else(|| "init-catalog 没有返回有效 generation。".to_string())?;
    validate_init_catalog_sources(&response)?;
    let activity_catalog_path = app_dir
        .join("runtime-maintenance")
        .join("state")
        .join("activity-sources.json");
    let activity_catalog_bytes = fs::read(&activity_catalog_path).map_err(|error| {
        format!("broker 初始化后 host-visible source catalog 不可读取: {error}")
    })?;
    let activity_catalog: serde_json::Value = serde_json::from_slice(&activity_catalog_bytes)
        .map_err(|error| format!("host-visible source catalog JSON 无效: {error}"))?;
    if activity_catalog["generation"].as_u64() != Some(generation)
        || activity_catalog["schema_version"].as_u64() != Some(1)
        || activity_catalog["sources"]
            .as_array()
            .map(|sources| sources.len())
            != Some(maintenance::PRODUCT_ACTIVITY_SOURCES.len())
    {
        return Err(
            "host-visible source catalog 与 broker init-catalog response 不一致；Apply 保持禁用。"
                .to_string(),
        );
    }
    let dot_env = format!("CYRENE_RUNTIME_ACTIVITY_CATALOG_GENERATION={generation}\n");
    atomic_write(&app_dir.join(".env"), dot_env.as_bytes())?;

    let mut selected = Vec::new();
    for service in product_services {
        if !maintenance::PRODUCT_ACTIVITY_SOURCES.contains(&service.as_str()) {
            return Err(format!(
                "Compose service `{service}` 不在 Product source allowlist 中。"
            ));
        }
        if compose_service_image(&compose, service).is_err() {
            return Err(format!("Product service `{service}` 不在 Compose 配置中。"));
        }
        if !docker_container_exists(service)? {
            selected.push(service.clone());
        }
    }
    let newly_created_count = selected.len();
    if !selected.is_empty() {
        let mut command_args = vec![
            "compose".to_string(),
            "-f".to_string(),
            compose_path,
            "up".to_string(),
            "-d".to_string(),
            "--no-deps".to_string(),
        ];
        command_args.extend(selected);
        run_docker_status(&command_args, "启动新建的 Product 容器")?;
    }
    if newly_created_count < product_services.len() {
        eprintln!("保留已存在的 Product 容器原状。旧版镜像若未接入活动 SDK，readiness 会保持 UNKNOWN；需在受控维护窗口中确认无未结束任务后部署带 SDK 的镜像，更新流程不会绕过此门禁。" );
    }
    Ok(())
}

fn docker_container_exists(container_name: &str) -> Result<bool, String> {
    if container_name.is_empty()
        || !container_name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
    {
        return Err("容器名称不符合固定本机 allowlist 格式。".to_string());
    }
    let filter = format!("name=^/{container_name}$");
    let output = docker_command()
        .args([
            "container",
            "ls",
            "--all",
            "--filter",
            filter.as_str(),
            "--format",
            "{{.Names}}",
        ])
        .output()
        .map_err(|error| format!("无法检查本机容器 `{container_name}`: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "无法检查本机容器 `{container_name}`: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.lines().any(|line| line.trim() == container_name))
}

fn validate_init_catalog_sources(response: &serde_json::Value) -> Result<(), String> {
    let sources = response
        .get("sources")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "init-catalog response 缺少 sources。".to_string())?;
    let mut source_ids = sources
        .iter()
        .map(|source| {
            let source_id = source
                .get("source_id")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| "init-catalog response source 缺少 source_id。".to_string())?;
            let token_file = source
                .get("token_file")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| format!("init-catalog response `{source_id}` 缺少 token_file。"))?;
            if !token_file.starts_with("/var/lib/cyrene/runtime/source-tokens/")
                || token_file.contains("..")
                || !token_file.ends_with(&format!("/{source_id}.token"))
            {
                return Err(format!(
                    "init-catalog response `{source_id}` token_file 路径不符合固定 broker 目录。"
                ));
            }
            Ok(source_id.to_string())
        })
        .collect::<Result<Vec<_>, String>>()?;
    source_ids.sort();
    let mut expected = maintenance::PRODUCT_ACTIVITY_SOURCES
        .iter()
        .map(|source| source.to_string())
        .collect::<Vec<_>>();
    expected.sort();
    if source_ids != expected {
        return Err(format!(
            "broker source provisioning 未返回完整五个 Product sources: {source_ids:?}"
        ));
    }
    Ok(())
}

fn compose_product_services(compose: &str) -> Vec<String> {
    maintenance::PRODUCT_ACTIVITY_SOURCES
        .iter()
        .filter_map(|source| {
            compose_service_image(compose, source)
                .ok()
                .map(|_| source.to_string())
        })
        .collect()
}

fn run_bounded_command(
    args: Vec<String>,
    timeout: Duration,
    max_stdout: usize,
    max_stderr: usize,
) -> Result<(std::process::ExitStatus, Vec<u8>, Vec<u8>), String> {
    let mut child = docker_command()
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("无法启动 docker init-catalog: {error}"))?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "docker stdout pipe 不可用。".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "docker stderr pipe 不可用。".to_string())?;
    let stdout_reader = thread::spawn(move || read_pipe_bounded(&mut stdout, max_stdout));
    let stderr_reader = thread::spawn(move || read_pipe_bounded(&mut stderr, max_stderr));
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < timeout => thread::sleep(Duration::from_millis(50)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err("docker init-catalog 超时。".to_string());
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err(format!("无法检查 docker init-catalog 进程状态: {error}"));
            }
        }
    };
    let (stdout, stdout_overflow) = stdout_reader
        .join()
        .map_err(|_| "读取 init-catalog stdout 线程失败。".to_string())??;
    let (stderr, stderr_overflow) = stderr_reader
        .join()
        .map_err(|_| "读取 init-catalog stderr 线程失败。".to_string())??;
    if stdout_overflow || stderr_overflow {
        return Err("docker init-catalog 输出超过允许大小。".to_string());
    }
    Ok((status, stdout, stderr))
}

fn read_pipe_bounded(reader: &mut impl Read, limit: usize) -> Result<(Vec<u8>, bool), String> {
    let mut output = Vec::new();
    let mut overflow = false;
    let mut buffer = [0; 8192];
    loop {
        let count = reader
            .read(&mut buffer)
            .map_err(|error| format!("读取 docker 输出失败: {error}"))?;
        if count == 0 {
            break;
        }
        let retain = limit.saturating_sub(output.len()).min(count);
        output.extend_from_slice(&buffer[..retain]);
        overflow |= retain != count;
    }
    Ok((output, overflow))
}

fn setup_agent_core(app_dir: &Path, exchange_url: &str, exchange_token: &str) {
    let agent_dir = app_dir.join("agent");
    fs::create_dir_all(&agent_dir).unwrap();

    let config = serde_json::json!({
        "agent": {
            "name": "Cyrene-Navigator-DeepSeek-Agent",
            "version": "0.1.0",
            "harness": "deepseek-enhanced-v1",
            "execution_environment": "native-host"
        },
        "exchange": {
            "url": exchange_url,
            "api_key_configured": !exchange_token.is_empty(),
            "chat_completions_endpoint": format!("{}/v1/chat/completions", exchange_url.trim_end_matches('/'))
        },
        "local_execution": {
            "native_host_binary": "cyrene-native-host.exe",
            "workspace": agent_dir.to_str().unwrap(),
            "allow_local_process": true
        }
    });

    let config_path = agent_dir.join("agent_config.json");
    fs::write(&config_path, serde_json::to_string_pretty(&config).unwrap()).unwrap();
    println!("   ✅ Agent 配置文件已就绪: {}", config_path.display());
    println!(
        "   ✅ 默认连接 Exchange 端点: {}/v1/chat/completions",
        exchange_url.trim_end_matches('/')
    );
}

fn save_exchange_config(app_dir: &Path, exchange_url: &str, exchange_token: &str) {
    let config = serde_json::json!({
        "exchange_url": exchange_url,
        "exchange_token": exchange_token,
        "updated_at": "2026-09-25T16:00:00Z"
    });
    fs::create_dir_all(app_dir).unwrap();
    fs::write(
        app_dir.join("exchange_credentials.json"),
        serde_json::to_string_pretty(&config).unwrap(),
    )
    .unwrap();
}

fn show_system_status(app_dir: &Path) {
    println!("\n--- [ Cyrene 系统与服务运行状态 ] ---");
    println!("📁 根目录: {}", app_dir.display());

    let creds = app_dir.join("exchange_credentials.json");
    if creds.exists() {
        println!("🔑 Exchange 凭据配置: 已存在");
    } else {
        println!("🔑 Exchange 凭据配置: 未配置 (使用默认端点)");
    }

    let agent_cfg = app_dir.join("agent/agent_config.json");
    if agent_cfg.exists() {
        println!("🤖 Navigator Agent 运行时: 已配置就绪");
    } else {
        println!("🤖 Navigator Agent 运行时: 未安装");
    }

    let compose_file = app_dir.join("docker-compose.yml");
    if compose_file.exists() {
        println!("📄 Docker Compose 编排文件: 已生成");
        println!("\n>> 正在查询 Docker 容器状态...");
        let ps = docker_command()
            .args(["compose", "-f", compose_file.to_str().unwrap(), "ps"])
            .output();
        if let Ok(out) = ps {
            let text = String::from_utf8_lossy(&out.stdout);
            if !text.trim().is_empty() {
                println!("{}", text);
            } else {
                println!("   (当前无运行中的容器)");
            }
        } else {
            println!("   (Docker 未运行或不可用)");
        }
    } else {
        println!("📄 Docker Compose 编排文件: 未生成");
    }
}

/// 执行完全干净的卸载
/// Complete clean uninstallation
fn perform_clean_uninstall(app_dir: &Path, force: bool) {
    let _update_lock = match acquire_service_update_lock(app_dir) {
        Ok(lock) => lock,
        Err(error) => {
            eprintln!("\n❌ 无法取得卸载锁，未停止或删除任何容器: {error}");
            return;
        }
    };
    if let Err(error) = recover_interrupted_update(app_dir) {
        eprintln!("\n❌ 无法恢复上次未完成的服务更新，已取消卸载: {error}");
        return;
    }

    println!("\n============================================================");
    println!("  Cyrene 完全干净卸载程序 / Clean Uninstaller               ");
    println!("============================================================");
    println!("此操作将完全清理本地 Cyrene 产生的所有环境与数据:");
    println!("  1. 停止并移除所有运行中的 Cyrene Docker 容器与数据卷");
    println!("  2. 删除本地 Agent 执行环境、工作区与日志");
    println!("  3. 删除 Exchange 凭据与配置文件");
    println!("  4. 彻底删除本地目录: {}", app_dir.display());

    if !force {
        print!("\n⚠️ 确认要执行完全卸载吗？此操作不可逆！(y/N): ");
        io::stdout().flush().unwrap();
        let mut confirm = String::new();
        if io::stdin().read_line(&mut confirm).is_err() || !confirm.trim().eq_ignore_ascii_case("y")
        {
            println!("❌ 卸载操作已取消。");
            return;
        }
    }

    println!("\n>> [1/3] 正在停止并移除 Docker 容器与卷...");
    let compose_file = app_dir.join("docker-compose.yml");
    if compose_file.exists() {
        let _ = docker_command()
            .args([
                "compose",
                "-f",
                compose_file.to_str().unwrap(),
                "down",
                "-v",
                "--remove-orphans",
            ])
            .status();
        println!("   ✅ 已停止并移除 docker compose 容器与数据卷。");
    } else {
        // Fallback: stop individual known containers
        for tool in TOOLS {
            if matches!(tool.kind, ToolKind::ContainerService) {
                let cname = format!("cyrene-{}", tool.id);
                let _ = docker_command().args(["stop", &cname]).output();
                let _ = docker_command().args(["rm", "-v", &cname]).output();
            }
        }
        println!("   ✅ 已检查并清理可能存在的 Cyrene 独立容器。");
    }

    println!("\n>> [2/3] 正在清理本地配置文件、凭据与环境缓存...");
    if app_dir.exists() {
        match fs::remove_dir_all(app_dir) {
            Ok(_) => {
                println!("   ✅ 已彻底删除目录: {}", app_dir.display());
            }
            Err(e) => {
                println!(
                    "   ⚠️ 部分文件删除遇到错误 ({}): 请手动检查 {}",
                    e,
                    app_dir.display()
                );
            }
        }
    } else {
        println!("   ✅ 本地目录不存在，无需清理。");
    }

    println!("\n>> [3/3] 验证清理结果...");
    let cleaned = !app_dir.exists();
    if cleaned {
        println!("   ✅ 本地文件已完全清除，未留任何残留。");
    }

    println!("\n🎉 Cyrene 卸载完成！系统已恢复完全干净状态。");
}

fn run_silent(args: &[String], app_dir: &Path) {
    let mut exchange_url = get_default_exchange_url();
    let mut exchange_token = String::new();

    for i in 0..args.len() {
        if args[i] == "--exchange-url" && i + 1 < args.len() {
            exchange_url = args[i + 1].clone();
        }
        if args[i] == "--exchange-token" && i + 1 < args.len() {
            exchange_token = args[i + 1].clone();
        }
    }

    save_exchange_config(app_dir, &exchange_url, &exchange_token);

    let mut selected: BTreeSet<usize> = BTreeSet::new();
    for i in 0..args.len() {
        if args[i] == "--deploy-tools" && i + 1 < args.len() {
            let val = &args[i + 1];
            if val == "all" {
                for t in 0..TOOLS.len() {
                    selected.insert(t);
                }
            } else {
                for item in val.split(',') {
                    let name = item.trim();
                    if let Some(pos) = TOOLS.iter().position(|t| t.id == name) {
                        selected.insert(pos);
                    }
                }
            }
        }
    }

    if !selected.is_empty() {
        deploy_selected_tools(app_dir, &selected, &exchange_url, &exchange_token, false);
    }

    println!("Silent installation completed successfully.");
}

fn get_cyrene_home() -> PathBuf {
    if let Ok(val) = env::var("CYRENE_HOME") {
        PathBuf::from(val)
    } else if let Ok(val) = env::var("LOCALAPPDATA") {
        PathBuf::from(val).join("Cyrene")
    } else if let Ok(val) = env::var("HOME") {
        PathBuf::from(val).join(".cyrene")
    } else {
        PathBuf::from("./cyrene_data")
    }
}

#[cfg(test)]
mod tests {
    use super::{
        acquire_service_update_lock, derived_maintenance_end_request_id,
        finish_definitive_begin_refusal, generate_docker_compose, runtime_broker_version_range,
        validate_init_catalog_sources, version_satisfies_range, ToolKind, TOOLS,
    };
    use std::path::PathBuf;

    fn pending_journal_path(test_name: &str) -> PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir()
            .join(format!(
                "cyrene-update-intent-{test_name}-{}-{nonce}",
                std::process::id()
            ))
            .join("service-update-in-progress.json")
    }

    #[test]
    fn maintenance_end_request_id_is_stable_for_journal_recovery() {
        let first = derived_maintenance_end_request_id("begin-123-abc");
        let retry = derived_maintenance_end_request_id("begin-123-abc");
        let other_update = derived_maintenance_end_request_id("begin-123-def");

        assert_eq!(first, retry);
        assert_ne!(first, other_update);
        assert!(first.starts_with("end-"));
        assert_eq!(first.len(), 36);
    }

    #[test]
    fn stale_or_busy_begin_refusal_clears_intent_so_the_same_plan_can_retry() {
        let plan_id = "plan-0123456789abcdef0123456789abcdef";
        for status in ["STALE_READINESS", "ACTIVE_TASKS", "UNKNOWN"] {
            let journal_path = pending_journal_path(status);
            let parent = journal_path.parent().expect("test journal parent");
            std::fs::create_dir_all(parent).expect("create test journal directory");
            let plan_digest =
                "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
            let plans_dir = super::update_plans_dir(parent);
            std::fs::create_dir_all(&plans_dir).expect("create test plan directory");
            let plan_path = plans_dir.join(format!("{plan_id}.json"));
            std::fs::write(
                &plan_path,
                serde_json::to_vec(&serde_json::json!({
                    "schemaVersion": 1,
                    "planId": plan_id,
                    "planDigest": plan_digest,
                    "channel": "stable",
                    "phase": "applying",
                    "components": [{
                        "componentId": "cyrene-yield",
                        "version": "0.1.0",
                        "manifestDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                        "artifactDigest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                        "restartGroup": "single-service",
                        "indexJson": "{}",
                        "manifestJson": "{}"
                    }]
                }))
                .expect("serialize applying plan"),
            )
            .expect("write applying plan");
            let pending = serde_json::json!({
                "schemaVersion": 1,
                "serviceId": "cyrene-yield",
                "previousImage": "ghcr.io/dohorizon-ai/cyrene-yield@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
                "candidateImage": "ghcr.io/dohorizon-ai/cyrene-yield@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                "planId": plan_id,
                "planDigest": plan_digest,
                "componentArtifactDigests": {},
                "maintenanceToken": null,
                "maintenanceRequestId": "begin-stable-retry",
                "maintenanceEndRequestId": "end-stable-retry",
                "expectedGateGeneration": 42,
                "expectedCatalogGeneration": 12,
                "phase": "maintenance_pending",
                "userConfirmedRestart": true
            });
            std::fs::write(
                &journal_path,
                serde_json::to_vec(&pending).expect("serialize pending journal"),
            )
            .expect("write pending update journal");

            let refusal = format!("MAINTENANCE_REJECTED:{status}: UPDATE_READINESS_BLOCKED");
            finish_definitive_begin_refusal(parent, &journal_path, &refusal)
                .expect("clear an explicitly rejected Begin intent");
            assert!(
                !journal_path.exists(),
                "{status} must permit retrying the same plan"
            );
            let retry_plan: serde_json::Value =
                serde_json::from_slice(&std::fs::read(&plan_path).expect("read retry plan"))
                    .expect("parse retry plan");
            assert_eq!(retry_plan["phase"], "staged");
            assert_eq!(retry_plan["planId"], plan_id);
            assert_eq!(retry_plan["planDigest"], plan_digest);
            std::fs::remove_dir_all(parent).expect("remove test journal directory");
        }
    }

    #[test]
    fn missing_persisted_plan_keeps_definitive_refusal_journal() {
        let journal_path = pending_journal_path("missing-plan");
        let app_dir = journal_path.parent().expect("test journal parent");
        std::fs::create_dir_all(app_dir).expect("create test journal directory");
        let pending = serde_json::json!({
            "schemaVersion": 1,
            "serviceId": "cyrene-yield",
            "previousImage": "old",
            "candidateImage": "new",
            "planId": "plan-0123456789abcdef0123456789abcdef",
            "planDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "componentArtifactDigests": {},
            "maintenanceToken": null,
            "maintenanceRequestId": "begin-missing-plan",
            "maintenanceEndRequestId": "end-missing-plan",
            "expectedGateGeneration": 42,
            "expectedCatalogGeneration": 12,
            "phase": "maintenance_pending",
            "userConfirmedRestart": true
        });
        std::fs::write(
            &journal_path,
            serde_json::to_vec(&pending).expect("serialize pending journal"),
        )
        .expect("write pending update journal");

        let result = finish_definitive_begin_refusal(
            app_dir,
            &journal_path,
            "MAINTENANCE_REJECTED:UNKNOWN: UPDATE_READINESS_BLOCKED",
        );
        assert!(
            result.is_err(),
            "missing controlled plan must remain fail-closed"
        );
        assert!(
            journal_path.exists(),
            "recovery journal must remain durable"
        );
        std::fs::remove_dir_all(app_dir).expect("remove test journal directory");
    }

    #[test]
    fn unrecognized_begin_response_and_transport_errors_keep_pending_intent() {
        for (test_name, error) in [
            (
                "unknown-status",
                "BeginMaintenance result status `FUTURE_STATUS` is not recognized",
            ),
            (
                "broker-error",
                "MAINTENANCE_BROKER_ERROR:UPDATE_READINESS_UNKNOWN: timeout",
            ),
            (
                "transport-error",
                "维护 broker 请求超时；运行状态按 UNKNOWN 处理。",
            ),
        ] {
            let journal_path = pending_journal_path(test_name);
            let parent = journal_path.parent().expect("test journal parent");
            std::fs::create_dir_all(parent).expect("create test journal directory");
            let pending = serde_json::json!({
                "schemaVersion": 1,
                "serviceId": "cyrene-yield",
                "previousImage": "old",
                "candidateImage": "new",
                "planId": null,
                "planDigest": null,
                "componentArtifactDigests": {},
                "maintenanceToken": null,
                "maintenanceRequestId": "begin-unknown-test",
                "maintenanceEndRequestId": null,
                "expectedGateGeneration": 42,
                "expectedCatalogGeneration": 12,
                "phase": "maintenance_pending",
                "userConfirmedRestart": true
            });
            std::fs::write(
                &journal_path,
                serde_json::to_vec(&pending).expect("serialize pending journal"),
            )
            .expect("write pending update journal");

            finish_definitive_begin_refusal(parent, &journal_path, error)
                .expect("indeterminate errors must not alter the update journal");
            assert!(
                journal_path.exists(),
                "{test_name} must keep recovery evidence"
            );
            std::fs::remove_dir_all(parent).expect("remove test journal directory");
        }
    }

    #[test]
    fn update_lock_serializes_mutating_helper_requests() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let temp_dir =
            std::env::temp_dir().join(format!("cyrene-update-lock-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&temp_dir).expect("create temp directory");
        let app_dir = temp_dir.join("app");

        let first = acquire_service_update_lock(&app_dir).expect("first update lock");
        assert!(acquire_service_update_lock(&app_dir).is_err());
        drop(first);
        let after_release = acquire_service_update_lock(&app_dir).expect("released update lock");
        drop(after_release);
        std::fs::remove_dir_all(temp_dir).expect("remove temp directory");
    }

    #[test]
    fn broker_versions_must_satisfy_the_catalog_requirement() {
        assert!(version_satisfies_range("0.1.0", ">=0.1.0, <0.2.0"));
        assert!(version_satisfies_range("0.1.9", ">=0.1.0, <0.2.0"));
        assert!(!version_satisfies_range("0.2.0", ">=0.1.0, <0.2.0"));
        assert!(!version_satisfies_range(
            "0.1.0-preview.1",
            ">=0.1.0, <0.2.0"
        ));
        assert!(!version_satisfies_range("00.1.0", ">=0.1.0, <0.2.0"));
    }

    #[test]
    fn runtime_broker_dependency_must_be_explicit_in_the_manifest() {
        let manifest = serde_json::json!({
            "dependencies": [{
                "componentId": "cyrene-runtime-maintenance",
                "versionRange": ">=0.1.0, <0.2.0"
            }]
        });
        assert_eq!(
            super::runtime_broker_version_range(&manifest).expect("runtime dependency"),
            ">=0.1.0, <0.2.0"
        );

        let missing = serde_json::json!({"dependencies": []});
        assert!(runtime_broker_version_range(&missing).is_err());
    }

    #[test]
    fn source_provisioning_requires_the_exact_five_product_sources() {
        let sources = [
            "cyrene-catalyst",
            "cyrene-echo",
            "cyrene-exchange",
            "cyrene-reactor",
            "cyrene-yield",
        ]
        .iter()
        .map(|source| {
            serde_json::json!({
                "source_id": source,
                "token_file": format!("/var/lib/cyrene/runtime/source-tokens/{source}.token")
            })
        })
        .collect::<Vec<_>>();
        let response = serde_json::json!({ "sources": sources });
        assert!(validate_init_catalog_sources(&response).is_ok());

        let incomplete = serde_json::json!({"sources": []});
        assert!(validate_init_catalog_sources(&incomplete).is_err());
    }

    #[test]
    fn generated_compose_does_not_mount_broker_private_state_into_products() {
        let indices = TOOLS
            .iter()
            .enumerate()
            .filter_map(|(index, tool)| {
                matches!(tool.kind, ToolKind::ContainerService).then_some(index)
            })
            .collect::<Vec<_>>();
        let compose = generate_docker_compose(
            &indices,
            "ghcr.io/dohorizon-ai/cyrene-runtime-maintenance@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        );
        assert!(compose.contains(
            "cyrene-runtime-maintenance-private:/var/lib/cyrene/runtime-maintenance-private"
        ));
        assert!(compose.contains("cyrene-runtime-maintenance-socket:/run/cyrene:ro"));
        assert!(!compose.contains("./runtime-maintenance/state/source-tokens:"));
        assert_eq!(
            compose
                .matches("cyrene-runtime-maintenance-private")
                .count(),
            2
        );
    }
}
