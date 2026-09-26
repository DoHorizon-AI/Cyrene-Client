# Device approval UI

This directory owns the Cyrene Client device-approval screen and the typed boundary to a same-origin Web Host adapter. It does not implement login, a BFF route, membership checks, WebAuthn verification, or certificate issuance.

| File | Responsibility |
| --- | --- |
| `client.ts` | Mirrors the Platform enrollment approval request/response shapes, validates adapter responses, and converts browser WebAuthn assertions. |
| `DeviceApprovalPage.tsx` | Shows exact device/scope/digest/expiry data and exposes approve/deny only when both a trusted session and adapter are injected. |
| `device-approval.css` | Responsive styling for the approval page. |

Suggested reading order: `client.ts` → `DeviceApprovalPage.tsx` → `device-approval.css`.

## Integration boundary

The Platform OpenAPI v1 defines `POST /v1/device-authorizations/approval-challenges`, `POST /v1/device-authorizations/approval-challenges/{approval_id}/complete`, and `POST /v1/device-authorizations/denials`. This Client surface has no matching same-origin device BFF routes or trusted interactive-user session provider. The existing `apps/web/src/services/client.ts` session is a local Web Host pairing projection and does not identify an organization member. `App.tsx` therefore mounts this page with `sessionStatus="unavailable"`; it sends no request and keeps controls disabled.

`DeviceApprovalClient` accepts a `DeviceApprovalTransport` supplied by the Web Host. The transport must map the exact Platform OpenAPI fields to same-origin routes, preserve the authenticated user session/CSRF boundary, and never log user codes, assertions, or response bodies. Do not wire it directly to a public Product API. The current Platform HTTP contract is a handler-port target and is not production-backed, so the UI does not claim a working approval service.

On an integrated surface, the page passes verifier-generated request options to `navigator.credentials.get()`, serializes the returned assertion, and displays only the approval state and trusted approver metadata. The page never receives or displays certificate private keys.

---
<!-- Chinese Translation / 中文翻译 -->

# 设备审批 UI

此目录负责 Cyrene Client 设备审批页面，以及连接同源 Web Host 适配器的类型化边界。它不实现登录、BFF 路由、成员资格校验、WebAuthn 验证或证书签发。

| 文件 | 职责 |
| --- | --- |
| `client.ts` | 镜像 Platform 入网审批请求/响应字段，校验适配器响应，并转换浏览器 WebAuthn 断言。 |
| `DeviceApprovalPage.tsx` | 展示精确设备、范围、指纹与到期信息；只有同时注入可信会话和适配器时才开放批准/拒绝操作。 |
| `device-approval.css` | 设备审批页面的响应式样式。 |

建议阅读顺序：`client.ts` → `DeviceApprovalPage.tsx` → `device-approval.css`。

## 集成边界

Platform OpenAPI v1 定义了 `POST /v1/device-authorizations/approval-challenges`、`POST /v1/device-authorizations/approval-challenges/{approval_id}/complete` 和 `POST /v1/device-authorizations/denials`。当前 Client 页面没有相应的同源设备 BFF 路由，也没有可信的交互用户会话提供方。现有 `apps/web/src/services/client.ts` 会话只是本地 Web Host 配对投影，不能证明调用者是组织成员。因此 `App.tsx` 以 `sessionStatus="unavailable"` 挂载页面；页面不会发送请求，并保持所有操作禁用。

`DeviceApprovalClient` 接收由 Web Host 提供的 `DeviceApprovalTransport`。该适配器必须把精确 Platform OpenAPI 字段映射到同源路由，保留已认证用户会话和 CSRF 边界，且不得记录用户码、断言或响应正文。不要让其直接调用公开 Product API。当前 Platform HTTP 合同仍是 handler-port 目标，尚无生产后端支撑，因此 UI 不会宣称审批服务可用。

集成后的页面会把验证器生成的请求选项传给 `navigator.credentials.get()`，序列化返回的断言，并只展示审批状态和可信审批人元数据。页面不会接收或展示证书私钥。
