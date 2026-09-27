# Workspace identity and device approval integration

The unified workbench exposes **Account & security** in the left tool rail,
with a resizable sidebar and Chinese/English language selection. It does not open
an editor tab or provide an expand-to-editor action.
It reads the verified Workspace BFF session, discovers organization workspaces and
lets a human review, approve or deny a device authorization request.

## Source and ownership

This adapts Baijin64's Client commits `2fb5280`, `9659775`, `216804b` and `d8cf9d6`.
The source client and Nginx identity/TLS boundary are retained, with workbench
integration, stricter response/session race checks, browser security UI and tests.
It does not import the separate Navigator canvas or replace the existing graph.

Provider contracts were checked against Platform branch
`feat/workspace-platform-integration-20260926` at `4589463`:

- `framework/crates/cy-workspace-web-bff/src/http.rs`: verified session and discovery;
- `src/device_approval.rs`: begin, complete and deny routes;
- `src/fabric_device_approval.rs`: delegation to Device Authorization authority;
- `framework/crates/cy-workspace-fabric/src/webauthn_verifier.rs`: assertion verification.

These provider features are on a separate Platform branch. A frontend build does
not establish that the backend branch has been merged or deployed.

## Identity boundaries

The page also hosts the existing team account actions: refresh session, sign out,
issue/list/revoke personal MCP tokens, and list/add members for administrators.
The bottom-right account shortcut opens this same sidebar instead of a separate
popover. These actions use the existing `/studio-team/v1` service and authorization.
They do not require the organization BFF feature flag.

Local and legacy modes have no signed-in team member. The page identifies that
mode and provides an expandable team setup guide, rather than offering credential
issuance that the backend cannot fulfill. Team mode needs PostgreSQL and explicit
administrator bootstrap; opening the page does not migrate data or enable accounts.

| Identity | Use |
| --- | --- |
| Workbench local/team session | Pipelines, execution, monitoring, build/server commands, existing MCP tokens |
| Entra / Workspace BFF verified principal | Directory-discovered organization workspaces, closed Product projections and device approval |
| Navigator Web Host pairing | Existing legacy Product management and settings where separately configured |

Discovery does not grant workbench roles, create team members, switch the active
pipeline workspace, or convert an Entra session into a Studio MCP token. The page
labels these scopes separately. UI and MCP continue to use the same existing
control services for workflow operations.

The browser never receives an Entra bearer, a device private key or certificate
delivery secret. The edge preserves Baijin64's internal HTTPS/SNI verification and
trusted Easy Auth bearer handoff. Workspace authorization stays in Directory and
Fabric; the frontend checks identity/scope consistency as an additional guard.

## Device approval

1. Load the BFF session and its member workspaces. Select a workspace from discovery.
2. Enter the code shown by the device. POST
   `/api/workspace/v1/device-authorizations/approval-challenges` with `userCode` and
   `scope: { organizationId, workspaceId }`.
3. Review the returned device, workspace, key fingerprint and challenge expiry.
4. Explicitly choose approval. `navigator.credentials.get()` obtains an assertion
   with user verification required; only then POST the assertion to
   `approval-challenges/{approvalId}/complete`. The adapter encodes buffers as
   base64url using the provider's WebAuthn serialization (`extensions` field).
5. A lost completion response preserves the original approval in page memory.
   **Reconcile approval** posts an empty body to that same complete endpoint. The
   provider accepts assertion-free recovery only for already durable issuance.
   No new challenge or second device enrollment is started automatically.
6. Denial calls `/api/workspace/v1/device-authorizations/denials` with the same scope
   and user code; it does not request an authenticator assertion.

Each security write rereads the session for fresh CSRF and checks the principal
against discovery. Superseded requests cannot overwrite a newer identity. Codes,
assertions and CSRF stay in memory; closing/reloading the application discards them.
Switching left tool windows or collapsing the sidebar preserves a pending approval,
including an uncertain result.
Issuing, pending credential delivery and delivered are displayed separately; none
means the server is online or a GPU lease has been acquired.

Authenticator behavior follows the [WebAuthn specification](https://www.w3.org/TR/webauthn-3/).
The production verifier, not a UI success state, decides authorization.

Credential registration exists as a Fabric HTTP module but is **not mounted by the
inspected BFF host**. The UI therefore offers no invented registration URL. Approval
requires an already enrolled credential and configured durable providers; missing
providers return unavailable. Complete credential enrollment and workbench SSO
identity federation are separate backend integration work.

## Node settings

With the BFF feature enabled, node settings use the imported closed operation keys:
dataset/model lists, training draft and evaluation suite lookup by ID, and suite
creation. Bindings retain the selected Workspace. Unsupported Product operations
fail closed rather than falling back to direct paths; training writes, dataset
version lookup, serving bindings and Navigator session lists are not projected yet.
Compute observations still use their existing explicitly paired Web Host path.

## Configuration and local verification

Build the root ACA image with `--build-arg VITE_WORKSPACE_BFF_ENABLED=true` only for
an environment intended to use organization identity. Separately enable its runtime
BFF routing following [workspace-bff-nginx.md](workspace-bff-nginx.md). Both flags
default to false. No Azure/Entra settings are modified by this change.

The root image still serves the unified workbench and forwards existing control
traffic to `STUDIO_CONTROL_ORIGIN`. Vite and the local Compose edge do not have
trusted Easy Auth; their Workspace and `/.auth` paths explicitly return 503.
Do not substitute a browser-configured token or disable upstream TLS verification
to make development sign-in appear connected.

```sh
npx vitest run tests/unit/workspace-bff.test.ts
npm run test:e2e:security
sh tooling/check-workspace-bff-routing.sh cyrene-client-web:ci
```

The browser suite uses a Chromium virtual authenticator to produce real assertions
against explicit HTTP fixtures. It does not verify live Entra consent, a deployed
Platform verifier, physical passkeys, device certificate issuance or GPU execution.

## MCP policy

Workflow operations retain their existing MCP tools and `cyrene://context` resource.
Organization sign-in, passkey enrollment and device approval/denial are human
identity-administration boundaries; they are intentionally **not model tools**.
No browser cookie, user code or assertion enters the model context. Future delegated
Workspace business tools need an explicit server-side principal adapter and the
same Directory policy; browser discovery is not authority to issue an AI token.

## 中文说明

入口为“左侧栏 → 账号与安全”。本轮接入组织会话、工作空间发现、设备请求核对、系统
安全验证、批准/拒绝及未知结果核对，并适配节点设置的五个现有 BFF 操作。工作台账号、
组织账号和旧 Web Host 配对仍各自保留授权边界，选择组织工作空间不会切换正在编辑的图。

默认关闭组织身份功能；本地 Vite/Compose 明确返回未配置，只有通过受信 Easy Auth
入口且 BFF/Directory/持久化审批服务就绪的部署才可实际使用。安全密钥注册尚未挂载，
没有补造入口，也没有把设备审批暴露给 AI。浏览器夹具测试不代表线上身份链路已验收。
