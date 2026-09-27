import { z } from "zod";
import { definitions } from "./catalog";

export const STORAGE_KEY = "cyrene.client.pipeline.v1";

const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/)
  .refine((value) => !["__proto__", "constructor", "prototype"].includes(value), "保留标识不能作为流程或节点 ID");

export const nodeSchema = z
  .object({
    id,
    type: z.string().min(1).max(100),
    typeVersion: z.literal("1"),
    label: z.string().trim().min(1).max(80),
    config: z.record(z.union([z.string().max(1000), z.number().finite()])),
    settingsBinding: z
      .object({
        kind: z.enum([
          "dataset-version",
          "model-import",
          "training-draft",
          "evaluation-suite",
          "serving-binding",
          "navigator-session",
          "server-registration",
        ]),
        resourceId: z.string().min(1).max(512),
        workspaceId: z.string().min(1).max(512).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const endpointSchema = z
  .object({
    node: id,
    port: z.string().min(1).max(100),
  })
  .strict();

export const positionSchema = z
  .object({
    x: z.number().finite().min(-100000).max(100000),
    y: z.number().finite().min(-100000).max(100000),
    pinned: z.boolean().optional(),
  })
  .strict();

export const edgeSchema = z
  .object({
    id,
    from: endpointSchema,
    to: endpointSchema,
  })
  .strict();

export const pipelineSchema = z
  .object({
    schemaVersion: z.literal("cyrene.pipeline.prototype.v1"),
    id,
    name: z.string().trim().min(1).max(100),
    nodes: z.array(nodeSchema).max(200),
    edges: z.array(edgeSchema).max(1000),
    presentation: z
      .object({
        nodes: z.record(id, positionSchema),
      })
      .strict(),
  })
  .strict();

export type Pipeline = z.infer<typeof pipelineSchema>;
export type PipelineNode = Pipeline["nodes"][number];
export type Edge = Pipeline["edges"][number];
export type Position = z.infer<typeof positionSchema>;

export interface Issue {
  code: string;
  message: string;
  nodeId?: string;
}

export function inspect(p: Pipeline): { issues: Issue[]; order: string[] } {
  const issues: Issue[] = [];
  const fail = (code: string, message: string, nodeId?: string) => issues.push({ code, message, nodeId });
  const nodes = new Map<string, PipelineNode>();

  if (!p.name?.trim()) fail("NAME", "请填写流水线名称。");
  if (!p.nodes || !p.nodes.length) fail("EMPTY", "请先添加节点。");

  for (const n of p.nodes || []) {
    if (nodes.has(n.id)) fail("DUPLICATE_NODE", "节点 ID 重复。", n.id);
    nodes.set(n.id, n);

    const bindingKinds: Record<string, string> = {
      dataset: "dataset-version",
      model: "model-import",
      training: "training-draft",
      evaluation: "evaluation-suite",
      deployment: "serving-binding",
      exchange_gateway: "server-registration",
      gateway: "server-registration",
      agent: "navigator-session",
      compute: "server-registration",
    };
    if (n.settingsBinding && bindingKinds[n.type] && n.settingsBinding.kind !== bindingKinds[n.type]) {
      fail("BINDING", "服务资源绑定与节点类型不匹配。", n.id);
    }

    const d = definitions.get(n.type) || (n.type === "gateway" ? definitions.get("exchange_gateway") : undefined);
    if (!d || n.typeVersion !== d.version) {
      fail("UNKNOWN_TYPE", `不支持的节点类型或版本：${n.type}`, n.id);
      continue;
    }
    const config = d.configSchema.safeParse(n.config);
    if (!config.success) {
      for (const e of config.error.issues) {
        fail("CONFIG", `${n.label}：${e.path.join(".") || "参数"} ${e.message}`, n.id);
      }
    }
  }

  const connected = new Set<string>();
  const edgeIds = new Set<string>();
  const indegree = new Map((p.nodes || []).map((n) => [n.id, 0]));
  const next = new Map((p.nodes || []).map((n) => [n.id, [] as string[]]));

  for (const e of p.edges || []) {
    if (edgeIds.has(e.id)) fail("DUPLICATE_EDGE", "连线 ID 重复。");
    edgeIds.add(e.id);

    const source = nodes.get(e.from.node);
    const target = nodes.get(e.to.node);
    if (!source || !target) {
      fail("DANGLING_EDGE", "连线引用了不存在的节点。");
      continue;
    }

    const sourceDef = definitions.get(source.type) || (source.type === "gateway" ? definitions.get("exchange_gateway") : undefined);
    const targetDef = definitions.get(target.type) || (target.type === "gateway" ? definitions.get("exchange_gateway") : undefined);

    const output = sourceDef?.outputs.find((x) => x.name === e.from.port);
    const input = targetDef?.inputs.find((x) => x.name === e.to.port);
    if (!output || !input) {
      fail("UNKNOWN_PORT", "连线引用了不存在的端口。", target.id);
      continue;
    }
    if (output.kind !== input.kind) {
      fail("PORT_TYPE", `${source.label} → ${target.label} 的数据类型不匹配。`, target.id);
      continue;
    }

    const key = `${target.id}:${input.name}`;
    if (connected.has(key)) {
      fail("MULTIPLE_INPUT", `${target.label} 的 ${input.label} 只能连接一个来源。`, target.id);
    }
    connected.add(key);
    next.get(source.id)!.push(target.id);
    indegree.set(target.id, indegree.get(target.id)! + 1);
  }

  for (const n of p.nodes || []) {
    const nodeDef = definitions.get(n.type) || (n.type === "gateway" ? definitions.get("exchange_gateway") : undefined);
    for (const port of nodeDef?.inputs ?? []) {
      if (!connected.has(`${n.id}:${port.name}`)) {
        fail("MISSING_INPUT", `${n.label} 缺少「${port.label}」连接。`, n.id);
      }
    }
  }

  const queue = [...indegree].filter(([, degree]) => !degree).map(([key]) => key);
  const order: string[] = [];
  for (let i = 0; i < queue.length; i++) {
    const key = queue[i];
    order.push(key);
    for (const child of next.get(key) ?? []) {
      const degree = indegree.get(child)! - 1;
      indegree.set(child, degree);
      if (!degree) queue.push(child);
    }
  }

  if (order.length !== nodes.size) {
    fail("CYCLE", "流程存在循环依赖；当前仅支持有向无环图。");
  }

  return { issues, order: issues.length ? [] : order };
}

export function parsePipeline(value: unknown): Pipeline {
  const p = pipelineSchema.parse(value);
  const errors = inspect(p).issues.filter((i) => i.code !== "MISSING_INPUT" && i.code !== "EMPTY" && i.code !== "CYCLE");
  if (errors.length) {
    throw new Error(errors.map((i) => i.message).join("\n"));
  }
  for (const n of p.nodes) {
    if (!p.presentation.nodes[n.id]) {
      throw new Error(`节点 ${n.id} 缺少布局。`);
    }
  }
  for (const key of Object.keys(p.presentation.nodes)) {
    if (!p.nodes.some((n) => n.id === key)) {
      throw new Error("布局包含未知节点。");
    }
  }
  return p;
}

export function createNode(
  type: string,
  nodeId: string = crypto.randomUUID(),
  config?: Record<string, string | number>,
  settingsBinding?: PipelineNode["settingsBinding"]
): PipelineNode {
  const resolvedType = (type === "gateway" && !definitions.has("gateway")) ? "exchange_gateway" : type;
  const d = definitions.get(resolvedType);
  if (!d) throw new Error(`未知节点类型 ${type}`);
  return {
    id: nodeId,
    type: d.type,
    typeVersion: d.version,
    label: d.title,
    config: { ...d.defaults, ...(config || {}) },
    ...(settingsBinding ? { settingsBinding } : {}),
  };
}

export function examplePipeline(): Pipeline {
  const nodeTypes = ["dataset", "model", "compute", "training", "evaluation", "deployment", "exchange_gateway", "agent"];
  const nodes = nodeTypes.map((t) => createNode(t, t));
  const edges: Edge[] = [];
  const connect = (source: string, port: string, target: string, input = port) => {
    edges.push({
      id: `edge-${edges.length + 1}`,
      from: { node: source, port },
      to: { node: target, port: input },
    });
  };

  connect("dataset", "dataset", "training");
  connect("model", "model", "training");
  connect("compute", "compute", "training");
  connect("training", "model", "evaluation");
  connect("dataset", "dataset", "evaluation");
  connect("training", "model", "deployment");
  connect("evaluation", "evaluation", "deployment");
  connect("compute", "compute", "deployment");
  connect("deployment", "endpoint", "exchange_gateway");
  connect("exchange_gateway", "endpoint", "agent");

  const positions: [number, number][] = [
    [40, 80],
    [40, 260],
    [40, 440],
    [380, 220],
    [720, 80],
    [1060, 220],
    [1400, 220],
    [1740, 220],
  ];

  return {
    schemaVersion: "cyrene.pipeline.prototype.v1",
    id: "instruction-tuning",
    name: "指令微调与 Agent 验证",
    nodes,
    edges,
    presentation: {
      nodes: Object.fromEntries(nodes.map((n, i) => [n.id, { x: positions[i][0], y: positions[i][1] }])),
    },
  };
}

export function loadStoredPipeline(): Pipeline {
  if (typeof window === "undefined" || !window.localStorage) {
    return examplePipeline();
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return examplePipeline();
    const data = JSON.parse(raw);
    const parsed = pipelineSchema.safeParse(data);
    if (parsed.success) {
      const p = parsed.data;
      for (let i = 0; i < p.nodes.length; i++) {
        const n = p.nodes[i];
        if (!p.presentation.nodes[n.id]) {
          p.presentation.nodes[n.id] = { x: 40 + (i % 4) * 340, y: 80 + Math.floor(i / 4) * 180 };
        }
      }
      return p;
    }
    return examplePipeline();
  } catch (e) {
    console.warn("Failed to load stored pipeline, using example pipeline", e);
    return examplePipeline();
  }
}

export function saveStoredPipeline(pipeline: Pipeline): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pipeline));
  } catch (e) {
    console.error("Failed to save pipeline to localStorage", e);
  }
}

export function clearStoredPipeline(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.error("Failed to clear pipeline from localStorage", e);
  }
}
