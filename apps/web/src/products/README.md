# Client Product surface / Client Product 页面

This directory holds the web Product workspace, the paired transport, and the
integration alert surface. Server-owned state remains in Navigator, Control,
Exchange, or the owning Product; this directory contains presentation state only.

此目录存放 Web Product 工作区、配对传输层和集成通知页面。服务端状态仍归 Navigator、Control、Exchange 或所属 Product 管理；此目录仅保留页面展示状态。

| File | Responsibility |
| --- | --- |
| `ProductWorkspace.tsx` | Authenticated Product page router / 已认证 Product 页面路由 |
| `WorkspaceTrainingConsole.tsx` | Workspace-backed training pages / Workspace 训练页面 |
| `workspace-training-api.ts` | Workspace BFF training client / Workspace BFF 训练客户端 |
| `navigation.ts` | Product page labels / Product 页面标签 |
| `transport.ts` | Paired same-origin Control transport / 配对同源 Control 传输 |
| `products.css` | Product page styles / Product 页面样式 |
| `IntegrationAlerts.tsx` | Authorization, notification, and cloud observation UI / 授权、通知与云观测界面 |
| `integrations-client.ts` | Validated Exchange integration API / 已校验的 Exchange 集成 API |
| `integration-notification-feed.ts` | Durable sequence recovery and SSE deduplication / 持久序号恢复与 SSE 去重 |
| `integration-notification-permission.ts` | Explicit browser notification permission / 显式浏览器通知权限 |
| `integration-renewal-storage.ts` | Session-scoped same-key renewal recovery handle / 会话范围内的同键续期恢复句柄 |
| `integrations.test.ts` | API, permission, view-state, and feed tests / API、权限、展示状态与通知流测试 |

Suggested reading order: `transport.ts` → `ProductWorkspace.tsx` →
`integrations-client.ts` → `integration-notification-feed.ts` →
`integration-renewal-storage.ts` → `IntegrationAlerts.tsx` → `integrations.test.ts`.

建议阅读顺序：`transport.ts` → `ProductWorkspace.tsx` →
`integrations-client.ts` → `integration-notification-feed.ts` →
`integration-renewal-storage.ts` → `IntegrationAlerts.tsx` → `integrations.test.ts`。
