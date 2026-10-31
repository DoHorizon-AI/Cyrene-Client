# Studio / MCP / Navigator 审查修复

## 位置与提交

本轮在 `latest-20261007/Cyrene-Client` 和 `Cyrene-Services/Cyrene-Navigator`
的 `fix/navigator-session-integration-20261008` 上实施。旧工作树、安装包和用户数据库保留。
现有整合先保存为 Client `3f25743`、Navigator `aaa64f0` 本地检查点；后续按期和模块单独提交。
阶段修复与验证时没有推送、创建远端 PR 或部署；后续提交与远端同步见下方记录。

| 阶段 | Client 提交 | Navigator 提交 |
| --- | --- | --- |
| P0 权限边界 | `d4308b4` | `6ad8f8c` |
| P1 MCP 工具与恢复 | `8982faa` | `94cac66` |
| P2 会话与编辑状态 | `4529512`，身份与 Cookie 补修 `8e66eda`、`28aa6b3` | — |
| P3 代理策略 | `164a816`、`b872661` | — |
| P3 OpenAPI 与生成类型 | `4d79210`、`30d1f04` | `be3ed26` |
| P3 页面、API、IDE 拆分 | `b7dcab1`、`f66ed87`、`7b4bf2a` | — |
| P3 共用任务流 | `13212da`、`228748e` | — |
| P3 聊天与文案拆分 | `aee4317` | — |
| Windows 与审批契约回归 | — | `d44dc41` |

## 最终行为

- 浏览器不能指定 cwd、预设和超时，不能修改 Work 执行投影或追加执行事件。宿主约束目录 realpath、预设白名单和默认六小时超时。
- Web Host 使用受限 principal；任务签名和 executorOwned 不能被摘掉。权限按操作种类执行，任务授权按同类操作隔离并审计；提供方地址或协议改变时须重填 key。
- MCP 的 44 项工具统一下划线名称，HTTP 命令与标题保留点号。共享权限和效果定义；错误区分 rejected/unknown，带请求 ID 和恢复步骤；同一意图重试沿用原幂等键。活跃运行/构建重复请求返回已有 ID。
- 移除旧单轮模型助手；MCP 面板用于手动调试。节点和画布使用同一目录与图服务。
- 助手、设置与产品页共享 Navigator 会话和 BFF；认证请求串行，旧响应/401 不覆盖新会话。未知或不一致的工作空间不能发送任务、上传或审批。
- 远端同步保留视口与选中，拖拽结束后应用；冲突载入先备份并保留最近 20 份。Catalyst 保护未保存编辑和分页修订；构建终态停止轮询，旧 revision 不回写。
- OpenAPI 与生成类型可离线核对；产品 API、管理页、IDE 和聊天按模块拆分。任务流共用身份与游标保护，主任务回读独立于辅助接口，辅助失败或挂起不阻塞终态。

## 验证与边界

Navigator：完整 CI 指定的 24 个 Node 测试文件共 167 项通过，零失败、零跳过；Python 全量 103 项通过。服务端/客户端 strict TypeScript、OpenAPI 标准校验与导出一致性、CI 范围 Ruff/格式和 Linux mypy 通过。

Node 回归使用隔离 Node 24.13.0，下载自官方并核对 SHASUM；没有修改全局 PATH。Rust host 与 Windows 测试 wrapper 按 CI 构建。平台边界检查用 Git 已跟踪及非忽略文件清单代替慢速目录遍历，运行相同的边界检查规则。

隔离 HTTP/MCP 实测通过：配对、浏览器保留字段 403、Web principal 拒绝投影写与伪造事件、提供方地址变更须 key、44 项工具和 guide、普通算力节点回读修订 2、同键重放及异参冲突。验收数据仅在 `C:/cyrene-integration/assistant-review-runtime-20261009`；没有模型推理、真实 GitHub 构建、Product/GPU 验收或部署。

Client 完整 `npm run check` 退出 0：契约一致性、TypeScript/Vite 构建、304 项单元、73 项界面、5 项控制服务和 4 项安全浏览器测试通过；6 项 PostgreSQL 测试因未配置测试数据库跳过。浏览器使用本机已安装的 Edge。LiteGraph 的 eval 和较大 bundle 提示仍存在，构建成功。

实现与使用说明见 [Navigator 助手整合](navigator-assistant-integration.md)、[MCP 工作台](mcp-workbench.md)。

## 2026-10-09 远端同步

用户本轮要求提交修改并获取远端更新。以 Client `2283551` 为本地修复检查点，先创建
`backup/review-fixes-before-sync-20261009`，再通过普通 `--no-ff` 合并获取到的
`origin/develop@b3c3f96`（较此前 `1ef7af7` 新增 19 个提交）。推送和远端回读由主代理在本次合并提交后完成。

冲突按模块职责处理：保留共享 Cookie/session authority、Navigator 代理权限、工作空间与请求体检查、MCP 契约和已拆分的页面；将远端页面设计搬到 `pages/` 各模块，`pages.tsx` 保持 11 行导出入口。
同时保留 Catalyst 训练数据整理、新设计样式、本机 Product 直连、工作负载计划及独立 Web/Control 发布工具。依赖新增字体与 esbuild，MCP SDK 保持 `1.32.1`；旧模型助手没有恢复。Product 状态栏使用现有共享配对、退出接口。

合并验证中修复了发布工具对 Windows 原始路径、正斜杠路径和 JSON 转义路径的漏检；Windows GNU tar 读回增加 `--force-local`，防止盘符被解释为远端主机，Linux 归档参数不变。链接回归在 Windows 使用经 `lstat` 确认的 junction，仍在归档前拒绝；其他平台保留文件 symlink。更新和工作负载安装命令明确不向 MCP 开放。旧会话栏浏览器定位器随远端状态栏设计调整，保留原认证断言。

最终完整 `npm run check` 退出 0：契约核对、主应用构建、336 项单元、75 项界面、5 项控制服务和 4 项安全浏览器测试通过；6 项 PostgreSQL 测试因没有测试数据库跳过。新增 `build:workspace-web`、Control 的 esbuild 打包与 `node --check` 也通过。另有 8 项定向页面回归通过，包含数据分区切换后保留草稿及部署状态展示。

此次 Windows 检查仅在子进程 PATH 中使用 Git GNU tar 1.35，未修改全局环境。16 个浏览器 worker 曾触发 `net::ERR_NO_BUFFER_SPACE`，导致设计样式资源加载失败；最终用 `STUDIO_E2E_WORKERS=4` 运行全部场景，零重试。该可选参数只接受正整数，不设置时保留原并发设置；`STUDIO_BROWSER_CHANNEL=msedge` 使用本机 Edge。构建中的 LiteGraph eval 和较大 bundle 提示仍存在。

本轮未执行 Linux 安装包发布、真实 Product/GPU/模型任务或部署。用户限定为提交与同步，因此不创建或合并 PR、不清理当前活跃分支和工作树；备份分支及旧工作树保留，方便回滚与后续开发。
