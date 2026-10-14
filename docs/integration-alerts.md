# Client integration alerts and cloud observations

This page uses the existing paired Navigator Web Host and Control session to read
actor-scoped Exchange projections. It does not create a Client identity store or
copy Product state into a local database.

此页面复用已配对的 Navigator Web Host 与 Control 会话，读取按操作者范围过滤的 Exchange 投影。它不会创建 Client 身份库，也不会把 Product 状态复制到本地数据库。

## Connection and authorization state

The connection picker comes from `GET /api/v1/integrations/connections`. Exchange
filters that list by the authenticated actor and workspace. The Client shows only
the server-issued connection label and provider; it does not display `bindingRef`
or `targetRef`, and it never accepts a manually entered provider target.

连接选择器读取 `GET /api/v1/integrations/connections`。Exchange 按已认证操作者和工作空间过滤列表。Client 只显示服务端返回的连接名称和服务商，不展示 `bindingRef` 或 `targetRef`，也不接受手工输入的服务商目标。

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

具备操作权限的用户可通过 Product 管理的续期会话路由启动续期。Client 要求服务端返回已接受状态和同源 Product `Location`，随后轮询该续期会话。用户主动点击后，Client 会在新标签页打开 HTTPS 授权地址；页面不会显示原始 URL、二维码附件引用、凭据或本机路径。操作者与已配置绑定的校验仍由 Exchange 负责。

## Notifications

The durable in-app feed starts with `GET /api/v1/integrations/notifications?after={sequence}`
and resumes `GET /api/v1/integrations/notifications/events` with `Last-Event-ID`.
Each SSE notification must carry the same sequence in its event ID and body. The
Client deduplicates by both notification ID and sequence, reloads the durable feed
after a gap or disconnect, and acknowledges through the idempotent Product route.

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

单元测试使用本地 API fixture 验证权限状态、Control 操作者范围、错误脱敏、连接投影、事件去重、离线恢复和过期时间显示。测试不会访问服务商 API、发送邮件，也不能证明 Client 页面关闭时的浏览器通知投递。
