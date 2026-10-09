import { useMemo } from "react";
import { useI18n, type AppLocale } from "../i18n";
import type {
  AssistantPermission,
  NavigatorTaskRecord,
} from "../../services/navigator/src/api";

const messages = {
  navigatorDidNotIdentifyItsWorkspace: {
    "zh-CN": "Navigator 未返回工作空间身份。",
    "en-US": "Navigator did not identify its workspace.",
  },
  chooseAnAvailableAgentOrConfigureAnAPI: {
    "zh-CN": "请选择可用的智能体或配置 API。",
    "en-US": "Choose an available agent or configure an API.",
  },
  removeImageAttachmentsOrChooseAnImageCapableModel: {
    "zh-CN": "当前模型不支持已附加的图像，请移除图像或切换模型。",
    "en-US": "Remove image attachments or choose an image-capable model.",
  },
  harnessSupportsReadOnlyAndAskPermissions: {
    "zh-CN": "Harness 支持只读和逐次确认模式。",
    "en-US": "Harness supports Read only and Ask permissions.",
  },
  atMost12Files: {
    "zh-CN": "最多附加 12 个文件。",
    "en-US": "At most 12 files.",
  },
  theSelectedModelDoesNotAdvertiseImageSupportChoose: {
    "zh-CN": "当前模型没有声明图像支持，请选择支持图像的模型。",
    "en-US":
      "The selected model does not advertise image support. Choose an image-capable model.",
  },
  eachAttachmentMustBeAtMost4MB: {
    "zh-CN": "单个附件不能超过 4 MB。",
    "en-US": "Each attachment must be at most 4 MB.",
  },
  you: {
    "zh-CN": "你",
    "en-US": "You",
  },
  pipelineWhenSent: {
    "zh-CN": "发送时的流程",
    "en-US": "Pipeline when sent",
  },
  reasoning: {
    "zh-CN": "思考摘要",
    "en-US": "Reasoning",
  },
  savedPipeline: {
    "zh-CN": "已保存流程",
    "en-US": "Saved pipeline",
  },
  viewInCanvas: {
    "zh-CN": "在画布中查看",
    "en-US": "View in canvas",
  },
  approvalRequired: {
    "zh-CN": "等待确认",
    "en-US": "Approval required",
  },
  originatingPipeline: {
    "zh-CN": "发起时的流程",
    "en-US": "Originating pipeline",
  },
  theCanvasChangedThisApprovalStillBelongsToThe: {
    "zh-CN": "当前画布已切换；此审批仍属于上方任务。",
    "en-US":
      "The canvas changed; this approval still belongs to the task above.",
  },
  operationDetails: {
    "zh-CN": "操作详情",
    "en-US": "Operation details",
  },
  allowOnce: {
    "zh-CN": "允许本次",
    "en-US": "Allow once",
  },
  allowThisOperationTypeForThisTask: {
    "zh-CN": "本任务内同类操作全部允许",
    "en-US": "Allow this operation type for this task",
  },
  decline: {
    "zh-CN": "拒绝",
    "en-US": "Decline",
  },
  requestedInput: {
    "zh-CN": "补充信息",
    "en-US": "Requested input",
  },
  answer: {
    "zh-CN": "回答",
    "en-US": "Answer",
  },
  viewOriginatingPipeline: {
    "zh-CN": "查看发起时流程",
    "en-US": "View originating pipeline",
  },
  newChat: {
    "zh-CN": "新建聊天",
    "en-US": "New chat",
  },
  chatHistory: {
    "zh-CN": "聊天历史",
    "en-US": "Chat history",
  },
  refreshAgents: {
    "zh-CN": "刷新智能体",
    "en-US": "Refresh agents",
  },
  assistantSettings: {
    "zh-CN": "助手设置",
    "en-US": "Assistant settings",
  },
  mcpTools: {
    "zh-CN": "MCP 调试",
    "en-US": "MCP tools",
  },
  dockRight: {
    "zh-CN": "停靠右侧",
    "en-US": "Dock right",
  },
  openInEditor: {
    "zh-CN": "在主页面打开",
    "en-US": "Open in editor",
  },
  dismissError: {
    "zh-CN": "关闭错误",
    "en-US": "Dismiss error",
  },
  connectUsingTheExistingNavigatorPairedSession: {
    "zh-CN": "使用现有 Navigator 配对会话连接智能体。",
    "en-US": "Connect using the existing Navigator paired session.",
  },
  oneTimePairingCode: {
    "zh-CN": "一次性配对码",
    "en-US": "One-time pairing code",
  },
  connect: {
    "zh-CN": "连接",
    "en-US": "Connect",
  },
  checkingTheNavigatorWorkspace: {
    "zh-CN": "正在核对 Navigator 工作空间身份…",
    "en-US": "Checking the Navigator workspace…",
  },
  navigatorWorkspaceIdentityIsNotVerifiedOperationsAreUnavailable: {
    "zh-CN": "尚未核实 Navigator 工作空间身份，无法提交操作。",
    "en-US":
      "Navigator workspace identity is not verified; operations are unavailable.",
  },
  navigatorIsConnectedToADifferentWorkspaceOperationsAre: {
    "zh-CN": "Navigator 工作空间与当前工作空间不一致，无法提交操作。",
    "en-US":
      "Navigator is connected to a different workspace; operations are unavailable.",
  },
  retryWorkspaceConnection: {
    "zh-CN": "重试工作空间连接",
    "en-US": "Retry workspace connection",
  },
  backToChat: {
    "zh-CN": "返回聊天",
    "en-US": "Back to chat",
  },
  readLegacyChatExport: {
    "zh-CN": "读取旧聊天导出",
    "en-US": "Read legacy chat export",
  },
  viewImportedLegacyChats: {
    "zh-CN": "查看已读取的旧聊天",
    "en-US": "View imported legacy chats",
  },
  turns: {
    "zh-CN": "轮对话",
    "en-US": "turns",
  },
  loadEarlierHistory: {
    "zh-CN": "加载更早记录",
    "en-US": "Load earlier history",
  },
  legacyChatsAreReadOnlyExportedApprovalsAndExecutions: {
    "zh-CN": "旧聊天只读；导出的审批和运行状态不会恢复或执行。",
    "en-US":
      "Legacy chats are read only. Exported approvals and executions cannot be resumed.",
  },
  legacyChat: {
    "zh-CN": "旧聊天",
    "en-US": "Legacy chat",
  },
  readingSessionHistory: {
    "zh-CN": "读取会话记录",
    "en-US": "Reading session history",
  },
  startAConversation: {
    "zh-CN": "开始一段对话",
    "en-US": "Start a conversation",
  },
  readingEarlierTasks: {
    "zh-CN": "正在读取更早的任务记录…",
    "en-US": "Reading earlier tasks…",
  },
  executeResumeAndApproveTasksThroughNavigator: {
    "zh-CN": "使用 Navigator 执行、恢复与审批任务",
    "en-US": "Execute, resume and approve tasks through Navigator",
  },
  chooseASessionFromHistory: {
    "zh-CN": "在历史中选择会话",
    "en-US": "Choose a session from history",
  },
  submissionIsUnconfirmedCheckTaskHistoryOrRetryThe: {
    "zh-CN": "提交尚未确认。核对任务记录或用同一请求安全重试。",
    "en-US":
      "Submission is unconfirmed. Check task history or retry the same request.",
  },
  retryRequest: {
    "zh-CN": "重试原请求",
    "en-US": "Retry request",
  },
  message: {
    "zh-CN": "消息",
    "en-US": "Message",
  },
  askPlanOrWorkInYourWorkspace: {
    "zh-CN": "询问、规划或操作工作空间…",
    "en-US": "Ask, plan or work in your workspace…",
  },
  attachFiles: {
    "zh-CN": "附加文件",
    "en-US": "Attach files",
  },
  stop: {
    "zh-CN": "停止",
    "en-US": "Stop",
  },
  send: {
    "zh-CN": "发送",
    "en-US": "Send",
  },
  agent: {
    "zh-CN": "智能体",
    "en-US": "Agent",
  },
  unavailable: {
    "zh-CN": "（不可用）",
    "en-US": " (unavailable)",
  },
  apiProvider: {
    "zh-CN": "API 提供方",
    "en-US": "API provider",
  },
  hostDefaultModel: {
    "zh-CN": "宿主默认模型",
    "en-US": "Host default model",
  },
  model: {
    "zh-CN": "模型",
    "en-US": "Model",
  },
  reasoningEffort: {
    "zh-CN": "思考深度",
    "en-US": "Reasoning effort",
  },
  defaultReasoning: {
    "zh-CN": "默认思考深度",
    "en-US": "Default reasoning",
  },
  permissionMode: {
    "zh-CN": "权限模式",
    "en-US": "Permission mode",
  },
  thisModeExecutesPermittedOperationsAutomaticallyEnableItFor: {
    "zh-CN": "此权限模式会自动执行允许范围内的操作。确认为后续任务启用？",
    "en-US":
      "This mode executes permitted operations automatically. Enable it for subsequent tasks?",
  },
  thisAgentCannotResumeSessionsStartANewChat: {
    "zh-CN": "该智能体不支持恢复会话，请新建聊天。",
    "en-US": "This agent cannot resume sessions. Start a new chat.",
  },
  theAgentUsesItsHostPermissionsWorkspacePermissionsStill: {
    "zh-CN": "智能体将按宿主能力自动执行；工作空间权限仍然生效。",
    "en-US":
      "The agent uses its host permissions; workspace permissions still apply.",
  },
  thisAccountCannotExecuteAgentTasks: {
    "zh-CN": "当前账号没有智能体执行权限。",
    "en-US": "This account cannot execute agent tasks.",
  },
  sessionDetails: {
    "zh-CN": "会话信息",
    "en-US": "Session details",
  },
  chooseAttachments: {
    "zh-CN": "选择附件",
    "en-US": "Choose attachments",
  },
  chooseLegacyChatExport: {
    "zh-CN": "选择旧聊天导出",
    "en-US": "Choose legacy chat export",
  },
  legacyChatExportsMustBeAtMost10MB: {
    "zh-CN": "旧聊天导出不能超过 10 MB。",
    "en-US": "Legacy chat exports must be at most 10 MB.",
  },
  reasoningEffortMustBeMinimalLowMediumHighXhigh: {
    "zh-CN": "思考深度必须是 minimal、low、medium、high、xhigh 或 max。",
    "en-US":
      "Reasoning effort must be minimal, low, medium, high, xhigh, or max.",
  },
  apiConfiguration: {
    "zh-CN": "API 配置",
    "en-US": "API configuration",
  },
  credentialsAreSavedByTheNavigatorHostEnterModels: {
    "zh-CN": "凭据保存在 Navigator 宿主。请按提供方支持填写模型和思考深度。",
    "en-US":
      "Credentials are saved by the Navigator host. Enter models and reasoning levels supported by your provider.",
  },
  existingProvider: {
    "zh-CN": "已有提供方",
    "en-US": "Existing provider",
  },
  newProvider: {
    "zh-CN": "新增提供方",
    "en-US": "New provider",
  },
  name: {
    "zh-CN": "名称",
    "en-US": "Name",
  },
  apiProtocol: {
    "zh-CN": "API 协议",
    "en-US": "API protocol",
  },
  leaveEmptyToKeepCurrentCredentials: {
    "zh-CN": "留空保留现有凭据",
    "en-US": "Leave empty to keep current credentials",
  },
  modelIDsOnePerLine: {
    "zh-CN": "模型 ID（每行一个）",
    "en-US": "Model IDs (one per line)",
  },
  reasoningLevelsCommaSeparatedOptional: {
    "zh-CN": "思考深度（逗号分隔，可留空）",
    "en-US": "Reasoning levels (comma separated, optional)",
  },
  theseModelsSupportImageInputs: {
    "zh-CN": "这些模型支持图像输入",
    "en-US": "These models support image inputs",
  },
  save: {
    "zh-CN": "保存",
    "en-US": "Save",
  },
  deleteProvider: {
    "zh-CN": "删除提供方",
    "en-US": "Delete provider",
  },
  readOnly: {
    "zh-CN": "只读",
    "en-US": "Read only",
  },
  ask: {
    "zh-CN": "逐次确认",
    "en-US": "Ask",
  },
  autoApproval: {
    "zh-CN": "自动审批",
    "en-US": "Auto approval",
  },
  fullAccess: {
    "zh-CN": "完全访问",
    "en-US": "Full access",
  },
  queued: {
    "zh-CN": "排队中",
    "en-US": "Queued",
  },
  running: {
    "zh-CN": "执行中",
    "en-US": "Running",
  },
  completed: {
    "zh-CN": "已完成",
    "en-US": "Completed",
  },
  failed: {
    "zh-CN": "失败",
    "en-US": "Failed",
  },
  stopped: {
    "zh-CN": "已停止",
    "en-US": "Stopped",
  },
  inputRequired: {
    "zh-CN": "等待补充信息",
    "en-US": "Input required",
  },
} satisfies Record<string, Record<AppLocale, string>>;

export type AssistantMessageKey = keyof typeof messages;
export const permissionMessages = {
  "read-only": "readOnly",
  ask: "ask",
  auto: "autoApproval",
  "full-access": "fullAccess",
} satisfies Record<AssistantPermission, AssistantMessageKey>;
export const statusMessages = {
  queued: "queued",
  running: "running",
  completed: "completed",
  failed: "failed",
  aborted: "stopped",
  waiting_approval: "approvalRequired",
  waiting_input: "inputRequired",
} satisfies Record<NavigatorTaskRecord["status"], AssistantMessageKey>;

export function useAssistantMessages() {
  const { locale } = useI18n();
  return useMemo(
    () => (key: AssistantMessageKey) => messages[key][locale],
    [locale],
  );
}
