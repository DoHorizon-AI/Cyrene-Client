# macOS Client / macOS 客户端

This platform is deferred. No macOS client or service module is being implemented in the current phase. Reserved service-module roots exist under `services/`. When work begins, shared platform logic should remain in `packages/`, native UI should use SwiftUI under this root, and service modules should follow `services/<service>/`.

此平台暂缓建设，当前阶段不实现 macOS 客户端或服务模块。`services/` 下已建好各服务模块预留目录。开始开发后，平台共享逻辑仍放在 `packages/`，原生 UI 使用 SwiftUI 并放在此根目录下，各服务模块沿用 `services/<service>/` 结构。
