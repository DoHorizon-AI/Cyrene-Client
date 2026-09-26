# ADR 0002：服务器管理与 MCP 接入边界

状态：本地原型已实现登记控制层；远端连接、执行与 MCP 传输适配待实现。

后续进展：流水线应用服务及本机 stdio MCP 已落地，见 [流水线编辑与 MCP](../pipeline-editing-mcp.md)。下文保留服务器登记阶段的决策；服务器/云操作尚未迁入 MCP。

## 目标与决策

中期目标是让平台接入的 AI 能读写流水线、启动和监控任务，并操作授权范围内的自管服务器、容器和云算力。页面与 AI 应调用同一套应用服务，使用相同的资源身份、契约校验、权限、幂等和操作记录。

本轮先落地服务器登记与算力目标引用。`packages/server-control` 不依赖 React、LiteGraph、Vite 或 MCP SDK；页面通过本地 HTTP 适配器调用它。以后增加 MCP transport 时复用应用服务，不让模型模拟点击页面，也不把业务逻辑写入 `tools/call` handler。

目标结构：

```text
Client Web UI ── HTTP adapter ─┐
                             ├─ Application services ─ Product adapters
AI clients ── MCP adapter ───┘       │                   Catalyst/Yield/...
                                    ├─ Registry / revisions / events
                                    ├─ Platform control adapter
                                    │     └─ Node/Runtime agents ─ Kernel
                                    └─ Cloud provider adapters
```

其中 MCP adapter、Platform control adapter 与云提供方适配器尚未实现。当前唯一可执行的服务器命令是登记管理与读取连接状态；未配置观测适配器时状态明确为 `UNCONNECTED`。

## 目标端组件：复用现有 Agent

核对本地 Platform 源码后，已有两种可复用组件：

| 接入方式 | 已有组件 | 责任 |
| --- | --- | --- |
| HOST_AGENT | `Cyrene-Platform/agents/node/cy-node-agent` | 主动建立 mTLS control stream，将类型化 KernelCommand 转交本机 Kernel UDS；不接受任意 shell/argv |
| CONTAINER_AGENT | `Cyrene-Platform/agents/runtime/cy-runtime-agent` | 容器内无特权运行、主动连接、验证 Runtime generation 与 Lease/Fence，监督预配置 workload |
| PROVIDER_MANAGED | 后续云提供方适配器 | 调用提供方 API，映射账户/区域/实例；不能声称实例已加入 Platform 或已取得 GPU 租约 |

依据：Platform 的上述 README，以及 `contracts/proto/cyrene/core/v1/node_control.proto` 和 `docs/governance/API_NAMING_CONSTITUTION.md`。这是对本地实现的核对，不是目标机器部署验证。

现阶段不另造具有资源所有权、进程监管或远程命令执行权的 Agent。若实际网络环境需要额外组件，应实现窄边界 relay/enrollment gateway：负责连接、身份映射和受控转发，不重复 Platform 的 Lease/Fence 与进程控制。具体是否增加 relay，要用第一台目标机器的网络拓扑验证。

## 仓库职责

- Client：流水线产品、服务器登记投影、UI/API、跨 Product 应用服务，以及后续 MCP 入口。
- Platform：节点身份、硬件事实、资源租约、Fence、进程生命周期及既有 Agent。
- 独立云适配器：提供方凭据引用、实例生命周期、配额与价格投影；使用窄接口连接控制服务。
- 各 Product：继续拥有训练、评估、部署等业务任务。工作流步骤只引用它们的任务身份。

本轮所有文件仍在 Client；没有修改 Platform、其他 Product、Workspace 或 IDE 配置。正式扩展时可以将控制服务与 MCP adapter 放在 Client 的 `apps/control` 和 `apps/mcp`，共用 `packages/`；只有需要独立发布与权限边界时才拆仓库。

## 已实现契约

`packages/server-control/contracts.ts` 定义输入/输出 Zod schema、稳定命令名、读写属性及 scope。`ServerControl.execute(request, actor)` 是页面和未来 MCP 的共同调用入口。

| 命令 | 当前行为 |
| --- | --- |
| `servers.list` | 查询指定工作空间的服务器登记（包含归档记录） |
| `servers.register` | 创建登记与稳定 registration ID |
| `servers.update` | 使用 `expectedRevision` 更新登记 |
| `servers.archive` | 归档登记；不关机、不释放租约、不删除云实例 |
| `servers.status` | 通过预配置 observer 读取状态；缺失适配器时明确未连接 |
| `servers.events` | 按 cursor 读取已完成登记写操作的记录 |

写命令必须携带 `idempotencyKey`。同一 actor/workspace 下相同 key 和内容返回原结果；不同内容拒绝。权限检查先于幂等回放。`requestId` 用于关联事件，不能充当授权。

`actor` 由可信传输层提供，包含身份、工作空间和 scope；浏览器/模型不能在请求体中自报管理员身份。当前本机 HTTP adapter 固定为单用户 `local-user` / `local`，它**不是**正式多租户认证系统。

登记只记录 name、attachment、provider、region、connectionRef。连接标识由未来控制服务解析；它不是 URL，也不是凭据。原始云令牌、SSH 私钥、mTLS key 不进入图文档、登记响应或模型上下文。浏览器中的本地控制 token 只保留在内存。

登记 ID 与 Platform NodeRef 分离。NodeRef 由可信观测端返回，epoch 使用十进制字符串避免 JavaScript 大整数精度丢失。ONLINE 观测若缺少身份或超过 60 秒，降为 STALE 并清空可用观测能力；错误身份不应用。

算力节点的 `settingsBinding.kind = server-registration` 只记录 registration ID 和 workspace ID。它表示选择意向，不能证明服务器在线、GPU 规格匹配、已有租约或云实例可用。未来执行计划必须重新解析身份与 revision，再由 Platform 获取 Lease/Fence。

## 当前存储与传输

`tooling/server-control.ts` 提供开发/preview 用的 `/studio-control/v1/session` 和 `/studio-control/v1/commands`。限定回环 Host、同源 Origin、内存 CSRF token、请求大小，并且只接受已登记命令。API 不接受任意目标地址或远程 shell。

登记写入 `.studio/server-registry.json`，不是 localStorage。原子替换文件，独占写锁防止并发进程互相覆盖；记录和幂等结果一并保存。损坏的文件不自动清空。每库最多 10,000 个成功写事件，达到上限明确拒绝；无自动裁剪幂等历史。

开发进程异常终止可能留下 `.lock`。只有确认无进程正在写入并备份登记文件后，才能手工清理该锁；服务不会猜测旧锁并强行抢占。原子文件替换不等于断电恢复、数据库 HA 或生产审计。正式控制服务需要事务数据库、审计保留策略和恢复测试。当前仅记录成功登记写入；认证失败、读操作及外部调用审计是后续工作。

`STUDIO_CONTROL_DATA_DIR` 进程环境变量可以覆盖本地目录。E2E 自动设置独立 `.studio/e2e-<pid>`；不会污染日常登记库。静态 `dist/` 自身没有这些服务，生产部署需要独立控制服务。

## 后续 MCP 映射与实施顺序

按 [MCP Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) 与 [MCP Resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources) 的边界设计：可调用操作映射为 tools，流程版本、运行状态与监控快照映射为 resources。正式适配时从同一契约生成 inputSchema/outputSchema；tool annotations 是客户端提示，权限和业务检查仍由服务端执行。本轮没有宣称完成 MCP 协议兼容。

1. **第一台真实机器**：部署/连接既有 Platform Agent，确认其 mTLS 身份、NodeRef epoch、心跳和断线行为；实现 `ServerObserver` 的真实 adapter。浏览器不直连 Agent。
2. **流水线应用服务**：将草稿持久化、版本修订、节点编辑、结构检查与计划生成移出 React 状态；AI 与页面共用 revision 检查。既有 Product 设置客户端也逐步迁入服务端应用服务。
3. **任务与云操作**：使用 Product 的任务 ID，明确提交/查询/取消/恢复的边界。长任务保存操作 ID、幂等结果和事件 cursor，支持断连后查询；超时不能自动判定失败再重复购买实例或启动训练。计费、销毁与停止动作由 scope 和策略控制。
4. **MCP adapter**：先开放查询、流程编辑、校验和执行计划，再开放已验收的写能力。协议版本与 SDK 版本在实现时核验；远端授权按 MCP 的正式 HTTP authorization 方案接入，不复用本机开发 token。
5. **双入口验收**：UI 与 MCP 对同一命令得到一致状态、权限拒绝、revision 冲突和幂等回放；测试跨会话取消、断网恢复、节点 epoch 变化与过期租约。

尚未实现的命令不会出现在当前可调用命令集合。未来新增服务器重启、实例销毁、租约申请、流水线 start/cancel 时，应通过实际 adapter 和恢复测试后逐项开放。

## 本轮证据

单元/HTTP 集成测试验证登记持久化、跨服务实例幂等回放、revision 冲突、工作空间隔离、拒绝秘密字段/任意命令、身份与观测过期处理、损坏文件保留和写锁。

浏览器测试实际调用本地控制 API，完成新增、修改、状态查询、算力节点绑定、刷新后回读与归档。没有部署目标端 Agent、访问云厂商或验证真实多节点管理。
