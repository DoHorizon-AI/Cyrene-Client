// ┌─────────────────────────────────────────────────────────────────────────┐
// │  📄 contracts.ts                                                         │
// │  Module: services/installer                                              │
// │  Role: Typed shapes for Installer API / Workload Resolver responses.     │
// │         UI consumes these; no dependency resolution is done client-side. │
// │                                                                          │
// │  中文：模块职责：Installer API / Workload Resolver 响应的类型契约。         │
// │  UI 消费这些类型；依赖解析完全由后端负责，前端不实现第二套解析器。             │
// └─────────────────────────────────────────────────────────────────────────┘

// ---------------------------------------------------------------------------
// § 1 — Component catalog
// ---------------------------------------------------------------------------

/** Selection affinity for a component within a workload. */
export type ComponentAffinity = "required" | "recommended" | "optional";

/** Lifecycle status of a component as reported by the Installer API. */
export type ComponentLifecycleStatus =
  | "available"
  | "verified"
  | "installed"
  | "configured"
  | "enabled"
  | "running"
  | "failed"
  | "not_installed";

/** A single installable component entry as returned by the catalog endpoint. */
export interface InstallerComponent {
  /** Stable identifier matching plugin.manifest.json#id */
  id: string;
  /** Display name (bilingual: zh/en keys when available) */
  name: string;
  nameCn?: string;
  /** One-line description */
  description: string;
  descriptionCn?: string;
  /** Reported installed version, null when not installed */
  installedVersion: string | null;
  /** Latest available version per the catalog */
  availableVersion: string | null;
  /** Estimated download size in bytes; null when unknown */
  downloadBytes: number | null;
  /** Lifecycle status */
  status: ComponentLifecycleStatus;
  /** OS/architecture constraints */
  supportedPlatforms: string[];
  /** Whether the current platform is compatible */
  compatibleWithCurrentPlatform: boolean;
}

/** Catalog payload from the Installer API. */
export interface ComponentCatalog {
  /** Catalog generation / cache key */
  generation: number;
  components: InstallerComponent[];
  fetchedAt: string; // ISO-8601
}

// ---------------------------------------------------------------------------
// § 2 — Workloads
// ---------------------------------------------------------------------------

/** A workload entry as returned by the Installer API. */
export interface WorkloadEntry {
  id: string;
  name: string;
  nameCn?: string;
  description: string;
  descriptionCn?: string;
  /** Ordered list of component ids with their affinity */
  components: Array<{
    componentId: string;
    affinity: ComponentAffinity;
  }>;
}

/** Catalog of known workloads. */
export interface WorkloadCatalog {
  workloads: WorkloadEntry[];
}

// ---------------------------------------------------------------------------
// § 3 — Installation plan
// ---------------------------------------------------------------------------

/** Target platform tuple as resolved by the authoritative Installer service. */
export interface TargetPlatform {
  os: string;
  architecture: string;
  distribution?: string;
  runtime?: string;
  abi?: string;
}

/** User selection submitted to the Workload Resolver endpoint. */
export interface PlanSelectionRequest {
  workloadIds: string[];
  manualComponentIds: string[];
  excludedRecommendedComponentIds?: string[];
}

/** A component entry in the resolved installation plan. */
export interface PlannedComponent {
  componentId: string;
  affinity: ComponentAffinity;
  /** Human-readable reason this was included (e.g. "required by Catalyst") */
  reason: string;
  reasonCn?: string;
  downloadBytes: number | null;
  version: string | null;
}

export interface InstallationPlan {
  planId: string;
  catalogGeneration: number;
  workloadIds: string[];
  additionalComponentIds: string[];
  components: PlannedComponent[];
  /** Sum of all downloadBytes; null when any component has unknown size */
  totalDownloadBytes: number | null;
  /** Target platform tuple as certified by backend; null when undetermined */
  targetPlatform: TargetPlatform | null;
  deploymentMode: string | null;
  permissionsRequired: string[];
  knownLimitations: string[];
  alreadyInstalledComponentIds: string[];
  resolvedAt: string; // ISO-8601
  expiresAt?: string; // ISO-8601 plan validity window
  /** Official Workload Control protocol extensions */
  planDigest?: string;
  catalogDigest?: string;
  status?: "ready" | "blocked";
  blockers?: Array<{
    code: string;
    componentId: string | null;
    capabilityId?: string | null;
    requiredness?: string | null;
    targetId?: string | null;
    message: string;
    retryable: boolean;
  }>;
  warnings?: Array<{
    code: string;
    componentId: string | null;
    message: string;
  }>;
  workloadPlans?: Record<string, {
    workloadId: string;
    planId: string;
    planDigest: string;
    catalogDigest: string;
    status: "ready" | "blocked";
    blockers: Array<{ code: string; message: string; componentId: string | null }>;
    warnings: Array<{ code: string; message: string; componentId: string | null }>;
    action: "install" | "uninstall";
    selections: {
      includeComponentIds: string[];
      excludeComponentIds: string[];
      choices: Record<string, string>;
    };
  }>;
}

// ---------------------------------------------------------------------------
// § 4 — Operation responses
// ---------------------------------------------------------------------------

export type InstallerOperationKind =
  | "install"
  | "uninstall"
  | "update"
  | "rollback"
  | "enable"
  | "disable"
  | "start"
  | "stop";

export interface ComponentOperationRequest {
  componentId: string;
  operation: InstallerOperationKind;
  targetVersion?: string;
}

export interface InstallerOperationStatus {
  operationId: string;
  kind: InstallerOperationKind;
  componentId: string;
  phase: "pending" | "running" | "succeeded" | "failed";
  progressPercent: number | null;
  message: string | null;
  startedAt: string;
  completedAt: string | null;
  /** Whether user data is retained on uninstall; null when unknown */
  userDataRetained: boolean | null;
}

// ---------------------------------------------------------------------------
// § 5 — Binding / dependency info for uninstall guard & managed components
// ---------------------------------------------------------------------------

/** A product binding that depends on a given component. */
export interface ComponentBinding {
  productId: string;
  productName: string;
  bindingDescription: string;
}

/** Guard payload: bindings that prevent removal of an installed component. */
export interface ComponentRemovalGuard {
  componentId: string;
  /** Non-empty means removal is blocked */
  activeBindings: ComponentBinding[];
}

/** Component enriched with management lifecycle metadata. */
export interface ManagedComponent extends InstallerComponent {
  /** Active bindings from products using this component */
  activeBindings: ComponentBinding[];
  /** Operations the backend currently permits */
  allowedOperations: InstallerOperationKind[];
  /** Retention policy on uninstall: null or 'unknown' means unverified */
  retentionPolicyOnUninstall?: "retain" | "delete" | "unknown" | null;
}

// ---------------------------------------------------------------------------
// § 6 — NOT_CONNECTED mock helpers
// ---------------------------------------------------------------------------

// NOTE: NOT_CONNECTED — these mocks stand in for the real Installer API.
// Replace with real fetch calls once the API endpoint is published.
// Do not ship these in production paths that trigger real side-effects.

/** Well-known component IDs from published plugin.manifest.json files. */
export const KNOWN_COMPONENT_IDS = {
  documentParsing: "cyrene.tools.document-parsing",
  datasetPreparation: "cyrene.tools.dataset-preparation",
  datasetGeneration: "cyrene.tools.dataset-generation",
  knowledgePreparation: "cyrene.tools.knowledge-preparation",
  datasetValidator: "cyrene.tools.dataset-validator",
  exactMatch: "cyrene.evaluation.exact-match",
  llmJudge: "cyrene.evaluation.llm-judge",
  evaluatorPack: "cyrene.evaluation.evaluator-pack",
  llamaFactory: "cyrene.training.llama-factory",
  modelApiConnector: "cyrene.providers.model-api-connector",
  vllmRuntime: "cyrene.serving.vllm-runtime",
  hfModelAnalyzer: "cyrene.models.hf-model-analyzer",
  compatRules: "cyrene.policy.compat-rules",
} as const;

// NOTE: NOT_CONNECTED — static workload catalog used until
// GET /api/installer/v1/workloads is implemented.
export const MOCK_WORKLOAD_CATALOG: WorkloadCatalog = {
  workloads: [
    {
      id: "catalyst",
      name: "Catalyst",
      nameCn: "Catalyst",
      description: "AI data curation, training data preparation, and knowledge base preparation.",
      descriptionCn: "AI 数据整理、训练数据准备与知识库数据准备。",
      components: [
        { componentId: KNOWN_COMPONENT_IDS.documentParsing, affinity: "required" },
        { componentId: KNOWN_COMPONENT_IDS.datasetPreparation, affinity: "required" },
        { componentId: KNOWN_COMPONENT_IDS.knowledgePreparation, affinity: "recommended" },
        { componentId: KNOWN_COMPONENT_IDS.datasetGeneration, affinity: "recommended" },
        { componentId: KNOWN_COMPONENT_IDS.datasetValidator, affinity: "optional" },
        { componentId: KNOWN_COMPONENT_IDS.modelApiConnector, affinity: "optional" },
      ],
    },
    {
      id: "echo",
      name: "Echo",
      nameCn: "Echo",
      description: "Standalone evaluation workload.",
      descriptionCn: "独立评测工作负载。",
      components: [
        { componentId: KNOWN_COMPONENT_IDS.exactMatch, affinity: "required" },
        { componentId: KNOWN_COMPONENT_IDS.evaluatorPack, affinity: "recommended" },
        { componentId: KNOWN_COMPONENT_IDS.llmJudge, affinity: "optional" },
      ],
    },
  ],
};

/**
 * Reserved future workloads for extension (not active in v1 install flow).
 * 为以后添加 Yield、Reactor 等产品保留扩展能力。
 */
export const RESERVED_WORKLOADS: WorkloadEntry[] = [
  {
    id: "yield",
    name: "Yield",
    nameCn: "Yield",
    description: "Training orchestration and distributed experiment management (reserved).",
    descriptionCn: "训练编排与分布式实验管理（预留）。",
    components: [
      { componentId: KNOWN_COMPONENT_IDS.llamaFactory, affinity: "required" },
    ],
  },
  {
    id: "reactor",
    name: "Reactor",
    nameCn: "Reactor",
    description: "Model deployment and runtime serving orchestration (reserved).",
    descriptionCn: "模型部署与运行时推理服务编排（预留）。",
    components: [
      { componentId: KNOWN_COMPONENT_IDS.vllmRuntime, affinity: "required" },
      { componentId: KNOWN_COMPONENT_IDS.hfModelAnalyzer, affinity: "recommended" },
    ],
  },
];

// NOTE: NOT_CONNECTED — static component catalog used until
// GET /api/installer/v1/components is implemented.
export const MOCK_COMPONENT_CATALOG: ComponentCatalog = {
  generation: 1,
  fetchedAt: new Date().toISOString(),
  components: [
    {
      id: KNOWN_COMPONENT_IDS.documentParsing,
      name: "Document Parsing",
      nameCn: "文档解析",
      description: "Multi-format document parsing (PDF, Word, Markdown, OCR) into structured content blocks.",
      descriptionCn: "多格式文档解析（PDF、Word、Markdown、OCR）至结构化内容块。",
      installedVersion: null,
      availableVersion: "0.2.0",
      downloadBytes: null, // Unknown — displays as "待确定"
      status: "available",
      supportedPlatforms: ["linux", "windows", "darwin"],
      compatibleWithCurrentPlatform: true,
    },
    {
      id: KNOWN_COMPONENT_IDS.datasetPreparation,
      name: "Dataset Preparation",
      nameCn: "数据集准备",
      description: "Deterministic dataset import, mapping, normalization, deduplication, splitting, and DuckDB conversion.",
      descriptionCn: "确定性数据集导入、映射、归一化、去重、分割与 DuckDB 转换。",
      installedVersion: null,
      availableVersion: "0.1.3",
      downloadBytes: null, // Unknown — displays as "待确定"
      status: "available",
      supportedPlatforms: ["linux", "windows", "darwin"],
      compatibleWithCurrentPlatform: true,
    },
    {
      id: KNOWN_COMPONENT_IDS.datasetGeneration,
      name: "Dataset Generation",
      nameCn: "数据集生成",
      description: "Automated synthetic data generation, instruction pairs, and QA sample synthesis.",
      descriptionCn: "自动合成数据生成、指令对与问答样本合成。",
      installedVersion: null,
      availableVersion: "0.1.0",
      downloadBytes: null,
      status: "available",
      supportedPlatforms: ["linux", "windows", "darwin"],
      compatibleWithCurrentPlatform: true,
    },
    {
      id: KNOWN_COMPONENT_IDS.knowledgePreparation,
      name: "Knowledge Preparation",
      nameCn: "知识库准备",
      description: "Passage chunking, embedding generation, and vector index preparation for knowledge bases.",
      descriptionCn: "段落切分、向量嵌入生成与知识库向量索引准备。",
      installedVersion: null,
      availableVersion: "0.1.0",
      downloadBytes: null,
      status: "available",
      supportedPlatforms: ["linux", "windows", "darwin"],
      compatibleWithCurrentPlatform: true,
    },
    {
      id: KNOWN_COMPONENT_IDS.datasetValidator,
      name: "Dataset Validator",
      nameCn: "数据集校验器",
      description: "Schema validation and quality checks for prepared datasets.",
      descriptionCn: "已准备数据集的 schema 验证与质量检查。",
      installedVersion: null,
      availableVersion: "0.1.0",
      downloadBytes: null,
      status: "available",
      supportedPlatforms: ["linux", "windows", "darwin"],
      compatibleWithCurrentPlatform: true,
    },
    {
      id: KNOWN_COMPONENT_IDS.exactMatch,
      name: "Exact Match Evaluation Runner",
      nameCn: "精确匹配评测引擎",
      description: "Stateless exact-match evaluation over Product-supplied JSON records.",
      descriptionCn: "对 Product 提供的 JSON 记录执行无状态精确匹配评测。",
      installedVersion: null,
      availableVersion: "0.1.0",
      downloadBytes: null,
      status: "available",
      supportedPlatforms: ["linux", "windows", "darwin"],
      compatibleWithCurrentPlatform: true,
    },
    {
      id: KNOWN_COMPONENT_IDS.evaluatorPack,
      name: "Evaluator Pack",
      nameCn: "评测工具包",
      description: "Collection of bundled evaluation strategies.",
      descriptionCn: "评测策略合集包。",
      installedVersion: null,
      availableVersion: null,
      downloadBytes: null,
      status: "available",
      supportedPlatforms: ["linux", "windows", "darwin"],
      compatibleWithCurrentPlatform: true,
    },
    {
      id: KNOWN_COMPONENT_IDS.llmJudge,
      name: "LLM Judge",
      nameCn: "LLM 裁判",
      description: "Large language model-based evaluation judge.",
      descriptionCn: "基于大语言模型的评测裁判。",
      installedVersion: null,
      availableVersion: null,
      downloadBytes: null,
      status: "available",
      supportedPlatforms: ["linux", "windows", "darwin"],
      compatibleWithCurrentPlatform: true,
    },
    {
      id: KNOWN_COMPONENT_IDS.llamaFactory,
      name: "LLaMA-Factory Training",
      nameCn: "LLaMA-Factory 训练",
      description: "Fine-tuning runner backed by LLaMA-Factory.",
      descriptionCn: "由 LLaMA-Factory 驱动的微调运行器。",
      installedVersion: null,
      availableVersion: null,
      downloadBytes: null,
      status: "available",
      supportedPlatforms: ["linux"],
      compatibleWithCurrentPlatform: true,
    },
    {
      id: KNOWN_COMPONENT_IDS.modelApiConnector,
      name: "Model API Connector",
      nameCn: "模型 API 连接器",
      description: "Connector for external model API providers.",
      descriptionCn: "外部模型 API 提供商连接器。",
      installedVersion: null,
      availableVersion: null,
      downloadBytes: null,
      status: "available",
      supportedPlatforms: ["linux", "windows", "darwin"],
      compatibleWithCurrentPlatform: true,
    },
    {
      id: KNOWN_COMPONENT_IDS.vllmRuntime,
      name: "vLLM Serving Runtime",
      nameCn: "vLLM 推理运行时",
      description: "High-throughput LLM serving powered by vLLM.",
      descriptionCn: "由 vLLM 驱动的高吞吐量模型推理服务。",
      installedVersion: null,
      availableVersion: null,
      downloadBytes: null,
      status: "available",
      supportedPlatforms: ["linux"],
      compatibleWithCurrentPlatform: true,
    },
    {
      id: KNOWN_COMPONENT_IDS.hfModelAnalyzer,
      name: "HF Model Analyzer",
      nameCn: "HF 模型分析器",
      description: "Hugging Face model inspection and compatibility analysis.",
      descriptionCn: "Hugging Face 模型检查与兼容性分析工具。",
      installedVersion: null,
      availableVersion: null,
      downloadBytes: null,
      status: "available",
      supportedPlatforms: ["linux", "windows", "darwin"],
      compatibleWithCurrentPlatform: true,
    },
    {
      id: KNOWN_COMPONENT_IDS.compatRules,
      name: "Compatibility Rules",
      nameCn: "兼容性规则",
      description: "Platform compatibility evaluation rules engine.",
      descriptionCn: "平台兼容性评估规则引擎。",
      installedVersion: null,
      availableVersion: null,
      downloadBytes: null,
      status: "available",
      supportedPlatforms: ["linux", "windows", "darwin"],
      compatibleWithCurrentPlatform: true,
    },
  ],
};
