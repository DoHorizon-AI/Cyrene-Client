# Cyrene Installer UI prototype / Cyrene Installer UI 原型

This module is a UI-only prototype. The Client uses `DemoInstallerProvider` by default and shows sample catalog and plan data. It is not connected to an Installer service, does not install software, and keeps install and uninstall actions disabled.

本模块仅为 UI 原型。Client 默认使用 `DemoInstallerProvider`，展示样例目录和计划数据。它没有连接 Installer 服务，不会安装软件，安装和卸载操作均保持禁用。

## Scope / 范围

The prototype contains workload and component selection, plan review, lifecycle status cards, and bilingual copy. Its local TypeScript types and sample data support UI development only; they do not define an approved backend API or acceptance contract.

原型包含工作负载与组件选择、计划预览、生命周期状态卡片和双语文案。本地 TypeScript 类型和样例数据仅用于 UI 开发，不构成已批准的后端 API 或验收契约。

`ControlWorkloadInstallerProvider` is an experimental, unused adapter outline. The Client does not instantiate it. Its `/studio-workloads/v1/*` paths are not an implemented or approved service contract; do not wire these calls or describe them as operational. A future integration requires an independently approved backend contract and owner before implementation.

`ControlWorkloadInstallerProvider` 是未接入 Client 的实验性适配器草案。Client 不会实例化它。其 `/studio-workloads/v1/*` 路径不是已实现或批准的服务契约；不得接入这些调用或将其描述为可运行功能。未来集成必须先由后端负责人独立批准服务契约。

## Safety boundary / 安全边界

- `DemoInstallerProvider` returns sample data, reports no active connection, exposes no allowed component operations, and rejects execution.
- The optional adapter rejects session payloads without a non-empty token, actor identity, and explicitly shaped scopes. Failed refresh and authorization responses clear cached identity.
- The visible prototype notice remains on every Installer view while the provider is demo or disconnected.
- This prototype is source/UI evidence only. It is not evidence of a working installer, package runtime, backend route, or host installation.

- `DemoInstallerProvider` 返回样例数据、报告未连接状态、不提供任何组件操作权限，并拒绝执行操作。
- 可选适配器会拒绝缺少非空令牌、操作者身份或有效权限列表的会话响应；刷新失败及授权失败响应会清除缓存身份。
- Provider 为演示或未连接状态时，所有 Installer 页面都会显示原型提示。
- 本原型仅证明源码与 UI 存在，不能证明安装器、软件包运行时、后端路由或主机安装可用。

## Verification / 验证

- Unit tests: `npx vitest run apps/web/services/installer/src`
- Browser tests: `npx playwright test tests/e2e/installer.spec.ts`
- TypeScript and production build: `npm run build`

- 单元测试：`npx vitest run apps/web/services/installer/src`
- 浏览器测试：`npx playwright test tests/e2e/installer.spec.ts`
- TypeScript 与生产构建：`npm run build`
