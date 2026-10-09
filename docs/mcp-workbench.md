# MCP 工作台与本地验收

## 2026-10-09 第一期代理边界

浏览器任务不能指定执行目录、预设或超时；这些参数由执行宿主约束。Client 不开放 Work 任务 PATCH 或执行器事件 POST，防止浏览器改写执行结果。工具调用仍经过原有身份、workspace、scope、修订号和幂等检查。Client HTTP/代理边界回归 8 项通过，本期未推送或部署。

Client 的 MCP 入口、工具调试和可配置模型助手共享现有控制服务。默认不启用本地诊断，也不连接任何模型供应商。此功能不代表真实 GPU 训练、云服务器接管或 Product 业务接口已全部接通。

## 启动与界面

Node 24+，`npm ci` 后执行 `npm run dev`。通过「工具 → MCP 助手与工具调试」或「运行 → MCP 调试与本地测试」打开右侧窗口。

- **工具调试**：连接 MCP 后读取当前身份真实可用的 tools/list；查看输入/输出 JSON Schema，填写 JSON 并调用，保留最近 30 次调用及结果。写入由独立按钮确认。版本号必须读取现态；重试同一写请求保持原参数和幂等键。
- **对话**：配置模型后发送任务。模型提出工具调用，界面展示名称和完整参数；按顺序执行或拒绝，再点击「让 AI 根据结果继续」。建议、确认、真实返回分开；模型提议本身不执行命令。对话和调试记录只在当前页面内存保留；换流程或身份重置上下文。外部 AI 客户端仍可使用复制任务功能。
- **接入与测试**：显示 HTTP 地址、权限和本地诊断入口。当前浏览器使用自身会话和 CSRF；不导出浏览器 token。

AI 读取的是已保存的服务端流程。当前画布存在未保存修改时，同步继续保留本地内容并提示冲突。确认发出的写操作不会因切换页面自动撤销。

## HTTP 与 stdio 接入

HTTP 地址为公开工作台 origin 加 `/studio-mcp`，支持当前 SDK 的 Streamable HTTP。每次请求重新验证身份、工具权限及 workspace；不缓存跨用户 MCP session。提供 tools、`cyrene://context` 身份资源、`cyrene://templates/local-diagnostic` 模板，以及 `workflow-assistant` prompt。监控继续使用 `monitoring.snapshot`、`runs.observe`、`runs.events`，不声称提供 MCP resource 推送订阅。

使用 `@modelcontextprotocol/sdk@1.30.0`，最高协商协议为 **2025-11-25**；未实现 2026-07-28 新协议、OAuth discovery/登录或第三方 MCP server 聚合。客户端需支持该协议和显式 Bearer token。原生 SDK 按该版本处理 initialize、tools/list、tools/call、resources/read、prompts/get；GET/DELETE 在无协议 session 模式下返回 405。

- 团队模式：账号菜单选择「只读」或「当前操作权限」，创建有效期 24 小时的专用 API 凭据。默认只读；不能赋予自身没有的权限。列表只显示指纹、期限和 scopes，可撤销自己的凭据，下一次 MCP 请求即失效。凭据管理属于身份管理，不交给模型工具。
- 本地模式：服务端配置 `STUDIO_LOCAL_API_TOKEN`，外部客户端发送 `Authorization: Bearer <token>`。这是本机开发凭据；轮换配置并重启控制服务使旧值失效。
- 浏览器请求校验 Host/Origin 和 POST CSRF；带 Bearer 的请求也校验已有 Origin。API token 不放 URL、图文档、浏览器 localStorage 或模型上下文。
- `STUDIO_MCP_READ_ONLY=1` 限制 HTTP MCP 与内置模型工具目录；stdio 启动进程也应配置此变量。它不取代用户权限，也不禁用独立 REST 的正常编辑功能。

stdio 客户端直接启动 Node，避免 npm 标题污染 stdout。例如配置进程参数：

```text
node C:/work/Cyrene-Client/node_modules/tsx/dist/cli.mjs C:/work/Cyrene-Client/apps/mcp/main.ts
```

同时为该进程注入 `STUDIO_CONTROL_URL=http://127.0.0.1:5280`（指向实际控制服务）和 `STUDIO_API_TOKEN`。不设置 URL 时现在拒绝启动，防止误写第二套存储。历史 JSON 模式必须显式设置 `STUDIO_MCP_LEGACY_FILES=1`；仅供旧 `dev:legacy` 工作区，不与 SQLite/PostgreSQL 混用。

## 模型配置与数据路径

在服务端 `.env.local` 设置后重启控制服务：

```dotenv
STUDIO_ASSISTANT_URL=https://your-provider.example/v1/chat/completions
STUDIO_ASSISTANT_MODEL=your-tool-capable-model
STUDIO_ASSISTANT_API_KEY_FILE=/private/model-key
```

也可用 `STUDIO_ASSISTANT_API_KEY`，但不能与文件配置同时使用。URL 必须为 HTTPS 或本机回环 HTTP，禁止 URL 凭据、query/fragment 及重定向。不使用 `VITE_` 前缀。容器可用 `compose.assistant.yaml` 叠加层挂载密钥文件；模型 URL 需为容器可达的 HTTPS 地址。

供应商需实现 Chat Completions 的 function tools、非流式 assistant/tool 消息。配置 URL 是完整 endpoint，不自动拼接。模型收到任务、工作空间/流程 ID、已允许工具的 schema，以及用户选择继续发送的工具结果；不自动发送全部工作空间或秘密。供应商差异须实际验证，不声称支持任意聊天 API。

服务端 `/studio-assistant/v1/turn` 验证会话/CSRF、workspace 和 `pipelines.read`；只生成提议。实际调用仍经浏览器 MCP 和同一个控制服务。每人最多一个在途模型请求，全服务最多 16 个，25 秒超时；请求 256 KiB、响应 1 MiB、历史 60 条和每轮 4 个调用上限。上下文过长时新开对话，不静默丢掉审批/调用结果。

## 可重复的本地运行测试

```dotenv
STUDIO_LOCAL_DIAGNOSTICS=1
```

连接 MCP 后点「创建并运行本地诊断」，系统通过 MCP 模板读取 → pipelines.create → runs.preflight → runs.start 创建独立流程，不覆盖当前草稿。Navigator 在主区域打开，切换到「本地诊断」类型可查看状态和事件。默认一个 30 步成功任务、一个 15 步预期失败任务；因此流程最后是 failed，这是明确配置的故障测试。

`local-diagnostic@1` 是受限的控制服务内 CPU 校验任务：每轮实际 SHA-256 计算，最多每秒一步，总共 2–120 步，不运行 shell/用户代码、不联网、不占 GPU、不发布伪训练制品。调度使用已有 RunControl；持久化 attempt、计算摘要、进度、终态与身份，控制服务重开后继续原任务。同 attempt 不同参数拒绝，停止是幂等终态；不支持在线改参或 GPU checkpoint 恢复。

目前执行契约要求 image-shaped 标识，诊断适配器的 `cyrene-local-diagnostic@sha256:...` **仅为实现指纹，不是可拉取镜像，诊断也不运行在独立容器**。生产 Product 执行器仍保留原有固定镜像/Lease/Fence 验证，不复用该测试适配器。

可从「文件」载入生成的诊断流程，改为 outcome=succeed 后重新预检运行；通过工具 runs.stop、runs.resume、runs.observe 检查停止/恢复和事件。任务配置变动需要新版本、新预检；未启用诊断的环境预检明确报告适配器不可用。

## 开发与回归

新增可操作功能先设计应用命令的输入/输出、作用域、版本、幂等与状态查询，再接 UI/MCP；不能只在组件中增加独占逻辑。只属于视图的折叠/颜色等行为无需工具化，但应明确区别于业务操作。新增工具须更新真实 tools/list 注册、菜单/面板入口、说明和回归测试。

`tests/unit/mcp-platform.test.ts` 验证 HTTP 协议、资源、权限、创建/排版/预检/运行/停止及诊断持久化；`assistant.test.ts` 使用明确模型夹具，验证模型提议不会写入；`tests/control-e2e/mcp.spec.ts` 使用真实控制服务/MCP 和浏览器验证手工批准、调试调用和 Navigator 实时日志。模型夹具不代表外部模型联调；本地诊断不代表 Product/GPU 业务验收。
