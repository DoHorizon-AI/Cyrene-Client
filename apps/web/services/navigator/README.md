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

在 `.env.local` 设置 `STUDIO_NAVIGATOR_URL` 连接现有 Web Host。Studio 登录和 Web Host 配对保持各自协议，业务状态仍由 Product 管理。完整设计与部署迁移见 [Navigator monitoring](../../../../docs/navigator-monitoring.md)。

The original console was rebuilt in Client rather than copied from Navigator's historical vanilla-TypeScript API preview. This integration changes its browser shell, not Product ownership or the backend Navigator Agent service.
