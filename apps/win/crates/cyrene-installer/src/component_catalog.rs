//! ┌─────────────────────────────────────────────────────────────────────┐
//! │  📄 component_catalog.rs                                             │
//! │  Module: installer::component_catalog                               │
//! │  Role: Load and validate the active Windows Workspace catalog.      │
//! │                                                                      │
//! │  模块职责：读取可信动态目录，并限定本机支持的平台更新身份。            │
//! └─────────────────────────────────────────────────────────────────────┘

use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::ops::Deref;
use std::path::Path;

const EMBEDDED_CATALOG: &str = include_str!("component-catalog-v1.json");
const CATALOG_RAW_SHA256: &str = "9908229d8abee4cb3f1b5a55d8be5264310939e4b43700de0dfd37be7318c701";
const WINDOWS_TARGET_ID: &str = "windows-10.0-x86_64-docker-linux";

/// A validated catalog and the signed release identity that supplied its raw bytes.
#[derive(Clone, Debug)]
pub struct TrustedCatalog {
    pub document: Value,
    pub generation: u64,
    pub digest: String,
    pub metadata: Option<crate::catalog_metadata::CatalogMetadata>,
}

impl Deref for TrustedCatalog {
    type Target = Value;

    fn deref(&self) -> &Self::Target {
        &self.document
    }
}

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

const PLUGINS_CONNECTION_COMPONENT_IDS: &[&str] = &[
    "cy-workspace-connector",
    "cy-workspace-frontend-bridge",
    "cy-workspace-relay",
    "cy-workspace-sidecar",
];

/// Load the active catalog after re-verifying its detached GitHub attestation.
///
/// The embedded catalog is used only when no catalog state has ever been imported.
pub fn trusted_catalog_at(app_dir: &Path) -> Result<TrustedCatalog, String> {
    if let Some(package) = crate::catalog_metadata::load_active(app_dir)? {
        return catalog_from_package(&package);
    }

    let document = parse_catalog(EMBEDDED_CATALOG.as_bytes(), CATALOG_RAW_SHA256)?;
    let generation = document["generation"]
        .as_u64()
        .ok_or_else(|| "嵌入的 Workspace catalog generation 无效。".to_string())?;
    Ok(TrustedCatalog {
        document,
        generation,
        digest: format!("sha256:{CATALOG_RAW_SHA256}"),
        metadata: None,
    })
}

/// Recover an interrupted cache activation while the caller holds the shared updater lock.
///
/// Ordinary catalog reads never write state; callers that coordinate update operations must
/// recover first under the same cross-process lock used by imports and service updates.
pub fn recover_active_catalog(app_dir: &Path) -> Result<(), String> {
    crate::catalog_metadata::recover_active(app_dir).map(|_| ())
}

/// Verify, validate, and explicitly activate one immutable Workspace catalog release.
pub fn import_catalog_release(
    app_dir: &Path,
    channel: &str,
    release_id: &str,
) -> Result<TrustedCatalog, String> {
    let package = crate::catalog_metadata::fetch_release(channel, release_id)?;
    let candidate = catalog_from_package(&package)?;
    let current = match trusted_catalog_at(app_dir) {
        Ok(current) => Some(current),
        Err(error)
            if error
                .starts_with(crate::catalog_metadata::CATALOG_ROOT_MISSING_COMMITTED_PREFIX)
                || error
                    .starts_with(crate::catalog_metadata::CATALOG_ROOT_MISSING_PENDING_PREFIX) =>
        {
            None
        }
        Err(error) => return Err(error),
    };
    if let Some(current) = current.as_ref() {
        ensure_not_older_catalog(current, &candidate)?;
    }
    let (bootstrap_generation, bootstrap_digest) = match current.as_ref() {
        Some(current) => (current.generation, current.digest.as_str()),
        None => {
            let embedded = parse_catalog(EMBEDDED_CATALOG.as_bytes(), CATALOG_RAW_SHA256)?;
            let generation = embedded["generation"]
                .as_u64()
                .ok_or_else(|| "嵌入的 Workspace catalog generation 无效。".to_string())?;
            (generation, CATALOG_RAW_SHA256)
        }
    };
    crate::catalog_metadata::activate(app_dir, &package, bootstrap_generation, bootstrap_digest)?;
    trusted_catalog_at(app_dir)
}

/// Discover and verify the latest channel catalog without changing the active catalog.
pub fn latest_catalog_candidate(
    app_dir: &Path,
    channel: &str,
) -> Result<Option<TrustedCatalog>, String> {
    let Some(release_id) = crate::catalog_metadata::latest_release_id(channel)? else {
        return Ok(None);
    };
    let package = crate::catalog_metadata::fetch_release(channel, &release_id)?;
    let candidate = catalog_from_package(&package)?;
    let current = trusted_catalog_at(app_dir)?;
    ensure_not_older_catalog(&current, &candidate)?;
    Ok(Some(candidate))
}

fn catalog_from_package(
    package: &crate::catalog_metadata::CatalogPackage,
) -> Result<TrustedCatalog, String> {
    crate::catalog_metadata::verify_package(package)?;
    let digest = package
        .metadata
        .catalog_sha256
        .strip_prefix("sha256:")
        .ok_or_else(|| "catalog receipt catalogSha256 格式无效。".to_string())?;
    let document = parse_catalog(&package.raw, digest)?;
    validate_plugins_connection_discovery(&document)?;
    let generation = document
        .get("generation")
        .and_then(Value::as_u64)
        .ok_or_else(|| "受信 Workspace catalog generation 无效。".to_string())?;
    if generation != package.metadata.generation {
        return Err("受信 Workspace catalog generation 与 release receipt 不一致。".to_string());
    }
    Ok(TrustedCatalog {
        document,
        generation,
        digest: package.metadata.catalog_sha256.clone(),
        metadata: Some(package.metadata.clone()),
    })
}

fn ensure_not_older_catalog(
    current: &TrustedCatalog,
    candidate: &TrustedCatalog,
) -> Result<(), String> {
    if candidate.generation < current.generation {
        return Err(format!(
            "Workspace catalog generation 回退：active={} candidate={}。",
            current.generation, candidate.generation
        ));
    }
    if candidate.generation == current.generation && candidate.digest != current.digest {
        return Err("同一 Workspace catalog generation 不得对应不同 SHA-256。".to_string());
    }
    Ok(())
}

/// Return the immutable bootstrap catalog for source-level validation.
#[cfg(test)]
pub fn trusted_catalog() -> Result<TrustedCatalog, String> {
    let document = parse_catalog(EMBEDDED_CATALOG.as_bytes(), CATALOG_RAW_SHA256)?;
    let generation = document["generation"]
        .as_u64()
        .ok_or_else(|| "嵌入的 Workspace catalog generation 无效。".to_string())?;
    Ok(TrustedCatalog {
        document,
        generation,
        digest: format!("sha256:{CATALOG_RAW_SHA256}"),
        metadata: None,
    })
}

/// Verify raw catalog bytes against their expected SHA-256 before parsing them.
pub fn parse_catalog(bytes: &[u8], expected_sha256: &str) -> Result<Value, String> {
    let actual_sha256 = Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    if actual_sha256 != expected_sha256 {
        return Err(format!(
            "Workspace component catalog SHA-256 不匹配（expected {expected_sha256}, actual {actual_sha256}）。"
        ));
    }
    let catalog: Value = serde_json::from_slice(bytes)
        .map_err(|error| format!("Workspace component catalog JSON 无效: {error}"))?;
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
    if catalog
        .get("generation")
        .and_then(Value::as_u64)
        .is_none_or(|value| value == 0)
    {
        return Err("Workspace catalog generation 无效。".to_string());
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
        let workflow = publisher
            .get("workflow")
            .and_then(Value::as_str)
            .filter(|workflow| valid_publisher_workflow(workflow, repository))
            .ok_or_else(|| {
                format!("Workspace publisher `{repository}` workflow identity 无效。")
            })?;
        if workflow.len() > 256 {
            return Err(format!(
                "Workspace publisher `{repository}` workflow identity 超出长度限制。"
            ));
        }
        let expected_api =
            format!("https://api.github.com/repos/{repository}/releases?per_page=100");
        if publisher["releaseDiscovery"]
            .as_object()
            .is_none_or(|value| value.len() != 2)
            || publisher["releaseDiscovery"]["apiUri"].as_str() != Some(expected_api.as_str())
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
        if let Some(discovery) = component.get("releaseDiscovery") {
            if discovery.as_object().is_none_or(|value| value.len() != 1) {
                return Err(format!(
                    "Workspace component `{component_id}` releaseDiscovery 格式无效。"
                ));
            }
            let prefixes = discovery.get("tagPrefixes").ok_or_else(|| {
                format!("Workspace component `{component_id}` releaseDiscovery 缺少 tagPrefixes。")
            })?;
            if prefixes.as_object().is_none_or(|value| value.len() != 2) {
                return Err(format!(
                    "Workspace component `{component_id}` tagPrefixes 必须仅包含 preview/stable。"
                ));
            }
            for channel in ["preview", "stable"] {
                let expected = format!("{channel}-{component_id}-");
                if prefixes.get(channel).and_then(Value::as_str) != Some(expected.as_str()) {
                    return Err(format!(
                        "Workspace component `{component_id}` 的 `{channel}` release tag prefix 不匹配。"
                    ));
                }
            }
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

/// Require component-scoped release tags before accepting a dynamically imported catalog.
///
/// The embedded generation-5 bootstrap predates this field and remains usable for its other
/// pinned targets. Imported catalogs follow the shared metadata contract and must declare all
/// four Plugins connection components explicitly so another component's release cannot mask
/// their candidates.
fn validate_plugins_connection_discovery(catalog: &Value) -> Result<(), String> {
    let components = catalog
        .get("components")
        .and_then(Value::as_array)
        .ok_or_else(|| "Workspace component catalog 缺少 components。".to_string())?;
    for component_id in PLUGINS_CONNECTION_COMPONENT_IDS {
        let component = components
            .iter()
            .find(|component| {
                component.get("componentId").and_then(Value::as_str) == Some(component_id)
            })
            .ok_or_else(|| {
                format!("动态 Workspace catalog 缺少 Plugins component `{component_id}`。")
            })?;
        let discovery = component
            .get("releaseDiscovery")
            .and_then(Value::as_object)
            .filter(|discovery| discovery.len() == 1)
            .ok_or_else(|| {
                format!("动态 Workspace component `{component_id}` 缺少 releaseDiscovery。")
            })?;
        let prefixes = discovery
            .get("tagPrefixes")
            .and_then(Value::as_object)
            .filter(|prefixes| prefixes.len() == 2)
            .ok_or_else(|| {
                format!("动态 Workspace component `{component_id}` tagPrefixes 无效。")
            })?;
        for channel in ["preview", "stable"] {
            let expected = format!("{channel}-{component_id}-");
            if prefixes.get(channel).and_then(Value::as_str) != Some(expected.as_str()) {
                return Err(format!(
                    "动态 Workspace component `{component_id}` 的 `{channel}` tag prefix 不匹配。"
                ));
            }
        }
    }
    Ok(())
}

fn valid_publisher_workflow(workflow: &str, repository: &str) -> bool {
    let prefix = format!("{repository}/.github/workflows/");
    let Some(path) = workflow.strip_prefix(&prefix) else {
        return false;
    };
    !path.is_empty()
        && path.len() <= 192
        && !path.starts_with('/')
        && !path.contains("..")
        && !path.contains('\\')
        && path
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"/._-".contains(&byte))
        && (path.ends_with(".yml") || path.ends_with(".yaml"))
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
        assert_eq!(catalog["generation"], Value::from(9));
    }

    #[test]
    fn embedded_catalog_supports_only_the_five_linux22_python_products() {
        let catalog = trusted_catalog().expect("embedded catalog pin should match");
        let target_id = "linux-ubuntu-22.04-x86_64-python-3.12";
        let target = catalog["targets"]
            .as_array()
            .expect("catalog targets should be an array")
            .iter()
            .find(|target| target["id"] == target_id)
            .expect("Ubuntu 22.04 Python target should be present");

        assert_eq!(target["hostSupport"], "supported");
        assert_eq!(target["target"]["osVersion"], "22.04");
        assert_eq!(target["target"]["distributionVersion"], "22.04");
        assert_eq!(target["target"]["architecture"], "x86_64");
        assert_eq!(target["target"]["abi"], "glibc-2.35");
        assert_eq!(target["target"]["runtime"], "python:3.12");

        let components = catalog["components"]
            .as_array()
            .expect("catalog components should be an array");
        for component_id in [
            "cyrene-catalyst",
            "cyrene-exchange",
            "cyrene-navigator",
            "cyrene-reactor",
            "cyrene-yield",
        ] {
            let component = components
                .iter()
                .find(|component| component["componentId"] == component_id)
                .expect("Product component should be present");
            assert!(component["targets"].as_array().is_some_and(|targets| {
                targets.iter().any(|item| {
                    item["targetId"] == target_id
                        && item["artifactKind"] == "python-bundle"
                        && item["support"] == "supported"
                })
            }));
        }

        let echo = components
            .iter()
            .find(|component| component["componentId"] == "cyrene-echo")
            .expect("Echo component should be present");
        assert!(!echo["targets"]
            .as_array()
            .is_some_and(|targets| { targets.iter().any(|item| item["targetId"] == target_id) }));

        let navigator = components
            .iter()
            .find(|component| component["componentId"] == "cyrene-navigator")
            .expect("Navigator component should be present");
        assert!(!navigator["artifactKinds"]
            .as_array()
            .is_some_and(|kinds| kinds.iter().any(|kind| kind == "oci-image")));
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
