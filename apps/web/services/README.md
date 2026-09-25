# Web Service Modules / Web 服务模块

Each service UI belongs in its own directory: `catalyst/`, `yield/`, `echo/`, `reactor/`, `exchange/`, or `navigator/`. Modules should build independently and consume the shared web shell/components at `apps/web/` plus platform-neutral packages at the repository root.

各服务 UI 分别放在 `catalyst/`、`yield/`、`echo/`、`reactor/`、`exchange/` 或 `navigator/`。模块应可独立构建，并复用 `apps/web/` 中的 Web 外壳/组件及仓库根目录的平台无关 package。

| Module | State |
| --- | --- |
| Catalyst | Integrated in the current workbench; no standalone bundle. |
| Yield | Integrated in the current workbench; no standalone bundle. |
| Echo | Integrated in the current workbench; no standalone bundle. |
| Reactor | Integrated in the current workbench; no standalone bundle. |
| Exchange | No standalone package yet. |
| Navigator | Standalone React + Vite package. |
