// ┌─────────────────────────────────────────────────────────────────────┐
// │ Module: Assistant Navigator child lifecycle                         │
// │ Role: Build supported serve-local args and request graceful stop.   │
// │ 中文：模块职责：组装Navigator参数并通过信号请求优雅退出。          │
// └─────────────────────────────────────────────────────────────────────┘

/**
 * Build the argument vector for the pinned Navigator supervisor.
 * The supervisor owns its own signal-based reverse-order child shutdown.
 */
export function createNavigatorServeArgs({
  prefix,
  scriptPath,
  stateDir,
  host,
  port,
  persistencePort,
  publicUrl,
  workspaceId,
  organizationId,
  actorId,
  principalTokenEnv,
  principalConfig,
}) {
  const args = [
    ...prefix,
    scriptPath,
    "--state-dir", stateDir,
    "--host", host,
    "--port", String(port),
    "--persistence-port", String(persistencePort),
    "--public-url", publicUrl,
    "--workspace-id", workspaceId,
    "--organization-id", organizationId,
    "--actor-id", actorId,
    "--principal-token-env", principalTokenEnv,
    "--insecure-http",
  ];
  if (principalConfig) args.push("--principal-config", principalConfig);
  return args;
}

/** Ask the Navigator supervisor to run its normal graceful shutdown path. */
export function requestNavigatorShutdown(child) {
  return child.kill("SIGTERM");
}
