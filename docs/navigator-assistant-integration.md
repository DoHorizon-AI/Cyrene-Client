# Navigator 助手整合

聊天界面归 Client，Harness 运行、原生智能体适配和权威会话事件归 Navigator。每轮对话使用现有 Navigator executor Task；任务、事件、审批、人工输入和附件使用既有 Work API，Client 不再启动独立 `assistant` daemon，也不创建 `assistant.sqlite`。

## 2026-10-09 审查修复：第一期

现有整合已分别保存为本地检查点 Client `3f25743`、Navigator `aaa64f0`，没有推送。Client 不再代理任务 PATCH 和执行器事件 POST；任务提交携带 `cwd`、`agentPreset` 或 `timeoutMs` 时返回 `403 RESERVED_EXECUTION_FIELD`，即使值为 null 或零也拒绝。正常任务提交与读取保留。相关 Client HTTP 与代理回归 8 项通过。

Navigator 将工作目录 realpath 后限制在宿主根目录列表中；外部任务不能指定内部原生预设，超时上限默认 6 小时。Web Host 使用独立 `CYRENE_WEB_SESSION_TOKEN` 和 `can_write_harness: false`，仅能改标题、描述和取消（现有 Work 状态 `aborted`），不能认领任务或伪造执行事件。`executorOwned` 标记不可变，缺少签名不能退回旧任务路径。Python 102 项通过，CI 范围 Ruff、格式和 Linux mypy 通过；旧记录迁移保留审批和任务数据。

权限矩阵：read-only 拒绝写入、shell、外部操作；ask 均询问；auto 仅自动允许目录内结构化写入，shell/网络/MCP 写仍询问（Codex 的系统沙箱例外）；full-access 自动放行但保留 MCP 身份权限检查。Harness 只公布实际实现的 read-only/ask。任务授权按操作种类隔离，MCP 按工具名隔离，复用时追加 `approval.auto_granted` 审计。API 地址或协议改变时必须重新填写密钥。

## 2026-10-09 审查修复：第二期

MCP wire 名称改为 `pipelines_get`、`runs_start` 等下划线形式，HTTP 命令和工具标题保持点号形式。工具权限与注解来自共享契约 `requiredScopes`、`effects`、`external`。新资源 `cyrene://guide` 说明版本、幂等与错误恢复；每个意图一个 key，同一请求重试沿用原 key 和参数。

错误区分 `outcome: rejected` 与 `unknown`，带 `requestId` 和恢复提示。执行开始后的未知异常或不符合输出 schema 的结果不能宣称未写入。同一进行中计划不能用换 key 再派发：`DUPLICATE_ACTIVE_RUN`/`DUPLICATE_ACTIVE_BUILD` 返回已有 ID。已删除 `/studio-assistant/v1/turn`、旧模型配置与面板对话；MCP 面板只做手工调试，聊天统一走 Navigator。实际 HTTP 发现 44 项工具；定向 91 项和 MCP 控制浏览器 2 项通过，未连接真实外部模型或 GitHub 运行。

## 2026-10-09 审查修复：第三期

助手与产品页面共享一个 Navigator 会话和 Workspace BFF 实例。配对、刷新和退出按顺序完成，防止晚到的 Set-Cookie 恢复已退出的登录；旧请求的响应或 401 不能覆盖新会话。BFF 网络取消或错误保留会话，仅 401 清空。发送、附件与审批须先核对 Client、能力发现和宿主的工作空间，未确认或不一致时停止操作并提供重试。

远端画布同步保留视口与选中，拖拽结束后才应用；冲突载入先保存恢复备份，每条流水线每个身份保留最近 20 份。Catalyst 未保存编辑不会被新修订替换，分页结果固定到发起时的修订。构建终态停止轮询，旧 revision 不回写；工作助手推流依赖任务状态并防抖详情刷新。助手隐藏保留 DOM，文本输入不触发 Alt 菜单快捷键；缺省权限回到 ask，auto/full-access 切换要求确认。

定向 68 项单元、33 项独立浏览器场景及 TypeScript 通过。浏览器覆盖实际 Cookie 顺序、共享会话刷新、未知/失败工作空间、编辑保护、同步视口和拖拽、窗口与快捷键。此期为本地源码和隔离测试，未推送或部署。

## 源码与接口

- `apps/web/src/assistant/` 提供同一实例在右侧栏与主编辑区之间移动的对话界面。新版 Navigator 工作助手管理页与聊天界面读取同一任务记录。
- `/api/v1/navigator/tasks` 映射到已配对 Navigator 的 `/api/v1/tasks`。新增顶层 `execution` 选择个人运行时、API 提供方、模型、思考深度和权限；任务 ID 也是稳定的提交幂等键。
- `/api/v1/navigator/assistant/capabilities` 和 `providers` 映射到 Navigator 相应接口。能力发现只呈现实际宿主支持的配置；API key 只写入宿主凭据存储，不进入浏览器持久化或任务 metadata。
- 个人 API 提供方使用 Harness 原生模型适配器，协议可选 `openai-completions`、`openai-responses` 和 `anthropic-messages`。图像输入仅在所选模型声明并实现支持时开放；原生 CLI 的模型和思考档位来自其能力发现。
- 任务 metadata 中的 `navigator` 命名空间由执行器管理，Client 拒绝浏览器伪造或修改该配置。已提交操作与审批固定到发起时的 session、task、workspace 和流程快照，切换画布不会改变原操作的目标。
- `/studio-mcp` 和 `apps/mcp/` 继续复用流水线、运行、构建、节点目录等共享应用服务。聊天样式和面板移动是 Client 展示行为，不新增 MCP 工具。业务新增 `builds.reconcile` 同时进入 HTTP、MCP 与构建界面。

## 本机启动

Node 24+；Navigator 依照自己的文档安装 Python 依赖和固定上游 Harness，不能使用旧 alpha.1 构建替代新版 pin。在 Navigator 仓库完成：

```powershell
uv sync --frozen
node scripts/prepare-harness.mjs --install --build
npm --prefix harness ci --ignore-scripts --legacy-peer-deps
node scripts/prepare-harness.mjs --link
node .upstream/deepseek-harness/node_modules/typescript/bin/tsc -p harness/tsconfig.json
```

Windows 的 `prepare-harness.mjs` 需要已安装 pnpm 并正确设置 `PNPM_HOME`；使用 `harness/upstream.lock.json` 声明的包管理器版本。原生宿主也需要按 Navigator 的 native 文档构建。

在 Client 中：

```powershell
npm ci
# 标准仓库布局自动使用 ../Cyrene-Services/Cyrene-Navigator；其他布局显式设置：
$env:CYRENE_NAVIGATOR_DIR = 'C:/path/to/Cyrene-Navigator'
npm run assistant
```

该命令复用 Navigator `scripts/serve-local.py` 启动权威服务栈，并启动 Client 的控制服务与 Vite。默认 Web 5180、控制服务 5280、Navigator 8100；可用 `npm run assistant -- --port 5240 --navigator-port 8140` 启动独立开发实例。已占用端口会报错，启动器仅管理自己启动的进程树。

默认 Navigator 状态保存在 Client `.studio/navigator`，可通过 `--state-dir` 或 `CYRENE_NAVIGATOR_STATE_DIR` 指定。UI 第一次连接使用该目录的 `pairing-code` 文件；凭据和值不会通过模型、任务记录或能力响应返回。已准备虚拟环境时直接使用它，也可用 `CYRENE_PYTHON` 指定 Python；否则由 uv 运行。

启动器显式启用 `CYRENE_PERSONAL_RUNTIMES_ENABLED`，并把同一控制服务的 MCP URL 和专用机器凭据仅传给 Navigator 执行器。只读模式必须在工具执行边界限制 MCP 写入；Full Access 不扩大 MCP 凭据的权限。个人主代理选择目前用于 local 模式；team 模式继续走既有配置好的云任务，Client 拒绝个人 execution 选择，直到具备按调用者身份委派 MCP 权限的方案。

`Allow for all` 对应 Work 服务端的 `scope: task`，只允许当前任务内同类操作，MCP 按工具名区分；`scope: once` 仅批准当前请求。新聊天恢复为确认模式。任务终止后不继续使用该授权，也不能借此跳过只读模式、原生拒绝或 MCP 权限。

Codex、Claude Code、Cursor Agent、CodeBuddy 使用执行宿主已有 CLI 和登录配置；安装编辑器不能视为 Agent CLI 已可用。缺少 CLI、模型或所需原生协议时显示不可用。WorkBuddy 的状态以实际接口检测为准，不将其他厂商 CLI 冒充它。

Harness 对只读任务仅开放以定义对象身份登记的可信读工具，未知插件工具拒绝执行。MCP 写入和既有 Work 工具遵循任务审批；安装的其他 Harness 插件仍须实现自身操作的权限规则。新的 `CYRENE_MCP_URL/TOKEN` 机器凭据要求显式启用个人宿主，不能当作团队用户的 MCP 委派凭据。

宿主可以通过 `CYRENE_CODEX_EXECUTABLE`、`CYRENE_CLAUDE_EXECUTABLE`、`CYRENE_CURSOR_EXECUTABLE` 和 `CYRENE_CODEBUDDY_EXECUTABLE` 指定实际可执行文件或 Node 入口。Windows 的 `.cmd/.ps1` 外壳不能作为原生入口；例如 npm 版 Codex 指向 `@openai/codex/bin/codex.js`。修改宿主路径后重启服务，再点击刷新智能体。

启动器通过私有 stdin 停机通道让 Navigator 先释放写句柄和租约，再关闭 Client 子进程；超时才终止自己启动的进程树。本地监督器持有状态目录独占锁时，可恢复固定内置调度器的旧 owner：后端同时检查同 actor、租约已过期和观测 epoch 一致。活动租约、其他 actor 或普通用户会话不会因此被自动接管。

## 旧聊天记录

原 `.studio`、用户 SQLite 和旧工作树保留。历史 `assistant.sqlite` 不能成为新执行器的执行权威，也不能将旧待审批记录重新派发。Navigator 提供 `scripts/export-legacy-assistant.py` 只读导出指定旧身份的历史：

```powershell
uv run python scripts/export-legacy-assistant.py --database 'C:/path/to/assistant.sqlite' --output 'C:/path/to/legacy-chat.json' --connection-id local --actor-id local-user --workspace-id local
```

在聊天历史中读取该导出文件即可只读查看；不会导入模型上下文、续接旧任务或激活旧审批。提供方配置、凭据、本机路径和执行配置不会随导出迁移。

## 验证范围

验证须分别记录 UI fixture、真实控制 HTTP/MCP、Navigator 持久化与原生 CLI 运行结果。模拟模型和原生协议 fixture 可以验证编排、错误处理和权限，不能证明真实账户的模型额度、厂商 CLI 兼容或生产部署。此源代码整合不自动替换既有运行包。

2026-10-08 本地验证：Client 284 项单元通过，6 项 PostgreSQL 条件跳过；52 项界面、5 项控制服务、4 项安全浏览器通过，构建通过。Navigator 执行器、Work、原生主代理、三种 API 协议、MCP、工作流和云连接定向 39 项通过；Python 全量 98 项通过，另有一个原有测试在 Windows 检查 POSIX `0600` 时失败。CI 所用范围的 Ruff、格式和 Linux 平台 mypy 检查通过。

隔离服务实测完成配对、提供方凭据写入和脱敏回读、44 个 MCP 工具发现；原生协议 fixture 经 Work task 范围审批后，在真实控制服务创建草稿、添加节点目录中的普通算力节点并回读修订号 2。续聊改为只读后直接 MCP 写入被拒绝，未创建草稿。真实本机 Codex 仅完成模型发现（7 个模型），没有付费模型推理或生产运行。
