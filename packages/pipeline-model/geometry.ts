import { getDefinition } from "./catalog";
export const TITLE_HEIGHT = 30;
export function nodeSize(type: string, version?: string): [number, number] {
  const d = getDefinition(type, version);
  if (!d) return [240, 180];
  return [240, Math.max(96, 35 + Math.max(d.inputs.length, d.outputs.length) * 26)];
}
