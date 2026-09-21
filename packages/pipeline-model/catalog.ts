import { z } from "zod";

export type ArtifactKind = "dataset" | "model" | "compute" | "evaluation" | "endpoint" | "agent-report";
export interface Port { name: string; label: string; kind: ArtifactKind }
export interface Field { name: string; label: string; kind: "text" | "number" | "select"; choices?: string[] }
export interface NodeDefinition {
  type: string; version: "1"; title: string; owner: string; category: string; description: string; color: string;
  inputs: Port[]; outputs: Port[]; fields: Field[];
  defaults: Record<string, string | number>;
  configSchema: z.ZodTypeAny;
}
const text = z.string().trim().min(1).max(300);
export const catalog: NodeDefinition[] = [
  {
    type: "dataset", version: "1", title: "数据集版本", owner: "Catalyst", category: "数据与模型", color: "#50bfaa",
    description: "从 Catalyst 读取已发布数据版本，或在本地填写数据集引用。",
    inputs: [], outputs: [{ name: "dataset", label: "数据集", kind: "dataset" }],
    fields: [{ name: "datasetRef", label: "数据集版本引用", kind: "text" }],
    defaults: { datasetRef: "demo://datasets/instruction-v1" }, configSchema: z.object({ datasetRef: text }).strict(),
  },
  {
    type: "model", version: "1", title: "基础模型", owner: "Yield", category: "数据与模型", color: "#68b6db",
    description: "可选择 Reactor 已导入的基础模型。读取模型设置不会下载模型。",
    inputs: [], outputs: [{ name: "model", label: "模型", kind: "model" }],
    fields: [{ name: "modelRef", label: "模型版本引用", kind: "text" }],
    defaults: { modelRef: "demo://models/base-1.5b" }, configSchema: z.object({ modelRef: text }).strict(),
  },
  {
    type: "compute", version: "1", title: "算力配置", owner: "Studio / 待接入", category: "资源", color: "#daac66",
    description: "声明目标算力并查看 Web Host 本机 GPU；云算力分配尚未接入。",
    inputs: [], outputs: [{ name: "compute", label: "算力配置", kind: "compute" }],
    fields: [{ name: "provider", label: "目标环境", kind: "select", choices: ["本地资源池", "云算力平台", "自管服务器"] }, { name: "accelerator", label: "加速卡规格", kind: "text" }, { name: "count", label: "加速卡数量", kind: "number" }],
    defaults: { provider: "本地资源池", accelerator: "示例 GPU · 24 GB", count: 1 },
    configSchema: z.object({ provider: z.enum(["本地资源池", "云算力平台", "自管服务器"]), accelerator: text, count: z.number().int().min(1).max(1024) }).strict(),
  },
  {
    type: "training", version: "1", title: "模型微调", owner: "Yield", category: "训练与评估", color: "#aaa0ee",
    description: "编辑微调参数，可读取并保存 Yield 草稿；训练仍由 Yield 管理。",
    inputs: [{ name: "dataset", label: "训练数据", kind: "dataset" }, { name: "model", label: "基础模型", kind: "model" }, { name: "compute", label: "训练算力", kind: "compute" }],
    outputs: [{ name: "model", label: "模型版本", kind: "model" }],
    fields: [{ name: "method", label: "训练方式", kind: "select", choices: ["LoRA", "Full"] }, { name: "epochs", label: "训练轮数", kind: "number" }, { name: "learningRate", label: "学习率", kind: "number" }, { name: "perDeviceBatchSize", label: "单卡批次大小", kind: "number" }, { name: "gradientAccumulationSteps", label: "梯度累积步数", kind: "number" }, { name: "maxSequenceLength", label: "最大序列长度", kind: "number" }, { name: "loraRank", label: "LoRA Rank", kind: "number" }, { name: "loraAlpha", label: "LoRA Alpha", kind: "number" }, { name: "loraDropout", label: "LoRA Dropout", kind: "number" }, { name: "template", label: "训练模板", kind: "text" }],
    defaults: { method: "LoRA", epochs: 3, learningRate: 0.0002 },
    configSchema: z.object({ method: z.enum(["LoRA", "Full"]), epochs: z.number().positive().max(10000), learningRate: z.number().positive().max(1), perDeviceBatchSize: z.number().int().min(1).max(64).optional(), gradientAccumulationSteps: z.number().int().min(1).max(1024).optional(), maxSequenceLength: z.number().int().min(16).max(32768).optional(), loraRank: z.number().int().min(1).max(512).optional(), loraAlpha: z.number().int().positive().optional(), loraDropout: z.number().min(0).max(1).optional(), template: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional() }).strict(),
  },
  {
    type: "evaluation", version: "1", title: "质量评估", owner: "Echo", category: "训练与评估", color: "#aaa0ee",
    description: "读取 Echo 评估配置或另存新配置；流程预演不计算真实指标。",
    inputs: [{ name: "model", label: "待评估模型", kind: "model" }, { name: "dataset", label: "评估数据", kind: "dataset" }],
    outputs: [{ name: "evaluation", label: "评估结果", kind: "evaluation" }],
    fields: [{ name: "suite", label: "评估集名称", kind: "text" }, { name: "evaluator", label: "评估器", kind: "select", choices: ["exact_match.v1", "llm_judge.v1"] }, { name: "expectedField", label: "预期答案字段", kind: "text" }, { name: "actualField", label: "实际答案字段", kind: "text" }, { name: "threshold", label: "通过阈值", kind: "number" }, { name: "judgeProfileId", label: "Judge 配置 ID（LLM 评估必填）", kind: "text" }],
    defaults: { suite: "示例指令遵循评估", evaluator: "exact_match.v1", expectedField: "expected", actualField: "actual", threshold: 0.8 },
    configSchema: z.object({ suite: text, evaluator: z.enum(["exact_match.v1", "llm_judge.v1"]).optional(), expectedField: text.optional(), actualField: text.optional(), threshold: z.number().min(0).max(1).optional(), judgeProfileId: z.union([z.literal(""), z.string().uuid()]).optional() }).strict(),
  },
  {
    type: "deployment", version: "1", title: "推理部署", owner: "Reactor", category: "发布与 Agent", color: "#7fafda",
    description: "声明部署依赖；真正的评估门禁、发布审批和部署需在服务端接入。",
    inputs: [{ name: "model", label: "模型版本", kind: "model" }, { name: "evaluation", label: "评估结果", kind: "evaluation" }, { name: "compute", label: "部署算力", kind: "compute" }],
    outputs: [{ name: "endpoint", label: "推理端点", kind: "endpoint" }],
    fields: [{ name: "name", label: "部署名称", kind: "text" }, { name: "servingBindingId", label: "推理服务绑定", kind: "text" }],
    defaults: { name: "instruction-model-preview" }, configSchema: z.object({ name: text, servingBindingId: z.string().max(200).optional() }).strict(),
  },
  {
    type: "agent", version: "1", title: "Agent 测试", owner: "Navigator", category: "发布与 Agent", color: "#d693b1",
    description: "定义面向模型端点的 Agent 测试目标；不调用工具或发送消息。",
    inputs: [{ name: "endpoint", label: "模型端点", kind: "endpoint" }], outputs: [{ name: "report", label: "测试报告", kind: "agent-report" }],
    fields: [{ name: "task", label: "测试任务", kind: "text" }],
    defaults: { task: "检查指令遵循与工具调用计划" }, configSchema: z.object({ task: text }).strict(),
  },
];
export const definitions = new Map(catalog.map((d) => [d.type, d]));
