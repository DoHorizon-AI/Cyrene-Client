//! Windows Docker runtime identities compiled into the installer.

use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeSet;

const RUNTIME_REGISTRY: &str = include_str!("windows-runtime-services-v2.json");
pub const WINDOWS_DOCKER_TARGET_ID: &str = "windows-10.0-x86_64-docker-linux";

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeService {
    pub component_id: String,
    pub compose_service: String,
    pub container_name: String,
    pub healthcheck: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RuntimeRegistry {
    schema_version: u32,
    target_id: String,
    workspace_group_activity_sources: Vec<String>,
    services: Vec<RuntimeService>,
}

/// Load the fixed Windows OCI runtime identities embedded in this installer build.
pub fn trusted_services() -> Result<Vec<RuntimeService>, String> {
    let registry: RuntimeRegistry = serde_json::from_str(RUNTIME_REGISTRY)
        .map_err(|error| format!("嵌入的 Windows runtime registry JSON 无效: {error}"))?;
    if registry.schema_version != 2
        || registry.target_id != WINDOWS_DOCKER_TARGET_ID
        || registry.services.is_empty()
        || registry.services.len() > 100
        || registry.workspace_group_activity_sources
            != [
                "cyrene-catalyst",
                "cyrene-echo",
                "cyrene-exchange",
                "cyrene-reactor",
                "cyrene-yield",
            ]
    {
        return Err("嵌入的 Windows runtime registry schema/target/services 无效。".to_string());
    }
    let mut component_ids = BTreeSet::new();
    let mut service_names = BTreeSet::new();
    let mut container_names = BTreeSet::new();
    for service in &registry.services {
        if !valid_identifier(&service.component_id, 64)
            || !valid_identifier(&service.compose_service, 63)
            || !valid_identifier(&service.container_name, 63)
            || service.healthcheck != "docker-healthcheck"
            || !component_ids.insert(service.component_id.clone())
            || !service_names.insert(service.compose_service.clone())
            || !container_names.insert(service.container_name.clone())
        {
            return Err(format!(
                "Windows runtime registry component/service/container identity 无效或重复: `{}`。",
                service.component_id
            ));
        }
    }
    Ok(registry.services)
}

/// Resolve the closed set of Product task sources whose admission the Workspace group affects.
pub fn workspace_group_activity_sources() -> Result<Vec<String>, String> {
    let registry: RuntimeRegistry = serde_json::from_str(RUNTIME_REGISTRY)
        .map_err(|error| format!("嵌入的 Windows runtime registry JSON 无效: {error}"))?;
    trusted_services()?;
    Ok(registry.workspace_group_activity_sources)
}

/// Resolve the five installer-owned Workspace group containers in registry order.
pub fn workspace_services() -> Result<Vec<RuntimeService>, String> {
    Ok(trusted_services()?
        .into_iter()
        .filter(|service| service.component_id.starts_with("cy-workspace-"))
        .collect())
}

/// Require exact catalog-to-installer bindings for every supported Windows OCI component.
pub fn validate_catalog_bindings(catalog: &Value) -> Result<(), String> {
    let services = trusted_services()?;
    let catalog_components = catalog
        .get("components")
        .and_then(Value::as_array)
        .ok_or_else(|| "Workspace catalog 缺少 components。".to_string())?;
    let mut catalog_windows_oci = BTreeSet::new();
    for component in catalog_components {
        let component_id = component
            .get("componentId")
            .and_then(Value::as_str)
            .ok_or_else(|| "Workspace catalog component 缺少 componentId。".to_string())?;
        for target_entry in component
            .get("targets")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if target_entry.get("targetId").and_then(Value::as_str)
                != Some(WINDOWS_DOCKER_TARGET_ID)
            {
                if target_entry.get("windowsRuntime").is_some() {
                    return Err(format!(
                        "非 Windows OCI target `{component_id}` 不得声明 windowsRuntime。"
                    ));
                }
                continue;
            }
            let supported_oci = target_entry.get("support").and_then(Value::as_str)
                == Some("supported")
                && target_entry.get("artifactKind").and_then(Value::as_str) == Some("oci-image");
            if !supported_oci {
                if target_entry.get("windowsRuntime").is_some() {
                    return Err(format!(
                        "不受支持的 Windows OCI target `{component_id}` 不得声明 windowsRuntime。"
                    ));
                }
                continue;
            }
            catalog_windows_oci.insert(component_id.to_string());
            let expected = services
                .iter()
                .find(|service| service.component_id == component_id)
                .ok_or_else(|| {
                    format!(
                        "supported Windows OCI component `{component_id}` 没有安装器 runtime identity pin。"
                    )
                })?;
            let mut binding = target_entry
                .get("windowsRuntime")
                .and_then(Value::as_object)
                .cloned()
                .ok_or_else(|| format!("catalog `{component_id}` 缺少 windowsRuntime。"))?;
            binding.insert(
                "componentId".to_string(),
                Value::String(component_id.to_string()),
            );
            let declared: RuntimeService =
                serde_json::from_value(Value::Object(binding)).map_err(|error| {
                    format!("catalog `{component_id}` windowsRuntime 格式无效: {error}")
                })?;
            if declared != *expected {
                return Err(format!(
                    "catalog `{component_id}` windowsRuntime 与安装器受信Compose identity 不匹配。"
                ));
            }
        }
    }
    for service in services {
        if !catalog_windows_oci.contains(&service.component_id) {
            return Err(format!(
                "安装器 Windows runtime component `{}` 未在 catalog 标记为受支持 OCI。",
                service.component_id
            ));
        }
    }
    Ok(())
}

/// Resolve one component identity from the installer-owned registry.
pub fn service(component_id: &str) -> Result<RuntimeService, String> {
    trusted_services()?
        .into_iter()
        .find(|service| service.component_id == component_id)
        .ok_or_else(|| format!("组件 `{component_id}` 不在 Windows installer runtime registry。"))
}

fn valid_identifier(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

#[cfg(test)]
mod tests {
    use super::{trusted_services, WINDOWS_DOCKER_TARGET_ID};

    #[test]
    fn embedded_windows_runtime_identities_are_unique_and_closed() {
        let services = trusted_services().expect("fixed registry is valid");
        assert_eq!(services.len(), 11);
        assert!(services.iter().all(|service| {
            service.healthcheck == "docker-healthcheck"
                && service.compose_service == service.container_name
        }));
        assert_eq!(WINDOWS_DOCKER_TARGET_ID, "windows-10.0-x86_64-docker-linux");
    }
}
