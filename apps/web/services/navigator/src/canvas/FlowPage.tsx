// -----------------------------------------------------------------------------
// Module: src/canvas/FlowPage.tsx
// Role: High-fidelity Flow Engine homepage canvas view for Cyrene Console.
// -----------------------------------------------------------------------------

import { useState, useRef, useEffect, useMemo } from "react";
import { GraphCanvas, type GraphHandle } from "./GraphCanvas";
import { usePipelineStore } from "./pipeline-store";
import { inspect, type Pipeline, type PipelineNode } from "../model/pipeline";
import { catalog, definitions } from "../model/catalog";
import { pushRoute } from "../router";
import "litegraph.js/css/litegraph.css";
import "./flow-page.css";

export function serviceRouteForNode(type: string): { route: string; serviceName: string } {
  switch (type) {
    case "dataset":
      return { route: "/catalyst", serviceName: "Catalyst 数据集管理" };
    case "model":
      return { route: "/reactor", serviceName: "Reactor 基础模型" };
    case "compute":
      return { route: "/settings", serviceName: "算力与环境配置" };
    case "training":
      return { route: "/yield", serviceName: "Yield 模型微调中心" };
    case "evaluation":
      return { route: "/echo", serviceName: "Echo 模型评估服务" };
    case "deployment":
      return { route: "/reactor", serviceName: "Reactor 推理与部署" };
    case "exchange_gateway":
    case "gateway":
      return { route: "/exchange", serviceName: "Exchange API 网关" };
    case "agent":
      return { route: "/navigator", serviceName: "Navigator 智能体与会话" };
    default:
      return { route: "/", serviceName: "Cyrene 默认工作台" };
  }
}

export function FlowPage() {
  const { pipeline, setPipeline, resetToExample, clearPipeline } = usePipelineStore();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [showIssues, setShowIssues] = useState(false);

  // Simulation execution state
  const [simRunning, setSimRunning] = useState(false);
  const [simPlan, setSimPlan] = useState<string[]>([]);
  const [simCursor, setSimCursor] = useState(0);
  const [simMessage, setSimMessage] = useState<string | null>(null);

  const canvasRef = useRef<GraphHandle>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const inspectResult = useMemo(() => inspect(pipeline), [pipeline]);

  const selectedNode: PipelineNode | undefined = useMemo(() => {
    if (!selectedNodeId) return undefined;
    return pipeline.nodes.find((n) => n.id === selectedNodeId);
  }, [selectedNodeId, pipeline.nodes]);

  const selectedDef = selectedNode
    ? definitions.get(selectedNode.type) ||
      (selectedNode.type === "gateway" ? definitions.get("exchange_gateway") : undefined)
    : undefined;

  // Handle outside clicks to close the dropdown menu
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setAddMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Topological Simulation Loop
  useEffect(() => {
    if (!simRunning) return;

    if (simCursor >= simPlan.length) {
      setSimRunning(false);
      setSimMessage("流程拓扑预演完成：全部节点已按依赖拓扑完成模拟执行！");
      return;
    }

    const currentId = simPlan[simCursor];
    canvasRef.current?.highlightNode(currentId, "running");

    const timer = window.setTimeout(() => {
      canvasRef.current?.highlightNode(currentId, "done");
      setSimCursor((prev) => prev + 1);
    }, 700);

    return () => window.clearTimeout(timer);
  }, [simRunning, simCursor, simPlan]);

  const startSimulation = () => {
    if (inspectResult.issues.length > 0) {
      setShowIssues(true);
      setSimMessage(`拓扑校验发现 ${inspectResult.issues.length} 个问题，无法开始预演。请先完善节点连线。`);
      return;
    }
    canvasRef.current?.clearHighlights();
    setSimPlan(inspectResult.order);
    setSimCursor(0);
    setSimRunning(true);
    setSimMessage("依赖顺序预演中：正在按 Kahn 拓扑排序逐步模拟执行...");
  };

  const stopSimulation = () => {
    setSimRunning(false);
    setSimMessage("预演已手动终止。");
    canvasRef.current?.clearHighlights();
  };

  const handleCanvasChange = (updated: Pipeline) => {
    setPipeline(updated, { persist: true });
    if (simRunning) {
      stopSimulation();
    }
  };

  const handleAddNode = (type: string) => {
    setAddMenuOpen(false);
    canvasRef.current?.add(type);
  };

  const handleDeleteSelected = () => {
    if (selectedNodeId) {
      canvasRef.current?.remove(selectedNodeId);
      setSelectedNodeId(null);
    }
  };

  const handleOpenWorkspace = () => {
    if (!selectedNode) return;
    const target = serviceRouteForNode(selectedNode.type);
    pushRoute(target.route);
  };

  return (
    <div className="flow-page">
      {/* 顶部工具栏 */}
      <header className="flow-toolbar">
        <div className="flow-toolbar__title">
          <span className="flow-brand-dot" aria-hidden="true" />
          <strong>Cyrene Flow Engine</strong>
          <span className="flow-toolbar__sep">/</span>
          <span className="flow-toolbar__name">{pipeline.name}</span>
          <span className="flow-badge">
            {pipeline.nodes.length} 节点 · {pipeline.edges.length} 连线
          </span>
          {inspectResult.issues.length === 0 ? (
            <span className="flow-status flow-status--valid">✓ 拓扑有效</span>
          ) : (
            <button
              className="flow-status flow-status--invalid"
              onClick={() => setShowIssues(!showIssues)}
              title="点击查看具体问题"
              style={{ cursor: "pointer", border: "none" }}
            >
              ! {inspectResult.issues.length} 个拓扑问题
            </button>
          )}
        </div>

        <div className="flow-toolbar__actions">
          {/* 添加节点下拉菜单 */}
          <div className="flow-dropdown" ref={dropdownRef}>
            <button
              className="flow-btn flow-btn--primary"
              onClick={() => setAddMenuOpen(!addMenuOpen)}
              disabled={simRunning}
            >
              + 添加节点 ▼
            </button>
            {addMenuOpen && (
              <div className="flow-menu" role="menu">
                {catalog.map((item) => (
                  <button
                    key={item.type}
                    className="flow-menu__item"
                    role="menuitem"
                    onClick={() => handleAddNode(item.type)}
                  >
                    <span
                      className="flow-menu__color-tag"
                      style={{ backgroundColor: item.color }}
                    />
                    <span>{item.title}</span>
                    <small style={{ color: "#8da39f", marginLeft: "auto" }}>{item.owner}</small>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            className="flow-btn"
            onClick={() => canvasRef.current?.fit()}
            title="缩放平移使全部节点居中"
          >
            适应画布
          </button>

          <button
            className="flow-btn"
            onClick={() => {
              if (window.confirm("确定要重置回系统默认示例流水线吗？")) {
                const initial = resetToExample();
                canvasRef.current?.load(initial);
                setSelectedNodeId(null);
                stopSimulation();
              }
            }}
            disabled={simRunning}
          >
            重置示例
          </button>

          <button
            className="flow-btn flow-btn--danger"
            onClick={() => {
              if (window.confirm("确定要清空画布上的所有节点和连线吗？")) {
                clearPipeline();
                canvasRef.current?.load(
                  {
                    schemaVersion: "cyrene.pipeline.prototype.v1",
                    id: "empty-pipeline",
                    name: "新流水线",
                    nodes: [],
                    edges: [],
                    presentation: { nodes: {} },
                  },
                  { fit: false }
                );
                setSelectedNodeId(null);
                stopSimulation();
              }
            }}
            disabled={simRunning}
          >
            清空
          </button>
        </div>
      </header>

      {/* 拓扑问题抽屉/展开行 */}
      {showIssues && inspectResult.issues.length > 0 && (
        <div className="flow-issues-box">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>拓扑与端口检查发现 {inspectResult.issues.length} 个问题：</strong>
            <button
              className="flow-btn"
              style={{ padding: "2px 6px", fontSize: "11px" }}
              onClick={() => setShowIssues(false)}
            >
              收起
            </button>
          </div>
          <ul className="flow-issues-list">
            {inspectResult.issues.map((issue, idx) => (
              <li key={`${issue.code}-${idx}`}>
                • {issue.message}{" "}
                {issue.nodeId && (
                  <button onClick={() => canvasRef.current?.select(issue.nodeId!)}>
                    [定位节点]
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 画布核心区域 */}
      <div className="flow-canvas-wrapper">
        <GraphCanvas
          ref={canvasRef}
          initial={pipeline}
          interactive={!simRunning}
          onChange={handleCanvasChange}
          onSelect={setSelectedNodeId}
        />

        <div className="flow-canvas-hint">
          滚轮缩放 · 拖拽平移 · 连线端口 · 点击选中节点
        </div>

        {simRunning && (
          <div className="flow-canvas-lock">
            正在预演依赖顺序 · 画布交互锁定
          </div>
        )}

        {/* 选中节点信息抽屉/侧边面板 */}
        {selectedNode && (
          <aside className="flow-drawer" aria-label="节点信息面板">
            <div className="flow-drawer__header">
              <div className="flow-drawer__title">
                <span
                  style={{
                    display: "inline-block",
                    width: "12px",
                    height: "12px",
                    borderRadius: "3px",
                    backgroundColor: selectedDef?.color || "#fff",
                  }}
                />
                <strong>{selectedNode.label}</strong>
              </div>
              <button
                className="flow-drawer__close"
                onClick={() => {
                  setSelectedNodeId(null);
                  canvasRef.current?.select(null);
                }}
                aria-label="关闭面板"
              >
                ✕
              </button>
            </div>

            <div className="flow-drawer__body">
              <div className="flow-drawer__section">
                <span className="flow-drawer__label">节点类别 / 所属服务</span>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <span className="flow-badge">{selectedDef?.category || "通用"}</span>
                  <span
                    className="flow-badge"
                    style={{ color: selectedDef?.color, borderColor: selectedDef?.color }}
                  >
                    {selectedDef?.owner || selectedNode.type}
                  </span>
                </div>
              </div>

              {selectedDef?.description && (
                <div className="flow-drawer__section">
                  <span className="flow-drawer__label">说明</span>
                  <p className="flow-drawer__desc">{selectedDef.description}</p>
                </div>
              )}

              {/* 核心醒目操作按钮：打开对应专业工作台 */}
              <div className="flow-action-card">
                <span className="flow-drawer__label" style={{ color: "var(--coral, #f2918c)" }}>
                  专业工作台联动
                </span>
                <span className="flow-action-card__hint">
                  跳转到专属于该节点的微服务控制台，管理完整数据、训练或运行指标：
                </span>
                <button
                  className="flow-btn--workspace"
                  onClick={handleOpenWorkspace}
                >
                  打开对应专业工作台 (Open Full Workspace) →
                </button>
                <div style={{ fontSize: "11px", color: "#8da39f", textAlign: "center" }}>
                  目标服务: {serviceRouteForNode(selectedNode.type).serviceName} (
                  <code>{serviceRouteForNode(selectedNode.type).route}</code>)
                </div>
              </div>

              {/* 当前配置摘要 */}
              <div className="flow-drawer__section">
                <span className="flow-drawer__label">当前配置摘要 (Config Summary)</span>
                {Object.keys(selectedNode.config).length > 0 ? (
                  <table className="flow-config-table">
                    <tbody>
                      {Object.entries(selectedNode.config).map(([key, val]) => (
                        <tr key={key}>
                          <td>{key}</td>
                          <td>{String(val)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p style={{ fontSize: "12px", color: "#8da39f" }}>暂无配置项</p>
                )}
              </div>

              {/* 端口摘要 */}
              {selectedDef && (
                <div className="flow-drawer__section">
                  <span className="flow-drawer__label">端口规范</span>
                  <div style={{ fontSize: "11px", display: "flex", flexDirection: "column", gap: "4px" }}>
                    <div>
                      <strong style={{ color: "#8da39f" }}>输入端口: </strong>
                      {selectedDef.inputs.length === 0
                        ? "无"
                        : selectedDef.inputs.map((p) => `${p.label} (${p.kind})`).join(", ")}
                    </div>
                    <div>
                      <strong style={{ color: "#8da39f" }}>输出端口: </strong>
                      {selectedDef.outputs.length === 0
                        ? "无"
                        : selectedDef.outputs.map((p) => `${p.label} (${p.kind})`).join(", ")}
                    </div>
                  </div>
                </div>
              )}

              {/* 删除该节点按钮 */}
              <div style={{ marginTop: "auto", paddingTop: "12px" }}>
                <button
                  className="flow-btn flow-btn--danger"
                  style={{ width: "100%", justifyContent: "center" }}
                  onClick={handleDeleteSelected}
                >
                  删除该节点
                </button>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* 底部“运行预演”控制条 */}
      <footer className="flow-bottom-bar">
        <div className="flow-bottom-bar__main">
          <div className="flow-sim-controls">
            {!simRunning ? (
              <button
                className="flow-btn flow-btn--primary"
                onClick={startSimulation}
                title="按有向无环图拓扑排序模拟运行流水线"
              >
                运行预演 (Run Simulation) ▶
              </button>
            ) : (
              <button
                className="flow-btn flow-btn--danger"
                onClick={stopSimulation}
                title="终止正在进行的拓扑预演"
              >
                停止预演 (Stop) ■
              </button>
            )}

            {simMessage && (
              <span
                style={{
                  fontSize: "12px",
                  color: simRunning ? "#ffb76b" : "#b7cbca",
                  fontFamily: "var(--mono, monospace)",
                }}
              >
                {simMessage}
              </span>
            )}
          </div>

          {/* 步骤条展示 */}
          <div className="flow-sim-steps" aria-label="执行顺序步骤条">
            {inspectResult.order.map((nodeId, idx) => {
              const node = pipeline.nodes.find((n) => n.id === nodeId);
              const isCurrent = simRunning && simPlan[simCursor] === nodeId;
              const isDone =
                simCursor > idx || (!simRunning && simPlan.length > 0 && simCursor >= simPlan.length);

              return (
                <div
                  key={nodeId}
                  className={`flow-step-pill ${
                    isCurrent
                      ? "flow-step-pill--current"
                      : isDone
                      ? "flow-step-pill--done"
                      : ""
                  }`}
                  onClick={() => canvasRef.current?.select(nodeId)}
                  style={{ cursor: "pointer" }}
                  title="点击在画布中定位此节点"
                >
                  <span>{isDone ? "✓" : idx + 1}</span>
                  <span>{node?.label || nodeId}</span>
                </div>
              );
            })}
          </div>
        </div>
      </footer>
    </div>
  );
}
