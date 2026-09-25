# UI Module and Installer Layout / UI 模块与安装器目录

## Platform roots / 平台根目录

```text
apps/
├── web/                 # Primary browser client; shared shell and browser-only components
│   ├── src/             # Current shared Pipeline IDE/workbench
│   └── services/        # One independently buildable UI package per service
├── win/                 # Secondary Windows native client and its installer/downloader
│   ├── crates/          # Rust native installer components
│   ├── installer/       # MSIX manifest, assets, and packaging script
│   └── services/        # Reserved Windows service UI module roots
├── mac/                 # Deferred native macOS client (services/ roots reserved)
├── cli/                 # Secondary command-line client (services/ roots reserved)
└── mcp/                 # Local MCP stdio adapter

packages/                # Shared Client packages and platform-neutral logic
```

`apps/web/` owns components that are shared by browser modules. `packages/` owns reusable contracts and logic that can be consumed by more than one platform. A module-specific screen belongs under that platform's `services/<service>/` directory; platform-specific launchers, downloaders, and scripts stay at that platform root. Product workflows and durable state remain owned by their Product services.

`apps/web/` 放浏览器各模块共用的组件。`packages/` 放可被多个平台复用的契约和逻辑。模块专属界面放在平台目录下的 `services/<service>/`；平台专属启动器、下载器和脚本放在对应平台根目录。Product 工作流和持久状态仍由各 Product 服务负责。

## Six-service module status / 六服务模块现状

| Service | Web module path | Current implementation |
| --- | --- | --- |
| Catalyst | `apps/web/services/catalyst/` | No standalone package yet; current workbench contains the integrated dataset workflow. |
| Yield | `apps/web/services/yield/` | No standalone package yet; current workbench contains the integrated training configuration workflow. |
| Echo | `apps/web/services/echo/` | No standalone package yet; current workbench contains the integrated evaluation configuration workflow. |
| Reactor | `apps/web/services/reactor/` | No standalone package yet; current workbench contains the integrated model and deployment settings. |
| Exchange | `apps/web/services/exchange/` | No standalone package yet; gateway surfaces remain part of the broader client workflow. |
| Navigator | `apps/web/services/navigator/` | Standalone React + TypeScript + Vite package, served through the Navigator same-origin Web Host. |

The first five paths currently contain status READMEs to reserve clear module ownership without implying that a package or bundle already exists. Navigator is the only service with an independently buildable browser package today.

前五个路径目前只放状态说明，用于明确模块归属，不代表已经有独立 package 或 bundle。Navigator 是目前唯一可独立构建的浏览器服务包。

## Build boundaries / 构建边界

The root `npm run check` validates the shared browser workbench. Navigator has its own package and lockfile, with root shortcuts:

根目录 `npm run check` 验证共享浏览器工作台。Navigator 有独立 package 和 lockfile，根目录提供快捷命令：

```bash
npm run dev:web:navigator
npm run build:web:navigator
npm run check:web:navigator
```

As each service UI is extracted, it should keep its own dependency manifest and build output, while consuming shared web components and packages through explicit package dependencies. Building one service module must not require packaging the other five. The shared web shell can compose selected modules at runtime or load their generated bundles according to the release manifest.

各服务 UI 拆分后，应保留独立依赖清单和构建产物，并通过显式 package 依赖使用共享 Web 组件和共享包。构建一个服务模块不应要求同时打包其他五个模块。共享 Web 外壳可在运行时组合选定模块，或依据 release manifest 加载各模块构建产物。

Windows installer crate checks can run with `npm run check:win:installer`; `npm run build:win:installer` builds the current Rust workspace. The existing MSIX workflow builds release binaries and packages them using `apps/win/installer/package-msix.ps1`. This package currently provides installer infrastructure only: it does not yet download or install independently versioned service UI bundles.

Windows 安装器 crate 可使用 `npm run check:win:installer` 检查，`npm run build:win:installer` 构建当前 Rust workspace。现有 MSIX workflow 构建 release 二进制，并调用 `apps/win/installer/package-msix.ps1` 打包。当前只有安装器基础设施，尚未下载或安装独立版本的服务 UI bundle。

## Download and update contract / 下载与更新契约

The target release flow is:

目标发布流程：

1. Build and publish one immutable artifact per service, platform, and version; publish common platform assets separately.
2. Publish a signed release manifest that identifies each artifact, its platform/architecture, service version, supported API contract versions, byte length, SHA-256 digest, and download location.
3. Let the platform installer resolve the selected services from the manifest and download only compatible artifacts.
4. Verify the manifest signature and artifact digest before activation. Keep the previous known-good module available for rollback.
5. Install and uninstall each service module on demand; the installer never bundles all modules into one package. A merged module takes effect after restart on native platforms, and after refresh on web. Distribution may ship an online installer that downloads only the selected modules, an offline installer that bundles all modules, or both.

1. 按服务、平台和版本构建并发布不可变 artifact；平台共用资源单独发布。
2. 发布签名 release manifest，记录 artifact、平台/架构、服务版本、支持的 API contract 版本、字节数、SHA-256 摘要和下载地址。
3. 平台安装器依据 manifest 解析用户选择的服务，并仅下载兼容的 artifact。
4. 激活前验证 manifest 签名和 artifact 摘要，并保留上一个可用模块以支持回滚。
5. 每个服务模块按需安装、卸载；安装器不得把全部模块打进一个包。原生平台合并后重启生效，Web 平台刷新生效。分发可提供只下载所选模块的在线安装器、内含全部模块的离线安装器，或两者兼备。

These are release requirements for the future modular installer, not features of the current MSIX package. The browser modules, Windows downloader, macOS client, CLI service commands, release manifest, signing, and module selection flow must each be implemented and verified before they are described as shipped.

这些是未来模块化安装器的发布要求，不是当前 MSIX package 已有能力。浏览器服务模块、Windows 下载器、macOS 客户端、CLI 服务命令、release manifest、签名和模块选择流程都需要分别实现并验证后，才能描述为已交付。
