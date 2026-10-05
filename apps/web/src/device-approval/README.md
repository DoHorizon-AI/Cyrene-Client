# Device approval UI

This directory owns the Cyrene Client device-approval screen and its typed same-origin BFF boundary. It does not implement login, membership checks, WebAuthn verification, or certificate issuance.

| File | Responsibility |
| --- | --- |
| `client.ts` | Mirrors the Platform enrollment approval request/response shapes, validates adapter responses, and converts browser WebAuthn assertions. |
| `bff-transport.ts` | Calls only the fixed same-origin Workspace BFF session and device-approval routes with the verified session CSRF token. |
| `DeviceApprovalPage.tsx` | Shows exact device/scope/digest/expiry data and exposes approve/deny only when both a trusted session and adapter are injected. |
| `DeviceApprovalRoute.tsx` | Probes the same-origin BFF session and injects the typed client only when the session outcome is usable. |
| `device-approval.css` | Responsive styling for the approval page. |

Suggested reading order: `client.ts` → `bff-transport.ts` → `DeviceApprovalRoute.tsx` → `DeviceApprovalPage.tsx` → `device-approval.css`.

## Integration boundary

`/device-approval` now mounts `DeviceApprovalRoute`, which starts in `checking` and probes only the same-origin `/api/workspace/v1/session` route. It passes the existing typed client after an authenticated or anonymous BFF response; only `authenticated` enables approval controls. Missing, malformed, expired, or unavailable sessions remain unavailable, and unmounting cancels the probe. `bff-transport.ts` reads the verified `WebSession`, keeps the CSRF token in memory, sends it in `X-CSRF-Token`, and never puts identity in request JSON. The browser never calls a Product or Platform URL directly or receives a bearer token. This is UI wiring only: a missing live BFF still leaves the page unavailable and does not prove login, Directory authorization, WebAuthn, or approval readiness.

`DeviceApprovalClient` validates exact Platform OpenAPI fields around `SameOriginDeviceApprovalTransport`. The transport uses same-origin credentials, rejects redirects, rechecks the verified session before every mutation, and never logs user codes, assertions, or response bodies. `DeviceApprovalRoute` mounts the client for recognized BFF session outcomes, while the page keeps every approval action disabled unless the outcome is authenticated. The server still owns the durable route, role, and WebAuthn checks.

On an integrated surface, the page passes verifier-generated request options to `navigator.credentials.get()`, serializes the returned assertion, and displays only the approval state and trusted approver metadata. The page never receives or displays certificate private keys.

---
<!-- Chinese Translation / 中文翻译 -->

# 设备审批 UI

此目录负责 Cyrene Client 设备审批页面，以及同源 BFF 的类型化边界。它不实现登录、成员资格校验、WebAuthn 验证或证书签发。

| 文件 | 职责 |
| --- | --- |
| `client.ts` | 镜像 Platform 入网审批请求/响应字段，校验适配器响应，并转换浏览器 WebAuthn 断言。 |
| `bff-transport.ts` | 仅调用固定的同源 Workspace BFF session 与设备审批路由，并携带已验证 session 的 CSRF token。 |
| `DeviceApprovalPage.tsx` | 展示精确设备、范围、指纹与到期信息；只有同时注入可信会话和适配器时才开放批准/拒绝操作。 |
| `DeviceApprovalRoute.tsx` | 探测同源 BFF session，并仅在会话状态可用时注入类型化客户端。 |
| `device-approval.css` | 设备审批页面的响应式样式。 |

建议阅读顺序：`client.ts` → `bff-transport.ts` → `DeviceApprovalRoute.tsx` → `DeviceApprovalPage.tsx` → `device-approval.css`。

## 集成边界

`/device-approval` 现在挂载 `DeviceApprovalRoute`，初始状态为 `checking`，并且只探测同源 `/api/workspace/v1/session`。BFF 返回 authenticated 或 anonymous 后才注入已有类型化客户端；只有 authenticated 才开放审批操作。缺失、格式错误、过期或不可用的 session 保持 unavailable；组件卸载时会取消探测。`bff-transport.ts` 读取经验证的 `WebSession`，将 CSRF token 仅保存在内存，并通过 `X-CSRF-Token` 发送；请求 JSON 不包含身份信息。浏览器不会直接调用 Product 或 Platform URL，也不会取得 bearer token。这只是 UI 接线：没有真实 BFF 时页面仍显示不可用，不代表登录、Directory 授权、WebAuthn 或审批服务已就绪。

`DeviceApprovalClient` 在 `SameOriginDeviceApprovalTransport` 周围校验精确 Platform OpenAPI 字段。传输使用同源凭据、拒绝重定向，并在每次变更前重新检查已验证 session；不会记录用户码、断言或响应正文。`DeviceApprovalRoute` 仅在 BFF 返回可识别的 session 状态后挂载客户端；页面只有在状态为 authenticated 时才开放审批操作。持久路由、角色和 WebAuthn 校验仍由服务端负责。

集成后的页面会把验证器生成的请求选项传给 `navigator.credentials.get()`，序列化返回的断言，并只展示审批状态和可信审批人元数据。页面不会接收或展示证书私钥。
