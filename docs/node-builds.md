# 节点镜像构建与显式版本启用

Studio 的构建入口调用 GitHub Actions，控制进程不运行 Docker build，也不持有 Docker socket。构建任务、事件、预览指纹和幂等回执与其他领域一样保存在 SQLite/PostgreSQL。实际执行任务仍由 Product / Platform 负责。

## 操作入口

顶栏为“文件、编辑、视图、构建、运行、工具”。构建菜单提供已保存图的执行计划、构建来源选择入口、镜像预览/提交、任务列表/取消、节点版本预览/启用。运行菜单复用运行面板的预检、启停、恢复、节点变更、执行代次和制品查询。关闭底部面板不取消服务端任务。

`/studio-commands/v1/session` 返回当前凭据可用的工具目录。UI 和远端 stdio MCP 共同使用以下应用服务：

| HTTP 前缀 | 命令 |
| --- | --- |
| `/studio-builds` | `builds.list_profiles / preview / start / list / get / cancel / read_events` |
| `/studio-catalog` | `catalog.list_packages / preview_activation / activate` |
| `/studio-pipelines` | 新增 `pipelines.compile`，其余草稿命令保持兼容 |
| `/studio-runs` | 新增 `runs.attempts / artifacts`，其余运行命令保持兼容 |
| `/studio-control` | 服务器登记、状态、审计及编辑命令也接入 MCP |

各前缀均提供 `GET /v1/session`、`POST /v1/commands`。写命令要求幂等键。所有 workspace 成员可读取构建；editor/admin 可以提交和取消；只有 `catalog.write`（admin）可启用版本。MCP 启动时读取 token 的实际 actor/scopes；服务端每次调用重新鉴权，撤销凭据立即阻断后续操作。

## 配置 GitHub 构建

需要管理员分别配置控制服务允许的来源与受信工作流的构建定义。仓库自带 `ci/build-profiles.json` 初始为空，避免把原型或不存在的训练镜像当作可发布组件。

控制端 `STUDIO_BUILD_PROFILES_FILE` 指向下列数组。这里的仓库必须已经安装 `studio-node-build.yml`、`scripts/node-build.mjs` 及 `ci/build-profiles.json`；工作流需要出现在 GitHub 默认分支，方可通过 workflow_dispatch 触发。建议 `workflowRef` 使用受保护的不可变标签。

```json
[
  {
    "id": "training", "title": "Training node", "workspaceIds": ["local"],
    "owner": "YOUR-ORG", "repository": "YOUR-NODES-REPO",
    "workflow": "studio-node-build.yml", "workflowRef": "studio-build-v1",
    "sourceRefs": ["develop"], "imageRepository": "ghcr.io/your-org/training",
    "packageId": "training"
  }
]
```

工作流 checkout 中的 `ci/build-profiles.json` 是按 profile ID 索引的对象。路径相对源码 checkout，拒绝目录逃逸及指向外部的符号链接。依赖锁文件必须存在，摘要进入结果；Dockerfile 仍需实际使用这些锁文件并固定基础镜像。记录锁文件摘要不等于自动保证任意 Dockerfile 可重现。

```json
{
  "training": {
    "imageRepository": "ghcr.io/your-org/training", "packageId": "training",
    "context": ".", "dockerfile": "images/training/Dockerfile",
    "manifest": "node-packages/training.json", "lockFiles": ["uv.lock"]
  }
}
```

源码清单遵循 `cyrene.studio.nodes.v1`。工作流给包和节点设置由源码 SHA 前缀及 workflow run ID 组成的新版本，并将任务节点镜像替换为实际发布的 `repository@sha256:…`；不修改历史版本。每个构建 profile 对应一个镜像，包内所有非 reference 节点必须使用该镜像。

`STUDIO_GITHUB_TOKEN` 仅供 control 使用，限定到目标仓库，要求 Actions write（触发/取消/读取）和 Contents read（解析 SHA）。工作流发布 GHCR 使用自身 GITHUB_TOKEN 的 packages write 权限，不使用 Studio API token。不要将任何凭据放入 `VITE_*`、图文档、节点清单或仓库。

本地通过 `.env.local` 配置；分容器部署使用可选 `compose.builds.yaml`，传入 `STUDIO_BUILD_PROFILES_FILE` 宿主机文件路径，并通过 `STUDIO_GITHUB_TOKEN_FILE` 提供私有凭据文件：

```powershell
docker compose -f compose.yaml -f compose.builds.yaml up -d studio-control
```

上述配置涉及真实 CI/镜像发布，尚未在公司仓库上执行。本地自动测试不会触发真实 Actions。

## 状态与可信结果

预览固定源码 SHA、工作流 SHA 和 profile 快照；提交前重新解析，变化则返回冲突。queued 意图先落库，协调器将其改为 dispatching 后只派发一次。网络超时或控制进程重启后按原 run ID 或 `studio-build:<buildId>` 关联核对，不再次创建工作流。GitHub 查询不可用时显示 unknown，不伪造失败。

结果必须满足仓库、workflow 路径、事件类型、工作流 SHA、build/profile ID、源码 SHA、workflow run ID、镜像仓库和 package ID 全部匹配。下载只接受命名为 `studio-result-<buildId>` 的唯一未过期制品，验证 GitHub ZIP digest、限制压缩/解压大小，再校验 `build-result.json` 与所有节点契约。签名下载跳转不携带 GitHub Authorization。

取消请求与构建结束可能竞争，以 GitHub 观测为准；取消不删除镜像。成功结果不自动进入节点目录。管理员先预览启用影响，再以目录 revision 和指纹启用；目录或预览变化时拒绝，旧包、旧节点类型和原运行快照继续保留。

构建事件为持久化状态事件；运行中的完整构建输出通过 GitHub 链接查看，当前不代理实时 Actions 日志。未确认的派发、过期制品、私有 registry 权限及工作流 ref 漂移需要运维核对原任务，不能靠换幂等键掩盖未知结果。

协议依据：[GitHub workflow dispatch](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)、[GitHub Actions artifacts](https://docs.github.com/en/rest/actions/artifacts)。当前适配 API 版本为 `2026-03-10`。
