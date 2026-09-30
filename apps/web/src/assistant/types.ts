export interface Model { id: string; name: string; efforts: string[]; images: boolean; contextWindow: number; maxTokens: number }
export interface Runtime { id: 'harness' | 'codex' | 'claude' | 'cursor' | 'codebuddy'; available: boolean; reason?: string; models: Model[] }
export interface Provider { id: string; name: string; protocol: 'openai-completions' | 'openai-responses' | 'anthropic-messages'; baseURL: string; models: Model[]; credentialConfigured?: boolean }
export type Permission = 'read-only' | 'ask' | 'auto' | 'full-access';
export interface Session { id: string; title: string; runtime: Runtime['id']; providerId?: string; nativeId?: string; cwd: string; permission: Permission; state: 'idle' | 'running' | 'unknown'; updatedAt: number }
export interface AssistantEvent { seq: number; sessionId: string; turnId: string; requestId: string; type: 'user' | 'text' | 'summary' | 'tool' | 'approval' | 'approval-resolved' | 'status' | 'error'; data: Record<string, unknown>; time: number }
export interface Attachment { id: string; name: string; mediaType: string; size: number }
export interface HostInfo { version: string; runtimes: Runtime[]; providers: Provider[]; cwd: string; workspaceId?: string }
