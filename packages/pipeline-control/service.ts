import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { inspect, parsePipeline, type Pipeline } from "../pipeline-model";
import { allDefinitions, getDefinition } from "../pipeline-model/catalog";
import { ControlError, type Actor } from "../server-control/contracts";
import { pipelineCommands, pipelineRequest, recordSchema, type PipelineCommand, type PipelineRecord } from "./contracts";
import { arrange } from "./layout";
import { mergeIndependentGraph } from "./collaboration";

const historyEntry = z.object({ id: z.string(), workspaceId: z.string(), pipelineId: z.string(), command: z.string(), actorId: z.string(), at: z.string(), graphRevision: z.number(), layoutRevision: z.number(), summary: z.array(z.string()), before: recordSchema.nullable(), undone: z.boolean() });
const redoEntry = z.object({ workspaceId: z.string(), pipelineId: z.string(), document: recordSchema.shape.document, targetHistoryId: z.string(), actorId: z.string().optional(), undoneDocument: recordSchema.shape.document.optional() });
export const pipelineDatabase = z.object({ version: z.literal(1), records: z.array(recordSchema), history: z.array(historyEntry), redo: z.array(redoEntry).default([]), receipts: z.array(z.object({ key: z.string(), fingerprint: z.string(), result: z.object({ record: recordSchema, summary: z.array(z.string()) }) })) }).strict();
export type PipelineDatabase = z.infer<typeof pipelineDatabase>;
export const emptyPipelineDatabase = (): PipelineDatabase => ({ version: 1, records: [], history: [], redo: [], receipts: [] });
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
// Apply only the original operation's diff. This is shared by undo and redo;
// snapshots are baselines, never replacements for a collaborator's document.
function mergeDocumentChange(base: Pipeline, incoming: Pipeline, current: Pipeline): Pipeline {
  const graph = mergeIndependentGraph(graphOf(base), graphOf(incoming), graphOf(current));
  const presentation = structuredClone(current.presentation);
  for (const id of new Set([...Object.keys(base.presentation.nodes), ...Object.keys(incoming.presentation.nodes)])) {
    const old = base.presentation.nodes[id], next = incoming.presentation.nodes[id];
    if (equal(old, next)) continue;
    if (!equal(presentation.nodes[id], old)) throw new ControlError("REVISION_CONFLICT", "此布局已被后续操作修改，不能覆盖。", 409);
    if (next) presentation.nodes[id] = structuredClone(next); else delete presentation.nodes[id];
  }
  return validDocument({ ...graph, presentation });
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
  constructor(private store: PipelineStore, private options: { maxReceipts?: number } = {}) {}
  async execute(raw: unknown, actor: Actor): Promise<unknown> {
    const request = pipelineRequest.parse(raw);
    if (!Object.hasOwn(pipelineCommands, request.name)) throw new ControlError("UNKNOWN_COMMAND", "未知流水线操作。");
    const name = request.name as PipelineCommand, definition = pipelineCommands[name];
    const input = definition.input.parse(request.input);
    if (!actor.workspaceIds.includes(input.workspaceId) || !actor.scopes.includes(definition.readOnly ? "pipelines.read" : "pipelines.write")) throw new ControlError("FORBIDDEN", "没有此工作空间的流水线权限。", 403);
    if (name === "nodes.list_types") return { items: allDefinitions().map(({ configSchema, ...d }) => ({ ...d, active: getDefinition(d.type)?.version === d.version, configSchema: zodToJsonSchema(configSchema, { $refStrategy: "none" }) })) };
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
      if (name === "pipelines.compile") return { pipelineId: record.document.id, graphRevision: record.graphRevision, ...inspect(record.document), executable: false, nodes: record.document.nodes.map(node => {
        const definition = getDefinition(node.type, node.typeVersion);
        return { nodeId: node.id, type: node.type, typeVersion: node.typeVersion ?? definition?.version, adapter: definition?.execution?.adapter, kind: definition?.execution?.kind, image: definition?.execution?.image, dependencies: record.document.edges.filter(edge => edge.to.node === node.id).map(edge => edge.from.node) };
      }) };
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
      if (data.receipts.length >= (this.options.maxReceipts ?? 1000)) throw new ControlError("STORE_LIMIT", "原型草稿库达到写入上限，请迁移存储。", 409);
      let before: PipelineRecord | undefined, document: Pipeline;
      if (name === "pipelines.create") {
        const args = pipelineCommands[name].input.parse(input); document = validDocument(args.document);
        if (data.records.some(r => r.workspaceId === args.workspaceId && r.document.id === document.id)) throw new ControlError("ALREADY_EXISTS", "流程 ID 已存在，请读取现有版本或另存新 ID。", 409);
      } else {
        const args = pipelineCommands["pipelines.patch"].input.pick({ workspaceId: true, pipelineId: true, expectedGraphRevision: true, expectedLayoutRevision: true }).strip().parse(input);
        before = this.find(data, args.workspaceId, args.pipelineId); document = structuredClone(before.document);
        if (name === "pipelines.save") {
          const save = pipelineCommands[name].input.parse(input);
          let savedGraph = save.graph;
          if (savedGraph && save.mergeIndependent && before.graphRevision !== args.expectedGraphRevision) {
            const baseline = [...data.history].reverse().find(entry => entry.workspaceId === args.workspaceId && entry.pipelineId === args.pipelineId && entry.before?.graphRevision === args.expectedGraphRevision)?.before;
            if (!baseline) throw new ControlError("REVISION_CONFLICT", "历史基线不可用，请读取当前版本处理冲突。", 409);
            savedGraph = mergeIndependentGraph(graphOf(baseline.document), savedGraph, graphOf(before.document));
            this.revisions(before, args, false, !!save.presentation);
          } else this.revisions(before, args, !!save.graph, !!save.presentation);
          if (save.graph && save.graph.id !== document.id) throw new ControlError("IDENTITY_MISMATCH", "保存不能改变流程 ID。");
          document = validDocument({ ...(savedGraph ?? graphOf(document)), presentation: save.presentation ?? document.presentation });
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
          const history = data.history.filter(h => h.workspaceId === args.workspaceId && h.pipelineId === args.pipelineId);
          const last = [...history].reverse().find(h => h.actorId === actor.id && !h.undone && h.command !== "pipelines.undo" && h.command !== "pipelines.redo");
          if (!last?.before) throw new ControlError("NOTHING_TO_UNDO", "没有可撤销的修改。", 409);
          const index = history.indexOf(last);
          const after = history[index + 1]?.before ?? before;
          document = mergeDocumentChange(after.document, last.before.document, before.document); last.undone = true;
          const matching = data.redo.flatMap((entry, index) => entry.workspaceId === args.workspaceId && entry.pipelineId === args.pipelineId && entry.actorId === actor.id ? [index] : []);
          if (matching.length >= 50) data.redo.splice(matching[0], 1);
          data.redo.push({ workspaceId: args.workspaceId, pipelineId: args.pipelineId, actorId: actor.id, document: structuredClone(before.document), undoneDocument: structuredClone(document), targetHistoryId: last.id });
        }
        else if (name === "pipelines.redo") {
          this.revisions(before, args, true, true);
          let index = -1;
          for (let candidate = data.redo.length - 1; candidate >= 0; candidate--) {
            const entry = data.redo[candidate];
            if (entry.workspaceId !== args.workspaceId || entry.pipelineId !== args.pipelineId) continue;
            if (!entry.actorId || !entry.undoneDocument) this.restoreLegacyRedo(data, entry);
            if (entry.actorId === actor.id) { index = candidate; break; }
          }
          if (index < 0) throw new ControlError("NOTHING_TO_REDO", "没有可重做的修改。", 409);
          const redo = data.redo[index];
          const targets = data.history.filter(entry => entry.workspaceId === args.workspaceId && entry.pipelineId === args.pipelineId && entry.id === redo.targetHistoryId);
          const target = targets.length === 1 ? targets[0] : undefined;
          if (!target?.undone || target.actorId !== actor.id || !redo.undoneDocument) throw new ControlError("NOTHING_TO_REDO", "没有可安全重做的修改。", 409);
          document = mergeDocumentChange(redo.undoneDocument, redo.document, before.document); target.undone = false;
          data.redo.splice(index, 1);
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
      if (before && name !== "pipelines.undo" && name !== "pipelines.redo" && (record.graphRevision !== before.graphRevision || record.layoutRevision !== before.layoutRevision)) data.redo = data.redo.filter(entry => entry.workspaceId !== input.workspaceId || entry.pipelineId !== document.id);
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
  private restoreLegacyRedo(db: PipelineDatabase, redo: z.infer<typeof redoEntry>) {
    const history = db.history.filter(h => h.workspaceId === redo.workspaceId && h.pipelineId === redo.pipelineId);
    const targets = history.filter(h => h.id === redo.targetHistoryId);
    if (targets.length !== 1 || !targets[0].before || !targets[0].undone) return;
    const target = targets[0];
    const targetAfter = history[history.indexOf(target) + 1]?.before;
    if (!targetAfter || !equal(targetAfter.document, redo.document)) return;
    const candidates = history.filter((h, i) => i > history.indexOf(target) && h.command === "pipelines.undo" && h.actorId === target.actorId && h.before && equal(h.before.document, redo.document));
    if (candidates.length !== 1) return;
    const undo = candidates[0], index = history.indexOf(undo);
    const after = history[index + 1]?.before ?? db.records.find(r => r.workspaceId === redo.workspaceId && r.document.id === redo.pipelineId);
    if (!after || after.graphRevision !== undo.graphRevision || after.layoutRevision !== undo.layoutRevision || !equal(after.document, target.before!.document)) return;
    // Old global undo may have targeted another actor. Infer only an exact,
    // same-actor history match; retain ambiguous entries without replaying them.
    redo.actorId = target.actorId; redo.undoneDocument = structuredClone(after.document);
  }
  private revisions(record: PipelineRecord, expected: { expectedGraphRevision: number; expectedLayoutRevision: number }, graph: boolean, layout: boolean) {
    if ((graph && record.graphRevision !== expected.expectedGraphRevision) || (layout && record.layoutRevision !== expected.expectedLayoutRevision)) throw new ControlError("REVISION_CONFLICT", "流程已被其它客户端修改。请先查看服务端版本差异，再重新提交。", 409);
  }
}
