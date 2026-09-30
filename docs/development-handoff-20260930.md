# 其他设备继续开发（2026-09-30）

当前代码横跨两个仓库，均使用 `feat/local-ai-assistant-20260930` 分支：

- Client：<https://github.com/DoHorizon-AI/Cyrene-Client/tree/feat/local-ai-assistant-20260930>
- Navigator：<https://github.com/DoHorizon-AI/Cyrene-Navigator/tree/feat/local-ai-assistant-20260930>

这是当前已验证开发现场的独立分支：Client 基于 `58b0af8`，Navigator 基于 `7d8c1e7`。它不包含后来远端整合分支的 5 个提交和 Navigator develop 的 12 个提交；后续整合时要保留双方的 UI、宿主和权限修复。原整合分支及 develop 未被覆盖。

## 获取源码

在准备放置仓库的父目录执行；已有 checkout 请先保存自己的修改，再 fetch/switch，不要覆盖它：

```powershell
git clone --branch feat/local-ai-assistant-20260930 https://github.com/DoHorizon-AI/Cyrene-Client.git
git clone --branch feat/local-ai-assistant-20260930 https://github.com/DoHorizon-AI/Cyrene-Navigator.git
```

## 开发启动

需要 Node.js 24+。先安装并构建本机助手宿主：

```powershell
Set-Location Cyrene-Navigator
npm --prefix assistant ci
npm --prefix assistant run build
npm --prefix assistant test
Set-Location ../Cyrene-Client
npm ci
$env:CYRENE_NAVIGATOR_DIR = (Resolve-Path ../Cyrene-Navigator).Path
npm run assistant
```

Codex、Claude Code、Cursor Agent、CodeBuddy Code 需要在新设备安装对应 CLI 并登录。工作台读取该设备的本机配置；仓库不包含账号、API key、会话库或运行包。

Cyrene API 模式还需要固定 Harness 与 Python 依赖。在 Navigator 根目录按 `harness/upstream.lock.json` 安装指定 pnpm（当前 pin 为 11.7.0），Windows 的 `PNPM_HOME` 和原生模块构建环境需满足 `scripts/prepare-harness.mjs`：

```powershell
uv sync --frozen
node scripts/prepare-harness.mjs --install --build --link
node assistant/node_modules/typescript/bin/tsc -p harness/tsconfig.json
```

固定上游为 `dsh-v0.1.3-alpha.1` / `d347e703908d0406b7a7ef80e3a0e594d86b2215`。Windows 曾遇 pnpm/fs-ext 的构建环境问题；不能通过改上游源码或跳过 pin 校验来规避。完整能力、打包和权限说明见 [local-assistant.md](local-assistant.md) 和 Navigator 的 `assistant/README.md`。

## 本轮状态

助手右栏/主编辑区、原生智能体、API Harness、同目录业务节点 MCP 编辑，以及本轮审查修复已包含。修复详情和验证边界见 [review-fixes-20260929.md](review-fixes-20260929.md)。数据库分表、完整归档策略、WorkBuddy 桌面 OAuth 接入仍未实现。

本机运行包的更新和历史验证不等于新设备已安装依赖或远端 CI 已通过。API key 使用 Windows 当前用户 DPAPI，应在新设备重新配置，不能直接搬运加密字段。

## 开发 skill

OneDrive 根目录的 `Cyrene-Development-Skills-20260930.zip` 包含 `cyrene-studio-development`、`cyrene-plugin-development`、安装说明和对应源码提交清单。将两个 skill 目录放入新设备的 `~/.codex/skills/`；如有同名 skill，先备份再合并。skill 中的旧机器绝对路径是历史证据，新设备应重新定位 checkout。
