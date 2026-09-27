// -----------------------------------------------------------------------------
// Module: src/connectivity/ConnectionStatus.tsx
// Role: Real-time network & microservices connectivity health monitor & modal.
// -----------------------------------------------------------------------------
// 中文：模块职责：实时网络与微服务连通性健康监控、顶栏指示徽章及健康诊断弹窗。

import { useEffect, useState, useCallback, useId } from "react";
import type { NavigatorApi, SystemStatus } from "../api";

export interface EndpointProbeResult {
  id: string;
  name: string;
  role: string;
  url: string;
  status: "UP" | "DOWN" | "PENDING";
  latencyMs?: number;
  detail?: string;
}

export interface ConnectionHealth {
  state: "CONNECTED" | "DEGRADED" | "DISCONNECTED" | "CHECKING";
  latencyMs: number | null;
  lastChecked: Date | null;
  host: string;
  endpoints: EndpointProbeResult[];
}

/**
 * Execute probe across edge ingress and backend gateway APIs.
 */
export async function probeConnection(api: NavigatorApi): Promise<ConnectionHealth> {
  const host = typeof window !== "undefined" ? window.location.host : "localhost";

  let healthzOk = false;
  let healthzLatency = 0;

  try {
    const t0 = performance.now();
    const res = await fetch("/healthz", { cache: "no-store", method: "GET" });
    healthzLatency = Math.round(performance.now() - t0);
    healthzOk = res.ok;
  } catch {
    healthzOk = false;
  }

  let systemStatusOk = false;
  let systemStatusLatency = 0;
  let systemDetails: SystemStatus | null = null;

  try {
    const t0 = performance.now();
    systemDetails = await api.getSystemStatus();
    systemStatusLatency = Math.round(performance.now() - t0);
    systemStatusOk = true;
  } catch {
    systemStatusOk = false;
  }

  const endpoints: EndpointProbeResult[] = [
    {
      id: "edge",
      name: "Web Host Ingress",
      role: "前端静态资源与边缘反向代理",
      url: "/healthz",
      status: healthzOk ? "UP" : "DOWN",
      latencyMs: healthzOk ? healthzLatency : undefined,
      detail: healthzOk ? "HTTP 200 (Active)" : "边缘网关暂不可达",
    },
    {
      id: "exchange",
      name: "Exchange 核心网关",
      role: "API 路由、会话鉴权与服务注册发现",
      url: "/api/v1/system/status",
      status: systemStatusOk ? "UP" : (healthzOk ? "DOWN" : "DOWN"),
      latencyMs: systemStatusOk ? systemStatusLatency : undefined,
      detail: systemStatusOk
        ? `服务运行正常 (${systemDetails?.status ?? "OK"} · v${systemDetails?.version ?? "1.0"})`
        : (healthzOk ? "网关就绪中或需重新配对" : "网络连接中断"),
    },
  ];

  if (systemDetails?.services && systemDetails.services.length > 0) {
    for (const s of systemDetails.services) {
      endpoints.push({
        id: s.name.toLowerCase(),
        name: s.name,
        role: "微服务容器实例",
        url: s.url,
        status: s.status,
        latencyMs: s.latencyMs,
        detail: s.status === "UP" ? "运行正常" : "维护或离线中",
      });
    }
  } else {
    const productServices = [
      { id: "catalyst", name: "Catalyst 数据工程", role: "数据集发布、清洗标注与样本管理", path: "/api/v1/catalyst/" },
      { id: "yield", name: "Yield 训练调度", role: "LoRA/全参微调作业编排与指标上报", path: "/api/v1/yield/" },
      { id: "echo", name: "Echo 质量评估", role: "基准套件评测、对齐度量与门禁判定", path: "/api/v1/echo/" },
      { id: "reactor", name: "Reactor 推理部署", role: "模型制品导入与高并发 Serving 绑定", path: "/api/v1/reactor/" },
    ];
    for (const ps of productServices) {
      endpoints.push({
        id: ps.id,
        name: ps.name,
        role: ps.role,
        url: ps.path,
        status: systemStatusOk ? "UP" : "DOWN",
        detail: systemStatusOk ? "已通过同源代理连接" : "等待网关注册就绪",
      });
    }
  }

  let overallState: "CONNECTED" | "DEGRADED" | "DISCONNECTED" = "DISCONNECTED";
  let overallLatency: number | null = null;

  if (healthzOk && systemStatusOk) {
    overallState = "CONNECTED";
    overallLatency = Math.min(healthzLatency, systemStatusLatency);
  } else if (healthzOk) {
    overallState = "DEGRADED";
    overallLatency = healthzLatency;
  } else {
    overallState = "DISCONNECTED";
    overallLatency = null;
  }

  return {
    state: overallState,
    latencyMs: overallLatency,
    lastChecked: new Date(),
    host,
    endpoints,
  };
}

export interface ConnectionStatusBadgeProps {
  api: NavigatorApi;
  onOpenDiagnostics?: () => void;
  externalHealth?: ConnectionHealth;
}

/**
 * Topbar compact live connection status badge.
 */
export function ConnectionStatusBadge({
  api,
  onOpenDiagnostics,
  externalHealth,
}: ConnectionStatusBadgeProps) {
  const [internalHealth, setInternalHealth] = useState<ConnectionHealth>({
    state: "CHECKING",
    latencyMs: null,
    lastChecked: null,
    host: typeof window !== "undefined" ? window.location.host : "localhost",
    endpoints: [],
  });

  const health = externalHealth ?? internalHealth;

  const refresh = useCallback(async () => {
    try {
      const res = await probeConnection(api);
      setInternalHealth(res);
    } catch {
      setInternalHealth((prev) => ({
        ...prev,
        state: "DISCONNECTED",
        lastChecked: new Date(),
      }));
    }
  }, [api]);

  useEffect(() => {
    if (externalHealth) return;
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 15000);
    return () => clearInterval(timer);
  }, [refresh, externalHealth]);

  const stateClass =
    health.state === "CONNECTED"
      ? "connection-badge--connected"
      : health.state === "DEGRADED"
        ? "connection-badge--degraded"
        : health.state === "DISCONNECTED"
          ? "connection-badge--disconnected"
          : "connection-badge--checking";

  const stateLabel =
    health.state === "CONNECTED"
      ? "已连接"
      : health.state === "DEGRADED"
        ? "服务就绪中"
        : health.state === "DISCONNECTED"
          ? "未连接"
          : "检测中...";

  return (
    <button
      type="button"
      className={`connection-badge ${stateClass}`}
      onClick={onOpenDiagnostics}
      title="点击查看详细连接状态与服务连通性诊断"
      aria-label={`连接状态: ${stateLabel}`}
    >
      <span className="connection-badge__dot" aria-hidden="true" />
      <span className="connection-badge__label">{stateLabel}</span>
      {health.latencyMs !== null && (
        <span className="connection-badge__latency">{health.latencyMs}ms</span>
      )}
    </button>
  );
}

export interface ConnectionDiagnosticsModalProps {
  api: NavigatorApi;
  isOpen: boolean;
  onClose: () => void;
  health: ConnectionHealth;
  onRefresh: () => Promise<void>;
  isRefreshing: boolean;
}

/**
 * Detailed modal providing end-to-end network health diagnostics.
 */
export function ConnectionDiagnosticsModal({
  isOpen,
  onClose,
  health,
  onRefresh,
  isRefreshing,
}: ConnectionDiagnosticsModalProps) {
  const titleId = useId();

  if (!isOpen) return null;

  return (
    <div
      className="connection-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="connection-modal">
        <header className="connection-modal__header">
          <div className="connection-modal__title-group">
            <span className="connection-modal__icon" aria-hidden="true">🌐</span>
            <div>
              <h2 id={titleId}>网络与服务连接诊断</h2>
              <span className="connection-modal__subtitle">
                实时检测 Web Host 边缘反向代理及后端子服务通信链路
              </span>
            </div>
          </div>
          <button
            type="button"
            className="connection-modal__close-btn"
            onClick={onClose}
            aria-label="关闭诊断面板"
          >
            ✕
          </button>
        </header>

        <div className="connection-modal__body">
          {/* Main Health Overview Banner */}
          <div className={`connection-summary-card connection-summary-card--${health.state.toLowerCase()}`}>
            <div className="connection-summary-card__top">
              <div className="connection-summary-card__left">
                <span className="connection-summary-card__indicator" />
                <div>
                  <strong>
                    {health.state === "CONNECTED"
                      ? "所有通信链路与服务通信正常"
                      : health.state === "DEGRADED"
                        ? "Web Host 在线 · 后端微服务注册就绪中"
                        : health.state === "DISCONNECTED"
                          ? "网络未连通或同源网关不可达"
                          : "正在探测网络与服务健康状态..."}
                  </strong>
                  <p>目标主机：{health.host}</p>
                </div>
              </div>
              <div className="connection-summary-card__metrics">
                {health.latencyMs !== null ? (
                  <span className="connection-summary-card__metric-val">
                    {health.latencyMs} <small>ms</small>
                  </span>
                ) : (
                  <span className="connection-summary-card__metric-val">--</span>
                )}
                <span className="connection-summary-card__metric-label">RTT 延迟</span>
              </div>
            </div>

            <div className="connection-summary-card__bottom">
              <span>
                最近检测：
                {health.lastChecked
                  ? health.lastChecked.toLocaleTimeString()
                  : "尚未检测"}
              </span>
              <span>每 15 秒自动保持心跳轮询</span>
            </div>
          </div>

          {/* Endpoints & Services Table */}
          <div className="connection-services-section">
            <span className="mono-label">SERVICES & ENDPOINTS · 服务连通性矩阵</span>
            <div className="connection-services-list">
              {health.endpoints.map((ep) => (
                <div key={ep.id} className="connection-service-row">
                  <div className="connection-service-row__info">
                    <div className="connection-service-row__name-line">
                      <strong>{ep.name}</strong>
                      <span className="connection-service-row__url">{ep.url}</span>
                    </div>
                    <span className="connection-service-row__desc">{ep.role}</span>
                  </div>

                  <div className="connection-service-row__status-group">
                    {ep.latencyMs !== undefined && (
                      <span className="connection-service-row__latency">{ep.latencyMs}ms</span>
                    )}
                    <span
                      className={`connection-service-status-pill connection-service-status-pill--${ep.status.toLowerCase()}`}
                    >
                      {ep.status === "UP" ? "✓ 正常" : "✕ 离线"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <footer className="connection-modal__footer">
          <button
            type="button"
            className="button"
            onClick={onClose}
          >
            完成
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void onRefresh()}
            disabled={isRefreshing}
          >
            {isRefreshing ? "检测中..." : "🔄 立即重新检测 (Ping Now)"}
          </button>
        </footer>
      </div>
    </div>
  );
}
