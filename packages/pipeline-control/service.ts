import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { inspect, parsePipeline, type Pipeline } from "../pipeline-model";
import { catalog } from "../pipeline-model/catalog";
import { ControlError, type Actor } from "../server-control/contracts";
import { pipelineCommands, pipelineRequest, recordSchema, type PipelineCommand, type PipelineRecord } from "./contracts";
import { arrange } from "./layout";

const historyEntry = z.object({ id: z.string(), workspaceId: z.string(), pipelineId: z.string(), command: z.string(), actorId: z.string(), at: z.string(), graphRevision: z.number(), layoutRevision: z.number(), summary: z.array(z.string()), before: recordSchema.nullable(), undone: z.boolean() });
export const pipelineDatabase = z.object({ version: z.literal(1), records: z.array(recordSchema), history: z.array(historyEntry), receipts: z.array(z.object({ key: z.string(), fingerprint: z.string(), result: z.object({ record: recordSchema, summary: z.array(z.string()) }) })) }).strict();
export type PipelineDatabase = z.infer<typeof pipelineDatabase>;
export const emptyPipelineDatabase = (): PipelineDatabase => ({ version: 1, records: [], history: [], receipts: [] });
export interface PipelineStore { read(): Promise<PipelineDatabase>; transact<T>(operation: (db: PipelineDatabase) => T): Promise<T> }
const graphOf = ({ presentation: _, ...graph }: Pipeline) => graph;
export function equal(a: unknown, b: unknown): boolean {
  const ordered = (v: any): any => Array.isArray(v) ? v.map(ordered) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, ordered(v[k])])) : v;
  return JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
}
function validDocument(value: unknown) {
  try { return parsePipeline(value); }
  catch (e) { throw new ControlError("INVALID_PIPELINE", e instanceof Error ? e.message : "流水线无效。"); }
}
function changes(before: Pipeline | undefined, after: Pipeline): string[] {
  if (!before) return [`创建流程「${after.name}」：${after.nodes.length} 个节点`];
  const summary: string[] = [];
  if (before.name !== after.name) summary.push(`流程更名为「${after.name}」`);
  for (const n of after.nodes) {
    const old = before.nodes.find(x => x.id === n.id);
    if (!old) summary.push(`新增节点 ${n.id}（${n.label}）`);
    else if (!equal(old, n)) summary.push(`修改节点 ${n.id}（${n.label}）`);
  }
  for (const n of before.nodes) if (!after.nodes.some(x => x.id === n.id)) summary.push(`删除节点 ${n.id}`);
  if (!equal(before.edges, after.edges)) summary.push(`连接已更新：${before.edges.length} → ${after.edges.length}`);
  if (!equal(before.presentation, after.presentation)) summary.push("更新节点布局或位置锁定");
  return summary.length ? summary : ["内容未变化"];
}
export class PipelineControl {
  constructor(private store: PipelineStore) {}
  async execute(raw: unknown, actor: Actor): Promise<unknown> {
    const request = pipelineRequest.parse(raw);
    if (!Object.hasOwn(pipelineCommands, request.name)) throw new ControlError("UNKNOWN_COMMAND", "未知流水线操作。");
    const name = request.name as PipelineCommand, definition = pipelineCommands[name];
    const input = definition.input.parse(request.input);
    if (!actor.workspaceIds.includes(input.workspaceId) || !actor.scopes.includes(definition.readOnly ? "pipelines.read" : "pipelines.write")) throw new ControlError("FORBIDDEN", "没有此工作空间的流水线权限。", 403);
    if (name === "nodes.list_types") return { items: catalog.map(({ configSchema, ...d }) => ({ ...d, configSchema: zodToJsonSchema(configSchema, { $refStrategy: "none" }) })) };
    if (name === "pipelines.preview_layout") {
      const args = pipelineCommands[name].input.parse(input);
      return { document: await arrange(validDocument(args.document), args.options) };
    }
    const db = await this.store.read();
    if (name === "pipelines.list") return { items: db.records.filter(r => r.workspaceId === input.workspaceId).map(({ document, ...r }) => ({ ...r, id: document.id, name: document.name })) };
    if (definition.readOnly) {
      const args = pipelineCommands["pipelines.get"].input.parse(input);
      const record = this.find(db, args.workspaceId, args.pipelineId);
      if (name === "pipelines.get") return record;
      if (name === "pipelines.validate") return { ...inspect(record.document), executable: false };
      return { items: db.history.filter(h => h.workspaceId === args.workspaceId && h.pipelineId === args.pipelineId).slice(-50).map(({ before: _, undone: __, workspaceId: ___, pipelineId: ____, ...event }) => event) };
    }
    if (!request.idempotencyKey) throw new ControlError("IDEMPOTENCY_REQUIRED", "写操作需要幂等键。");
    const key = JSON.stringify([actor.id, input.workspaceId, request.idempotencyKey]);
    const fingerprint = JSON.stringify([name, input]);
    const replay = (data: PipelineDatabase) => {
      const receipt = data.receipts.find(r => r.key === key);
      if (receipt && receipt.fingerprint !== fingerprint) throw new ControlError("IDEMPOTENCY_CONFLICT", "幂等键已用于其它内容。", 409);
      return receipt?.result;
    };
    const previous = replay(db); if (previous) return previous;
    let layout: Pipeline | undefined;
    if (name === "pipelines.layout") {
      const args = pipelineCommands[name].input.parse(input), current = this.find(db, args.workspaceId, args.pipelineId);
      this.revisions(current, args, true, true);
      layout = await arrange(current.document, args.options);
    }
    return this.store.transact(data => {
      const previous = replay(data); if (previous) return previous;
      if (data.receipts.length >= 1000) throw new ControlError("STORE_LIMIT", "原型草稿库达到 1000 次写入上限，请迁移存储。", 409);
      let before: PipelineRecord | undefined, document: Pipeline;
      if (name === "pipelines.create") {
        const args = pipelineCommands[name].input.parse(input); document = validDocument(args.document);
        if (data.records.some(r => r.workspaceId === args.workspaceId && r.document.id === document.id)) throw new ControlError("ALREADY_EXISTS", "流程 ID 已存在，请读取现有版本或另存新 ID。", 409);
      } else {
        const args = pipelineCommands["pipelines.patch"].input.pick({ workspaceId: true, pipelineId: true, expectedGraphRevision: true, expectedLayoutRevision: true }).strip().parse(input);
        before = this.find(data, args.workspaceId, args.pipelineId); document = structuredClone(before.document);
        if (name === "pipelines.save") {
          const save = pipelineCommands[name].input.parse(input);
          this.revisions(before, args, !!save.graph, !!save.presentation);
          if (save.graph && save.graph.id !== document.id) throw new ControlError("IDENTITY_MISMATCH", "保存不能改变流程 ID。");
          document = validDocument({ ...(save.graph ?? graphOf(document)), presentation: save.presentation ?? document.presentation });
        } else if (name === "pipelines.patch") {
          const patch = pipelineCommands[name].input.parse(input);
          const topology = patch.edits.some(e => e.op === "add_node" || e.op === "remove_node");
          this.revisions(before, args, true, topology);
          for (const edit of patch.edits) {
            if (edit.op === "rename") document.name = edit.name;
            else if (edit.op === "add_node") {
              if (document.nodes.some(n => n.id === edit.node.id)) throw new ControlError("DUPLICATE_NODE", "节点 ID 已存在。");
              document.nodes.push(edit.node); document.presentation.nodes[edit.node.id] = edit.position ?? { x: 40, y: 80 + document.nodes.length * 180 };
            } else if (edit.op === "connect") document.edges.push(edit.edge);
            else if (edit.op === "disconnect") {
              if (!document.edges.some(e => e.id === edit.edgeId)) throw new ControlError("UNKNOWN_EDGE", "连线不存在。");
              document.edges = document.edges.filter(e => e.id !== edit.edgeId);
            } else {
              const node = document.nodes.find(n => n.id === edit.nodeId);
              if (!node) throw new ControlError("UNKNOWN_NODE", "节点不存在。");
              if (edit.op === "remove_node") {
                document.nodes = document.nodes.filter(n => n.id !== edit.nodeId);
                document.edges = document.edges.filter(e => e.from.node !== edit.nodeId && e.to.node !== edit.nodeId);
                delete document.presentation.nodes[edit.nodeId];
              } else {
                if (edit.label !== undefined) node.label = edit.label;
                if (edit.config) node.config = { ...node.config, ...edit.config };
                if (edit.settingsBinding === null) delete node.settingsBinding;
                else if (edit.settingsBinding) node.settingsBinding = edit.settingsBinding;
              }
            }
          }
          document = validDocument(document);
        } else if (name === "pipelines.layout") { this.revisions(before, args, true, true); document = layout!; }
        else if (name === "pipelines.undo") {
          this.revisions(before, args, true, true);
          const last = [...data.history].reverse().find(h => h.workspaceId === args.workspaceId && h.pipelineId === args.pipelineId && !h.undone && h.command !== "pipelines.undo");
          if (!last?.before) throw new ControlError("NOTHING_TO_UNDO", "没有可撤销的修改。", 409);
          document = last.before.document; last.undone = true;
        }
      }
      const record: PipelineRecord = {
        workspaceId: input.workspaceId, document,
        graphRevision: before ? before.graphRevision + Number(!equal(graphOf(before.document), graphOf(document))) : 1,
        layoutRevision: before ? before.layoutRevision + Number(!equal(before.document.presentation, document.presentation)) : 1,
        updatedAt: new Date().toISOString(), updatedBy: actor.id,
      };
      const summary = changes(before?.document, document), result = { record, summary };
      if (before) data.records[data.records.indexOf(before)] = record; else data.records.push(record);
      if (!before || record.graphRevision !== before.graphRevision || record.layoutRevision !== before.layoutRevision) data.history.push({ id: request.requestId, workspaceId: input.workspaceId, pipelineId: document.id, command: name, actorId: actor.id, at: record.updatedAt, graphRevision: record.graphRevision, layoutRevision: record.layoutRevision, summary, before: before ?? null, undone: false });
      data.receipts.push({ key, fingerprint, result });
      return result;
    });
  }
  private find(db: PipelineDatabase, workspaceId: string, id: string) {
    const record = db.records.find(r => r.workspaceId === workspaceId && r.document.id === id);
    if (!record) throw new ControlError("NOT_FOUND", "未找到此工作空间的流水线。", 404);
    return record;
  }
  private revisions(record: PipelineRecord, expected: { expectedGraphRevision: number; expectedLayoutRevision: number }, graph: boolean, layout: boolean) {
    if ((graph && record.graphRevision !== expected.expectedGraphRevision) || (layout && record.layoutRevision !== expected.expectedLayoutRevision)) throw new ControlError("REVISION_CONFLICT", "流程已被其它客户端修改。请先查看服务端版本差异，再重新提交。", 409);
  }
}
