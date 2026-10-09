import type { ActiveRoutePayload, ApiKeyMetadata } from "../types";
import { requireRecord, requireArray, requireString, readNullableString } from "./validation";

export function parseActiveRoute(value: unknown): ActiveRoutePayload {
  const record = requireRecord(value, "active route");
  return {
    gatewayEndpointId: String(record.gatewayEndpointId ?? record.gateway_endpoint_id ?? ""),
    modelId: String(record.modelId ?? record.model_id ?? ""),
    baseUrl: String(record.baseUrl ?? record.base_url ?? ""),
    apiKeyHint: typeof (record.apiKeyHint ?? record.api_key_hint) === "string" ? String(record.apiKeyHint ?? record.api_key_hint) : undefined,
  };
}

export function parseApiKey(value: unknown): ApiKeyMetadata {
  const record = requireRecord(value, "api key");
  const rawState = requireString(record, "state", "api key state");
  const state: "ACTIVE" | "REVOKED" = rawState === "REVOKED" ? "REVOKED" : "ACTIVE";
  const modelScopeRaw = record.modelScope ?? record.model_scope;
  const modelScope = Array.isArray(modelScopeRaw)
    ? modelScopeRaw.map((item) => String(item))
    : [];

  return {
    id: requireString(record, "id", "api key id"),
    name: requireString(record, "name", "api key name"),
    credentialRef: String(record.credentialRef ?? record.credential_ref ?? ""),
    state,
    modelScope,
    createdAt: String(record.createdAt ?? record.created_at ?? ""),
    expiresAt: readNullableString(record, "expiresAt") ?? readNullableString(record, "expires_at"),
    revokedAt: readNullableString(record, "revokedAt") ?? readNullableString(record, "revoked_at"),
    resourceVersion: typeof record.resourceVersion === "number" ? record.resourceVersion : undefined,
  };
}

export function parseApiKeyArray(value: unknown): ApiKeyMetadata[] {
  return requireArray(value, "api keys").map((item) => parseApiKey(item));
}

export function parseCreatedApiKey(value: unknown): { key: ApiKeyMetadata; secret: string } {
  const record = requireRecord(value, "created api key");
  const key = parseApiKey(record);
  const secret = requireString(record, "secret", "api key secret");
  return { key, secret };
}
