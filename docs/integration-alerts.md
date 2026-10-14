# Client integration alerts and cloud observations

This page uses the existing paired Navigator Web Host and Control session as its
browser transport, plus an explicit personal first-party Product bearer for
Exchange identity. Exchange verifies the bearer and scopes its projections; the
page does not infer Exchange identity from the Control actor or copy Product
state into a local database.

此页面复用已配对的 Navigator Web Host 与 Control 会话作为浏览器传输，并要求显式提供个人 first-party Product bearer 作为 Exchange 身份。Exchange 校验 bearer 并过滤投影；页面不会从 Control 操作者推断 Exchange 身份，也不会把 Product 状态复制到本地数据库。

## First-party Exchange access

The integrations page asks for a personal Cyrene first-party Product bearer and
an Exchange workspace selector. The bearer stays in page memory, is cleared on
signout or scope change, and is never written to browser storage, logs, or model
input. The workspace value is a selector only; Exchange checks it against the
verified bearer principal. Use this bearer instead of a Studio login or MCP token.

For the closed integrations and renewal routes, the browser sends
`X-Cyrene-Product-Authorization: Bearer ...` and `X-Cyrene-Workspace-Id` alongside
the existing same-origin Control and Web Host session material. Control first
checks its normal session, CSRF, and `products.read` / `products.operate` scope,
then forwards only those two dedicated headers. Navigator Web Host converts the
bearer to upstream `Authorization` only for its explicitly configured Exchange
target; it does not use a static or shared target credential as a fallback.
Ordinary Control `Authorization`, cookies, and execution credentials do not
become the Exchange principal.

集成页面要求个人 Cyrene first-party Product bearer 与 Exchange 工作空间选择器。bearer 仅保存在页面内存中，退出登录或切换范围时清除，不写入浏览器存储、日志或模型输入。工作空间值仅是选择器；Exchange 会根据已验证 bearer 主体检查该值。请使用此 bearer，而不要使用 Studio 登录凭据或 MCP token。

对于封闭的 integrations 与 renewal 路由，浏览器在现有同源 Control 和 Web Host 会话材料之外发送 `X-Cyrene-Product-Authorization: Bearer ...` 与 `X-Cyrene-Workspace-Id`。Control 先检查常规会话、CSRF 和 `products.read` / `products.operate` 范围，再仅转发这两个专用 header。Navigator Web Host 只会为显式配置的 Exchange 目标将 bearer 转成上游 `Authorization`；没有静态或共享目标凭据回退。普通 Control `Authorization`、cookie 和 execution credential 不会成为 Exchange 身份。

## Connection and authorization state

The connection picker comes from `GET /api/v1/integrations/connections`. Exchange
filters that list by the verified bearer principal and selected workspace. The Client shows only
the server-issued connection label and provider; it does not display `bindingRef`
or `targetRef`, and it never accepts a manually entered provider target.

连接选择器读取 `GET /api/v1/integrations/connections`。Exchange 按已验证 bearer 主体和所选工作空间过滤列表。Client 只显示服务端返回的连接名称和服务商，不展示 `bindingRef` 或 `targetRef`，也不接受手工输入的服务商目标。

`GET /api/v1/integrations/connections/{id}/authorization-health` reports login
presence and authorization health separately. A missing expiry stays unknown. The
screen shows the server check time and each capability's verification and expiry
values without interpreting an unknown value as valid or expired.

`GET /api/v1/integrations/connections/{id}/authorization-health` 分别报告登录是否存在和授权健康状态。缺少过期时间时始终显示未知。页面显示服务端检查时间以及各能力的验证/过期时间，不会把未知值推断为有效或已过期。

Before the first successful check, `checkedAt` and `authorizationRef` may be null.
The Client shows `UNKNOWN` and keeps renewal disabled until Exchange returns a
server-owned authorization reference; it never derives one from a provider alias.

首次成功检查前，`checkedAt` 和 `authorizationRef` 可以为 null。Exchange 返回服务端管理的授权引用之前，Client 会显示 `UNKNOWN` 并禁用续期；它不会从服务商别名推导授权引用。

An operator can start a renewal through the Product-owned renewal session route.
The Client requires the accepted response and same-origin Product `Location`, then
polls that renewal session. A user action opens an HTTPS authorization URL in a
separate tab; the raw URL, QR attachment reference, credentials, and native paths
are not rendered. Exchange remains responsible for validating the operator and
the configured binding.

The Client keeps a pending idempotency key in browser `sessionStorage`, under a
hashed scope derived from the paired actor/session, workspace, Product connection,
and verified authorization reference. It clears that scope on signout or scope
change. After a provider start has an ambiguous outcome, the UI can offer an
explicit retry with the same key only for WeCom states Exchange marks safe for
durable replay. The Client never automatically replays and never replaces an
unresolved key with a new one.

Before opening the returned URL, the Client validates one of two fixed WeCom
routes: the activation QR page (`/ai/qc/gen`) or the existing-profile grant
management page (`/ai/aiHelper/authorizationList`). The management URL must have
the exact message-capability query contract and is labeled as authorization or
permission management, not as a first-login QR. The Client does not log in,
reinitialize a profile, or display the raw URL.

在打开服务端返回的地址之前，Client 会严格校验两种固定企业微信路由之一：激活二维码页面（`/ai/qc/gen`）或现有配置的授权管理页面（`/ai/aiHelper/authorizationList`）。管理页必须符合精确的消息能力查询参数契约，界面将其标注为授权或权限管理，不会称作首次登录二维码。Client 不会执行登录、重新初始化配置或显示原始地址。

Renewal is exposed only for WeCom connections with a non-null authorization
reference returned by health. Cloud binding references are not renewable user
authorization references.

具备操作权限的用户可通过 Product 管理的续期会话路由启动续期。Client 要求服务端返回已接受状态和同源 Product `Location`，随后轮询该续期会话。用户主动点击后，Client 会在新标签页打开 HTTPS 授权地址；页面不会显示原始 URL、二维码附件引用、凭据或本机路径。操作者与已配置绑定的校验仍由 Exchange 负责。

Client 会将待处理幂等键保存到浏览器 `sessionStorage`，使用配对操作者/会话、工作空间、Product 连接和已验证授权引用的哈希范围隔离；退出登录或切换范围时清除此范围。服务商启动结果不明确时，仅当 Exchange 对企业微信状态确认支持持久重放，页面才允许用户主动使用同一幂等键重试。Client 不会自动重放，也不会用新键替换未解决的请求。

续期操作仅对健康状态返回了非空授权引用的企业微信连接开放。云绑定引用不是可续期的用户授权引用。

## Notifications

The durable in-app feed starts with `GET /api/v1/integrations/notifications?after={sequence}`
and resumes `GET /api/v1/integrations/notifications/events` with `Last-Event-ID`.
Each SSE notification must carry the same sequence in its event ID and body. The
Client deduplicates by both notification ID and sequence, reloads the durable feed
after a gap or disconnect, and acknowledges through the idempotent Product route.

Control checks the existing `products.read` / `products.operate` session scope,
then maps only the published integrations and renewal facades beneath the
configured Navigator Web Host Exchange prefix. `X-Cyrene-Product-Authorization`
and `X-Cyrene-Workspace-Id` carry the explicit Exchange credential context across
that route; `Accept: text/event-stream` and
`Last-Event-ID` remain HTTP headers end to end; the SSE response body is relayed
without JSON/catalog invocation. The flat renewal GET
`/api/v1/accounts/renewal-sessions/{session_id}` is the published Product route.

Control 会先校验现有 `products.read` / `products.operate` 会话范围，再将已发布的 integrations 与 renewal facade 映射到配置的 Navigator Web Host Exchange 前缀下。`X-Cyrene-Product-Authorization` 与 `X-Cyrene-Workspace-Id` 会在该路由上传递显式 Exchange 凭据上下文；`Accept: text/event-stream` 与 `Last-Event-ID` 会作为 HTTP header 原样传递；SSE 响应体直接转发，不经过 JSON/catalog invocation。扁平的续期 GET `/api/v1/accounts/renewal-sessions/{session_id}` 是当前发布的 Product 路由。

持久页面通知先读取 `GET /api/v1/integrations/notifications?after={sequence}`，再使用 `Last-Event-ID` 恢复 `GET /api/v1/integrations/notifications/events`。每个 SSE 通知的事件 ID 必须与正文序号一致。Client 同时按通知 ID 和序号去重，在序号有缺口或连接中断后重新读取持久通知，并通过带幂等键的 Product 路由确认通知。

Browser notification permission is requested only after an explicit button click.
Denied and unsupported browser states remain visible. Browser notifications are
available while this Client page is open. Email notifications are handled
independently; this page does not verify or guarantee their delivery. The page
does not claim Web Push or browser-closed delivery.

浏览器通知权限只会在用户主动点击按钮后请求。页面会明确显示权限被拒绝或浏览器不支持的状态。浏览器通知仅在 Client 页面打开时可用。邮件通知由独立通道处理；此页面不会验证或保证邮件投递。页面不宣称支持 Web Push 或浏览器关闭后的投递。

## Cloud observations

`GET /api/v1/integrations/connections/{id}/resources` reads Exchange's
Product-owned observation projection. The idempotent
`POST /api/v1/integrations/connections/{id}/actions/refresh` returns an accepted
Product operation reference. The Client labels that state as asynchronous and
reads the latest observation separately. The UI shows the provider's status,
Exchange freshness (`FRESH`, `STALE`, or `UNKNOWN`), collection time, and provider
observation time. It does not register or schedule resources; Platform remains
the resource registry, capacity, and lease authority.

`GET /api/v1/integrations/connections/{id}/resources` 读取由 Exchange 管理的 Product 观测投影。刷新使用带幂等键的显式 `POST` 操作，并返回 Product operation 引用；Client 将其标记为异步请求，再单独读取最新观测。界面显示服务商状态、Exchange 新鲜度（`FRESH`、`STALE` 或 `UNKNOWN`）、采集时间与服务商观测时间。它不会注册或调度资源；资源注册、容量和租约仍由 Platform 管理。

Configured `azure`, `gcp`, `hf`, `runpod`, and `tailscale` connections may use the
approved read-only query route. The Client renders provider state as returned;
for example, RunPod `desiredStatus` remains `UNKNOWN` because it is an expected
state rather than an observation of running compute.

已配置的 `azure`、`gcp`、`hf`、`runpod` 和 `tailscale` 连接可使用获准的只读查询路由。Client 按服务端结果显示状态；例如 RunPod 的 `desiredStatus` 仍显示为 `UNKNOWN`，因为它表示预期状态，而非正在运行的计算资源观测。

## Validation limits

Unit tests use local API fixtures for permission states, actor-scoped Control
authorization, failure redaction, connection projections, event deduplication,
offline recovery, and expiry display. They do not contact vendor APIs, send email,
or prove browser notification delivery outside an open page.

The opt-in `tests/integration/exchange-proxy-loopback.test.ts` starts the actual
Navigator Web Host from `CYRENE_NAVIGATOR_ROOT` with
`CYRENE_NAVIGATOR_PYTHON`, then relays through a live local Control HTTP server
to a fake Exchange HTTP endpoint. This is simulated routing evidence using a
synthetic bearer; it does not validate a real Platform identity or call an
Exchange tenant. The test is skipped when either environment variable is absent.
Client CI checks out Navigator at `e90288c8a4ecbcb3711d554366e7ac5227e62397`,
installs its declared Python dependencies, and enables this test; the test rejects
any Navigator source tree whose `HEAD` differs from that pin.

单元测试使用本地 API fixture 验证权限状态、Control 操作者范围、错误脱敏、连接投影、事件去重、离线恢复和过期时间显示。测试不会访问服务商 API、发送邮件，也不能证明 Client 页面关闭时的浏览器通知投递。

可选的 `tests/integration/exchange-proxy-loopback.test.ts` 在设置 `CYRENE_NAVIGATOR_ROOT` 与 `CYRENE_NAVIGATOR_PYTHON` 后启动真实 Navigator Web Host，通过运行中的本地 Control HTTP 服务转发到假 Exchange HTTP endpoint。此项是使用合成 bearer 的模拟路由证据；它不会验证真实 Platform 身份，也不会调用 Exchange 租户。缺少任一环境变量时会跳过该测试。

Client CI 会检出 Navigator 固定提交 `e90288c8a4ecbcb3711d554366e7ac5227e62397`，安装其声明的 Python 依赖并启用此测试；测试会拒绝 `HEAD` 与固定提交不一致的 Navigator 源码树。
