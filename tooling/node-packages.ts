import { readdir, readFile, lstat } from "node:fs/promises";
import { resolve } from "node:path";

export async function loadNodePackages(directory?: string): Promise<unknown[]> {
  if (!directory) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries.filter(entry => entry.name.endsWith(".json")).sort((a, b) => a.name.localeCompare(b.name));
  if (files.length > 100) throw new Error("At most 100 node packages are allowed");
  return Promise.all(files.map(async entry => {
    const path = resolve(directory, entry.name), info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1_048_576) throw new Error("Node packages must be regular JSON files under 1 MB");
    return JSON.parse(await readFile(path, "utf8"));
  }));
}
