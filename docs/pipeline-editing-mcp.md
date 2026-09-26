# 流水线编辑、排版与本机 MCP

状态：服务端草稿、原子批量编辑、ELK 排版、本地/服务端撤销和 stdio MCP 已实现。没有嵌入聊天模型、远端 MCP HTTP 服务或训练执行协调器。

## 页面使用

1. 启动 Studio，在画布编辑流程。“文件 → 保存草稿”或 Ctrl/Cmd+S 保存浏览器副本；顶部“保存到服务端”写入 `.studio/pipelines.json`。
2. 在“文件”菜单中用“读取流程列表 → 选择流程 → 载入服务端流程”打开已有版本。创建时不覆盖同 ID 的已有流程。
3. 点击顶部“自动排版”整理未锁定节点；“编辑 → 整理选中节点”只移动当前选中的一个节点。MCP 的 `nodeIds` 支持一次指定多个节点。
4. “编辑 → 锁定节点位置”保留位置，解除锁定后可重新整理。排版只改变布局，不修改参数与连线语义。
5. “编辑 → 撤销本地修改”恢复本地前一状态，最多保留 50 步；本地表单逐次输入也会记录。“撤销服务端修改”恢复最新一批服务端修改，要求当前没有本地改动。服务端修订号不会倒退。变更记录在“流程”菜单中。
6. 已打开服务端流程后，每 2.5 秒检查一次版本。画布没有未提交变更且未预演时自动同步；否则保留本地内容并提示有新版本。可先导出 JSON 备份，再载入新版本。

页面不会自动把每次输入提交到服务端。AI 看到的是最后保存的版本。浏览器本地草稿、导入导出和已有节点设置仍可使用。

右侧“平台 MCP”可读取实际的 11 项工具目录、编写任务草稿并复制流程/节点引用。内置聊天模型尚未接入；该面板本身不会调用模型或执行 MCP 编辑。工具窗口布局见 [工作台界面](ide-workbench.md)。

## 连接 AI 客户端

已安装依赖后，本地启动命令为 `npm run mcp`。**客户端配置应直接启动 Node，避免 npm 的脚本标题混入 stdio 协议输出。** 以下是常见 `mcpServers` 配置格式；具体放置位置由所用客户端决定，本轮没有修改任何客户端配置：

```json
{
  "mcpServers": {
    "cyrene-studio": {
      "command": "node",
      "args": [
        "C:/work/Cyrene-Services/Cyrene-Studio/node_modules/tsx/dist/cli.mjs",
        "C:/work/Cyrene-Services/Cyrene-Studio/apps/mcp/main.ts"
      ]
    }
  }
}
```

将示例中的 `C:/work/Cyrene-Services/Cyrene-Studio` 替换为实际克隆目录。MCP 默认使用 Studio 根目录的 `.studio`，与默认 Vite 入口共享文件。若给 Vite 配置了 `STUDIO_CONTROL_DATA_DIR`，MCP 也必须指向同一个绝对目录。

本机 stdio 进程代表启动它的本地用户，工作空间固定为 `local`，写入来源记录为 `local-mcp`；它不接受调用方自报 actor。设置 `STUDIO_MCP_READ_ONLY=1` 可只暴露读取与布局预览工具。默认允许草稿编辑，连接客户端即授予这组本地编辑能力。

使用精确依赖 `@modelcontextprotocol/sdk@1.30.0`。实际安装代码的最高协议版本是 **2025-11-25**；已通过该 SDK 的真实 stdio 握手验证，不宣称兼容 2026-07-28 协议或远端 OAuth。后续升级需单独验证客户端与 SDK 兼容性。[SDK 上游](https://github.com/modelcontextprotocol/typescript-sdk)

连接后可向 AI 提出：

> 读取节点目录和我已保存的流程，增加第二个评估分支，连接训练输出与数据集。校验后整理新增分支，保留锁定节点，并说明修改了什么。不要执行训练。

实际设计质量取决于模型与现有节点能力。目录只包含当前 7 类节点；没有条件门禁、循环、执行型子流程等节点时，AI 应报告缺口。

## 工具与共同应用服务

`packages/pipeline-control` 是 UI/MCP 共同应用服务。HTTP 使用 `/studio-pipelines/v1/session` 与 `/studio-pipelines/v1/commands`，沿用本机同源及 CSRF 边界。MCP 调用相同的 `PipelineControl.execute`。

| 工具 | 行为 |
| --- | --- |
| `nodes.list_types` | 节点、具名端口、默认值和由 Zod 生成的参数 JSON Schema |
| `pipelines.list` / `pipelines.get` | 查询持久化草稿及版本 |
| `pipelines.create` | 创建有独立 ID 的草稿；可提交空文档，再通过 patch 添加节点 |
| `pipelines.save` | 提交 graph 和/或 presentation 域 |
| `pipelines.patch` | 原子批量 add/update/remove node、connect/disconnect、rename |
| `pipelines.layout` | 对服务端文档排版并保存 |
| `pipelines.preview_layout` | 根据传入草稿计算布局，不保存 |
| `pipelines.validate` | 结构校验与拓扑顺序；明确返回 `executable: false` |
| `pipelines.history` | 最近 50 次成功变更的来源、版本及摘要 |
| `pipelines.undo` | 撤销最新一批修改，保留递增版本和历史记录 |

每个写工具要求 `idempotencyKey`。重试必须使用同一键及相同参数；内容变化时使用新键。同一 actor/workspace 下，幂等结果在进程重启后仍可回读。业务错误作为 MCP `isError` 返回，并携带稳定 code；不会伪造成功。

`patch` 按节点/连线 ID 编辑，不使用数组下标。新增节点需要目录中的 `type`/`typeVersion`，可省略位置；系统先给占位位置，再由 layout 整理。参数更新是合并，解除服务绑定使用 `settingsBinding: null`。删除节点会同时删除相关连线和布局。

最终整图一次性校验：非法参数、未知类型、错误端口、重复输入或身份会使整批修改失败。允许保存尚未接完线、空图或带循环的草稿；`validate` 会报告这些问题，当前预演不允许执行有问题的图。

## 版本与并发

恢复草稿会保留已确认服务端文档与 graph/layout 版本；它们与当前未提交图分别保存。重开工作台后的保存仍执行相同的三方合并/冲突检查，不以恢复动作授权覆盖远端。

- `graphRevision` 管理流程名称、节点参数及连线，`layoutRevision` 管理坐标与 pinned。
- `save` 只检查实际提交域的版本，因此来自同一旧版本的参数修改与拖动可以合并。同一域的旧版本提交返回 `REVISION_CONFLICT`。
- `patch` 修改参数或连线时检查 graphRevision；增删节点还检查 layoutRevision。
- 排版依赖节点结构与位置，必须同时检查两个版本，在计算完成、事务写入时再次检查。
- 保存或排版等待期间，用户仍能编辑。排版旧结果不应用；保存回执只合并用户未继续修改的文档域。
- 载入服务端流程或读取导入文件期间发生新编辑时，拒绝应用旧结果，保留文档及撤销历史。工作台卸载后忽略在途操作的回调；已发出的服务端写请求仍可能完成。
- 向 Yield 保存参数时固定节点、资源绑定和参数快照。预读期间若本地编辑或 MCP 同步改变节点，取消本次写入，提示确认后重试；切换流程也会使原节点请求失效。
- 独立控制模式已支持团队账户和独立节点三方合并；同一节点重叠修改仍拒绝，尚未实现 CRDT/离线协同。详见 [分布式控制](distributed-control.md)。

## 排版实现与限制

使用 `elkjs@0.12.0` 的 layered 算法，由服务端计算；前端继续使用 LiteGraph。节点尺寸与画布共享 `pipeline-model/geometry.ts`，包含标题高度；端口声明左右方向和固定顺序。相同输入在当前版本下测试可重复，实际布局坐标写入文档，不依赖每次渲染重算。[ELK.js](https://github.com/kieler/elkjs)

本阶段节点使用目录定义的固定尺寸，禁用未持久化的手动缩放，避免排版尺寸与画布不一致。框选拖动会保留锁定节点原位置。

全图排版只整理未 pinned 节点。局部排版保持范围外所有节点不动，将计算结果作为整体放置并避开固定节点；它不是完整的增量约束求解器，跨区域连线可能较长。当前 UI 选区为单节点，批量范围可通过 MCP 的 `nodeIds` 传入。

本轮保存的是节点坐标。**连线仍由 LiteGraph 绘制，没有采用 ELK 的转折点与避障路由**；不保证零交叉或连线完全避开所有节点。视觉分组、折叠、子图、连线路由与复杂人工约束留待下一阶段。

## 存储、验证与边界

`.studio/pipelines.json` 使用原子文件替换和独占写锁，包含草稿、批量修改前快照及幂等回执；竞争写入返回 STORE_BUSY，不静默覆盖。最多 1000 次持久化写请求，达到上限明确拒绝，历史不自动裁剪。正式部署需要迁移数据库、审计保留与恢复机制；开发期间应备份 `.studio`。

测试覆盖原子回滚、重启后幂等、域级并发、批量撤销、ELK 几何、锁定与局部范围、MCP 内存连接和真实 stdio 进程。浏览器测试使用真实本地 API，覆盖外部写入同步、未保存内容保护、旧布局结果丢弃和刷新回读。尚未用第三方 AI 客户端或真实模型进行自然语言设计验收。

最新自动验证与具体测试数量见 [分布式控制](distributed-control.md)。回归覆盖设置代理编码路径绕过、延迟载入/导入、卸载后的回调，以及 MCP 同步期间的 Yield 写入保护。Product 写接口测试使用模拟响应，不启动真实任务。上游 LiteGraph eval 警告与浏览器包体积提示仍存在。

流水线命令新增 `pipelines.compile`。独立服务模式的 MCP 还暴露按当前 token 权限过滤的服务器、运行、构建与节点版本命令，见 [构建控制](node-builds.md)。旧文件模式仍只管理草稿；Product 设置和云实例购买不经这些工具执行。没有因这些新增入口自动安装 Agent、购买资源或启动训练。
