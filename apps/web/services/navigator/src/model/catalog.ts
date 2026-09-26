import { z } from "zod";

export type ArtifactKind = "dataset" | "model" | "compute" | "evaluation" | "endpoint" | "agent-report";
export interface Port {
  name: string;
  label: string;
  kind: ArtifactKind;
}
export interface Field {
  name: string;
  label: string;
  kind: "text" | "number" | "select";
  choices?: string[];
}
export interface NodeDefinition {
  type: string;
  version: "1";
  title: string;
  owner: string;
  serviceId: "catalyst" | "yield" | "echo" | "reactor" | "exchange" | "navigator" | "client";
  category: string;
  description: string;
  color: string;
  inputs: Port[];
  outputs: Port[];
  fields: Field[];
  defaults: Record<string, string | number>;
  configSchema: z.ZodTypeAny;
}

const text = z.string().trim().min(1).max(300);

export const catalog: NodeDefinition[] = [
  {
    type: "dataset",
    version: "1",
    title: "数据集版本",
    owner: "Catalyst",
    serviceId: "catalyst",
    category: "数据与模型",
    color: "#50bfaa",
    description: "从 Catalyst 读取已发布数据版本，或在本地填写数据集引用。",
    inputs: [],
    outputs: [{ name: "dataset", label: "数据集", kind: "dataset" }],
    fields: [{ name: "datasetRef", label: "数据集版本引用", kind: "text" }],
    defaults: { datasetRef: "demo://datasets/instruction-v1" },
    configSchema: z.object({ datasetRef: text }).strict(),
  },
  {
    type: "model",
    version: "1",
    title: "基础模型",
    owner: "Reactor",
    serviceId: "reactor",
    category: "数据与模型",
    color: "#68b6db",
    description: "选择 Reactor 已导入的基础模型制品。读取模型设置不会下载模型。",
    inputs: [],
    outputs: [{ name: "model", label: "模型", kind: "model" }],
    fields: [{ name: "modelRef", label: "模型版本引用", kind: "text" }],
    defaults: { modelRef: "demo://models/base-1.5b" },
    configSchema: z.object({ modelRef: text }).strict(),
  },
  {
    type: "compute",
    version: "1",
    title: "算力配置",
    owner: "Client",
    serviceId: "client",
    category: "资源",
    color: "#daac66",
    description: "声明目标算力环境规格；支持本地资源池、自管服务器与云算力平台。",
    inputs: [],
    outputs: [{ name: "compute", label: "算力配置", kind: "compute" }],
    fields: [
      { name: "provider", label: "目标环境", kind: "select", choices: ["本地资源池", "云算力平台", "自管服务器"] },
      { name: "accelerator", label: "加速卡规格", kind: "text" },
      { name: "count", label: "加速卡数量", kind: "number" },
    ],
    defaults: { provider: "本地资源池", accelerator: "NVIDIA A100 · 80GB", count: 1 },
    configSchema: z.object({
      provider: z.enum(["本地资源池", "云算力平台", "自管服务器"]),
      accelerator: text,
      count: z.number().int().min(1).max(1024),
    }).strict(),
  },
  {
    type: "training",
    version: "1",
    title: "模型微调",
    owner: "Yield",
    serviceId: "yield",
    category: "训练与评估",
    color: "#aaa0ee",
    description: "编辑微调超参数，读取并保存 Yield 草稿；训练由 Yield 调度执行。",
    inputs: [
      { name: "dataset", label: "训练数据", kind: "dataset" },
      { name: "model", label: "基础模型", kind: "model" },
      { name: "compute", label: "训练算力", kind: "compute" },
    ],
    outputs: [{ name: "model", label: "模型版本", kind: "model" }],
    fields: [
      { name: "method", label: "训练方式", kind: "select", choices: ["LoRA", "Full"] },
      { name: "epochs", label: "训练轮数", kind: "number" },
      { name: "learningRate", label: "学习率", kind: "number" },
      { name: "perDeviceBatchSize", label: "单卡批次大小", kind: "number" },
      { name: "loraRank", label: "LoRA Rank", kind: "number" },
    ],
    defaults: { method: "LoRA", epochs: 3, learningRate: 0.0002, perDeviceBatchSize: 4, loraRank: 16 },
    configSchema: z.object({
      method: z.enum(["LoRA", "Full"]),
      epochs: z.number().positive().max(10000),
      learningRate: z.number().positive().max(1),
      perDeviceBatchSize: z.number().int().min(1).max(64).optional(),
      loraRank: z.number().int().min(1).max(512).optional(),
    }).passthrough(),
  },
  {
    type: "evaluation",
    version: "1",
    title: "质量评估",
    owner: "Echo",
    serviceId: "echo",
    category: "训练与评估",
    color: "#aaa0ee",
    description: "读取 Echo 评估规则或配置新测试集；流程预演对齐质量门禁指标。",
    inputs: [
      { name: "model", label: "待评估模型", kind: "model" },
      { name: "dataset", label: "评估数据", kind: "dataset" },
    ],
    outputs: [{ name: "evaluation", label: "评估结果", kind: "evaluation" }],
    fields: [
      { name: "suite", label: "评估集名称", kind: "text" },
      { name: "evaluator", label: "评估器", kind: "select", choices: ["exact_match.v1", "llm_judge.v1"] },
      { name: "threshold", label: "通过阈值", kind: "number" },
    ],
    defaults: { suite: "通用指令遵循基准", evaluator: "exact_match.v1", threshold: 0.8 },
    configSchema: z.object({
      suite: text,
      evaluator: z.enum(["exact_match.v1", "llm_judge.v1"]).optional(),
      threshold: z.number().min(0).max(1).optional(),
    }).passthrough(),
  },
  {
    type: "deployment",
    version: "1",
    title: "推理部署",
    owner: "Reactor",
    serviceId: "reactor",
    category: "发布与运维",
    color: "#7fafda",
    description: "声明推理部署规格并与 Reactor 推理节点绑定；上线供网关接入。",
    inputs: [
      { name: "model", label: "模型版本", kind: "model" },
      { name: "evaluation", label: "评估结果", kind: "evaluation" },
      { name: "compute", label: "部署算力", kind: "compute" },
    ],
    outputs: [{ name: "endpoint", label: "推理端点", kind: "endpoint" }],
    fields: [
      { name: "name", label: "部署服务名", kind: "text" },
      { name: "servingBindingId", label: "推理绑定标识", kind: "text" },
    ],
    defaults: { name: "cyrene-fast-serving-v1" },
    configSchema: z.object({
      name: text,
      servingBindingId: z.string().max(200).optional(),
    }).passthrough(),
  },
  {
    type: "exchange_gateway",
    version: "1",
    title: "API 网关接入",
    owner: "Exchange",
    serviceId: "exchange",
    category: "发布与运维",
    color: "#48c774",
    description: "在 Exchange 中配置公共/私有 OpenAI 兼容网关路由及凭据鉴权。",
    inputs: [{ name: "endpoint", label: "推理端点", kind: "endpoint" }],
    outputs: [{ name: "endpoint", label: "网关公网端点", kind: "endpoint" }],
    fields: [
      { name: "modelId", label: "对外公开模型名", kind: "text" },
      { name: "requireApiKey", label: "是否强制 Key 鉴权", kind: "select", choices: ["true", "false"] },
    ],
    defaults: { modelId: "cyrene-chat-default", requireApiKey: "true" },
    configSchema: z.object({
      modelId: text,
      requireApiKey: z.string().optional(),
    }).passthrough(),
  },
  {
    type: "agent",
    version: "1",
    title: "Agent 对话",
    owner: "Navigator",
    serviceId: "navigator",
    category: "体验与对话",
    color: "#d693b1",
    description: "接入 Navigator AI 对话交互界面，直接与已部署的模型或 Agent 进行测试。",
    inputs: [{ name: "endpoint", label: "网关端点", kind: "endpoint" }],
    outputs: [{ name: "report", label: "对话测试记录", kind: "agent-report" }],
    fields: [{ name: "task", label: "预设系统提示词", kind: "text" }],
    defaults: { task: "你是一个友好高效的 Cyrene 智能助手。" },
    configSchema: z.object({ task: text }).passthrough(),
  },
];

export const definitions = new Map(catalog.map((d) => [d.type, d]));
if (definitions.has("exchange_gateway") && !definitions.has("gateway")) {
  definitions.set("gateway", definitions.get("exchange_gateway")!);
}
