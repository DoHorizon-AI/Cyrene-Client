# Workspace Web release / Workspace Web 发布

The Workspace Client is published as an immutable static component so an Ubuntu
Workspace host can install the official web root without cloning or building
Client source. Release tags are derived from the exact integration source SHA:
`{preview|stable}-cyrene-client-workspace-web-{sha}`. `develop` publishes the
preview channel; `main` and `release` publish stable.

`.github/workflows/workspace-web-release.yml` runs on an integration-branch
push and waits for a successful `Client CI` push run for the same full SHA
before generating or publishing assets. The workflow rebuilds the standalone
`dist-workspace-web` target, validates its root-relative `index.html` and
assets, checks out the schemas and Catalog v2 from one exact merged Workspace
authority SHA, and validates the standard Component Release Manifest v2 and
Component Release Index v1. It then
creates GitHub SLSA provenance for the tar archive, manifest, and index,
downloads and verifies each detached attestation, publishes the six immutable
assets, and reads them back from the release.

The tar archive contains only regular static web-root files, with `index.html`
at archive root. The manifest binds the source repository/ref/SHA, archive
SHA-256, size, exact path-to-file digest map, bounded entry count and expanded
size, and the root entrypoint. Its pinned protocol is `cyrene.static-web.v1`;
the catalog also binds component `cyrene-client-workspace-web`, publisher
`official-client-workspace-web`, target `linux-ubuntu-24.04-x86_64-web`, and
`refresh` activation. The version includes the package version and full source
SHA. The Workspace host owns installation roots, immutable versioned placement,
refresh activation, and serving; the Client artifact does not define another
install directory or mutable activation state.

## Local workload Control / 本机工作负载 Control

The local Control service exposes the resolver protocol as
`/studio-workloads/v1/commands`. Its helper can execute only
`/usr/bin/cyrene workload --json` on Ubuntu 24.04 x86_64, using one validated
JSON request and one bounded JSON response over standard input/output. Request
and result shapes are defined in `packages/workload-plan/contracts.ts` under
`cyrene.workload-plan.v1`.

`workloads.status` and `workloads.check` require `workloads.read`; `status` is
read-only. `workloads.stage` and `workloads.apply` require
`workloads.install`. Apply requires a confirmation carrying the exact staged
`planId` and `planDigest`. Selection, resolution, catalog release identity,
attestation reference, and catalog-authored bindings remain in the
digest-bound resolver result. The group is registered only by loopback local
Control; team Control/BFF does not register or forward installer operations.

`workloads.check` accepts `action: "install" | "uninstall"` and defaults to
`install`; stage and apply repeat the selected action and exact plan digest.
Uninstall uses the same resolver plan and confirmation path and requires one
included direct component with no exclusions or choice overrides. Workspace
resolves its installed identity and ownership and blocks removal when installed
dependents remain.

The workload-plan consumer preserves resolver `resolution` and selected rows,
checks `planDigest` against canonical digest material, and validates the
operation-specific stage/apply receipts. Installation and refresh activation
remain host-owned; the Client does not grant root access to remote BFF requests
or store install state. Workspace stage/apply remains fail-closed while its
updater integration is unavailable.

<!-- Chinese Translation / 中文翻译 -->

# Workspace Web 不可变发布

Workspace Client 以不可变静态组件发布，使 Ubuntu Workspace 主机可以安装官方 Web 根目录，
无需克隆或构建 Client 源码。Release tag 由集成分支的完整源 SHA 生成：
`{preview|stable}-cyrene-client-workspace-web-{sha}`。`develop` 发布 preview，`main` 和
`release` 发布 stable。

`.github/workflows/workspace-web-release.yml` 在集成分支更新后运行，并等待同一个完整 SHA 的
`Client CI` push run 成功后才生成或发布资产。Workflow 会重建独立的 `dist-workspace-web`，校验根目录
`index.html` 与资源，从一个固定 SHA 的 Workspace authority checkout schemas 和 Catalog v2，并验证
标准 Component Release Manifest v2 与 Component Release Index v1。随后它为 tar archive、manifest 和
index 创建 GitHub SLSA provenance，下载并验证每份 detached attestation，发布六个不可变资产，并从
release 重新读取验证。

Tar archive 仅包含普通静态 Web 根文件，`index.html` 位于 archive 根目录。Manifest 绑定源仓库、ref 和
SHA、archive SHA-256 与大小、精确的文件路径到 digest 映射、有界条目数与解压大小，以及根入口文件。
协议固定为 `cyrene.static-web.v1`；Catalog 也绑定 component
`cyrene-client-workspace-web`、publisher `official-client-workspace-web`、target
`linux-ubuntu-24.04-x86_64-web` 和 `refresh` activation。版本同时包含 package 版本和完整源 SHA。
Workspace 主机负责安装根目录、不可变版本路径、refresh activation 与资源服务；Client artifact 不定义
另一个安装目录或可变 activation 状态。

## 本机 workload Control

本机 Control 通过 `/studio-workloads/v1/commands` 暴露 resolver 协议。Helper 仅能在 Ubuntu 24.04
x86_64 上调用 `/usr/bin/cyrene workload --json`，并通过标准输入和输出传递单个经校验的 JSON 请求与
有界 JSON 回复。Request 与 result schema 位于
`packages/workload-plan/contracts.ts`，协议名为 `cyrene.workload-plan.v1`。

`workloads.status` 和 `workloads.check` 需要 `workloads.read`；`status` 为只读操作。
`workloads.stage` 和 `workloads.apply` 需要 `workloads.install`。Apply 要求显式确认与已 stage 的
`planId` 和 `planDigest` 完全一致。选择项、解析结果、Catalog release identity、attestation 引用和
Catalog 定义的 binding 都保留在摘要绑定的 resolver result 中。此命令组只注册到 loopback 本机
Control；team Control/BFF 不注册也不转发 installer operation。

`workloads.check` 接受 `action: "install" | "uninstall"`，缺省为 `install`；stage 和 apply 必须重复
所选 action 与精确 plan digest。Uninstall 走相同 resolver plan 和确认流程，要求恰好一个直接纳入的
component，且没有 exclude 或 choice override。Workspace 会解析已安装身份与 owner；若仍有已安装依赖者，
会阻止卸载。

Workload-plan consumer 保留 resolver `resolution` 和 selected rows，按规范化摘要材料重新校验
`planDigest`，并验证 stage/apply 各自的结果行。安装与 refresh activation 仍由 host 负责；Client 不会向
remote BFF 请求授予 root 权限，也不保存安装状态。Workspace updater 集成尚不可用时，stage/apply 会失败关闭。
