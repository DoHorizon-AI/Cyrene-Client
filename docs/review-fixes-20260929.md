# 审查问题修复与验证（2026-09-29）

修改位于 `C:/cyrene-integration/studio`，基于 `58b0af8` 及已有未提交改动。未提交、未推送；未改动另一份旧 Studio checkout。

## 已修复

- **API token 管理**：认证上下文携带 browser/api 类型；创建、列出、撤销 API token 均由 TeamControl 拒绝 API 身份，HTTP 层保留 CSRF。API token 不再能够签发后继 token 或撤销同用户的其他凭据。
- **运行协调**：明确拒绝启动的响应使步骤失败并收尾依赖步骤。超时、409、429 等未知结果保留原 attempt，按 5 秒起步、最多 5 分钟退避核对；调度时间持久化。重复 absent 不再增长 revision。停止请求清除原等待时间，失败后仍有退避。在线 change 前先 lookup，change 失败单独退避，终态继续推进下游。
- **构建协调**：422 等明确派发拒绝进入 failed；正常观测间隔 15 秒，未知结果从 30 秒指数退避到 5 分钟。GitHub 限流窗口由适配器共享，尊重 Retry-After/rate-limit reset。查找 workflow run 增加创建时间条件。
- **构建恢复**：新增共享命令及 MCP 工具 `builds.reconcile`，UI 对应“核对 GitHub 任务”。输入原 GitHub run ID、expectedRevision、幂等键；校验任务来源、关联及已完成结果后继续观测。错误身份、无权限、版本冲突均拒绝。不重新派发，也不把“查不到”当成停止证明。
- **旧 MCP 对话隔离**：仅旧 McpPanel 按文档 ID 重建；账号/工作空间仍由外层 key 隔离。切换文档清除旧待确认写操作，迟到响应不能恢复旧对话。原生智能体会话继续保留发送时的目标快照。
- **Markdown 图片**：模型文本中的图片只呈现占位说明，不自动请求 URL。代码复制及正常链接保留。
- **制品引用**：图的 settingsBinding 校验 URI 与 digest 相同；运行预检复查身份及端口 kind。无 binding 的引用只接受完整 `artifact://sha256/<digest>` 或 `sha256:<digest>`，拒绝夹带摘要的任意字符串。
- **撤销历史**：同一流程的远端更新对本地 undo/redo 做保守三方合并；独立修改仍可撤销，冲突处停止合并并另存恢复记录。换文档不会复用旧历史。
- **助手轮询**：运行中 900ms、空闲 10 秒，面板或浏览器标签隐藏时暂停请求；恢复可见立即读取。失败指数退避，相同错误关闭后不会每轮重新弹出。
- **登录及部署**：登录失败按账号计数，不再由代理 IP 将所有账号绑定；另一个账号登录成功不清除原账号的失败次数。Cookie Secure 按请求 Host 对应的 HTTPS 配置决定。local 模式仅允许绑定显式回环地址，错误 STUDIO_MODE 拒绝启动，容器不能因漏配模式而公开 local 控制服务。
- **权限边界**：runs.preflight/start 明确要求 pipelines.read，HTTP/MCP 工具发现同步过滤。catalog.write 定义为实例权限，只授予 bootstrap owner（或由该 owner 显式签发的限权 API token）；工作空间 admin 不再自动获得它。旧团队库将首个 bootstrap 成员迁移为 instanceAdmin，其他成员不提升权限。
- **幂等指纹**：流水线、运行、构建命令使用对象键排序后的 JSON。流水线旧明文指纹可按语义比较；运行/构建旧摘要仍接受原序列化匹配，不清理既有回执。

## 存储缓解及保留边界

流水线库设置 10,000 条回执和 64 MiB 序列化大小上限；超限事务回滚并返回 STORE_LIMIT，已有回执仍能重放。不会删除回执并让旧幂等键重新执行。SSE 连接在进程内共享一次流程元数据读取，各连接仍独立重验权限并过滤工作空间。

这是容量保护，**还没有把 PostgreSQL 单行 JSONB 拆成按文档/回执索引的表**。达到上限需要存储迁移或归档方案。运行、构建及团队历史的全面归档策略也未在本次重构。

没有追加 Full access 二次确认或改变新会话权限偏好；分栏快捷键在现版已验证正常。Navigator 大文件拆分不包含在本次缺陷修复中。

## 验证

- 全量 Vitest：201 项通过，6 项跳过；之后新增迁移回归及改动定向重跑 43 项通过，认证用例再跑 8 项通过。
- TypeScript、Vite 构建通过。仍有 LiteGraph eval 和大 chunk 的既有构建警告。
- UI Playwright：41 项通过，包含模型图片零请求、跨文档待确认操作清理、隐藏轮询、原生会话停靠及流程同步。
- 控制服务 Playwright：5 项通过。构建用例的等待上限调整为 25 秒，以覆盖新的 15 秒外部轮询和 3 秒 UI 刷新；原 15 秒等待曾超时，调整后通过。
- 安全 Playwright：4 项通过。
- 真实 MCP 协议覆盖新增 builds.reconcile 的成功、幂等重放、跨工作空间拒绝、版本冲突；外部 GitHub/Product 响应使用 fixtures，未触发真实构建或训练。

## 本机运行包

两套运行包 `Cyrene-Assistant-Windows`（5180）及 `Cyrene-Assistant-Windows-acp`（5182）的 control.mjs 和 Web 构建已更新并重启。更新前确认没有运行中的助手会话，现有 control.sqlite 通过新 schema 校验。

备份：`C:/cyrene-integration/review-fix-20260929/backup`，包含两套旧 control/Web 文件和控制 SQLite 在线备份。会话、用户流水线及助手配置未清理。

更新后两个端口均登录正常、助手正常，真实 MCP tools/list 返回 44 项工具且包含 builds.reconcile，pipelines.list 可读；Web HTML 与新构建一致。Chrome 打开现版助手无 pageerror。页面验证图位于 `C:/cyrene-integration/review-fix-20260929/workbench.png`。
