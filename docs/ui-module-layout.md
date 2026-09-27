# UI Module and Installer Layout / UI 模块与安装器目录

## Platform roots / 平台根目录

```text
apps/
├── web/                 # Primary browser client; shared shell and browser-only components
│   ├── src/             # Current shared Pipeline IDE/workbench
│   └── services/        # Product-specific browser modules, composed by Studio
├── win/                 # Secondary Windows native client and its installer/downloader
│   ├── crates/          # Rust native installer components
│   ├── installer/       # MSIX manifest, assets, and packaging script
│   └── services/        # Reserved Windows service UI module roots
├── mac/                 # Deferred native macOS client (services/ roots reserved)
├── cli/                 # Secondary command-line client (services/ roots reserved)
└── mcp/                 # Shared stdio/HTTP MCP adapter

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
| Navigator | `apps/web/services/navigator/` | Management pages composed by Studio; no independent browser shell or bundle. |

The first five paths reserve module ownership. Navigator's management components remain under `services/navigator/src`, while `src/products` provides the Studio session wrapper and scoped style. The workflow monitor lives in `src/monitoring`; shared monitoring contracts and aggregation live in `packages/monitoring`.

前五个路径保留模块归属。Navigator 原有管理组件仍在 `services/navigator/src`，`src/products` 提供 Studio 页面会话与作用域样式；流程监控位于 `src/monitoring`，聚合及契约位于 `packages/monitoring`。

## Build boundaries / 构建边界

The browser has one lockfile, one entrypoint and one `dist/` output. Product pages are loaded on demand. `npm run dev` starts both Studio control and the browser shell; `dev:legacy` retains the limited JSON bridge. `npm run check` includes the former Navigator tests. The compatibility command `build:web:navigator` builds Studio; `check:web:navigator` runs only the former module's tests.

浏览器采用统一锁文件、入口和构建产物，业务页面按需加载。统一浏览器不改变后端服务的独立部署，也不意味着当前已支持下载执行第三方页面插件。旧 Navigator 地址、认证和容器迁移见 [Navigator monitoring](navigator-monitoring.md)。

Windows installer crate checks can run with `npm run check:win:installer`; `npm run build:win:installer` builds the current Rust workspace. The existing MSIX workflow builds release binaries and packages them using `apps/win/installer/package-msix.ps1`. This package currently provides installer infrastructure only: it does not yet download or install independently versioned service UI bundles.

Windows 安装器 crate 可使用 `npm run check:win:installer` 检查，`npm run build:win:installer` 构建当前 Rust workspace。现有 MSIX workflow 构建 release 二进制，并调用 `apps/win/installer/package-msix.ps1` 打包。当前只有安装器基础设施，尚未下载或安装独立版本的服务 UI bundle。

## Download and update contract / 下载与更新契约

The future native/service-module release flow is (separate from the current unified browser build):

未来原生/服务模块发布流程（不替代当前统一浏览器构建）：

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
