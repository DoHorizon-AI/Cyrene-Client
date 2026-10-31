export interface LegacyChat {
  id: string; title: string; runtime: string; updatedAt: string | number;
  events: { seq: number; type: string; text: string }[];
}

/** Import a read-only archive, without adopting legacy approvals or execution state. */
export function parseLegacyHistory(value: unknown, workspaceId: string): LegacyChat[] {
  const record = asRecord(value);
  if (record.schemaVersion !== 1 || record.kind !== "cyrene-legacy-assistant-history" || record.workspaceId !== workspaceId || !Array.isArray(record.sessions)) {
    throw new Error("Invalid legacy assistant archive or workspace mismatch.");
  }
  if (record.sessions.length > 1000) throw new Error("Legacy assistant archive contains too many sessions.");
  return record.sessions.map(value => {
    const session = asRecord(value);
    if (typeof session.id !== "string" || typeof session.title !== "string" || typeof session.runtime !== "string" || !Array.isArray(session.events) || session.events.length > 10_000) {
      throw new Error("Invalid legacy assistant session.");
    }
    const events = session.events.map(value => {
      const event = asRecord(value), data = asRecord(event.data);
      if (!Number.isSafeInteger(event.seq) || typeof event.type !== "string") throw new Error("Invalid legacy assistant event.");
      const text = typeof data.text === "string" ? data.text : typeof data.message === "string" ? data.message : "";
      return { seq: event.seq as number, type: event.type, text };
    }).filter(event => ["user", "text", "summary", "error", "status"].includes(event.type) && event.text);
    return { id: session.id, title: session.title, runtime: session.runtime,
      updatedAt: typeof session.updatedAt === "number" || typeof session.updatedAt === "string" ? session.updatedAt : "", events };
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid legacy assistant archive.");
  return value as Record<string, unknown>;
}
