import { definitions } from "./catalog";

export const TITLE_HEIGHT = 30;

export function nodeSize(type: string): [number, number] {
  const d = definitions.get(type);
  if (!d) return [240, 100];
  return [250, Math.max(96, 35 + Math.max(d.inputs.length, d.outputs.length) * 26)];
}
