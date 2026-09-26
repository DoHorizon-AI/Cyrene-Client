---
title: Client Architecture Decision
status: accepted
last_updated: 2026-09-25
---

# Client Architecture Decision / 客户端架构决策

## 1. Background and decision summary / 背景与决策摘要

Cyrene-Client began as a Pipeline IDE prototype and is the target home for Cyrene's unified client surfaces. Cyrene's workflow spans six services in sequence: Catalyst (datasets) → Yield (training) → Echo (evaluation) → Reactor (deployment) → Exchange (API gateway) → Navigator (agent conversations and sessions). Separate clients would make users re-establish context at each handoff and would create six installers, session implementations, and update channels. That operating cost is not acceptable for one connected workflow.

Cyrene-Client 最初是 Pipeline IDE 原型，现确定为 Cyrene 统一客户端界面的主仓库。Cyrene 工作流依次经过六个服务：Catalyst（数据集）→ Yield（训练）→ Echo（评测）→ Reactor（部署）→ Exchange（API 网关）→ Navigator（Agent 对话与会话）。若每个服务各自提供客户端，用户需要在每次交接时重新建立上下文，并维护六套安装器、会话实现和更新通道；这不适合一条连续工作流。

The accepted direction consolidates user-facing service modules in Client while keeping product and capability ownership in their existing repositories. A user should be able to move from a dataset through training and evaluation to deployment and an agent conversation without manually carrying identifiers between applications.

已接受的方向是在 Client 中整合面向用户的服务界面，同时保留各 Product 与能力在原仓库中的所有权。用户应能从数据集一路进入训练、评测、部署和 Agent 对话，不必在多个应用之间手动传递标识符。

**Decision status and implementation snapshot.** `status: accepted` records the target architecture decision; it does not certify that every client is shipped. Local `develop` contains migration commit `016a503`, which adds the Navigator console and MSIX packaging, followed by this architecture-record commit `c6dcd7d`; both are still ahead of `origin/develop`. Plugins commit `1952b24` removes the Navigator UI implementation from `plugins/ui/navigator/`, leaving its README and provenance record, and regenerates the source manifest. Navigator commit `377773f` marks the legacy installer crate as migrated. The local Client tree still lacks `cyrene-client-core` and the WinUI 3 C# / XAML application. Local root, Navigator UI, and native packaging checks pass; hosted CI has not been run. This document records the accepted target and current evidence without claiming a shipped native client.

**决策状态与实现快照。** `status: accepted` 表示目标架构决策已接受，不表示客户端已经全部交付。本地 `develop` 包含迁移提交 `016a503`（加入 Navigator 控制台和 MSIX 打包），其后是本文档提交 `c6dcd7d`；两个提交都尚未合入 `origin/develop`。Plugins 提交 `1952b24` 已从 `plugins/ui/navigator/` 移除 Navigator UI 实现，仅保留 README 和来源记录，并重新生成 source manifest。Navigator 提交 `377773f` 将旧 installer crate 标记为已迁移。本地 Client 树仍没有 `cyrene-client-core` 和 WinUI 3 C# / XAML 应用。本地根项目、Navigator UI 和原生打包检查均通过；尚未运行 hosted CI。本文记录已接受的目标和当前证据，不宣称原生客户端已交付。

## 2. Repository responsibilities / 仓库分工

### Cyrene-Client — unified client repository / 统一客户端主仓库

| Path | Responsibility and status / 职责与状态 |
| --- | --- |
| `apps/web/` | Primary browser client. The web root owns shared browser UI and the current Pipeline IDE workbench; it is not yet the complete six-service client. / 浏览器端主客户端。Web 根目录承载共享浏览器 UI 和当前 Pipeline IDE 工作台；尚未覆盖完整的六服务客户端。 |
| `apps/web/services/<service>/` | Independent web UI packages for Catalyst, Yield, Echo, Reactor, Exchange, and Navigator. Navigator is currently a standalone React + Vite package; the other service screens remain in the shared workbench and have not yet been split into installable modules. / Catalyst、Yield、Echo、Reactor、Exchange、Navigator 的独立 Web UI 包。Navigator 已是独立 React + Vite 包；其他服务界面仍在共享工作台内，尚未拆成可单独安装的模块。 |
| `apps/win/` | Secondary Windows native client root. It currently contains the Rust installer crate, MSIX assets, and packaging script, but no WinUI application or service-module downloader. / Windows 原生客户端次优先级根目录。目前包含 Rust 安装器 crate、MSIX 资源和打包脚本，但没有 WinUI 应用或服务模块下载器。 |
| `apps/mac/` | Deferred native macOS client root; implementation is outside the current phase. / 延后建设的 macOS 原生客户端根目录；当前阶段不实现。 |
| `apps/cli/` | Secondary command-line client root for future service-oriented commands. / 后续按服务组织命令行客户端的次优先级根目录。 |
| `apps/mcp/` | Local MCP stdio entry. The current entry exposes pipeline-editing tools; broader service and client capabilities remain future work. / 本机 MCP stdio 入口。当前入口提供流水线编辑工具；更广泛的服务和客户端能力仍属后续工作。 |
| `packages/` | Cross-platform Client packages. Keep platform-neutral contracts and logic here; web-only shared UI belongs at the `apps/web/` layer. The planned native business library is `cyrene-client-core`. / 跨平台 Client 包。平台无关契约和逻辑放在此处；仅 Web 共用的 UI 放在 `apps/web/` 层。计划中的原生共享业务库为 `cyrene-client-core`。 |

### Cyrene-Navigator — harness and session authority / Harness 与会话权威

Cyrene-Navigator remains responsible for its `harness/` DeepSeek Harness adapter, `native/crates/cyrene-native-host/` Rust process host, and `src/` Python Web Host and session persistence. Its UI remains small and focused on harness configuration and agent-run logs. Client may present broader service operations, but it does not take ownership of Navigator's harness execution or durable session state.

Cyrene-Navigator 继续负责 `harness/` 中的 DeepSeek Harness 适配层、`native/crates/cyrene-native-host/` Rust 进程宿主，以及 `src/` 中的 Python Web Host 和 session 持久化。该仓库的 UI 保持小而聚焦，只服务于 harness 配置和 Agent run 日志。Client 可以提供更广泛的服务运维界面，但不接管 Navigator 的 harness 执行或持久会话状态。

### Cyrene-Plugins-Official — capabilities and provenance / 能力与来源记录

Cyrene-Plugins-Official owns capability contracts, SDKs, runtimes, and connector plugins. The Navigator operations UI now lives at `Cyrene-Client/apps/web/services/navigator/`. Plugins commit `1952b24` removes its implementation from `plugins/ui/navigator/`, leaving the README and provenance record there; the source manifest has been regenerated. The transfer is committed locally, and remote read-back remains pending.

Cyrene-Plugins-Official 负责能力契约、SDK、运行时和 connector 插件。Navigator 运维 UI 现位于 `Cyrene-Client/apps/web/services/navigator/`。Plugins 提交 `1952b24` 已从 `plugins/ui/navigator/` 移除实现，仅保留 README 和来源记录，并重新生成 source manifest。迁移已在本地提交，远端读回仍待完成。

## 3. Unified client principles / 统一客户端设计原则

1. **Single install / 单一安装.** Users install one client whose selected service modules cover the six-service workflow. A service selection also selects its corresponding UI bundle. / 用户安装一个客户端，通过选择服务模块覆盖六服务工作流；选择服务时同时选择对应的 UI bundle。
2. **Unified session / 统一 session.** The client surfaces use the Navigator Web Host session rather than creating six independent sign-in and refresh flows. Cookie scope, CSRF handling, and trusted forwarding remain part of the host integration contract. / 各客户端界面复用 Navigator Web Host session，不另建六套登录和续期流程。Cookie 作用域、CSRF 处理和可信转发仍须纳入 Host 集成契约。
3. **Closed workflow handoffs / 工作流闭环.** Cross-service actions, such as sending a training result to Echo for evaluation, are explicit in-client handoffs over typed resource references. The client carries context so users do not copy IDs between applications. / 跨服务操作（例如将训练结果发送到 Echo 评测）应是客户端内显式的一键交接，并通过类型化资源引用传递；客户端负责承接上下文，避免用户在多个应用间复制 ID。
4. **Native multi-window support / 原生多窗口.** Use each operating system's window management so users can work in parallel, such as editing a Pipeline in one window while monitoring a training Run in another. / 使用操作系统原生窗口管理支持并行操作，例如一个窗口编辑 Pipeline，另一个窗口监控训练 Run。
5. **Thin UI / UI 层保持轻薄.** UI layers render and collect input. Shared client logic owns API orchestration, state transitions, compatibility rules, and handoff behavior; presentation code should not independently decide product workflows. / UI 层负责渲染和收集输入。API 编排、状态转换、兼容规则和交接行为由共享客户端逻辑负责；界面代码不应自行裁定 Product 工作流。

## 4. Platform priorities / 平台优先级

Electron is not selected for the Windows native client. Reaching the scrolling acceleration and rendering experience expected for Cyrene's own daily use would require substantial Windows-specific optimization; the estimated engineering cost is not acceptable. Cyrene will dogfood the client, so the quality bar is “good to use,” not merely “works.”

Windows 原生客户端不选 Electron。要达到 Cyrene 团队日常使用所要求的滚动加速和渲染体验，需要投入大量 Windows 专项优化，预估工程成本不可接受。Cyrene 会将该客户端用于自身工作，因此体验标准是“真正好用”，而非仅仅“能够运行”。

| Platform | Priority and decision / 优先级与决策 |
| --- | --- |
| Web | Primary client and functional reference. Shared browser components live under `apps/web/`; each installable service UI belongs under `apps/web/services/<service>/`. / 主客户端与功能参考实现。共享浏览器组件放在 `apps/web/`，可安装的服务 UI 按 `apps/web/services/<service>/` 放置。 |
| Windows | Secondary native client. Use WinUI 3 on Windows App SDK with C# and XAML. The installer packaging exists, while the native client remains future work. / 次优先级原生客户端。使用 C#、XAML 和 Windows App SDK WinUI 3。现有安装器打包，原生客户端仍属后续工作。 |
| CLI | Secondary surface for service-oriented command workflows; implementation remains future work. / 次优先级服务命令行入口；仍属后续工作。 |
| macOS | Deferred; use SwiftUI after Windows is implemented and stable. No macOS work is in the current phase. / 延后建设；Windows 实现并稳定后再使用 SwiftUI。当前阶段不开展 macOS 工作。 |

Each platform implements its own UI and native integration while sharing business logic through `cyrene-client-core`.

各平台分别实现 UI 和原生系统集成，并通过 `cyrene-client-core` 共享业务逻辑。

**Delivery phases / 实施阶段**

1. **Phase 1 — Web modules / 阶段一——Web 模块:** Keep the browser workbench as the shared web shell, then extract each service UI as an independently buildable package. / 保留浏览器工作台作为共享 Web 外壳，再将各服务 UI 拆成可独立构建的包。
2. **Phase 2 — Windows and CLI / 阶段二——Windows 与 CLI:** Build the Windows native client and service commands as secondary surfaces, reusing shared contracts and logic. / 将 Windows 原生客户端和服务命令行作为次优先级界面，复用共享契约与逻辑。
3. **Phase 3 — macOS / 阶段三——macOS:** Begin the SwiftUI client after Windows is implemented and stable. / Windows 客户端实现并稳定后再开始 SwiftUI 客户端。

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

Each service UI is an independently installable and removable component: users install a module when they need it and uninstall it when they no longer do. The installer itself stays small and independent — it resolves the selected components from the manifest and downloads only those artifacts, instead of bundling every module into one package. On native platforms a merged component takes effect after restart; on web it takes effect after refresh. As an alternative distribution form, two installer variants may be published: an online installer that downloads only the selected modules, and an offline installer that bundles all modules for disconnected installs. This manifest-driven installer and bundle distribution model is a target design; it is not implemented in the inspected Client tree.

每个服务的 UI 都是可独立安装和卸载的组件：需要时安装，不用时卸载。安装器本身保持轻量、独立——依据 manifest 解析所选组件并只下载对应 artifact，而不是把所有模块打进一个包。原生平台上组件合并后重启生效；Web 平台刷新即生效。作为可选的分发形态，可以发布两种安装器：在线安装器只下载所选模块，离线安装器内含全部模块以支持离线安装。基于 manifest 的安装器和 bundle 分发模式属于目标设计，在检查时的 Client 树中尚未实现。

## 7. Relationship between web and desktop clients / Web 与桌面客户端的关系

The browser client is rooted at `apps/web/`; the current workbench is the shared web surface and standalone service bundles live under `apps/web/services/`. It is intended to be served through the Navigator Web Host for cross-device access. Windows native work belongs under `apps/win/`, CLI commands under `apps/cli/`, and the deferred macOS client under `apps/mac/`.

浏览器客户端位于 `apps/web/`；当前工作台是共享 Web 界面，独立服务 bundle 放在 `apps/web/services/` 下，目标是通过 Navigator Web Host 提供跨设备访问。Windows 原生客户端放在 `apps/win/`，CLI 命令放在 `apps/cli/`，延后的 macOS 客户端放在 `apps/mac/`。

Both clients use the same backend APIs and product-owned workflows. Platform-specific presentation may differ, but business behavior must not fork between web and desktop. Once the native client is stable, the web client may become a lighter access surface for users without a local Navigator environment.

两类客户端使用同一套后端 API 和由 Product 所有的工作流。平台界面可以不同，但 Web 与桌面版不得分叉业务行为。原生客户端稳定后，Web client 可逐步简化为没有本地 Navigator 环境时使用的轻量访问入口。

## 8. Next steps / 下一步

The following items are future work and are not claimed as implemented by this decision record:

以下事项属于未来工作，本文不声称它们已经实现：

1. Promote the local Navigator console and Plugins provenance commits, then verify canonical remote read-back while preserving provenance and a single active development home. / 推送本地 Navigator 控制台与 Plugins 来源记录提交，并核验远端权威分支读回，同时保留来源信息并维持单一开发位置。
2. Split the five service areas still integrated in the workbench into independent UI packages under `apps/web/services/`, keeping Navigator as a separate package. / 将仍集成在工作台中的五个服务界面拆为 `apps/web/services/` 下的独立 UI 包，并保留 Navigator 独立包。
3. Specify and implement `cyrene-client-core`, its C ABI, Windows and macOS bindings, and contract-aligned API clients, session handling, state models, polling, and SSE distribution. / 设计并实现 `cyrene-client-core`、C ABI、Windows 与 macOS 绑定，以及契约对齐的 API client、session 处理、状态模型、轮询和 SSE 分发。
4. Implement the Windows client and module downloader, then establish its stability gate before beginning the deferred SwiftUI client. / 实现 Windows 客户端和模块下载器，再建立稳定性验收门槛，之后才开始延后的 SwiftUI 客户端。
5. Define and build the release manifest, version-compatibility checks, service UI bundles, and installer selection flow. / 定义并构建 release manifest、版本兼容检查、服务 UI bundle 和安装器选择流程。
