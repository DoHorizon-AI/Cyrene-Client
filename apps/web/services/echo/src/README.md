# Echo Client Module / Echo 客户端模块

This module provides the shared-workbench flow for exact-match evaluation: create a suite, select a published Catalyst data-tools package, import reference/actual JSONL, run Echo, inspect coverage and sample evidence, and download the persisted JSON report.

本模块提供共享工作台中的精确匹配评测流程：创建套件、选择 Catalyst 已发布的数据工具包、导入 reference/actual JSONL、运行 Echo、查看覆盖数与样本证据并下载持久化 JSON 报告。

| File | Responsibility |
| --- | --- |
| `api.ts` | Same-origin typed requests for Catalyst/Echo Product routes and report downloads. |
| `EchoWorkbench.tsx` | Evaluation suite, target, input, run, and result controls. |
| `echo.css` | Module-scoped layout and report table styles. |

Read `api.ts` for wire paths, then `EchoWorkbench.tsx` for the user flow.
