# Navigator assistant integration

Client renders the Work task surface and forwards requests through the existing Navigator host. Navigator and its DSH executor remain the only execution authority; Client does not create an agent process or choose a provider for a task.

## Supported boundary

- Durable task, approval, input, memory, attachment, connector, and notification records use the workspace-scoped Work API.
- Task list, creation, cancellation, and event replay use the Harness executor transport implemented at the pinned Navigator commit. The Client's task-create body is limited to `prompt` and optional `taskId`, `sessionId`, and `stream` fields. A task ID is kept stable when the Client retries the same request.
- The Control proxy rejects per-request runtime/provider selection, `cwd`, `agentPreset`, `timeoutMs`, `executionClass`, `metadata`, and unknown task fields before forwarding.
- The Client reads `workspaceId` from `/api/v1/system/status`. Task creation, approval, input, memory, attachment, and connector mutations stay disabled until that identity matches the selected workspace.
- Runtime and provider selection remain host-managed. The pinned Navigator source does not publish the assistant capability/provider endpoints used by an older Client branch, so Client makes no requests to those paths. The settings panel explains this boundary.

## Contract provenance

`contracts/navigator/source.json` pins the canonical Navigator `work.openapi.json` source to an exact `develop` commit. The generator reads that Git object with `git show`, and `npm run contracts:navigator:check` verifies the committed snapshot digest and generated Work types without requiring a Navigator checkout.

The pinned Navigator commit does not publish `executor.openapi.json`. Executor request and event types are handwritten from the pinned Harness source files; they are not labeled as generated OpenAPI.

## Verification limits

Unit tests and browser fixtures verify the Client's allowlists, task request shape, workspace identity guard, and disabled provider controls. They do not prove a live Navigator host, DSH session, or provider runtime.

---
<!-- Chinese Translation / 中文翻译 -->

# Navigator 助手整合

Client 展示 Work 任务界面，并通过现有 Navigator 宿主转发请求。Navigator 和 DSH executor 仍是唯一执行权威；Client 不会启动 agent 进程，也不会为单个任务选择 provider。

## 支持边界

- 持久任务、审批、输入、记忆、附件、连接器和通知记录使用按 workspace 限定的 Work API。
- 任务列表、创建、取消和事件重放使用固定 Navigator 提交中实现的 Harness executor 传输接口。Client 创建任务的请求体仅允许 `prompt` 及可选的 `taskId`、`sessionId`、`stream`。Client 重试同一请求时保持相同任务 ID。
- Control 代理在转发前拒绝逐请求运行时/provider 选择、`cwd`、`agentPreset`、`timeoutMs`、`executionClass`、`metadata` 和未知任务字段。
- Client 从 `/api/v1/system/status` 读取 `workspaceId`。只有该身份与所选 workspace 一致后，才会启用任务创建、审批、输入、记忆、附件和连接器写入。
- 运行时与 provider 选择由宿主管理。当前固定的 Navigator 源码没有发布旧 Client 分支所调用的助手能力/provider 接口，因此 Client 不会请求这些路径；设置面板会说明此边界。

## 契约来源

`contracts/navigator/source.json` 将 canonical Navigator `work.openapi.json` 固定到精确的 `develop` 提交。生成器通过 `git show` 读取该 Git 对象，`npm run contracts:navigator:check` 会校验提交的快照摘要和生成类型，无需 Navigator 工作区。

固定的 Navigator 提交没有发布 `executor.openapi.json`。executor 请求和事件类型由 Client 根据同一固定提交中的 Harness 源码手工声明，不会标记为生成的 OpenAPI。

## 验证范围

单元测试和浏览器 fixture 验证 Client 路由白名单、任务请求形状、workspace 身份保护和禁用的 provider 控件；这些检查不能证明 live Navigator host、DSH 会话或 provider runtime 已验收。
