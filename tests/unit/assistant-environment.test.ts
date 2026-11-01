// ┌─────────────────────────────────────────────────────────────────────┐
// │ Module: Assistant child environment tests                           │
// │ Role: Keep local provider bindings isolated to the Navigator child.  │
// │ 中文：模块职责：验证本地 provider 配置只传入 Navigator 子进程。     │
// └─────────────────────────────────────────────────────────────────────┘

import { expect, it } from "vitest";
import {
  createNavigatorChildEnvironment,
  ISOLATED_ENVIRONMENT_ALLOWLIST,
  NAVIGATOR_ONLY_ENVIRONMENT_NAMES,
  prepareAssistantEnvironment,
} from "../../scripts/assistant-environment.mjs";

const factoryEnvironment: Record<string, string> = {
  CYRENE_NAVIGATOR_MODEL_PROVIDER_CONNECTION_REF: "local-model-provider",
  CYRENE_NAVIGATOR_MEMORY_PROVIDER_CONNECTION_REF: "local-memory-provider",
  CYRENE_NAVIGATOR_KNOWLEDGE_GRAPH_CONNECTION_REF: "local-graph-provider",
  CYRENE_NAVIGATOR_EMBEDDING_MODEL_ID: "intfloat/multilingual-e5-base",
  CYRENE_NAVIGATOR_EMBEDDING_PROFILE_ID: "local-e5-1024",
  CYRENE_NAVIGATOR_EMBEDDING_DIMENSIONS: "1024",
  CYRENE_NAVIGATOR_EMBEDDING_DOCUMENT_PREFIX: "passage: ",
  CYRENE_NAVIGATOR_EMBEDDING_QUERY_PREFIX: "query: ",
};

const navigatorFeatureEnvironment: Record<string, string> = {
  CYRENE_CONVERSATION_ASSISTANT_ENABLED: "true",
};

const navigatorOnlyEnvironment = { ...factoryEnvironment, ...navigatorFeatureEnvironment };

const localCredentials: Record<string, string> = {
  CYRENE_SESSION_TOKEN: "local-session-token",
  CYRENE_EXCHANGE_URL: "http://127.0.0.1:18682",
  CYRENE_EXCHANGE_TOKEN: "local-exchange-token",
  CYRENE_HARNESS_MODEL: "local-qwen",
};

it("forwards exact Navigator-only config and drops unknown isolated variables", () => {
  const input = {
    PATH: "/task/node/bin",
    STUDIO_WORKSPACE_ID: "local",
    ...localCredentials,
    ...navigatorOnlyEnvironment,
    AWS_SECRET_ACCESS_KEY: "must-not-forward",
    DATABASE_URL: "postgres://production",
    CYRENE_NAVIGATOR_PRODUCTION_PROFILE: "must-not-forward",
  };
  const prepared = prepareAssistantEnvironment(input, true);
  const navigatorChildEnvironment = createNavigatorChildEnvironment(
    prepared.sharedEnvironment,
    prepared.inheritedEnvironment,
    prepared.navigatorOnlyEnvironment,
  );

  expect(NAVIGATOR_ONLY_ENVIRONMENT_NAMES).toEqual(Object.keys(navigatorOnlyEnvironment));
  expect(prepared.navigatorOnlyEnvironment).toEqual(navigatorOnlyEnvironment);
  expect(prepared.inheritedEnvironment).toMatchObject({ ...navigatorOnlyEnvironment, ...localCredentials });
  expect(navigatorChildEnvironment).toMatchObject({ ...navigatorOnlyEnvironment, ...localCredentials });
  for (const name of Object.keys(navigatorOnlyEnvironment)) expect(prepared.sharedEnvironment).not.toHaveProperty(name);
  for (const name of Object.keys(localCredentials)) expect(prepared.sharedEnvironment).not.toHaveProperty(name);
  for (const name of ["AWS_SECRET_ACCESS_KEY", "DATABASE_URL", "CYRENE_NAVIGATOR_PRODUCTION_PROFILE"]) {
    expect(ISOLATED_ENVIRONMENT_ALLOWLIST).not.toContain(name);
    expect(prepared.inheritedEnvironment).not.toHaveProperty(name);
    expect(prepared.sharedEnvironment).not.toHaveProperty(name);
    expect(navigatorChildEnvironment).not.toHaveProperty(name);
  }
  expect(prepared.sharedEnvironment).toMatchObject({ PATH: "/task/node/bin", STUDIO_WORKSPACE_ID: "local" });
});

it("keeps Navigator-only config out of Vite and Control in non-isolated mode too", () => {
  const prepared = prepareAssistantEnvironment({ ...localCredentials, ...navigatorOnlyEnvironment, STUDIO_MODE: "local" }, false);
  const navigatorChildEnvironment = createNavigatorChildEnvironment(
    prepared.sharedEnvironment,
    prepared.inheritedEnvironment,
    prepared.navigatorOnlyEnvironment,
  );

  expect(prepared.inheritedEnvironment).toMatchObject(navigatorOnlyEnvironment);
  expect(prepared.navigatorOnlyEnvironment).toEqual(navigatorOnlyEnvironment);
  expect(navigatorChildEnvironment).toMatchObject({ ...navigatorOnlyEnvironment, ...localCredentials });
  for (const name of [...Object.keys(navigatorOnlyEnvironment), ...Object.keys(localCredentials)]) {
    expect(prepared.sharedEnvironment).not.toHaveProperty(name);
  }
});
