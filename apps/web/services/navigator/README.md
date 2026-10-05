# Navigator management components / Navigator 管理组件

These Product management pages are composed by the Studio workbench. There is no separate HTML shell, npm dependency lock, or production bundle. The original API validation, session protocol, routes and bilingual messages remain here; Studio provides the lazy-loaded page wrapper and scoped styles in `apps/web/src/products`.

原有模型、数据集、训练、运行、部署、网关、聊天和设置页面已收入 Studio，通过顶栏工具菜单访问。该目录保留业务组件、API 校验、路由兼容和翻译；不再独立构建或部署。右侧 Navigator 运行监控位于 `apps/web/src/monitoring`，与这里的全局业务页面分开。

From the repository root / 在仓库根目录运行：

```bash
npm ci
npm run dev
npm run check
```

Configure `STUDIO_NAVIGATOR_URL` in `.env.local` to connect the existing Web Host. Studio authentication and Web Host pairing remain separate; Product services still own their workflow state. `npm run check:web:navigator` runs only this module's tests, while `npm run build:web:navigator` aliases the unified build.

The `/assistant` page uses the existing paired Web Host and Control session. Tasks remain owned by Navigator after the Client page closes; approvals, pending user-input requests, memory, notifications and attachments use the configured workspace Work API. Set `STUDIO_WORKSPACE_ID` to the same workspace configured on the Navigator deployment. The UI never receives an executor or Work API bearer. QQ login is available only for the configured binding when the host reports `NATIVE_READY` and its dedicated account is confirmed; QR text is rendered locally, kept out of logs, and hidden when the server state changes or its expiry passes. Attachment uploads are limited to 10 MB.

`/assistant` 页面使用现有的 Web Host 配对会话和 Control 会话。关闭 Client 页面后，任务仍由 Navigator 管理；审批、待补充信息、记忆、通知和附件通过已配置的工作空间 Work API 读取或更新。`STUDIO_WORKSPACE_ID` 必须与 Navigator 部署配置的工作空间一致。执行器或 Work API bearer 不会发送到浏览器。只有当主机状态为 `NATIVE_READY` 且专用账号已确认时，才能为已配置的 binding 启动 QQ 登录；二维码文本只在本机浏览器渲染，不写入日志，并会在服务端状态改变或到期后隐藏。附件上传上限为 10 MB。

在 `.env.local` 设置 `STUDIO_NAVIGATOR_URL` 连接现有 Web Host。Studio 登录和 Web Host 配对保持各自协议，业务状态仍由 Product 管理。完整设计与部署迁移见 [Navigator monitoring](../../../../docs/navigator-monitoring.md)。

The original console was rebuilt in Client rather than copied from Navigator's historical vanilla-TypeScript API preview. This integration changes its browser shell, not Product ownership or the backend Navigator Agent service.
