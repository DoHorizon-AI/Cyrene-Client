#!/usr/bin/env python3
"""Validate a static-web release against Workspace's canonical schemas.

This validator checks detached release assets, the v2 manifest and v1 index,
and every regular file in the root-relative archive. 静态 Web Release 校验器。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import tarfile
from pathlib import Path, PurePosixPath
from typing import Any

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

REPOSITORY = "DoHorizon-AI/Cyrene-Client"
COMPONENT_ID = "cyrene-client-workspace-web"
PUBLISHER_ID = "official-client-workspace-web"
PUBLISHER_WORKFLOW = f"{REPOSITORY}/.github/workflows/workspace-web-release.yml"
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


def validate_schemas(document_directory: Path, schema_directory: Path, catalog_path: Path) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
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
        (document_directory / f"{COMPONENT_ID}.manifest.json", schemas[1]),
        (document_directory / "component-release-index-v1.json", schemas[2]),
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
    targets = [target for target in catalog.get("targets", []) if target.get("id") == "linux-ubuntu-24.04-x86_64-web"]
    if len(components) != 1 or len(publishers) != 1 or len(targets) != 1:
        raise ValueError("pinned Workspace Catalog v2 must define one Client component, publisher, and static-web target")

    component = components[0]
    publisher = publishers[0]
    target = targets[0]
    channel = manifest.get("channel")
    channel_entry = catalog.get("channels", {}).get(channel, {})
    target_membership = [
        item for item in component.get("targets", [])
        if item.get("targetId") == target["id"] and item.get("artifactKind") == "static-web" and item.get("support") == "supported"
    ]
    if (
        catalog.get("schemaVersion") != 2
        or component.get("kind") != "static-web"
        or component.get("publisher") != REPOSITORY
        or component.get("publisherId") != PUBLISHER_ID
        or "static-web" not in component.get("artifactKinds", [])
        or component.get("activation") != "refresh"
        or component.get("restart") != manifest.get("restart")
        or component.get("protocolVersion") != manifest.get("protocolVersion")
        or target.get("target") != manifest.get("target")
        or target.get("hostSupport") != "supported"
        or len(target_membership) != 1
        or manifest.get("source", {}).get("ref") not in channel_entry.get("sourceRefs", [])
        or publisher.get("repository") != REPOSITORY
        or publisher.get("workflow") != PUBLISHER_WORKFLOW
        or publisher.get("tagFormat") != "component-source-sha"
        or publisher.get("releaseDiscovery", {}).get("indexAssetName") != "component-release-index-v1.json"
        or component.get("releaseDiscovery", {}).get("tagPrefixes", {}).get(manifest.get("channel"))
        != f"{manifest.get('channel')}-{COMPONENT_ID}-"
        or index.get("repository") != REPOSITORY
    ):
        raise ValueError("static-web release component, target, publisher, or discovery identity differs from the pinned Workspace Catalog v2")


def archive_file_map(path: Path, *, max_entries: int, max_uncompressed_bytes: int) -> dict[str, str]:
    if path.stat().st_size < 1 or path.stat().st_size > MAX_ARCHIVE_BYTES:
        raise ValueError("static-web archive size is outside the local verification limit")
    result: dict[str, str] = {}
    uncompressed_bytes = 0
    with tarfile.open(path, mode="r:gz") as archive:
        members = archive.getmembers()
        if not members or len(members) > min(max_entries, MAX_ENTRIES):
            raise ValueError("static-web archive entry count is outside the signed limit")
        for member in members:
            name = member.name
            pure = PurePosixPath(name)
            if (
                not member.isfile()
                or pure.is_absolute()
                or "\\" in name
                or "\n" in name
                or "\r" in name
                or any(part in {"", ".", ".."} for part in name.split("/"))
                or name.lower().endswith(".map")
                or name in result
            ):
                raise ValueError(f"static-web archive contains an unsafe or duplicate path: {name!r}")
            if member.size < 0 or member.size > MAX_UNCOMPRESSED_BYTES:
                raise ValueError(f"static-web file size is outside the verification limit: {name}")
            uncompressed_bytes += member.size
            if uncompressed_bytes > min(max_uncompressed_bytes, MAX_UNCOMPRESSED_BYTES):
                raise ValueError("static-web archive exceeds its signed uncompressed byte limit")
            stream = archive.extractfile(member)
            if stream is None:
                raise ValueError(f"static-web archive entry cannot be read: {name}")
            checksum = hashlib.sha256()
            size = 0
            while chunk := stream.read(1024 * 1024):
                size += len(chunk)
                checksum.update(chunk)
            if size != member.size:
                raise ValueError(f"static-web archive entry size differs from its tar header: {name}")
            result[name] = "sha256:" + checksum.hexdigest()
    if "index.html" not in result:
        raise ValueError("static-web archive root must contain index.html")
    return result


def validate_attestation_identity(
    document: dict[str, Any], subject_name: str, source_ref: str, source_commit: str
) -> None:
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
        or run.get("url")
        != f"https://github.com/{REPOSITORY}/actions/runs/{run['id']}/attempts/{run['attempt']}"
    ):
        raise ValueError(f"release provenance metadata has an invalid workflow run identity: {subject_name}")
    del source_ref, source_commit  # Bound by the detached GitHub attestation verification step.


def validate_release(args: argparse.Namespace) -> None:
    directory = args.directory.resolve()
    source_ref = args.source_ref
    source_commit = args.source_commit
    channel = "preview" if source_ref == "refs/heads/develop" else "stable"
    release_id = f"{channel}-{COMPONENT_ID}-{source_commit}"
    archive_name = f"{COMPONENT_ID}-{source_commit}.tar.gz"
    manifest_name = f"{COMPONENT_ID}.manifest.json"
    index_name = "component-release-index-v1.json"
    expected_names = {
        archive_name,
        manifest_name,
        index_name,
        f"{archive_name}.attestation.jsonl",
        f"{manifest_name}.attestation.jsonl",
        f"{index_name}.attestation.jsonl",
    }
    entries = list(directory.iterdir())
    if any(path.is_symlink() or not path.is_file() for path in entries):
        raise ValueError("release directory may contain only regular, non-symlink asset files")
    actual_names = {path.name for path in entries}
    payload_names = {archive_name, manifest_name, index_name}
    if frozenset(actual_names) not in {frozenset(payload_names), frozenset(expected_names)}:
        raise ValueError(f"release assets differ from the exact immutable release set: {sorted(actual_names)}")

    manifest, index, catalog = validate_schemas(directory, args.schema_directory.resolve(), args.catalog.resolve())
    package_version = read_json(Path("package.json"))["version"]
    expected_version = f"{package_version}+sha.{source_commit}"
    expected_source = {
        "repository": f"https://github.com/{REPOSITORY}",
        "ref": source_ref,
        "commit": source_commit,
    }
    expected_target = {
        "os": "linux",
        "osVersion": "24.04",
        "distribution": "ubuntu",
        "distributionVersion": "24.04",
        "architecture": "x86_64",
        "abi": "glibc-2.39",
        "runtime": "static-web",
    }
    archive_path = directory / archive_name
    archive_digest = digest_bytes(archive_path.read_bytes())
    artifact = manifest["artifact"]
    if (
        manifest.get("releaseId") != release_id
        or manifest.get("componentId") != COMPONENT_ID
        or manifest.get("version") != expected_version
        or manifest.get("channel") != channel
        or manifest.get("target") != expected_target
        or manifest.get("source") != expected_source
        or manifest.get("protocolVersion") != "cyrene.static-web.v1"
        or manifest.get("manifestDigest") != digest_document(manifest, "manifestDigest")
        or manifest.get("contentDigest") != archive_digest
        or artifact.get("kind") != "static-web"
        or artifact.get("format") != "tar.gz"
        or artifact.get("sha256") != archive_digest
        or artifact.get("sizeBytes") != archive_path.stat().st_size
        or artifact.get("entrypoint") != "index.html"
        or artifact.get("maxEntries", 0) > MAX_ENTRIES
        or artifact.get("maxUncompressedBytes", 0) > MAX_UNCOMPRESSED_BYTES
        or artifact.get("uri")
        != f"https://github.com/{REPOSITORY}/releases/download/{release_id}/{archive_name}"
    ):
        raise ValueError("manifest identity, payload digest, target, or immutable asset URI is inconsistent")

    actual_files = archive_file_map(
        archive_path,
        max_entries=artifact["maxEntries"],
        max_uncompressed_bytes=artifact["maxUncompressedBytes"],
    )
    if actual_files != artifact["files"]:
        raise ValueError("static-web archive contents differ from the signed manifest file map")
    index_releases = index.get("releases")
    if (
        index.get("repository") != REPOSITORY
        or index.get("channel") != channel
        or index.get("source") != expected_source
        or index.get("indexDigest") != digest_document(index, "indexDigest")
        or len(index_releases or []) != 1
        or index_releases[0]
        != {
            "componentId": COMPONENT_ID,
            "version": expected_version,
            "target": expected_target,
            "manifestUri": f"https://github.com/{REPOSITORY}/releases/download/{release_id}/{manifest_name}",
            "manifestDigest": manifest["manifestDigest"],
        }
    ):
        raise ValueError("release index does not bind the exact source-SHA manifest")
    validate_catalog_identity(catalog, manifest, index)

    validate_attestation_identity(manifest, archive_name, source_ref, source_commit)
    validate_attestation_identity(index, index_name, source_ref, source_commit)
    source_roots = {str(Path.cwd().resolve()), os.environ.get("GITHUB_WORKSPACE", "")}
    with tarfile.open(archive_path, mode="r:gz") as archive:
        for name in actual_files:
            if PurePosixPath(name).suffix.lower() not in {".html", ".js", ".mjs", ".css", ".svg", ".json", ".txt"}:
                continue
            member = archive.getmember(name)
            content = archive.extractfile(member)
            if content is None:
                raise ValueError(f"cannot read static text asset: {name}")
            text = content.read().decode("utf-8")
            if any(root and root in text for root in source_roots) or "sourceMappingURL=" in text:
                raise ValueError(f"static text asset contains a checkout path or source-map reference: {name}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--schema-directory", type=Path, required=True)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--source-ref", required=True)
    parser.add_argument("--source-commit", required=True)
    args = parser.parse_args()
    if args.source_ref not in {"refs/heads/develop", "refs/heads/main", "refs/heads/release"}:
        raise SystemExit("static-web release source must be develop, main, or release")
    if len(args.source_commit) != 40 or any(char not in "0123456789abcdef" for char in args.source_commit):
        raise SystemExit("static-web release source commit must be a full lowercase SHA-1")
    try:
        validate_release(args)
    except (OSError, ValueError, KeyError, TypeError, tarfile.TarError, json.JSONDecodeError) as error:
        raise SystemExit(f"static-web release validation failed: {error}") from error
    print(f"Validated immutable static-web release for {args.source_ref}@{args.source_commit}")


if __name__ == "__main__":
    main()
