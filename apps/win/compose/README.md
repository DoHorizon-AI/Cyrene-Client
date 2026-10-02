# Windows Workspace OCI runtime

`windows-runtime-services-v2.yml` is the installer-owned Compose overlay for the
five required `workspace-product-v2` Windows OCI members. The installer pins
each service to a verified OCI manifest digest and rejects edits to the service
definitions. It does not publish service ports to the Windows host.

## Operator configuration

Create these paths below the Cyrene application directory. The installer
collects missing paths and keys in its preflight error and refuses `apply` until
the configuration is complete.

| Path | Required contents |
| --- | --- |
| `runtime-config/windows-runtime.env` | Exactly `CYRENE_AUTHORITY_METADATA_GID=<nonzero decimal>` and `CYRENE_PRODUCT_BUNDLE_READER_GID=<nonzero decimal>`. These host-selected supplementary GIDs grant read access to Authority metadata and immutable product bundle versions; Authority receives both and BFF receives only the bundle reader GID. |
| `runtime-config/workspace-authority/authority.env` | `CYRENE_AUTHORITY_AAD_TENANT_ID`, `CYRENE_AUTHORITY_AAD_AUDIENCE`, and `CYRENE_AUTHORITY_SIGNING_KEY_ID`. |
| `runtime-config/workspace-authority/trust.json` | Authority's closed trust configuration. Pin Platform policy and each Product owner repository, allowed refs, release workflow, certificate identity, GitHub CLI/trusted-root paths, and `/var/lib/cyrene-product-bundles/versions`. |
| `runtime-config/workspace-authority/database-url` | PostgreSQL URL secret, owned by container UID 10001 with mode `0600`. |
| `runtime-config/workspace-authority/signing-key` | 32-byte Authority signing seed, UID 10001, mode `0600`. |
| `runtime-config/workspace-authority/tls/server.crt`, `server.key`, `client-ca.crt` | Authority mTLS certificate, private key, and client CA. The key and certificate files must be readable by UID 10001 and protected from group/other access. |
| `runtime-config/workspace-relay/relay.env` and `tls/{ca.crt,server.crt,server.key}` | Relay listen address, exact Bridge/Connector peer SAN allowlists, and mTLS material. Required env keys: `CYRENE_RELAY_LISTEN_ADDR`, `CYRENE_RELAY_TLS_CA`, `CYRENE_RELAY_TLS_CERT`, `CYRENE_RELAY_TLS_KEY`, `CYRENE_RELAY_AUTHORITY_BRIDGE_SANS`, `CYRENE_RELAY_CONNECTOR_SANS`. |
| `runtime-config/workspace-frontend-bridge/bridge.env` and `tls/{ca.crt,client.crt,client.key}` | `CYRENE_BRIDGE_ALLOWED_UID`, fixed Relay endpoint/server name, Relay CA/client certificate/key, and fixed Authority upstream. The endpoint is `https://cyrene-workspace-relay:50054`; the Authority upstream is `cyrene-workspace-authority:50051`. |
| `runtime-config/workspace-connector/connector.env` and `tls/{relay-ca.crt,relay-client.crt,relay-client.key,authority-ca.crt,authority-client.crt,authority-client.key}` | Explicit workspace ID/component allowlist and the required Relay/Authority mTLS endpoint, CA, server-name, certificate, and key variables documented by the Connector host. |
| `runtime-config/workspace-web-bff/bff.env` | Real operator-specific web origin, Entra tenant/audience, database URLs, device CA issuer, device authorization verification URI and key version, and any runtime-specific BFF settings. Never put example credentials in this file. |
| `runtime-config/workspace-web-bff/secrets/{csrf-mac-key,user-code-hmac-key,device-ca-signing-key.pem,device-ca-cert.pem,relay-ca.pem,relay-client.crt,relay-client.key,handoff-signing-seed}` | Operator-issued secrets/certificates mounted read-only. The two HMAC files must contain exactly 32 bytes and be mode `0600`; private keys must not be committed. |

### Authority data bootstrap

Windows does not publish or update the portable `data-bundle` target. Before a
first install, stage a Platform-verified bundle under
`runtime-data/product-bundles/archives/sha256-<hex>.tar.zst`, its immutable
`versions/<hex>` directory, and the Authority metadata directory. Put the exact
raw archive identity (`sha256:<64 lowercase hex>`) in
`runtime-config/workspace-authority/initial-artifact-id`. The installer checks
that the archive bytes match that identity and that the version directory
exists; Authority independently validates the proof, policy, source catalogs,
and attestations before readiness. Directories and files under
`runtime-data/product-bundles/metadata` and `archives` must be readable by
`CYRENE_AUTHORITY_METADATA_GID` (directories `0750`, files `0640`). The
`versions` tree must be readable by `CYRENE_PRODUCT_BUNDLE_READER_GID`. Compose
mounts the complete tree read-only into Authority, while BFF receives only the
read-only `versions` subtree. Do not synthesize owner/catalog records or target bindings.
Authority target bindings are operator-provisioned PostgreSQL rows; missing
mappings keep readiness unavailable.

For an existing installation, the installer reads the active artifact and
generation through the fixed Authority admin helper. It binds that active
artifact ID into the confirmed OCI group plan and checks it again before and
after apply/recovery. Updating the bundle itself is not supported on Windows in
this release; activate a separately verified bundle through the protected
Authority administration path before confirming a new OCI plan.

The Authority BFF socket uses a dedicated named volume mounted only at
`/run/cyrene-workspace-authority/bff` in Authority and BFF. Its socket path is
`/run/cyrene-workspace-authority/bff/bff.sock`. The admin socket stays at
`/run/cyrene-workspace-authority/admin.sock` inside the Authority container and
is not shared with BFF. The installer invokes only the fixed
`cy-workspace-authority-admin` helper through `docker exec -u 0` for status
checks.
