# Navigator 与统一工作台

Navigator 是 Studio 的只读运行监控工具窗口。默认查看当前工作空间，可切换为当前编辑的流水线；类型分类取自实际节点。已移除但仍在执行的节点保留标识，结束后的旧节点在运行历史中查看。当前未保存编辑只影响浏览器分类，不会改写运行快照或自动保存。

主区域默认是同一组标准标签页：工作台、JSON、Navigator，以及已打开的文件和业务页。拖动任一标签到主区域左/右边缘，看到落点预览后松开即可分栏；拖到另一组标签栏则移入该组，空组自动合并。Esc 或拖到编辑区外取消操作。两组各自保留当前页面，Navigator 可以在任一侧；底部工具窗口横跨两组，右侧节点信息/MCP 工具窗口独立。

中间分隔线支持拖动及方向键调宽（Shift 加大步长），比例随浏览器布局偏好保存；每次打开/刷新默认回到单组标签页，不恢复上一版 editorSplit 固定分栏开关。视图菜单提供当前标签的分栏/合并作为拖拽的替代入口；Navigator 也保留分栏/合并与停靠操作。主编辑区可用宽度小于 645px 时临时改为单组标签页，加宽后恢复本次会话的分组。


右侧 Navigator 可展开为中央标签页，再停靠回右侧；选择、固定查看、筛选、滚动和详情展开状态随同一个组件保留。默认跟随画布选择，可固定监控对象。状态、服务器、事件、重试、产物和配置快照来自真实运行记录；资源引用不冒充容器任务。没有新增 GPU 指标或训练曲线采集。

## 数据与 MCP

`monitoring.snapshot` 在 `/studio-monitoring/v1/commands` 和 MCP 中共用 `packages/monitoring` 的实现。输入为 `workspaceId`、可选 `pipelineId` 和 `history`（默认 false）。必须同时拥有 `pipelines.read`、`runs.read` 及该工作空间权限。

返回 `workspaceId`、`observedAt`、`pipelines` 和 `runs`；节点摘要包含类型、名称、能力分类与简要执行状态，不包含配置和凭据。默认返回所有未终止运行及每条流水线最近一次终止运行，历史模式返回该范围的全部记录。流程、运行分别携带修订信息；聚合不声称两个独立存储处于同一事务快照。

可见总览每 5 秒刷新，切换浏览器标签后暂停，恢复可见时立即核对。选中运行详情与底栏通过 `runs/observation.ts` 共用 SSE 和 `runs.observe`，按身份、工作空间、运行隔离。保留游标、事件去重、单调修订和离线提示；收起窗口不停止外部任务。

## 原有业务页面

工具菜单打开模型、数据集、训练、Product 运行、部署、网关、聊天、服务状态与连接设置。页面按需加载并保留已访问表单，使用受作用域限制的样式与 Studio 的语言上下文。原 `/models`、`/datasets`、`/training`、`/runs`、`/runs/{id}`、`/deployments`、`/gateway`、`/chat`、`/settings` 链接进入相应 Studio 页面；原总览位于 `/overview`，根路径进入流水线工作台。

监控权限及范围来自 Studio；全局管理页面显示 Product 会话允许访问的资源，不把这些资源伪装为当前流程节点。Studio 登录与 Web Host 一次性配对仍是两种会话，没有新增单点登录。Web Host 未连接时仍可使用 Studio 监控。

Product 代理按具体 HTTP 方法/路径执行白名单：`products.read` 读取、`products.write` 编辑、`products.operate` 执行、`products.admin` 管理凭据/网关。viewer/editor/operator/admin 分别获得对应能力；需要“保存并启动”时需同时具备编辑和执行权限。浏览器不能选择任意上游地址。原设置路径保持协议兼容，新业务写入同时检查 Studio CSRF；上游继续执行自己的认证与 CSRF。配对/刷新/退出不要求流程编辑权限。

原始数据准备上传上限 32 MiB，其余代理写入上限 1 MiB。SSE/聊天响应流式转发并随下游断开释放连接。聊天 API Key 通过专用请求头传给代理，再转换成上游 Authorization，不参与 Studio 身份认证。

## 开发与部署

`npm run dev`（以及兼容别名 `dev:services`、`dev:web:navigator`）启动完整控制服务与统一前端。`npm run dev:legacy` 仅保留旧 JSON 草稿/设置桥接，不能提供完整运行监控或业务管理。迁移旧 `.studio/*.json` 前使用 `npm run control:migrate`，不自动覆盖旧数据。

Navigator 不再有独立依赖锁、HTML 入口或构建产物。`npm run build` 生成统一 `dist/`；根测试包含原 Navigator API、路由与语言测试。`build:web:navigator` 是统一构建别名，`check:web:navigator` 只定向运行原模块测试。

Compose 继续使用 `deploy/studio.Dockerfile` 的 web/control 目标与 PostgreSQL。根 Dockerfile 也发布同一前端：需通过 `STUDIO_CONTROL_ORIGIN` 指向控制服务，默认 `http://studio-control:5182`，必须为无路径 HTTP(S) origin；控制服务的 `STUDIO_PUBLIC_ORIGINS` 要包含浏览器访问地址。控制服务另用 `STUDIO_NAVIGATOR_URL` 连接既有 Web Host。根镜像的 `/v1/` 保留原 Exchange 网关兼容路径。

升级原独立 Navigator 部署时，必须先提供 Studio control 并配置以上连接；只替换静态页面不足以完成迁移。保留旧镜像可回退；本轮没有数据库格式迁移，也不修改 Product/Platform 存储。

## 验证

单元测试覆盖工作空间过滤、历史/删除节点、无秘密摘要、MCP 权限、上传字节保留、代理越权拒绝及首条 SSE 提前到达。浏览器测试覆盖动态分类、停靠/展开保留状态、双语、旧链接及未提交表单保留；分栏回归验证原生标签拖拽（左右分栏、跨组移动、空组合并、Esc 取消）、画布实例与草稿/业务表单保留、拖动/键盘调宽、刷新默认单组与比例保留、窄屏降级及中英切换；独立控制服务测试验证停靠/展开/分栏过程中 Navigator 与底栏共享订阅。真实 Product、GPU、训练和部署环境需要另行联调，模拟接口通过不代表业务链路已验收。

分栏只改变本地视图，不修改流水线内容、graphRevision 或 layoutRevision，也不新增 MCP 业务工具。未来可操作的业务功能仍应复用 HTTP/MCP 应用服务；不要把窗口排列偏好混入服务端流程排版协议。
