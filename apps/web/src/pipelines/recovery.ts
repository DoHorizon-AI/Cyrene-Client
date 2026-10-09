import { z } from "zod";
import { pipelineSchema, nodeSchema } from "../../../../packages/pipeline-model";
import { recordSchema } from "../../../../packages/pipeline-control/contracts";

// Editing may temporarily clear a title or contain invalid node parameters.
// Recovery preserves that draft; executable/import validation remains stricter.
export const recoveryDocumentSchema = pipelineSchema.extend({ name: z.string().max(100), nodes: z.array(nodeSchema.extend({ label: z.string().max(80) })).max(200) });

export const recoverySchema = z.object({
  id: z.string(), actorId: z.string(), workspaceId: z.string(), tabId: z.string(), sequence: z.number().int().nonnegative(), savedAt: z.string(),
  document: recoveryDocumentSchema, history: z.array(recoveryDocumentSchema).max(50), selectedId: z.string().nullable(),
  serverBase: recordSchema.optional(),
  future: z.array(recoveryDocumentSchema).max(50).optional(),
  view: z.object({ scale: z.number().positive().max(100), offset: z.tuple([z.number().finite(), z.number().finite()]) }).optional(),
});
export type Recovery = z.infer<typeof recoverySchema>;
export function retainRecoveries(rows: Recovery[]): Recovery[] {
  const counts = new Map<string, number>();
  return [...rows].sort((a, b) => b.savedAt.localeCompare(a.savedAt) || b.sequence - a.sequence).filter(row => {
    const key = JSON.stringify([row.actorId, row.workspaceId, row.document.id]);
    const count = (counts.get(key) ?? 0) + 1; counts.set(key, count);
    return count <= 20;
  });
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("cyrene-studio-recovery", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("恢复存储被其它页面的升级操作占用。"));
  });
}
export async function saveRecovery(value: Recovery) {
  const record = recoverySchema.parse(value), db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite"), store = tx.objectStore("drafts");
      const request = store.get(record.id);
      request.onsuccess = () => {
        if (!request.result || request.result.sequence < record.sequence) store.put(record);
        const all = store.getAll();
        all.onsuccess = () => {
          const rows = all.result.flatMap(row => { const parsed = recoverySchema.safeParse(row); return parsed.success
            && parsed.data.actorId === record.actorId && parsed.data.workspaceId === record.workspaceId
            && parsed.data.document.id === record.document.id ? [parsed.data] : []; });
          const retained = new Set(retainRecoveries(rows).map(row => row.id));
          for (const row of rows) if (!retained.has(row.id)) store.delete(row.id);
        };
      };
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error ?? new Error("恢复写入已中断。"));
    });
  } finally { db.close(); }
}
export async function listRecoveries(actorId: string, workspaceId: string): Promise<Recovery[]> {
  const db = await database();
  try {
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      const request = db.transaction("drafts", "readonly").objectStore("drafts").getAll();
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    return rows.map(row => recoverySchema.safeParse(row)).flatMap(result => result.success && result.data.actorId === actorId && result.data.workspaceId === workspaceId ? [result.data] : []).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  } finally { db.close(); }
}
