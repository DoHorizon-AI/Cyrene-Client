import { z } from "zod";
import type { NodeDefinition } from "../pipeline-model/catalog";
import type { Pipeline } from "../pipeline-model";

export const diagnosticConfig = z.object({ rounds: z.number().int().min(2).max(120), text: z.string().max(1000), outcome: z.enum(["succeed", "fail"]) }).strict();
export const diagnosticDefinition: NodeDefinition = {
  type: "local-diagnostic", version: "1", title: "本地诊断 / Local diagnostic", owner: "Client", category: "开发测试", color: "#6b9e78",
  description: "在控制服务内逐步计算 SHA-256 并记录事件；不使用 GPU、不执行脚本、不访问外部服务。需显式启用。",
  inputs: [], outputs: [], fields: [{ name: "rounds", label: "计算步数 / Rounds", kind: "number" }, { name: "text", label: "输入文本 / Input", kind: "text" }, { name: "outcome", label: "预期终态 / Outcome", kind: "select", choices: ["succeed", "fail"] }],
  defaults: { rounds: 30, text: "Cyrene MCP diagnostic", outcome: "succeed" }, configSchema: diagnosticConfig,
  execution: { kind: "task", adapter: "local-diagnostic", mutableFields: [], checkpoint: false },
};
export function diagnosticPipeline(id: string): Pipeline {
  return { schemaVersion: "cyrene.pipeline.v2", id, name: "MCP 本地诊断 / Local diagnostic", nodes: [
    { id: "checksum", type: diagnosticDefinition.type, typeVersion: "1", label: "本地校验 / Checksum", config: { ...diagnosticDefinition.defaults } },
    { id: "failure-check", type: diagnosticDefinition.type, typeVersion: "1", label: "预期失败 / Expected failure", config: { ...diagnosticDefinition.defaults, rounds: 15, outcome: "fail" } },
  ], edges: [], presentation: { nodes: { checksum: { x: 80, y: 100 }, "failure-check": { x: 440, y: 100 } } } };
}
