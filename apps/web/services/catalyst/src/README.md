# Catalyst UI module / Catalyst 界面模块

This module supplies the Catalyst document review and dual-package workflow embedded in the existing Navigator Datasets page. Product lifecycle state stays on Catalyst; the UI calls it through Navigator's authenticated same-origin bridge.

本模块为既有 Navigator 数据集页面提供 Catalyst 文档审核和双制品准备流程。Product 生命周期状态保留在 Catalyst；界面通过 Navigator 已认证的同源桥接访问服务。

| File | Responsibility |
| --- | --- |
| `api.ts` | Typed HTTP routes, raw binary source uploads, export downloads, and user-facing error mapping. |
| `CatalystDataToolsPanel.tsx` | Source/run/revision review, policy exclusion, recipes, version publishing, and explicit downloads. |
| `catalyst.css` | Scoped responsive styling for the workbench surface. |
| `copy.ts` | Short module-local Chinese labels for the most common actions and states. |
| `api.test.ts` | Route, binary upload, policy, and visible error contract checks. |

Suggested reading order: `api.ts` → `CatalystDataToolsPanel.tsx` → `copy.ts` → `api.test.ts` → `catalyst.css`.

建议阅读顺序：`api.ts` → `CatalystDataToolsPanel.tsx` → `copy.ts` → `api.test.ts` → `catalyst.css`。
