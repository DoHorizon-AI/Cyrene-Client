# Command-Line Client / 命令行客户端

The CLI is a secondary surface and has no client implementation yet. Future commands should be grouped by service under `services/<service>/` (reserved roots already exist) and reuse repository-level contracts and client logic from `packages/`. Platform-specific install/update scripts belong at this `cli/` level.

CLI 是次优先级界面，目前尚无客户端实现。后续命令按服务放在 `services/<service>/` 下（预留目录已建好），并复用仓库根目录 `packages/` 中的契约和客户端逻辑。CLI 专属安装/更新脚本放在此层。
