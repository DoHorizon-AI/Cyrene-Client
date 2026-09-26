# 分布式控制服务：实现与部署

本轮将 Studio 从 Vite 内嵌控制接口扩展为独立应用服务。目标是按任务执行尝试分配独立容器，由 Studio 协调跨服务器流水线，Product 拥有业务任务，Platform 拥有 Node、Runtime、Lease 和 Fence。资源引用节点不启动容器。控制层和 Yield/Echo 私有提供方契约已经落地；Product supervisor、跨机制品平面与真实服务器仍需生产装配，不能将本地契约测试描述为真实 GPU 验收。

## 当前实现

| 领域 | 实现及边界 |
| --- | --- |
| 独立控制进程 | `apps/control` 提供草稿、服务器登记、账号、目录、运行 API；Vite 和 Nginx 均可转发到此进程 |
| 持久化 | 团队 PostgreSQL，单机开发 SQLite；原子事务保存聚合状态、版本、历史和幂等回执。不是高可用部署或无限容量存储 |
| 团队身份 | 管理员初始化及创建成员，viewer/editor/operator/admin；浏览器 HttpOnly 会话和 CSRF；24 小时、限定权限的 MCP API 凭据 |
| 草稿恢复 | IndexedDB 按成员、工作空间、页面实例保存未提交图、撤销历史、选择、视图及已确认服务端文档/双版本基线；恢复后的提交仍检查并发修改，兼容无基线的旧记录 |
| 协作 | 独立节点编辑可三方合并；相同节点/相关连线冲突拒绝覆盖；SSE 提示加轮询；服务端撤销仅撤销当前操作者且保留他人独立编辑 |
| 节点包 | 服务端加载声明式 JSON 清单，显式 reload，版本不可覆盖；退役类型不再出现在新增目录，历史版本可继续读取；未知 v2 节点保留端口、配置和布局并禁止执行 |
| 运行协调 | 固定图版本和镜像摘要；执行意图先落库再派发；按 attempt ID 查询、重试、终态确认；下游只消费已确认制品引用 |
| 运行监控 | 同一持久化快照读取状态和增量事件；SSE 断线续读，浏览器离线提示及轮询补偿；MCP 和运行菜单共用 `runs.observe` |
| 服务器身份 | `servers.resolve` 核对登记 revision、在线 NodeRef/epoch；预检固定候选身份，派发前重核。需要受信 observer 注入，不凭登记生成在线状态 |
| 运行变更 | 预览后应用；区分期望/实际配置；仅声明支持的字段走在线调整；其余创建保留旧结果的新分支；恢复要求确认旧执行已经终止 |
| MCP | stdio 可作为远端控制客户端；图命令和运行命令复用 UI 服务、认证、版本与幂等检查。未增加远端 HTTP MCP transport |
| 分容器部署 | Nginx 静态 UI、Studio control、PostgreSQL 分开，支持仅替换控制容器或前端 |

代码中的执行适配器指向 `/api/v1/studio-execution` 私有契约，当前 Yield/Echo checkout 均已实现并进行 bearer、workspace、绑定、目标代次、不可变镜像和制品元数据校验。Yield 将 Studio attempt 持久映射到训练 task；Echo 先调用受信模型推理输入准备器，再异步创建评估 run。不配置适配器时 Studio 预检返回 `ADAPTER_UNAVAILABLE`；Yield 未绑定真实 Kernel executor、Echo 未配置推理准备器时各自拒绝预检。服务器登记仍不等于在线观测或资源租约。

## 本地开发与数据迁移

需要 Node 24+。`npm run dev` 保留原文件存储模式；`npm run dev:services` 启动独立 control 与 Vite。后者读取 `.env.local`，默认 UI 5180、control 5280；独立 `npm run control` 默认 5182。端口冲突应选择新端口或正常停止已知进程。

从旧模式迁移：停止旧 Vite 和旧文件模式 MCP 的写入，备份 `.studio`，执行 `npm run control:migrate`，再启动 `npm run dev:services`。迁移器校验两个 JSON 源文件，复制到 `.studio/backups/migration-<id>`，一个事务导入 pipelines/servers，原文件保留。目标已有不同内容时拒绝导入；相同内容可重复执行。源文件损坏时保留原状并报错。

设置 `STUDIO_DATABASE_URL` 可将迁移目标改为 PostgreSQL；无此变量时写 `.studio/control.sqlite`。迁移不合并旧模式和新模式的后续修改，不能交替运行并期望两者自动同步。

## 团队 Compose

在受控主机上创建未跟踪的 `.env`，设置 `STUDIO_DB_PASSWORD` 和 `STUDIO_PUBLIC_ORIGINS`。当前数据库 URL 直接拼接密码，使用足够长的十六进制随机密码，避免 URI 特殊字符。默认只发布 `127.0.0.1:5180`；对外访问须在已有 HTTPS 网关之后配置真实 origin，不将 local mode 暴露到网络。

```powershell
docker compose build
docker compose up -d postgres
# 临时设置 STUDIO_ADMIN_USER / STUDIO_ADMIN_PASSWORD 到当前终端环境。
# 不把管理员密码提交到仓库，也不将其永久加入 compose 配置。
docker compose run --rm -e STUDIO_ADMIN_USER -e STUDIO_ADMIN_PASSWORD studio-control node --import tsx apps/control/main.ts --bootstrap-admin
docker compose up -d studio-control studio-web
```

bootstrap 仅允许空团队创建首个管理员，已有团队不会被覆盖。首次登录后通过右下角“账号”创建成员。团队模式入口强制要求 PostgreSQL。团队账号当前用于受控团队，尚无 SSO、成员禁用管理界面、密码重置流程或审计导出。

```powershell
# 只更新 UI
docker compose up -d --build --no-deps studio-web
# 只更新控制服务，保留数据库卷
docker compose up -d --build --no-deps studio-control
# 前端开发挂载；控制面和数据库保持独立
docker compose -f compose.yaml -f compose.dev.yaml up -d --build
```

执行凭据推荐通过 `compose.executions.yaml` 挂载。设置两个 Product origin 与两个主机 token 文件路径后，用 `docker compose -f compose.yaml -f compose.executions.yaml up -d` 启动。control 容器只读取 `/run/secrets/*`；`TOKEN` 与 `TOKEN_FILE` 互斥，URL 与凭据必须成对配置。Product 端应使用相同的工作空间专用凭据，不复用用户会话、云厂商或 GitHub token。

数据库备份按 PostgreSQL 运维方式执行；不要用 `down -v` 更新服务。一个 Studio control 实例负责协调；增加多个副本前必须加入协调器领导权/租约。事务行锁不等于调度领导权。当前存储将每个领域聚合为 JSON 行，历史和事件未分表分页归档，大规模运行前需迁移。

## MCP 与目录

stdio 客户端启动 `node --import tsx apps/mcp/main.ts`，设置 `STUDIO_CONTROL_URL` 和 `STUDIO_API_TOKEN`。团队 token 在“账号”创建；本机独立模式使用服务端专用 `STUDIO_LOCAL_API_TOKEN` 作为客户端 `STUDIO_API_TOKEN`。浏览器 CSRF token 不能代替 API 凭据。远端要求 HTTPS；实际身份由服务器 token 校验产生，请求体不能指定 actor。

未设置控制 URL 时 MCP 仍使用旧 JSON 文件模式，并向 stderr 提示；它不会读取 SQLite/PostgreSQL。`STUDIO_MCP_READ_ONLY=1` 隐藏写工具。远端 MCP 启动时读取 token 的实际身份/权限，按 scope 暴露工具；服务器仍逐请求鉴权。

节点清单契约见 `packages/node-registry/contracts.ts`。现有 `STUDIO_NODE_PACKAGES_DIR` 与管理员 `POST /studio-catalog/v1/reload` 保留兼容。新增 GitHub Actions 构建、结果验证、目录预览/显式启用以及对应顶栏和 MCP，见 [节点镜像构建](node-builds.md)。浏览器约 3 秒刷新已验证目录；不加载任意 JS 页面插件。

## Product 执行契约与权威边界

消费者契约见 `packages/run-control/contracts.ts`、`adapter.ts`、`http-adapter.ts`。提供方需实现：

| 路径 | 行为 |
| --- | --- |
| POST `/api/v1/studio-execution/preflight` | 验证 workspace/node/placement，返回固定镜像摘要、契约版本、在线字段、checkpoint 与 safeRetry 能力 |
| POST `/api/v1/studio-execution/attempts` | 按 attemptId 和请求指纹幂等接收；创建 Product task/attempt 与对应独立容器 |
| GET `/api/v1/studio-execution/attempts/{id}?workspaceId=…` | 返回权威状态与关联身份；仅在确实不存在已接收任务时返回 authoritative absent |
| POST `/api/v1/studio-execution/attempts/{id}/stop` | 持久化停止意图，重复请求同键；只有执行端确认终止/围栏生效后才能给出终态 |
| POST `/api/v1/studio-execution/attempts/{id}/change` | 只应用已宣告可变字段，同键幂等；回传实际配置与生效 step |

凭据只由服务端配置；节点和 AI 输入不能选择远端 URL、Docker socket、shell 命令。提供方必须校验 workspace 归属、不可变镜像、generation 和输入制品摘要。`terminalAuthority` 不是“看到容器离线”的别名；网络断开/超时不能授权第二份执行。

`safeRetry` 必须表示 Product 内部业务重试已经结束且旧实例已被确认终止；Studio 默认最多追加 2 次尝试，分别等待 10/20 秒，退避时间随运行持久化。图中 compute 的绑定、规格和数量会传入有效 placement，显式运行配置优先；提供方必须验证并落实这些约束。当前没有真实调度/容量观测、自动跨服务器选择、训练引擎在线 callback 或制品传输服务，不能只返回能力布尔值来宣称支持。

## 运行观测、恢复和目标身份

`runs.observe` 接收 `workspaceId/runId/after/limit`，返回 `{run, items, cursor}`，三者来自同一次数据库读取。SSE 路径为 `/studio-runs/v1/stream?workspaceId=...&runId=...&after=0`；重连优先读取 `Last-Event-ID`。事件持久化，游标只推进到实际返回的事件；超过该运行历史的游标会被拒绝。每批重新认证，权限撤销时关闭连接；慢客户端关闭后按最后收到的游标重连。MCP 使用相同只读命令，不向 stdio 注入 SSE。顶栏“运行 → 核对运行状态与事件”和底栏共用状态，断网期间保留最近观测，恢复连接不重复添加日志。

恢复记录保存已确认的服务端完整文档和 graph/layout 版本，而非把未保存草稿当作基线。重新打开后的独立节点修改仍可三方合并，同节点重叠修改拒绝覆盖。导入文件清除原基线；旧恢复记录无基线时保持显式提示，不猜测远端版本。

指定服务器或资源池时，`RegisteredPlacementResolver` 在当前工作空间核对登记、归档状态、观测新鲜度与 Node 身份；预检指纹包含解析出的 `targets`，启动快照保存它们。执行适配器的 preflight/assignment 同时收到 `placement` 与 `targets`，提供方仍须重新校验 Node 代次并取得 Kernel Lease，不能把它们当成资源授权。派发前遇到确认的身份变化会终止未启动步骤；暂时无法观测则保留原意图等待核对，不另选机器。没有服务器约束时由执行提供方选择资源；不提供 Studio 自动调度。装配入口为 `ControlOptions.serverObservers`，当前 main 未配置真实观察提供方。

上游权威失败且重试结束后，未派发的依赖步骤标记为停止，全部收尾后运行进入 failed，可显式恢复。未派发步骤不依赖 adapter 存在即可停止；停止请求到达时的在途查询不能再启动新实例。已有实例仍等待执行权威确认。资源引用（包括 compute）配置改变必须重新预检启动新运行，不能沿用旧运行中的目标身份。

## Platform 对应改动

Platform 的 `cy-execution-control` 增加 `ExecutionSessionStore`、`FileExecutionSessionStore` 和 `ExecutionControlService::with_session_store`。独占的私有目录保存重连凭据、Node epoch、Runtime grant、已确认 assignment correlation，以及按 accepted assignment 校验的不可变 Runtime 终态；原子替换并同步文件。恢复不复活连接，Host/Runtime 仍须重新认证，Lease/Fence 权威仍在 Kernel。

此选项需要实际服务装配方在 clone/serve 之前显式启用；尚无本轮提供的生产装配入口。Runtime Agent 已增加任务接收及终态日志：启动前记录任务指纹和 attempt，终态携带 assignment/attempt 并在回报前落盘；控制服务在 ACK/广播前再持久化同一事实，冲突重放会被拒绝，Product supervisor 可通过 durable lookup/wait 读取。原代次重启只重放已确认结果，结果不明时保持待核对，禁止重复执行或伪报停止。它仍不接管崩溃遗留进程，也不自动从训练 checkpoint 继续。旧安装只有 resume token 而无执行日志时拒绝复用，须核对旧执行并使用新代次。

Platform 现已提供 supervisor 停止闭环：`ExecutionController::stop` 只向接受该 assignment 的已认证 Runtime 代次发送带 command ID 的 `StopCommand`，Host Agent 控制会话暂时离线时仍可直接停止在线 Runtime。`StopAck` 只解释为“已接受停止”，而不是“任务已结束”。调用方随后必须等待持久化终态，完成 Product 结果和 Artifact 处理，最后才能释放 Kernel Lease。终态先到或终态后的重复停止返回 `AlreadyTerminal`；既无确认也无终态时保持待核对，不能启动第二份任务。

新增 `prepare_runtime_workload` 与 `dispatch_with_launcher`：在 Runtime 尚未启动时准备一次性身份，取得并记录 Kernel Lease 后调用 RuntimeLauncher，再等待原 Runtime 认证并使用同一 Lease 派发。启动未知结果保留原意图并拒绝重复 Acquire。`reconcile_with_launcher` 只接受与原意图完全一致的请求摘要、Node、Lease/Fence 和未过期代次，观察或恢复原实例后向同一 Runtime 重发原 assignment；它不调用 AcquireLease，也不选择替代 Node。该路径已通过真实 Kernel UDS/mTLS Linux 集成测试。

`DockerRuntimeLauncher` 已实现容器启动边界：管理员配置固定镜像摘要、Node/Runtime 代次及资源到 GPU UUID 的映射；创建/启动前保存意图，通过确定名称和指纹核对原容器。重开启动器复用原容器，删除、退出、身份不符或结果不明确时要求核对，不自动重建/重启。Runtime 使用只读凭据文件、非 root 用户、资源限制与独立持久卷；凭据不进入 Docker 参数或启动器日志。Runtime 基础镜像已在本机构建，真实 Docker 去重验收通过。该组件仍需由 Product supervisor 装配，不是完整训练提供方；详情见 Platform `docs/architecture/runtime-launch-order.md`。

## 剩余实施与验收门槛

1. Platform/Product：将已有 Docker 启动器、业务任务镜像和 Runtime Agent 装配到提供方 supervisor，并决定存活进程接管或 checkpoint 恢复策略。未知启动的原实例核对、同一 Lease 恢复、接收记录、终态 tombstone 和重启防重复已落地；生产装配仍须复用 Kernel 资源权威。
2. Yield：Studio 提供方、Product task/attempt 持久映射、响应丢失对账和完整模型制品元数据已实现。生产环境仍需让它使用按 attempt 创建的训练容器、可验证 checkpoint 和训练引擎支持的在线参数回执；现有 KernelTrainingExecutor 不能冒充已经容器化。
3. Echo：Studio 提供方、异步 attempt、响应丢失对账和强制模型推理准备器已实现；准备器缺失时关闭失败。当前 worker 在 Product 进程内运行，生产环境仍需独立评估容器，以及 Reactor/Artifact Plane 提供的真实模型加载与 actual 数据生成服务。
4. Artifact Plane：跨机上传/下载、摘要验证、权限、容器销毁后仍可读取的 checkpoint/模型/评估产物。
5. Studio：真实 observer/Node/Lease 提供方装配、在场成员、账号生命周期、容量及审计归档治理。运行 SSE、恢复基线、登记身份解析与派发前重核、目录 UI/MCP、算力意向投影和有限退避已完成；尚未连接真实目标服务器。
6. 两台自管 Linux GPU 服务器上的训练→评估验收，包括控制面重启、断网、旧实例围栏、在线变更/分支、浏览器恢复、MCP 与人工并发编辑。需要实际服务器连接引用、可用 GPU 和允许使用的数据/模型；本机测试不能替代这一项。

## 已执行验证

2026-09-26 本阶段收口：Yield 142 项通过、2 项 Windows 条件跳过，Ruff 与 57 个源文件全量 mypy 通过；Echo 70 项通过，Ruff 与 13 个源文件 mypy 通过；Studio 114 项单元测试通过、1 项条件跳过，TypeScript/Vite build、29 项 Chrome 浏览器 E2E 与 3 项独立控制 E2E 通过。重新构建 control/web 镜像后，真实 Nginx/control/PostgreSQL 容器替换验收通过。构建发现 `fflate 0.8.2` 的畸形 ZIP64 无限循环公告，已固定到 0.8.3；新 control 镜像中的完整 `npm ci` 报告 0 个漏洞，生产依赖 audit 也为 0。Platform Windows 1.96.1 library check/严格 Clippy 通过，Linux 容器执行 60 项 Rust 测试通过，其中新的未知启动恢复 TCK 确认只取得一个 Kernel Lease。测试未使用 GPU、真实模型推理或两台服务器。

2026-09-26 后续 Runtime 恢复开发：Platform 60 项测试、格式检查及严格 Clippy 通过；额外以真实 Agent 可执行程序重跑 mTLS/Kernel UDS TCK，通过进程退出后重新认证、原终态重放、新代次执行及资源释放验证。新增覆盖中断启动意图、持久化失败不启动、损坏/软链接/宽权限状态拒绝、配置变化拒绝和断线等待期间 Lease 到期终止。本阶段未修改 Studio 应用代码，以下 Studio 测试为前一阶段结果。尚无真实 GPU 训练或远端合并。

2026-09-26 终态与停止交付补强：Platform 使用仓库锁定的 Rust 1.96.1 在 Linux 容器中通过 66 项 scoped 测试，另 1 项真实 Docker opt-in 保持跳过；格式检查与 execution-control/runtime-agent 全目标严格 Clippy 通过，Windows execution-control library check 通过。新增测试覆盖 assignment/attempt 关联、持久化 round-trip、同事实重放、冲突拒绝、无广播的持久 wait、终态后 ID 不可重用、错误会话 StopAck 隔离、Host 离线时直达 Runtime 的停止路由，以及真实 mTLS/Kernel UDS 长任务停止、优雅终态查询、重复停止幂等和 Lease 释放。仍未装配 Product 输出 Artifact 发布，不能把容器终止直接映射为训练或评估成功。

2026-09-26 前一阶段：新增运行终态收尾、停止并发、Node 身份变化、SSE 游标/鉴权撤销、恢复基线回归。本地单元/集成测试 112 项全量通过（含独立 PostgreSQL），TypeScript/Vite build 通过，29 项原有浏览器 E2E 与 3 项团队服务 E2E 通过。首次全量运行发现团队用例假设数据库只有一个流程，已改为验证其创建的流程并重跑该套件通过。当时的 Product 执行测试使用显式适配器；本阶段新增的 Yield/Echo 提供方证据见上一段。两阶段均未执行真实 GPU 训练，也未合入远端更名/架构改动。

2026-09-24 构建控制开发后的验证：100 项 Studio 单元测试（含真实 PostgreSQL、SQLite 构建重启和受信构建脚本）、TypeScript/Vite build；浏览器回归包含 27 项原有 E2E 和 2 项独立团队服务 E2E。构建浏览器测试模拟 GitHub 结果，没有发布镜像。先前独立容器替换检查验证了 Nginx 登录、保存草稿、重建 control 后继续使用原会话和幂等键；这次没有重新部署公司服务。

```powershell
docker build -f deploy/studio.Dockerfile --target control -t cyrene-studio:control-development .
docker build -f deploy/studio.Dockerfile --target web -t cyrene-studio:web-development .
npm run test:containers
```

仓库根 `Dockerfile` 保留 Azure Container Apps 的 Navigator Web Host（80 端口及 Product 直连路由）；独立流水线工作台使用 `deploy/studio.Dockerfile` 的 `control`（5182）和 `web`（8080）目标。Compose 已指向后者。两个前端各有自己的依赖锁，Navigator 检查运行 `npm --prefix apps/web/services/navigator ci` 和 `npm run check:web:navigator`；流水线工作台根 TypeScript 构建不包含 Navigator 项目。

Platform 在 Linux Docker 内使用仓库指定 Rust 1.96.1，`cargo test -p cy-execution-control -p cy-runtime-agent --locked` 的 53 项测试通过，包含真实 Kernel UDS/mTLS TCK；格式检查和严格 Clippy 通过。另显式执行 1 项默认忽略的真实 Docker 测试，验证启动器重开后容器 ID/启动时间不变、删除后不重建。真实 Runtime 基础镜像已本地构建，但容器测试使用测试 Lease 和不可达控制端点，未认证派发训练、使用 GPU 或发布镜像。这些证据不能替代双机工作流验收。LiteGraph eval 和前端 bundle 大小警告仍存在。未提交、未推送、未验证远端 CI 或部署到公司环境。
