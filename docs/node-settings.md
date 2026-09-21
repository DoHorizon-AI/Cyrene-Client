# 节点设置接入记录

状态：客户端与本地同源代理已实现，隔离测试通过；尚未提供可访问的实际 Web Host，因此真实环境联调未运行。

所有路径均为浏览器调用 Web Host 的路径，Product 本身通常使用 `/api/v1/<resource>`。Web Host 在服务端解析前缀和注入授权，不把 Product 凭据交给浏览器。

| 节点 | 已接路径 | 应用行为 |
| --- | --- | --- |
| 数据集 | GET `/api/v1/catalyst/datasets`；GET `/api/v1/catalyst/dataset-versions/{id}` | 数据集容器只作查询；版本必须 PUBLISHED 且带输出制品才绑定 |
| 模型 | GET `/api/v1/reactor/model-imports` | 仅 READY 且带 modelArtifact 的记录可选，保存业务资源 ID 与制品 URI |
| 算力 | GET `/api/v1/system/status` | 仅显示当前 Web Host 机器的 GPU 状态；不把它当作云资源池或资源租约 |
| 训练 | GET `/api/v1/yield/training-drafts`；GET/PATCH `/api/v1/yield/training-drafts/{id}` | 读草稿；显式写入前重读状态，保留已准备基础模型和未在 UI 暴露的 maxSteps |
| 评估 | GET `/api/v1/echo/evaluation-suites/{id}`；POST `/api/v1/echo/evaluation-suites` | 读 ACTIVE 配置；以幂等键另存配置；相同内容重试复用当前面板内的键 |
| 部署 | GET `/api/v1/reactor/serving-bindings` | 保存所选 servingBindingId 到流水线草稿，不创建 Deployment |
| Agent | GET `/api/v1/navigator/harness/workspaces/{workspaceId}/sessions` | 检查返回 workspaceId，一次仅绑定会话身份；不读写事件或 writer token |

原型依然不调用训练 start、部署 deploy、评估 run 或 Agent 写入接口。同源开发代理只放行表中操作及 Web Host 的 session/pair/refresh/logout；生产接入应把这组边界部署到正式入口，本地 Vite 代理不是生产控制面。

## 已核对的来源

- Catalyst：`Cyrene-Catalyst/src/cyrene_catalyst/api.py`、`domain.py` 和 `contracts/product/v1/openapi.yaml`。
- Reactor：`Cyrene-Reactor/product/src/cyrene_reactor_product/api.py`、`domain.py`。
- Yield：`Cyrene-Yield/training/core/src/cy_exec/training/product_api.py`、`product_models.py`、`product_service.py`。
- Echo：`Cyrene-Echo/src/cyrene_echo/api.py` 和 `contracts/product/v1/openapi.yaml`。
- Navigator：`Cyrene-Navigator/src/cyrene_navigator/web_host.py`、`persistence/api.py`、`persistence/models.py`。

这些来源是本地检出的源码，不能证明某个部署版本相同。运行时仍校验响应格式；不符合预期时保留本地配置并提示错误。

Yield 当前源码比导出的 OpenAPI 多 `loraDropout`。本适配按实现保留该参数，不改动 Yield 源码或其导出的文件。服务仅接受 SFT/LoRA；本地旧草稿可保留 Full 或较大 epochs，但同步前按服务上限（epochs <= 100）拒绝不支持的设置。配置响应新增未知参数时拒绝保存，避免无意删掉服务端参数。

## 持久化与同步语义

`settingsBinding` 是可选字段，只保存资源类别、资源 ID 和必要的 workspace ID。它随节点通过 JSON/本地草稿往返，既有文档不需要绑定字段。服务返回的原始对象、凭据、CSRF token 和会话事件不写入图文档。

选择模型、数据、部署绑定与 Agent 会话，以及编辑普通参数，均只改变本地节点。写服务端设置仅有“保存参数到 Yield”与“另存到 Echo”。训练草稿数据集和基础模型仍归远端草稿；本轮不自动把上游连线改写到远端训练草稿，也不声称图的业务输入已和草稿完全一致。

训练保存前重新获取草稿，STARTED 或已有 TrainingRun 时拒绝修改。现有 PATCH 接口没有乐观并发令牌；跨客户端同时编辑仍可能覆盖，正式多人协作前需扩展服务契约。写操作发生超时或网络错误时不自动重试，界面保留绑定和本地参数；应先重读检查是否已保存。评估创建的幂等键仅在当前节点面板生命周期内复用，刷新前应检查服务端是否已有结果。

请求超时为 10 秒；切换节点或退出连接会取消读取并忽略迟到响应。已发送的写请求不能通过关闭面板撤销。读取遇到 401 可刷新一次，写入不自动重试。配对与 session 授权遵循现有 Web Host，Studio 不直接连接 Product 或云端地址。

## 尚缺接口

- Catalyst 当前公开 API 没有数据版本集合 GET；本轮按明确版本 ID 读取，不编造列表接口。
- Echo 没有评估配置集合 GET 或原地 PATCH；采用按 ID 读取和新建配置。
- 云服务器供应商、云 GPU 目录、配额、实例和分配管理尚未接入；本机 GPU 观测不覆盖这些需求。
- Navigator 目前暴露会话持久化，缺少统一 Agent 模型、工具与策略设置接口；会话绑定不等于 Agent 功能执行已接通。
- 新建训练草稿需要完整 DatasetVersionRef，准备模型需要可移植制品与固定源版本；本轮只同步已有草稿的训练参数。

## 验证

`tests/unit/settings.test.ts` 验证服务投影、参数范围、绑定往返、授权、错误语义、重试范围和代理路径限制。`settings-proxy.test.ts` 启动随机回环端口的测试 HTTP 服务，验证实际转发、cookie/CSRF 保留、执行接口拒绝与不可用状态。

`tests/e2e/settings.spec.ts` 用明确的接口 fixtures 覆盖七类节点、显式写入、配对、服务失败、契约不匹配、迟到请求和未开放入口。该测试不会访问真实 Product，也不会启动任务。真实环境联调仍需 Web Host origin、浏览器配对以及已配置的 Product 入口。
