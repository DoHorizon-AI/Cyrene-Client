// -----------------------------------------------------------------------------
// Module: src/router.ts
// Role: Minimal history router for the Navigator management surfaces.
// -----------------------------------------------------------------------------
// 中文：模块职责：为 Navigator 管理页面提供轻量级 history 路由。

/**
 * The pages intentionally exposed by the Navigator WebUI navigation rail.
 * Navigator WebUI 导航栏有意公开的页面集合。
 */
export type RouteId =
  | "overview"
  | "models"
  | "datasets"
  | "echo"
  | "training"
  | "runs"
  | "deployments"
  | "gateway"
  | "settings"
  | "chat"
  | "assistant";

/**
 * Navigation metadata used by both the shell and the route resolver.
 * 供外壳与路由解析器共同使用的导航元数据。
 */
export interface RouteDefinition {
  id: RouteId;
  label: string;
  path: string;
  description: string;
}

export const ROUTES: readonly RouteDefinition[] = [
  {
    id: "overview",
    label: "Overview",
    path: "/",
    description: "Workspace pulse and service reachability",
  },
  {
    id: "models",
    label: "Models",
    path: "/models",
    description: "Imports, validation, and artifacts",
  },
  {
    id: "datasets",
    label: "Datasets",
    path: "/datasets",
    description: "Containers and preparation handoffs",
  },
  {
    id: "echo",
    label: "Echo",
    path: "/echo",
    description: "Evaluation suites, inputs, and reports",
  },
  {
    id: "training",
    label: "Training",
    path: "/training",
    description: "Drafts, preflight, and launch intent",
  },
  {
    id: "runs",
    label: "Runs",
    path: "/runs",
    description: "Run detail and attempt diagnostics",
  },
  {
    id: "deployments",
    label: "Deployments",
    path: "/deployments",
    description: "Serving lifecycle and readiness",
  },
  {
    id: "gateway",
    label: "Gateway",
    path: "/gateway",
    description: "Routes, API keys, and client configuration",
  },
  {
    id: "chat",
    label: "Chat",
    path: "/chat",
    description: "Exchange model testing with active route",
  },
  {
    id: "assistant",
    label: "Work Assistant",
    path: "/assistant",
    description: "Tasks, approvals, memory, and host connectors",
  },
  {
    id: "settings",
    label: "Settings",
    path: "/settings",
    description: "Workspace session and credentials",
  },
];

/**
 * Resolve a browser path without introducing a second routing dependency.
 * 在不引入第二套路由依赖的前提下解析浏览器路径。
 */
export function routeForPath(pathname: string): RouteId {
  const normalized = normalizePath(pathname);
  const match = ROUTES.find((route) => route.path === normalized);
  if (match) {
    return match.id;
  }
  if (normalized.startsWith("/runs/")) {
    return "runs";
  }
  return "overview";
}

/**
 * Return the canonical path for a route identifier.
 * 返回路由标识对应的规范路径。
 */
export function pathForRoute(route: RouteId): string {
  return ROUTES.find((definition) => definition.id === route)?.path ?? "/";
}

/**
 * Push a route without reloading the WebUI bundle.
 * 切换到指定路由，但不重新加载 WebUI bundle。
 */
export function pushRoute(route: RouteId): void {
  window.history.pushState({}, "", pathForRoute(route));
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Navigate to the run accepted by Yield. 中文：跳转到 Yield 已接受的任务。 */
export function pushRunRoute(runId: string, workspaceId?: string): void {
  const query = new URLSearchParams({ runId });
  const workspace = workspaceId ?? new URLSearchParams(window.location.search).get("workspaceId");
  if (workspace) query.set("workspaceId", workspace);
  window.history.pushState({}, "", `${pathForRoute("runs")}?${query}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Read a bookmarked run without treating malformed URLs as application errors.
 * 中文：读取书签任务；错误编码的地址不会导致整个页面崩溃。
 */
export function runIdForLocation(location: Pick<Location, "pathname" | "search">): string {
  if (routeForPath(location.pathname) !== "runs") return "";
  const query = new URLSearchParams(location.search).get("runId");
  if (query !== null) return query.trim();
  try { return decodeURIComponent(location.pathname.match(/^\/runs\/([^/]+)\/?$/)?.[1] ?? "").trim(); }
  catch { return ""; }
}

function normalizePath(pathname: string): string {
  const pathOnly = pathname.split(/[?#]/, 1)[0] ?? "/";
  const withoutTrailingSlash = pathOnly.replace(/\/+$/, "");
  return withoutTrailingSlash || "/";
}
