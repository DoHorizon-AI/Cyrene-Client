# Workspace BFF same-origin routing

The Web edge reserves `/api/workspace/v1/` for the Workspace BFF. Its more
specific Nginx prefix wins over the existing `/api/` Exchange route, so a
disabled or incomplete BFF configuration returns `503` and never falls
through to Exchange. The bare path without a trailing slash returns `404`, so
it also cannot enter the Exchange catch-all.

The route is disabled in the image by default. Nginx renders `nginx.conf` from
the official image template directory and substitutes only the three
`CYRENE_WORKSPACE_BFF_*` variables. The Nginx variables such as `$host`, `$uri`,
and `$http_x_ms_token_aad_access_token` remain intact. The BFF upstream is
resolved when a request arrives, so its DNS record does not need to exist when
Nginx starts.

| Container App setting | Image default | Purpose |
| --- | --- | --- |
| `CYRENE_WORKSPACE_BFF_ENABLED` | `false` | Must be exactly `true` to enable forwarding. |
| `CYRENE_WORKSPACE_BFF_UPSTREAM` | empty | Internal ACA host and port, without a scheme or path. |
| `CYRENE_WORKSPACE_BFF_DNS_RESOLVER` | `168.63.129.16` | DNS resolver used for request-time upstream lookup; set the environment's resolver when custom DNS is configured. |

Enable this route only after the BFF has internal-only ACA ingress, ACA Easy
Auth protects the Web path, Easy Auth token storage can issue the BFF's access
token, and the BFF validates the configured API issuer and audience. Then set
the upstream to the BFF's internal FQDN and set
`CYRENE_WORKSPACE_BFF_ENABLED=true` on the Web Container App revision. Keep the
route disabled until those identity and service settings are ready.

Nginx returns `401` when the access-token header is absent. When present, it
replaces any browser-supplied `Authorization` value with
`Bearer <X-MS-TOKEN-AAD-ACCESS-TOKEN>`, strips the Easy Auth token headers and
the `X-MS-CLIENT-PRINCIPAL`, `-ID`, `-NAME`, and `-IDP` headers, and forwards the
original Workspace URI. The BFF must validate the bearer token and apply its
own authorization policy; it must not treat principal headers as identity
proof.

CI renders and validates the default-off template, checks that envsubst kept
Nginx's token variables and bearer mapping intact, and exercises four route
responses: the bare path returns `404`, default-off returns `503`,
`ENABLED=true` with an empty upstream returns `503`, and an enabled route with
a configured but unresolved upstream returns `401` when only browser-supplied
Authorization/principal headers are present. This patch does not change
deployment workflow settings or the live Container App.

<!-- Chinese Translation / 中文翻译 -->

# Workspace BFF 同源路由

Web 入口为 Workspace BFF 保留 `/api/workspace/v1/`。该 Nginx 前缀比现有
`/api/` Exchange 路由更具体，因此 BFF 关闭或配置不完整时会返回 `503`，不会
回落到 Exchange。不带末尾斜线的根路径返回 `404`，也不会进入 Exchange 通配路由。

镜像默认关闭此路由。Nginx 从官方镜像模板目录渲染 `nginx.conf`，只替换三个
`CYRENE_WORKSPACE_BFF_*` 配置变量；`$host`、`$uri` 和
`$http_x_ms_token_aad_access_token` 等 Nginx 变量保持原样。BFF upstream 在收到
请求时才解析，因此 Nginx 启动时不要求目标 DNS 记录已存在。

| Container App 配置 | 镜像默认值 | 用途 |
| --- | --- | --- |
| `CYRENE_WORKSPACE_BFF_ENABLED` | `false` | 必须精确设置为 `true` 才会转发。 |
| `CYRENE_WORKSPACE_BFF_UPSTREAM` | 空 | 内部 ACA 主机名与端口，不含 scheme 或 path。 |
| `CYRENE_WORKSPACE_BFF_DNS_RESOLVER` | `168.63.129.16` | 请求时解析 upstream 使用的 DNS；配置了自定义 DNS 时应填写环境对应的解析器。 |

只有在 BFF 使用 ACA internal-only ingress、ACA Easy Auth 保护 Web 路径、Easy
Auth token store 能签发面向 BFF 的 access token，且 BFF 验证配置的 API issuer
与 audience 后，才启用此路由。将 upstream 设置为 BFF 内部 FQDN，并在 Web
Container App revision 上设置 `CYRENE_WORKSPACE_BFF_ENABLED=true`。身份和服务配置
就绪前应保持关闭。

缺少 access-token header 时 Nginx 返回 `401`。header 存在时，Nginx 将浏览器传入
的 `Authorization` 替换为 `Bearer <X-MS-TOKEN-AAD-ACCESS-TOKEN>`，清除 Easy Auth
token headers 和 `X-MS-CLIENT-PRINCIPAL`、`-ID`、`-NAME`、`-IDP` headers，并原样转发
Workspace URI。BFF 必须验证 bearer token 并执行自己的授权策略，不能把 principal
header 当作身份证明。

CI 会渲染并验证默认关闭的模板，确认 envsubst 保留 Nginx token 变量与 bearer 映射，
并检查四种响应：无末尾斜线的根路径返回 `404`；默认关闭时返回 `503`；`ENABLED=true`
但 upstream 为空时返回 `503`；upstream 已配置但无法解析、且请求只带浏览器传入的
Authorization/principal headers 时返回 `401`。本补丁不更改部署 workflow，也不操作
线上 Container App。
