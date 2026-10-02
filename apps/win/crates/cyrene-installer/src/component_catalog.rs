//! ┌─────────────────────────────────────────────────────────────────────┐
//! │  📄 component_catalog.rs                                             │
//! │  Module: installer::component_catalog                               │
//! │  Role: Load the Windows installer’s pinned Workspace catalog.       │
//! │                                                                      │
//! │  模块职责：读取安装器固定的 Workspace 组件目录并限定本机更新身份。      │
//! └─────────────────────────────────────────────────────────────────────┘

use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

const EMBEDDED_CATALOG: &str = include_str!("component-catalog-v1.json");
const CATALOG_RAW_SHA256: &str = "28fc1ef65a38658aeabb2bf23b7a35e91cb64774612f387936a971dfec2bd3dc";
const WINDOWS_TARGET_ID: &str = "windows-10.0-x86_64-docker-linux";

/// Product components that this Windows installer is authorized to restart.
pub const WINDOWS_PRODUCT_COMPONENT_IDS: &[&str] = &[
    "cyrene-catalyst",
    "cyrene-echo",
    "cyrene-exchange",
    "cyrene-reactor",
    "cyrene-yield",
];

/// The broker is cataloged and pinned, but is not a normal Product container update target.
pub const WINDOWS_MAINTENANCE_COMPONENT_ID: &str = "cyrene-runtime-maintenance";

/// Parse and validate the immutable catalog embedded in this installer build.
pub fn trusted_catalog() -> Result<Value, String> {
    parse_catalog(EMBEDDED_CATALOG.as_bytes(), CATALOG_RAW_SHA256)
}

/// Verify catalog bytes against the source-controlled raw SHA-256 pin before parsing them.
pub fn parse_catalog(bytes: &[u8], expected_sha256: &str) -> Result<Value, String> {
    let actual_sha256 = Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    if actual_sha256 != expected_sha256 {
        return Err(format!(
            "嵌入的 Workspace component catalog SHA-256 不匹配（expected {expected_sha256}, actual {actual_sha256}）。"
        ));
    }
    let catalog: Value = serde_json::from_slice(bytes)
        .map_err(|error| format!("嵌入的 Workspace component catalog JSON 无效: {error}"))?;
    validate_catalog(&catalog)?;
    Ok(catalog)
}

/// Check identity and discovery rules required by the local release verifier.
fn validate_catalog(catalog: &Value) -> Result<(), String> {
    if catalog.get("schemaVersion").and_then(Value::as_u64) != Some(1)
        || catalog.get("defaultChannel").and_then(Value::as_str) != Some("stable")
    {
        return Err(
            "Workspace component catalog schemaVersion/defaultChannel 不受支持。".to_string(),
        );
    }
    if catalog.get("generation").and_then(Value::as_u64) != Some(4)
        || catalog["activitySourceCatalog"]["path"].as_str()
            != Some("/var/lib/cyrene/runtime/activity-sources.json")
    {
        return Err("Workspace catalog generation/activity source location 与 Client broker bridge 不匹配。".to_string());
    }
    validate_channel(
        catalog,
        "stable",
        false,
        &["refs/heads/main", "refs/heads/release"],
    )?;
    validate_channel(catalog, "preview", true, &["refs/heads/develop"])?;

    let targets = catalog
        .get("targets")
        .and_then(Value::as_array)
        .ok_or_else(|| "Workspace component catalog 缺少 targets。".to_string())?;
    let windows_target = targets
        .iter()
        .find(|target| target.get("id").and_then(Value::as_str) == Some(WINDOWS_TARGET_ID))
        .ok_or_else(|| {
            "Workspace component catalog 缺少固定 Windows Docker target。".to_string()
        })?;
    if windows_target.get("hostSupport").and_then(Value::as_str) != Some("supported")
        || windows_target["target"]["os"].as_str() != Some("windows")
        || windows_target["target"]["osVersion"].as_str() != Some("10.0")
        || windows_target["target"]["architecture"].as_str() != Some("x86_64")
        || windows_target["target"]["runtime"].as_str() != Some("docker-desktop:linux")
    {
        return Err(
            "Workspace component catalog 的 Windows Docker target 与本机不匹配。".to_string(),
        );
    }

    let publishers = catalog
        .get("publishers")
        .and_then(Value::as_array)
        .ok_or_else(|| "Workspace component catalog 缺少 publishers。".to_string())?;
    let mut publisher_ids = BTreeSet::new();
    for publisher in publishers {
        let repository = publisher
            .get("repository")
            .and_then(Value::as_str)
            .ok_or_else(|| "Workspace publisher 缺少 repository。".to_string())?;
        if !publisher_ids.insert(repository.to_ascii_lowercase()) {
            return Err(format!("Workspace catalog publisher `{repository}` 重复。"));
        }
        let workflow_name = if repository == "DoHorizon-AI/Cyrene-Workspace" {
            "data-bundle-release.yml"
        } else {
            "component-release.yml"
        };
        let expected_workflow = format!("{repository}/.github/workflows/{workflow_name}");
        if publisher.get("workflow").and_then(Value::as_str) != Some(expected_workflow.as_str()) {
            return Err(format!(
                "Workspace publisher `{repository}` workflow 不匹配固定 release workflow。"
            ));
        }
        let expected_api =
            format!("https://api.github.com/repos/{repository}/releases?per_page=100");
        if publisher["releaseDiscovery"]["apiUri"].as_str() != Some(expected_api.as_str())
            || publisher["releaseDiscovery"]["indexAssetName"].as_str()
                != Some("component-release-index-v1.json")
        {
            return Err(format!(
                "Workspace publisher `{repository}` release index locator 无效。"
            ));
        }
    }

    let components = catalog
        .get("components")
        .and_then(Value::as_array)
        .ok_or_else(|| "Workspace component catalog 缺少 components。".to_string())?;
    let mut component_ids = BTreeSet::new();
    for component in components {
        let component_id = component
            .get("componentId")
            .and_then(Value::as_str)
            .ok_or_else(|| "Workspace component 缺少 componentId。".to_string())?;
        if !component_ids.insert(component_id.to_string()) {
            return Err(format!("Workspace component `{component_id}` 重复。"));
        }
        if !publishers.iter().any(|publisher| {
            publisher.get("repository").and_then(Value::as_str)
                == component.get("publisher").and_then(Value::as_str)
        }) {
            return Err(format!(
                "Workspace component `{component_id}` publisher 未固定。"
            ));
        }
    }
    let groups = catalog
        .get("compatibilityGroups")
        .and_then(Value::as_array)
        .filter(|groups| !groups.is_empty() && groups.len() <= 100)
        .ok_or_else(|| "Workspace catalog compatibilityGroups 无效。".to_string())?;
    let mut group_ids = BTreeSet::new();
    let mut grouped_component_ids = BTreeSet::new();
    for group in groups {
        let group_id = group
            .get("groupId")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty() && value.len() <= 128)
            .ok_or_else(|| "compatibility group 缺少有效 groupId。".to_string())?;
        if !group_ids.insert(group_id.to_string())
            || group
                .get("contractApiVersion")
                .and_then(Value::as_str)
                .is_none_or(str::is_empty)
            || group
                .get("wireApiVersion")
                .and_then(Value::as_str)
                .is_none_or(str::is_empty)
        {
            return Err(format!(
                "compatibility group `{group_id}` identity 无效或重复。"
            ));
        }
        let members = group
            .get("members")
            .and_then(Value::as_array)
            .filter(|members| !members.is_empty() && members.len() <= 100)
            .ok_or_else(|| format!("compatibility group `{group_id}` members 无效。"))?;
        let mut member_ids = BTreeSet::new();
        for member in members {
            let component_id = member
                .get("componentId")
                .and_then(Value::as_str)
                .ok_or_else(|| format!("compatibility group `{group_id}` 缺少 componentId。"))?;
            let protocol = member
                .get("protocolVersion")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty() && value.len() <= 128)
                .ok_or_else(|| {
                    format!("compatibility group `{group_id}` member `{component_id}` protocolVersion 无效。")
                })?;
            if member
                .get("requiredForAdoption")
                .and_then(Value::as_bool)
                .is_none()
                || !member_ids.insert(component_id.to_string())
                || !grouped_component_ids.insert(component_id.to_string())
            {
                return Err(format!(
                    "compatibility group `{group_id}` member `{component_id}` 重复或字段无效。"
                ));
            }
            let component = components
                .iter()
                .find(|item| item["componentId"].as_str() == Some(component_id))
                .ok_or_else(|| format!("compatibility group `{group_id}` 引用了未知组件。"))?;
            if component["compatibilityGroup"].as_str() != Some(group_id)
                || component["protocolVersion"]
                    .as_str()
                    .is_some_and(|component_protocol| component_protocol != protocol)
            {
                return Err(format!(
                    "component `{component_id}` group/protocol pin 与 group member 不匹配。"
                ));
            }
        }
    }
    for component in components {
        let component_id = component["componentId"].as_str().unwrap_or_default();
        let has_group = component
            .get("compatibilityGroup")
            .and_then(Value::as_str)
            .is_some();
        if has_group != grouped_component_ids.contains(component_id) {
            return Err(format!(
                "component `{component_id}` compatibilityGroup 与 catalog members 声明不一致。"
            ));
        }
    }
    for component_id in WINDOWS_PRODUCT_COMPONENT_IDS
        .iter()
        .copied()
        .chain(std::iter::once(WINDOWS_MAINTENANCE_COMPONENT_ID))
    {
        let component = components
            .iter()
            .find(|component| component["componentId"].as_str() == Some(component_id))
            .ok_or_else(|| {
                format!("Workspace catalog 缺少必需 Windows component `{component_id}`。")
            })?;
        let target = component
            .get("targets")
            .and_then(Value::as_array)
            .and_then(|items| {
                items.iter().find(|item| {
                    item.get("targetId").and_then(Value::as_str) == Some(WINDOWS_TARGET_ID)
                })
            })
            .ok_or_else(|| {
                format!("Workspace component `{component_id}` 缺少 Windows target 记录。")
            })?;
        if target.get("support").and_then(Value::as_str) != Some("supported")
            || target.get("artifactKind").and_then(Value::as_str) != Some("oci-image")
        {
            return Err(format!(
                "Workspace component `{component_id}` Windows target 未标为受支持 OCI。"
            ));
        }
    }
    crate::windows_runtime::validate_catalog_bindings(catalog)?;
    Ok(())
}

fn validate_channel(
    catalog: &Value,
    channel: &str,
    prerelease: bool,
    source_refs: &[&str],
) -> Result<(), String> {
    let policy = catalog
        .get("channels")
        .and_then(|channels| channels.get(channel))
        .ok_or_else(|| format!("Workspace catalog 缺少 `{channel}` channel policy。"))?;
    let actual_refs = policy
        .get("sourceRefs")
        .and_then(Value::as_array)
        .ok_or_else(|| format!("Workspace `{channel}` channel 缺少 sourceRefs。"))?
        .iter()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>();
    if policy.get("releasePrerelease").and_then(Value::as_bool) != Some(prerelease)
        || actual_refs != source_refs
    {
        return Err(format!(
            "Workspace `{channel}` channel policy 不匹配固定 source refs。"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{parse_catalog, trusted_catalog, WINDOWS_PRODUCT_COMPONENT_IDS};
    use serde_json::Value;

    #[test]
    fn embedded_catalog_matches_its_exact_raw_hash_pin() {
        let catalog = trusted_catalog().expect("embedded catalog pin should match");
        assert_eq!(catalog["schemaVersion"], Value::from(1));
    }

    #[test]
    fn changed_catalog_bytes_are_rejected_before_they_can_change_component_selection() {
        let mut bytes = include_str!("component-catalog-v1.json")
            .as_bytes()
            .to_vec();
        bytes.push(b' ');
        assert!(parse_catalog(
            &bytes,
            "248a9a3b27f3d1daa4c0a6fdc405c612fd492483bb4157ff46b6d2836ffd0d35"
        )
        .is_err());
    }

    #[test]
    fn windows_product_allowlist_contains_the_five_existing_container_ids() {
        assert_eq!(WINDOWS_PRODUCT_COMPONENT_IDS.len(), 5);
        assert!(WINDOWS_PRODUCT_COMPONENT_IDS.contains(&"cyrene-echo"));
        assert!(!WINDOWS_PRODUCT_COMPONENT_IDS.contains(&"product-echo"));
    }
}
