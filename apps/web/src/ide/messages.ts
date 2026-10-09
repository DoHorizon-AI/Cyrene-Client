import { useI18n, type AppLocale } from "../i18n";

const messages = {
  mainMenu: { "zh-CN": "主菜单", "en-US": "Main menu" },
  accountSecurity: { "zh-CN": "账号与安全", "en-US": "Account & security" },
  unsplitEditor: { "zh-CN": "合并编辑区", "en-US": "Unsplit editor" },
  splitEditor: { "zh-CN": "左右分栏", "en-US": "Split editor right" },
  navigatorMonitoring: { "zh-CN": "Navigator 运行监控", "en-US": "Navigator monitoring" },
  dockNavigator: { "zh-CN": "停靠 Navigator", "en-US": "Dock Navigator" },
  expandNavigator: { "zh-CN": "展开 Navigator", "en-US": "Expand Navigator" },
  mcpLocalTests: { "zh-CN": "MCP 调试与本地测试", "en-US": "MCP debugging and local tests" },
  openMonitoring: { "zh-CN": "打开运行监控", "en-US": "Open monitoring" },
  runHistory: { "zh-CN": "运行历史", "en-US": "Run history" },
  mcpTools: { "zh-CN": "MCP 工具调试", "en-US": "MCP assistant and tools" },
  updates: { "zh-CN": "更新", "en-US": "Updates" },
  openingPage: { "zh-CN": "正在打开页面…", "en-US": "Opening page…" },
  navigatorRunMonitoring: { "zh-CN": "Navigator · 运行监控", "en-US": "Navigator · Run monitoring" },
} satisfies Record<string, Record<AppLocale, string>>;

export function useIdeMessages() {
  const { locale } = useI18n();
  return (key: keyof typeof messages) => messages[key][locale];
}
