//! ┌─────────────────────────────────────────────────────────────────────┐
//! │  📄 release_update.rs                                                │
//! │  Module: installer::release_update                                  │
//! │  Role: Verify immutable release index and component plan digests.    │
//! │                                                                      │
//! │  模块职责：验证不可变 release index、manifest、来源与计划摘要。        │
//! └─────────────────────────────────────────────────────────────────────┘

use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanComponentDigest {
    pub component_id: String,
    pub version: String,
    pub manifest_digest: String,
    pub artifact_digest: String,
    pub restart_group: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protocol_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_digest: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlanDigestMaterial {
    schema_version: u32,
    channel: String,
    components: Vec<PlanComponentDigest>,
    #[serde(skip_serializing_if = "Option::is_none")]
    authority_artifact_id: Option<String>,
}

/// Compute the cross-platform plan ID/digest using the shared RFC 8785 material.
pub fn plan_id_and_digest(
    channel: &str,
    components: &[PlanComponentDigest],
) -> Result<(String, String), String> {
    plan_id_and_digest_with_authority_artifact(channel, components, None)
}

/// Bind a compatibility-group plan to the Authority-owned active or bootstrap bundle identity.
pub fn plan_id_and_digest_with_authority_artifact(
    channel: &str,
    components: &[PlanComponentDigest],
    authority_artifact_id: Option<&str>,
) -> Result<(String, String), String> {
    if !matches!(channel, "stable" | "preview") || components.is_empty() {
        return Err("更新计划 channel 或 components 无效。".to_string());
    }
    if authority_artifact_id.is_some_and(|digest| !is_digest(digest)) {
        return Err("Authority data-bundle artifactId 格式无效。".to_string());
    }
    let mut components = components.to_vec();
    components.sort_by(|left, right| left.component_id.cmp(&right.component_id));
    for component in &components {
        if !is_digest(&component.manifest_digest) || !is_digest(&component.artifact_digest) {
            return Err(format!(
                "计划组件 `{}` digest 格式无效。",
                component.component_id
            ));
        }
    }
    let material = PlanDigestMaterial {
        schema_version: 1,
        channel: channel.to_string(),
        components,
        authority_artifact_id: authority_artifact_id.map(str::to_string),
    };
    let bytes = serde_jcs::to_vec(&material)
        .map_err(|error| format!("无法按 RFC 8785 编码更新计划: {error}"))?;
    let digest = format!("sha256:{}", sha256_hex(&bytes));
    let plan_id = format!("plan-{}", &digest[7..39]);
    Ok((plan_id, digest))
}

/// Verify the JCS self-digest used by a manifest or release index.
pub fn verify_self_digest(value: &Value, digest_field: &str) -> Result<String, String> {
    validate_safe_numbers(value)?;
    let expected = value
        .get(digest_field)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("JSON 缺少 `{digest_field}`。"))?;
    if !is_digest(expected) {
        return Err(format!("`{digest_field}` 格式无效。"));
    }
    let mut material = value.clone();
    material
        .as_object_mut()
        .ok_or_else(|| "JCS 摘要对象必须是 JSON object。".to_string())?
        .remove(digest_field);
    let canonical = serde_jcs::to_vec(&material)
        .map_err(|error| format!("无法按 RFC 8785 编码 `{digest_field}`: {error}"))?;
    let actual = format!("sha256:{}", sha256_hex(&canonical));
    if expected != actual {
        return Err(format!(
            "`{digest_field}` 与 JCS 内容不匹配（expected {expected}, actual {actual}）。"
        ));
    }
    Ok(actual)
}

/// Validate release-index provenance before accepting any of its release pointers.
pub fn validate_release_index(
    index: &Value,
    catalog: &Value,
    publisher: &str,
    channel: &str,
) -> Result<String, String> {
    let digest = verify_self_digest(index, "indexDigest")?;
    if index.get("schemaVersion").and_then(Value::as_u64) != Some(1)
        || index.get("repository").and_then(Value::as_str) != Some(publisher)
        || index.get("channel").and_then(Value::as_str) != Some(channel)
    {
        return Err("release index schema/repository/channel 与请求不匹配。".to_string());
    }
    let releases = index
        .get("releases")
        .and_then(Value::as_array)
        .ok_or_else(|| "release index 缺少 releases。".to_string())?;
    if releases.len() > 500 {
        return Err("release index 超过 500 个条目的限制。".to_string());
    }
    validate_source_provenance(
        index,
        catalog,
        publisher,
        channel,
        Some("component-release-index-v1.json"),
    )?;
    Ok(digest)
}

/// Cross-check an index entry and its one-target OCI manifest against pinned catalog identity.
pub fn validate_windows_oci_manifest(
    index: &Value,
    manifest: &Value,
    catalog: &Value,
    component_id: &str,
    channel: &str,
) -> Result<VerifiedOciManifest, String> {
    validate_windows_oci_manifest_for_target(
        index,
        manifest,
        catalog,
        component_id,
        channel,
        "windows-10.0-x86_64-docker-linux",
    )
}

/// Cross-check an index entry and its one-target Windows Docker OCI manifest for a pinned target.
pub fn validate_windows_oci_manifest_for_target(
    index: &Value,
    manifest: &Value,
    catalog: &Value,
    component_id: &str,
    channel: &str,
    target_id: &str,
) -> Result<VerifiedOciManifest, String> {
    let manifest_digest = verify_self_digest(manifest, "manifestDigest")?;
    if !matches!(channel, "stable" | "preview")
        || index.get("channel").and_then(Value::as_str) != Some(channel)
        || manifest.get("channel").and_then(Value::as_str) != Some(channel)
    {
        return Err("release index/manifest channel 与请求不匹配。".to_string());
    }

    let catalog_component = catalog_component(catalog, component_id)?;
    let catalog_target_entry = catalog_component
        .get("targets")
        .and_then(Value::as_array)
        .and_then(|targets| {
            targets
                .iter()
                .find(|target| target.get("targetId").and_then(Value::as_str) == Some(target_id))
        })
        .ok_or_else(|| format!("组件 `{component_id}` 没有 Windows Docker target。"))?;
    if catalog_target_entry.get("support").and_then(Value::as_str) != Some("supported")
        || catalog_target_entry
            .get("artifactKind")
            .and_then(Value::as_str)
            != Some("oci-image")
    {
        return Err(format!(
            "组件 `{component_id}` 的 Windows OCI target 不受支持。"
        ));
    }
    let target = catalog
        .get("targets")
        .and_then(Value::as_array)
        .and_then(|targets| {
            targets
                .iter()
                .find(|target| target.get("id").and_then(Value::as_str) == Some(target_id))
        })
        .and_then(|target| target.get("target"))
        .ok_or_else(|| "受信 catalog 缺少 Windows Docker target 描述。".to_string())?;
    if target.get("os").and_then(Value::as_str) != Some("windows")
        || target.get("architecture").and_then(Value::as_str) != Some("x86_64")
        || target.get("runtime").and_then(Value::as_str) != Some("docker-desktop:linux")
    {
        return Err(format!(
            "target `{target_id}` 不是受支持的 Windows Docker Desktop Linux target。"
        ));
    }
    if manifest.get("target") != Some(target) {
        return Err(format!(
            "组件 `{component_id}` manifest target 不匹配 Windows catalog。"
        ));
    }
    if manifest.get("componentId").and_then(Value::as_str) != Some(component_id) {
        return Err("release manifest componentId 与计划不匹配。".to_string());
    }
    validate_manifest_protocol_and_content(manifest, catalog, catalog_component, component_id)?;
    if manifest.get("schemaVersion").and_then(Value::as_u64) == Some(2) {
        validate_manifest_source_matches_index(index, manifest)?;
    }
    validate_manifest_dependencies(manifest, catalog, catalog_component, component_id)?;
    let version = manifest
        .get("version")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .ok_or_else(|| "release manifest version 无效。".to_string())?
        .to_string();
    let publisher = catalog_component
        .get("publisher")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("catalog component `{component_id}` 缺少 publisher。"))?;
    validate_release_index(index, catalog, publisher, channel)?;
    validate_source_provenance(manifest, catalog, publisher, channel, None)?;

    if index.get("repository").and_then(Value::as_str) != Some(publisher) {
        return Err("release index repository 与 catalog publisher 不匹配。".to_string());
    }
    let index_release = index
        .get("releases")
        .and_then(Value::as_array)
        .and_then(|releases| {
            releases.iter().find(|release| {
                release.get("componentId").and_then(Value::as_str) == Some(component_id)
                    && release.get("manifestDigest").and_then(Value::as_str)
                        == Some(manifest_digest.as_str())
            })
        })
        .ok_or_else(|| format!("release index 未 pin `{component_id}` manifest digest。"))?;
    if index_release.get("version").and_then(Value::as_str) != Some(version.as_str())
        || index_release.get("target") != Some(target)
    {
        return Err("release index entry 与 manifest version/target 不匹配。".to_string());
    }
    let manifest_uri = index_release
        .get("manifestUri")
        .and_then(Value::as_str)
        .ok_or_else(|| "release index entry 缺少 manifestUri。".to_string())?;
    validate_immutable_manifest_uri(manifest_uri, publisher)?;

    let artifact = manifest
        .get("artifact")
        .filter(|artifact| artifact.get("kind").and_then(Value::as_str) == Some("oci-image"))
        .ok_or_else(|| "Windows Product manifest artifact 必须是 oci-image。".to_string())?;
    let repository = artifact
        .get("repository")
        .and_then(Value::as_str)
        .ok_or_else(|| "OCI artifact 缺少 repository。".to_string())?;
    if manifest["provenance"]["attestation"]["subjectName"].as_str() != Some(repository) {
        return Err(
            "OCI attestation subjectName 必须等于 canonical image repository。".to_string(),
        );
    }
    if catalog_component
        .get("ociImageRepository")
        .and_then(Value::as_str)
        != Some(repository)
    {
        return Err("OCI repository 与受信 catalog pin 不匹配。".to_string());
    }
    let artifact_digest = artifact
        .get("digest")
        .and_then(Value::as_str)
        .filter(|digest| is_digest(digest))
        .ok_or_else(|| "OCI artifact digest 格式无效。".to_string())?
        .to_string();
    let protocol_version = manifest
        .get("protocolVersion")
        .and_then(Value::as_str)
        .map(str::to_string);
    let content_digest = manifest
        .get("contentDigest")
        .and_then(Value::as_str)
        .map(str::to_string);
    let platform = artifact
        .get("platform")
        .ok_or_else(|| "OCI artifact 缺少 platform。".to_string())?;
    if platform.get("os").and_then(Value::as_str) != Some("linux")
        || platform.get("architecture").and_then(Value::as_str) != Some("amd64")
    {
        return Err(
            "Windows Docker Desktop Linux 产品更新必须是 linux/amd64 OCI image。".to_string(),
        );
    }
    let restart_group = manifest
        .get("restart")
        .and_then(|restart| restart.get("group"))
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "core-runtime" | "single-service" | "none"))
        .ok_or_else(|| "manifest restart group 无效。".to_string())?
        .to_string();
    if restart_group
        != catalog_component["restart"]["group"]
            .as_str()
            .unwrap_or_default()
    {
        return Err("manifest restart group 与受信 catalog 不匹配。".to_string());
    }
    let image_reference = format!("{repository}@{artifact_digest}");
    Ok(VerifiedOciManifest {
        component_id: component_id.to_string(),
        target_id: target_id.to_string(),
        version,
        manifest_digest,
        artifact_digest,
        image_reference,
        restart_group,
        protocol_version,
        content_digest,
        manifest: manifest.clone(),
    })
}

fn validate_manifest_source_matches_index(index: &Value, manifest: &Value) -> Result<(), String> {
    let index_source = index
        .get("source")
        .ok_or_else(|| "V2 release index 缺少 source provenance。".to_string())?;
    let manifest_source = manifest
        .get("source")
        .ok_or_else(|| "V2 manifest 缺少 source provenance。".to_string())?;
    if manifest_source.get("repository") != index_source.get("repository")
        || manifest_source.get("ref") != index_source.get("ref")
        || manifest_source.get("commit") != index_source.get("commit")
    {
        return Err(
            "V2 manifest source repository/ref/commit 与已验证 release index 不匹配。".to_string(),
        );
    }
    let index_run = index
        .get("provenance")
        .and_then(|value| value.get("attestation"))
        .and_then(|value| value.get("run"))
        .ok_or_else(|| "V2 release index 缺少 attested Actions run。".to_string())?;
    let manifest_run = manifest
        .get("provenance")
        .and_then(|value| value.get("attestation"))
        .and_then(|value| value.get("run"))
        .ok_or_else(|| "V2 manifest 缺少 attested Actions run。".to_string())?;
    if index_run != manifest_run {
        return Err("V2 manifest attestation run 与 release index 不一致。".to_string());
    }
    Ok(())
}

fn validate_manifest_protocol_and_content(
    manifest: &Value,
    catalog: &Value,
    catalog_component: &Value,
    component_id: &str,
) -> Result<(), String> {
    let schema_version = manifest
        .get("schemaVersion")
        .and_then(Value::as_u64)
        .ok_or_else(|| "release manifest schemaVersion 必须是整数。".to_string())?;
    match schema_version {
        1 => {
            if manifest.get("protocolVersion").is_some() || manifest.get("contentDigest").is_some()
            {
                return Err(
                    "V1 release manifest 不得包含 V2 protocolVersion/contentDigest。".to_string(),
                );
            }
        }
        2 => {
            const ALLOWED_V2_KEYS: &[&str] = &[
                "schemaVersion",
                "releaseId",
                "componentId",
                "version",
                "channel",
                "target",
                "artifact",
                "dependencies",
                "restart",
                "source",
                "provenance",
                "health",
                "compatibility",
                "manifestDigest",
                "protocolVersion",
                "contentDigest",
            ];
            let object = manifest
                .as_object()
                .ok_or_else(|| "V2 release manifest 必须是 JSON object。".to_string())?;
            if object
                .keys()
                .any(|key| !ALLOWED_V2_KEYS.contains(&key.as_str()))
                || [
                    "releaseId",
                    "componentId",
                    "version",
                    "channel",
                    "target",
                    "artifact",
                    "dependencies",
                    "restart",
                    "source",
                    "provenance",
                    "manifestDigest",
                    "protocolVersion",
                    "contentDigest",
                ]
                .iter()
                .any(|key| !object.contains_key(*key))
            {
                return Err("V2 release manifest 字段集合无效。".to_string());
            }
            let protocol_version = manifest
                .get("protocolVersion")
                .and_then(Value::as_str)
                .filter(|value| {
                    !value.is_empty()
                        && value.len() <= 128
                        && value.as_bytes()[0].is_ascii_lowercase()
                        && value.bytes().all(|byte| {
                            byte.is_ascii_lowercase()
                                || byte.is_ascii_digit()
                                || matches!(byte, b'.' | b'_' | b'-')
                        })
                })
                .ok_or_else(|| "V2 manifest protocolVersion 格式无效。".to_string())?;
            let component_group = catalog_component
                .get("compatibilityGroup")
                .and_then(Value::as_str);
            let expected_protocol = if let Some(group_id) = component_group {
                catalog
                    .get("compatibilityGroups")
                    .and_then(Value::as_array)
                    .and_then(|groups| {
                        groups.iter().find(|group| {
                            group.get("groupId").and_then(Value::as_str) == Some(group_id)
                        })
                    })
                    .and_then(|group| {
                        group
                            .get("members")
                            .and_then(Value::as_array)
                            .and_then(|members| {
                                members.iter().find(|member| {
                                    member.get("componentId").and_then(Value::as_str)
                                        == Some(component_id)
                                })
                            })
                    })
                    .and_then(|member| member.get("protocolVersion"))
                    .and_then(Value::as_str)
            } else {
                catalog_component
                    .get("protocolVersion")
                    .and_then(Value::as_str)
            }
            .ok_or_else(|| format!("catalog 未 pin `{component_id}` 的 V2 protocolVersion。"))?;
            if protocol_version != expected_protocol {
                return Err(format!(
                    "`{component_id}` V2 protocolVersion 与受信 catalog 不匹配。"
                ));
            }
            let artifact = manifest
                .get("artifact")
                .and_then(Value::as_object)
                .ok_or_else(|| "V2 manifest artifact 必须是 object。".to_string())?;
            let expected_content_digest =
                if artifact.get("kind").and_then(Value::as_str) == Some("oci-image") {
                    artifact.get("digest").and_then(Value::as_str)
                } else {
                    artifact.get("sha256").and_then(Value::as_str)
                }
                .filter(|digest| is_digest(digest))
                .ok_or_else(|| "V2 manifest artifact payload digest 无效。".to_string())?;
            let content_digest = manifest
                .get("contentDigest")
                .and_then(Value::as_str)
                .filter(|digest| is_digest(digest))
                .ok_or_else(|| "V2 manifest contentDigest 格式无效。".to_string())?;
            if content_digest != expected_content_digest {
                return Err(
                    "V2 manifest contentDigest 与不可变 payload digest 不匹配。".to_string()
                );
            }
            if let Some(group_id) = component_group {
                let group = catalog["compatibilityGroups"]
                    .as_array()
                    .and_then(|groups| {
                        groups.iter().find(|group| {
                            group.get("groupId").and_then(Value::as_str) == Some(group_id)
                        })
                    })
                    .ok_or_else(|| format!("catalog compatibility group `{group_id}` 缺失。"))?;
                let compatibility = manifest.get("compatibility").ok_or_else(|| {
                    format!("V2 manifest `{component_id}` 缺少 compatibility pin。")
                })?;
                if compatibility
                    .as_object()
                    .is_none_or(|object| object.len() != 4)
                    || compatibility.get("groupId").and_then(Value::as_str) != Some(group_id)
                    || compatibility.get("contractApiVersion") != group.get("contractApiVersion")
                    || compatibility.get("wireApiVersion") != group.get("wireApiVersion")
                {
                    return Err(format!(
                        "`{component_id}` manifest compatibility 与 catalog 不匹配。"
                    ));
                }
                validate_contract_lock(compatibility.get("contractLock"))?;
            }
        }
        _ => {
            return Err(format!(
                "release manifest schemaVersion `{schema_version}` 不受支持。"
            ))
        }
    }
    Ok(())
}

fn validate_contract_lock(value: Option<&Value>) -> Result<(), String> {
    let lock = value
        .and_then(Value::as_object)
        .ok_or_else(|| "V2 compatibility 缺少 contractLock。".to_string())?;
    if lock.len() != 4
        || lock.get("repository").and_then(Value::as_str).is_none()
        || lock
            .get("commit")
            .and_then(Value::as_str)
            .is_none_or(|commit| {
                !matches!(commit.len(), 40 | 64)
                    || !commit.bytes().all(|byte| byte.is_ascii_hexdigit())
            })
        || lock
            .get("path")
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
        || lock
            .get("sha256")
            .and_then(Value::as_str)
            .is_none_or(|digest| !is_digest(digest))
    {
        return Err("V2 compatibility contractLock 格式无效。".to_string());
    }
    Ok(())
}

fn validate_manifest_dependencies(
    manifest: &Value,
    catalog: &Value,
    catalog_component: &Value,
    component_id: &str,
) -> Result<(), String> {
    let manifest_dependencies = dependency_map(
        manifest
            .get("dependencies")
            .and_then(Value::as_array)
            .ok_or_else(|| "release manifest 缺少 dependencies 数组。".to_string())?,
        catalog,
        "manifest",
    )?;
    let catalog_dependencies = dependency_map(
        catalog_component
            .get("dependencies")
            .and_then(Value::as_array)
            .ok_or_else(|| format!("受信 catalog `{component_id}` 缺少 dependencies。"))?,
        catalog,
        "catalog",
    )?;
    if manifest_dependencies != catalog_dependencies {
        return Err(format!(
            "`{component_id}` manifest dependencies 与 Workspace component catalog 不一致。"
        ));
    }
    if matches!(
        component_id,
        "cyrene-catalyst" | "cyrene-echo" | "cyrene-exchange" | "cyrene-reactor" | "cyrene-yield"
    ) {
        let expected = BTreeMap::from([
            (
                "cyrene-runtime-maintenance".to_string(),
                ">=0.1.0, <0.2.0".to_string(),
            ),
            (
                "cyrene-runtime-maintenance-sdk".to_string(),
                "=0.1.0".to_string(),
            ),
        ]);
        if manifest_dependencies != expected {
            return Err(format!(
                "`{component_id}` 必须声明受信 broker runtime 和 SDK build dependencies。"
            ));
        }
    }
    Ok(())
}

fn dependency_map(
    dependencies: &[Value],
    catalog: &Value,
    source: &str,
) -> Result<BTreeMap<String, String>, String> {
    if dependencies.len() > 100 {
        return Err(format!("{source} dependencies 超过 100 项。"));
    }
    let known_components = catalog
        .get("components")
        .and_then(Value::as_array)
        .ok_or_else(|| "Workspace catalog 缺少 components。".to_string())?;
    let mut result = BTreeMap::new();
    for dependency in dependencies {
        let component_id = dependency
            .get("componentId")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty() && id.len() <= 64)
            .ok_or_else(|| format!("{source} dependency componentId 无效。"))?;
        let version_range = dependency
            .get("versionRange")
            .and_then(Value::as_str)
            .filter(|range| !range.is_empty() && range.len() <= 128)
            .ok_or_else(|| format!("{source} dependency `{component_id}` 缺少 versionRange。"))?;
        if !known_components
            .iter()
            .any(|component| component["componentId"].as_str() == Some(component_id))
        {
            return Err(format!(
                "{source} dependency `{component_id}` 不在受信 catalog。"
            ));
        }
        if !matches!(version_range, "=0.1.0" | ">=0.1.0, <0.2.0") {
            return Err(format!(
                "{source} dependency `{component_id}` versionRange 未在本机 verifier 支持范围内。"
            ));
        }
        if result
            .insert(component_id.to_string(), version_range.to_string())
            .is_some()
        {
            return Err(format!("{source} dependency `{component_id}` 重复。"));
        }
    }
    Ok(result)
}

#[derive(Clone, Debug)]
pub struct VerifiedOciManifest {
    pub component_id: String,
    pub target_id: String,
    pub version: String,
    pub manifest_digest: String,
    pub artifact_digest: String,
    pub image_reference: String,
    pub restart_group: String,
    pub protocol_version: Option<String>,
    pub content_digest: Option<String>,
    pub manifest: Value,
}

#[derive(Clone, Debug)]
pub struct VerifiedComponentManifest {
    pub component_id: String,
    pub manifest_digest: String,
    pub version: String,
    pub release_id: String,
    pub artifact_kind: String,
    pub artifact_uri: String,
    pub artifact_digest: String,
    pub artifact_size_bytes: u64,
    pub files: BTreeMap<String, String>,
}

/// Validate a catalog-pinned manifest for a specific target, including the immutable index entry.
pub fn validate_component_manifest_for_target(
    index: &Value,
    manifest: &Value,
    catalog: &Value,
    component_id: &str,
    channel: &str,
    target_id: &str,
) -> Result<VerifiedComponentManifest, String> {
    let manifest_digest = verify_self_digest(manifest, "manifestDigest")?;
    if !matches!(
        manifest.get("schemaVersion").and_then(Value::as_u64),
        Some(1 | 2)
    ) || manifest.get("channel").and_then(Value::as_str) != Some(channel)
        || index.get("channel").and_then(Value::as_str) != Some(channel)
    {
        return Err("release index/manifest schemaVersion 或 channel 不匹配。".to_string());
    }
    let catalog_component = catalog_component(catalog, component_id)?;
    validate_manifest_protocol_and_content(manifest, catalog, catalog_component, component_id)?;
    let target_entry = catalog_component
        .get("targets")
        .and_then(Value::as_array)
        .and_then(|targets| {
            targets
                .iter()
                .find(|target| target.get("targetId").and_then(Value::as_str) == Some(target_id))
        })
        .ok_or_else(|| format!("catalog component `{component_id}` 没有 target `{target_id}`。"))?;
    let target = catalog
        .get("targets")
        .and_then(Value::as_array)
        .and_then(|targets| {
            targets
                .iter()
                .find(|target| target.get("id").and_then(Value::as_str) == Some(target_id))
        })
        .and_then(|target| target.get("target"))
        .ok_or_else(|| format!("Workspace catalog 缺少 target `{target_id}` tuple。"))?;
    if manifest.get("target") != Some(target)
        || manifest.get("componentId").and_then(Value::as_str) != Some(component_id)
    {
        return Err("release manifest component/target 与 Workspace catalog 不匹配。".to_string());
    }
    validate_manifest_dependencies(manifest, catalog, catalog_component, component_id)?;
    let version = manifest
        .get("version")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .ok_or_else(|| "release manifest version 无效。".to_string())?
        .to_string();
    let release_id = manifest
        .get("releaseId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= 160)
        .ok_or_else(|| "release manifest releaseId 无效。".to_string())?
        .to_string();
    let publisher = catalog_component
        .get("publisher")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("catalog component `{component_id}` 缺少 publisher。"))?;
    validate_release_index(index, catalog, publisher, channel)?;
    if manifest.get("schemaVersion").and_then(Value::as_u64) == Some(2) {
        validate_manifest_source_matches_index(index, manifest)?;
    }
    validate_source_provenance(manifest, catalog, publisher, channel, None)?;
    let entry = index
        .get("releases")
        .and_then(Value::as_array)
        .and_then(|releases| {
            releases.iter().find(|release| {
                release.get("componentId").and_then(Value::as_str) == Some(component_id)
                    && release.get("manifestDigest").and_then(Value::as_str)
                        == Some(manifest_digest.as_str())
            })
        })
        .ok_or_else(|| "release index 没有 pin 该组件 manifest digest。".to_string())?;
    if entry.get("version").and_then(Value::as_str) != Some(version.as_str())
        || entry.get("target") != Some(target)
    {
        return Err("release index entry 与 manifest version/target 不匹配。".to_string());
    }
    let manifest_uri = entry
        .get("manifestUri")
        .and_then(Value::as_str)
        .ok_or_else(|| "release index entry 缺少 manifestUri。".to_string())?;
    validate_immutable_manifest_uri(manifest_uri, publisher)?;
    let manifest_subject = release_asset_name(manifest_uri)?;
    validate_source_provenance(
        manifest,
        catalog,
        publisher,
        channel,
        Some(manifest_subject),
    )?;
    let artifact = manifest
        .get("artifact")
        .ok_or_else(|| "release manifest 缺少 artifact。".to_string())?;
    let artifact_kind = artifact
        .get("kind")
        .and_then(Value::as_str)
        .filter(|kind| Some(*kind) == target_entry.get("artifactKind").and_then(Value::as_str))
        .ok_or_else(|| "manifest artifact kind 与 catalog target 不匹配。".to_string())?
        .to_string();
    let artifact_uri = artifact
        .get("uri")
        .and_then(Value::as_str)
        .ok_or_else(|| "manifest artifact 缺少 uri。".to_string())?
        .to_string();
    validate_immutable_manifest_uri(&artifact_uri, publisher)?;
    if manifest["provenance"]["attestation"]["subjectName"].as_str()
        != Some(release_asset_name(&artifact_uri)?)
    {
        return Err(
            "manifest artifact attestation subjectName 必须等于 artifact asset 名称。".to_string(),
        );
    }
    let artifact_digest = if artifact_kind == "oci-image" {
        artifact.get("digest").and_then(Value::as_str)
    } else {
        artifact.get("sha256").and_then(Value::as_str)
    }
    .filter(|digest| is_digest(digest))
    .ok_or_else(|| "manifest artifact digest 无效。".to_string())?
    .to_string();
    let files = artifact
        .get("files")
        .and_then(Value::as_object)
        .ok_or_else(|| "manifest artifact 缺少 files map。".to_string())?
        .iter()
        .map(|(name, digest)| {
            let digest = digest
                .as_str()
                .filter(|digest| is_digest(digest))
                .ok_or_else(|| format!("manifest artifact file `{name}` digest 无效。"))?;
            Ok((name.clone(), digest.to_string()))
        })
        .collect::<Result<BTreeMap<_, _>, String>>()?;
    let artifact_size_bytes = artifact
        .get("sizeBytes")
        .and_then(Value::as_u64)
        .filter(|size| *size > 0 && *size <= 1_073_741_824)
        .ok_or_else(|| "manifest artifact sizeBytes 无效或超过 1 GiB。".to_string())?;
    Ok(VerifiedComponentManifest {
        component_id: component_id.to_string(),
        manifest_digest,
        version,
        release_id,
        artifact_kind,
        artifact_uri,
        artifact_digest,
        artifact_size_bytes,
        files,
    })
}

/// Match the dependency metadata embedded in a Product image to the verified SDK release.
pub fn validate_runtime_maintenance_sdk_labels(
    labels: &Value,
    sdk: &VerifiedComponentManifest,
) -> Result<(), String> {
    const SDK_ID: &str = "cyrene-runtime-maintenance-sdk";
    const SDK_VERSION: &str = "0.1.0";
    const WHEEL_NAME: &str = "cyrene_runtime_maintenance-0.1.0-py3-none-any.whl";
    if sdk.component_id != SDK_ID
        || sdk.version != SDK_VERSION
        || sdk.artifact_kind != "python-bundle"
    {
        return Err("已验证 SDK release 身份、版本或制品类型不匹配。".to_string());
    }
    let label = |name: &str| {
        labels
            .get(name)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| format!("Product image 缺少 `{name}` SDK provenance label。"))
    };
    let manifest_sha = label("io.cyrene.runtime-maintenance.manifest-sha256")?;
    let wheel_sha = label("io.cyrene.runtime-maintenance.wheel-sha256")?;
    let release_id = label("io.cyrene.runtime-maintenance.release-id")?;
    let version = label("io.cyrene.runtime-maintenance.sdk-version")?;
    if !is_raw_sha256(manifest_sha) || !is_raw_sha256(wheel_sha) {
        return Err("Product image SDK digest labels 必须是 64 位小写十六进制。".to_string());
    }
    let expected_manifest = format!("sha256:{manifest_sha}");
    let expected_wheel = format!("sha256:{wheel_sha}");
    if expected_manifest != sdk.manifest_digest
        || sdk.files.get(WHEEL_NAME) != Some(&expected_wheel)
        || release_id != sdk.release_id
        || version != SDK_VERSION
    {
        return Err(
            "Product image SDK labels 与通过 attestation 验证的 SDK manifest 不一致。".to_string(),
        );
    }
    Ok(())
}

fn is_raw_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn release_asset_name(uri: &str) -> Result<&str, String> {
    uri.rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .ok_or_else(|| "release asset URI 缺少文件名。".to_string())
}

pub fn validate_source_provenance(
    value: &Value,
    catalog: &Value,
    publisher: &str,
    channel: &str,
    expected_subject: Option<&str>,
) -> Result<(), String> {
    let publisher_record = catalog
        .get("publishers")
        .and_then(Value::as_array)
        .and_then(|publishers| {
            publishers
                .iter()
                .find(|record| record.get("repository").and_then(Value::as_str) == Some(publisher))
        })
        .ok_or_else(|| format!("publisher `{publisher}` 未在 catalog pin。"))?;
    let source = value
        .get("source")
        .ok_or_else(|| "release metadata 缺少 source。".to_string())?;
    let expected_repository = format!("https://github.com/{publisher}");
    if source.get("repository").and_then(Value::as_str) != Some(expected_repository.as_str()) {
        return Err("release source repository 与 catalog publisher 不匹配。".to_string());
    }
    let source_ref = source
        .get("ref")
        .and_then(Value::as_str)
        .ok_or_else(|| "release source 缺少 ref。".to_string())?;
    let allowed_refs = catalog["channels"][channel]["sourceRefs"]
        .as_array()
        .ok_or_else(|| format!("catalog channel `{channel}` sourceRefs 无效。"))?;
    if !allowed_refs
        .iter()
        .any(|reference| reference.as_str() == Some(source_ref))
    {
        return Err(format!(
            "release source ref `{source_ref}` 不允许进入 `{channel}` channel。"
        ));
    }
    let commit = source
        .get("commit")
        .and_then(Value::as_str)
        .ok_or_else(|| "release source 缺少 commit。".to_string())?;
    if !matches!(commit.len(), 40 | 64)
        || !commit
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err("release source commit 必须是完整 Git SHA。".to_string());
    }
    let attestation = value
        .get("provenance")
        .and_then(|provenance| provenance.get("attestation"))
        .ok_or_else(|| "release metadata 缺少 GitHub artifact attestation。".to_string())?;
    let workflow = publisher_record
        .get("workflow")
        .and_then(Value::as_str)
        .ok_or_else(|| "catalog publisher 缺少固定 workflow。".to_string())?;
    if attestation.get("kind").and_then(Value::as_str) != Some("github-artifact-attestation")
        || attestation.get("repository").and_then(Value::as_str) != Some(publisher)
        || attestation.get("workflow").and_then(Value::as_str) != Some(workflow)
        || attestation.get("predicateType").and_then(Value::as_str)
            != Some("https://slsa.dev/provenance/v1")
    {
        return Err("GitHub attestation identity 与 catalog workflow 不匹配。".to_string());
    }
    if let Some(subject) = expected_subject {
        if attestation.get("subjectName").and_then(Value::as_str) != Some(subject) {
            return Err("release index attestation subjectName 不匹配。".to_string());
        }
    }
    let run = attestation
        .get("run")
        .ok_or_else(|| "GitHub attestation 缺少 Actions run identity。".to_string())?;
    let run_id = run
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 30
                && value.bytes().all(|byte| byte.is_ascii_digit())
        })
        .ok_or_else(|| "GitHub attestation run id 无效。".to_string())?;
    let attempt = run
        .get("attempt")
        .and_then(Value::as_u64)
        .filter(|value| *value > 0)
        .ok_or_else(|| "GitHub attestation run attempt 无效。".to_string())?;
    let expected_run_url =
        format!("https://github.com/{publisher}/actions/runs/{run_id}/attempts/{attempt}");
    if run.get("url").and_then(Value::as_str) != Some(expected_run_url.as_str()) {
        return Err("GitHub attestation run URL 与固定 repository/id/attempt 不匹配。".to_string());
    }
    Ok(())
}

pub fn validate_immutable_manifest_uri(uri: &str, publisher: &str) -> Result<(), String> {
    let prefix = format!("https://github.com/{publisher}/releases/download/");
    let tail = uri
        .strip_prefix(&prefix)
        .ok_or_else(|| "manifestUri 必须指向 catalog publisher 的 GitHub Release。".to_string())?;
    let parts = tail.split('/').collect::<Vec<_>>();
    if parts.len() != 2
        || parts.iter().any(|part| {
            part.is_empty()
                || *part == "."
                || *part == ".."
                || !part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"._+-".contains(&byte))
        })
        || parts[1] == "component-release-index-v1.json"
    {
        return Err("manifestUri 必须是固定 owner/repo/release/tag/asset 路径。".to_string());
    }
    Ok(())
}

pub fn is_digest(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|hex| {
        hex.len() == 64
            && hex
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
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

fn validate_safe_numbers(value: &Value) -> Result<(), String> {
    match value {
        Value::Number(number) => {
            if number.is_f64()
                || number
                    .as_i64()
                    .is_some_and(|integer| integer.unsigned_abs() > 9_007_199_254_740_991)
                || number
                    .as_u64()
                    .is_some_and(|integer| integer > 9_007_199_254_740_991)
            {
                return Err("JCS digest 内容不得含浮点或超出安全整数范围的数字。".to_string());
            }
        }
        Value::Array(values) => {
            for value in values {
                validate_safe_numbers(value)?;
            }
        }
        Value::Object(values) => {
            for value in values.values() {
                validate_safe_numbers(value)?;
            }
        }
        _ => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::{
        plan_id_and_digest, plan_id_and_digest_with_authority_artifact,
        validate_manifest_protocol_and_content, validate_runtime_maintenance_sdk_labels,
        verify_self_digest, PlanComponentDigest, VerifiedComponentManifest,
    };
    use serde_json::Value;

    fn verify_fixture(full_json: &str, canonical_json: &str, digest_field: &str, expected: &str) {
        let value: Value = serde_json::from_str(full_json).expect("fixture JSON");
        let canonical = serde_json::from_str::<Value>(canonical_json).expect("canonical JSON");
        let generated = verify_self_digest(&value, digest_field).expect("valid fixture digest");
        assert_eq!(generated, expected);
        assert_eq!(
            serde_jcs::to_vec(&{
                let mut material = value.clone();
                material
                    .as_object_mut()
                    .expect("object")
                    .remove(digest_field);
                material
            })
            .expect("canonical bytes"),
            serde_jcs::to_vec(&canonical).expect("fixture canonical")
        );
    }

    #[test]
    fn manifest_and_index_match_platform_jcs_golden_fixtures() {
        verify_fixture(
            include_str!("../tests/fixtures/component-release-manifest-v1.json"),
            include_str!("../tests/fixtures/component-release-manifest-v1.jcs.json"),
            "manifestDigest",
            "sha256:654e19576acd276666231efd99e99bdb4d10f415a19c4878958c86ecad8ee05f",
        );
        verify_fixture(
            include_str!("../tests/fixtures/component-release-index-v1.json"),
            include_str!("../tests/fixtures/component-release-index-v1.jcs.json"),
            "indexDigest",
            "sha256:518784fa3bf5346efa1aa3f32ea073e4d9bdeb41c38b656612e53c62ec7023f2",
        );
    }

    #[test]
    fn update_plan_digest_is_channel_bound_and_order_independent() {
        let component = |component_id: &str| PlanComponentDigest {
            component_id: component_id.to_string(),
            version: "0.1.0".to_string(),
            manifest_digest: format!("sha256:{}", "a".repeat(64)),
            artifact_digest: format!("sha256:{}", "b".repeat(64)),
            restart_group: "single-service".to_string(),
            protocol_version: None,
            content_digest: None,
            target_id: None,
        };
        let (plan_id_a, digest_a) = plan_id_and_digest(
            "stable",
            &[component("cyrene-yield"), component("cyrene-echo")],
        )
        .expect("plan digest");
        let (plan_id_b, digest_b) = plan_id_and_digest(
            "stable",
            &[component("cyrene-echo"), component("cyrene-yield")],
        )
        .expect("plan digest");
        let (_, preview_digest) = plan_id_and_digest(
            "preview",
            &[component("cyrene-yield"), component("cyrene-echo")],
        )
        .expect("preview plan digest");
        assert_eq!(plan_id_a, plan_id_b);
        assert_eq!(digest_a, digest_b);
        assert_ne!(digest_a, preview_digest);
    }

    #[test]
    fn authority_bundle_identity_is_bound_into_v2_group_plan_digest() {
        let component = PlanComponentDigest {
            component_id: "cy-workspace-authority-host".to_string(),
            version: "0.2.0".to_string(),
            manifest_digest: format!("sha256:{}", "a".repeat(64)),
            artifact_digest: format!("sha256:{}", "b".repeat(64)),
            restart_group: "workspace-product-v2".to_string(),
            protocol_version: Some("cyrene.workspace.authority.v2".to_string()),
            content_digest: Some(format!("sha256:{}", "b".repeat(64))),
            target_id: Some("windows-10.0-x86_64-docker-linux".to_string()),
        };
        let artifact_a = format!("sha256:{}", "c".repeat(64));
        let artifact_b = format!("sha256:{}", "d".repeat(64));
        let (_, digest_a) = plan_id_and_digest_with_authority_artifact(
            "stable",
            std::slice::from_ref(&component),
            Some(&artifact_a),
        )
        .expect("bound plan digest");
        let (_, digest_b) =
            plan_id_and_digest_with_authority_artifact("stable", &[component], Some(&artifact_b))
                .expect("bound plan digest");
        assert_ne!(digest_a, digest_b);
    }

    #[test]
    fn v2_protocol_and_content_digests_are_pinned_to_catalog_and_immutable_oci_digest() {
        let digest = format!("sha256:{}", "a".repeat(64));
        let manifest = serde_json::json!({
            "schemaVersion": 2,
            "releaseId": "stable-1111111111111111111111111111111111111111",
            "componentId": "cyrene-sample",
            "version": "1.2.3",
            "channel": "stable",
            "target": {},
            "artifact": {"kind": "oci-image", "digest": digest},
            "dependencies": [],
            "restart": {"group": "single-service"},
            "source": {},
            "provenance": {},
            "manifestDigest": format!("sha256:{}", "b".repeat(64)),
            "protocolVersion": "cyrene.sample.v1",
            "contentDigest": format!("sha256:{}", "a".repeat(64)),
        });
        let component = serde_json::json!({
            "componentId": "cyrene-sample",
            "protocolVersion": "cyrene.sample.v1",
        });
        let catalog = serde_json::json!({});
        validate_manifest_protocol_and_content(&manifest, &catalog, &component, "cyrene-sample")
            .expect("matching v2 protocol and immutable OCI digest");
    }

    #[test]
    fn compatibility_group_member_protocol_uses_its_component_pin() {
        let digest = format!("sha256:{}", "a".repeat(64));
        let lock = serde_json::json!({
            "repository": "DoHorizon-AI/Cyrene-Platform",
            "commit": "1111111111111111111111111111111111111111",
            "path": "contracts/workspace-product-v2.lock.json",
            "sha256": format!("sha256:{}", "b".repeat(64)),
        });
        let group_id = "workspace-product-v2";
        let wire_version = "cyrene.workspace.product.v2";
        let protocol_version = "cyrene.workspace.authority.v2";
        let catalog = serde_json::json!({
            "compatibilityGroups": [{
                "groupId": group_id,
                "contractApiVersion": "0.1.0",
                "wireApiVersion": wire_version,
                "members": [{
                    "componentId": "cy-workspace-authority-host",
                    "protocolVersion": protocol_version,
                    "requiredForAdoption": true,
                }],
            }],
        });
        let component = serde_json::json!({
            "componentId": "cy-workspace-authority-host",
            "compatibilityGroup": group_id,
        });
        let mut manifest = serde_json::json!({
            "schemaVersion": 2,
            "releaseId": "stable-1111111111111111111111111111111111111111",
            "componentId": "cy-workspace-authority-host",
            "version": "0.2.0",
            "channel": "stable",
            "target": {},
            "artifact": {"kind": "oci-image", "digest": digest},
            "dependencies": [],
            "restart": {"group": "workspace-product-v2"},
            "source": {},
            "provenance": {},
            "manifestDigest": format!("sha256:{}", "c".repeat(64)),
            "protocolVersion": protocol_version,
            "contentDigest": format!("sha256:{}", "a".repeat(64)),
            "compatibility": {
                "groupId": group_id,
                "contractApiVersion": "0.1.0",
                "wireApiVersion": wire_version,
                "contractLock": lock,
            },
        });
        validate_manifest_protocol_and_content(
            &manifest,
            &catalog,
            &component,
            "cy-workspace-authority-host",
        )
        .expect("authority member protocol pin differs from group wire version");
        manifest["protocolVersion"] = Value::from(wire_version);
        assert!(validate_manifest_protocol_and_content(
            &manifest,
            &catalog,
            &component,
            "cy-workspace-authority-host",
        )
        .is_err());
    }

    #[test]
    fn v2_rejects_unknown_fields_unpinned_protocol_and_mismatched_content_digest() {
        let make_manifest = || {
            serde_json::json!({
                "schemaVersion": 2,
                "releaseId": "stable-1111111111111111111111111111111111111111",
                "componentId": "cyrene-sample",
                "version": "1.2.3",
                "channel": "stable",
                "target": {},
                "artifact": {"kind": "oci-image", "digest": format!("sha256:{}", "a".repeat(64))},
                "dependencies": [],
                "restart": {"group": "single-service"},
                "source": {},
                "provenance": {},
                "manifestDigest": format!("sha256:{}", "b".repeat(64)),
                "protocolVersion": "cyrene.sample.v1",
                "contentDigest": format!("sha256:{}", "a".repeat(64)),
            })
        };
        let component = serde_json::json!({
            "componentId": "cyrene-sample",
            "protocolVersion": "cyrene.sample.v1",
        });
        let catalog = serde_json::json!({});
        let mut manifest = make_manifest();
        manifest["unreviewedExtension"] = Value::from(true);
        assert!(validate_manifest_protocol_and_content(
            &manifest,
            &catalog,
            &component,
            "cyrene-sample"
        )
        .is_err());

        let mut manifest = make_manifest();
        manifest["contentDigest"] = Value::from(format!("sha256:{}", "c".repeat(64)));
        assert!(validate_manifest_protocol_and_content(
            &manifest,
            &catalog,
            &component,
            "cyrene-sample"
        )
        .is_err());

        let mut manifest = make_manifest();
        manifest["protocolVersion"] = Value::from("cyrene.sample.v2");
        assert!(validate_manifest_protocol_and_content(
            &manifest,
            &catalog,
            &component,
            "cyrene-sample"
        )
        .is_err());
    }

    #[test]
    fn self_digest_rejects_float_values_and_mutated_content() {
        let float_value = serde_json::json!({"manifestDigest":"sha256:0000000000000000000000000000000000000000000000000000000000000000","sizeBytes":1.5});
        assert!(verify_self_digest(&float_value, "manifestDigest").is_err());
        let mut mutated: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/component-release-manifest-v1.json"
        ))
        .expect("manifest fixture");
        mutated["version"] = Value::from("9.9.9");
        assert!(verify_self_digest(&mutated, "manifestDigest").is_err());
    }

    #[test]
    fn sdk_image_labels_must_match_the_verified_sdk_manifest() {
        let wheel_digest = format!("sha256:{}", "b".repeat(64));
        let verified = VerifiedComponentManifest {
            component_id: "cyrene-runtime-maintenance-sdk".to_string(),
            manifest_digest: format!("sha256:{}", "a".repeat(64)),
            version: "0.1.0".to_string(),
            release_id: "preview-1111111111111111111111111111111111111111".to_string(),
            artifact_kind: "python-bundle".to_string(),
            artifact_uri: "https://example.invalid/sdk.tar.gz".to_string(),
            artifact_digest: format!("sha256:{}", "c".repeat(64)),
            artifact_size_bytes: 512,
            files: BTreeMap::from([(
                "cyrene_runtime_maintenance-0.1.0-py3-none-any.whl".to_string(),
                wheel_digest.clone(),
            )]),
        };
        let labels = serde_json::json!({
            "io.cyrene.runtime-maintenance.manifest-sha256": "a".repeat(64),
            "io.cyrene.runtime-maintenance.wheel-sha256": "b".repeat(64),
            "io.cyrene.runtime-maintenance.release-id": "preview-1111111111111111111111111111111111111111",
            "io.cyrene.runtime-maintenance.sdk-version": "0.1.0",
        });
        assert!(validate_runtime_maintenance_sdk_labels(&labels, &verified).is_ok());

        let mut mismatched = labels;
        mismatched["io.cyrene.runtime-maintenance.wheel-sha256"] = Value::from("d".repeat(64));
        assert!(validate_runtime_maintenance_sdk_labels(&mismatched, &verified).is_err());
    }
}
