# Web Client / Web 客户端

This is the primary browser client. Shared browser shell, navigation, design tokens, and web-only components belong at this level. The current Pipeline IDE workbench is under `src/`. Independently buildable service UIs belong under `services/<service>/` and should depend on shared packages explicitly.

这里是浏览器主客户端。共享浏览器外壳、导航、设计 token 和仅 Web 使用的组件放在此层。当前 Pipeline IDE 工作台位于 `src/`。可独立构建的服务 UI 放在 `services/<service>/`，并显式依赖共享包。

Only Navigator currently has a standalone package. The other service views remain integrated in the workbench until they are extracted and validated as separate bundles.

目前只有 Navigator 拥有独立 package。其他服务界面仍集成在工作台中，待拆分并验证为独立 bundle 后再迁移。
