//! ┌─────────────────────────────────────────────────────────────────────┐
//! │  📄 github_updates.rs                                                │
//! │  Module: installer::github_updates                                  │
//! │  Role: Discover, fetch, and verify catalog-pinned release assets.   │
//! │                                                                      │
//! │  模块职责：发现 GitHub Releases 并验证可信 index、manifest 和制品。    │
//! └─────────────────────────────────────────────────────────────────────┘

use crate::release_update::{
    validate_component_manifest_for_target, validate_immutable_manifest_uri,
    validate_release_index, validate_runtime_maintenance_sdk_labels, validate_windows_oci_manifest,
    validate_windows_oci_manifest_for_target, VerifiedComponentManifest, VerifiedOciManifest,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const GH_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_JSON_BYTES: usize = 8 * 1024 * 1024;
const MAX_STDERR_BYTES: usize = 64 * 1024;
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// Resolve GitHub CLI to its fixed Windows installation path for attestation checks.
pub(crate) fn github_command() -> Command {
    #[cfg(windows)]
    {
        Command::new(r"C:\Program Files\GitHub CLI\gh.exe")
    }
    #[cfg(not(windows))]
    {
        Command::new("gh")
    }
}

#[derive(Clone, Debug)]
pub struct ReleaseCandidate {
    pub index_json: String,
    pub manifest_json: String,
    pub verified: VerifiedOciManifest,
}

struct CommandCapture {
    status: ExitStatus,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

struct TempDirectory(PathBuf);

impl Drop for TempDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Discover the newest channel-eligible index and verified OCI release for one catalog component.
pub fn discover_windows_candidate(
    app_dir: &Path,
    catalog: &Value,
    component_id: &str,
    channel: &str,
) -> Result<Option<ReleaseCandidate>, String> {
    discover_windows_candidate_for_target(
        app_dir,
        catalog,
        component_id,
        channel,
        "windows-10.0-x86_64-docker-linux",
    )
}

/// Discover the newest channel-eligible candidate for a trusted Windows OCI target.
pub fn discover_windows_candidate_for_target(
    app_dir: &Path,
    catalog: &Value,
    component_id: &str,
    channel: &str,
    target_id: &str,
) -> Result<Option<ReleaseCandidate>, String> {
    if !matches!(channel, "stable" | "preview") {
        return Err("release channel 不受支持。".to_string());
    }
    let component = catalog_component(catalog, component_id)?;
    let publisher = component
        .get("publisher")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("catalog component `{component_id}` 缺少 publisher。"))?;
    let publisher_record = catalog
        .get("publishers")
        .and_then(Value::as_array)
        .and_then(|publishers| {
            publishers
                .iter()
                .find(|record| record.get("repository").and_then(Value::as_str) == Some(publisher))
        })
        .ok_or_else(|| format!("catalog publisher `{publisher}` 不存在。"))?;
    let api_uri = publisher_record["releaseDiscovery"]["apiUri"]
        .as_str()
        .ok_or_else(|| format!("catalog publisher `{publisher}` 缺少 release API URI。"))?;
    let endpoint = github_api_route(api_uri)?;
    let releases = fetch_release_list(&endpoint)?;
    if releases.is_empty() {
        return Ok(None);
    }
    let tag_prefix = component_release_tag_prefix(component, channel)?;
    let expected_prerelease = channel == "preview";
    let temporary = create_temp_directory(app_dir)?;

    for release in releases {
        let Some(tag_commit) = release_tag_commit(&release, tag_prefix.as_deref()) else {
            continue;
        };
        if release.get("draft").and_then(Value::as_bool) != Some(false)
            || release.get("prerelease").and_then(Value::as_bool) != Some(expected_prerelease)
        {
            continue;
        }
        let Some(asset) = release
            .get("assets")
            .and_then(Value::as_array)
            .and_then(|assets| {
                assets.iter().find(|asset| {
                    asset.get("name").and_then(Value::as_str)
                        == Some("component-release-index-v1.json")
                })
            })
        else {
            continue;
        };
        let asset_uri = asset
            .get("url")
            .and_then(Value::as_str)
            .ok_or_else(|| "GitHub release index asset 缺少 API URI。".to_string())?;
        let raw_index = fetch_release_asset(asset_uri, publisher)?;
        verify_api_asset_digest(asset, &raw_index)?;
        let index_json = String::from_utf8(raw_index)
            .map_err(|error| format!("release index 不是 UTF-8 JSON: {error}"))?;
        let index: Value = serde_json::from_str(&index_json)
            .map_err(|error| format!("release index JSON 無效: {error}"))?;
        validate_release_index(&index, catalog, publisher, channel)?;
        if tag_commit
            .as_deref()
            .is_some_and(|commit| index["source"]["commit"].as_str() != Some(commit))
        {
            continue;
        }
        let candidate_entry = index
            .get("releases")
            .and_then(Value::as_array)
            .and_then(|items| {
                items.iter().find(|entry| {
                    entry.get("componentId").and_then(Value::as_str) == Some(component_id)
                        && entry.get("target").is_some_and(|target| {
                            catalog_target(catalog, target_id) == Some(target)
                        })
                })
            });
        let Some(candidate_entry) = candidate_entry else {
            continue;
        };
        let manifest_uri = candidate_entry
            .get("manifestUri")
            .and_then(Value::as_str)
            .ok_or_else(|| "release index component entry 缺少 manifestUri。".to_string())?;
        validate_immutable_manifest_uri(manifest_uri, publisher)?;
        let manifest_json =
            fetch_release_manifest(app_dir, temporary.0.as_path(), manifest_uri, publisher)?;
        let verified = verify_candidate_bytes_for_target(
            catalog,
            &index_json,
            &manifest_json,
            component_id,
            channel,
            target_id,
        )?;
        return Ok(Some(ReleaseCandidate {
            index_json,
            manifest_json,
            verified,
        }));
    }
    Ok(None)
}

/// Resolve a first-adoption compatibility group through each member's own trusted publisher.
pub fn discover_windows_compatibility_group(
    app_dir: &Path,
    catalog: &Value,
    group_id: &str,
    channel: &str,
) -> Result<Vec<ReleaseCandidate>, String> {
    let group = catalog
        .get("compatibilityGroups")
        .and_then(Value::as_array)
        .and_then(|groups| {
            groups
                .iter()
                .find(|group| group.get("groupId").and_then(Value::as_str) == Some(group_id))
        })
        .ok_or_else(|| format!("compatibility group `{group_id}` 未在受信 catalog pin。"))?;
    let members = group
        .get("members")
        .and_then(Value::as_array)
        .filter(|members| !members.is_empty() && members.len() <= 100)
        .ok_or_else(|| format!("compatibility group `{group_id}` members 无效。"))?;
    let mut seen = std::collections::BTreeSet::new();
    let mut candidates = Vec::new();
    let mut expected_compatibility: Option<Value> = None;
    for member in members {
        let component_id = member
            .get("componentId")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("compatibility group `{group_id}` member 缺少 componentId。"))?;
        if !seen.insert(component_id.to_string()) {
            return Err(format!(
                "compatibility group `{group_id}` 重复 member `{component_id}`。"
            ));
        }
        let required = member
            .get("requiredForAdoption")
            .and_then(Value::as_bool)
            .ok_or_else(|| {
                format!("compatibility group `{group_id}` member requiredForAdoption 无效。")
            })?;
        let component = catalog_component(catalog, component_id)?;
        if component.get("compatibilityGroup").and_then(Value::as_str) != Some(group_id) {
            return Err(format!("catalog component `{component_id}` 与 compatibility group `{group_id}` 交叉声明不一致。"));
        }
        if !required {
            continue;
        }
        let windows_targets = component
            .get("targets")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|target| {
                target.get("support").and_then(Value::as_str) == Some("supported")
                    && target.get("artifactKind").and_then(Value::as_str) == Some("oci-image")
                    && target
                        .get("targetId")
                        .and_then(Value::as_str)
                        .and_then(|target_id| catalog_target(catalog, target_id))
                        .is_some_and(|target| {
                            target.get("os").and_then(Value::as_str) == Some("windows")
                                && target.get("runtime").and_then(Value::as_str)
                                    == Some("docker-desktop:linux")
                        })
            })
            .collect::<Vec<_>>();
        if windows_targets.len() != 1 {
            return Err(format!("required compatibility member `{component_id}` 没有唯一受支持的 Windows Docker OCI target。"));
        }
        let target_id = windows_targets[0]["targetId"].as_str().ok_or_else(|| {
            format!("required compatibility member `{component_id}` targetId 无效。")
        })?;
        let candidate = discover_windows_candidate_for_target(
            app_dir,
            catalog,
            component_id,
            channel,
            target_id,
        )?
        .ok_or_else(|| format!("required compatibility member `{component_id}` 没有已验证的 `{channel}` OCI release。"))?;
        let compatibility = candidate
            .verified
            .manifest
            .get("compatibility")
            .ok_or_else(|| {
                format!("required V2 member `{component_id}` 缺少 compatibility pins。")
            })?;
        if compatibility.get("groupId").and_then(Value::as_str) != Some(group_id)
            || compatibility.get("contractApiVersion") != group.get("contractApiVersion")
            || compatibility.get("wireApiVersion") != group.get("wireApiVersion")
            || compatibility.get("contractLock") != group.get("contractLock")
        {
            return Err(format!(
                "required member `{component_id}` compatibility pins 与受信 group 不匹配。"
            ));
        }
        if let Some(expected) = &expected_compatibility {
            if expected != compatibility {
                return Err(format!(
                    "compatibility group `{group_id}` 含有混合 contractLock/API pins。"
                ));
            }
        } else {
            expected_compatibility = Some(compatibility.clone());
        }
        candidates.push(candidate);
    }
    if candidates.is_empty() {
        return Err(format!(
            "compatibility group `{group_id}` 没有受支持 required Windows members。"
        ));
    }
    Ok(candidates)
}

/// Find and verify a catalog-published Windows image by its immutable artifact digest.
pub fn verify_windows_image_digest(
    app_dir: &Path,
    catalog: &Value,
    component_id: &str,
    artifact_digest: &str,
    channel: &str,
) -> Result<Option<VerifiedOciManifest>, String> {
    if !matches!(channel, "stable" | "preview") {
        return Err("release channel 不受支持。".to_string());
    }
    let component = catalog_component(catalog, component_id)?;
    let publisher = component["publisher"]
        .as_str()
        .ok_or_else(|| format!("catalog component `{component_id}` 缺少 publisher。"))?;
    let publisher_record = catalog["publishers"]
        .as_array()
        .and_then(|publishers| {
            publishers
                .iter()
                .find(|record| record.get("repository").and_then(Value::as_str) == Some(publisher))
        })
        .ok_or_else(|| format!("catalog publisher `{publisher}` 不存在。"))?;
    let api_uri = publisher_record["releaseDiscovery"]["apiUri"]
        .as_str()
        .ok_or_else(|| format!("catalog publisher `{publisher}` 缺少 release API URI。"))?;
    let endpoint = github_api_route(api_uri)?;
    let releases = fetch_release_list(&endpoint)?;
    let tag_prefix = component_release_tag_prefix(component, channel)?;
    let expected_prerelease = channel == "preview";
    let target_id = "windows-10.0-x86_64-docker-linux";

    for release in releases {
        let Some(tag_commit) = release_tag_commit(&release, tag_prefix.as_deref()) else {
            continue;
        };
        if release.get("draft").and_then(Value::as_bool) != Some(false)
            || release.get("prerelease").and_then(Value::as_bool) != Some(expected_prerelease)
        {
            continue;
        }
        let Some(asset) = release
            .get("assets")
            .and_then(Value::as_array)
            .and_then(|assets| {
                assets.iter().find(|asset| {
                    asset.get("name").and_then(Value::as_str)
                        == Some("component-release-index-v1.json")
                })
            })
        else {
            continue;
        };
        let asset_uri = asset
            .get("url")
            .and_then(Value::as_str)
            .ok_or_else(|| "GitHub release index asset 缺少 API URI。".to_string())?;
        let raw_index = fetch_release_asset(asset_uri, publisher)?;
        verify_api_asset_digest(asset, &raw_index)?;
        let index_json = String::from_utf8(raw_index)
            .map_err(|error| format!("release index 不是 UTF-8 JSON: {error}"))?;
        let index: Value = serde_json::from_str(&index_json)
            .map_err(|error| format!("release index JSON 无效: {error}"))?;
        validate_release_index(&index, catalog, publisher, channel)?;
        if tag_commit
            .as_deref()
            .is_some_and(|commit| index["source"]["commit"].as_str() != Some(commit))
        {
            continue;
        }
        let entries = index
            .get("releases")
            .and_then(Value::as_array)
            .ok_or_else(|| "release index 缺少 releases。".to_string())?;
        for entry in entries.iter().filter(|entry| {
            entry.get("componentId").and_then(Value::as_str) == Some(component_id)
                && entry
                    .get("target")
                    .is_some_and(|target| catalog_target(catalog, target_id) == Some(target))
        }) {
            let manifest_uri = entry
                .get("manifestUri")
                .and_then(Value::as_str)
                .ok_or_else(|| "release index component entry 缺少 manifestUri。".to_string())?;
            validate_immutable_manifest_uri(manifest_uri, publisher)?;
            let temporary = create_temp_directory(app_dir)?;
            let manifest_json =
                fetch_release_manifest(app_dir, temporary.0.as_path(), manifest_uri, publisher)?;
            let manifest: Value = serde_json::from_str(&manifest_json)
                .map_err(|error| format!("release manifest JSON 无效: {error}"))?;
            let parsed =
                validate_windows_oci_manifest(&index, &manifest, catalog, component_id, channel)?;
            if parsed.artifact_digest == artifact_digest {
                let verified = verify_candidate_bytes(
                    catalog,
                    &index_json,
                    &manifest_json,
                    component_id,
                    channel,
                )?;
                return Ok(Some(verified));
            }
        }
    }
    Ok(None)
}

/// Revalidate a persisted plan's exact signed bytes before staging or applying it.
pub fn verify_candidate_bytes(
    catalog: &Value,
    index_json: &str,
    manifest_json: &str,
    component_id: &str,
    channel: &str,
) -> Result<VerifiedOciManifest, String> {
    verify_candidate_bytes_for_target(
        catalog,
        index_json,
        manifest_json,
        component_id,
        channel,
        "windows-10.0-x86_64-docker-linux",
    )
}

/// Revalidate exact persisted bytes for one catalog-pinned Windows OCI target.
pub fn verify_candidate_bytes_for_target(
    catalog: &Value,
    index_json: &str,
    manifest_json: &str,
    component_id: &str,
    channel: &str,
    target_id: &str,
) -> Result<VerifiedOciManifest, String> {
    let index: Value = serde_json::from_str(index_json)
        .map_err(|error| format!("持久化 release index JSON 无效: {error}"))?;
    let manifest: Value = serde_json::from_str(manifest_json)
        .map_err(|error| format!("持久化 release manifest JSON 无效: {error}"))?;
    let verified = validate_windows_oci_manifest_for_target(
        &index,
        &manifest,
        catalog,
        component_id,
        channel,
        target_id,
    )?;
    let publisher = catalog_component(catalog, component_id)?["publisher"]
        .as_str()
        .ok_or_else(|| "catalog component 缺少 publisher。".to_string())?;
    let temp = create_temp_directory(&std::env::temp_dir())?;
    let index_file = temp.0.join("component-release-index-v1.json");
    write_new_file(&index_file, index_json.as_bytes())?;
    verify_attestation_provenance(&index, catalog, &index_file.to_string_lossy())?;
    let oci_subject = format!("oci://{}", verified.image_reference);
    verify_attestation_provenance(&manifest, catalog, &oci_subject)?;
    verify_actions_run(&index, publisher)?;
    verify_actions_run(&manifest, publisher)?;
    Ok(verified)
}

/// Verify Product image SDK labels against a signed, catalog-pinned SDK manifest and artifact.
pub fn verify_runtime_maintenance_sdk_dependency(
    app_dir: &Path,
    catalog: &Value,
    labels: &Value,
    channel: &str,
) -> Result<(), String> {
    if !matches!(channel, "stable" | "preview") {
        return Err("SDK dependency channel 不受支持。".to_string());
    }
    let release_id = labels
        .get("io.cyrene.runtime-maintenance.release-id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= 160)
        .ok_or_else(|| {
            "Product image 缺少 runtime-maintenance SDK release-id label。".to_string()
        })?;
    let verified =
        discover_sdk_release(app_dir, catalog, release_id, channel)?.ok_or_else(|| {
            format!("SDK release `{release_id}` 未出现在受信 `{channel}` catalog index。")
        })?;
    validate_runtime_maintenance_sdk_labels(labels, &verified)
}

fn discover_sdk_release(
    app_dir: &Path,
    catalog: &Value,
    release_id: &str,
    channel: &str,
) -> Result<Option<VerifiedComponentManifest>, String> {
    const SDK_COMPONENT_ID: &str = "cyrene-runtime-maintenance-sdk";
    const SDK_TARGET_ID: &str = "linux-ubuntu-24.04-x86_64-python-3.12-library";
    let component = catalog_component(catalog, SDK_COMPONENT_ID)?;
    let publisher = component
        .get("publisher")
        .and_then(Value::as_str)
        .ok_or_else(|| "catalog SDK component 缺少 publisher。".to_string())?;
    let publisher_record = catalog
        .get("publishers")
        .and_then(Value::as_array)
        .and_then(|publishers| {
            publishers
                .iter()
                .find(|record| record.get("repository").and_then(Value::as_str) == Some(publisher))
        })
        .ok_or_else(|| format!("catalog publisher `{publisher}` 不存在。"))?;
    let api_uri = publisher_record["releaseDiscovery"]["apiUri"]
        .as_str()
        .ok_or_else(|| format!("catalog publisher `{publisher}` 缺少 release API URI。"))?;
    let endpoint = github_api_route(api_uri)?;
    let releases = fetch_release_list(&endpoint)?;
    let expected_prerelease = channel == "preview";

    for release in releases {
        if release.get("draft").and_then(Value::as_bool) != Some(false)
            || release.get("prerelease").and_then(Value::as_bool) != Some(expected_prerelease)
        {
            continue;
        }
        let Some(asset) = release
            .get("assets")
            .and_then(Value::as_array)
            .and_then(|assets| {
                assets.iter().find(|asset| {
                    asset.get("name").and_then(Value::as_str)
                        == Some("component-release-index-v1.json")
                })
            })
        else {
            continue;
        };
        let asset_uri = asset
            .get("url")
            .and_then(Value::as_str)
            .ok_or_else(|| "SDK release index asset 缺少 API URI。".to_string())?;
        let raw_index = fetch_release_asset(asset_uri, publisher)?;
        verify_api_asset_digest(asset, &raw_index)?;
        let index_json = String::from_utf8(raw_index)
            .map_err(|error| format!("SDK release index 不是 UTF-8 JSON: {error}"))?;
        let index: Value = serde_json::from_str(&index_json)
            .map_err(|error| format!("SDK release index JSON 无效: {error}"))?;
        validate_release_index(&index, catalog, publisher, channel)?;
        let Some(entry) = index
            .get("releases")
            .and_then(Value::as_array)
            .and_then(|entries| {
                entries.iter().find(|entry| {
                    entry.get("componentId").and_then(Value::as_str) == Some(SDK_COMPONENT_ID)
                        && entry.get("target").is_some_and(|target| {
                            catalog_target(catalog, SDK_TARGET_ID) == Some(target)
                        })
                })
            })
        else {
            continue;
        };
        let manifest_uri = entry
            .get("manifestUri")
            .and_then(Value::as_str)
            .ok_or_else(|| "SDK release index entry 缺少 manifestUri。".to_string())?;
        validate_immutable_manifest_uri(manifest_uri, publisher)?;
        let temporary = create_temp_directory(app_dir)?;
        let manifest_json =
            fetch_release_manifest(app_dir, temporary.0.as_path(), manifest_uri, publisher)?;
        let manifest: Value = serde_json::from_str(&manifest_json)
            .map_err(|error| format!("SDK release manifest JSON 无效: {error}"))?;
        let verified = validate_component_manifest_for_target(
            &index,
            &manifest,
            catalog,
            SDK_COMPONENT_ID,
            channel,
            SDK_TARGET_ID,
        )?;
        if verified.release_id != release_id {
            continue;
        }
        if verified.artifact_kind != "python-bundle" || verified.version != "0.1.0" {
            return Err(
                "SDK artifact kind/version 与冻结的 Product build dependency 不匹配。".to_string(),
            );
        }

        let index_path = temporary.0.join("component-release-index-v1.json");
        write_new_file(&index_path, index_json.as_bytes())?;
        verify_attestation_provenance(&index, catalog, &index_path.to_string_lossy())?;
        verify_actions_run(&index, publisher)?;
        verify_actions_run(&manifest, publisher)?;

        let artifact_path = download_release_asset(
            app_dir,
            temporary.0.as_path(),
            &verified.artifact_uri,
            publisher,
            verified.artifact_size_bytes,
        )?;
        verify_attestation_provenance(&manifest, catalog, &artifact_path.to_string_lossy())?;
        let actual_digest = format!("sha256:{}", sha256_file(&artifact_path)?);
        if actual_digest != verified.artifact_digest
            || fs::metadata(&artifact_path)
                .map_err(|error| format!("无法读取已验证 SDK artifact metadata: {error}"))?
                .len()
                != verified.artifact_size_bytes
        {
            return Err("SDK artifact 文件 digest/size 与签名 manifest 不匹配。".to_string());
        }
        return Ok(Some(verified));
    }
    Ok(None)
}

fn download_release_asset(
    app_dir: &Path,
    temp_dir: &Path,
    uri: &str,
    publisher: &str,
    expected_size: u64,
) -> Result<PathBuf, String> {
    validate_immutable_manifest_uri(uri, publisher)?;
    let prefix = format!("https://github.com/{publisher}/releases/download/");
    let rest = uri
        .strip_prefix(&prefix)
        .ok_or_else(|| "SDK artifact URI 不属于 catalog publisher。".to_string())?;
    let (tag, asset) = rest
        .split_once('/')
        .ok_or_else(|| "SDK artifact URI 缺少 release tag 或 asset。".to_string())?;
    let temp_dir_text = temp_dir
        .to_str()
        .ok_or_else(|| "SDK artifact 临时目录无法编码。".to_string())?;
    run_gh_status(
        [
            "release",
            "download",
            tag,
            "--repo",
            publisher,
            "--pattern",
            asset,
            "--dir",
            temp_dir_text,
        ],
        app_dir,
    )?;
    let path = temp_dir.join(asset);
    let actual_size = fs::metadata(&path)
        .map_err(|error| format!("无法读取 SDK artifact metadata: {error}"))?
        .len();
    if actual_size != expected_size || actual_size == 0 || actual_size > 1_073_741_824 {
        return Err("下载的 SDK artifact size 与受信 manifest 不匹配。".to_string());
    }
    Ok(path)
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file =
        fs::File::open(path).map_err(|error| format!("无法打开待验证 SDK artifact: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| format!("无法读取待验证 SDK artifact: {error}"))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn fetch_release_list(endpoint: &str) -> Result<Vec<Value>, String> {
    let jq = "[.[] | {tag_name, draft, prerelease, assets: [.assets[]? | select(.name == \"component-release-index-v1.json\") | {name, url, digest}]}]";
    let output = run_gh_capture(
        ["api", "--hostname", "github.com", "--jq", jq, endpoint],
        MAX_JSON_BYTES,
    )?;
    serde_json::from_slice(&output)
        .map_err(|error| format!("GitHub releases API JSON 无效: {error}"))
}

/// Resolve the optional component-specific release tag prefix from trusted catalog metadata.
fn component_release_tag_prefix(
    component: &Value,
    channel: &str,
) -> Result<Option<String>, String> {
    let Some(discovery) = component.get("releaseDiscovery") else {
        let component_id = component.get("componentId").and_then(Value::as_str);
        if component.get("publisher").and_then(Value::as_str)
            == Some("DoHorizon-AI/Cyrene-Plugins-Official")
            && matches!(
                component_id,
                Some(
                    "cy-workspace-connector"
                        | "cy-workspace-frontend-bridge"
                        | "cy-workspace-relay"
                        | "cy-workspace-sidecar"
                )
            )
        {
            return Err(format!(
                "Plugins component `{}` 缺少 component-scoped releaseDiscovery；请先显式导入新目录。",
                component_id.unwrap_or_default()
            ));
        }
        return Ok(None);
    };
    let prefix = discovery
        .get("tagPrefixes")
        .and_then(|value| value.get(channel))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= 256)
        .ok_or_else(|| "component releaseDiscovery 缺少有效 channel tag prefix。".to_string())?;
    Ok(Some(prefix.to_string()))
}

/// Return the source SHA encoded by a component-scoped release tag, if required.
fn release_tag_commit(release: &Value, prefix: Option<&str>) -> Option<Option<String>> {
    let Some(prefix) = prefix else {
        return Some(None);
    };
    let tag = release.get("tag_name").and_then(Value::as_str)?;
    let commit = tag.strip_prefix(prefix)?;
    (commit.len() == 40
        && commit
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)))
    .then(|| Some(commit.to_string()))
}

fn fetch_release_asset(uri: &str, publisher: &str) -> Result<Vec<u8>, String> {
    let prefix = format!("https://api.github.com/repos/{publisher}/releases/assets/");
    let id = uri
        .strip_prefix(&prefix)
        .filter(|id| !id.is_empty() && id.bytes().all(|byte| byte.is_ascii_digit()))
        .ok_or_else(|| "release index asset API URI 不属于 catalog publisher。".to_string())?;
    let endpoint = format!("/repos/{publisher}/releases/assets/{id}");
    run_gh_capture(
        [
            "api",
            "--hostname",
            "github.com",
            "--header",
            "Accept: application/octet-stream",
            &endpoint,
        ],
        MAX_JSON_BYTES,
    )
}

fn verify_api_asset_digest(asset: &Value, bytes: &[u8]) -> Result<(), String> {
    let Some(expected) = asset.get("digest").and_then(Value::as_str) else {
        return Ok(());
    };
    if !expected.starts_with("sha256:") {
        return Err("GitHub release index asset digest algorithm 不受支持。".to_string());
    }
    let actual = format!("sha256:{}", sha256_hex(bytes));
    if expected != actual {
        return Err(format!(
            "GitHub release index asset digest 不匹配（expected {expected}, actual {actual}）。"
        ));
    }
    Ok(())
}

fn fetch_release_manifest(
    app_dir: &Path,
    temp_dir: &Path,
    uri: &str,
    publisher: &str,
) -> Result<String, String> {
    validate_immutable_manifest_uri(uri, publisher)?;
    let prefix = format!("https://github.com/{publisher}/releases/download/");
    let rest = uri
        .strip_prefix(&prefix)
        .ok_or_else(|| "manifestUri 不属于 catalog publisher。".to_string())?;
    let (tag, asset) = rest
        .split_once('/')
        .ok_or_else(|| "manifestUri 缺少 release tag 或 asset。".to_string())?;
    run_gh_status(
        [
            "release",
            "download",
            tag,
            "--repo",
            publisher,
            "--pattern",
            asset,
            "--dir",
            temp_dir
                .to_str()
                .ok_or_else(|| "release 临时目录无法编码。".to_string())?,
        ],
        app_dir,
    )?;
    let path = temp_dir.join(asset);
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("已 pin 的 component manifest 未下载: {error}"))?;
    if metadata.len() == 0 || metadata.len() > 1_048_576 {
        return Err("component release manifest 大小不受支持。".to_string());
    }
    let bytes = fs::read(path).map_err(|error| format!("无法读取下载的 manifest: {error}"))?;
    String::from_utf8(bytes).map_err(|error| format!("component manifest 不是 UTF-8: {error}"))
}

fn verify_attestation_provenance(
    document: &Value,
    catalog: &Value,
    subject: &str,
) -> Result<(), String> {
    let attestation = document
        .get("provenance")
        .and_then(|value| value.get("attestation"))
        .ok_or_else(|| "release document 缺少 attestation。".to_string())?;
    let repository = attestation
        .get("repository")
        .and_then(Value::as_str)
        .ok_or_else(|| "attestation 缺少 repository。".to_string())?;
    let publisher = catalog
        .get("publishers")
        .and_then(Value::as_array)
        .and_then(|publishers| {
            publishers.iter().find(|publisher| {
                publisher.get("repository").and_then(Value::as_str) == Some(repository)
            })
        })
        .ok_or_else(|| {
            format!("attestation repository `{repository}` 不在受信 publisher 列表。")
        })?;
    let workflow = publisher["workflow"]
        .as_str()
        .ok_or_else(|| "受信 publisher 缺少 workflow。".to_string())?;
    let source = document
        .get("source")
        .ok_or_else(|| "release document 缺少 source。".to_string())?;
    let source_ref = source["ref"]
        .as_str()
        .ok_or_else(|| "release document source.ref 无效。".to_string())?;
    let source_commit = source["commit"]
        .as_str()
        .ok_or_else(|| "release document source.commit 无效。".to_string())?;
    run_gh_status(
        [
            "attestation",
            "verify",
            subject,
            "--hostname",
            "github.com",
            "--repo",
            repository,
            "--signer-workflow",
            workflow,
            "--source-ref",
            source_ref,
            "--source-digest",
            source_commit,
            "--format",
            "json",
        ],
        &std::env::temp_dir(),
    )?;
    Ok(())
}

fn verify_actions_run(document: &Value, expected_repository: &str) -> Result<(), String> {
    let attestation = document["provenance"]["attestation"].clone();
    let repository = attestation["repository"]
        .as_str()
        .ok_or_else(|| "attestation repository 无效。".to_string())?;
    if !repository.eq_ignore_ascii_case(expected_repository) {
        return Err("attestation repository 与 catalog publisher 不匹配。".to_string());
    }
    let run_id = attestation["run"]["id"]
        .as_str()
        .filter(|value| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
        .ok_or_else(|| "attestation run id 无效。".to_string())?;
    let attempt = attestation["run"]["attempt"]
        .as_u64()
        .filter(|value| *value > 0)
        .ok_or_else(|| "attestation run attempt 无效。".to_string())?;
    let endpoint = format!("repos/{repository}/actions/runs/{run_id}/attempts/{attempt}");
    let bytes = run_gh_capture(["api", "--hostname", "github.com", &endpoint], 1_048_576)?;
    let run: Value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("GitHub Actions run endpoint JSON 无效: {error}"))?;
    let source = document
        .get("source")
        .ok_or_else(|| "release document 缺少 source。".to_string())?;
    let commit = source["commit"]
        .as_str()
        .ok_or_else(|| "release source commit 无效。".to_string())?;
    let source_ref = source["ref"]
        .as_str()
        .ok_or_else(|| "release source ref 无效。".to_string())?;
    let workflow = attestation["workflow"]
        .as_str()
        .ok_or_else(|| "attestation workflow 无效。".to_string())?;
    let workflow_path = workflow
        .strip_prefix(&format!("{repository}/"))
        .ok_or_else(|| "attestation workflow 与 repository 不匹配。".to_string())?;
    let expected_path = format!("{workflow_path}@{source_ref}");
    let actual_repository = run["repository"]["full_name"]
        .as_str()
        .ok_or_else(|| "Actions run endpoint 缺少 repository.full_name。".to_string())?;
    if !actual_repository.eq_ignore_ascii_case(expected_repository)
        || run["head_sha"].as_str() != Some(commit)
        || run["run_attempt"].as_u64() != Some(attempt)
        || run["path"].as_str() != Some(expected_path.as_str())
        || run["status"].as_str() != Some("completed")
        || run["conclusion"].as_str() != Some("success")
    {
        return Err(format!(
            "GitHub Actions run {} attempt {} 未匹配发布 repository/workflow/ref/commit 或未成功完成。",
            run_id, attempt
        ));
    }
    Ok(())
}

fn catalog_component<'a>(catalog: &'a Value, component_id: &str) -> Result<&'a Value, String> {
    catalog
        .get("components")
        .and_then(Value::as_array)
        .and_then(|components| {
            components
                .iter()
                .find(|component| component["componentId"].as_str() == Some(component_id))
        })
        .ok_or_else(|| format!("组件 `{component_id}` 不在受信 Workspace catalog。"))
}

fn catalog_target<'a>(catalog: &'a Value, target_id: &str) -> Option<&'a Value> {
    catalog
        .get("targets")?
        .as_array()?
        .iter()
        .find(|target| target.get("id").and_then(Value::as_str) == Some(target_id))?
        .get("target")
}

fn github_api_route(uri: &str) -> Result<String, String> {
    let route = uri
        .strip_prefix("https://api.github.com")
        .filter(|route| route.starts_with("/repos/") && !route.contains('#'))
        .ok_or_else(|| {
            "catalog release API URI 必须是固定 api.github.com/repos endpoint。".to_string()
        })?;
    if !route
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || b"/-?=&._".contains(&byte))
    {
        return Err("catalog release API URI 含有不受支持的字符。".to_string());
    }
    Ok(route.to_string())
}

fn create_temp_directory(base: &Path) -> Result<TempDirectory, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let path = base.join(format!(
        "cyrene-update-{}-{timestamp:x}-{sequence:x}",
        std::process::id()
    ));
    fs::create_dir_all(&path)
        .map_err(|error| format!("无法创建 release 临时目录 {}: {error}", path.display()))?;
    Ok(TempDirectory(path))
}

fn write_new_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| {
            format!(
                "无法创建临时 attestation subject {}: {error}",
                path.display()
            )
        })?;
    file.write_all(bytes).map_err(|error| {
        format!(
            "无法写入临时 attestation subject {}: {error}",
            path.display()
        )
    })?;
    file.sync_all().map_err(|error| {
        format!(
            "无法同步临时 attestation subject {}: {error}",
            path.display()
        )
    })
}

fn run_gh_capture<const N: usize>(args: [&str; N], max_stdout: usize) -> Result<Vec<u8>, String> {
    let mut command = github_command();
    command
        .args(args)
        .env("GH_HOST", "github.com")
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let capture = run_capture(command, max_stdout)?;
    if !capture.status.success() {
        return Err(format!(
            "GitHub CLI 请求失败: {}",
            String::from_utf8_lossy(&capture.stderr).trim()
        ));
    }
    Ok(capture.stdout)
}

fn run_gh_status<const N: usize>(args: [&str; N], current_dir: &Path) -> Result<(), String> {
    let mut command = github_command();
    command
        .args(args)
        .env("GH_HOST", "github.com")
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .current_dir(current_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let capture = run_capture(command, MAX_JSON_BYTES)?;
    if capture.status.success() {
        Ok(())
    } else {
        Err(format!(
            "GitHub CLI 验证/下载失败: {}",
            String::from_utf8_lossy(&capture.stderr).trim()
        ))
    }
}

fn run_capture(mut command: Command, max_stdout: usize) -> Result<CommandCapture, String> {
    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动 GitHub CLI: {error}"))?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "GitHub CLI stdout pipe 不可用。".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "GitHub CLI stderr pipe 不可用。".to_string())?;
    let stdout_reader = thread::spawn(move || read_bounded(&mut stdout, max_stdout));
    let stderr_reader = thread::spawn(move || read_bounded(&mut stderr, MAX_STDERR_BYTES));
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < GH_TIMEOUT => thread::sleep(Duration::from_millis(50)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err("GitHub CLI 请求超时。".to_string());
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err(format!("无法读取 GitHub CLI 进程状态: {error}"));
            }
        }
    };
    let (stdout, stdout_overflow) = stdout_reader
        .join()
        .map_err(|_| "读取 GitHub CLI stdout 时线程失败。".to_string())??;
    let (stderr, _) = stderr_reader
        .join()
        .map_err(|_| "读取 GitHub CLI stderr 时线程失败。".to_string())??;
    if stdout_overflow {
        return Err("GitHub CLI 响应超过允许的大小限制。".to_string());
    }
    Ok(CommandCapture {
        status,
        stdout,
        stderr,
    })
}

fn read_bounded(reader: &mut impl Read, limit: usize) -> Result<(Vec<u8>, bool), String> {
    let mut output = Vec::new();
    let mut overflow = false;
    let mut buffer = [0u8; 8192];
    loop {
        let count = reader
            .read(&mut buffer)
            .map_err(|error| format!("读取 GitHub CLI pipe 失败: {error}"))?;
        if count == 0 {
            break;
        }
        let remaining = limit.saturating_sub(output.len());
        let retained = remaining.min(count);
        output.extend_from_slice(&buffer[..retained]);
        overflow |= retained != count;
    }
    Ok((output, overflow))
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
