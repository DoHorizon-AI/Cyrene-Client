//! ┌─────────────────────────────────────────────────────────────────────┐
//! │  📄 catalog_metadata.rs                                             │
//! │  Module: installer::catalog_metadata                                │
//! │  Role: Fetch, verify, and safely cache signed Workspace catalogs.    │
//! │                                                                      │
//! │  模块职责：验证 Workspace 组件目录发布证明并安全保存活动版本。        │
//! └─────────────────────────────────────────────────────────────────────┘

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const REPOSITORY: &str = "DoHorizon-AI/Cyrene-Workspace";
const WORKFLOW: &str =
    "DoHorizon-AI/Cyrene-Workspace/.github/workflows/component-catalog-release.yml";
const PREDICATE_TYPE: &str = "https://slsa.dev/provenance/v1";
const SUBJECT_NAME: &str = "component-catalog-v1.json";
const ATTESTATION_ASSET_NAME: &str = "component-catalog-v1.json.attestation.jsonl";
const MAX_RELEASE_JSON_BYTES: usize = 4 * 1024 * 1024;
const MAX_RELEASE_LIST_BYTES: usize = 8 * 1024 * 1024;
const MAX_CATALOG_BYTES: usize = 16 * 1024 * 1024;
const MAX_BUNDLE_BYTES: usize = 16 * 1024 * 1024;
const MAX_VERIFY_OUTPUT_BYTES: usize = 4 * 1024 * 1024;
const MAX_ERROR_OUTPUT_BYTES: usize = 64 * 1024;
const COMMAND_TIMEOUT: Duration = Duration::from_secs(90);
const CACHE_STATE_FILE: &str = "state.json";
const CACHE_LIFECYCLE_FILE: &str = "lifecycle.json";
const EXTERNAL_MARKER_FILE: &str = "ComponentCatalog.commit.json";
const EXTERNAL_MARKER_TEMP_PREFIX: &str = ".ComponentCatalog.commit-";
/// Prefix for the fail-closed error returned when a committed marker outlives the cache root.
pub const CATALOG_ROOT_MISSING_COMMITTED_PREFIX: &str = "CATALOG_ROOT_MISSING_COMMITTED:";
/// Prefix for the fail-closed error returned when a pending marker outlives the cache root.
pub const CATALOG_ROOT_MISSING_PENDING_PREFIX: &str = "CATALOG_ROOT_MISSING_PENDING:";
const CATALOG_FILE: &str = "catalog.json";
const BUNDLE_FILE: &str = "attestation.jsonl";
const METADATA_FILE: &str = "metadata.json";

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// A catalog release's original subject bytes, detached attestation bundle, and receipt.
#[derive(Clone, Debug)]
pub struct CatalogPackage {
    pub raw: Vec<u8>,
    pub attestation: Vec<u8>,
    pub metadata: CatalogMetadata,
}

/// The stable, serialized identity contract for a signed Workspace catalog release.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogMetadata {
    pub schema_version: u32,
    pub repository: String,
    pub workflow: String,
    pub channel: String,
    /// The release tag, such as `catalog-stable-<source SHA>`; never the numeric API id.
    pub release_id: String,
    pub source_commit: String,
    pub source_ref: String,
    /// Lowercase `sha256:` digest of the exact raw catalog asset bytes.
    pub catalog_sha256: String,
    pub generation: u64,
    pub subject_name: String,
    pub attestation_asset_name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CacheState {
    schema_version: u32,
    active_generation: u64,
    active_sha256: String,
    high_water_generation: u64,
    high_water_sha256: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CacheLifecycle {
    schema_version: u32,
    phase: String,
    committed_generation: u64,
    committed_sha256: String,
    pending_generation: Option<u64>,
    pending_sha256: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExternalCommitMarker {
    schema_version: u32,
    phase: String,
    committed_generation: u64,
    committed_sha256: String,
    pending_generation: Option<u64>,
    pending_sha256: Option<String>,
}

struct TempDirectory {
    path: PathBuf,
}

struct BoundedOutput {
    status: ExitStatus,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    stdout_exceeded: bool,
    stderr_exceeded: bool,
}

/// Return the highest recent immutable release tag that matches the requested channel.
///
/// The tag, not GitHub's numeric release id, is returned so callers can pass the exact
/// release identity to [`fetch_release`]. The API response and subprocess output are bounded.
pub fn latest_release_id(channel: &str) -> Result<Option<String>, String> {
    validate_channel(channel)?;
    let endpoint = format!("repos/{REPOSITORY}/releases?per_page=100");
    let output = run_gh_api(&endpoint, None, MAX_RELEASE_LIST_BYTES)?;
    let releases: Value = serde_json::from_slice(&output)
        .map_err(|error| format!("Workspace releases API returned invalid JSON: {error}"))?;
    let releases = releases
        .as_array()
        .ok_or_else(|| "Workspace releases API response is not an array.".to_string())?;

    let prefix = format!("catalog-{channel}-");
    let Some(release) = releases.iter().find(|release| {
        release
            .get("tag_name")
            .and_then(Value::as_str)
            .is_some_and(|tag| tag.starts_with(&prefix))
    }) else {
        return Ok(None);
    };
    let tag = release["tag_name"]
        .as_str()
        .ok_or_else(|| "Latest Workspace catalog release has no string tag.".to_string())?;
    let expected_prerelease = channel == "preview";
    if source_commit_from_tag(channel, tag).is_none()
        || release.get("draft").and_then(Value::as_bool) != Some(false)
        || release.get("immutable").and_then(Value::as_bool) != Some(true)
        || release.get("prerelease").and_then(Value::as_bool) != Some(expected_prerelease)
        || !release_matches_repository(release, tag)
    {
        return Err(format!(
            "Latest `{channel}` Workspace catalog release `{tag}` is invalid or not immutable."
        ));
    }
    Ok(Some(tag.to_string()))
}

/// Fetch a release by its exact immutable tag and independently verify its signed subject.
///
/// Release identity, channel, tag target, exact two-asset set, source ref, source commit,
/// subject digest, and GitHub's verification result are all checked before returning bytes.
pub fn fetch_release(channel: &str, release_id: &str) -> Result<CatalogPackage, String> {
    let source_commit = source_commit_from_tag(channel, release_id).ok_or_else(|| {
        "Workspace catalog release tag does not match its channel/source SHA.".to_string()
    })?;
    let endpoint = format!("repos/{REPOSITORY}/releases/tags/{release_id}");
    let response = run_gh_api(&endpoint, None, MAX_RELEASE_JSON_BYTES)?;
    let release: Value = serde_json::from_slice(&response)
        .map_err(|error| format!("Workspace release API returned invalid JSON: {error}"))?;
    validate_release(&release, channel, release_id, source_commit)?;
    verify_release_tag_target(release_id, source_commit)?;

    let assets = release
        .get("assets")
        .and_then(Value::as_array)
        .ok_or_else(|| "Workspace catalog release has no asset array.".to_string())?;
    let (catalog_asset, bundle_asset) = find_exact_assets(assets)?;
    let raw = download_release_asset(catalog_asset, MAX_CATALOG_BYTES)?;
    if raw.len() as u64 != catalog_asset["size"].as_u64().unwrap_or_default() {
        return Err("Workspace catalog asset size differs from its release record.".to_string());
    }
    let attestation = download_release_asset(bundle_asset, MAX_BUNDLE_BYTES)?;
    if attestation.len() as u64 != bundle_asset["size"].as_u64().unwrap_or_default() {
        return Err(
            "Workspace attestation asset size differs from its release record.".to_string(),
        );
    }

    let source_ref = verify_with_allowed_source_ref(&raw, &attestation, source_commit, channel)?;
    let (catalog_sha256, generation) = catalog_identity(&raw)?;
    let package = CatalogPackage {
        raw,
        attestation,
        metadata: CatalogMetadata {
            schema_version: 1,
            repository: REPOSITORY.to_string(),
            workflow: WORKFLOW.to_string(),
            channel: channel.to_string(),
            release_id: release_id.to_string(),
            source_commit: source_commit.to_string(),
            source_ref,
            catalog_sha256,
            generation,
            subject_name: SUBJECT_NAME.to_string(),
            attestation_asset_name: ATTESTATION_ASSET_NAME.to_string(),
        },
    };
    validate_package_identity(&package)?;
    Ok(package)
}

/// Re-check a package receipt, exact catalog digest/generation, and detached provenance proof.
///
/// This is intentionally suitable for every cache load: it verifies from the saved bundle and
/// does not rely on the release API response that originally delivered the package.
pub fn verify_package(package: &CatalogPackage) -> Result<(), String> {
    validate_package_identity(package)?;
    verify_with_source_ref(
        &package.raw,
        &package.attestation,
        &package.metadata.source_commit,
        &package.metadata.source_ref,
    )
}

/// Read the committed active package without changing cache state.
///
/// Returns `None` only for a genuinely empty, never-initialized store. An interrupted activation
/// (`pending`/`ready`) fails closed with instructions to run [`recover_active`] under the existing
/// service-update lock. On Windows, the protected ProgramData store ACL is checked first.
pub fn load_active(app_dir: &Path) -> Result<Option<CatalogPackage>, String> {
    let root = cache_root(app_dir)?;
    verify_cache_parent(&root)?;
    let marker = read_external_marker(&root)?;
    match fs::symlink_metadata(&root) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            require_no_external_marker_temporaries(&root)?;
            return match marker {
                None => Ok(None),
                Some(marker) if marker.committed_generation > 0 => Err(format!(
                    "{CATALOG_ROOT_MISSING_COMMITTED_PREFIX} catalog root is missing while the external marker records a committed high-water identity. Explicit import is required."
                )),
                Some(_) => Err(format!(
                    "{CATALOG_ROOT_MISSING_PENDING_PREFIX} catalog root is missing while an initialization intent remains. Explicit import is required."
                )),
            };
        }
        Err(error) => return Err(format!("Cannot inspect catalog cache root: {error}")),
    }
    reject_reparse_point(&root, "catalog cache root")?;
    verify_cache_root(&root, false)?;
    let lifecycle = read_cache_lifecycle(&root)?;
    let state = read_cache_state(&root)?;
    match (marker, lifecycle, state) {
        (None, None, None) => {
            require_unmarked_store_empty(&root)?;
            require_no_external_marker_temporaries(&root)?;
            Ok(None)
        }
        (None, _, _) => Err(
            "Catalog cache has internal trust state but no external initialization marker. Refusing bootstrap fallback."
                .to_string(),
        ),
        (Some(marker), Some(lifecycle), Some(state))
            if marker.phase == "committed"
                && lifecycle.phase == "committed"
                && lifecycle_matches_committed(&lifecycle, &state)
                && marker_matches_state(&marker, &state) =>
        {
            package_for_state(&root, &state).map(Some)
        }
        (Some(marker), _, None) if marker.committed_generation > 0 => Err(format!(
            "{CATALOG_ROOT_MISSING_COMMITTED_PREFIX} external high-water exists but the cache root has no internal active state. Explicit import is required."
        )),
        (Some(_), _, _) => Err(
            "Catalog activation is incomplete; rerun the catalog import to recover it under the service-update lock."
                .to_string(),
        ),
    }
}

/// Recover an interrupted catalog activation while holding the service-update lock.
///
/// This function may clean staging files or finish committing a durable activation intent. The
/// caller must hold the same cross-process service-update lock used by catalog import and service
/// update operations; this function deliberately does not acquire that lock itself.
pub fn recover_active(app_dir: &Path) -> Result<Option<CatalogPackage>, String> {
    let root = cache_root(app_dir)?;
    verify_cache_parent(&root)?;
    let marker = read_external_marker(&root)?;
    match fs::symlink_metadata(&root) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return match marker {
                None => {
                    cleanup_external_marker_temporaries(&root)?;
                    Ok(None)
                }
                Some(marker) if marker.committed_generation > 0 => Err(format!(
                    "{CATALOG_ROOT_MISSING_COMMITTED_PREFIX} catalog root is missing while the external marker records a committed high-water identity. Explicit import is required."
                )),
                Some(_) => Err(format!(
                    "{CATALOG_ROOT_MISSING_PENDING_PREFIX} catalog root is missing while an initialization intent remains. Explicit import is required."
                )),
            };
        }
        Err(error) => return Err(format!("Cannot inspect catalog cache root: {error}")),
    }
    reject_reparse_point(&root, "catalog cache root")?;
    verify_cache_root(&root, true)?;
    let lifecycle = read_cache_lifecycle(&root)?;
    let state = read_cache_state(&root)?;
    let recovered = match (marker.as_ref(), lifecycle, state) {
        (None, None, None) => {
            clean_unmarked_first_import(&root)?;
            cleanup_external_marker_temporaries(&root)?;
            return Ok(None);
        }
        (None, _, _) => Err(
            "Catalog cache has internal trust state but no external initialization marker. Refusing recovery or bootstrap fallback."
                .to_string(),
        ),
        (Some(marker), lifecycle, state) if marker.phase == "committed" => {
            if state.is_none() {
                return Err(format!(
                    "{CATALOG_ROOT_MISSING_COMMITTED_PREFIX} external high-water exists but the cache root has no active state pointer. Explicit import is required."
                ));
            }
            let package = recover_inner_state(&root, lifecycle, state)?
                .ok_or_else(|| "Committed catalog marker has no active package.".to_string())?;
            if package.metadata.generation != marker.committed_generation
                || package.metadata.catalog_sha256 != marker.committed_sha256
            {
                return Err(
                    "External commit marker and recovered catalog package disagree. Refusing rollback."
                        .to_string(),
                );
            }
            Ok(Some(package))
        }
        (Some(marker), None, None) if marker.committed_generation == 0 => {
            clean_unmarked_first_import(&root)?;
            cleanup_external_marker_temporaries(&root)?;
            remove_external_marker(&root)?;
            Ok(None)
        }
        (Some(marker), None, None) if marker.committed_generation > 0 => Err(format!(
            "{CATALOG_ROOT_MISSING_COMMITTED_PREFIX} external high-water exists but the cache root has no internal active state. Explicit import is required."
        )),
        (Some(marker), lifecycle, state) => {
            let package = recover_inner_state(&root, lifecycle, state)?;
            match package.as_ref() {
                Some(package)
                    if package.metadata.generation == marker.pending_generation.unwrap_or_default()
                        && package.metadata.catalog_sha256
                            == marker.pending_sha256.as_deref().unwrap_or_default() =>
                {
                    write_external_marker(
                        &root,
                        &committed_external_marker(
                            package.metadata.generation,
                            &package.metadata.catalog_sha256,
                        ),
                    )?;
                }
                Some(package)
                    if marker.committed_generation > 0
                        && package.metadata.generation == marker.committed_generation
                        && package.metadata.catalog_sha256 == marker.committed_sha256 =>
                {
                    write_external_marker(
                        &root,
                        &committed_external_marker(
                            marker.committed_generation,
                            &marker.committed_sha256,
                        ),
                    )?;
                }
                None if marker.committed_generation == 0 => {
                    cleanup_external_marker_temporaries(&root)?;
                    remove_external_marker(&root)?;
                }
                None if marker.committed_generation > 0 => {
                    return Err(format!(
                        "{CATALOG_ROOT_MISSING_COMMITTED_PREFIX} external high-water exists but recovery has no active package. Explicit import of the pending tuple is required."
                    ));
                }
                _ => {
                    return Err(
                        "Pending external catalog intent does not match a recoverable package. Refusing bootstrap fallback."
                            .to_string(),
                    )
                }
            }
            Ok(package)
        }
    }?;
    if recovered.is_some() {
        cleanup_external_marker_temporaries(&root)?;
    }
    Ok(recovered)
}

/// Atomically install an authenticated version and advance the single active/high-water state.
///
/// A first import must be at least the embedded bootstrap generation and must match its digest
/// when generations are equal. Subsequent installs cannot roll back or replace a generation's
/// digest. The caller owns the cross-process service-update lock.
pub fn activate(
    app_dir: &Path,
    package: &CatalogPackage,
    bootstrap_generation: u64,
    bootstrap_sha256: &str,
) -> Result<(), String> {
    verify_package(package)?;
    let bootstrap_sha256 = normalize_sha256(bootstrap_sha256)
        .ok_or_else(|| "Bootstrap catalog SHA-256 is invalid.".to_string())?;
    let root = cache_root(app_dir)?;
    verify_cache_parent(&root)?;
    let marker_at_entry = read_external_marker(&root)?;
    let root_missing = match fs::symlink_metadata(&root) {
        Ok(_) => false,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
        Err(error) => return Err(format!("Cannot inspect catalog cache root: {error}")),
    };

    // A missing root plus its external marker is an explicit restore, never bootstrap.
    let mut restore_marker = if root_missing {
        marker_at_entry.clone()
    } else {
        None
    };
    let mut clear_unmarked_restore = false;
    let mut clear_restore_temporaries = false;
    if !root_missing {
        verify_cache_root(&root, true)?;
        if let Some(marker) = marker_at_entry.as_ref() {
            let lifecycle = read_cache_lifecycle(&root)?;
            let state = read_cache_state(&root)?;
            if marker.phase == "committed" && state.is_none() {
                restore_marker = Some(marker.clone());
                clear_restore_temporaries = true;
            } else if marker.phase == "pending" && marker.committed_generation > 0 {
                if lifecycle.is_none() && state.is_none() {
                    restore_marker = Some(marker.clone());
                    clear_unmarked_restore = true;
                }
            }
        }
    }

    if restore_marker.is_none() {
        if let Err(error) = recover_active(app_dir) {
            if !error.starts_with(CATALOG_ROOT_MISSING_COMMITTED_PREFIX) {
                return Err(error);
            }
            let marker = read_external_marker(&root)?.ok_or_else(|| error.clone())?;
            if root_missing {
                return Err(error);
            }
            let lifecycle = read_cache_lifecycle(&root)?;
            let state = read_cache_state(&root)?;
            if state.is_some() {
                return Err(error);
            }
            restore_marker = Some(marker.clone());
            clear_unmarked_restore = marker.phase == "pending" && lifecycle.is_none();
            clear_restore_temporaries = marker.phase == "committed";
        }
    }

    let incoming = &package.metadata;
    if let Some(marker) = restore_marker.as_ref() {
        match marker.phase.as_str() {
            "committed" => {
                if incoming.generation < marker.committed_generation {
                    return Err(format!(
                        "Catalog generation {} is below external high-water generation {}.",
                        incoming.generation, marker.committed_generation
                    ));
                }
                if incoming.generation == marker.committed_generation
                    && incoming.catalog_sha256 != marker.committed_sha256
                {
                    return Err(
                        "Catalog generation conflicts with the external high-water digest."
                            .to_string(),
                    );
                }
            }
            "pending" => {
                if marker.pending_generation != Some(incoming.generation)
                    || marker.pending_sha256.as_deref() != Some(incoming.catalog_sha256.as_str())
                {
                    return Err(
                        "Explicit import does not match the pending external catalog tuple."
                            .to_string(),
                    );
                }
            }
            _ => return Err("External catalog marker phase is invalid.".to_string()),
        }
    }

    if restore_marker.is_some() && !root_missing {
        // Explicit import can rebuild missing state only when the external marker authenticates
        // the high-water identity or exact pending intent.
        if clear_unmarked_restore {
            clean_unmarked_first_import(&root)?;
        }
        if clear_restore_temporaries {
            cleanup_transaction_temporaries(&root)?;
            cleanup_staging_directories(&root)?;
        }
    }
    if restore_marker.is_some() {
        cleanup_external_marker_temporaries(&root)?;
    }

    let active = if restore_marker.is_some() {
        None
    } else {
        load_active(app_dir)?
    };
    if let Some(active) = active.as_ref() {
        verify_package(active)?;
    }
    let current_state = active.as_ref().map(|active| CacheState {
        schema_version: 1,
        active_generation: active.metadata.generation,
        active_sha256: active.metadata.catalog_sha256.clone(),
        high_water_generation: active.metadata.generation,
        high_water_sha256: active.metadata.catalog_sha256.clone(),
    });

    if restore_marker.is_none() {
        if let Some(state) = current_state.as_ref() {
            if incoming.generation < state.high_water_generation {
                return Err(format!(
                    "Catalog generation {} is below the installed high-water generation {}.",
                    incoming.generation, state.high_water_generation
                ));
            }
            if incoming.generation == state.high_water_generation {
                if incoming.catalog_sha256 != state.high_water_sha256 {
                    return Err(
                        "Catalog generation already has a different installed digest.".to_string(),
                    );
                }
                if incoming.catalog_sha256 == state.active_sha256 {
                    return Ok(());
                }
            }
        } else {
            if incoming.generation < bootstrap_generation {
                return Err(format!(
                    "Catalog generation {} is below bootstrap generation {bootstrap_generation}.",
                    incoming.generation
                ));
            }
            if incoming.generation == bootstrap_generation
                && incoming.catalog_sha256 != bootstrap_sha256
            {
                return Err(
                    "Bootstrap generation digest does not match the imported catalog.".to_string(),
                );
            }
        }
    }

    ensure_cache_root(&root)?;
    verify_cache_root(&root, true)?;

    let previous_generation = current_state
        .as_ref()
        .map(|state| state.high_water_generation)
        .unwrap_or(0);
    let previous_sha256 = current_state
        .as_ref()
        .map(|state| state.high_water_sha256.clone())
        .unwrap_or_default();
    let mut lifecycle = CacheLifecycle {
        schema_version: 1,
        phase: "pending".to_string(),
        committed_generation: previous_generation,
        committed_sha256: previous_sha256.clone(),
        pending_generation: Some(incoming.generation),
        pending_sha256: Some(incoming.catalog_sha256.clone()),
    };
    validate_cache_lifecycle(&lifecycle)?;
    let external_intent = if let Some(marker) = restore_marker.as_ref() {
        match marker.phase.as_str() {
            "pending" => marker.clone(),
            "committed" => ExternalCommitMarker {
                schema_version: 1,
                phase: "pending".to_string(),
                committed_generation: marker.committed_generation,
                committed_sha256: marker.committed_sha256.clone(),
                pending_generation: Some(incoming.generation),
                pending_sha256: Some(incoming.catalog_sha256.clone()),
            },
            _ => return Err("External catalog marker phase is invalid.".to_string()),
        }
    } else {
        ExternalCommitMarker {
            schema_version: 1,
            phase: "pending".to_string(),
            committed_generation: previous_generation,
            committed_sha256: previous_sha256.clone(),
            pending_generation: Some(incoming.generation),
            pending_sha256: Some(incoming.catalog_sha256.clone()),
        }
    };
    write_external_marker(&root, &external_intent)?;
    write_cache_lifecycle(&root, &lifecycle)?;

    ensure_versions_directory(&root)?;
    let final_version_dir =
        version_directory(&root, incoming.generation, &incoming.catalog_sha256)?;
    if final_version_dir.exists() {
        let existing = load_version_package(&final_version_dir)?;
        if existing.raw != package.raw
            || existing.attestation != package.attestation
            || existing.metadata != package.metadata
        {
            return Err(
                "Existing versioned catalog files do not match the package being activated."
                    .to_string(),
            );
        }
        verify_package(&existing)?;
    } else {
        install_version_directory(&root, &final_version_dir, package)?;
    }

    lifecycle.phase = "ready".to_string();
    validate_cache_lifecycle(&lifecycle)?;
    write_cache_lifecycle(&root, &lifecycle)?;

    let state = CacheState {
        schema_version: 1,
        active_generation: incoming.generation,
        active_sha256: incoming.catalog_sha256.clone(),
        high_water_generation: incoming.generation,
        high_water_sha256: incoming.catalog_sha256.clone(),
    };
    validate_cache_state(&state)?;
    write_cache_state(&root, &state)?;
    write_cache_lifecycle(
        &root,
        &committed_lifecycle(incoming.generation, &incoming.catalog_sha256),
    )?;
    write_external_marker(
        &root,
        &committed_external_marker(incoming.generation, &incoming.catalog_sha256),
    )?;
    Ok(())
}

fn validate_package_identity(package: &CatalogPackage) -> Result<(), String> {
    let metadata = &package.metadata;
    validate_metadata(metadata)?;
    if package.raw.is_empty() || package.raw.len() > MAX_CATALOG_BYTES {
        return Err("Workspace catalog bytes are empty or exceed the size limit.".to_string());
    }
    if package.attestation.is_empty() || package.attestation.len() > MAX_BUNDLE_BYTES {
        return Err(
            "Workspace catalog attestation is empty or exceeds the size limit.".to_string(),
        );
    }
    let (digest, generation) = catalog_identity(&package.raw)?;
    if metadata.catalog_sha256 != digest || metadata.generation != generation {
        return Err(
            "Catalog metadata digest/generation does not match the exact raw bytes.".to_string(),
        );
    }
    Ok(())
}

fn validate_metadata(metadata: &CatalogMetadata) -> Result<(), String> {
    if metadata.schema_version != 1
        || metadata.repository != REPOSITORY
        || metadata.workflow != WORKFLOW
        || metadata.subject_name != SUBJECT_NAME
        || metadata.attestation_asset_name != ATTESTATION_ASSET_NAME
    {
        return Err(
            "Catalog metadata schema, repository, workflow, or asset identity is invalid."
                .to_string(),
        );
    }
    let source_commit = source_commit_from_tag(&metadata.channel, &metadata.release_id)
        .ok_or_else(|| "Catalog metadata release tag/channel/source SHA is invalid.".to_string())?;
    if metadata.source_commit != source_commit
        || !allowed_source_refs(&metadata.channel).contains(&metadata.source_ref.as_str())
    {
        return Err(
            "Catalog metadata source commit/ref does not match the fixed channel policy."
                .to_string(),
        );
    }
    if normalize_sha256(&metadata.catalog_sha256).as_deref()
        != Some(metadata.catalog_sha256.as_str())
        || metadata.generation == 0
    {
        return Err("Catalog metadata digest or generation is invalid.".to_string());
    }
    Ok(())
}

fn catalog_identity(raw: &[u8]) -> Result<(String, u64), String> {
    let digest = format!("sha256:{}", sha256_hex(raw));
    let document: Value = serde_json::from_slice(raw)
        .map_err(|error| format!("Workspace component catalog JSON is invalid: {error}"))?;
    if document.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return Err("Workspace component catalog schemaVersion is unsupported.".to_string());
    }
    let generation = document
        .get("generation")
        .and_then(Value::as_u64)
        .filter(|generation| *generation > 0)
        .ok_or_else(|| "Workspace component catalog generation is invalid.".to_string())?;
    Ok((digest, generation))
}

fn validate_channel(channel: &str) -> Result<(), String> {
    if channel == "stable" || channel == "preview" {
        Ok(())
    } else {
        Err("Workspace catalog channel must be `stable` or `preview`.".to_string())
    }
}

fn allowed_source_refs(channel: &str) -> &'static [&'static str] {
    match channel {
        "stable" => &["refs/heads/main", "refs/heads/release"],
        "preview" => &["refs/heads/develop"],
        _ => &[],
    }
}

fn source_commit_from_tag<'a>(channel: &str, release_id: &'a str) -> Option<&'a str> {
    validate_channel(channel).ok()?;
    let prefix = format!("catalog-{channel}-");
    let commit = release_id.strip_prefix(&prefix)?;
    if commit.len() == 40
        && commit
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        Some(commit)
    } else {
        None
    }
}

fn validate_release(
    release: &Value,
    channel: &str,
    release_id: &str,
    source_commit: &str,
) -> Result<(), String> {
    let expected_prerelease = channel == "preview";
    if release.get("tag_name").and_then(Value::as_str) != Some(release_id)
        || release.get("draft").and_then(Value::as_bool) != Some(false)
        || release.get("immutable").and_then(Value::as_bool) != Some(true)
        || release.get("prerelease").and_then(Value::as_bool) != Some(expected_prerelease)
        || !release_matches_repository(release, release_id)
        || source_commit_from_tag(channel, release_id) != Some(source_commit)
    {
        return Err(
            "Workspace catalog release is not the exact immutable channel/source release."
                .to_string(),
        );
    }
    let assets = release
        .get("assets")
        .and_then(Value::as_array)
        .ok_or_else(|| "Workspace catalog release has no asset list.".to_string())?;
    find_exact_assets(assets)?;
    Ok(())
}

fn release_matches_repository(release: &Value, release_id: &str) -> bool {
    let expected_html = format!("https://github.com/{REPOSITORY}/releases/tag/{release_id}");
    release.get("html_url").and_then(Value::as_str) == Some(expected_html.as_str())
}

fn find_exact_assets(assets: &[Value]) -> Result<(&Value, &Value), String> {
    if assets.len() != 2 {
        return Err("Workspace catalog release must contain exactly two assets.".to_string());
    }
    let mut found = BTreeSet::new();
    let mut catalog = None;
    let mut bundle = None;
    for asset in assets {
        let name = asset
            .get("name")
            .and_then(Value::as_str)
            .ok_or_else(|| "Workspace catalog release asset has no name.".to_string())?;
        let expected = match name {
            SUBJECT_NAME => {
                catalog = Some(asset);
                SUBJECT_NAME
            }
            ATTESTATION_ASSET_NAME => {
                bundle = Some(asset);
                ATTESTATION_ASSET_NAME
            }
            _ => {
                return Err(format!(
                    "Unexpected Workspace catalog release asset `{name}`."
                ))
            }
        };
        if !found.insert(expected)
            || asset.get("state").and_then(Value::as_str) != Some("uploaded")
            || asset
                .get("size")
                .and_then(Value::as_u64)
                .filter(|size| *size > 0)
                .is_none()
        {
            return Err(format!(
                "Workspace catalog release asset `{name}` is duplicated or invalid."
            ));
        }
    }
    match (catalog, bundle) {
        (Some(catalog), Some(bundle)) => Ok((catalog, bundle)),
        _ => Err("Workspace catalog release is missing a required asset.".to_string()),
    }
}

fn verify_release_tag_target(release_id: &str, source_commit: &str) -> Result<(), String> {
    let endpoint = format!("repos/{REPOSITORY}/git/ref/tags/{release_id}");
    let response = run_gh_api(&endpoint, None, MAX_RELEASE_JSON_BYTES)?;
    let reference: Value = serde_json::from_slice(&response)
        .map_err(|error| format!("Workspace tag reference API returned invalid JSON: {error}"))?;
    let target = reference
        .get("object")
        .ok_or_else(|| "Workspace catalog tag reference has no target object.".to_string())?;
    let target_sha = target
        .get("sha")
        .and_then(Value::as_str)
        .ok_or_else(|| "Workspace catalog tag target has no SHA.".to_string())?;
    match target.get("type").and_then(Value::as_str) {
        Some("commit") if target_sha == source_commit => Ok(()),
        Some("tag") => {
            let endpoint = format!("repos/{REPOSITORY}/git/tags/{target_sha}");
            let response = run_gh_api(&endpoint, None, MAX_RELEASE_JSON_BYTES)?;
            let tag: Value = serde_json::from_slice(&response).map_err(|error| {
                format!("Workspace annotated tag API returned invalid JSON: {error}")
            })?;
            if tag.get("tag").and_then(Value::as_str) != Some(release_id)
                || tag["object"].get("type").and_then(Value::as_str) != Some("commit")
                || tag["object"].get("sha").and_then(Value::as_str) != Some(source_commit)
            {
                return Err(
                    "Workspace annotated release tag does not resolve to its source SHA."
                        .to_string(),
                );
            }
            Ok(())
        }
        _ => Err("Workspace catalog release tag does not resolve to its source SHA.".to_string()),
    }
}

fn download_release_asset(asset: &Value, limit: usize) -> Result<Vec<u8>, String> {
    let id = asset
        .get("id")
        .and_then(Value::as_u64)
        .filter(|id| *id > 0)
        .ok_or_else(|| "Workspace catalog release asset has an invalid numeric id.".to_string())?;
    let endpoint = format!("repos/{REPOSITORY}/releases/assets/{id}");
    run_gh_api(&endpoint, Some("application/octet-stream"), limit)
}

fn run_gh_api(endpoint: &str, accept: Option<&str>, limit: usize) -> Result<Vec<u8>, String> {
    let mut command = crate::github_updates::github_command();
    command.arg("api");
    command.args(["--hostname", "github.com"]);
    if let Some(accept) = accept {
        command.args(["-H", &format!("Accept: {accept}")]);
    } else {
        command.args(["-H", "Accept: application/vnd.github+json"]);
    }
    command.arg(endpoint);
    let output = run_bounded(
        command,
        limit,
        MAX_ERROR_OUTPUT_BYTES,
        COMMAND_TIMEOUT,
        "gh api",
    )?;
    if !output.status.success() {
        return Err(command_failure("gh api", &output));
    }
    if output.stdout_exceeded || output.stderr_exceeded {
        return Err("GitHub API output exceeds the configured size limit.".to_string());
    }
    Ok(output.stdout)
}

fn verify_with_allowed_source_ref(
    raw: &[u8],
    bundle: &[u8],
    source_commit: &str,
    channel: &str,
) -> Result<String, String> {
    let temp = TempDirectory::new("catalog-verify")?;
    let subject_path = temp.path.join(SUBJECT_NAME);
    let bundle_path = temp.path.join(ATTESTATION_ASSET_NAME);
    write_new_file(&subject_path, raw)?;
    write_new_file(&bundle_path, bundle)?;

    let mut failures = Vec::new();
    for source_ref in allowed_source_refs(channel) {
        let output =
            run_attestation_verifier(&subject_path, &bundle_path, source_commit, source_ref)?;
        if output.status.success() {
            if output.stdout_exceeded || output.stderr_exceeded {
                return Err(
                    "GitHub attestation verifier output exceeds the size limit.".to_string()
                );
            }
            validate_verifier_output(&output.stdout, &sha256_hex(raw))?;
            return Ok((*source_ref).to_string());
        }
        failures.push(format!(
            "{source_ref}: {}",
            bounded_text(&output.stderr, 512)
        ));
    }
    Err(format!(
        "Workspace catalog attestation did not verify for an allowed channel source ref ({}).",
        failures.join("; ")
    ))
}

fn verify_with_source_ref(
    raw: &[u8],
    bundle: &[u8],
    source_commit: &str,
    source_ref: &str,
) -> Result<(), String> {
    if raw.is_empty()
        || raw.len() > MAX_CATALOG_BYTES
        || bundle.is_empty()
        || bundle.len() > MAX_BUNDLE_BYTES
    {
        return Err("Catalog proof input is empty or exceeds its size limit.".to_string());
    }
    catalog_identity(raw)?;
    let temp = TempDirectory::new("catalog-verify")?;
    let subject_path = temp.path.join(SUBJECT_NAME);
    let bundle_path = temp.path.join(ATTESTATION_ASSET_NAME);
    write_new_file(&subject_path, raw)?;
    write_new_file(&bundle_path, bundle)?;
    let output = run_attestation_verifier(&subject_path, &bundle_path, source_commit, source_ref)?;
    if !output.status.success() {
        return Err(command_failure("gh attestation verify", &output));
    }
    if output.stdout_exceeded || output.stderr_exceeded {
        return Err("GitHub attestation verifier output exceeds the size limit.".to_string());
    }
    validate_verifier_output(&output.stdout, &sha256_hex(raw))
}

fn run_attestation_verifier(
    subject_path: &Path,
    bundle_path: &Path,
    source_commit: &str,
    source_ref: &str,
) -> Result<BoundedOutput, String> {
    let mut command = crate::github_updates::github_command();
    command
        .arg("attestation")
        .arg("verify")
        .arg(subject_path)
        .arg("--hostname")
        .arg("github.com")
        .arg("--bundle")
        .arg(bundle_path)
        .arg("--repo")
        .arg(REPOSITORY)
        .arg("--signer-workflow")
        .arg(WORKFLOW)
        .arg("--source-ref")
        .arg(source_ref)
        .arg("--source-digest")
        .arg(source_commit)
        .arg("--predicate-type")
        .arg(PREDICATE_TYPE)
        .arg("--format")
        .arg("json");
    run_bounded(
        command,
        MAX_VERIFY_OUTPUT_BYTES,
        MAX_ERROR_OUTPUT_BYTES,
        COMMAND_TIMEOUT,
        "gh attestation verify",
    )
}

fn validate_verifier_output(stdout: &[u8], expected_sha256: &str) -> Result<(), String> {
    if stdout.is_empty() || stdout.len() > MAX_VERIFY_OUTPUT_BYTES {
        return Err("GitHub attestation verifier returned empty or oversized JSON.".to_string());
    }
    let result: Value = serde_json::from_slice(stdout)
        .map_err(|error| format!("GitHub attestation verifier returned invalid JSON: {error}"))?;
    let entries = result
        .as_array()
        .filter(|entries| !entries.is_empty())
        .ok_or_else(|| {
            "GitHub attestation verifier returned no verified attestations.".to_string()
        })?;
    let matching = entries.iter().any(|entry| {
        let statement = entry
            .get("verificationResult")
            .and_then(|result| result.get("statement"));
        statement.is_some_and(|statement| {
            statement.get("predicateType").and_then(Value::as_str) == Some(PREDICATE_TYPE)
                && statement
                    .get("subject")
                    .and_then(Value::as_array)
                    .is_some_and(|subjects| {
                        subjects.iter().any(|subject| {
                            subject.get("name").and_then(Value::as_str) == Some(SUBJECT_NAME)
                                && subject["digest"].get("sha256").and_then(Value::as_str)
                                    == Some(expected_sha256)
                        })
                    })
        })
    });
    if !matching {
        return Err(
            "GitHub verifier result does not bind the exact catalog subject and SHA-256."
                .to_string(),
        );
    }
    Ok(())
}

fn cache_root(_app_dir: &Path) -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        let program_data = std::env::var_os("ProgramData")
            .or_else(|| std::env::var_os("PROGRAMDATA"))
            .map(PathBuf::from)
            .ok_or_else(|| "Windows ProgramData directory is not configured.".to_string())?;
        if !program_data.is_absolute() {
            return Err("Windows ProgramData path is not absolute.".to_string());
        }
        Ok(program_data.join("Cyrene").join("ComponentCatalog"))
    }
    #[cfg(not(windows))]
    {
        Ok(_app_dir.join("updates").join("component-catalog"))
    }
}

fn validate_cache_state(state: &CacheState) -> Result<(), String> {
    if state.schema_version != 1
        || state.active_generation == 0
        || state.active_generation != state.high_water_generation
        || normalize_sha256(&state.active_sha256).as_deref() != Some(state.active_sha256.as_str())
        || state.active_sha256 != state.high_water_sha256
    {
        return Err("Catalog cache state pointer/high-water document is invalid.".to_string());
    }
    Ok(())
}

fn validate_cache_lifecycle(lifecycle: &CacheLifecycle) -> Result<(), String> {
    if lifecycle.schema_version != 1 {
        return Err("Catalog cache lifecycle schema is unsupported.".to_string());
    }
    match lifecycle.phase.as_str() {
        "pending" | "ready" => {
            if lifecycle.pending_generation.is_none()
                || lifecycle.pending_sha256.is_none()
                || lifecycle.pending_generation == Some(0)
                || normalize_sha256(lifecycle.pending_sha256.as_deref().unwrap_or_default())
                    .as_deref()
                    != lifecycle.pending_sha256.as_deref()
            {
                return Err("Catalog cache lifecycle pending identity is invalid.".to_string());
            }
            if lifecycle.committed_generation == 0 {
                if !lifecycle.committed_sha256.is_empty() {
                    return Err(
                        "Uninitialized catalog lifecycle has an unexpected committed digest."
                            .to_string(),
                    );
                }
            } else if normalize_sha256(&lifecycle.committed_sha256).as_deref()
                != Some(lifecycle.committed_sha256.as_str())
                || lifecycle.pending_generation <= Some(lifecycle.committed_generation)
            {
                return Err("Catalog cache lifecycle high-water identity is invalid.".to_string());
            }
        }
        "committed" => {
            if lifecycle.committed_generation == 0
                || normalize_sha256(&lifecycle.committed_sha256).as_deref()
                    != Some(lifecycle.committed_sha256.as_str())
                || lifecycle.pending_generation.is_some()
                || lifecycle.pending_sha256.is_some()
            {
                return Err("Committed catalog lifecycle identity is invalid.".to_string());
            }
        }
        _ => return Err("Catalog cache lifecycle phase is unsupported.".to_string()),
    }
    Ok(())
}

fn validate_external_marker(marker: &ExternalCommitMarker) -> Result<(), String> {
    if marker.schema_version != 1 {
        return Err("External catalog marker schema is unsupported.".to_string());
    }
    match marker.phase.as_str() {
        "pending" => {
            if marker.pending_generation.is_none()
                || marker.pending_sha256.is_none()
                || marker.pending_generation == Some(0)
                || normalize_sha256(marker.pending_sha256.as_deref().unwrap_or_default()).as_deref()
                    != marker.pending_sha256.as_deref()
            {
                return Err("External catalog marker pending identity is invalid.".to_string());
            }
            if marker.committed_generation == 0 {
                if !marker.committed_sha256.is_empty() {
                    return Err(
                        "Uninitialized external catalog marker has a committed digest.".to_string(),
                    );
                }
            } else if normalize_sha256(&marker.committed_sha256).as_deref()
                != Some(marker.committed_sha256.as_str())
                || marker.pending_generation < Some(marker.committed_generation)
                || marker.pending_generation == Some(marker.committed_generation)
                    && marker.pending_sha256.as_deref() != Some(marker.committed_sha256.as_str())
            {
                return Err("External catalog marker high-water identity is invalid.".to_string());
            }
        }
        "committed" => {
            if marker.committed_generation == 0
                || normalize_sha256(&marker.committed_sha256).as_deref()
                    != Some(marker.committed_sha256.as_str())
                || marker.pending_generation.is_some()
                || marker.pending_sha256.is_some()
            {
                return Err("Committed external catalog marker is invalid.".to_string());
            }
        }
        _ => return Err("External catalog marker phase is unsupported.".to_string()),
    }
    Ok(())
}

fn external_marker_path(root: &Path) -> Result<PathBuf, String> {
    let parent = root
        .parent()
        .ok_or_else(|| "Catalog cache root has no parent for its external marker.".to_string())?;
    Ok(parent.join(EXTERNAL_MARKER_FILE))
}

fn read_external_marker(root: &Path) -> Result<Option<ExternalCommitMarker>, String> {
    let path = external_marker_path(root)?;
    match fs::symlink_metadata(&path) {
        Ok(_) => {
            reject_reparse_point(&path, "external catalog commit marker")?;
            verify_cache_file_acl(&path)?;
            let marker: ExternalCommitMarker =
                serde_json::from_slice(&read_bounded_file(&path, 64 * 1024)?)
                    .map_err(|error| format!("External catalog marker is invalid: {error}"))?;
            validate_external_marker(&marker)?;
            Ok(Some(marker))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Cannot inspect external catalog marker: {error}")),
    }
}

fn write_external_marker(root: &Path, marker: &ExternalCommitMarker) -> Result<(), String> {
    validate_external_marker(marker)?;
    verify_cache_parent(root)?;
    let path = external_marker_path(root)?;
    let parent = path
        .parent()
        .ok_or_else(|| "External catalog marker has no parent directory.".to_string())?;
    let bytes = serde_json::to_vec(marker)
        .map_err(|error| format!("Cannot serialize external catalog marker: {error}"))?;
    atomic_write_file(parent, &path, &bytes)
}

fn remove_external_marker(root: &Path) -> Result<(), String> {
    verify_cache_parent(root)?;
    let path = external_marker_path(root)?;
    reject_reparse_point(&path, "external catalog commit marker")?;
    verify_cache_file_acl(&path)?;
    fs::remove_file(&path)
        .map_err(|error| format!("Cannot remove uncommitted external catalog marker: {error}"))?;
    sync_directory(
        path.parent()
            .ok_or_else(|| "External catalog marker has no parent directory.".to_string())?,
    )
}

fn committed_external_marker(generation: u64, digest: &str) -> ExternalCommitMarker {
    ExternalCommitMarker {
        schema_version: 1,
        phase: "committed".to_string(),
        committed_generation: generation,
        committed_sha256: digest.to_string(),
        pending_generation: None,
        pending_sha256: None,
    }
}

fn marker_matches_state(marker: &ExternalCommitMarker, state: &CacheState) -> bool {
    marker.phase == "committed"
        && marker.committed_generation == state.high_water_generation
        && marker.committed_sha256 == state.high_water_sha256
        && marker.committed_generation == state.active_generation
        && marker.committed_sha256 == state.active_sha256
}

fn require_no_external_marker_temporaries(root: &Path) -> Result<(), String> {
    let parent = external_marker_path(root)?;
    let parent = parent
        .parent()
        .ok_or_else(|| "External catalog marker has no parent directory.".to_string())?;
    let entries = match fs::read_dir(parent) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("Cannot inspect external marker directory: {error}")),
    };
    for entry in entries {
        let entry =
            entry.map_err(|error| format!("Cannot inspect external marker entry: {error}"))?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| "External marker directory has a non-UTF-8 entry.".to_string())?;
        if name.starts_with(EXTERNAL_MARKER_TEMP_PREFIX) {
            return Err(
                "External catalog marker has an interrupted write; rerun catalog recovery under the service-update lock."
                    .to_string(),
            );
        }
    }
    Ok(())
}

fn cleanup_external_marker_temporaries(root: &Path) -> Result<(), String> {
    let marker = external_marker_path(root)?;
    let parent = marker
        .parent()
        .ok_or_else(|| "External catalog marker has no parent directory.".to_string())?;
    let entries = match fs::read_dir(parent) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("Cannot inspect external marker directory: {error}")),
    };
    for entry in entries {
        let entry =
            entry.map_err(|error| format!("Cannot inspect external marker entry: {error}"))?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| "External marker directory has a non-UTF-8 entry.".to_string())?;
        if !name.starts_with(EXTERNAL_MARKER_TEMP_PREFIX) {
            continue;
        }
        reject_reparse_point(&entry.path(), "external marker transaction temporary")?;
        verify_cache_file_acl(&entry.path())?;
        fs::remove_file(entry.path())
            .map_err(|error| format!("Cannot remove external marker temporary: {error}"))?;
    }
    sync_directory(parent)
}

fn read_cache_lifecycle(root: &Path) -> Result<Option<CacheLifecycle>, String> {
    let path = root.join(CACHE_LIFECYCLE_FILE);
    match fs::symlink_metadata(&path) {
        Ok(_) => {
            reject_reparse_point(&path, "catalog cache lifecycle")?;
            verify_cache_file_acl(&path)?;
            let lifecycle: CacheLifecycle =
                serde_json::from_slice(&read_bounded_file(&path, 64 * 1024)?)
                    .map_err(|error| format!("Catalog cache lifecycle is invalid: {error}"))?;
            validate_cache_lifecycle(&lifecycle)?;
            Ok(Some(lifecycle))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Cannot inspect catalog cache lifecycle: {error}")),
    }
}

fn read_cache_state(root: &Path) -> Result<Option<CacheState>, String> {
    let path = root.join(CACHE_STATE_FILE);
    match fs::symlink_metadata(&path) {
        Ok(_) => {
            reject_reparse_point(&path, "catalog cache state")?;
            verify_cache_file_acl(&path)?;
            let state: CacheState =
                serde_json::from_slice(&read_bounded_file(&path, 64 * 1024)?)
                    .map_err(|error| format!("Catalog cache state is invalid: {error}"))?;
            validate_cache_state(&state)?;
            Ok(Some(state))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Cannot inspect catalog cache state: {error}")),
    }
}

fn write_cache_lifecycle(root: &Path, lifecycle: &CacheLifecycle) -> Result<(), String> {
    validate_cache_lifecycle(lifecycle)?;
    let bytes = serde_json::to_vec(lifecycle)
        .map_err(|error| format!("Cannot serialize catalog lifecycle: {error}"))?;
    atomic_write_file(root, &root.join(CACHE_LIFECYCLE_FILE), &bytes)
}

fn write_cache_state(root: &Path, state: &CacheState) -> Result<(), String> {
    validate_cache_state(state)?;
    let bytes = serde_json::to_vec(state)
        .map_err(|error| format!("Cannot serialize catalog cache state: {error}"))?;
    atomic_write_file(root, &root.join(CACHE_STATE_FILE), &bytes)
}

fn committed_lifecycle(generation: u64, digest: &str) -> CacheLifecycle {
    CacheLifecycle {
        schema_version: 1,
        phase: "committed".to_string(),
        committed_generation: generation,
        committed_sha256: digest.to_string(),
        pending_generation: None,
        pending_sha256: None,
    }
}

fn lifecycle_matches_committed(lifecycle: &CacheLifecycle, state: &CacheState) -> bool {
    lifecycle.committed_generation == state.high_water_generation
        && lifecycle.committed_sha256 == state.high_water_sha256
}

fn lifecycle_matches_pending(lifecycle: &CacheLifecycle, generation: u64, digest: &str) -> bool {
    lifecycle.pending_generation == Some(generation)
        && lifecycle.pending_sha256.as_deref() == Some(digest)
}

fn state_matches_pending(lifecycle: &CacheLifecycle, state: &CacheState) -> bool {
    lifecycle_matches_pending(lifecycle, state.active_generation, &state.active_sha256)
        && state.high_water_generation == state.active_generation
        && state.high_water_sha256 == state.active_sha256
}

fn package_for_state(root: &Path, state: &CacheState) -> Result<CatalogPackage, String> {
    let versions = root.join("versions");
    reject_reparse_point(&versions, "catalog versions directory")?;
    verify_cache_directory_acl(&versions)?;
    let directory = version_directory(root, state.active_generation, &state.active_sha256)?;
    let package = load_version_package(&directory)?;
    if package.metadata.generation != state.active_generation
        || package.metadata.catalog_sha256 != state.active_sha256
    {
        return Err("Catalog state pointer does not match its versioned package.".to_string());
    }
    Ok(package)
}

fn package_for_pending(root: &Path, lifecycle: &CacheLifecycle) -> Result<CatalogPackage, String> {
    let generation = lifecycle
        .pending_generation
        .ok_or_else(|| "Catalog lifecycle has no pending generation.".to_string())?;
    let digest = lifecycle
        .pending_sha256
        .as_deref()
        .ok_or_else(|| "Catalog lifecycle has no pending digest.".to_string())?;
    let versions = root.join("versions");
    reject_reparse_point(&versions, "catalog versions directory")?;
    verify_cache_directory_acl(&versions)?;
    let directory = version_directory(root, generation, digest)?;
    let package = load_version_package(&directory)?;
    if package.metadata.generation != generation || package.metadata.catalog_sha256 != digest {
        return Err("Pending lifecycle identity does not match its versioned package.".to_string());
    }
    Ok(package)
}

fn recover_without_state(
    root: &Path,
    lifecycle: CacheLifecycle,
) -> Result<Option<CatalogPackage>, String> {
    if lifecycle.phase == "committed" || lifecycle.committed_generation > 0 {
        return Err(
            "Catalog cache state pointer is missing after a committed activation.".to_string(),
        );
    }
    let pending_path = version_directory(
        root,
        lifecycle.pending_generation.unwrap_or_default(),
        lifecycle.pending_sha256.as_deref().unwrap_or_default(),
    )?;
    match fs::symlink_metadata(&pending_path) {
        Ok(_) => {
            if lifecycle.phase != "ready" && lifecycle.phase != "pending" {
                return Err("Catalog cache recovery phase is invalid.".to_string());
            }
            let package = package_for_pending(root, &lifecycle)?;
            verify_package(&package)?;
            commit_pending_package(root, &lifecycle, &package)?;
            Ok(Some(package))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            if lifecycle.phase == "ready" {
                return Err(
                    "Ready catalog activation is missing its versioned package.".to_string()
                );
            }
            cleanup_uncommitted_first_import(root)?;
            Ok(None)
        }
        Err(error) => Err(format!("Cannot inspect pending catalog package: {error}")),
    }
}

fn recover_with_state(
    root: &Path,
    lifecycle: CacheLifecycle,
    state: CacheState,
) -> Result<Option<CatalogPackage>, String> {
    if lifecycle.phase == "committed" {
        if !lifecycle_matches_committed(&lifecycle, &state) {
            return Err("Committed lifecycle and catalog state pointer disagree.".to_string());
        }
        return package_for_state(root, &state).map(Some);
    }

    if state_matches_pending(&lifecycle, &state) {
        let package = package_for_state(root, &state)?;
        if lifecycle.phase != "ready" {
            return Err("Catalog state advanced before its lifecycle reached ready.".to_string());
        }
        write_cache_lifecycle(
            root,
            &committed_lifecycle(state.active_generation, &state.active_sha256),
        )?;
        return Ok(Some(package));
    }

    let matches_previous =
        lifecycle.committed_generation > 0 && lifecycle_matches_committed(&lifecycle, &state);
    if lifecycle.phase == "pending" && matches_previous {
        let pending_path = version_directory(
            root,
            lifecycle.pending_generation.unwrap_or_default(),
            lifecycle.pending_sha256.as_deref().unwrap_or_default(),
        )?;
        match fs::symlink_metadata(&pending_path) {
            Ok(_) => {
                let package = package_for_pending(root, &lifecycle)?;
                verify_package(&package)?;
                commit_pending_package(root, &lifecycle, &package)?;
                Ok(Some(package))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                cleanup_staging_directories(root)?;
                cleanup_transaction_temporaries(root)?;
                write_cache_lifecycle(
                    root,
                    &committed_lifecycle(state.high_water_generation, &state.high_water_sha256),
                )?;
                package_for_state(root, &state).map(Some)
            }
            Err(error) => Err(format!("Cannot inspect pending catalog package: {error}")),
        }
    } else if lifecycle.phase == "ready" {
        let package = package_for_pending(root, &lifecycle)?;
        verify_package(&package)?;
        commit_pending_package(root, &lifecycle, &package)?;
        Ok(Some(package))
    } else {
        Err("Catalog cache lifecycle does not match its active state pointer.".to_string())
    }
}

fn recover_inner_state(
    root: &Path,
    lifecycle: Option<CacheLifecycle>,
    state: Option<CacheState>,
) -> Result<Option<CatalogPackage>, String> {
    match (lifecycle, state) {
        (None, None) => Ok(None),
        (None, Some(_)) => Err(
            "Catalog cache has an active state pointer but no durable lifecycle marker."
                .to_string(),
        ),
        (Some(lifecycle), None) => recover_without_state(root, lifecycle),
        (Some(lifecycle), Some(state)) => recover_with_state(root, lifecycle, state),
    }
}

fn commit_pending_package(
    root: &Path,
    lifecycle: &CacheLifecycle,
    package: &CatalogPackage,
) -> Result<(), String> {
    if !lifecycle_matches_pending(
        lifecycle,
        package.metadata.generation,
        &package.metadata.catalog_sha256,
    ) {
        return Err("Recovery package does not match the durable lifecycle intent.".to_string());
    }
    let mut ready = lifecycle.clone();
    ready.phase = "ready".to_string();
    write_cache_lifecycle(root, &ready)?;
    write_cache_state(root, &state_for_package(package))?;
    write_cache_lifecycle(
        root,
        &committed_lifecycle(
            package.metadata.generation,
            &package.metadata.catalog_sha256,
        ),
    )
}

fn state_for_package(package: &CatalogPackage) -> CacheState {
    CacheState {
        schema_version: 1,
        active_generation: package.metadata.generation,
        active_sha256: package.metadata.catalog_sha256.clone(),
        high_water_generation: package.metadata.generation,
        high_water_sha256: package.metadata.catalog_sha256.clone(),
    }
}

fn require_unmarked_store_empty(root: &Path) -> Result<(), String> {
    let mut entries = fs::read_dir(root)
        .map_err(|error| format!("Cannot inspect uninitialized catalog store: {error}"))?;
    if entries
        .next()
        .transpose()
        .map_err(|error| format!("Cannot inspect catalog store entry: {error}"))?
        .is_some()
    {
        return Err(
            "Catalog cache has uncommitted data but no lifecycle marker; rerun catalog import under the service-update lock to recover it."
                .to_string(),
        );
    }
    Ok(())
}

fn clean_unmarked_first_import(root: &Path) -> Result<(), String> {
    for entry in fs::read_dir(root)
        .map_err(|error| format!("Cannot inspect uninitialized catalog store: {error}"))?
    {
        let entry =
            entry.map_err(|error| format!("Cannot inspect catalog store entry: {error}"))?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| "Uninitialized catalog store contains a non-UTF-8 name.".to_string())?;
        if !name.starts_with(".lifecycle-") && !name.starts_with(".state-") {
            return Err("Catalog cache has data but no lifecycle or state marker.".to_string());
        }
        reject_reparse_point(&entry.path(), "catalog store transaction temporary")?;
        verify_cache_file_acl(&entry.path())?;
        fs::remove_file(entry.path()).map_err(|error| {
            format!("Cannot remove abandoned catalog transaction file: {error}")
        })?;
    }
    sync_directory(root)
}

fn cleanup_uncommitted_first_import(root: &Path) -> Result<(), String> {
    cleanup_staging_directories(root)?;
    let versions = root.join("versions");
    match fs::symlink_metadata(&versions) {
        Ok(_) => {
            reject_reparse_point(&versions, "catalog versions directory")?;
            verify_cache_directory_acl(&versions)?;
            if fs::read_dir(&versions)
                .map_err(|error| format!("Cannot inspect catalog versions: {error}"))?
                .next()
                .transpose()
                .map_err(|error| format!("Cannot inspect catalog versions: {error}"))?
                .is_some()
            {
                return Err(
                    "Uncommitted first catalog import has unexpected version files.".to_string(),
                );
            }
            fs::remove_dir(&versions).map_err(|error| {
                format!("Cannot remove empty catalog versions directory: {error}")
            })?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "Cannot inspect catalog versions directory: {error}"
            ))
        }
    }
    cleanup_transaction_temporaries(root)?;
    let lifecycle = root.join(CACHE_LIFECYCLE_FILE);
    reject_reparse_point(&lifecycle, "catalog cache lifecycle")?;
    verify_cache_file_acl(&lifecycle)?;
    fs::remove_file(lifecycle)
        .map_err(|error| format!("Cannot clear uncommitted catalog lifecycle: {error}"))?;
    sync_directory(root)
}

fn cleanup_staging_directories(root: &Path) -> Result<(), String> {
    let versions = root.join("versions");
    match fs::symlink_metadata(&versions) {
        Ok(_) => {
            reject_reparse_point(&versions, "catalog versions directory")?;
            verify_cache_directory_acl(&versions)?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "Cannot inspect catalog versions directory: {error}"
            ))
        }
    }
    for entry in fs::read_dir(&versions)
        .map_err(|error| format!("Cannot inspect catalog versions directory: {error}"))?
    {
        let entry =
            entry.map_err(|error| format!("Cannot inspect catalog version entry: {error}"))?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| "Catalog versions directory contains a non-UTF-8 name.".to_string())?;
        if !name.starts_with(".cyrene-staging-") {
            continue;
        }
        reject_reparse_point(&entry.path(), "catalog staging directory")?;
        verify_cache_directory_acl(&entry.path())?;
        fs::remove_dir_all(entry.path()).map_err(|error| {
            format!("Cannot remove abandoned catalog staging directory: {error}")
        })?;
    }
    sync_directory(&versions)
}

fn cleanup_transaction_temporaries(root: &Path) -> Result<(), String> {
    for entry in fs::read_dir(root)
        .map_err(|error| format!("Cannot inspect catalog transaction files: {error}"))?
    {
        let entry =
            entry.map_err(|error| format!("Cannot inspect catalog transaction file: {error}"))?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| "Catalog store contains a non-UTF-8 transaction name.".to_string())?;
        if !name.starts_with(".lifecycle-") && !name.starts_with(".state-") {
            continue;
        }
        reject_reparse_point(&entry.path(), "catalog transaction temporary")?;
        verify_cache_file_acl(&entry.path())?;
        fs::remove_file(entry.path()).map_err(|error| {
            format!("Cannot remove abandoned catalog transaction file: {error}")
        })?;
    }
    sync_directory(root)
}

fn version_directory(root: &Path, generation: u64, digest: &str) -> Result<PathBuf, String> {
    let bare_digest = normalize_sha256(digest)
        .ok_or_else(|| "Catalog version directory digest is invalid.".to_string())?;
    Ok(root
        .join("versions")
        .join(format!("{generation}-{}", &bare_digest[7..])))
}

fn validate_version_directory_contents(directory: &Path) -> Result<(), String> {
    let expected = [CATALOG_FILE, BUNDLE_FILE, METADATA_FILE]
        .into_iter()
        .collect::<BTreeSet<_>>();
    let mut found = BTreeSet::new();
    for entry in fs::read_dir(directory)
        .map_err(|error| format!("Cannot inspect versioned catalog directory: {error}"))?
    {
        let entry =
            entry.map_err(|error| format!("Cannot inspect versioned catalog entry: {error}"))?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| "Catalog version directory contains a non-UTF-8 name.".to_string())?;
        if !expected.contains(name.as_str()) || !found.insert(name) {
            return Err(
                "Catalog version directory contains unexpected or duplicate files.".to_string(),
            );
        }
    }
    if found.len() != expected.len() {
        return Err("Catalog version directory is incomplete.".to_string());
    }
    Ok(())
}

fn load_version_package(directory: &Path) -> Result<CatalogPackage, String> {
    reject_reparse_point(directory, "catalog version directory")?;
    verify_cache_directory_acl(directory)?;
    validate_version_directory_contents(directory)?;
    let raw_path = directory.join(CATALOG_FILE);
    let bundle_path = directory.join(BUNDLE_FILE);
    let metadata_path = directory.join(METADATA_FILE);
    for (path, label) in [
        (&raw_path, "catalog bytes"),
        (&bundle_path, "catalog attestation"),
        (&metadata_path, "catalog metadata"),
    ] {
        reject_reparse_point(path, label)?;
        verify_cache_file_acl(path)?;
    }
    let package = CatalogPackage {
        raw: read_bounded_file(&raw_path, MAX_CATALOG_BYTES)?,
        attestation: read_bounded_file(&bundle_path, MAX_BUNDLE_BYTES)?,
        metadata: serde_json::from_slice(&read_bounded_file(&metadata_path, 128 * 1024)?)
            .map_err(|error| format!("Catalog cache metadata is invalid: {error}"))?,
    };
    validate_package_identity(&package)?;
    Ok(package)
}

fn install_version_directory(
    root: &Path,
    final_directory: &Path,
    package: &CatalogPackage,
) -> Result<(), String> {
    let versions = root.join("versions");
    let staging = TempDirectory::inside_protected(&versions, "staging")?;
    let metadata = serde_json::to_vec(&package.metadata)
        .map_err(|error| format!("Cannot serialize catalog metadata: {error}"))?;
    verify_cache_directory_acl(&staging.path)?;
    for (name, contents) in [
        (CATALOG_FILE, package.raw.as_slice()),
        (BUNDLE_FILE, package.attestation.as_slice()),
        (METADATA_FILE, metadata.as_slice()),
    ] {
        let path = staging.path.join(name);
        write_new_file(&path, contents)?;
        #[cfg(windows)]
        set_windows_owner_admin(&path)?;
        verify_cache_file_acl(&path)?;
    }
    sync_directory(&staging.path)?;
    match atomic_rename_new(&staging.path, final_directory) {
        Ok(()) => sync_directory(&versions),
        Err(_error) if final_directory.exists() => {
            let existing = load_version_package(final_directory)?;
            if existing.raw == package.raw
                && existing.attestation == package.attestation
                && existing.metadata == package.metadata
            {
                verify_package(&existing)
            } else {
                Err("A conflicting versioned catalog appeared during activation.".to_string())
            }
        }
        Err(error) => Err(format!(
            "Cannot atomically install versioned catalog files: {error}"
        )),
    }
}

fn atomic_write_file(root: &Path, destination: &Path, contents: &[u8]) -> Result<(), String> {
    let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let stem = destination
        .file_stem()
        .and_then(|stem| stem.to_str())
        .ok_or_else(|| "Catalog cache transaction file has an invalid name.".to_string())?;
    let temporary = root.join(format!(".{stem}-{}-{counter}.tmp", std::process::id()));
    write_new_file(&temporary, contents)?;
    #[cfg(windows)]
    set_windows_owner_admin(&temporary)?;
    verify_cache_file_acl(&temporary)?;
    sync_directory(root)?;
    atomic_replace(&temporary, destination)?;
    sync_directory(root)?;
    Ok(())
}

fn write_new_file(path: &Path, contents: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| format!("Cannot create `{}`: {error}", path.display()))?;
    file.write_all(contents)
        .map_err(|error| format!("Cannot write `{}`: {error}", path.display()))?;
    file.sync_all()
        .map_err(|error| format!("Cannot flush `{}`: {error}", path.display()))?;
    Ok(())
}

fn read_bounded_file(path: &Path, limit: usize) -> Result<Vec<u8>, String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Cannot inspect `{}`: {error}", path.display()))?;
    if !metadata.file_type().is_file() || metadata.len() > limit as u64 {
        return Err(format!(
            "`{}` is not a regular file within the size limit.",
            path.display()
        ));
    }
    let file =
        File::open(path).map_err(|error| format!("Cannot open `{}`: {error}", path.display()))?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take((limit as u64).saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Cannot read `{}`: {error}", path.display()))?;
    if bytes.len() > limit {
        return Err(format!("`{}` exceeds the size limit.", path.display()));
    }
    Ok(bytes)
}

fn ensure_cache_root(root: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        ensure_windows_root(root)
    }
    #[cfg(not(windows))]
    {
        if root.exists() {
            reject_reparse_point(root, "catalog cache root")?;
            return Ok(());
        }
        fs::create_dir_all(root)
            .map_err(|error| format!("Cannot create catalog cache root: {error}"))?;
        reject_reparse_point(root, "catalog cache root")
    }
}

fn ensure_versions_directory(root: &Path) -> Result<(), String> {
    let versions = root.join("versions");
    if versions.exists() {
        reject_reparse_point(&versions, "catalog versions directory")?;
        verify_cache_directory_acl(&versions)?;
        return Ok(());
    }
    #[cfg(windows)]
    create_directory_with_catalog_acl(&versions)?;
    #[cfg(not(windows))]
    fs::create_dir(&versions)
        .map_err(|error| format!("Cannot create catalog versions directory: {error}"))?;
    reject_reparse_point(&versions, "catalog versions directory")?;
    verify_cache_directory_acl(&versions)
}

fn reject_reparse_point(path: &Path, label: &str) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Cannot inspect {label} `{}`: {error}", path.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() && !metadata.is_file() {
        return Err(format!(
            "{label} `{}` is not a regular file/directory.",
            path.display()
        ));
    }
    #[cfg(windows)]
    if metadata.file_type().is_symlink() {
        return Err(format!("{label} `{}` is a reparse point.", path.display()));
    }
    Ok(())
}

fn verify_cache_root(root: &Path, _for_mutation: bool) -> Result<(), String> {
    reject_reparse_point(root, "catalog cache root")?;
    verify_cache_parent(root)?;
    #[cfg(windows)]
    verify_windows_acl(root, true)?;
    Ok(())
}

fn verify_cache_parent(root: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        let cyrene = root
            .parent()
            .ok_or_else(|| "Windows catalog root has no Cyrene parent.".to_string())?;
        let program_data = cyrene
            .parent()
            .ok_or_else(|| "Windows catalog root has no ProgramData parent.".to_string())?;
        reject_path_chain_reparse(program_data)?;
        match fs::symlink_metadata(cyrene) {
            Ok(_) => {
                reject_reparse_point(cyrene, "Windows Cyrene catalog parent")?;
                verify_windows_acl(cyrene, true)?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Cannot inspect Windows Cyrene parent: {error}")),
        }
    }
    #[cfg(not(windows))]
    let _ = root;
    Ok(())
}

fn verify_cache_directory_acl(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    verify_windows_acl(path, true)?;
    #[cfg(not(windows))]
    let _ = path;
    Ok(())
}

fn verify_cache_file_acl(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    verify_windows_acl(path, false)?;
    #[cfg(not(windows))]
    let _ = path;
    Ok(())
}

#[cfg(windows)]
fn ensure_windows_root(root: &Path) -> Result<(), String> {
    let program_data = root
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| "Windows catalog root has no ProgramData parent.".to_string())?;
    if !program_data.is_absolute() || !program_data.is_dir() {
        return Err("Windows ProgramData directory is unavailable.".to_string());
    }
    reject_path_chain_reparse(program_data)?;
    let cyrene = program_data.join("Cyrene");
    ensure_protected_directory(&cyrene)?;
    ensure_protected_directory(root)?;
    Ok(())
}

#[cfg(windows)]
fn ensure_protected_directory(path: &Path) -> Result<(), String> {
    if path.exists() {
        reject_reparse_point(path, "Windows catalog store directory")?;
        return verify_windows_acl(path, true);
    }
    create_directory_with_catalog_acl(path)?;
    reject_reparse_point(path, "Windows catalog store directory")?;
    verify_windows_acl(path, true)
}

#[cfg(windows)]
fn reject_path_chain_reparse(path: &Path) -> Result<(), String> {
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        if current.exists() {
            let metadata = fs::symlink_metadata(&current)
                .map_err(|error| format!("Cannot inspect Windows store path: {error}"))?;
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(format!(
                    "Windows store path `{}` is not a regular directory.",
                    current.display()
                ));
            }
        }
    }
    Ok(())
}

#[cfg(windows)]
fn create_directory_with_catalog_acl(path: &Path) -> Result<(), String> {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;

    #[repr(C)]
    struct SecurityAttributes {
        length: u32,
        descriptor: *mut c_void,
        inherit_handle: i32,
    }

    #[link(name = "advapi32")]
    extern "system" {
        fn ConvertStringSecurityDescriptorToSecurityDescriptorW(
            string_security_descriptor: *const u16,
            revision: u32,
            security_descriptor: *mut *mut c_void,
            security_descriptor_size: *mut u32,
        ) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateDirectoryW(
            path_name: *const u16,
            security_attributes: *mut SecurityAttributes,
        ) -> i32;
        fn GetLastError() -> u32;
        fn LocalFree(memory: *mut c_void) -> *mut c_void;
    }

    const ERROR_ALREADY_EXISTS: u32 = 183;
    const ERROR_FILE_EXISTS: u32 = 80;
    const SDDL_REVISION_1: u32 = 1;
    let sddl: Vec<u16> = "O:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1200a9;;;BU)\0"
        .encode_utf16()
        .collect();
    let mut descriptor = std::ptr::null_mut();
    // SAFETY: `sddl` is a NUL-terminated UTF-16 security descriptor and both out-pointers are valid.
    let converted = unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            std::ptr::null_mut(),
        )
    };
    if converted == 0 {
        return Err(format!(
            "Cannot build the fixed catalog store ACL (Windows error {}).",
            unsafe { GetLastError() }
        ));
    }
    let mut attributes = SecurityAttributes {
        length: std::mem::size_of::<SecurityAttributes>() as u32,
        descriptor,
        inherit_handle: 0,
    };
    let path_wide = path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    // SAFETY: `path_wide` and its security attributes remain alive for the duration of the call.
    let created = unsafe { CreateDirectoryW(path_wide.as_ptr(), &mut attributes) };
    let error_code = if created == 0 {
        unsafe { GetLastError() }
    } else {
        0
    };
    // SAFETY: the descriptor was allocated by ConvertStringSecurityDescriptorToSecurityDescriptorW.
    unsafe {
        LocalFree(descriptor);
    }
    if created != 0 {
        Ok(())
    } else if error_code == ERROR_ALREADY_EXISTS || error_code == ERROR_FILE_EXISTS {
        Err("Windows catalog store directory appeared during secure creation.".to_string())
    } else {
        Err(format!(
            "Cannot create protected catalog directory (Windows error {error_code})."
        ))
    }
}

#[cfg(windows)]
fn verify_windows_acl(path: &Path, is_directory: bool) -> Result<(), String> {
    verify_windows_owner_admin(path)?;
    let executable = Path::new(r"C:\Windows\System32\icacls.exe");
    if !executable.is_file() {
        return Err("The fixed Windows System32 icacls.exe verifier is unavailable.".to_string());
    }
    let temp = TempDirectory::new("catalog-acl")?;
    let acl_file = temp.path.join("acl.txt");
    let mut command = Command::new(executable);
    command
        .arg(path)
        .arg("/save")
        .arg(&acl_file)
        .arg("/c")
        .arg("/q");
    let output = run_bounded(
        command,
        64 * 1024,
        MAX_ERROR_OUTPUT_BYTES,
        Duration::from_secs(15),
        "icacls ACL verification",
    )?;
    if !output.status.success() || output.stdout_exceeded || output.stderr_exceeded {
        return Err(command_failure("icacls ACL verification", &output));
    }
    let saved = read_bounded_file(&acl_file, 64 * 1024)?;
    let text = decode_text(&saved)?;
    let dacl = text
        .find("D:")
        .map(|index| &text[index..])
        .ok_or_else(|| "icacls did not return a DACL for the catalog store.".to_string())?;
    validate_catalog_acl_sddl(dacl, is_directory)
}

#[cfg(windows)]
fn set_windows_owner_admin(path: &Path) -> Result<(), String> {
    let executable = Path::new(r"C:\Windows\System32\icacls.exe");
    if !executable.is_file() {
        return Err("The fixed Windows System32 icacls.exe setter is unavailable.".to_string());
    }
    let mut command = Command::new(executable);
    command
        .arg(path)
        .arg("/setowner")
        .arg("*S-1-5-32-544")
        .arg("/q");
    let output = run_bounded(
        command,
        16 * 1024,
        MAX_ERROR_OUTPUT_BYTES,
        Duration::from_secs(15),
        "icacls catalog owner update",
    )?;
    if !output.status.success() || output.stdout_exceeded || output.stderr_exceeded {
        return Err(command_failure("icacls catalog owner update", &output));
    }
    verify_windows_owner_admin(path)
}

#[cfg(windows)]
fn verify_windows_owner_admin(path: &Path) -> Result<(), String> {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "advapi32")]
    extern "system" {
        fn GetNamedSecurityInfoW(
            object_name: *mut u16,
            object_type: u32,
            security_info: u32,
            owner: *mut *mut c_void,
            group: *mut *mut c_void,
            dacl: *mut *mut c_void,
            sacl: *mut *mut c_void,
            security_descriptor: *mut *mut c_void,
        ) -> u32;
        fn IsWellKnownSid(sid: *const c_void, sid_type: i32) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn LocalFree(memory: *mut c_void) -> *mut c_void;
    }
    const SE_FILE_OBJECT: u32 = 1;
    const OWNER_SECURITY_INFORMATION: u32 = 0x1;
    const WIN_LOCAL_SYSTEM_SID: i32 = 22;
    const WIN_BUILTIN_ADMINISTRATORS_SID: i32 = 26;

    let mut path_wide = path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let mut owner = std::ptr::null_mut();
    let mut descriptor = std::ptr::null_mut();
    // SAFETY: `path_wide` is NUL-terminated and each out-pointer points to initialized storage.
    let status = unsafe {
        GetNamedSecurityInfoW(
            path_wide.as_mut_ptr(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION,
            &mut owner,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut descriptor,
        )
    };
    if status != 0 {
        return Err(format!(
            "Cannot verify catalog store owner (Windows error {status})."
        ));
    }
    // SAFETY: `owner` is a SID returned with the allocated descriptor above.
    let trusted_owner = unsafe {
        !owner.is_null()
            && (IsWellKnownSid(owner, WIN_LOCAL_SYSTEM_SID) != 0
                || IsWellKnownSid(owner, WIN_BUILTIN_ADMINISTRATORS_SID) != 0)
    };
    // SAFETY: the descriptor was allocated by GetNamedSecurityInfoW.
    unsafe {
        LocalFree(descriptor);
    }
    if trusted_owner {
        Ok(())
    } else {
        Err("Catalog store owner must be SYSTEM or BUILTIN\\Administrators.".to_string())
    }
}

#[cfg(windows)]
fn decode_text(bytes: &[u8]) -> Result<String, String> {
    if bytes.starts_with(&[0xff, 0xfe]) {
        let units = bytes[2..]
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect::<Vec<_>>();
        return char::decode_utf16(units)
            .map(|result| result.map_err(|_| ()))
            .collect::<Result<String, ()>>()
            .map_err(|_| "icacls ACL output is invalid UTF-16.".to_string());
    }
    String::from_utf8(bytes.to_vec())
        .map_err(|_| "icacls ACL output is not valid UTF-8.".to_string())
}

#[cfg(windows)]
fn validate_catalog_acl_sddl(sddl: &str, is_directory: bool) -> Result<(), String> {
    let dacl = sddl
        .find("D:")
        .map(|index| &sddl[index + 2..])
        .unwrap_or(sddl);
    let mut rest = dacl;
    let mut entries = Vec::new();
    while let Some(start) = rest.find('(') {
        rest = &rest[start + 1..];
        let end = rest
            .find(')')
            .ok_or_else(|| "icacls returned a malformed catalog DACL.".to_string())?;
        let fields = rest[..end].split(';').collect::<Vec<_>>();
        if fields.len() != 6 || fields[0] != "A" {
            return Err("Catalog store ACL contains a non-allow or malformed ACE.".to_string());
        }
        entries.push((fields[1], fields[2], fields[5]));
        rest = &rest[end + 1..];
    }
    if entries.len() != 3 {
        return Err(
            "Catalog store ACL must contain only SYSTEM, Administrators, and Users ACEs."
                .to_string(),
        );
    }
    let mut seen = BTreeSet::new();
    for (flags, rights, trustee) in entries {
        let sid = match trustee {
            "SY" | "S-1-5-18" => "SYSTEM",
            "BA" | "S-1-5-32-544" => "ADMINISTRATORS",
            "BU" | "S-1-5-32-545" => "USERS",
            _ => return Err("Catalog store ACL contains an unexpected trustee.".to_string()),
        };
        if !seen.insert(sid) {
            return Err("Catalog store ACL contains duplicate trustee entries.".to_string());
        }
        let has_object_inherit = flags.contains("OI");
        let has_container_inherit = flags.contains("CI");
        let inherited_only = flags.contains("IO");
        let allowed_flags = if is_directory {
            has_object_inherit && has_container_inherit && !inherited_only
        } else {
            !has_object_inherit && !has_container_inherit && !inherited_only
        };
        if !allowed_flags || flags.chars().any(|flag| !"OICIID".contains(flag)) {
            return Err("Catalog store ACL has unexpected inheritance flags.".to_string());
        }
        let rights_valid = match sid {
            "SYSTEM" | "ADMINISTRATORS" => rights == "FA" || rights == "0x1f01ff",
            "USERS" => rights == "0x1200a9" || rights == "FRFX",
            _ => false,
        };
        if !rights_valid {
            return Err(if sid == "USERS" {
                "Standard Users must have read/execute only on the catalog store.".to_string()
            } else {
                "SYSTEM and Administrators must have full control of the catalog store.".to_string()
            });
        }
    }
    if seen.len() != 3 {
        return Err("Catalog store ACL is missing a required trustee.".to_string());
    }
    Ok(())
}

#[cfg(not(windows))]
fn verify_windows_acl(_path: &Path, _is_directory: bool) -> Result<(), String> {
    Ok(())
}

impl TempDirectory {
    fn new(prefix: &str) -> Result<Self, String> {
        Self::inside(&std::env::temp_dir(), prefix)
    }

    fn inside(parent: &Path, prefix: &str) -> Result<Self, String> {
        for _ in 0..64 {
            let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let path = parent.join(format!(
                ".cyrene-{prefix}-{}-{now:x}-{counter:x}",
                std::process::id()
            ));
            match fs::create_dir(&path) {
                Ok(()) => return Ok(Self { path }),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => {
                    return Err(format!(
                        "Cannot create temporary catalog directory: {error}"
                    ))
                }
            }
        }
        Err("Cannot allocate a unique temporary catalog directory.".to_string())
    }

    fn inside_protected(parent: &Path, prefix: &str) -> Result<Self, String> {
        #[cfg(windows)]
        {
            for _ in 0..64 {
                let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos();
                let path = parent.join(format!(
                    ".cyrene-{prefix}-{}-{now:x}-{counter:x}",
                    std::process::id()
                ));
                match create_directory_with_catalog_acl(&path) {
                    Ok(()) => return Ok(Self { path }),
                    Err(error) if error.contains("appeared during secure creation") => continue,
                    Err(error) => {
                        return Err(format!(
                            "Cannot create protected catalog staging directory: {error}"
                        ))
                    }
                }
            }
            Err("Cannot allocate a unique protected catalog staging directory.".to_string())
        }
        #[cfg(not(windows))]
        {
            Self::inside(parent, prefix)
        }
    }
}

impl Drop for TempDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn run_bounded(
    mut command: Command,
    stdout_limit: usize,
    stderr_limit: usize,
    timeout: Duration,
    label: &'static str,
) -> Result<BoundedOutput, String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("Cannot start {label}: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| format!("{label} stdout pipe is unavailable."))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| format!("{label} stderr pipe is unavailable."))?;
    let stdout_reader = thread::spawn(move || read_pipe_bounded(stdout, stdout_limit));
    let stderr_reader = thread::spawn(move || read_pipe_bounded(stderr, stderr_limit));
    let start = Instant::now();
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if start.elapsed() < timeout => thread::sleep(Duration::from_millis(40)),
            Ok(None) => {
                timed_out = true;
                let _ = child.kill();
                break child
                    .wait()
                    .map_err(|error| format!("Cannot stop timed-out {label}: {error}"))?;
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("Cannot monitor {label}: {error}"));
            }
        }
    };
    let (stdout, stdout_exceeded) = stdout_reader
        .join()
        .map_err(|_| format!("{label} stdout reader failed."))??;
    let (stderr, stderr_exceeded) = stderr_reader
        .join()
        .map_err(|_| format!("{label} stderr reader failed."))??;
    if timed_out {
        return Err(format!(
            "{label} exceeded the {} second time limit.",
            timeout.as_secs()
        ));
    }
    Ok(BoundedOutput {
        status,
        stdout,
        stderr,
        stdout_exceeded,
        stderr_exceeded,
    })
}

fn read_pipe_bounded(pipe: impl Read, limit: usize) -> Result<(Vec<u8>, bool), String> {
    let mut bytes = Vec::with_capacity(limit.min(64 * 1024));
    pipe.take((limit as u64).saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Cannot read child process output: {error}"))?;
    let exceeded = bytes.len() > limit;
    if exceeded {
        bytes.truncate(limit);
    }
    Ok((bytes, exceeded))
}

fn command_failure(label: &str, output: &BoundedOutput) -> String {
    let details = bounded_text(&output.stderr, 1024);
    let suffix = if details.is_empty() {
        String::new()
    } else {
        format!(": {details}")
    };
    format!("{label} failed with status {}{suffix}", output.status)
}

fn bounded_text(bytes: &[u8], limit: usize) -> String {
    let text = String::from_utf8_lossy(&bytes[..bytes.len().min(limit)]);
    text.chars()
        .map(|character| {
            if character.is_control() && character != '\t' {
                ' '
            } else {
                character
            }
        })
        .collect::<String>()
        .trim()
        .to_string()
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn normalize_sha256(value: &str) -> Option<String> {
    let bare = value.strip_prefix("sha256:").unwrap_or(value);
    if is_sha256_hex(bare) {
        Some(format!("sha256:{bare}"))
    } else {
        None
    }
}

fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn sync_directory(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        File::open(path)
            .and_then(|file| file.sync_all())
            .map_err(|error| {
                format!(
                    "Cannot flush catalog directory `{}`: {error}",
                    path.display()
                )
            })
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Ok(())
    }
}

#[cfg(windows)]
fn atomic_rename_new(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(existing_name: *const u16, new_name: *const u16, flags: u32) -> i32;
        fn GetLastError() -> u32;
    }
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
    // SAFETY: both NUL-terminated paths remain alive for the duration of the atomic directory move.
    let moved = unsafe {
        MoveFileExW(
            source_wide.as_ptr(),
            destination_wide.as_ptr(),
            MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved != 0 {
        Ok(())
    } else {
        Err(format!(
            "Windows atomic directory move failed (error {}).",
            unsafe { GetLastError() }
        ))
    }
}

#[cfg(not(windows))]
fn atomic_rename_new(source: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(source, destination)
        .map_err(|error| format!("Atomic directory rename failed: {error}"))
}

#[cfg(windows)]
fn atomic_replace(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(existing_name: *const u16, new_name: *const u16, flags: u32) -> i32;
        fn GetLastError() -> u32;
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
    // SAFETY: both NUL-terminated paths remain alive for the duration of the atomic replace call.
    let replaced = unsafe {
        MoveFileExW(
            source_wide.as_ptr(),
            destination_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if replaced != 0 {
        Ok(())
    } else {
        Err(format!(
            "Cannot atomically replace catalog state (Windows error {}).",
            unsafe { GetLastError() }
        ))
    }
}

#[cfg(not(windows))]
fn atomic_replace(source: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(source, destination)
        .map_err(|error| format!("Cannot atomically replace catalog state: {error}"))
}
