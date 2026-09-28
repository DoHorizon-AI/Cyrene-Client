# Workspace Web image for device approval

`Dockerfile.workspace-web` builds the primary `apps/web` application into a
separate static image. It includes the `/device-approval` page from the root
application and does not install or build the optional Navigator UI package.
The dedicated Vite configuration fixes the asset base at `/` and writes to
`dist-workspace-web`, keeping this artifact separate from the Navigator bundle.

Build from the repository root so Docker can read the root package lock and
Nginx support files:

```sh
docker build -f Dockerfile.workspace-web -t cyrene-client-workspace-web:local .
```

The image listens on port `80` and reports readiness at `/healthz`. Nginx serves
the root SPA bundle at `/`; its `try_files` fallback also serves
`/device-approval` on a direct navigation or refresh. Nginx sends `/studio-*`
and non-BFF `/api` requests through `STUDIO_CONTROL_ORIGIN` (default
`http://studio-control:5182`) so Web Host authentication and the Product
allowlist remain in effect. The Exchange API-key gateway path `/v1/` remains
internal to `cyrene-exchange`; both upstream services must be resolvable on the
container network. The device-approval page itself does not call those APIs and
does not require Navigator.

The approval screen is intentionally non-operational until a trusted
interactive identity and the verified same-origin BFF adapter are integrated.
The app currently supplies `sessionStatus="unavailable"` and no approval API;
the user-code fields and decision actions remain disabled. Local Client pairing
is not treated as organization identity or Workspace membership. Serving the
static page does not mean sign-in, membership checks, WebAuthn approval, or
certificate issuance are available.

The Workspace BFF route is disabled in the image by default:

| Setting | Image default | Meaning |
| --- | --- | --- |
| `CYRENE_WORKSPACE_BFF_ENABLED` | `false` | Requests under `/api/workspace/v1/` return `503`. |
| `CYRENE_WORKSPACE_BFF_UPSTREAM` | empty | No forwarding target is configured. |
| `CYRENE_WORKSPACE_BFF_DNS_RESOLVER` | `168.63.129.16` | Request-time resolver used only if forwarding is enabled. |
| `CYRENE_WORKSPACE_BFF_EXPECTED_ENV_DOMAIN` | `whitefield-8c4d4393.eastasia.azurecontainerapps.io` | ACA environment suffix checked at container startup. |

The bare `/api/workspace/v1` path returns `404`; the more specific BFF prefix
never falls through to Exchange. Do not enable forwarding until the Web edge is
behind the configured identity provider, Easy Auth token issuance and audience
are verified, and the internal BFF enforces bearer validation, verified session,
membership authorization, and CSRF checks. The startup validator restricts the
configured upstream to the exact internal BFF hostname under the configured
ACA environment domain. The BFF must still validate every bearer token itself.

<!-- Chinese Translation / 中文翻译 -->

## 部署与设备审批 Web 镜像

`Dockerfile.workspace-web` 将 `apps/web` 主应用构建为独立静态镜像。它包含根应用中的
`/device-approval` 页面，不安装也不构建可选 Navigator UI package。专用 Vite 配置将静态资源
base 固定为 `/`，并写入独立的 `dist-workspace-web`，与 Navigator bundle 分开。

请从仓库根目录构建，以便 Docker 读取根 package lock 与 Nginx 支持文件：

```sh
docker build -f Dockerfile.workspace-web -t cyrene-client-workspace-web:local .
```

镜像监听 `80` 端口，并通过 `/healthz` 报告就绪。Nginx 在 `/` 提供根 SPA bundle；`try_files`
回落也会在直接访问或刷新时提供 `/device-approval`。Nginx 将 `/studio-*` 和非 BFF `/api` 请求经
`STUDIO_CONTROL_ORIGIN`（默认 `http://studio-control:5182`）转发，以保留 Web Host 身份验证与
Product allowlist。Exchange API Key 网关路径 `/v1/` 仍通过内部 `cyrene-exchange` 转发；这两个上游
服务都必须能在容器网络中解析。审批页面本身不会调用这些 API，也不依赖 Navigator。

在接入可信交互身份与已验证的同源 BFF adapter 前，审批页面刻意保持不可操作。应用当前传入
`sessionStatus="unavailable"` 且不注入审批 API；用户码字段和决策操作保持禁用。本地 Client
配对不代表组织身份或 Workspace 成员资格。静态页面可访问不代表登录、成员资格检查、WebAuthn
审批或证书签发已经可用。

Workspace BFF 路由在镜像中默认关闭：

| 配置项 | 镜像默认值 | 含义 |
| --- | --- | --- |
| `CYRENE_WORKSPACE_BFF_ENABLED` | `false` | `/api/workspace/v1/` 下请求返回 `503`。 |
| `CYRENE_WORKSPACE_BFF_UPSTREAM` | 空 | 未配置转发目标。 |
| `CYRENE_WORKSPACE_BFF_DNS_RESOLVER` | `168.63.129.16` | 仅在启用转发时使用的请求时 resolver。 |
| `CYRENE_WORKSPACE_BFF_EXPECTED_ENV_DOMAIN` | `whitefield-8c4d4393.eastasia.azurecontainerapps.io` | 容器启动时校验的 ACA 环境域名后缀。 |

不带末尾斜线的 `/api/workspace/v1` 返回 `404`；更具体的 BFF 前缀不会回落至 Exchange。只有在
Web 入口受身份提供方保护、Easy Auth token 签发与 audience 已验证，并且内部 BFF 执行 bearer 校验、
已验证 session、成员资格授权和 CSRF 检查后，才可启用转发。启动校验器会将 upstream 限制为配置的
ACA 环境域名下的精确 BFF 内部主机名。BFF 仍必须自行验证每个 bearer token。
