// ┌─────────────────────────────────────────────────────────────────────┐
// │ Module: Assistant Navigator child lifecycle declarations            │
// │ Role: Type launcher process helpers for TypeScript tests.           │
// │ 中文：模块职责：为TypeScript测试描述Navigator子进程辅助接口。     │
// └─────────────────────────────────────────────────────────────────────┘

export interface NavigatorServeOptions {
  prefix: string[];
  scriptPath: string;
  stateDir: string;
  host: string;
  port: number;
  persistencePort: number;
  publicUrl: string;
  workspaceId: string;
  organizationId: string;
  actorId: string;
  principalTokenEnv: string;
  principalConfig?: string;
}

export function createNavigatorServeArgs(options: NavigatorServeOptions): string[];
export function requestNavigatorShutdown(child: { kill(signal: "SIGTERM"): boolean }): boolean;
