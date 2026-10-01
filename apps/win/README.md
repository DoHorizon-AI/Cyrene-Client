# Windows Client / Windows 客户端

This is the secondary Windows-native platform root. Shared Windows installer and module-download logic belongs here; service-specific native UIs will live under `services/<service>/` as they are implemented.

这里是次优先级 Windows 原生平台根目录。Windows 共用安装器和模块下载逻辑放在此处；各服务原生界面实现后放在 `services/<service>/`。

Current contents:

- `crates/cyrene-installer/`: Rust installer workspace.
- `installer/`: MSIX manifest, assets, and `package-msix.ps1`.
- `services/`: Reserved roots for the six Windows-native service UI modules; no native UI package exists yet. / 六个 Windows 原生服务 UI 模块的预留目录；尚无原生 UI 包。

The existing packaging path builds the installer crate and an MSIX. There is no WinUI application or service-module downloader yet. `npm run check:win:installer` and `npm run build:win:installer` provide local Rust checks/builds; the release MSIX package is built by the Windows workflow.

当前打包流程构建安装器 crate 和 MSIX。尚无 WinUI 应用或服务模块下载器。`npm run check:win:installer` 和 `npm run build:win:installer` 用于本地 Rust 检查/构建；release MSIX 由 Windows workflow 构建。

## Per-Service Container Updates / 按服务更新容器

The installer updates one already-running Product container from the explicit `service-update-manifest.json` emitted with a Product image publication. Download and extract that workflow artifact, then run:

```powershell
installer.exe --update-service catalyst --manifest .\service-update-manifest.json
```

Supported service IDs are `exchange`, `reactor`, `yield`, `catalyst`, and `echo`. Download the matching `service-update-manifest-cyrene-<serviceId>` workflow artifact and extract its root-level `service-update-manifest.json`. The installer checks the manifest schema, service ID, canonical repository, full source commit SHA, Linux/amd64 platform, and SHA-256 image digest. It pulls the digest-pinned image, recreates only the selected Compose service with dependencies disabled, then waits up to 90 seconds for the image's Docker `HEALTHCHECK`. If startup or health fails, it restores the selected service to its previous immutable `RepoDigest`. The existing service data bind mount and all other containers are left untouched. Updates fail before changing the running service if its prior image has no immutable registry digest to use for rollback.

| Service ID | Canonical image repository |
| --- | --- |
| `exchange` | `ghcr.io/dohorizon-ai/cyrene-exchange` |
| `reactor` | `ghcr.io/dohorizon-ai/cyrene-reactor-aca` |
| `yield` | `ghcr.io/dohorizon-ai/cyrene-yield-aca` |
| `catalyst` | `ghcr.io/dohorizon-ai/cyrene-catalyst` |
| `echo` | `ghcr.io/dohorizon-ai/cyrene-echo` |

Navigator currently has only local agent configuration and no native binary artifact. `--update-service navigator` therefore reports that no binary update is available; use `--deploy-tools navigator` only to write its configuration.

安装器使用 Product 镜像发布工作流生成的 `service-update-manifest.json`，并且只更新一个已运行的 Product 容器。下载并解压对应工作流 artifact 后执行：

```powershell
installer.exe --update-service catalyst --manifest .\service-update-manifest.json
```

支持的服务 ID 为 `exchange`、`reactor`、`yield`、`catalyst` 和 `echo`。下载名称为 `service-update-manifest-cyrene-<serviceId>` 的对应发布工作流 artifact，并解压根目录中的 `service-update-manifest.json`。安装器会校验清单 schema、服务 ID、规范镜像仓库、完整 source commit SHA、Linux/amd64 平台和 SHA-256 镜像摘要。它只拉取 digest 固定的镜像，只重建指定 Compose 服务且不启动其依赖，并等待镜像自带的 Docker `HEALTHCHECK`，最长 90 秒。若启动或健康检查失败，则将该服务恢复到此前的不可变 `RepoDigest`。现有服务数据挂载和其他容器保持原样；如果当前镜像没有可用于回滚的不可变仓库摘要，命令会在修改运行中服务之前失败。

| 服务 ID | 规范镜像仓库 |
| --- | --- |
| `exchange` | `ghcr.io/dohorizon-ai/cyrene-exchange` |
| `reactor` | `ghcr.io/dohorizon-ai/cyrene-reactor-aca` |
| `yield` | `ghcr.io/dohorizon-ai/cyrene-yield-aca` |
| `catalyst` | `ghcr.io/dohorizon-ai/cyrene-catalyst` |
| `echo` | `ghcr.io/dohorizon-ai/cyrene-echo` |

Navigator 目前只有本地 Agent 配置，没有原生二进制制品。`--update-service navigator` 会明确报告当前没有可用的二进制更新；仅需写入其配置时使用 `--deploy-tools navigator`。
