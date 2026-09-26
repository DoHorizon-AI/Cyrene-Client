# Client Applications / 客户端应用

`web/` is the primary browser client. `win/` and `cli/` are secondary surfaces. `mac/` is deferred. Each platform owns its native UI, downloader, and packaging scripts; reusable client logic stays in the repository-level `packages/` directory.

`web/` 是浏览器主客户端；`win/` 和 `cli/` 为次优先级；`mac/` 延后建设。各平台负责自己的原生界面、下载器和打包脚本；可复用的客户端逻辑放在仓库根目录的 `packages/`。

See [`../docs/ui-module-layout.md`](../docs/ui-module-layout.md) for the six-service module map and current implementation status.
