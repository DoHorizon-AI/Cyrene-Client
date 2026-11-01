// ┌─────────────────────────────────────────────────────────────────────┐
// │ Module: Isolated assistant child-process environments               │
// │ Role: Keep Navigator-only provider config out of Vite and Control.   │
// │ 中文：模块职责：隔离 Navigator 配置，不传给 Vite 或 Control。       │
// └─────────────────────────────────────────────────────────────────────┘

export const ISOLATED_ENVIRONMENT_ALLOWLIST = Object.freeze([
  "PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "LC_CTYPE", "TZ",
  "TMPDIR", "TMP", "TEMP", "SYSTEMROOT", "WINDIR", "SSL_CERT_FILE",
  "SSL_CERT_DIR", "UV_CACHE_DIR", "CYRENE_NAVIGATOR_DIR", "CYRENE_PYTHON",
  "CYRENE_SESSION_TOKEN", "CYRENE_EXCHANGE_URL", "CYRENE_EXCHANGE_TOKEN",
  "CYRENE_HARNESS_MODEL", "CYRENE_ORGANIZATION_ID", "STUDIO_WORKSPACE_ID",
  "CYRENE_NAVIGATOR_MODEL_PROVIDER_CONNECTION_REF",
  "CYRENE_NAVIGATOR_MEMORY_PROVIDER_CONNECTION_REF",
  "CYRENE_NAVIGATOR_KNOWLEDGE_GRAPH_CONNECTION_REF",
  "CYRENE_NAVIGATOR_EMBEDDING_MODEL_ID",
  "CYRENE_NAVIGATOR_EMBEDDING_PROFILE_ID",
  "CYRENE_NAVIGATOR_EMBEDDING_DIMENSIONS",
  "CYRENE_NAVIGATOR_EMBEDDING_DOCUMENT_PREFIX",
  "CYRENE_NAVIGATOR_EMBEDDING_QUERY_PREFIX",
  "CYRENE_CONVERSATION_ASSISTANT_ENABLED",
  "CYRENE_EXECUTOR_MAX_CONCURRENT_TASKS",
]);

export const NAVIGATOR_ONLY_ENVIRONMENT_NAMES = Object.freeze([
  "CYRENE_NAVIGATOR_MODEL_PROVIDER_CONNECTION_REF",
  "CYRENE_NAVIGATOR_MEMORY_PROVIDER_CONNECTION_REF",
  "CYRENE_NAVIGATOR_KNOWLEDGE_GRAPH_CONNECTION_REF",
  "CYRENE_NAVIGATOR_EMBEDDING_MODEL_ID",
  "CYRENE_NAVIGATOR_EMBEDDING_PROFILE_ID",
  "CYRENE_NAVIGATOR_EMBEDDING_DIMENSIONS",
  "CYRENE_NAVIGATOR_EMBEDDING_DOCUMENT_PREFIX",
  "CYRENE_NAVIGATOR_EMBEDDING_QUERY_PREFIX",
  "CYRENE_CONVERSATION_ASSISTANT_ENABLED",
  "CYRENE_EXECUTOR_MAX_CONCURRENT_TASKS",
]);

const NAVIGATOR_CREDENTIAL_ENVIRONMENT_NAMES = Object.freeze([
  "CYRENE_SESSION_TOKEN",
  "CYRENE_EXCHANGE_URL",
  "CYRENE_EXCHANGE_TOKEN",
  "CYRENE_HARNESS_MODEL",
]);

function pickEnvironment(source, names) {
  return Object.fromEntries(names.flatMap((name) => source[name] === undefined ? [] : [[name, source[name]]]));
}

/**
 * Split launcher variables so provider bindings and credentials reach only Navigator.
 * Isolated mode additionally discards every inherited variable outside the explicit allowlist.
 */
export function prepareAssistantEnvironment(source, isolated) {
  const inheritedEnvironment = isolated
    ? pickEnvironment(source, ISOLATED_ENVIRONMENT_ALLOWLIST)
    : { ...source };
  const sharedEnvironment = { ...inheritedEnvironment };
  for (const name of [...NAVIGATOR_ONLY_ENVIRONMENT_NAMES, ...NAVIGATOR_CREDENTIAL_ENVIRONMENT_NAMES]) {
    delete sharedEnvironment[name];
  }

  return {
    inheritedEnvironment,
    sharedEnvironment,
    navigatorOnlyEnvironment: pickEnvironment(inheritedEnvironment, NAVIGATOR_ONLY_ENVIRONMENT_NAMES),
  };
}

/**
 * Add Navigator credentials and provider bindings to the shared base only for its child.
 * Shared Vite and Control environments remain unchanged.
 */
export function createNavigatorChildEnvironment(sharedEnvironment, inheritedEnvironment, navigatorOnlyEnvironment) {
  const navigatorEnvironment = { ...sharedEnvironment, ...navigatorOnlyEnvironment };
  for (const name of NAVIGATOR_CREDENTIAL_ENVIRONMENT_NAMES) {
    if (inheritedEnvironment[name]) navigatorEnvironment[name] = inheritedEnvironment[name];
  }
  return navigatorEnvironment;
}
