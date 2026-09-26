# macOS Service Modules / macOS 服务模块

Reserved roots for macOS-native service UI modules: `catalyst/`, `yield/`, `echo/`, `reactor/`, `exchange/`, `navigator/`. The macOS platform is deferred; these directories only record module ownership. When work begins, modules should build independently, use SwiftUI, and consume platform-neutral contracts from `packages/`.

macOS 原生服务 UI 模块预留目录：`catalyst/`、`yield/`、`echo/`、`reactor/`、`exchange/`、`navigator/`。macOS 平台暂缓建设，这些目录仅记录模块归属。开始开发后，各模块应可独立构建，使用 SwiftUI，并通过 `packages/` 使用平台无关契约。

| Module | State |
| --- | --- |
| All six | Reserved; platform deferred, no implementation. / 全部为预留；平台延后，尚无实现。 |
