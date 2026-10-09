# MCP 工作台与本地验收

## 2026-10-09 第一期代理边界

浏览器任务不能指定执行目录、预设或超时；这些参数由执行宿主约束。Client 不开放 Work 任务 PATCH 或执行器事件 POST，防止浏览器改写执行结果。工具调用仍经过原有身份、workspace、scope、修订号和幂等检查。Client HTTP/代理边界回归 8 项通过，本期未推送或部署。

Client 的 MCP 工具和网页画布使用同一控制服务、节点目录、版本检查及幂等回执。默认不启用本地诊断。AI Assistant 的对话、模型供应商和执行循环由 Navigator 管理；旧的单轮模型提议入口和控制服务模型环境配置已经移除。

## 启动与界面

Node 24+，`npm ci` 后执行 `npm run dev`。通过「工具 → MCP 工具调试」或「运行 → MCP 调试与本地测试」打开面板。

- **工具调试**：连接后读取当前身份可用的 tools/list。输入/输出 JSON Schema 与正式命令共用；填入参数并手动调用，写入需点击确认按钮。面板保存最近 30 次调用记录。
- **接入与测试**：显示 MCP endpoint、身份权限及本地 CPU 诊断入口。模型与 Agent 的选择、审批在 AI Assistant 中进行。

界面显示 dotted 标题（例如 `pipelines.patch`），实际 MCP tool name 使用 underscore（`pipelines_patch`）。HTTP command name 仍用 dotted 名称。此改动不保留 dotted MCP 别名，避免名称重复和客户端兼容性分歧。

AI 读取已保存的服务端流水线。画布有未保存编辑时，远端同步保留本地内容并提示冲突；已发出的写操作不会因切换页面自动撤销。MCP 添加节点与用户拖拽使用同一类型、默认配置和校验，`nodes_list_types` 正式返回 type/version/active、ports、fields、defaults、configSchema 和 execution 信息。

## 权限、效果与恢复

所有域通过同一个 `registerCommand` 注册：pipeline、runs、monitoring、builds、catalog、servers。共享定义声明 `requiredScopes`、`effects`（read/additive/update/destructive）及 `external`。HTTP permittedCommands 与 MCP tools/list 使用同一权限定义；执行服务重新检查 actor/workspace/scopes。

工具名称符合 `^[a-z0-9_]{1,64}$`，启动时拒绝重名。只读、破坏性、幂等和外部访问 annotations 从定义生成；这些提示方便客户端判断，不替代服务端授权。save、patch、undo、redo、stop、archive 等可能删除或替换已有状态，标记 destructive；内部状态查询 openWorldHint=false，联系 Product/Platform/GitHub 的操作为 true。

在 `cyrene://guide` 读取操作规则；`cyrene://context` 返回无凭据的真实身份、workspace 和 scopes；`workflow-assistant` prompt 说明读取、编辑、预检及结果核对流程。

写工具都要求 `idempotencyKey`：

- 同 key、同参数重放原回执。
- 同 key、不同参数返回 `IDEMPOTENCY_CONFLICT`。
- 新意图使用新 key；对结果未知的同一意图重试，保留原 key 和全部参数。

expectedGraphRevision/expectedLayoutRevision/expectedRevision 取自当前 get/list/preview；`REVISION_CONFLICT` 要求重读与协调编辑。`runs_preflight`、`builds_preview`、`catalog_preview_activation` 的 fingerprint 必须原样用于对应写操作。预检不会创建任务或预约算力。

工具错误统一包含 `code/message/outcome/retryable/requestId/recovery`（`isError=true`、text JSON）：

- `rejected`：参数或授权不符，或控制服务明确拒绝。修正前不要重复发送。
- `unknown`：执行开始后发生意外错误，或已写入但输出未通过契约校验。先读取现态及事件，再按原 key 和参数重试；不要用新 key 消除不确定性。

日志包含同一个 requestId。`retryable` 表示可按 recovery 指引重试，并非建议自动持续重发。确认字段和按钮无法约束模型，真正的权限及审批必须由服务端执行。

相同 workspace/actor/pipelineId/graphRevision/预检 fingerprint 的 active run 返回 `DUPLICATE_ACTIVE_RUN`，`details.existingRunId` 指向已有运行。相同 workspace/profile/sourceSha 的 active build（包括同 workspace 的其他操作者）返回 `DUPLICATE_ACTIVE_BUILD` 和 `details.existingBuildId`。幂等回执优先重放；终态后新意图可用新 key 再启动。构建 unknown 通过 `builds_reconcile` 核对原 GitHub run，不能重新派发来猜结果。

## HTTP 与 stdio 接入

endpoint 为公开工作台 origin 加 `/studio-mcp`，Streamable HTTP 使用 SDK 1.32.1，最高协商协议 **2025-11-25**。原生 SDK 处理 initialize、tools/list、tools/call、resources/read 和 prompts/get；无协议 session 的 GET/DELETE 返回 405。尚未实现 OAuth discovery 或第三方 MCP 聚合。

- 团队模式：浏览器账号菜单创建有效期 24 小时的专用 API 凭据，默认只读。API token 不能签发、列出或吊销 token；凭据管理只允许浏览器会话。吊销后下次请求立即失效。
- 本地模式：服务端配置 `STUDIO_LOCAL_API_TOKEN`，外部客户端发送 Bearer。该凭据用于本机开发，轮换并重启使旧值失效。
- Host/Origin、CSRF、workspace 和 scopes 每次重新检查。凭据不进入 URL、图文档、localStorage 或模型上下文。
- `STUDIO_MCP_READ_ONLY=1` 限制 MCP 工具；它不代替用户权限，也不禁用独立 REST 编辑。

stdio 直接启动 Node，避免 npm 输出污染协议 stdout：

```text
node C:/work/Cyrene-Client/node_modules/tsx/dist/cli.mjs C:/work/Cyrene-Client/apps/mcp/main.ts
```

为进程设置 `STUDIO_CONTROL_URL=http://127.0.0.1:5280` 和专用 `STUDIO_API_TOKEN`，指向同一控制服务。缺 URL 时拒绝启动；旧 JSON 模式需显式 `STUDIO_MCP_LEGACY_FILES=1`，不与 SQLite/PostgreSQL 混用。

## 可重复的本地运行测试

```dotenv
STUDIO_LOCAL_DIAGNOSTICS=1
```

连接 MCP 后点「创建并运行本地诊断」，系统通过 MCP 模板读取 → pipelines.create → runs.preflight → runs.start 创建独立流程，不覆盖当前草稿。Navigator 在主区域打开，切换到「本地诊断」类型可查看状态和事件。默认一个 30 步成功任务、一个 15 步预期失败任务；因此流程最后是 failed，这是明确配置的故障测试。

`local-diagnostic@1` 是受限的控制服务内 CPU 校验任务：每轮实际 SHA-256 计算，最多每秒一步，总共 2–120 步，不运行 shell/用户代码、不联网、不占 GPU、不发布伪训练制品。调度使用已有 RunControl；持久化 attempt、计算摘要、进度、终态与身份，控制服务重开后继续原任务。同 attempt 不同参数拒绝，停止是幂等终态；不支持在线改参或 GPU checkpoint 恢复。

目前执行契约要求 image-shaped 标识，诊断适配器的 `cyrene-local-diagnostic@sha256:...` **仅为实现指纹，不是可拉取镜像，诊断也不运行在独立容器**。生产 Product 执行器仍保留原有固定镜像/Lease/Fence 验证，不复用该测试适配器。

可从「文件」载入生成的诊断流程，改为 outcome=succeed 后重新预检运行；通过工具 runs.stop、runs.resume、runs.observe 检查停止/恢复和事件。任务配置变动需要新版本、新预检；未启用诊断的环境预检明确报告适配器不可用。

## 开发与回归

新增业务能力先定义共享命令、权限、版本、幂等与未知结果的恢复方式，再接 UI 和 MCP。Yield/Catalyst/Echo/Reactor 的直接业务工具仍属未来接入；现阶段可用的 Product 读取接口不代表训练、制品发布或部署写权限已开放。

更新能力不暴露为 MCP 工具。更新仅在 local 模式由用户确认，可能重启组件；不能让模型用参数中的确认字段绕过审批。

`mcp-command-contracts.test.ts` 验证 tools/list 唯一名称、annotations、schema、共享权限，以及真实 tools/call 的输入拒绝、写入后输出错误 unknown、服务器/构建/目录回执和版本冲突、active 去重与终态再启动。`mcp-platform.test.ts` 验证 HTTP 身份、资源、预检、运行和停止。浏览器 `tests/control-e2e/mcp.spec.ts` 验证手动写入、原 key 重试及 Navigator 诊断观测。测试构建适配器不会请求 GitHub；CPU 诊断不代表 Product/GPU 验收。
