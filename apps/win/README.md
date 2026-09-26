# Windows Client / Windows 客户端

This is the secondary Windows-native platform root. Shared Windows installer and module-download logic belongs here; service-specific native UIs will live under `services/<service>/` as they are implemented.

这里是次优先级 Windows 原生平台根目录。Windows 共用安装器和模块下载逻辑放在此处；各服务原生界面实现后放在 `services/<service>/`。

Current contents:

- `crates/cyrene-installer/`: Rust installer workspace.
- `installer/`: MSIX manifest, assets, and `package-msix.ps1`.
- `services/`: Reserved roots for the six Windows-native service UI modules; no native UI package exists yet. / 六个 Windows 原生服务 UI 模块的预留目录；尚无原生 UI 包。

The existing packaging path builds the installer crate and an MSIX. There is no WinUI application or service-module downloader yet. `npm run check:win:installer` and `npm run build:win:installer` provide local Rust checks/builds; the release MSIX package is built by the Windows workflow.

当前打包流程构建安装器 crate 和 MSIX。尚无 WinUI 应用或服务模块下载器。`npm run check:win:installer` 和 `npm run build:win:installer` 用于本地 Rust 检查/构建；release MSIX 由 Windows workflow 构建。
