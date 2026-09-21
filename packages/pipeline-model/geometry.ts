import { definitions } from "./catalog";
export const TITLE_HEIGHT = 30;
export function nodeSize(type: string): [number, number] {
  const d = definitions.get(type);
  if (!d) throw new Error(`Unknown node type: ${type}`);
  return [240, Math.max(96, 35 + Math.max(d.inputs.length, d.outputs.length) * 26)];
}
