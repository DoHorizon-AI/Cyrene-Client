# Shared Client Packages / 客户端共享 Package

Packages at this level are shared across platform roots. Put platform-neutral models, API contracts, compatibility rules, and client workflows here; keep React components and platform integration under `apps/web/`, `apps/win/`, `apps/mac/`, or `apps/cli/`.

此层 package 由多个平台根目录共享。平台无关的数据模型、API 契约、兼容规则和客户端工作流放在这里；React 组件和平台集成分别放在 `apps/web/`、`apps/win/`、`apps/mac/` 或 `apps/cli/`。

Current packages cover pipeline control/modeling, server control, and service settings. The planned `cyrene-client-core` native shared library has not been created yet.

当前 package 覆盖 pipeline control/model、server control 和 service settings。计划中的原生共享库 `cyrene-client-core` 尚未创建。
