---
title: Client Architecture Decision
status: accepted
last_updated: 2026-09-25
---

# Client Architecture Decision / 客户端架构决策

## 1. Background and decision summary / 背景与决策摘要

Cyrene-Studio began as a Pipeline IDE prototype and is the target home for Cyrene's unified client surfaces. Cyrene's workflow spans six services in sequence: Catalyst (datasets) → Yield (training) → Echo (evaluation) → Reactor (deployment) → Exchange (API gateway) → Navigator (agent conversations and sessions). Separate clients would make users re-establish context at each handoff and would create six installers, session implementations, and update channels. That operating cost is not acceptable for one connected workflow.

Cyrene-Studio 最初是 Pipeline IDE 原型，现确定为 Cyrene 统一客户端界面的主仓库。Cyrene 工作流依次经过六个服务：Catalyst（数据集）→ Yield（训练）→ Echo（评测）→ Reactor（部署）→ Exchange（API 网关）→ Navigator（Agent 对话与会话）。若每个服务各自提供客户端，用户需要在每次交接时重新建立上下文，并维护六套安装器、会话实现和更新通道；这不适合一条连续工作流。

The accepted direction consolidates user-facing service modules in Studio while keeping product and capability ownership in their existing repositories. A user should be able to move from a dataset through training and evaluation to deployment and an agent conversation without manually carrying identifiers between applications.

已接受的方向是在 Studio 中整合面向用户的服务界面，同时保留各 Product 与能力在原仓库中的所有权。用户应能从数据集一路进入训练、评测、部署和 Agent 对话，不必在多个应用之间手动传递标识符。

**Decision status and implementation snapshot.** `status: accepted` records the target architecture decision; it does not certify that every migration or client is shipped. At the start of this review, the tracked `origin/develop` snapshot contained `apps/web/` and `apps/mcp/`, but not `apps/navigator/`, `apps/native-win/`, or `cyrene-client-core`. During this review, local `develop` advanced with a Studio migration commit that adds the Navigator console and MSIX packaging; at this check, that commit is present locally and has not yet been read back from `origin/develop`. The current workspace copy of `Cyrene-Plugins-Official/plugins/ui/navigator/` still contains UI source, tests, package metadata, and build output despite its migration banner. The client-core library and WinUI 3 C# / XAML application are also not present in the local Studio tree. This document records the accepted target and current evidence; it does not claim the ownership transfer or native client is complete.

**决策状态与实现快照。** `status: accepted` 表示目标架构决策已接受，不表示所有迁移和客户端均已交付。本次检查开始时，已跟踪的 `origin/develop` 快照中有 `apps/web/` 和 `apps/mcp/`，但没有 `apps/navigator/`、`apps/native-win/` 或 `cyrene-client-core`。检查期间，本地 `develop` 前进了一个 Studio 迁移提交，加入了 Navigator 控制台和 MSIX 打包；当前该提交已存在于本地，尚未从 `origin/develop` 读回。当前工作区中的 `Cyrene-Plugins-Official/plugins/ui/navigator/` 虽有迁移说明，仍保留 UI 源码、测试、包元数据和构建产物。`cyrene-client-core` 与 WinUI 3 C# / XAML 应用也尚未出现在本地 Studio 树中。本文记录已接受的目标和当前证据，不宣称所有权迁移或原生客户端已完成。

## 2. Repository responsibilities / 仓库分工

### Cyrene-Studio — unified client repository / 统一客户端主仓库

| Path | Responsibility and status / 职责与状态 |
| --- | --- |
| `apps/web/` | React + Vite Pipeline IDE prototype and the planned full-featured web reference client. The current prototype is not yet the complete six-service client. / React + Vite Pipeline IDE 原型及计划中的完整 Web 参考客户端。当前原型尚未覆盖完整的六服务客户端功能。 |
| `apps/navigator/` | Target home for the Navigator operations console: Overview, Models, Datasets, Training, Runs, Deployments, Gateway, Chat, and Settings. A candidate implementation is present in local `develop`; canonical remote read-back and source ownership cleanup remain pending. / Navigator 运维控制台的目标位置，包含 Overview、Models、Datasets、Training、Runs、Deployments、Gateway、Chat 和 Settings。本地 `develop` 已有候选实现；远端权威分支读回和来源所有权清理仍待完成。 |
| `apps/native-win/` | Target home for the WinUI 3 desktop client, whose UI uses C# and XAML, and its MSIX installer. The local tree currently contains the installer crate and packaging assets, but not the WinUI application. / WinUI 3 桌面客户端及其 MSIX 安装器的目标位置；客户端 UI 使用 C# 和 XAML。本地树目前包含安装器 crate 和打包资源，但尚无 WinUI 应用。 |
| `apps/mcp/` | Local MCP stdio entry. The current entry exposes pipeline-editing tools; broader service and client capabilities remain future work. / 本机 MCP stdio 入口。当前入口提供流水线编辑工具；更广泛的服务和客户端能力仍属后续工作。 |
| `packages/` | Shared UI components and client-side modules used by Studio applications. Platform-neutral business logic intended for native clients belongs in `cyrene-client-core`, not in UI components. / Studio 应用共享的 UI 组件与客户端模块。原生客户端要复用的平台无关业务逻辑应放入 `cyrene-client-core`，而非 UI 组件。 |

### Cyrene-Navigator — harness and session authority / Harness 与会话权威

Cyrene-Navigator remains responsible for its `harness/` DeepSeek Harness adapter, `native/crates/cyrene-native-host/` Rust process host, and `src/` Python Web Host and session persistence. Its UI remains small and focused on harness configuration and agent-run logs. Studio may present broader service operations, but it does not take ownership of Navigator's harness execution or durable session state.

Cyrene-Navigator 继续负责 `harness/` 中的 DeepSeek Harness 适配层、`native/crates/cyrene-native-host/` Rust 进程宿主，以及 `src/` 中的 Python Web Host 和 session 持久化。该仓库的 UI 保持小而聚焦，只服务于 harness 配置和 Agent run 日志。Studio 可以提供更广泛的服务运维界面，但不接管 Navigator 的 harness 执行或持久会话状态。

### Cyrene-Plugins-Official — capabilities and provenance / 能力与来源记录

Cyrene-Plugins-Official owns capability contracts, SDKs, runtimes, and connector plugins. The intended destination for the Navigator operations UI is `Cyrene-Studio/apps/navigator/`; after a verified migration, the Plugins path should serve only as a provenance record rather than a competing development home. The current workspace snapshot still contains implementation files at `plugins/ui/navigator/`, so completing and verifying that ownership transfer is an explicit next step.

Cyrene-Plugins-Official 负责能力契约、SDK、运行时和 connector 插件。Navigator 运维 UI 的目标位置是 `Cyrene-Studio/apps/navigator/`；完成并核验迁移后，Plugins 中的旧路径应仅保留来源记录，不再成为并行开发位置。当前工作区快照仍在 `plugins/ui/navigator/` 保留实现文件，因此完成并核验所有权迁移是明确的后续事项。

## 3. Unified client principles / 统一客户端设计原则

1. **Single install / 单一安装.** Users install one client whose selected service modules cover the six-service workflow. A service selection also selects its corresponding UI bundle. / 用户安装一个客户端，通过选择服务模块覆盖六服务工作流；选择服务时同时选择对应的 UI bundle。
2. **Unified session / 统一 session.** The client surfaces use the Navigator Web Host session rather than creating six independent sign-in and refresh flows. Cookie scope, CSRF handling, and trusted forwarding remain part of the host integration contract. / 各客户端界面复用 Navigator Web Host session，不另建六套登录和续期流程。Cookie 作用域、CSRF 处理和可信转发仍须纳入 Host 集成契约。
3. **Closed workflow handoffs / 工作流闭环.** Cross-service actions, such as sending a training result to Echo for evaluation, are explicit in-client handoffs over typed resource references. The client carries context so users do not copy IDs between applications. / 跨服务操作（例如将训练结果发送到 Echo 评测）应是客户端内显式的一键交接，并通过类型化资源引用传递；客户端负责承接上下文，避免用户在多个应用间复制 ID。
4. **Native multi-window support / 原生多窗口.** Use each operating system's window management so users can work in parallel, such as editing a Pipeline in one window while monitoring a training Run in another. / 使用操作系统原生窗口管理支持并行操作，例如一个窗口编辑 Pipeline，另一个窗口监控训练 Run。
5. **Thin UI / UI 层保持轻薄.** UI layers render and collect input. Shared client logic owns API orchestration, state transitions, compatibility rules, and handoff behavior; presentation code should not independently decide product workflows. / UI 层负责渲染和收集输入。API 编排、状态转换、兼容规则和交接行为由共享客户端逻辑负责；界面代码不应自行裁定 Product 工作流。

## 4. Native client strategy — WinUI first / 原生客户端策略——优先 WinUI

Electron is not selected for the Windows native client. Reaching the scrolling acceleration and rendering experience expected for Cyrene's own daily use would require substantial Windows-specific optimization; the estimated engineering cost is not acceptable. Cyrene will dogfood the client, so the quality bar is “good to use,” not merely “works.”

Windows 原生客户端不选 Electron。要达到 Cyrene 团队日常使用所要求的滚动加速和渲染体验，需要投入大量 Windows 专项优化，预估工程成本不可接受。Cyrene 会将该客户端用于自身工作，因此体验标准是“真正好用”，而非仅仅“能够运行”。

| Platform | Decision / 决策 |
| --- | --- |
| Windows | WinUI 3 on Windows App SDK, implemented with C# and XAML. / 基于 Windows App SDK 的 WinUI 3，使用 C# 和 XAML 实现。 |
| macOS | SwiftUI after the Windows client is stable. / Windows 客户端稳定后再实现 SwiftUI。 |

Each platform implements its own UI and native integration while sharing business logic through `cyrene-client-core`.

各平台分别实现 UI 和原生系统集成，并通过 `cyrene-client-core` 共享业务逻辑。

**Delivery phases / 实施阶段**

1. **Phase 1 — Web reference / 阶段一——Web 参考实现:** Expand the React + Vite web client to cover the complete workflow and use it as the functional reference. This is the target for the current phase; the existing Pipeline IDE prototype does not yet provide that full coverage. / 扩展 React + Vite Web 客户端以覆盖完整工作流，并作为功能参考实现。这是当前阶段的目标；现有 Pipeline IDE 原型尚未达到完整覆盖。
2. **Phase 2 — WinUI 3 / 阶段二——WinUI 3:** Build the Windows native client and reuse `cyrene-client-core`. / 构建 Windows 原生客户端并复用 `cyrene-client-core`。
3. **Phase 3 — SwiftUI / 阶段三——SwiftUI:** Build the macOS client after the Windows client is stable, reusing the same core library. / Windows 客户端稳定后构建 macOS 客户端，并复用同一核心库。

## 5. Shared business library: `cyrene-client-core` / 共享业务逻辑库

`cyrene-client-core` is the planned Rust library for business logic shared by native clients. Its responsibility is to keep API, session, lifecycle, and state behavior consistent while allowing each platform to own its UI and system integration.

`cyrene-client-core` 是计划中的 Rust 共享业务库，为原生客户端承载共用业务逻辑。它负责保持 API、session、生命周期和状态行为一致，同时允许各平台拥有自己的 UI 和系统集成。

**Included in the library / 纳入共享库**

- Typed API clients for Catalyst, Yield, Echo, Reactor, Exchange, and Navigator. Client versions must bind to and stay aligned with the OpenAPI contracts owned by the respective Product repositories. / Catalyst、Yield、Echo、Reactor、Exchange 和 Navigator 的类型化 API client。客户端版本必须绑定并保持与各 Product 仓库所拥有的 OpenAPI 契约一致。
- Session and authentication lifecycle: pairing codes, cookie renewal, and CSRF tokens. / Session 与认证生命周期：配对码、Cookie 续期和 CSRF token。
- Coordination for plugin hot install, update, and uninstall. / 插件热安装、热更新和热卸载的协调逻辑。
- Release-manifest parsing and version-compatibility checks. / Release manifest 解析与版本兼容检查。
- Shared state models, including Run and Deployment state. / 共享状态模型，包括 Run 和 Deployment 状态。
- Background polling and SSE event distribution. / 后台轮询和 SSE 事件分发。

**Kept out of the library / 不纳入共享库**

- UI rendering in XAML, SwiftUI, or React; navigation and window management. / XAML、SwiftUI 或 React 的 UI 渲染，以及导航和窗口管理。
- System tray and menu-bar integration, filesystem paths such as `LOCALAPPDATA` and `~/Library`, scrolling, animation, and platform gestures. / 系统托盘和菜单栏集成、`LOCALAPPDATA` 与 `~/Library` 等文件系统路径、滚动、动画和平台手势。

**FFI and web client / FFI 与 Web client.** The Rust library will build as a Windows `.dll` and macOS `.dylib`, with a C ABI consumed by C# through P/Invoke and by Swift through Swift FFI. `Cyrene-Plugins-Official/runtime/rust/cyrene-plugin-cabi` is a reference for an existing C ABI pattern. The web client will keep an independent TypeScript API-client implementation aligned to the same Product OpenAPI contracts; it is not required to call the Rust library.

**FFI 与 Web client。** Rust 库将分别编译为 Windows `.dll` 和 macOS `.dylib`，通过 C ABI 供 C# 使用 P/Invoke 调用，并供 Swift 通过 Swift FFI 调用。`Cyrene-Plugins-Official/runtime/rust/cyrene-plugin-cabi` 可作为现有 C ABI 模式的参考。Web client 保留独立的 TypeScript API client 实现，并与相同的 Product OpenAPI 契约对齐；不要求 Web client 调用 Rust 库。

## 6. Installer design / 安装器设计

Installing a service capability also installs its matching UI bundle. A release manifest records `service@version ↔ ui-bundle@version`; the installer reads the manifest, resolves the user's selected service combination, and downloads the corresponding UI bundles. This keeps the service and UI versions compatible as services are upgraded.

安装某项服务能力时，同时安装对应的 UI bundle。Release manifest 记录 `service@version ↔ ui-bundle@version` 的对应关系；安装器读取 manifest，根据用户选择的服务组合解析并下载对应 UI bundle，确保服务升级时 UI 版本仍兼容。

| Optional service selection / 可选服务 | Included capability and UI / 随附能力与 UI |
| --- | --- |
| Navigator | Local agent execution environment and harness, plus the Navigator UI module. / 本地 Agent 执行环境与 harness，以及 Navigator UI 模块。 |
| Exchange | API gateway and its client UI module. / API 网关及其客户端 UI 模块。 |
| Reactor | Inference deployment and its client UI module. / 推理部署及其客户端 UI 模块。 |
| Yield | Training and its client UI module. / 训练及其客户端 UI 模块。 |
| Catalyst | Dataset management and its client UI module. / 数据集管理及其客户端 UI 模块。 |
| Echo | Evaluation and its client UI module. / 评测及其客户端 UI 模块。 |

A full installation includes the UI modules for all six services. This manifest-driven installer and bundle distribution model is a target design; it is not implemented in the inspected Studio tree.

完整安装包含六个服务的全部 UI 模块。基于 manifest 的安装器和 bundle 分发模式属于目标设计，在检查时的 Studio 树中尚未实现。

## 7. Relationship between web and desktop clients / Web 与桌面客户端的关系

The web client (`apps/web/` plus the planned `apps/navigator/`) is the full-featured functional reference and is intended to be served through the Navigator Web Host for cross-device access. The desktop client (`apps/native-win/` and a later macOS app) provides native UI, operating-system integration, and the scrolling and rendering experience required for daily desktop use.

Web client（`apps/web/` 加上计划中的 `apps/navigator/`）是功能完整的参考实现，目标是通过 Navigator Web Host 提供跨设备访问。桌面客户端（`apps/native-win/` 及后续 macOS 应用）提供原生 UI、操作系统集成，以及日常桌面使用所需的滚动和渲染体验。

Both clients use the same backend APIs and product-owned workflows. Platform-specific presentation may differ, but business behavior must not fork between web and desktop. Once the native client is stable, the web client may become a lighter access surface for users without a local Navigator environment.

两类客户端使用同一套后端 API 和由 Product 所有的工作流。平台界面可以不同，但 Web 与桌面版不得分叉业务行为。原生客户端稳定后，Web client 可逐步简化为没有本地 Navigator 环境时使用的轻量访问入口。

## 8. Next steps / 下一步

The following items are future work and are not claimed as implemented by this decision record:

以下事项属于未来工作，本文不声称它们已经实现：

1. Complete and verify the ownership transfer of the Navigator console from `Cyrene-Plugins-Official/plugins/ui/navigator/` into `Cyrene-Studio/apps/navigator/`, preserving the required provenance and avoiding two active development homes. / 完成并核验 Navigator 控制台从 `Cyrene-Plugins-Official/plugins/ui/navigator/` 到 `Cyrene-Studio/apps/navigator/` 的所有权迁移，保留必要来源记录并避免两个并行开发位置。
2. Expand `apps/web/` into the complete six-service reference client and implement the planned Navigator operations console. / 将 `apps/web/` 扩展为覆盖六个服务的完整参考客户端，并实现计划中的 Navigator 运维控制台。
3. Specify and implement `cyrene-client-core`, its C ABI, Windows and macOS bindings, and contract-aligned API clients, session handling, state models, polling, and SSE distribution. / 设计并实现 `cyrene-client-core`、C ABI、Windows 与 macOS 绑定，以及契约对齐的 API client、session 处理、状态模型、轮询和 SSE 分发。
4. Implement the WinUI 3 client and establish its stability gate before beginning the SwiftUI client. / 实现 WinUI 3 客户端，并在开始 SwiftUI 客户端前建立其稳定性验收门槛。
5. Define and build the release manifest, version-compatibility checks, service UI bundles, and installer selection flow. / 定义并构建 release manifest、版本兼容检查、服务 UI bundle 和安装器选择流程。
