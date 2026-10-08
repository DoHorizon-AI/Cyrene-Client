// ┌─────────────────────────────────────────────────────────────────────────┐
// │  📄 copy.ts                                                              │
// │  Module: services/installer                                              │
// │  Role: Bilingual string table for the Installer UI.                      │
// │                                                                          │
// │  中文：模块职责：安装器 UI 的中英文字符串表。                                │
// └─────────────────────────────────────────────────────────────────────────┘
import type { AppLocale } from "../../../src/i18n";

/** Resolve installer copy for the current locale. */
export function installerText(value: string, locale: AppLocale): string {
  if (locale !== "zh-CN") return value;
  return ZH_MAP[value] ?? value;
}

// -- zh-CN overrides --------------------------------------------------------
const ZH_MAP: Record<string, string> = {
  // Navigation
  "Workloads": "工作负载",
  "Individual Components": "独立组件",
  "Installation Plan": "安装计划",
  "Component Management": "组件管理",

  // Workload page
  "Choose what to install": "选择要安装的内容",
  "Select one or more workloads. Components are resolved automatically.":
    "选择一个或多个工作负载，组件将自动解析。",
  "Required": "必需",
  "Recommended": "推荐",
  "Optional": "可选",
  "Selected": "已选",
  "Not selected": "未选",
  "Review installation plan": "查看安装计划",
  "Select at least one workload or component": "请至少选择一个工作负载或组件",

  // Component affinity banner
  "This component is required by the selected workload and cannot be removed.":
    "此组件为所选工作负载的必需项，无法移除。",
  "This component is recommended. Removing it may limit functionality.":
    "此组件为推荐项，移除后部分功能可能受限。",
  "If you remove this component, the following capabilities will be affected:":
    "移除此组件后，以下功能将受影响：",

  // Individual components page
  "Search components…": "搜索组件…",
  "All": "全部",
  "Installed": "已安装",
  "Available": "可用",
  "Not compatible": "不兼容",
  "No components match your search.": "没有匹配的组件。",

  // Installation plan page
  "Review your installation": "确认安装内容",
  "Products to install": "将安装的产品",
  "Plugins to install": "将安装的插件",
  "Dependency components": "依赖组件",
  "Already installed": "已安装",
  "Estimated download size": "预计下载大小",
  "Unknown — size data not yet available": "待确定 — 暂无可靠大小数据",
  "Target platform": "目标平台",
  "Deployment mode": "部署模式",
  "Permissions required": "所需权限",
  "Known limitations": "已知限制",
  "None reported": "无",
  "Install": "开始安装",
  "Back": "返回",
  "This plan was resolved by the Installer API.":
    "此计划由 Installer API 解析。",

  // Status
  "Verified": "已验证",
  "Configured": "已配置",
  "Enabled": "已启用",
  "Running": "运行中",
  "Failed": "失败",
  "Not installed": "未安装",

  // Component management page
  "Manage installed components": "管理已安装组件",
  "Uninstall": "卸载",
  "Update": "更新",
  "Rollback": "回滚",
  "Enable": "启用",
  "Disable": "禁用",
  "Start": "启动",
  "Stop": "停止",
  "This component is in use by:": "此组件正被以下产品使用：",
  "Removal is blocked because this component is actively bound to a running product. Disable the product first.":
    "此组件正被运行中的产品绑定，无法卸载。请先禁用对应产品。",
  "User data will be retained after uninstall.":
    "卸载后用户数据将被保留。",
  "User data will be removed. This cannot be undone.":
    "卸载后用户数据将被永久删除，无法恢复。",
  "User data retention is unknown. Review the component documentation before proceeding.":
    "用户数据保留情况未知，卸载前请查阅组件文档。",
  "Confirm uninstall": "确认卸载",
  "Cancel": "取消",

  // NOT_CONNECTED banner
  "⚠ NOT CONNECTED — this view uses mock data. Install operations are disabled.":
    "⚠ 未连接 — 当前页面使用模拟数据，安装操作已禁用。",

  // Progress steps
  "Select": "选择",
  "Components": "组件",
  "Plan": "计划",
  "Progress": "进度",
  "Done": "完成",

  // Generic
  "Loading…": "加载中…",
  "Try again": "重试",
  "No description available.": "暂无说明。",
  "Installed version": "已安装版本",
  "Available version": "可用版本",
  "Supported platforms": "支持的平台",
  "This platform is not compatible.": "当前平台不兼容。",
};
