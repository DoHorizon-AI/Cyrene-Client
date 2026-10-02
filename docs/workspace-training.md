# Training navigation and recovery / 训练导航与恢复

## Local Product connection / 本机 Product 连接

Starting a prepared Yield draft opens `/runs?runId=<accepted-id>`. A repeated explicit start first reads the draft's durable run association. An uncertain start retains its command key and prepared parameters for an explicit retry; page restoration does not submit work.

启动已准备的 Yield 草稿后，页面跳转到 `/runs?runId=<已接受的任务 ID>`。再次明确启动前，客户端先读取草稿持久保存的任务关联。启动结果不确定时，保留原命令键与参数供用户重试；恢复页面不会自动提交任务。

Run observation reads the owner projection and attempts, and reconnects the event stream using `after_sequence` and `Last-Event-ID`. Complete frames advance the cursor; truncated frames do not. The UI retains at most 50 event entries and 200 loss points. Refreshing restores the ID from the URL and replays durable events. Yield's successful terminal state is `COMPLETED`.

任务观察读取所属服务的状态与执行尝试，并以 `after_sequence` 和 `Last-Event-ID` 续读事件。只有完整帧推进游标。页面最多保留 50 条事件与 200 个 loss 点；刷新后从 URL 恢复任务 ID，再读取持久事件。Yield 成功终态为 `COMPLETED`。

Network reconnects never resume training. An explicit checkpoint resume requires a failed/cancelled run and a checkpoint reported by Yield. Run changes and session teardown cancel outstanding reads, retry timers, and streams. Access denial stops retries and clears the observed data.

网络重连不会恢复训练执行。手动从检查点恢复需要失败或取消的任务，以及 Yield 上报的检查点。切换任务或退出会话会取消正在进行的读取、重试计时器与事件流。访问被拒绝后停止重试并清除观察数据。

## Workspace connection / Workspace 连接

With `VITE_WORKSPACE_BFF_ENABLED=true`, Training and Runs use authorized Workspace discovery and the generic v2 BFF invocation endpoint. Select a discovered Workspace, read a prepared Yield draft by ID, and explicitly confirm start. Run bookmarks include `workspaceId` and `runId`; the Workspace must still be authorized when reopening the link.

启用 `VITE_WORKSPACE_BFF_ENABLED=true` 后，Training 和 Runs 使用授权 Workspace 发现和通用 v2 BFF 调用入口。用户选择已发现的 Workspace，按 ID 读取准备好的 Yield 草稿，再明确确认启动。任务书签携带 `workspaceId` 和 `runId`；重新打开时仍需验证 Workspace 授权。

| Operation / 操作 | Usage / 用途 |
| --- | --- |
| `yield/workspaceGetDraft` | Read prepared intent and an existing run association / 读取已准备意向和已有任务关联 |
| `yield/workspaceStartRun` | Explicit start with a stable command key / 使用稳定命令键明确启动 |
| `yield/workspaceGetRun` | Read the scoped run / 读取范围绑定的任务 |
| `yield/workspaceListRunEvents` | Bounded JSON pages with `afterSequence` and `limit` / 使用游标和数量上限读取 JSON 事件页 |
| `yield/workspaceListRunAttempts` | Read scoped attempt diagnostics / 读取范围绑定的尝试诊断 |

The Workspace adapter validates organization, Workspace, run ID, every event/attempt run ID, and ordered cursors. It drains terminal event pages before declaring the stream finished. Private runs use these catalog operations; access failures never switch to a local Product endpoint. The event reader adapts the JSON pages in memory for the shared UI; there is no remote legacy SSE call.

Workspace 适配器验证组织、Workspace、任务 ID、各事件和尝试的任务 ID，以及游标顺序。终态任务也需读完事件页才显示结束。私有任务始终通过这些目录操作读取；访问失败不会切换到本机 Product 接口。事件读取器在内存中转换 JSON 页供统一界面展示，不调用远程旧版 SSE。

## Current boundaries / 当前边界

- Execution uses Platform's operator-approved target binding. A Studio server registration is not a device approval or GPU lease. Dynamic machine selection is not implemented by this UI.
- The remote console starts prepared drafts and observes runs. Parameter editing, cancellation, checkpoint resume, artifact download, and Reactor deployment require further Workspace operations and UI integration.
- New owner contracts and the three read policy grants must be published and activated together before remote observation is usable. Unknown or unapproved operations are rejected.
- Local unit checks and builds do not prove remote GPU execution, real identity issuance, or release provenance. Those require deployed components and separate integration evidence.

中文：

- 执行使用 Platform 运维批准的目标绑定。Studio 服务器登记不等于设备审批或 GPU 租约；当前界面尚未实现动态选机。
- 远程界面可启动已准备的草稿并观察任务。参数编辑、取消、检查点恢复、产物下载和 Reactor 部署仍需后续 Workspace 操作与界面接线。
- 远程观察依赖新版 owner 契约和三条读取授权策略共同发布并激活；未知或未批准操作会被拒绝。
- 本地单元检查和构建不代表远端 GPU 执行、真实身份签发或发布来源证明通过；这些需要部署组件并单独取得集成证据。
