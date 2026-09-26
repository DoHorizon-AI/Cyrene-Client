// -----------------------------------------------------------------------------
// Module: src/router.ts
// Role: Minimal history router for the Cyrene client and service surfaces.
// -----------------------------------------------------------------------------
// 中文：模块职责：为 Cyrene 统一客户端与各子服务提供轻量级 history 路由。

/**
 * The pages intentionally exposed by the Cyrene WebUI navigation rail.
 * Cyrene WebUI 导航栏公开的页面与服务集合。
 */
export type RouteId =
  | "flow"
  | "catalyst"
  | "yield"
  | "echo"
  | "reactor"
  | "exchange"
  | "navigator"
  | "integrations"
  | "settings"
  | "overview"
  | "models"
  | "datasets"
  | "training"
  | "runs"
  | "deployments"
  | "gateway"
  | "chat";

/**
 * Navigation metadata used by both the shell and the route resolver.
 * 供外壳与路由解析器共同使用的导航元数据。
 */
export interface RouteDefinition {
  id: RouteId;
  label: string;
  path: string;
  description: string;
  serviceKey?: string;
}

export const ROUTES: readonly RouteDefinition[] = [
  {
    id: "flow",
    label: "Flow 画布",
    path: "/",
    description: "cyrene 全局流程画布",
    serviceKey: "flow",
  },
  {
    id: "catalyst",
    label: "Catalyst 数据集",
    path: "/catalyst",
    description: "cyrene catalyst (数据集)",
    serviceKey: "catalyst",
  },
  {
    id: "yield",
    label: "Yield 训练",
    path: "/yield",
    description: "cyrene yield (训练与诊断)",
    serviceKey: "yield",
  },
  {
    id: "echo",
    label: "Echo 评测",
    path: "/echo",
    description: "cyrene echo (质量评测)",
    serviceKey: "echo",
  },
  {
    id: "reactor",
    label: "Reactor 部署",
    path: "/reactor",
    description: "cyrene reactor (模型与部署)",
    serviceKey: "reactor",
  },
  {
    id: "exchange",
    label: "Exchange 网关",
    path: "/exchange",
    description: "cyrene exchange (网关与运维)",
    serviceKey: "exchange",
  },
  {
    id: "navigator",
    label: "Navigator 对话",
    path: "/navigator",
    description: "cyrene navigator (AI 对话客户端)",
    serviceKey: "navigator",
  },
  {
    id: "integrations",
    label: "集成与向导",
    path: "/integrations",
    description: "引导式连接与配置向导",
    serviceKey: "integrations",
  },
  {
    id: "settings",
    label: "系统设置",
    path: "/settings",
    description: "系统与会话设置",
    serviceKey: "settings",
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
  // 别名与兼容映射
  if (normalized === "/flow") {
    return "flow";
  }
  if (normalized === "/datasets" || normalized.startsWith("/datasets/")) {
    return "catalyst";
  }
  if (normalized === "/training" || normalized === "/runs" || normalized.startsWith("/runs/")) {
    return "yield";
  }
  if (normalized === "/echo" || normalized.startsWith("/echo/")) {
    return "echo";
  }
  if (
    normalized === "/models" ||
    normalized.startsWith("/models/") ||
    normalized === "/deployments" ||
    normalized.startsWith("/deployments/")
  ) {
    return "reactor";
  }
  if (normalized === "/gateway" || normalized.startsWith("/gateway/")) {
    return "exchange";
  }
  if (normalized === "/chat" || normalized.startsWith("/chat/")) {
    return "navigator";
  }
  return "flow";
}

/**
 * Return the canonical path for a route identifier.
 * 返回路由标识对应的规范路径。
 */
export function pathForRoute(route: RouteId | string): string {
  const match = ROUTES.find((definition) => definition.id === route);
  if (match) {
    return match.path;
  }
  const legacyMap: Record<string, string> = {
    overview: "/",
    models: "/reactor",
    datasets: "/catalyst",
    training: "/yield",
    runs: "/yield",
    deployments: "/reactor",
    gateway: "/exchange",
    chat: "/navigator",
  };
  return legacyMap[route] ?? (route.startsWith("/") ? route : "/");
}

/**
 * Push a route without reloading the WebUI bundle.
 * 切换到指定路由，但不重新加载 WebUI bundle。
 */
export function pushRoute(route: RouteId | string): void {
  const path = route.startsWith("/") ? route : pathForRoute(route);
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function normalizePath(pathname: string): string {
  const pathOnly = pathname.split(/[?#]/, 1)[0] ?? "/";
  const withoutTrailingSlash = pathOnly.replace(/\/+$/, "");
  return withoutTrailingSlash || "/";
}
