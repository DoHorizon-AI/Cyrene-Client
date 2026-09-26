import { z } from "zod";
import type { NodeDefinition } from "../pipeline-model/catalog";

const key = z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,99}$/).refine(value => !["constructor", "prototype", "__proto__"].includes(value));
export const portSchema = z.object({ name: key, label: z.string().min(1).max(100), kind: z.enum(["dataset", "model", "compute", "evaluation", "endpoint", "agent-report"]) }).strict();
const field = z.object({ name: key, label: z.string().min(1).max(100), kind: z.enum(["text", "number", "select"]), choices: z.array(z.string().max(1000)).min(1).max(100).optional(), required: z.boolean().default(true), minimum: z.number().finite().optional(), maximum: z.number().finite().optional(), integer: z.boolean().optional(), maxLength: z.number().int().positive().max(1000).optional() }).strict();
export const contributionSchema = z.object({
  type: key, version: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/), title: z.string().min(1).max(80), owner: z.string().min(1).max(100), category: z.string().min(1).max(80), description: z.string().max(2000), color: z.string().regex(/^#[a-fA-F0-9]{6}$/),
  inputs: z.array(portSchema).max(32), outputs: z.array(portSchema).max(32), fields: z.array(field).max(64), defaults: z.record(key, z.union([z.string().max(1000), z.number().finite()])),
  execution: z.object({ kind: z.enum(["reference", "task", "service", "external"]), adapter: key, image: z.string().regex(/^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/).optional(), mutableFields: z.array(key).max(64).default([]), checkpoint: z.boolean().default(false) }).strict(),
}).strict();
export const packageSchema = z.object({ schemaVersion: z.literal("cyrene.studio.nodes.v1"), id: key, version: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/), pluginRef: z.object({ id: key, version: z.string().max(100) }).strict().optional(), nodes: z.array(contributionSchema).min(1).max(100) }).strict();
export type NodePackage = z.infer<typeof packageSchema>;
export function compileContribution(node: z.infer<typeof contributionSchema>, pkg: Pick<NodePackage, "id" | "version">): NodeDefinition {
  for (const entries of [node.fields, node.inputs, node.outputs]) if (new Set(entries.map(item => item.name)).size !== entries.length) throw new Error(`Duplicate names in ${node.type}`);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of node.fields) {
    let value: z.ZodTypeAny;
    if (f.kind === "number") {
      let numeric = z.number().finite(); if (f.integer) numeric = numeric.int(); if (f.minimum !== undefined) numeric = numeric.min(f.minimum); if (f.maximum !== undefined) numeric = numeric.max(f.maximum); value = numeric;
    } else if (f.kind === "select") { if (!f.choices?.length) throw new Error(`Missing choices for ${f.name}`); value = z.enum(f.choices as [string, ...string[]]); }
    else value = z.string().max(f.maxLength ?? 1000);
    shape[f.name] = f.required ? value : value.optional();
  }
  const configSchema = z.object(shape).strict(); configSchema.parse(node.defaults);
  if (node.execution.mutableFields.some(name => !Object.hasOwn(shape, name))) throw new Error("Mutable field is not declared");
  return { ...node, configSchema, packageRef: { id: pkg.id, version: pkg.version } };
}
