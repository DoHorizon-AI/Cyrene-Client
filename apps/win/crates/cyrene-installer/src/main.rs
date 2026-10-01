//! ┌─────────────────────────────────────────────────────────────────────┐
//! │  📄 main.rs                                                          │
//! │  Module: installer                                                   │
//! │  Role: Cyrene Modular Installer, Orchestrator & Clean Uninstaller   │
//! │  模块职责：Cyrene 统一模块化安装器、服务编排器与干净卸载工具。     │
//! └─────────────────────────────────────────────────────────────────────┘

use std::collections::BTreeSet;
use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use fs2::FileExt;
use serde::{Deserialize, Serialize};

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
    println!("  --generate-compose <PATH> 生成统一 docker-compose.yml 部署清单");
    println!("  -h, --help              显示帮助信息\n");
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServiceUpdateManifest {
    schema_version: u32,
    service_id: String,
    version: String,
    source_commit: String,
    image: ServiceImageManifest,
    platform: ServicePlatformManifest,
}

#[derive(Deserialize)]
struct ServiceImageManifest {
    repository: String,
    digest: String,
}

#[derive(Deserialize)]
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

    let _update_lock = acquire_service_update_lock(app_dir)?;
    recover_interrupted_update(app_dir)?;

    let expected_repository = tool
        .image_repository
        .ok_or_else(|| format!("服务 `{}` 未配置规范镜像仓库。", tool.id))?;
    let expected_manifest_id = format!("cyrene-{}", tool.id);
    let manifest_text = fs::read_to_string(manifest_path)
        .map_err(|error| format!("无法读取清单 {}: {error}", manifest_path.display()))?;
    let manifest: ServiceUpdateManifest = serde_json::from_str(&manifest_text)
        .map_err(|error| format!("服务更新清单 JSON 无效: {error}"))?;

    validate_service_manifest(&manifest, &expected_manifest_id, expected_repository)?;
    ensure_manifest_matches_docker_platform(&manifest.platform)?;

    let compose_file = app_dir.join("docker-compose.yml");
    let compose_content = fs::read_to_string(&compose_file).map_err(|error| {
        format!(
            "未找到已安装服务的 Compose 清单 {}: {error}。请先通过安装器部署该服务。",
            compose_file.display()
        )
    })?;
    let compose_service = format!("cyrene-{}", tool.id);
    let candidate_image = format!("{}@{}", manifest.image.repository, manifest.image.digest);
    let candidate_compose =
        replace_compose_service_image(&compose_content, &compose_service, &candidate_image)?;
    let configured_image = compose_service_image(&compose_content, &compose_service)?;

    let container_name = format!("cyrene-{}", tool.id);
    let running_container = docker_inspect(&["container".to_string(), "inspect".to_string(), container_name.clone()])
        .map_err(|error| {
            format!(
                "目标容器 `{container_name}` 未安装或不可读取；请先部署并启动该服务。Docker 返回: {error}"
            )
        })?;
    let container_state = running_container
        .get("State")
        .and_then(|state| state.get("Status"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    if container_state != "running" {
        return Err(format!(
            "目标容器 `{container_name}` 当前状态为 `{container_state}`；为确保可回滚，请先启动该服务后再更新。"
        ));
    }

    let image_id = running_container
        .get("Image")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| format!("无法从容器 `{container_name}` 读取当前镜像 ID。"))?;
    let container_image = running_container
        .get("Config")
        .and_then(|config| config.get("Image"))
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| format!("无法从容器 `{container_name}` 读取当前镜像引用。"))?;
    let previous_image = immutable_repo_digest(image_id, &configured_image, container_image)?;

    println!("目标服务: {} ({})", tool.id, expected_manifest_id);
    println!(
        "候选版本: {} / {}",
        manifest.version, manifest.source_commit
    );
    println!("候选镜像: {candidate_image}");
    println!("当前镜像回滚点: {previous_image}");
    println!("\n>> 拉取候选 digest；其他服务不会被拉取或重启...");
    run_docker_status(
        &["pull".to_string(), candidate_image.clone()],
        "拉取候选镜像",
    )?;

    let journal = ServiceUpdateJournal {
        schema_version: 1,
        service_id: expected_manifest_id,
        previous_image: previous_image.clone(),
        candidate_image,
    };
    let journal_path = update_journal_path(app_dir);
    write_json_atomically(&journal_path, &journal).map_err(|error| {
        format!(
            "候选镜像已拉取，但无法记录回滚点 {}; 运行中的服务未修改: {error}",
            journal_path.display()
        )
    })?;

    if let Err(error) = atomic_write(&compose_file, candidate_compose.as_bytes()) {
        let journal_cleanup = fs::remove_file(&journal_path);
        let cleanup_note = journal_cleanup
            .err()
            .map(|cleanup_error| format!(" 回滚记录也未能清除: {cleanup_error}"))
            .unwrap_or_default();
        return Err(format!(
            "候选镜像已拉取，但无法原子更新 Compose 文件 {}; 运行中的服务未修改: {error}.{cleanup_note}",
            compose_file.display()
        ));
    }

    let compose_path = compose_file.to_string_lossy().into_owned();
    let update_result = run_compose_up(&compose_path, &compose_service)
        .and_then(|()| wait_for_container_health(&container_name, Duration::from_secs(90)));

    match update_result {
        Ok(()) => {
            fs::remove_file(&journal_path).map_err(|error| {
                format!(
                    "服务已通过健康检查，但无法清除回滚记录 {}: {error}。下次启动时将自动恢复到先前镜像。",
                    journal_path.display()
                )
            })?;
            println!("\n✅ {} 已更新并通过 Docker HEALTHCHECK。", tool.id);
            println!("   仅重建了目标容器；服务数据卷保持原样。\n");
            Ok(())
        }
        Err(update_error) => {
            eprintln!("\n⚠️ 候选版本未通过启动或健康检查: {update_error}");
            match rollback_service(
                &compose_file,
                &compose_path,
                &compose_service,
                &container_name,
                &journal_path,
                &previous_image,
            ) {
                Ok(()) => Err(format!(
                    "候选版本失败；已恢复目标服务到此前的不可变镜像并通过健康检查。原始错误: {update_error}"
                )),
                Err(rollback_error) => Err(format!(
                    "候选版本失败，且自动回滚未能完成。请检查 `{container_name}`。更新错误: {update_error}; 回滚错误: {rollback_error}"
                )),
            }
        }
    }
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
    Command::new("docker")
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
        fs::rename(&temporary_path, path).map_err(|error| {
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

fn recover_interrupted_update(app_dir: &Path) -> Result<(), String> {
    let journal_path = update_journal_path(app_dir);
    if !journal_path.exists() {
        return Ok(());
    }

    let journal_text = fs::read_to_string(&journal_path)
        .map_err(|error| format!("无法读取回滚记录 {}: {error}", journal_path.display()))?;
    let journal: ServiceUpdateJournal = serde_json::from_str(&journal_text)
        .map_err(|error| format!("回滚记录 JSON 无效: {error}"))?;
    if journal.schema_version != 1 {
        return Err(format!(
            "不支持回滚记录 schemaVersion={}。",
            journal.schema_version
        ));
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
    if is_candidate && Some(repository) != tool.image_repository {
        return Err(format!(
            "回滚记录中的候选仓库 `{repository}` 与服务规范仓库不匹配。"
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
    let status = Command::new("docker")
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
    journal_path: &Path,
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
    fs::remove_file(journal_path)
        .map_err(|error| format!("回滚已通过健康检查，但无法清除回滚记录: {error}"))?;
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
    let compose_file = app_dir.join("docker-compose.yml");
    let content = generate_docker_compose(&container_indices);
    fs::create_dir_all(app_dir).unwrap();
    fs::write(&compose_file, &content).expect("Failed to write docker-compose.yml");
    println!("   📄 已生成部署配置: {}", compose_file.display());

    println!("\n>> 正在检查本地 Docker 守护进程...");
    let docker_check = Command::new("docker").arg("info").output();
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
                println!("\n>> 正在执行 docker compose pull (从 GHCR 拉取容器镜像)...");
                let _ = Command::new("docker")
                    .args(["compose", "-f", compose_file.to_str().unwrap(), "pull"])
                    .status();

                println!("\n>> 正在执行 docker compose up -d (启动服务)...");
                let status = Command::new("docker")
                    .args(["compose", "-f", compose_file.to_str().unwrap(), "up", "-d"])
                    .status();
                if let Ok(st) = status {
                    if st.success() {
                        println!("\n🚀 所选服务已成功在后台启动！");
                    }
                }
            } else if !interactive {
                println!(
                    "   ℹ️ 静默模式：已生成部署清单。启动服务可运行: docker compose -f {} up -d",
                    compose_file.display()
                );
            }
        }
        _ => {
            println!("   ℹ️ 本地未检测到运行中的 Docker 守护进程。");
            println!("   生成文件位于: {}", compose_file.display());
            println!("   安装/启动 Docker 后，可在该目录执行: docker compose up -d");
        }
    }
}

fn generate_docker_compose(indices: &[usize]) -> String {
    let mut out = String::from("services:\n");
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
            out.push_str(&format!("      - ./data/{}:/data\n\n", tool.id));
        }
    }
    out
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
        let ps = Command::new("docker")
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
        let _ = Command::new("docker")
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
                let _ = Command::new("docker").args(["stop", &cname]).output();
                let _ = Command::new("docker").args(["rm", "-v", &cname]).output();
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
