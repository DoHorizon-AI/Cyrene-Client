# Device approval UI

This directory owns the Cyrene Client device-approval screen and its typed same-origin BFF boundary. It does not implement login, membership checks, WebAuthn verification, or certificate issuance.

| File | Responsibility |
| --- | --- |
| `client.ts` | Mirrors the Platform enrollment approval request/response shapes, validates adapter responses, and converts browser WebAuthn assertions. |
| `bff-transport.ts` | Calls only the fixed same-origin Workspace BFF session and device-approval routes with the verified session CSRF token. |
| `DeviceApprovalPage.tsx` | Shows exact device/scope/digest/expiry data and exposes approve/deny only when both a trusted session and adapter are injected. |
| `device-approval.css` | Responsive styling for the approval page. |

Suggested reading order: `client.ts` → `bff-transport.ts` → `DeviceApprovalPage.tsx` → `device-approval.css`.

## Integration boundary

`bff-transport.ts` uses only the approved same-origin `/api/workspace/v1/session` and `/api/workspace/v1/device-authorizations/...` routes. It reads the verified `WebSession`, keeps the CSRF token in memory, sends it in `X-CSRF-Token`, and never puts identity in request JSON. The browser never calls a Product or Platform URL directly. `App.tsx` still mounts this page with `sessionStatus="unavailable"` and no transport until the BFF device routes and durable server-side session binding are available; no device request is sent and controls stay disabled.

`DeviceApprovalClient` validates exact Platform OpenAPI fields around `SameOriginDeviceApprovalTransport`. The transport uses same-origin credentials, rejects redirects, rechecks the verified session before every mutation, and never logs user codes, assertions, or response bodies. It is deliberately not mounted in `App.tsx` until the server route and durable session binding are ready, so the UI does not claim a working approval service.

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
| `device-approval.css` | 设备审批页面的响应式样式。 |

建议阅读顺序：`client.ts` → `bff-transport.ts` → `DeviceApprovalPage.tsx` → `device-approval.css`。

## 集成边界

`bff-transport.ts` 只使用已批准的同源 `/api/workspace/v1/session` 与 `/api/workspace/v1/device-authorizations/...` 路由。它读取经验证的 `WebSession`，将 CSRF token 仅保存在内存，并通过 `X-CSRF-Token` 发送；请求 JSON 不包含身份信息。浏览器不会直接调用 Product 或 Platform URL。BFF 设备路由和服务端持久 session 绑定就绪前，`App.tsx` 仍以 `sessionStatus="unavailable"` 且不注入 transport 来挂载页面；不会发送设备请求，所有操作保持禁用。

`DeviceApprovalClient` 在 `SameOriginDeviceApprovalTransport` 周围校验精确 Platform OpenAPI 字段。传输使用同源凭据、拒绝重定向，并在每次变更前重新检查已验证 session；不会记录用户码、断言或响应正文。服务端路由和持久 session 绑定就绪前，不会在 `App.tsx` 中挂载，因此 UI 不会宣称审批服务可用。

集成后的页面会把验证器生成的请求选项传给 `navigator.credentials.get()`，序列化返回的断言，并只展示审批状态和可信审批人元数据。页面不会接收或展示证书私钥。
