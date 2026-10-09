import type { SessionPayload, GpuStatus, DiskStatus, ServiceHealthStatus, BlockerInfo, PluginInfo, SystemStatus, CredentialMetadata } from "../types";
import { NavigatorContractError } from "../errors";
import { requireRecord, requireArray, requireString, requireNumber, requireBoolean, readString, readNullableString } from "./validation";

export function parseSession(value: unknown): SessionPayload {
  const record = requireRecord(value, "auth session");
  const state = readString(record, "state", "");
  if (state !== "AUTHENTICATED" && state !== "ANONYMOUS") {
    throw new NavigatorContractError("Navigator returned an unknown session state.");
  }
  return {
    authenticated: requireBoolean(record, "authenticated", "auth session"),
    state,
    sessionId: readNullableString(record, "sessionId"),
    expiresAt: readNullableString(record, "expiresAt"),
    refreshExpiresAt: readNullableString(record, "refreshExpiresAt"),
    refreshable: requireBoolean(record, "refreshable", "auth session"),
    csrfToken: readNullableString(record, "csrfToken"),
    refreshed: requireBoolean(record, "refreshed", "auth session"),
  };
}

export function parseSystemStatus(value: unknown): SystemStatus {
  const record = requireRecord(value, "system status");
  const credentials = requireRecord(record.credentials, "system status credentials");
  const prefixes = record.proxyPrefixes;
  if (!Array.isArray(prefixes) || !prefixes.every((prefix) => typeof prefix === "string")) {
    throw new NavigatorContractError("Navigator returned invalid proxy prefix metadata.");
  }

  let gpu: GpuStatus | undefined;
  if (record.gpu && typeof record.gpu === "object") {
    const gpuRec = record.gpu as Record<string, unknown>;
    const gpus = Array.isArray(gpuRec.gpus)
      ? gpuRec.gpus.map((g) => {
          const gr = requireRecord(g, "gpu device");
          return {
            name: requireString(gr, "name", "gpu name"),
            totalMib: requireNumber(gr, "totalMib", "gpu totalMib"),
            usedMib: requireNumber(gr, "usedMib", "gpu usedMib"),
            utilizationPct: requireNumber(gr, "utilizationPct", "gpu utilizationPct"),
          };
        })
      : undefined;
    gpu = {
      available: Boolean(gpuRec.available),
      gpus,
    };
  }

  let disk: DiskStatus | undefined;
  if (record.disk && typeof record.disk === "object") {
    const diskRec = record.disk as Record<string, unknown>;
    disk = {
      available: diskRec.available !== undefined ? Boolean(diskRec.available) : undefined,
      totalGib: typeof diskRec.totalGib === "number" ? diskRec.totalGib : undefined,
      usedGib: typeof diskRec.usedGib === "number" ? diskRec.usedGib : undefined,
      freeGib: typeof diskRec.freeGib === "number" ? diskRec.freeGib : undefined,
      usedPct: typeof diskRec.usedPct === "number" ? diskRec.usedPct : undefined,
    };
  }

  let services: ServiceHealthStatus[] | undefined;
  if (Array.isArray(record.services)) {
    services = record.services.map((s) => {
      const sr = requireRecord(s, "service health");
      return {
        name: requireString(sr, "name", "service name"),
        url: requireString(sr, "url", "service url"),
        status: sr.status === "UP" ? ("UP" as const) : ("DOWN" as const),
        latencyMs: requireNumber(sr, "latencyMs", "service latencyMs"),
      };
    });
  }

  let blockers: BlockerInfo[] | undefined;
  if (Array.isArray(record.blockers)) {
    blockers = record.blockers.map((b) => {
      const br = requireRecord(b, "blocker");
      return {
        code: requireString(br, "code", "blocker code"),
        message: requireString(br, "message", "blocker message"),
      };
    });
  }

  let plugins: PluginInfo[] | undefined;
  if (Array.isArray(record.plugins)) {
    plugins = record.plugins.map((p) => {
      const pr = requireRecord(p, "plugin");
      return {
        name: requireString(pr, "name", "plugin name"),
        kind: typeof pr.kind === "string" ? pr.kind : undefined,
        state: requireString(pr, "state", "plugin state"),
      };
    });
  }

  return {
    service: requireString(record, "service", "system status"),
    status: requireString(record, "status", "system status"),
    version: requireString(record, "version", "system status"),
    workspaceId: typeof record.workspaceId === "string" ? record.workspaceId : typeof record.workspace_id === "string" ? record.workspace_id : undefined,
    authenticated: requireBoolean(record, "authenticated", "system status"),
    proxyPrefixes: prefixes,
    credentials: {
      active: requireNumber(credentials, "active", "credential counts"),
      revoked: requireNumber(credentials, "revoked", "credential counts"),
    },
    gpu,
    disk,
    services,
    blockers,
    plugins,
    observedAt: requireString(record, "observedAt", "system status"),
  };
}

export function parseCredentialArray(value: unknown): CredentialMetadata[] {
  return requireArray(value, "credentials").map((item) => parseCredential(item));
}

export function parseCredential(value: unknown): CredentialMetadata {
  const record = requireRecord(value, "credential metadata");
  return {
    id: requireString(record, "id", "credential metadata"),
    name: requireString(record, "name", "credential metadata"),
    provider: requireString(record, "provider", "credential metadata"),
    kind: requireString(record, "kind", "credential metadata"),
    state: requireString(record, "state", "credential metadata"),
    credentialRef: requireString(record, "credentialRef", "credential metadata"),
    createdAt: requireString(record, "createdAt", "credential metadata"),
    updatedAt: requireString(record, "updatedAt", "credential metadata"),
  };
}
