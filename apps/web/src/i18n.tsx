import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type AppLocale = "zh-CN" | "en-US";

export const LOCALE_STORAGE_KEY = "cyrene.client.locale.v1";

const english: Record<string, string> = {
  "文件": "File",
  "编辑": "Edit",
  "视图": "View",
  "构建": "Build",
  "运行": "Run",
  "工具": "Tools",
  "语言": "Language",
  "简体中文": "简体中文",
  "英语": "English",
  "项目文件": "Project Files",
  "节点库": "Node Library",
  "服务器管理": "Server Management",
  "节点信息": "Node Information",
  "节点配置": "Node Configuration",
  "请选择节点": "Select a Node",
  "节点名称": "Node Name",
  "请选择": "Select",
  "删除此节点": "Delete This Node",
  "选择画布节点，编辑它的参数。": "Select a canvas node to edit its parameters.",
  "也可通过下方列表定位。": "You can also locate it in the list below.",
  "流程中的节点": "Pipeline Nodes",
  "右侧工具栏": "Right Tool Bar",
  "平台 MCP 助手": "Platform MCP Assistant",
  "问题": "Problems",
  "日志": "Logs",
  "正在本地预演": "Local preview running",
  "远端任务监控尚未接入": "Remote task monitoring is not connected",
  "编辑恢复状态": "Edit Recovery Status",
  "Web Host 已连接": "Web Host Connected",
  "Web Host 未连接": "Web Host Disconnected",
  "导入流程文件": "Import Pipeline File",
  "登录团队工作空间": "Sign in to the team workspace",
  "用户名": "Username",
  "团队用户名": "Team Username",
  "密码": "Password",
  "团队密码": "Team Password",
  "登录": "Sign In",
  "重新连接": "Reconnect",
  "账号": "Account",
  "团队账号": "Team Account",
  "工作空间": "Workspace",
  "创建 MCP 凭据（24 小时）": "Create MCP Credential (24 hours)",
  "仅此处显示，请存入客户端环境变量": "Shown only here; store it in the client environment variable",
  "添加成员": "Add Member",
  "新成员用户名": "New Member Username",
  "新成员初始密码": "New Member Initial Password",
  "新成员权限": "New Member Role",
  "查看": "View",
  "执行控制": "Execution Control",
  "管理": "Admin",
  "添加": "Add",
  "退出登录": "Sign Out",
  "打开文件": "Open File",
  "打开文件夹": "Open Folder",
  "选择本地文件": "Select Local Files",
  "选择本地文件夹": "Select Local Folder",
  "筛选本地文件": "Filter Local Files",
  "查找文件…": "Find files…",
  "工作区草稿": "Workspace Draft",
  "本地文件": "Local Files",
  "未打开": "Not Opened",
  "选择文件或文件夹后在这里浏览。文件仅在当前浏览器会话中读取。": "Choose files or a folder to browse here. Files are read only in this browser session.",
  "将该 JSON 作为流水线导入": "Import this JSON as a pipeline",
  "导入流程": "Import Pipeline",
  "一起构建下一步": "Build the Next Step Together",
  "把想法变成可编辑的流水线。": "Turn an idea into an editable pipeline.",
  "MCP 编辑工具已提供": "MCP Editing Tools Available",
  "内置对话模型尚未配置。先将当前流程保存到服务端，再将任务复制到已连接 Client MCP 的 AI 客户端。没有本地冲突时，画布会同步服务端修改。": "The built-in chat model is not configured. Save the current pipeline to the server, then copy the task to an AI client connected to Client MCP. The canvas syncs server changes when there are no local conflicts.",
  "读取中…": "Loading…",
  "查看可用工具": "View Available Tools",
  "读取": "Read",
  "任务草稿": "Task Draft",
  "例如：添加第二组训练参数对比，保留现有节点位置…": "For example: add a second training configuration for comparison and keep existing node positions…",
  "附带流程与节点引用": "Includes Pipeline and Node References",
  "复制任务与上下文 ↗": "Copy Task and Context ↗",
  "当前面板不会发送模型请求或执行训练。": "This panel does not send model requests or execute training.",
  "内置页面": "Built-in Pages",
  "流程 JSON": "Pipeline JSON",
  "查看当前文档与节点布局": "View the current document and node layout",
  "查看端口、参数与依赖问题": "View port, parameter, and dependency issues",
  "页面扩展": "Page Extensions",
  "这里预留评估报告、训练曲线等页面入口。第三方页面插件加载尚未接入。": "This area reserves entries for evaluation reports, training curves, and similar pages. Third-party page plugin loading is not connected yet.",
  "数据与模型": "Data and Models",
  "资源": "Resources",
  "训练与评估": "Training and Evaluation",
  "发布与 Agent": "Serving and Agents",
  "数据集版本": "Dataset Version",
  "基础模型": "Base Model",
  "算力配置": "Compute Configuration",
  "模型微调": "Model Fine-tuning",
  "质量评估": "Quality Evaluation",
  "推理部署": "Inference Deployment",
  "Agent 测试": "Agent Test",
  "从 Catalyst 读取已发布数据版本，或在本地填写数据集引用。": "Read a published dataset version from Catalyst or enter a local dataset reference.",
  "可选择 Reactor 已导入的基础模型。读取模型设置不会下载模型。": "Select a base model imported by Reactor. Reading model settings does not download the model.",
  "声明目标算力并查看 Web Host 本机 GPU；云算力分配尚未接入。": "Declare target compute and inspect Web Host GPUs. Cloud compute allocation is not connected yet.",
  "编辑微调参数，可读取并保存 Yield 草稿；训练仍由 Yield 管理。": "Edit fine-tuning parameters and read or save a Yield draft. Yield still owns training.",
  "读取 Echo 评估配置或另存新配置；流程预演不计算真实指标。": "Read an Echo evaluation configuration or save a new one. Pipeline preview does not calculate live metrics.",
  "声明部署依赖；真正的评估门禁、发布审批和部署需在服务端接入。": "Declare deployment dependencies. Evaluation gates, release approval, and deployment require server integration.",
  "定义面向模型端点的 Agent 测试目标；不调用工具或发送消息。": "Define an Agent test target for a model endpoint without invoking tools or sending messages.",
  "数据集": "Dataset",
  "数据集版本引用": "Dataset Version Reference",
  "模型": "Model",
  "模型版本引用": "Model Version Reference",
  "目标环境": "Target Environment",
  "加速卡规格": "Accelerator Type",
  "加速卡数量": "Accelerator Count",
  "本地资源池": "Local Resource Pool",
  "云算力平台": "Cloud Compute Platform",
  "自管服务器": "Self-managed Server",
  "训练数据": "Training Data",
  "训练算力": "Training Compute",
  "模型版本": "Model Version",
  "训练方式": "Training Method",
  "训练轮数": "Epochs",
  "学习率": "Learning Rate",
  "单卡批次大小": "Per-device Batch Size",
  "梯度累积步数": "Gradient Accumulation Steps",
  "最大序列长度": "Maximum Sequence Length",
  "训练模板": "Training Template",
  "待评估模型": "Model to Evaluate",
  "评估数据": "Evaluation Data",
  "评估结果": "Evaluation Result",
  "评估集名称": "Evaluation Suite Name",
  "评估器": "Evaluator",
  "预期答案字段": "Expected Answer Field",
  "实际答案字段": "Actual Answer Field",
  "通过阈值": "Pass Threshold",
  "Judge 配置 ID（LLM 评估必填）": "Judge Profile ID (required for LLM evaluation)",
  "部署算力": "Deployment Compute",
  "推理端点": "Inference Endpoint",
  "部署名称": "Deployment Name",
  "推理服务绑定": "Serving Binding",
  "模型端点": "Model Endpoint",
  "测试报告": "Test Report",
  "测试任务": "Test Task",
  "节点服务设置": "Node Service Settings",
  "服务端设置": "Server Settings",
  "未连接": "Disconnected",
  "可请求": "Available",
  "入口未开放": "Endpoint Unavailable",
  "请先从页面右上角连接 Web Host。": "Connect to Web Host from the upper-right corner first.",
  "数据版本 ID（留空读取数据集）": "Dataset Version ID (leave empty to list datasets)",
  "评估配置 ID": "Evaluation Configuration ID",
  "Navigator 工作空间 ID": "Navigator Workspace ID",
  "请求中…": "Requesting…",
  "读取服务设置": "Read Service Settings",
  "保存参数到 Yield": "Save Parameters to Yield",
  "另存到 Echo": "Save New Configuration to Echo",
  "已绑定": "Bound",
  "解除绑定": "Remove Binding",
  "设置服务已连接": "Settings Service Connected",
  "服务连接": "Service Connection",
  "服务连接设置": "Service Connection Settings",
  "一次性配对码": "One-time Pairing Code",
  "连接中…": "Connecting…",
  "检查连接": "Check Connection",
  "配对": "Pair",
  "退出会话": "End Session",
  "保存到服务端": "Save to Server",
  "自动排版": "Auto Layout",
  "读取流程列表": "Read Pipeline List",
  "服务端流程": "Server Pipelines",
  "选择流程": "Select Pipeline",
  "载入服务端流程": "Load Server Pipeline",
  "整理选中节点": "Layout Selected Nodes",
  "解锁节点位置": "Unlock Node Position",
  "锁定节点位置": "Lock Node Position",
  "撤销本地修改": "Undo Local Change",
  "重做本地修改": "Redo Local Change",
  "撤销服务端修改": "Undo Server Change",
  "重做服务端修改": "Redo Server Change",
  "载入新版本": "Load New Version",
  "变更记录": "Change History",
  "流程版本与排版": "Pipeline Version and Layout",
  "读取已发布数据版本并绑定到节点。数据集列表用于查找容器；版本需按 ID 查询。": "Read a published dataset version and bind it to the node. Use the dataset list to find a container; query versions by ID.",
  "读取 Reactor 已导入的模型，选择 READY 模型制品。这里只选择已有模型。": "Read models imported by Reactor and select a READY artifact. This only selects an existing model.",
  "读取 Web Host 所在机器的 GPU 观测。云资源目录与分配接口尚未接入，算力规格保存在流程草稿。": "Read GPU observations from the Web Host machine. Cloud resource catalogs and allocation are not connected; compute requirements remain in the pipeline draft.",
  "读取 Yield 训练草稿；可将参数保存回未启动的草稿。保存不会启动训练。Full 模式暂不能同步。": "Read Yield training drafts and save parameters to a draft that has not started. Saving does not start training. Full mode cannot be synchronized yet.",
  "按 ID 读取 Echo 评估配置，或新建一份配置；不会发起评估。现有配置没有更新接口。": "Read an Echo evaluation configuration by ID or create a new one. This does not start evaluation, and existing configurations cannot be updated.",
  "选择 Reactor 已配置的推理绑定。部署名称和选择保存在流程草稿，不会创建部署。": "Select a serving binding configured in Reactor. The deployment name and selection remain in the pipeline draft and do not create a deployment.",
  "读取 Navigator 工作空间中的已有会话。通用 Agent 配置接口尚未提供；测试任务保存在流程草稿。": "Read existing sessions in a Navigator workspace. A general Agent configuration API is not available; the test task remains in the pipeline draft.",
  "先连接 Web Host，再从节点面板读取服务设置。": "Connect to Web Host, then read service settings from a node panel.",
  "会话已失效，请重新配对。": "The session expired. Pair again.",
  "Web Host 可访问，请输入其启动时提供的一次性配对码。": "Web Host is reachable. Enter the one-time pairing code shown at startup.",
  "已连接。各节点将独立检查所属服务；连接 Web Host 不表示所有服务可用。": "Connected. Each node checks its owning service independently; a Web Host connection does not mean every service is available.",
  "已退出 Web Host 会话。本地流程草稿保留。": "The Web Host session ended. The local pipeline draft is preserved.",
  "页面插件": "Page Plugins",
  "平台 MCP": "Platform MCP",
  "构建输出": "Build Output",
  "运行详情与日志": "Run Details and Logs",
  "切换底部工具窗口": "Toggle Bottom Tool Window",
  "恢复默认布局": "Restore Default Layout",
  "保存草稿": "Save Draft",
  "载入草稿": "Load Draft",
  "导入 JSON": "Import JSON",
  "导出 JSON": "Export JSON",
  "恢复未保存编辑": "Recover Unsaved Edits",
  "暂无恢复记录": "No recovery records",
  "校验流程": "Validate Pipeline",
  "节点镜像与版本管理": "Node Images and Versions",
  "训练示例": "Training Example",
  "执行服务器与运行列表": "Execution Servers and Runs",
  "本地预演": "Local Preview",
  "节点包管理": "Node Package Management",
  "服务器注册与连接诊断": "Server Registration and Diagnostics",
  "事件日志": "Event Log",
  "查看流程 JSON": "View Pipeline JSON",
  "MCP 工具与上下文": "MCP Tools and Context",
  "本地工作空间": "Local Workspace",
  "流水线名称": "Pipeline Name",
  "本地有未保存修改": "Unsaved Local Changes",
  "草稿": "Draft",
  "左侧工具栏": "Left Tool Bar",
  "显示事件日志": "Show Event Log",
  "收起左侧窗口": "Collapse Left Tool Window",
  "关闭服务器管理": "Close Server Management",
  "搜索节点": "Search Nodes",
  "搜索节点或服务…": "Search nodes or services…",
  "点击添加节点": "Click to add a node",
  "拖动端口连接步骤": "Drag ports to connect steps",
  "调整左侧窗口宽度": "Resize Left Tool Window",
  "流水线编辑器": "Pipeline Editor",
  "编辑器页面": "Editor Tabs",
  "流水线": "Pipeline",
  "适应画布": "Fit Canvas",
  "拖动平移": "Drag to pan",
  "滚轮缩放": "Scroll to zoom",
  "Delete 删除节点": "Delete removes a node",
  "正在预演": "Previewing",
  "画布暂时锁定": "Canvas temporarily locked",
  "当前草稿": "Current Draft",
  "只读预览": "Read-only Preview",
  "文件内容预览": "File Content Preview",
  "底部工具窗口": "Bottom Tool Window",
  "调整底部窗口高度": "Resize Bottom Tool Window",
  "真实运行": "Live Runs",
  "流程检查": "Pipeline Checks",
  "运行预演": "Run Preview",
  "收起底部窗口": "Collapse Bottom Tool Window",
  "结构检查通过": "Structure Check Passed",
  "端口类型、必填参数与依赖顺序有效。服务连接、资源可用性及评估门禁尚未验证。": "Port types, required parameters, and dependency order are valid. Service connectivity, resource availability, and evaluation gates are not yet verified.",
  "依赖顺序预演中": "Previewing Dependency Order",
  "尚未开始预演": "Preview Not Started",
  "停止预演": "Stop Preview",
  "这里只模拟步骤顺序，不生成模型、评估指标或真实端点。": "This only simulates step order. It does not create models, metrics, or live endpoints.",
  "调整右侧窗口宽度": "Resize Right Tool Window",
  "收起右侧窗口": "Collapse Right Tool Window",
  "未选择节点": "No Node Selected",
  "从画布或节点列表选择一个节点后，可在这里配置。": "Select a node on the canvas or in the node list to configure it here.",
  "节点列表": "Node List",
  "未添加节点": "No Nodes Added",
  "状态": "Status",
  "就绪": "Ready",
  "本地模拟": "Local Simulation",
  "布局与草稿保存在本机浏览器中。": "Layout and drafts are stored in this browser.",
};

interface I18nValue {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  t: (message: string) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function normalizeLocale(value: string | null | undefined): AppLocale {
  return value?.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

export function resolveLocale(stored: string | null | undefined, preferred: string | null | undefined): AppLocale {
  return stored === "zh-CN" || stored === "en-US" ? stored : normalizeLocale(preferred);
}

export function translate(message: string, locale: AppLocale): string {
  return locale === "zh-CN" ? message : english[message] ?? message;
}

export function initialLocale(): AppLocale {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === "zh-CN" || stored === "en-US") return stored;
  } catch {
    // Language persistence is optional in restricted browser contexts.
  }
  return "zh-CN";
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<AppLocale>(initialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
    try { window.localStorage.setItem(LOCALE_STORAGE_KEY, locale); } catch { /* optional preference */ }
  }, [locale]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === LOCALE_STORAGE_KEY && (event.newValue === "zh-CN" || event.newValue === "en-US")) setLocale(event.newValue);
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const value = useMemo<I18nValue>(() => ({
    locale,
    setLocale,
    t: (message) => translate(message, locale),
  }), [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside LocaleProvider");
  return value;
}

export function LanguageSelect({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className={`language-select ${compact ? "language-select--compact" : ""}`.trim()}>
      <span>{t("语言")}</span>
      <select aria-label={t("语言")} value={locale} onChange={(event) => setLocale(event.target.value as AppLocale)}>
        <option value="zh-CN">{compact ? "中文" : t("简体中文")}</option>
        <option value="en-US">{compact ? "EN" : t("英语")}</option>
      </select>
    </label>
  );
}
