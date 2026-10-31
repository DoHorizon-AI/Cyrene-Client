import { z } from "zod";
import { edgeSchema, nodeSchema, pipelineSchema, positionSchema } from "../pipeline-model";
import { identifier } from "../server-control/contracts";
import { contributionSchema } from "../node-registry/contracts";

const revision = z.number().int().positive();
export const graphSchema = pipelineSchema.omit({ presentation: true });
export const recordSchema = z.object({
  workspaceId: identifier, graphRevision: revision, layoutRevision: revision,
  document: pipelineSchema, updatedAt: z.string().datetime(), updatedBy: identifier,
}).strict();
export type PipelineRecord = z.infer<typeof recordSchema>;
const workspace = z.object({ workspaceId: identifier }).strict();
const target = workspace.extend({ pipelineId: identifier });
const expected = target.extend({ expectedGraphRevision: revision.describe("Current graphRevision from pipelines_get. Reread and reconcile after REVISION_CONFLICT."), expectedLayoutRevision: revision.describe("Current layoutRevision from pipelines_get. Graph and layout revisions are independent.") });
export const nodeTypeSchema = contributionSchema.omit({ execution: true }).extend({
  active: z.boolean().describe("Whether this is the active catalog version for new nodes."),
  configSchema: z.record(z.unknown()).describe("JSON Schema used to validate this node's config; shared with the visual editor."),
  packageRef: z.object({ id: z.string(), version: z.string() }).strict().optional(),
  execution: contributionSchema.shape.execution.optional(),
}).strict();
export const editSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add_node"), node: nodeSchema, position: positionSchema.optional() }).strict(),
  z.object({ op: z.literal("update_node"), nodeId: identifier, label: nodeSchema.shape.label.optional(), config: nodeSchema.shape.config.optional(), settingsBinding: nodeSchema.shape.settingsBinding.nullable().optional() }).strict(),
  z.object({ op: z.literal("remove_node"), nodeId: identifier }).strict(),
  z.object({ op: z.literal("connect"), edge: edgeSchema }).strict(),
  z.object({ op: z.literal("disconnect"), edgeId: identifier }).strict(),
  z.object({ op: z.literal("rename"), name: pipelineSchema.shape.name }).strict(),
]);
export const layoutOptions = z.object({ direction: z.enum(["RIGHT", "DOWN"]).default("RIGHT"), nodeIds: z.array(identifier).min(1).max(200).optional() }).strict();
const resultSchema = z.object({ record: recordSchema, summary: z.array(z.string()) }).strict();
export const pipelineCommands = {
  "pipelines.compile": { requiredScopes: ["pipelines.read"], effects: "read", external: false, input: target, output: z.object({ pipelineId: identifier, graphRevision: revision, order: z.array(identifier), issues: z.array(z.object({ code: z.string(), message: z.string(), nodeId: z.string().optional() })), nodes: z.array(z.object({ nodeId: identifier, type: z.string(), typeVersion: z.string().optional(), adapter: z.string().optional(), kind: z.string().optional(), image: z.string().optional(), dependencies: z.array(identifier) })), executable: z.literal(false) }), readOnly: true, description: "编译已保存图的依赖与固定节点版本、镜像；资源就绪性须另行 runs.preflight。" },
  "nodes.list_types": { requiredScopes: ["pipelines.read"], effects: "read", external: false, input: workspace, output: z.object({ items: z.array(nodeTypeSchema) }), readOnly: true, description: "读取与界面节点库共用的节点类型、端口、参数 JSON Schema 与默认值。新增节点使用 active=true 的版本、title 作为默认 label、defaults 作为默认配置；没有 MCP 专用节点。" },
  "pipelines.list": { requiredScopes: ["pipelines.read"], effects: "read", external: false, input: workspace, output: z.object({ items: z.array(recordSchema.omit({ document: true }).extend({ id: identifier, name: z.string() })) }), readOnly: true, description: "列出已保存的工作空间流水线。" },
  "pipelines.get": { requiredScopes: ["pipelines.read"], effects: "read", external: false, input: target, output: recordSchema, readOnly: true, description: "读取流水线及独立的流程/布局修订号。" },
  "pipelines.create": { requiredScopes: ["pipelines.write"], effects: "additive", external: false, input: workspace.extend({ document: pipelineSchema }), output: resultSchema, readOnly: false, description: "创建草稿。不会创建训练任务或申请算力。" },
  "pipelines.save": { requiredScopes: ["pipelines.write"], effects: "destructive", external: false, input: expected.extend({ graph: graphSchema.optional(), presentation: pipelineSchema.shape.presentation.optional(), mergeIndependent: z.boolean().optional() }), output: resultSchema, readOnly: false, description: "保存指定文档域；可基于服务端历史合并不同节点修改，同一节点冲突不覆盖。" },
  "pipelines.patch": { requiredScopes: ["pipelines.write"], effects: "destructive", external: false, input: expected.extend({ edits: z.array(editSchema).min(1).max(200) }), output: resultSchema, readOnly: false, description: "原子批量增删节点、修改参数与连接；失败整批回滚。新增节点与界面共用类型和校验，先读取 nodes.list_types，默认使用其 title 和 defaults，按用户要求覆盖。不要因通过 MCP 添加而另造类型或添加 MCP 测试名称。新增节点可省略位置，之后调用 layout。" },
  "pipelines.layout": { requiredScopes: ["pipelines.write"], effects: "update", external: false, input: expected.extend({ options: layoutOptions.default({}) }), output: resultSchema, readOnly: false, description: "自动排版全部或选定节点，保留 pinned 节点与范围外位置。" },
  "pipelines.preview_layout": { requiredScopes: ["pipelines.read"], effects: "read", external: false, input: workspace.extend({ document: pipelineSchema, options: layoutOptions.default({}) }), output: z.object({ document: pipelineSchema }), readOnly: true, description: "仅计算布局，不修改服务端草稿。" },
  "pipelines.validate": { requiredScopes: ["pipelines.read"], effects: "read", external: false, input: target, output: z.object({ issues: z.array(z.object({ code: z.string(), message: z.string(), nodeId: z.string().optional() })), order: z.array(z.string()), executable: z.literal(false) }), readOnly: true, description: "校验 DAG、端口与参数；不代表真实资源就绪，当前不可远端执行。" },
  "pipelines.history": { requiredScopes: ["pipelines.read"], effects: "read", external: false, input: target, output: z.object({ items: z.array(z.object({ id: identifier, command: z.string(), actorId: identifier, at: z.string(), graphRevision: revision, layoutRevision: revision, summary: z.array(z.string()) })) }), readOnly: true, description: "读取最近 50 次草稿变更记录。" },
  "pipelines.undo": { requiredScopes: ["pipelines.write"], effects: "destructive", external: false, input: expected, output: resultSchema, readOnly: false, description: "撤销当前操作者最近一批修改；保留他人独立编辑，重叠修改拒绝覆盖，修订号递增。不撤销外部任务。" },
  "pipelines.redo": { requiredScopes: ["pipelines.write"], effects: "destructive", external: false, input: expected, output: resultSchema, readOnly: false, description: "重做最近撤销的一批草稿修改；新的普通写入会清空重做栈。" },
} as const;
export type PipelineCommand = keyof typeof pipelineCommands;
export type PipelineOutput<N extends PipelineCommand> = z.infer<(typeof pipelineCommands)[N]["output"]>;
export const pipelineRequest = z.object({ name: z.string(), input: z.unknown(), requestId: identifier, idempotencyKey: identifier.optional() }).strict();
