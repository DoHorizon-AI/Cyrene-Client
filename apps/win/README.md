# Windows Client / Windows 客户端

This is the secondary Windows-native platform root. Shared Windows installer and module-download logic belongs here; service-specific native UIs will live under `services/<service>/` as they are implemented.

这里是次优先级 Windows 原生平台根目录。Windows 共用安装器和模块下载逻辑放在此处；各服务原生界面实现后放在 `services/<service>/`。

Current contents:

- `crates/cyrene-installer/`: Rust installer workspace.
- `installer/`: MSIX manifest, assets, and `package-msix.ps1`.
- `services/`: Reserved roots for the six Windows-native service UI modules; no native UI package exists yet. / 六个 Windows 原生服务 UI 模块的预留目录；尚无原生 UI 包。

The existing packaging path builds the installer crate and an MSIX. There is no WinUI application or service-module downloader yet. `npm run check:win:installer` and `npm run build:win:installer` provide local Rust checks/builds; the release MSIX package is built by the Windows workflow.

当前打包流程构建安装器 crate 和 MSIX。尚无 WinUI 应用或服务模块下载器。`npm run check:win:installer` 和 `npm run build:win:installer` 用于本地 Rust 检查/构建；release MSIX 由 Windows workflow 构建。

## Windows Product Component Updates / Windows Product 组件更新

The Updates panel uses the local Control `updates.status`, `updates.check`, `updates.stage`, and `updates.apply` command group. The Windows Control helper launches only the installed `installer.exe --updates-stdio` with one bounded JSON request; requests cannot select an executable, shell command, or file path. Workspace BFF members do not receive this local updater capability. The panel refreshes status, checks for releases every five minutes, stages verified images automatically, and shows a reminder until a user explicitly applies a staged plan.

更新面板通过本机 Control 的 `updates.status`、`updates.check`、`updates.stage` 和 `updates.apply` 命令组操作。Windows Control helper 只会使用固定参数启动已安装的 `installer.exe --updates-stdio`，并发送有大小限制的单条 JSON 请求；请求不能指定可执行文件、shell 命令或文件路径。Workspace BFF 成员不会获得本机更新能力。面板会刷新状态、每五分钟检查发布、自动暂存已验证镜像，并在用户明确应用暂存计划前显示提醒。

The protocol is `cyrene.component-updates.helper.v1`. These are the request shapes; use the `planId` and `planDigest` returned by `check` for later operations:

```json
{"protocolVersion":"cyrene.component-updates.helper.v1","operation":"status"}
{"protocolVersion":"cyrene.component-updates.helper.v1","operation":"check","channel":"stable"}
{"protocolVersion":"cyrene.component-updates.helper.v1","operation":"stage","channel":"stable","planId":"plan-<returned-id>","planDigest":"sha256:<returned-digest>"}
{"protocolVersion":"cyrene.component-updates.helper.v1","operation":"apply","channel":"stable","planId":"plan-<returned-id>","planDigest":"sha256:<returned-digest>","confirmation":{"planId":"plan-<returned-id>","planDigest":"sha256:<returned-digest>","confirmed":true}}
```

The installer reads its embedded, SHA-pinned Workspace component catalog and discovers immutable release indexes through the publisher entries in that catalog. It verifies index and manifest digests, allowed workflow/source identity, GitHub artifact attestations, the exact OCI repository and digest, and installed runtime dependencies. `stage` downloads the digest-pinned image without changing Compose. Windows supports only the five existing Product containers: `cyrene-catalyst`, `cyrene-echo`, `cyrene-exchange`, `cyrene-reactor`, and `cyrene-yield`; native Windows targets are reported as unsupported. A missing index or broker release is an explicit unavailable/error state; the installer never substitutes a mutable `latest` image.

安装器读取内嵌且固定 SHA 的 Workspace component catalog，并按 catalog 中的 publisher 条目发现不可变 release index。它会验证 index/manifest 摘要、允许的 workflow/source identity、GitHub artifact attestation、精确 OCI 仓库与摘要，以及已安装运行时依赖。`stage` 只下载 digest 固定的镜像，不修改 Compose。Windows 只支持已有的五个 Product 容器：`cyrene-catalyst`、`cyrene-echo`、`cyrene-exchange`、`cyrene-reactor` 和 `cyrene-yield`；原生 Windows 更新目标明确显示为 unsupported。缺少 index 或 broker release 时会明确报告不可用/错误，绝不会回退到可变 `latest` 镜像。

Applying requires a local Windows Administrator token and an explicit confirmation bound to the exact `planId` and `planDigest`. The backend re-reads the complete activity-source catalog and atomically checks readiness immediately before it creates the maintenance fence. Busy, unknown, stale, or incomplete source status blocks the apply; the updater does not cancel, drain, or wait for tasks. A successful apply recreates only the selected Product container. If startup or health validation fails, the durable update journal restores that service's previous immutable `RepoDigest`; other Product containers and data mounts remain untouched. Independent Exchange ACA artifact production is outside this Windows container update path and remains unchanged.

应用更新需要本机 Windows Administrator 身份，并须对精确的 `planId` 与 `planDigest` 明确确认。后端会在建立维护围栏前重新读取完整活动源 catalog，并原子重检 readiness。忙碌、未知、过期或活动源不完整都会阻止应用；更新器不会取消、排空或等待任务。应用成功时只重建所选 Product 容器。若启动或健康检查失败，持久更新 journal 会将该服务恢复到此前不可变的 `RepoDigest`；其他 Product 容器和数据挂载保持原样。Exchange 独立的 ACA artifact 生产不属于此 Windows 容器更新路径，保持不变。

## Maintenance Broker Bootstrap and First Migration / 维护 broker 初始化与首次迁移

`--initialize-runtime-maintenance` requires the local installer to run with Windows Administrator authority. It verifies the broker's catalog-pinned immutable release, starts only the broker if it is missing, waits for broker health, provisions the exact five Product activity sources, validates the returned catalog generation, and starts only missing Product containers. The operator token and private broker state remain in the broker-only volume; each Product receives only its own read-only source token and the shared read-only socket. This command does not restart existing Product containers or treat a running container as proof of idleness.

`--initialize-runtime-maintenance` 要求本机安装器具有 Windows Administrator 权限。它会验证 catalog 固定的不可变 broker release；broker 尚未启动时只启动 broker，等待 broker health，然后配置精确的五个 Product 活动源、校验返回的 catalog generation，并且只启动缺失的 Product 容器。operator token 和 broker 私有状态保留在仅 broker 可访问的 volume 中；每个 Product 只获得自己的只读 source token 和共享只读 socket。此命令不会重启已有 Product 容器，也不会把容器正在运行当作空闲证明。

Legacy Product images that lack the runtime activity SDK cannot provide a fresh heartbeat. Their readiness remains `UNKNOWN`, so apply stays disabled and the backend rejects it even for a local Administrator. There is no bootstrap bypass. For a first migration, use a controlled maintenance window: stop new task admission through each Product's authoritative control surface, verify its durable task records have reached terminal states, provision the broker sources, then redeploy the catalog-pinned SDK-enabled Product images and wait for all five sources to report fresh readiness. The updater cannot prove that an old, non-reporting image has no unfinished work; it neither cancels nor drains that work.

缺少 runtime activity SDK 的旧 Product 镜像不能提供新鲜 heartbeat，其 readiness 会保持 `UNKNOWN`；因此 Apply 按钮禁用，即使本机管理员也会被后端拒绝。没有 bootstrap bypass。首次迁移应安排受控维护窗口：通过各 Product 权威控制面停止接收新任务，核实持久任务记录均已进入终态，再配置 broker 活动源，随后重新部署 catalog 固定且启用 SDK 的 Product 镜像，并等待五个活动源都报告新鲜 readiness。更新器无法证明不再报告状态的旧镜像没有未结束任务；它不会取消或排空任务。

If no attested immutable broker release is available, Compose generation/bootstrap fails closed and does not install a placeholder broker. `--initialize-runtime-maintenance` must be run against the same local installation and pinned Compose configuration used by Control. Remote Workspace access cannot grant local Administrator authority.

如果当前没有经过 attestation 验证的不可变 broker release，Compose 生成/初始化会 fail closed，不安装占位 broker。`--initialize-runtime-maintenance` 必须针对 Control 使用的同一套本机安装目录和 digest 固定的 Compose 配置运行。远程 Workspace 访问不能授予本机 Administrator 权限。

## Legacy Manifest Compatibility / 旧版清单兼容接口

The standalone `--update-service <name> --manifest <path>` interface remains for compatibility with a valid, locally available `service-update-manifest.json`. For example, `installer.exe --update-service catalyst --manifest .\service-update-manifest.json` prompts for the complete plan digest. It is separate from the catalog/index-based updater above; new Windows updates do not download `service-update-manifest-cyrene-<serviceId>` artifacts, and the catalog updater never invokes this interface as a fallback. The compatibility interface still verifies the manifest, image digest, platform, and release attestation, then uses the same local activity gate before replacing one service and restores its prior immutable `RepoDigest` on health failure.

独立命令 `--update-service <name> --manifest <path>` 仍保留，用于兼容本机已有且有效的 `service-update-manifest.json`。例如，`installer.exe --update-service catalyst --manifest .\service-update-manifest.json` 会要求输入完整 plan digest。它与上面的 catalog/index 更新器相互独立；新 Windows 更新不会下载 `service-update-manifest-cyrene-<serviceId>` artifact，catalog 更新器也不会在失败时自动调用此接口作为回退。兼容接口仍会验证 manifest、镜像摘要、平台和 release attestation，并通过同一本机活动门禁后再替换单个服务；健康检查失败时会恢复原不可变 `RepoDigest`。

| Legacy service ID | Manifest image repository |
| --- | --- |
| `exchange` | `ghcr.io/dohorizon-ai/cyrene-exchange` |
| `reactor` | `ghcr.io/dohorizon-ai/cyrene-reactor` |
| `yield` | `ghcr.io/dohorizon-ai/cyrene-yield` |
| `catalyst` | `ghcr.io/dohorizon-ai/cyrene-catalyst` |
| `echo` | `ghcr.io/dohorizon-ai/cyrene-echo` |

| 旧服务 ID | Manifest 镜像仓库 |
| --- | --- |
| `exchange` | `ghcr.io/dohorizon-ai/cyrene-exchange` |
| `reactor` | `ghcr.io/dohorizon-ai/cyrene-reactor` |
| `yield` | `ghcr.io/dohorizon-ai/cyrene-yield` |
| `catalyst` | `ghcr.io/dohorizon-ai/cyrene-catalyst` |
| `echo` | `ghcr.io/dohorizon-ai/cyrene-echo` |

Navigator currently has only local Agent configuration and no supported Windows-native component update. The legacy `--update-service navigator` command reports that no update is available; use `--deploy-tools navigator` only to write its configuration.

Navigator 目前只有本地 Agent 配置，没有受支持的 Windows 原生组件更新。旧版 `--update-service navigator` 命令会报告没有可用更新；仅需写入其配置时使用 `--deploy-tools navigator`。
