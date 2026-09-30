# 本机 AI Assistant

工作台右侧的「平台 MCP」现在打开聊天窗口。标题栏的展开按钮把同一窗口移动到主编辑区；编辑区支持现有的拖动分栏。收起、移动或切换页面不会停止正在执行的任务。

## 启动

Windows 便携包双击 `Cyrene.cmd`。它启动回环地址上的工作台、控制服务和 Navigator 助手，并打开浏览器。Node、Python 和 Harness 由包提供，启动时不编译、不下载依赖。个人数据位于 `%LOCALAPPDATA%\Cyrene`。原生桌面窗口可复用 Navigator 的 `cyrene.assistant.v1` 契约。

开发环境：

```powershell
$env:CYRENE_NAVIGATOR_DIR = 'C:\path\to\Cyrene-Navigator'
npm run assistant
```

Navigator 需要先完成 `assistant` 包的 `npm ci && npm run build`、固定 Harness 的 host/client 构建与 `harness/tsconfig.json` 构建，以及 Python `uv sync --frozen`。这是开发/打包步骤，最终用户不需要执行。上游 pin 为 `dsh-v0.1.3-alpha.1`，不修改核心源码。

已有开发启动器仍可使用 `npm run dev`；未配置本机宿主时，聊天会明确显示连接失败，MCP 工具调试仍可使用。团队部署不代理用户的本机文件或凭据。

## 使用

1. 打开助手设置，填写本机绝对工作目录。
2. 选择 Codex、Claude Code、Cursor Agent、CodeBuddy Code，或 Cyrene · API。
3. 本机智能体使用各自已安装的 CLI 和登录状态。可通过启动器环境变量 `CYRENE_CODEX_PATH`、`CYRENE_CLAUDE_PATH`、`CYRENE_CURSOR_AGENT_PATH`、`CYRENE_CODEBUDDY_PATH` 指定原生可执行文件或受支持的 Node 入口。Cursor 编辑器命令 `cursor` 不提供 Agent ACP；需要单独安装 Cursor Agent CLI 并运行 `agent login`。CodeBuddy Code 需要 `codebuddy --acp` 可用并完成登录。未安装时设置页显示原因。
4. API 模式在设置中添加提供方。支持 Chat Completions、Responses、Anthropic Messages 和兼容 Base URL；同一提供方可以添加多个模型。模型 ID、图片能力、上下文/输出长度及思考档位按提供方实际能力填写。
5. 输入消息。Enter 发送，Shift+Enter 换行；中文输入法确认候选不会发送。可粘贴、拖入或选择图片和文本文件，单个附件上限 4 MB，每轮总计 8 MB。

每轮消息默认携带发送时的当前流程 ID、服务端版本、选中节点和完整画布快照。输入框上方显示当前绑定的流程；消息记录可展开查看发送时的快照。「流程上下文」可额外保留点击时的参考快照。切换智能体新建会话；模型和权限选择在下一轮生效。历史记录保存在本机，可重命名和删除显示记录。

本机宿主会把当前已授权的工作空间 ID 传给智能体并显示在聊天底部。MCP 调用应使用该 ID；如果误传其他 ID，逐轮网关会返回正确的当前 ID 供智能体重试。`pipelines.list` 只列出已保存的草稿；编辑器里尚未保存的流程不会出现在列表里。

MCP 与界面节点库共用节点类型、版本、端口、配置与校验。添加节点默认使用目录的标准名称和默认配置，按用户要求修改；通过 MCP 添加不会产生专用节点或自动添加“ＭCP 测试”名称。本地诊断也是节点库里的普通类型，仅用于明确请求的诊断，不替代业务节点。

当前画布只是目标选择的参考，用户消息中的目标和限制优先。已载入的服务端流程可作为默认编辑目标；若用户要求选择已有流程或禁止新建，智能体应从 `pipelines.list` 的已保存记录中选择，不能把浏览器里的示例草稿当作已保存流程。未保存文档仅在允许创建、且请求针对它时创建；有服务端基线的本地修改按版本保存，版本冲突需先协调。成功的 MCP 流程写操作会显示「在画布中查看」，点击后读取最新服务端版本并切回画布。若当前存在本地内容差异，替换前确认并保存独立恢复记录；读取或备份期间的新编辑会阻止旧结果覆盖画布。已载入且无本地修改的流程继续自动同步，新增节点时自动适应画布。隐藏画布的缩放请求会等到可见且尺寸有效时执行。

## 权限与恢复

- **只读**：不提供平台写工具；Cursor/CodeBuddy 切换到其 ACP 只读模式，若未提供只读模式则拒绝运行。其他本机运行时按各自沙箱/工具边界执行。
- **写入前确认**：执行前显示工具参数，由用户单次批准或拒绝。
- 审批卡片中的 **Allow for all／允许本轮全部** 放行当前轮次后续的宿主审批请求；新一轮对话会重新按所选权限模式处理。
- **目录内自动**：允许所选目录内的结构化文件修改。通用 shell 和平台操作仍可能要求确认；不会自动升级平台账号权限或越过工作目录。
- **Full access／完全访问**：本轮使用原生运行时的完整访问模式，不再由本机宿主逐项弹窗。Codex 使用 `danger-full-access`，Claude Code 使用 `bypassPermissions`，Harness 使用 `danger-full-access` 预设；Cursor/CodeBuddy 仍以各自 CLI 实际提供的 ACP 能力为准。平台 MCP 继续核对当前账号的 workspace、scope、revision 与幂等条件。
- API Key 用 Windows 当前用户 DPAPI 加密。界面只读取是否配置。Harness 接收短期提供方代理凭据，真实 Key 不传入工具子进程。
- 五种运行时通过逐轮 MCP 网关调用已有平台工具；Cursor/CodeBuddy 的 ACP 优先使用 HTTP MCP，未声明支持时使用 stdio MCP 转接。工具继续执行相同的权限、revision、preflight 和幂等校验。
- Cursor/CodeBuddy 的本机文件和命令还遵循 CLI 自己的权限配置；工作台只处理它们发出的 ACP 审批请求，不能保证 CLI 已自行放行的操作再次弹窗。使用写入模式前检查对应 CLI 的权限设置。
- 事件有递增游标，断线恢复只读取事件。任务提交带 request ID，不自动重试不确定的写入。宿主中断的会话标记为「待核对」，检查本机文件和原生会话后才能继续。
- Codex、Claude Code、Cursor Agent、CodeBuddy Code 保留原生会话；本机 SQLite 保存界面投影。Harness 的执行历史由 Navigator 原有 SQLite persistence 服务负责。删除列表记录不删除原生历史。

WorkBuddy 桌面版与 CodeBuddy Code CLI 是不同入口。其公开的本地助理接口要求在 WorkBuddy 开放平台登记第三方应用、配置 OAuth 回调并取得授权；当前本机助手不能直接复用 WorkBuddy 桌面登录状态。需要单独完成这套授权后才可接入，不能把 CodeBuddy Code 标成 WorkBuddy 已连接。

## 编写节点

在助手设置中选择目标项目目录，然后描述节点的输入、输出和运行环境。文件写入可审阅；测试命令需通过运行时权限边界。生成 manifest 并不代表节点已可执行。节点包仍遵守 `docs/node-builds.md`、`node-packages/README.md`，通过既有构建、目录预览和显式激活路径完成登记；缺少执行 adapter 的节点仍显示不可用。

## 打包

构建 Client 和 Navigator 后：

```powershell
npm run build
npm run package:assistant -- --navigator C:\path\to\Cyrene-Navigator --output C:\path\to\new-package-directory
```

打包器包含固定版本运行时、Python 和 Node。依赖链接在首次启动时重建为包内 junction，避免依赖开发机绝对路径。输出目录必须不存在；不覆盖已有安装。当前产物是便携目录，尚未接入已有 MSIX 发布工作流。

## 验证范围

`tests/e2e/assistant.spec.ts` 验证流式过程中移动窗口、草稿/附件/审批保留、Allow for all、Full access 选项、停止、IME 和多模型配置。Navigator `assistant/test` 验证真实 MCP 网关、实际文件写入前审批、只读拒绝、目录外写入拒绝、本轮全部放行、Full access、批准后执行 PowerShell、请求去重、崩溃恢复、DPAPI、三种 API 协议的固定 Harness 流式响应与历史恢复。

启动便携包后，在开发 checkout 可运行 `node scripts/verify-assistant-package.mjs --origin http://127.0.0.1:5180`，验证同源控制服务、MCP、包内 Python/Harness 与测试 API 的完整链路。它会添加一个测试提供方和测试会话，应对隔离的本机数据目录运行。

协议测试使用确定性本地服务，不消耗真实供应商额度，也不证明个人账号有某个模型的调用权限。原生 CLI 的握手和模型发现与真实云端推理应分别验收。
