import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type AppLocale = "zh-CN" | "en-US";
export const LOCALE_STORAGE_KEY = "cyrene.client.locale.v1";

const chinese: Record<string, string> = {
  Language: "语言",
  "Simplified Chinese": "简体中文",
  English: "English",
  Overview: "概览",
  Models: "模型",
  Datasets: "数据集",
  Training: "训练",
  Runs: "运行",
  Deployments: "部署",
  Gateway: "网关",
  Chat: "对话",
  Settings: "设置",
  "Workspace pulse and service reachability": "工作空间状态与服务连通性",
  "Imports, validation, and artifacts": "导入、校验与产物",
  "Containers and preparation handoffs": "容器与数据准备交接",
  "Drafts, preflight, and launch intent": "草稿、预检与启动意图",
  "Run detail and attempt diagnostics": "运行详情与执行诊断",
  "Serving lifecycle and readiness": "服务生命周期与就绪状态",
  "Routes, API keys, and client configuration": "路由、API 密钥与客户端配置",
  "Exchange model testing with active route": "使用当前路由测试 Exchange 模型",
  "Workspace session and credentials": "工作空间会话与凭据",
  "operations console": "运维控制台",
  "Primary navigation": "主导航",
  "Mobile navigation": "移动端导航",
  "Web Host session active": "Web Host 会话已连接",
  "Refresh window": "刷新窗口",
  "Sign out": "退出登录",
  "Navigator Web Host is unreachable": "Navigator Web Host 无法连接",
  "Retry session check": "重试会话检查",
  "Opening Navigator": "正在打开 Navigator",
  "Checking the same-origin Web Host session.": "正在检查同源 Web Host 会话。",
  "One-time pairing code": "一次性配对码",
  "Paste the launcher code": "粘贴启动器生成的代码",
  "Pairing...": "正在配对…",
  "Open console": "打开控制台",
  "Enter the field.": "进入工作空间。",
  "Pair this browser with the local Navigator host. The code is printed once by the host launcher and is never stored by the UI.": "将此浏览器与本地 Navigator 主机配对。代码只由主机启动器显示一次，界面不会保存它。",
  "Same-origin session | rotating refresh | CSRF protected mutations": "同源会话｜轮换刷新｜CSRF 保护写操作",
  "Navigator boundary notes": "Navigator 边界说明",
  "What stays true": "始终遵守的边界",
  "Every page reads the owner.": "每个页面都读取所属服务。",
  "Navigator presents Product projections. It does not copy lifecycle state into browser storage or choose arbitrary upstream origins.": "Navigator 展示各 Product 的投影，不会把生命周期状态复制到浏览器存储，也不会任意选择上游地址。",
  "Workspace status": "工作空间状态",
  "Current service availability and host resources reported by the configured Product endpoints.": "配置的 Product 端点当前上报的服务可用性与主机资源。",
  "Refresh overview": "刷新概览",
  "Refreshing...": "刷新中…",
  Refresh: "刷新",
  "Model imports": "模型导入",
  "Dataset containers": "数据集容器",
  "Training drafts": "训练草稿",
  "Reactor unavailable": "Reactor 不可用",
  "Catalyst unavailable": "Catalyst 不可用",
  "Yield unavailable": "Yield 不可用",
  "Refreshing status": "正在刷新状态",
  "Reading the host and configured Product endpoints.": "正在读取主机和已配置的 Product 端点。",
  Services: "服务",
  Available: "可用",
  Unavailable: "不可用",
  "Host status is unavailable.": "主机状态不可用。",
  Issues: "问题",
  "No reported issues": "没有已上报的问题",
  "All configured status requests completed successfully.": "所有已配置的状态请求均已成功完成。",
  "Check the service endpoint and its current binding, then refresh.": "请检查服务端点及当前绑定，然后刷新。",
  Accelerators: "加速器",
  "No accelerator data": "没有加速器数据",
  "nvidia-smi is unavailable or no supported GPU was found.": "nvidia-smi 不可用，或未找到受支持的 GPU。",
  "The host did not report hardware information.": "主机未上报硬件信息。",
  Storage: "存储",
  "Total space": "总空间",
  "Used space": "已用空间",
  "Free space": "可用空间",
  Utilization: "使用率",
  "Storage usage unavailable": "存储使用情况不可用",
  "Filesystem statistics not reported by host.": "主机未上报文件系统统计。",
  Readiness: "就绪状态",
  "No reported blockers": "没有已上报的阻塞项",
  "The host status endpoint did not report any readiness blockers.": "主机状态端点未上报任何就绪阻塞项。",
  "Installed plugins": "已安装插件",
  "No plugins detected": "未检测到插件",
  "No runtime plugins currently registered or reported by host.": "当前没有由主机注册或上报的运行时插件。",
  "Try again": "重试",
  "Not reported": "未上报",
  "No timestamp": "无时间戳",
  "Models with receipts.": "带凭据的模型。",
  "Import a pinned source, then read Reactor's validation evidence before handing the artifact onward.": "导入固定版本的来源，并在交接产物前读取 Reactor 的校验证据。",
  "Refresh models": "刷新模型",
  "Import a model": "导入模型",
  "Import ledger": "导入记录",
  "Reading model imports": "正在读取模型导入",
  "Model imports unavailable": "模型导入不可用",
  "No imports yet": "尚无导入记录",
  "Make the data legible.": "让数据可理解、可追踪。",
  "Create the owned container first. Preparation, mapping, quality, and split decisions stay visible at Catalyst rather than being guessed here.": "先创建归属明确的容器。准备、映射、质量和拆分决策均由 Catalyst 明确记录，而不是由此处推测。",
  "Refresh datasets": "刷新数据集",
  "New dataset container": "新建数据集容器",
  "Prepare data": "准备数据",
  "Reading datasets": "正在读取数据集",
  "Datasets unavailable": "数据集不可用",
  "No dataset containers": "尚无数据集容器",
  "Loading sample preview": "正在加载样本预览",
  "Preview unavailable": "预览不可用",
  "No samples loaded": "尚未加载样本",
  "Dataset version sample preview": "数据集版本样本预览",
  "Train only from prepared intent.": "只从准备完成的意图启动训练。",
  "Training drafts are owned by Yield. This console can launch a prepared draft and then hands run observation to the Runs page.": "训练草稿由 Yield 管理。此控制台可启动准备完成的草稿，随后由运行页面承接运行观测。",
  "Refresh drafts": "刷新草稿",
  "Training hyperparameters & LLaMA Factory mapping": "训练超参数与 LLaMA Factory 映射",
  "Choose the training inputs": "选择训练输入",
  "Reading training drafts": "正在读取训练草稿",
  "Training drafts unavailable": "训练草稿不可用",
  "No training drafts": "尚无训练草稿",
  "Follow one run to the metal.": "追踪一次运行直到底层资源。",
  "Yield publishes run detail and attempt diagnostics, not a browser-owned history cache. Enter an id to read the current projection.": "Yield 发布运行详情与执行诊断，而不是由浏览器保存历史缓存。输入 ID 可读取当前投影。",
  "Find a training run": "查找训练运行",
  "Reading run projection": "正在读取运行投影",
  "Run could not be read": "无法读取运行",
  "Realtime execution stream": "实时执行流",
  "Attempt diagnostics": "执行诊断",
  "Attempts unavailable": "执行记录不可用",
  "No attempt diagnostics": "没有执行诊断",
  "No run selected": "未选择运行",
  "Serve with a known edge.": "通过明确的边界提供服务。",
  "Deployments express intent; endpoints express addressability. Read both through Reactor and stop only through its explicit lifecycle action.": "部署表达期望状态，端点表达可寻址性。两者均通过 Reactor 读取，并只通过明确的生命周期操作停止。",
  "Refresh deployments": "刷新部署",
  "Deployment ledger": "部署记录",
  "Reading deployments": "正在读取部署",
  "Deployments unavailable": "部署不可用",
  "No deployments": "尚无部署",
  "Loading deployment phase events": "正在加载部署阶段事件",
  "Events unavailable": "事件不可用",
  "No events recorded": "没有事件记录",
  "Routes, API keys, and client configuration.": "路由、API 密钥与客户端配置。",
  "Exchange acts as the single OpenAI-compatible data plane. Publish model routes, copy client integration code, and manage caller API keys.": "Exchange 作为统一的 OpenAI 兼容数据平面。可在此发布模型路由、复制客户端接入代码并管理调用方 API 密钥。",
  "Refresh gateway": "刷新网关",
  "Gateway routes": "网关路由",
  "Reading Gateway routes": "正在读取网关路由",
  "Routes unavailable": "路由不可用",
  "No Gateway routes": "尚无网关路由",
  "Gateway API keys": "网关 API 密钥",
  "No API keys": "尚无 API 密钥",
  "Keep the boundary boring.": "让边界保持简单可靠。",
  "Session rotation, CSRF, proxy allowlists, and credential metadata are Web Host concerns. Secrets never become a Product read.": "会话轮换、CSRF、代理白名单和凭据元数据属于 Web Host 的职责。Product 永远不会读取密钥内容。",
  "Refresh settings": "刷新设置",
  "Current session": "当前会话",
  "Navigator Web Host": "Navigator Web Host",
  "Add credential metadata": "添加凭据元数据",
  "Credential metadata": "凭据元数据",
  "Reading credential metadata": "正在读取凭据元数据",
  "Credentials unavailable": "凭据不可用",
  "No credentials configured": "尚未配置凭据",
  "Test models with active route.": "使用当前路由测试模型。",
  "Interact directly with the model bound to this session through Exchange Gateway proxy.": "通过 Exchange Gateway 代理直接与当前会话绑定的模型交互。",
  "Loading active route": "正在加载当前路由",
  "No active route selected": "未选择当前路由",
  "Active route required": "需要当前路由",
  "Chat conversation": "对话",
  Name: "名称",
  Description: "描述",
  "Display name": "显示名称",
  Provider: "提供方",
  Kind: "类型",
  Secret: "密钥",
  Created: "创建时间",
  Updated: "更新时间",
  Type: "类型",
  Version: "版本",
  Service: "服务",
  Credential: "凭据",
  Dataset: "数据集",
  "Dataset version": "数据集版本",
  "Dataset version ID": "数据集版本 ID",
  Preparation: "准备任务",
  "Preparation name": "准备任务名称",
  "Upload source file": "上传源文件",
  "Input field": "输入字段",
  "Output field": "输出字段",
  "Instruction field": "指令字段",
  "Base model": "基础模型",
  "Serving binding": "服务绑定",
  "Engine binding": "引擎绑定",
  "Source kind": "来源类型",
  Repository: "仓库",
  "Pinned revision": "固定版本",
  "Absolute path": "绝对路径",
  "Target binding": "目标绑定",
  "Run id": "运行 ID",
  "Training run id": "训练运行 ID",
  Checkpoint: "检查点",
  Progress: "进度",
  ETA: "预计剩余时间",
  Loss: "损失",
  "Stream status": "流状态",
  Attempts: "执行次数",
  "Endpoint ID": "端点 ID",
  "Resource version": "资源版本",
  "Exchange API keys": "Exchange API 密钥",
  "Exchange API Key": "Exchange API 密钥",
  "Key name *": "密钥名称 *",
  "Key hint": "密钥提示",
  "Expiration (days)": "有效期（天）",
  "Model scope": "模型范围",
  "Base URL": "基础 URL",
  "Model ID": "模型 ID",
  "Access state": "访问状态",
  "Access expires": "访问过期时间",
  Refreshable: "可刷新",
  "Active credentials": "有效凭据",
  "Revoked credentials": "已撤销凭据",
  "Paste once, never displayed": "仅粘贴一次，之后不再显示",
  "Type a message...": "输入消息…",
  "Batch size / 批次大小": "批次大小 / Batch size",
  "Epochs / 训练轮数": "训练轮数 / Epochs",
  "Gradient accumulation / 梯度累积": "梯度累积 / Gradient accumulation",
  "Learning rate / 学习率": "学习率 / Learning rate",
  "Sequence length / 截断长度": "截断长度 / Sequence length",
  "LoRA alpha / LoRA 缩放系数": "LoRA 缩放系数 / LoRA alpha",
  "LoRA dropout / LoRA 丢弃率": "LoRA 丢弃率 / LoRA dropout",
  "LoRA rank / LoRA 秩": "LoRA 秩 / LoRA rank",
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
  return locale === "zh-CN" ? chinese[message] ?? message : message;
}

export function initialLocale(): AppLocale {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === "zh-CN" || stored === "en-US") return stored;
  } catch { /* optional preference */ }
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
  const value = useMemo<I18nValue>(() => ({ locale, setLocale, t: (message) => translate(message, locale) }), [locale]);
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
      <span>{t("Language")}</span>
      <select aria-label={t("Language")} value={locale} onChange={(event) => setLocale(event.target.value as AppLocale)}>
        <option value="zh-CN">{compact ? "中文" : t("Simplified Chinese")}</option>
        <option value="en-US">{compact ? "EN" : t("English")}</option>
      </select>
    </label>
  );
}
