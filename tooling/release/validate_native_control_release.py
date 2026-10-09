#!/usr/bin/env python3
"""Validate the native Studio Control release against Workspace v2 authority."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import tarfile
from pathlib import Path, PurePosixPath
from typing import Any

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

REPOSITORY = "DoHorizon-AI/Cyrene-Client"
COMPONENT_ID = "cyrene-client-workspace-control"
PUBLISHER_ID = "official-client-workspace-control"
PUBLISHER_WORKFLOW = f"{REPOSITORY}/.github/workflows/workspace-control-release.yml"
TARGET_ID = "linux-ubuntu-24.04-x86_64-node-24"
PROTOCOL_VERSION = "cyrene.client.studio-control.v1"
EXPECTED_TARGET = {
    "os": "linux",
    "osVersion": "24.04",
    "distribution": "ubuntu",
    "distributionVersion": "24.04",
    "architecture": "x86_64",
    "abi": "glibc-2.39",
    "runtime": "node:24",
}
EXECUTABLE_FILES = ["bin/cyrene-studio-control", "runtime/bin/node"]
MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024
MAX_ENTRIES = 10_000


def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON property: {key}")
        result[key] = value
    return result


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique_object)
    if not isinstance(value, dict):
        raise ValueError(f"JSON root must be an object: {path.name}")
    return value


def canonical_json(value: Any) -> bytes:
    """Encode the integer-and-ASCII metadata subset used by release documents."""

    def encode(item: Any) -> str:
        if item is None or isinstance(item, (bool, str)):
            return json.dumps(item, ensure_ascii=False, separators=(",", ":"))
        if isinstance(item, int) and not isinstance(item, bool):
            return str(item)
        if isinstance(item, float):
            raise ValueError("release metadata must not contain floating point values")
        if isinstance(item, list):
            return "[" + ",".join(encode(value) for value in item) + "]"
        if isinstance(item, dict):
            keys = sorted(item, key=lambda key: key.encode("utf-16-be", "surrogatepass"))
            return "{" + ",".join(
                json.dumps(key, ensure_ascii=False, separators=(",", ":")) + ":" + encode(item[key])
                for key in keys
            ) + "}"
        raise ValueError(f"unsupported release metadata value: {type(item).__name__}")

    return encode(value).encode("utf-8")


def digest_bytes(value: bytes) -> str:
    return "sha256:" + hashlib.sha256(value).hexdigest()


def digest_document(document: dict[str, Any], field: str) -> str:
    unsigned = {key: value for key, value in document.items() if key != field}
    return digest_bytes(canonical_json(unsigned))


def validate_schemas(directory: Path, schema_directory: Path, catalog_path: Path) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    names = (
        "component-release-manifest-v1.schema.json",
        "component-release-manifest-v2.schema.json",
        "component-release-index-v1.schema.json",
        "component-catalog-v2.schema.json",
    )
    schemas = [read_json(schema_directory / name) for name in names]
    registry = Registry()
    for schema in schemas:
        Draft202012Validator.check_schema(schema)
        registry = registry.with_resource(schema["$id"], Resource.from_contents(schema))
    validators = (
        (directory / f"{COMPONENT_ID}.manifest.json", schemas[1]),
        (directory / "component-release-index-v1.json", schemas[2]),
        (catalog_path, schemas[3]),
    )
    documents = []
    for path, schema in validators:
        document = read_json(path)
        validator = Draft202012Validator(schema, registry=registry, format_checker=Draft202012Validator.FORMAT_CHECKER)
        errors = sorted(validator.iter_errors(document), key=lambda error: tuple(map(str, error.absolute_path)))
        if errors:
            detail = "; ".join(
                f"{'/'.join(map(str, error.absolute_path)) or '<root>'}: {error.message}"
                for error in errors[:10]
            )
            raise ValueError(f"{path.name} failed Workspace schema validation: {detail}")
        documents.append(document)
    return documents[0], documents[1], documents[2]


def validate_catalog_identity(catalog: dict[str, Any], manifest: dict[str, Any], index: dict[str, Any]) -> None:
    components = [component for component in catalog.get("components", []) if component.get("componentId") == COMPONENT_ID]
    publishers = [publisher for publisher in catalog.get("publishers", []) if publisher.get("id") == PUBLISHER_ID]
    targets = [target for target in catalog.get("targets", []) if target.get("id") == TARGET_ID]
    if len(components) != 1 or len(publishers) != 1 or len(targets) != 1:
        raise ValueError("pinned Workspace Catalog v2 must define one Control component, publisher, and Node 24 target")

    component, publisher, target = components[0], publishers[0], targets[0]
    channel = manifest.get("channel")
    channel_entry = catalog.get("channels", {}).get(channel, {})
    target_membership = [
        item for item in component.get("targets", [])
        if item.get("targetId") == TARGET_ID and item.get("artifactKind") == "native-binary" and item.get("support") == "supported"
    ]
    if (
        catalog.get("schemaVersion") != 2
        or component.get("kind") != "native-binary"
        or component.get("role") != "service"
        or component.get("publisher") != REPOSITORY
        or component.get("publisherId") != PUBLISHER_ID
        or "native-binary" not in component.get("artifactKinds", [])
        or component.get("protocolVersion") != PROTOCOL_VERSION
        or component.get("restart") != manifest.get("restart")
        or component.get("systemdUnit") != "cyrene-client-workspace-control.service"
        or target.get("target") != EXPECTED_TARGET
        or target.get("hostSupport") != "supported"
        or len(target_membership) != 1
        or component.get("dependencies") != []
        or manifest.get("source", {}).get("ref") not in channel_entry.get("sourceRefs", [])
        or publisher.get("repository") != REPOSITORY
        or publisher.get("workflow") != PUBLISHER_WORKFLOW
        or publisher.get("tagFormat") != "component-source-sha"
        or publisher.get("releaseDiscovery", {}).get("indexAssetName") != "component-release-index-v1.json"
        or component.get("releaseDiscovery", {}).get("tagPrefixes", {}).get(channel) != f"{channel}-{COMPONENT_ID}-"
        or index.get("repository") != REPOSITORY
    ):
        raise ValueError("Control release component, target, publisher, or discovery identity differs from pinned Workspace Catalog v2")


def safe_archive_path(name: str) -> bool:
    path = PurePosixPath(name)
    return (
        bool(name)
        and not path.is_absolute()
        and "\\" not in name
        and not any(part in {"", ".", ".."} for part in name.split("/"))
        and not any(ord(char) < 32 or ord(char) == 127 for char in name)
    )


def archive_file_map(path: Path, *, max_entries: int, max_uncompressed_bytes: int) -> tuple[dict[str, str], dict[str, int]]:
    if path.stat().st_size < 1 or path.stat().st_size > MAX_ARCHIVE_BYTES:
        raise ValueError("native Control archive size is outside the local verification limit")
    result: dict[str, str] = {}
    modes: dict[str, int] = {}
    uncompressed_bytes = 0
    with tarfile.open(path, mode="r:gz") as archive:
        members = archive.getmembers()
        if not members or len(members) > min(max_entries, MAX_ENTRIES):
            raise ValueError("native Control archive entry count is outside the signed limit")
        for member in members:
            name = member.name
            if not member.isfile() or not safe_archive_path(name) or name in result:
                raise ValueError(f"native Control archive contains an unsafe or duplicate entry: {name!r}")
            if member.size < 0 or member.size > MAX_UNCOMPRESSED_BYTES:
                raise ValueError(f"native Control file size is outside the verification limit: {name}")
            uncompressed_bytes += member.size
            if uncompressed_bytes > min(max_uncompressed_bytes, MAX_UNCOMPRESSED_BYTES):
                raise ValueError("native Control archive exceeds its signed uncompressed byte limit")
            stream = archive.extractfile(member)
            if stream is None:
                raise ValueError(f"native Control archive entry cannot be read: {name}")
            checksum = hashlib.sha256()
            size = 0
            while chunk := stream.read(1024 * 1024):
                size += len(chunk)
                checksum.update(chunk)
            if size != member.size:
                raise ValueError(f"native Control archive entry size differs from its tar header: {name}")
            result[name] = "sha256:" + checksum.hexdigest()
            modes[name] = member.mode
    return result, modes


def validate_attestation_identity(document: dict[str, Any], subject_name: str) -> None:
    attestation = document["provenance"]["attestation"]
    if (
        attestation.get("kind") != "github-artifact-attestation"
        or attestation.get("subjectName") != subject_name
        or attestation.get("repository") != REPOSITORY
        or attestation.get("workflow") != PUBLISHER_WORKFLOW
        or attestation.get("predicateType") != "https://slsa.dev/provenance/v1"
    ):
        raise ValueError(f"release provenance metadata does not identify the official subject: {subject_name}")
    run = attestation.get("run", {})
    if (
        not isinstance(run.get("id"), str)
        or not run["id"].isdigit()
        or not isinstance(run.get("attempt"), int)
        or run["attempt"] < 1
        or run.get("url") != f"https://github.com/{REPOSITORY}/actions/runs/{run['id']}/attempts/{run['attempt']}"
    ):
        raise ValueError(f"release provenance metadata has an invalid workflow run identity: {subject_name}")


def validate_release(args: argparse.Namespace) -> None:
    directory = args.directory.resolve()
    channel = "preview" if args.source_ref == "refs/heads/develop" else "stable"
    release_id = f"{channel}-{COMPONENT_ID}-{args.source_commit}"
    archive_name = f"{COMPONENT_ID}-{args.source_commit}.tar.gz"
    manifest_name = f"{COMPONENT_ID}.manifest.json"
    index_name = "component-release-index-v1.json"
    payload_names = {archive_name, manifest_name, index_name}
    expected_names = payload_names | {f"{name}.attestation.jsonl" for name in payload_names}
    entries = list(directory.iterdir())
    if any(path.is_symlink() or not path.is_file() for path in entries):
        raise ValueError("release directory may contain only regular, non-symlink asset files")
    actual_names = {path.name for path in entries}
    if frozenset(actual_names) not in {frozenset(payload_names), frozenset(expected_names)}:
        raise ValueError(f"release assets differ from the exact immutable release set: {sorted(actual_names)}")

    manifest, index, catalog = validate_schemas(directory, args.schema_directory.resolve(), args.catalog.resolve())
    package_version = read_json(Path("package.json"))["version"]
    expected_version = f"{package_version}+sha.{args.source_commit}"
    expected_source = {
        "repository": f"https://github.com/{REPOSITORY}",
        "ref": args.source_ref,
        "commit": args.source_commit,
    }
    archive_path = directory / archive_name
    archive_bytes = archive_path.read_bytes()
    archive_digest = digest_bytes(archive_bytes)
    artifact = manifest["artifact"]
    if (
        manifest.get("schemaVersion") != 2
        or manifest.get("releaseId") != release_id
        or manifest.get("componentId") != COMPONENT_ID
        or manifest.get("version") != expected_version
        or manifest.get("channel") != channel
        or manifest.get("target") != EXPECTED_TARGET
        or manifest.get("source") != expected_source
        or manifest.get("protocolVersion") != PROTOCOL_VERSION
        or manifest.get("manifestDigest") != digest_document(manifest, "manifestDigest")
        or manifest.get("contentDigest") != archive_digest
        or artifact.get("kind") != "native-binary"
        or artifact.get("format") != "tar.gz"
        or artifact.get("sha256") != archive_digest
        or artifact.get("sizeBytes") != archive_path.stat().st_size
        or artifact.get("entrypoint") != "bin/cyrene-studio-control"
        or artifact.get("executableFiles") != EXECUTABLE_FILES
        or artifact.get("uri") != f"https://github.com/{REPOSITORY}/releases/download/{release_id}/{archive_name}"
        or manifest.get("dependencies") != []
        or manifest.get("restart") != {"group": "single-service", "unit": "cyrene-client-workspace-control.service"}
        or manifest.get("health") != {"kind": "http", "path": "/health/ready", "port": 5182}
    ):
        raise ValueError("manifest identity, payload digest, target, protocol, lifecycle, or immutable asset URI is inconsistent")

    actual_files, modes = archive_file_map(
        archive_path,
        max_entries=len(artifact.get("files", {})),
        max_uncompressed_bytes=MAX_UNCOMPRESSED_BYTES,
    )
    if actual_files != artifact.get("files"):
        raise ValueError("native Control archive contents differ from the signed manifest file map")
    expected_modes = {"bin/cyrene-studio-control", "runtime/bin/node"}
    if any(bool(modes.get(name, 0) & 0o111) != (name in expected_modes) for name in actual_files):
        raise ValueError("native Control executable file modes differ from the signed entrypoint contract")
    if not {"bin/cyrene-studio-control", "lib/studio-control.mjs", "runtime/bin/node", "runtime/LICENSE", "systemd/cyrene-client-workspace-control.service", "licenses/THIRD_PARTY_NOTICES.md"}.issubset(actual_files):
        raise ValueError("native Control archive is missing its launcher, bundle, runtime, signed unit, or license notices")
    with tarfile.open(archive_path, mode="r:gz") as archive:
        node_stream = archive.extractfile("runtime/bin/node")
        launcher_stream = archive.extractfile("bin/cyrene-studio-control")
        unit_stream = archive.extractfile("systemd/cyrene-client-workspace-control.service")
        if node_stream is None or node_stream.read(4) != b"\x7fELF":
            raise ValueError("embedded Node runtime is not a Linux ELF executable")
        if launcher_stream is None:
            raise ValueError("native Control launcher cannot be read")
        if unit_stream is None:
            raise ValueError("native Control signed systemd unit cannot be read")
        launcher = launcher_stream.read().decode("utf-8")
        if "runtime/bin/node" not in launcher or "lib/studio-control.mjs" not in launcher or "GITHUB_WORKSPACE" in launcher:
            raise ValueError("native Control launcher does not use only its relative runtime and bundle paths")
        unit = unit_stream.read().decode("utf-8")
        required_unit_directives = {
            "User=cyrene",
            "Group=cyrene",
            "Environment=STUDIO_MODE=local",
            "Environment=STUDIO_CONTROL_HOST=127.0.0.1",
            "Environment=STUDIO_CONTROL_PORT=5182",
            "Environment=STUDIO_PUBLIC_ORIGINS=http://127.0.0.1:8100,http://localhost:8100",
            "EnvironmentFile=-/etc/cyrene/studio-control.env",
            "ExecStart=/usr/bin/cyrene component-run cyrene-client-workspace-control",
            "Restart=on-failure",
            "ReadWritePaths=/var/lib/cyrene/studio-control",
        }
        unit_lines = set(unit.splitlines())
        if not required_unit_directives.issubset(unit_lines) or any(
            re.match(r"^\s*Environment=.*(?:TOKEN|PASSWORD|SECRET)=", line, re.IGNORECASE)
            for line in unit_lines
        ):
            raise ValueError("native Control systemd unit differs from the fixed unprivileged local contract")
        source_roots = {str(Path.cwd().resolve()), os.environ.get("GITHUB_WORKSPACE", "")}
        for name in actual_files:
            if not name.endswith((".mjs", ".js", ".cjs", ".json", ".sh", ".txt", ".md")):
                continue
            stream = archive.extractfile(name)
            if stream is None:
                raise ValueError(f"cannot read native Control text asset: {name}")
            content = stream.read().decode("utf-8")
            if "sourceMappingURL=" in content or any(root and root in content for root in source_roots):
                raise ValueError(f"native Control text asset contains a source map or checkout path: {name}")

    index_releases = index.get("releases")
    if (
        index.get("repository") != REPOSITORY
        or index.get("channel") != channel
        or index.get("source") != expected_source
        or index.get("indexDigest") != digest_document(index, "indexDigest")
        or len(index_releases or []) != 1
        or index_releases[0] != {
            "componentId": COMPONENT_ID,
            "version": expected_version,
            "target": EXPECTED_TARGET,
            "manifestUri": f"https://github.com/{REPOSITORY}/releases/download/{release_id}/{manifest_name}",
            "manifestDigest": manifest["manifestDigest"],
        }
    ):
        raise ValueError("release index does not bind the exact source-SHA manifest")
    validate_catalog_identity(catalog, manifest, index)
    validate_attestation_identity(manifest, archive_name)
    validate_attestation_identity(index, index_name)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--schema-directory", type=Path, required=True)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--source-ref", required=True)
    parser.add_argument("--source-commit", required=True)
    args = parser.parse_args()
    if args.source_ref not in {"refs/heads/develop", "refs/heads/main", "refs/heads/release"}:
        raise SystemExit("native Control release source must be develop, main, or release")
    if len(args.source_commit) != 40 or any(char not in "0123456789abcdef" for char in args.source_commit):
        raise SystemExit("native Control release source commit must be a full lowercase SHA-1")
    try:
        validate_release(args)
    except (OSError, ValueError, KeyError, TypeError, tarfile.TarError, json.JSONDecodeError) as error:
        raise SystemExit(f"native Control release validation failed: {error}") from error
    print(f"Validated immutable native Control release for {args.source_ref}@{args.source_commit}")


if __name__ == "__main__":
    main()
