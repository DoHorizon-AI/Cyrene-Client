# Workspace Studio Control release / Workspace Studio Control 发布

The Workspace Control is published as an immutable, source-SHA-bound native component. Its archive contains the compiled Studio Control service, a pinned Node.js 24 runtime, the relative launcher, and runtime/dependency license notices. It does not require a Client source checkout, npm install, or PostgreSQL for local mode.

Workspace Control 以 source-SHA 为身份发布不可变原生组件。归档包含编译后的 Studio Control 服务、固定版本的 Node.js 24 runtime、相对路径 launcher，以及 runtime 和依赖的许可声明。local 模式不需要 Client 源码检出、npm install 或 PostgreSQL。

The component contract is `cyrene-client-workspace-control`, protocol `cyrene.client.studio-control.v1`, target `linux-ubuntu-24.04-x86_64-node-24` (`node:24`), and entrypoint `bin/cyrene-studio-control`. The signed archive also contains `systemd/cyrene-client-workspace-control.service`; its bytes are included in `artifact.files`, and Workspace installs those exact bytes as a root-owned `0644` unit. The Workspace updater owns the installed projection at `/usr/lib/cyrene/components/cyrene-client-workspace-control/active`; the systemd unit is `cyrene-client-workspace-control.service`, started through `cyrene component-run cyrene-client-workspace-control`. Readiness is `GET http://127.0.0.1:5182/health/ready`.

组件契约为 `cyrene-client-workspace-control`、协议 `cyrene.client.studio-control.v1`、target `linux-ubuntu-24.04-x86_64-node-24`（runtime `node:24`）及入口 `bin/cyrene-studio-control`。签名归档还包含 `systemd/cyrene-client-workspace-control.service`；其原始 bytes 由 `artifact.files` 纳入摘要，Workspace 会以 root-owned `0644` 安装该文件。Workspace updater 管理安装投影 `/usr/lib/cyrene/components/cyrene-client-workspace-control/active`；systemd unit 为 `cyrene-client-workspace-control.service`，通过 `cyrene component-run cyrene-client-workspace-control` 启动。Readiness 地址为 `GET http://127.0.0.1:5182/health/ready`。

## Local Web Host configuration / Local Web Host 配置

The official Workspace Web Host owns the public listener on `127.0.0.1:8100` and proxies the same-origin `/api` and `/studio-workloads/` routes to Control at `127.0.0.1:5182`. Configure Control with exact origins and a persistent state directory:

官方 Workspace Web Host 在 `127.0.0.1:8100` 提供 listener，并将同源 `/api` 和 `/studio-workloads/` 路由代理到 `127.0.0.1:5182`。Control 应配置精确 origin 和持久状态目录：

```dotenv
STUDIO_MODE=local
STUDIO_CONTROL_HOST=127.0.0.1
STUDIO_CONTROL_PORT=5182
STUDIO_CONTROL_DATA_DIR=/var/lib/cyrene/studio-control
STUDIO_PUBLIC_ORIGINS=http://127.0.0.1:8100,http://localhost:8100
```

`STUDIO_DATABASE_URL` remains unset for a first local installation. Control runs as the dedicated unprivileged service account. The Workspace CLI/Broker owns installation authority; the HTTP process does not receive root privileges or an installer helper.

首次 local 安装不设置 `STUDIO_DATABASE_URL`。Control 使用专用非特权服务账号运行。Workspace CLI/Broker 持有安装 authority；HTTP 进程不获得 root 权限或 installer helper。

## Optional direct Product APIs / 可选 Product API 直连

Direct Product mode is disabled by default. It is admitted only when `STUDIO_MODE=local`, `STUDIO_NAVIGATOR_URL` is unset, and an explicit Catalyst loopback origin and server-side token are configured. Echo is optional and uses the same rules. Each URL must be an HTTP(S) origin with no credentials, path, query, or fragment. Direct mode also requires a loopback Control listener and exact loopback `STUDIO_PUBLIC_ORIGINS` values.

Direct Product 模式默认关闭。只有 `STUDIO_MODE=local`、未设置 `STUDIO_NAVIGATOR_URL`，并且显式配置 Catalyst loopback origin 与服务端 token 时才启用。Echo 可选且遵循相同规则。URL 必须是没有 credentials、path、query 或 fragment 的 HTTP(S) origin。Direct 模式也要求 Control listener 和 `STUDIO_PUBLIC_ORIGINS` 均为 loopback，且 origin 值完全匹配。

Provide service credentials through protected files rather than putting their values in environment files or browser configuration:

服务凭据通过受保护的文件提供，不将密钥值写入普通环境文件或浏览器配置：

```dotenv
# Set each URL to the actual local service origin; direct mode requires Catalyst.
STUDIO_CATALYST_URL=
STUDIO_CATALYST_API_TOKEN_FILE=/etc/cyrene/secrets/catalyst-api-token
# Optional:
STUDIO_ECHO_URL=
STUDIO_ECHO_API_TOKEN_FILE=/etc/cyrene/secrets/echo-api-token
```

The file paths above are configuration examples; the operator or Workspace host supplies actual loopback service origins and secret files. A URL and its token must be configured together. Enabling direct mode requires Catalyst; an Echo route without its optional target returns `503`.

以上文件路径仅为配置示例；实际 loopback 服务 origin 和密钥文件由 operator 或 Workspace host 提供。URL 与 token 必须成对配置。启用 direct 模式必须配置 Catalyst；没有可选 Echo target 时，Echo 路由返回 `503`。

The bridge returns the existing Navigator session wire shape at `GET /api/v1/auth/session` only while direct mode is explicitly configured. The unauthenticated local response includes `authenticated: true`, `state: "AUTHENTICATED"`, `sessionId: "local"`, `refreshable: false`, and a process-local `csrfToken`; host probes must discard the response body and must never log that token. With no direct Product target, this compatibility path and Product routes remain unavailable. Product requests still pass through the fixed route allowlist, local origin check, `products.*` scope check, and local `X-CSRF-Token` validation for mutations. Only the configured server-side Bearer token is sent upstream; browser `Authorization`, cookies, Origin, and CSRF headers are never forwarded. Navigator mode preserves its existing auth/pair/refresh/logout proxy behavior; configuring Navigator and direct targets together is rejected.

只有显式配置 Direct Product 模式时，桥接层才在 `GET /api/v1/auth/session` 返回现有 Navigator session wire shape。未经登录的 local response 含 `authenticated: true`、`state: "AUTHENTICATED"`、`sessionId: "local"`、`refreshable: false` 和进程内 `csrfToken`；host probe 只应丢弃整个 response body，绝不记录该 token。没有 Direct Product target 时，这个兼容路由和 Product 路由保持不可用。Product 请求仍先经过固定路由 allowlist、本地 origin 检查、`products.*` scope 检查；mutation 还必须通过 local `X-CSRF-Token` 校验。上游只收到已配置的服务端 Bearer token；浏览器的 `Authorization`、cookies、Origin 和 CSRF header 都不会转发。Navigator 模式保持原有 auth/pair/refresh/logout 代理行为；direct target 与 Navigator 同时配置时 Control 会拒绝启动。

## Release verification / 发布验证

`.github/workflows/workspace-control-release.yml` runs only for `develop`, `main`, and `release` pushes and waits for successful Client CI on the exact pushed SHA. It downloads the official Node.js `v24.21.0` Linux x64 archive and checks its pinned SHA-256 before extracting `bin/node` and `LICENSE`. The ESM bundle supplies a `createRequire` shim for existing CommonJS dependencies. The workflow validates the standard Workspace v2 manifest and v1 release index against a pinned merged Workspace schema/Catalog commit, attests the archive, manifest, and index, publishes an immutable source-SHA release, then downloads and verifies every published asset and attestation.

`.github/workflows/workspace-control-release.yml` 仅响应 `develop`、`main` 和 `release` 分支 push，并等待该 push SHA 的 Client CI 成功。它下载官方 Node.js `v24.21.0` Linux x64 归档，并在提取 `bin/node` 和 `LICENSE` 前校验固定 SHA-256。ESM bundle 提供 `createRequire` shim，以支持已有 CommonJS 依赖。工作流使用固定的 Workspace 已合并 schema/Catalog commit 校验标准 v2 manifest 与 v1 release index，为 archive、manifest 和 index 分别生成 attestation，发布不可变 source-SHA release，再下载并核验所有正式发布的 assets 与 attestation。
