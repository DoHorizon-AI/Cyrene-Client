import type { ReactNode } from "react";
import { Menu, type LeftTool, type RightTool } from "./Chrome";
import { useIdeMessages } from "./messages";
import { useI18n } from "../i18n";
import { productPages } from "../products/navigation";
import type { RouteId } from "../../services/navigator/src/router";
import type { Recovery } from "../pipelines/recovery";

export type BottomTab = "checks" | "preview" | "log" | "runs" | "builds";

interface Props {
  running: boolean;
  savedDraft: boolean;
  controls: { file: ReactNode; edit: ReactNode; history: ReactNode };
  recoveries: Recovery[];
  file: { save(): void; restore(): void; importJson(): void; exportJson(): void; recover(id: string): void };
  editor: { split: boolean; toggleSplit(): void; resetLayout(): void; showSource(): void };
  windows: {
    monitorExpanded: boolean;
    openMonitor(history?: boolean): void;
    toggleMonitor(): void;
    openAssistant(): void;
    openMcpTools(): void;
    left(tool: LeftTool): void;
    right(tool: RightTool): void;
    showBottom(tab: BottomTab): void;
    toggleBottom(): void;
    openProduct(route: RouteId): void;
  };
  execution: { validate(): void; loadExample(): void; preview(): void; compileAction: ReactNode; runMenu: ReactNode; buildMenu: ReactNode };
  updates: ReactNode;
  updateReminderCount: number;
}

export function MenuBar({ running, savedDraft, controls, recoveries, file, editor, windows, execution, updates, updateReminderCount }: Props) {
  const { locale, t } = useI18n(), message = useIdeMessages();
  return <nav className="ide-menubar" aria-label={message("mainMenu")}>
    <Menu label={t("文件")}>
      <button aria-label={t("保存草稿")} disabled={running} onClick={file.save}>{t("保存草稿")} <kbd>Ctrl S</kbd></button>
      <button disabled={!savedDraft || running} onClick={file.restore}>{t("载入草稿")}</button>
      <button disabled={running} onClick={file.importJson}>{t("导入 JSON")}</button>
      <button disabled={running} onClick={file.exportJson}>{t("导出 JSON")}</button>
      <hr />{controls.file}<hr />
      <details>
        <summary>{t("恢复未保存编辑")}</summary>
        {recoveries.length ? recoveries.slice(0, 20).map(record => <button key={record.id} disabled={running} onClick={() => file.recover(record.id)}>
          {record.document.name} · {new Date(record.savedAt).toLocaleString(locale)}
        </button>) : <span>{t("暂无恢复记录")}</span>}
      </details>
    </Menu>
    <Menu label={t("编辑")}>{controls.edit}</Menu>
    <Menu label={t("视图")}>
      <button onClick={editor.toggleSplit}>{message(editor.split ? "unsplitEditor" : "splitEditor")}</button>
      <button onClick={() => windows.openMonitor()}>{message("navigatorMonitoring")}</button>
      <button onClick={windows.toggleMonitor}>{message(windows.monitorExpanded ? "dockNavigator" : "expandNavigator")}</button>
      <button onClick={() => windows.left("files")}>{t("项目文件")} <kbd>Alt 1</kbd></button>
      <button onClick={() => windows.left("nodes")}>{t("节点库")} <kbd>Alt 2</kbd></button>
      <button onClick={() => windows.left("servers")}>{t("服务器管理")} <kbd>Alt 3</kbd></button>
      <hr />
      <button onClick={() => windows.right("info")}>{t("节点信息")}</button>
      <button onClick={() => windows.right("plugins")}>{t("页面插件")}</button>
      <button onClick={windows.openAssistant}>AI Assistant</button>
      <button onClick={() => windows.showBottom("builds")}>{t("构建输出")}</button>
      <button onClick={() => windows.showBottom("runs")}>{t("运行详情与日志")}</button>
      <button onClick={windows.toggleBottom}>{t("切换底部工具窗口")} <kbd>Alt 9</kbd></button>
      <hr />
      <button onClick={editor.resetLayout}>{t("恢复默认布局")}</button>
    </Menu>
    <Menu label={t("构建")}>
      <button disabled={running} onClick={execution.validate}>{t("校验流程")}</button>
      <button onClick={() => windows.showBottom("builds")}>{t("节点镜像与版本管理")}</button>
      <div onClick={() => windows.showBottom("runs")}>{execution.compileAction}</div>
      <div onClick={() => windows.showBottom("builds")}>{execution.buildMenu}</div>
      <hr />
      <button disabled={running} onClick={execution.loadExample}>{t("训练示例")}</button>
      {controls.history}
    </Menu>
    <Menu label={t("运行")}>
      <button onClick={windows.openMcpTools}>{message("mcpLocalTests")}</button>
      <button onClick={() => windows.openMonitor()}>{message("openMonitoring")}</button>
      <button onClick={() => windows.openMonitor(true)}>{message("runHistory")}</button>
      <hr />
      <button onClick={() => windows.showBottom("runs")}>{t("执行服务器与运行列表")}</button>
      <div onClick={() => windows.showBottom("runs")}>{execution.runMenu}</div>
      <hr />
      <button disabled={running} onClick={execution.preview}>{t("本地预演")}</button>
    </Menu>
    <Menu label={t("工具")}>
      {productPages.map(page => <button key={page.id} onClick={() => windows.openProduct(page.id)}>{locale === "zh-CN" ? page.zh : page.en}</button>)}
      <hr />
      <button onClick={() => windows.showBottom("builds")}>{t("节点包管理")}</button>
      <button onClick={() => windows.left("servers")}>{t("服务器注册与连接诊断")}</button>
      <button onClick={() => windows.showBottom("log")}>{t("事件日志")}</button>
      <button onClick={editor.showSource}>{t("查看流程 JSON")}</button>
      <button onClick={windows.openMcpTools}>{message("mcpTools")}</button>
    </Menu>
    {updates && <Menu label={`${message("updates")}${updateReminderCount ? ` (${updateReminderCount})` : ""}`}>{updates}</Menu>}
  </nav>;
}
