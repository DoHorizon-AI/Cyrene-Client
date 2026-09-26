# Windows Service Modules / Windows 服务模块

Reserved roots for Windows-native service UI modules: `catalyst/`, `yield/`, `echo/`, `reactor/`, `exchange/`, `navigator/`. Each module should build independently, reuse shared Windows platform logic at this root, and consume platform-neutral contracts from the repository-level `packages/`. The installer downloads and merges selected modules; a merged module takes effect after restart.

Windows 原生服务 UI 模块预留目录：`catalyst/`、`yield/`、`echo/`、`reactor/`、`exchange/`、`navigator/`。各模块应可独立构建，复用本层的 Windows 平台共享逻辑，并通过仓库根目录 `packages/` 使用平台无关契约。安装器下载并合并所选模块；合并后重启生效。

| Module | State |
| --- | --- |
| All six | Reserved; no native UI package exists yet. / 全部为预留，尚无原生 UI 包。 |
