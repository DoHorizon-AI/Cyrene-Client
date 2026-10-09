# Cyrene Installer UI / Cyrene 安装器模块

## 概述 (Overview)

Cyrene 模块化安装与组件管理 UI，遵循 DoHorizon 设计系统规范（深色基底、珊瑚粉到兰花紫品牌地平线渐变、空心菱形步骤指示器与细线分层）。交互参考 Visual Studio Installer，但在视觉风格、组件结构和交互语言上与 Cyrene Client/Studio 保持高度统一。

## 架构与设计准则 (Architecture & Design Rules)

1. **零硬编码依赖解析**：UI 不实现第二套依赖解析器。组件的 Required / Recommended / Optional 状态、依赖树及冲突检查完全由后端 Installer API / Workload Resolver 统一计算。
2. **非阻断式警告提示**：当用户取消勾选 Recommended 能力时，UI 不禁止操作，而是清晰展示会受到影响的工作负载或功能。
3. **真实数据与诚实显示**：在后端未提供可信下载大小时显示「待确定」，不伪造数据量或版本信息。
4. **NOT_CONNECTED 边界**：在后端真实 API 尚未接通前，前端组件明确标注 `NOT_CONNECTED` 状态，安装操作按钮保持安全禁用，防止向用户呈现无法执行的伪功能。
5. **生命周期与运维管理**：预留日常组件管理界面，涵盖 `available`、`verified`、`installed`、`configured`、`enabled`、`running`、`failed` 7 种状态；卸载对话框严格说明用户数据保留策略。

---

## 模块结构 (Module Structure)

```text
apps/web/services/installer/
├── README.md                           # 本说明文档与接口对接指南
└── src/
    ├── contracts.ts                    # Installer API / Resolver 契约定义与 Mock 目录
    ├── copy.ts                         # 中英双语文本字典
    ├── installer.css                   # 作用域样式（基于 --dh-* 设计 Tokens）
    ├── InstallerWorkloadsPanel.tsx     # 工作负载与独立组件选择面板
    ├── InstallerPlanPanel.tsx          # 安装计划预览面板（平台、架构、组件、原因与大小）
    ├── InstallerManagementPanel.tsx    # 组件管理与生命周期控制面板
    ├── InstallerPage.tsx               # 安装器主入口与流程引导外壳
    └── installer.test.ts               # 契约完整性与纯选择解析逻辑单元测试
```

---

## 接口对接指南 (API Integration Contract)

在后端 Resolver 和 Package Runtime 开发完成后，将 `contracts.ts` 中的 Mock 数据替换为真实 API 调用：

### 1. 获取工作负载目录 (Get Workloads Catalog)
- **Endpoint**: `GET /api/installer/v1/workloads`
- **Response**: `WorkloadCatalog`
```ts
interface WorkloadCatalog {
  workloads: Array<{
    id: string;
    name: string;
    nameCn?: string;
    description: string;
    descriptionCn?: string;
    components: Array<{
      componentId: string;
      affinity: "required" | "recommended" | "optional";
    }>;
  }>;
}
```

### 2. 获取组件目录 (Get Component Catalog)
- **Endpoint**: `GET /api/installer/v1/components`
- **Response**: `ComponentCatalog`
```ts
interface ComponentCatalog {
  generation: number;
  components: InstallerComponent[];
  fetchedAt: string;
}
```

### 3. 生成安装计划 (Resolve Installation Plan)
- **Endpoint**: `POST /api/installer/v1/plans`
- **Request Body**:
```json
{
  "workloadIds": ["catalyst"],
  "componentIds": ["cyrene.tools.document-parsing", "cyrene.tools.dataset-preparation"],
  "excludedRecommendedIds": ["cyrene.tools.knowledge-preparation"]
}
```
- **Response**: `InstallationPlan`
```ts
interface InstallationPlan {
  planId: string;
  workloadIds: string[];
  additionalComponentIds: string[];
  components: Array<{
    componentId: string;
    affinity: "required" | "recommended" | "optional";
    reason: string;
    downloadBytes: number | null;
    version: string | null;
  }>;
  totalDownloadBytes: number | null;
  targetPlatform: { os: string; architecture: string; distribution?: string };
  deploymentMode: string;
  permissionsRequired: string[];
  knownLimitations: string[];
  alreadyInstalledComponentIds: string[];
  resolvedAt: string;
}
```

### 4. 执行操作与状态流 (Execute Operations)
- **Endpoint**: `POST /api/installer/v1/operations`
- **Stream**: `GET /api/installer/v1/operations/{operationId}/stream` (SSE)

---

## 未接通功能清单 (Unconnected Features Checklist)

| 功能项 | 当前状态 | 依赖接通方 | 说明 |
| :--- | :--- | :--- | :--- |
| **真实 Workload Resolver** | `NOT_CONNECTED` | Platform / Package Runtime | 依赖后端提供 `POST /api/installer/v1/plans` |
| **实时组件包下载与解包** | `NOT_CONNECTED` | Package Runtime / Daemon | 当前处于安全禁用，避免虚假安装触发 |
| **运行时进度 SSE 推送** | `NOT_CONNECTED` | Operation Event Stream | 安装进度界面展示连接占位与协议契约说明 |
| **组件真实启停与热重载** | `NOT_CONNECTED` | Cyrene Process Supervisor | 依赖端点进程管理守护服务 |
| **组件真实卸载与数据清理** | `NOT_CONNECTED` | Storage & Package Manager | 卸载确认对话框已实现，待对接后端数据清理钩子 |
| **Yield / Reactor 安装流** | `RESERVED` | 未来产品发布迭代 | 架构与模型已预留，第一版暂不开放安装入口 |

---

## 验证与测试命令 (Verification Commands)

- **单元测试**: `npx vitest run apps/web/services/installer/src` (18 项全部通过)
- **类型检查与构建**: `npm run build` (`tsc --noEmit && vite build` 0 错误)
- **端到端 E2E 测试**: `LD_LIBRARY_PATH=/home/baijin/.local/libs/usr/lib/x86_64-linux-gnu npx playwright test tests/e2e/installer.spec.ts` (4 项全部通过并保存截图)
