# Cyrene Client

[![Client CI](https://github.com/DoHorizon-AI/Cyrene-Client/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/DoHorizon-AI/Cyrene-Client/actions/workflows/ci.yml)
[![Package MSIX](https://github.com/DoHorizon-AI/Cyrene-Client/actions/workflows/package-msix.yml/badge.svg?branch=develop)](https://github.com/DoHorizon-AI/Cyrene-Client/actions/workflows/package-msix.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

模块化流水线工作台的第一阶段原型。React + TypeScript + Vite 提供应用界面，LiteGraph 0.7.14 提供节点画布。

公司仓库：[DoHorizon-AI/Cyrene-Client](https://github.com/DoHorizon-AI/Cyrene-Client)。默认开发分支为 `develop`；GitHub Actions 负责测试和构建，目前不部署服务或发布 npm 包。

**已增加独立控制服务、团队存储、分容器部署、运行协调以及 Yield/Echo 私有执行提供方。完整的双服务器训练→评估链路仍需目标环境验收。** 默认仍可使用原有本地预演；真实运行会先通过 Product 适配器预检。Yield 还要求实际 Kernel 训练绑定，Echo 还要求受信的模型推理输入准备器；缺少任一依赖都会明确拒绝启动。节点设置继续通过 Navigator 提供的现有接口操作。部署、迁移、能力边界与剩余实施项见 [分布式控制服务](docs/distributed-control.md)。

新增“构建 / 运行”菜单、持久化 GitHub Actions 构建任务、结果验证和显式节点版本启用；对应操作共享 HTTP/MCP 契约。需管理员配置真实构建仓库和凭据，使用方法见 [节点镜像构建](docs/node-builds.md)。

## 本地启动

Node.js 24+；独立开发存储使用 Node 内置 SQLite。

```powershell
git clone https://github.com/DoHorizon-AI/Cyrene-Client.git
cd Cyrene-Client
npm ci
npm run dev
```

打开 <http://127.0.0.1:5180>。开发服务器仅监听回环地址；端口占用时退出，不会终止已有进程。

使用新增独立后端运行 `npm run dev:services`。切换前停止旧开发进程；需要继承原 `.studio/*.json` 时先执行 `npm run control:migrate`，原文件及备份保留。团队部署使用 PostgreSQL，详见上面的部署说明。

团队 Compose 连接 Yield/Echo 时推荐挂载专用凭据文件：设置 `STUDIO_YIELD_EXECUTION_URL`、`STUDIO_YIELD_EXECUTION_TOKEN_FILE`、`STUDIO_ECHO_EXECUTION_URL` 和 `STUDIO_ECHO_EXECUTION_TOKEN_FILE`，再运行 `docker compose -f compose.yaml -f compose.executions.yaml up -d --build`。本地非容器运行也支持对应的 `STUDIO_*_EXECUTION_TOKEN_FILE`。同一 Product 不能同时配置 `TOKEN` 和 `TOKEN_FILE`，URL 与凭据必须成对出现。

## 可以尝试

- IDE 式深色工作台：顶部菜单与工具栏、两侧可切换工具窗口、中央编辑器标签、底部检查/预演/事件日志；侧栏和底栏可缩放、收起，布局自动记忆。
- 左侧“项目文件”打开本机文件或文件夹，支持文本预览和流程 JSON 导入；右侧“页面插件”提供内置页面入口，“平台 MCP”提供真实工具目录和可复制任务上下文。详见 [工作台界面](docs/ide-workbench.md)。
- 七种声明式节点：数据集、基础模型、算力配置、微调、评估、部署、Agent 测试。
- 点击左侧节点库添加节点；拖动节点、端口连线、平移、缩放；Delete 删除选中节点。
- 在右侧参数面板编辑节点，在节点列表中定位画布节点。
- 校验端口类型、必填连接、参数范围和循环依赖。
- 使用“文件 → 保存草稿”或 Ctrl/Cmd+S 保存浏览器副本；刷新后用“文件 → 载入草稿”恢复。文件菜单也可导入/导出带布局的 JSON。
- 本地预演按拓扑顺序标记步骤，可停止；不会执行 LiteGraph 图引擎或任何外部请求。
- 服务端流水线草稿、独立流程/布局版本、批量变更记录与撤销。
- ELK 自动排版、节点位置锁定，以及保留范围外位置的局部排版。
- 本机 stdio MCP 工具：AI 可查询节点目录，创建、编辑、校验和整理服务端草稿。配置见 [流水线编辑与 MCP](docs/pipeline-editing-mcp.md)。

## 服务器管理与 MCP 预留

左侧工具栏的 **服务器管理** 可新增、编辑、筛选和归档自管服务器、容器算力、云平台托管资源的登记；算力节点可读取登记并选择目标。登记保存在 Client 服务端的 `.studio/server-registry.json`，包含修订号、幂等回执和操作记录，刷新浏览器后仍在。

当前完成的是资源登记，真实心跳、GPU 监控和云平台操作尚未接入；查询未配置的连接会明确显示“未连接”。连接标识是未来控制服务中的配置引用，不是服务器 URL，不填写密码或令牌。归档只影响登记，已有服务器不会被停止。

服务器控制逻辑位于独立的 `packages/server-control/`，页面通过类型化命令调用。目标端优先复用 Platform 已有的 `cy-node-agent` / `cy-runtime-agent`。架构、职责、存储限制与实施顺序见 [服务器控制与 MCP 设计](docs/adr/0002-server-control-and-mcp.md)。本轮新增的 MCP 入口位于 `apps/mcp/`，目前仅开放流水线编辑工具。

## 连接节点设置服务

先将本项目的 `.env.example` 复制为 `.env.local`，填入实际 Navigator Web Host 的 origin：

```dotenv
STUDIO_NAVIGATOR_URL=http://127.0.0.1:8100
```

重启 `npm run dev`，点击右上角“服务连接 → 检查连接”。如未登录，输入 **Web Host 启动时提供的一次性配对码**。配对码只进入当前请求，不写入本地草稿；会话采用 HttpOnly cookie 和内存中的 CSRF token。不要填写云厂商令牌。地址只由 Client 服务端配置，节点 JSON 无法选择任意远端地址。

Web Host 需要按已有部署方式开放以下前缀，并配置对应 Product 的凭据；一般将前缀映射到各服务的 `/api/v1` 基址。Client 不修改 Web Host 配置、不自动启动其他仓库服务。

| 节点 | Web Host 前缀 | 本轮能力 |
| --- | --- | --- |
| 数据集 | `/api/v1/catalyst` | 列出数据集容器；按版本 ID 读取已发布版本并绑定 |
| 基础模型 | `/api/v1/reactor` | 列出模型导入；选择 READY 模型的制品引用 |
| 算力 | `/api/v1/system/status` | 读取 Web Host 本机 GPU 观测；云算力管理缺口仍保留 |
| 微调 | `/api/v1/yield` | 选择草稿、读取参数、显式 PATCH 保存；不会调用 start |
| 评估 | `/api/v1/echo` | 按 ID 读取配置、POST 另存配置；没有评估执行或原地更新 |
| 部署 | `/api/v1/reactor` | 读取并选择 serving binding；部署名称与选择保存在本地 |
| Agent | `/api/v1/navigator` | 按 workspace ID 列出现有会话并绑定；任务仍保存在本地 |

连接 Web Host 不等于其全部 Product 均可用。入口缺失、空列表、401、403、404、503 与契约不匹配分别显示。完整路径、写入范围和接口缺口见 [节点设置接入说明](docs/node-settings.md)。在未连接服务时，原有本地图编辑、保存、导入导出仍然可用。

无连接的草稿可以保存，但不能通过完整流程检查。非法或不支持的导入不会替换当前工作。保存位置是本地浏览器的 `cyrene.studio.prototype.v1.draft`，并非后端权威存储；JSON 可用于跨浏览器备份。名称和引用字段仅填写名称或引用，不要填写凭据。

## 验证

```powershell
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

如已安装 Chrome，可避免额外下载：

```powershell
$env:STUDIO_BROWSER_CHANNEL = 'chrome'
npm run check
```

端到端测试自行启动并关闭 5181 端口的独立服务，使用隔离浏览器上下文，不读取日常浏览器的账户和草稿。截图与失败追踪位于忽略的 `test-results/`。

自动测试覆盖本地 HTTP、流水线事务、布局和真实 stdio MCP 握手；浏览器覆盖原有交互与服务端版本同步。服务器登记及流水线测试使用真实本地文件/API；Product 设置测试使用显式 fixtures，不能作为真实 Product 已连通的证据。测试不访问真实 Product 或云厂商。当前结果见 [流水线编辑与 MCP](docs/pipeline-editing-mcp.md)。

## Apps

| Path | Role |
| --- | --- |
| `apps/web/` | Primary browser client and shared web workbench |
| `apps/web/services/<service>/` | Independently buildable web UI modules for Catalyst, Yield, Echo, Reactor, Exchange, and Navigator. Navigator is currently standalone; the other service screens remain in the shared workbench. |
| `apps/win/` | Secondary Windows native client and installer. MSIX packaging exists; the WinUI client and module downloader are not implemented. |
| `apps/mac/` | Deferred native macOS client; no implementation is planned in the current phase. |
| `apps/cli/` | Secondary command-line client; module commands are future work. |
| `apps/mcp/` | Local MCP stdio entry point for pipeline editing. |
| `packages/` | Client packages shared across platforms; platform UI stays under its platform root. |

The browser workbench is the current primary client. Shared web components live at the `apps/web/` layer, service-specific web applications live under `apps/web/services/`, and cross-platform client logic belongs in `packages/`. See [UI module and installer layout](docs/ui-module-layout.md) for the module boundaries, build commands, and planned download contract.

Navigator can be checked independently with `npm run check:web:navigator`; the Windows installer crate has separate `npm run check:win:installer` and `npm run build:win:installer` commands. These are local package gates and are not part of the browser-only `npm run check` command.

## 文件与边界

| 路径 | 职责 |
| --- | --- |
| `apps/web/src/graph/` | LiteGraph 的渲染、交互及文档转换适配层 |
| `apps/web/src/App.tsx` | 工作台界面组合、节点面板及本地预演 |
| `apps/web/src/pipelines/usePipelineDocument.ts` | 文档状态、撤销、草稿持久化、导入导出及画布就绪检查 |
| `apps/web/src/ide/` | 工具窗口、菜单、布局偏好、文件预览、页面入口与 MCP 上下文面板 |
| `packages/pipeline-model/` | 原型文档模型、节点定义和独立于画布的校验 |
| `packages/service-settings/` | 根据实际服务源码核对的设置响应与请求投影 |
| `apps/web/src/services/` | 连接、配对、节点设置 UI 与类型化客户端 |
| `packages/server-control/` | 独立于 UI/传输协议的服务器登记契约、应用服务和观测端口 |
| `packages/pipeline-control/` | 流程命令、版本检查、原子编辑、撤销及 ELK 排版 |
| `apps/web/src/pipelines/` | 服务端草稿、版本同步与排版操作 |
| `apps/mcp/` | 共用流水线应用服务的本机 stdio MCP 入口 |
| `apps/web/src/servers/` | 服务器管理界面、算力目标选择及控制客户端 |
| `tooling/server-control.ts`、`tooling/server-store.ts` | 本地控制 HTTP adapter 与持久化登记库 |
| `tooling/settings-proxy.ts` | 开发与 preview 环境的同源设置代理；拒绝任务执行路径 |
| `tests/unit/` | 非法文档、图依赖、画布转换往返测试 |
| `tests/e2e/` | 真实浏览器中的画布交互、保存、导入导出和预演 |
| `docs/adr/0001-isolated-prototype.md` | 本轮施工边界与后续服务接入顺序 |

Client 是独立仓库，可单独打开 `../Cyrene-Client` 开发；Workspace 只保存拓扑和 IDE 挂载信息，不复制 Client 源码。现有 Product 的业务代码和统一发布锁不因 Client 原型上传而改变。

## 下一阶段

执行计划、构建控制、运行协调器和 Yield/Echo 私有执行契约已经加入。下一阶段是生产装配：让 Product supervisor 调用 Platform 容器启动器、接通跨机制品传输和实际目标服务器，再验收双服务器训练→评估。

现有运行协调包括意图持久化、终态确认和有限重试；Yield/Echo 提供方测试不等于 GPU 或模型推理验收。云供应商管理、跨机制品平面、CRDT 与子图仍未实现；草稿撤销与重做按操作者隔离，保留其他人的独立修改。示例的同一数据集连接用于展示端口，真实训练与评估需明确数据切分；评估完成不等于评估门禁通过，正式部署必须增加服务端检查。

上游核心包的数字控件含 `eval`，构建会发出警告。本原型通过 React 表单编辑参数，不使用该数字控件，也关闭上游通用菜单、原生图导入与剪贴板入口。发布前仍需评估严格 CSP、无 eval 构建和依赖维护方案；当前构建通过不等于具备生产发布条件。

上游及许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。原型契约版本为 `cyrene.pipeline.prototype.v1`，尚不是跨仓库冻结契约。
