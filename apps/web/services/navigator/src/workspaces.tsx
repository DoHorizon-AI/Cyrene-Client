// -----------------------------------------------------------------------------
// Module: src/workspaces.tsx
// Role: Independent in-depth configuration workspaces for the six core services,
//       with "Save as Node" pipeline synchronization loop and toast notices.
// -----------------------------------------------------------------------------
// 中文：模块职责：六大核心服务的独立深度配置工作台，支持“完成修改 · 保存为节点”闭环与浮动通知。

import { useEffect, useState } from "react";
import {
  Button,
  Field,
  MetricCard,
  Panel,
  ResourceTable,
  StatusPill,
  text,
} from "./components";
import type { PageProps } from "./pages";
import {
  DatasetsPage,
  TrainingPage,
  RunsPage,
  ModelsPage,
  DeploymentsPage,
  GatewayPage,
  OverviewPage,
  ChatPage,
} from "./pages";
import { saveOrUpdateNode } from "./canvas/pipeline-store";
import { pushRoute } from "./router";
import type { JsonRecord } from "./api";

/**
 * Toast notice payload for node synchronization.
 */
export interface SaveNodeToastInfo {
  title: string;
  detail: string;
  nodeType: string;
  label?: string;
}

/**
 * Floating toast notification with return-to-canvas shortcut.
 */
export function SaveNodeToast({
  toast,
  onClose,
  onReturnToCanvas,
}: {
  toast: SaveNodeToastInfo | null;
  onClose: () => void;
  onReturnToCanvas?: () => void;
}) {
  if (!toast) return null;

  return (
    <div className="save-node-toast" role="status" aria-live="polite">
      <div className="save-node-toast__header">
        <span className="save-node-toast__title">
          <span style={{ fontSize: "16px" }}>✓</span>
          {toast.title}
        </span>
        <button className="save-node-toast__close" onClick={onClose} aria-label="关闭提示">
          ✕
        </button>
      </div>
      <div className="save-node-toast__body">{toast.detail}</div>
      <div className="save-node-toast__actions">
        <button
          className="save-node-toast__link-btn"
          onClick={() => {
            if (onReturnToCanvas) {
              onReturnToCanvas();
            } else {
              pushRoute("flow");
            }
          }}
        >
          ← 返回主画布查看
        </button>
      </div>
    </div>
  );
}

/**
 * Reusable "Save as Node" action button with consistent styling.
 */
export function SaveAsNodeButton({
  onClick,
  title = "完成修改 · 保存为节点",
  disabled = false,
}: {
  onClick: () => void;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      className="save-as-node-btn"
      onClick={onClick}
      disabled={disabled}
      type="button"
      title={title}
    >
      <span className="save-as-node-btn__glyph" aria-hidden="true">
        ⊞
      </span>
      <span>{title}</span>
    </button>
  );
}

// =============================================================================
// 1. CatalystWorkspace (对应 /catalyst)
// =============================================================================

export function CatalystWorkspace({ api }: PageProps) {
  const [toast, setToast] = useState<SaveNodeToastInfo | null>(null);
  const [datasets, setDatasets] = useState<JsonRecord[] | null>(null);
  const [selectedDatasetId, setSelectedDatasetId] = useState("");

  useEffect(() => {
    let active = true;
    void api.getDatasets().then(
      (data) => {
        if (active) {
          setDatasets(data);
          if (data.length > 0 && !selectedDatasetId) {
            setSelectedDatasetId(text(data[0]?.["id"], ""));
          }
        }
      },
      () => {
        if (active) setDatasets(null);
      },
    );
    return () => {
      active = false;
    };
  }, [api, selectedDatasetId]);

  const handleSaveNode = () => {
    const activeDataset = datasets?.find((d) => text(d["id"]) === selectedDatasetId) ?? datasets?.[0];
    const datasetId = activeDataset ? text(activeDataset["id"]) : "instruction-v1";
    const datasetName = activeDataset ? text(activeDataset["name"]) : "通用微调数据集";
    const datasetRef = `catalyst://datasets/${datasetId}`;

    saveOrUpdateNode(
      "dataset",
      { datasetRef },
      `数据集: ${datasetName}`,
      {
        kind: "dataset-version",
        resourceId: datasetId,
      },
    );

    setToast({
      title: "已成功将当前配置同步至画布节点",
      detail: `已同步数据集版本节点 [${datasetName}]，引用标识：${datasetRef}。`,
      nodeType: "dataset",
      label: datasetName,
    });
  };

  return (
    <div className="workspace-container">
      <div className="workspace-header-bar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <div>
          <span className="eyebrow" style={{ color: "#50bfaa" }}>CATALYST / DATASET WORKSPACE</span>
          <h1 style={{ margin: "4px 0", fontSize: "22px" }}>Catalyst 数据工程工作台</h1>
          <p className="page-description" style={{ margin: 0, fontSize: "13px" }}>
            管理数据集容器、标注映射与版本发布，数据样本行级预览及流式流水线节点固化。
          </p>
        </div>
        <div className="workspace-header-actions">
          <SaveAsNodeButton onClick={handleSaveNode} />
        </div>
      </div>

      <SaveNodeToast toast={toast} onClose={() => setToast(null)} />

      <DatasetsPage api={api} />
    </div>
  );
}

// =============================================================================
// 2. YieldWorkspace (对应 /yield)
// =============================================================================

export function YieldWorkspace({ api }: PageProps) {
  const [activeTab, setActiveTab] = useState<"drafts" | "runs">("drafts");
  const [toast, setToast] = useState<SaveNodeToastInfo | null>(null);

  // Hyperparameters
  const [method, setMethod] = useState<"LoRA" | "Full">("LoRA");
  const [epochs, setEpochs] = useState("3");
  const [learningRate, setLearningRate] = useState("0.0002");
  const [batchSize, setBatchSize] = useState("4");
  const [loraRank, setLoraRank] = useState("16");

  const handleSaveNode = () => {
    const epochsNum = Number(epochs) || 3;
    const lrNum = Number(learningRate) || 0.0002;
    const batchNum = Number(batchSize) || 4;
    const rankNum = Number(loraRank) || 16;

    saveOrUpdateNode(
      "training",
      {
        method,
        epochs: epochsNum,
        learningRate: lrNum,
        perDeviceBatchSize: batchNum,
        loraRank: rankNum,
      },
      `模型微调 (${method}, ${epochsNum}轮)`,
    );

    setToast({
      title: "已成功将当前配置同步至画布节点",
      detail: `已同步微调超参数：${method} 训练, ${epochsNum} 轮, LR=${lrNum}, 批大小=${batchNum}, LoRA rank=${rankNum}。`,
      nodeType: "training",
    });
  };

  return (
    <div className="workspace-container">
      <div className="workspace-header-bar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <div>
          <span className="eyebrow" style={{ color: "#aaa0ee" }}>YIELD / DISTRIBUTED TRAINING WORKSPACE</span>
          <h1 style={{ margin: "4px 0", fontSize: "22px" }}>Yield 分布式微调工作台</h1>
          <p className="page-description" style={{ margin: 0, fontSize: "13px" }}>
            整合训练草稿配置、微调超参数实验与任务运行诊断，支持将训练规则一键保存为画布流水线节点。
          </p>
        </div>
        <div className="workspace-header-actions">
          <SaveAsNodeButton onClick={handleSaveNode} />
        </div>
      </div>

      <SaveNodeToast toast={toast} onClose={() => setToast(null)} />

      {/* Quick hyperparameter tuning bar */}
      <section className="panel" style={{ marginBottom: "16px", padding: "14px 18px", border: "1px solid rgba(170, 160, 238, 0.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
          <strong style={{ fontSize: "13px", color: "var(--text)" }}>⚙ 训练节点当前超参数配置 (Training Node Hyperparameters)</strong>
          <span className="mono-label" style={{ color: "#aaa0ee" }}>YIELD ENGINE</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "12px" }}>
          <Field label="训练方式">
            <select className="input-mono" value={method} onChange={(e) => setMethod(e.target.value as "LoRA" | "Full")}>
              <option value="LoRA">LoRA (低秩微调)</option>
              <option value="Full">Full (全量微调)</option>
            </select>
          </Field>
          <Field label="训练轮数 (Epochs)">
            <input className="input-mono" type="number" min="1" max="100" value={epochs} onChange={(e) => setEpochs(e.target.value)} />
          </Field>
          <Field label="学习率 (Learning Rate)">
            <input className="input-mono" type="number" step="0.00001" value={learningRate} onChange={(e) => setLearningRate(e.target.value)} />
          </Field>
          <Field label="单卡批次 (Batch Size)">
            <input className="input-mono" type="number" min="1" max="64" value={batchSize} onChange={(e) => setBatchSize(e.target.value)} />
          </Field>
          <Field label="LoRA Rank">
            <input className="input-mono" type="number" min="1" max="256" value={loraRank} disabled={method !== "LoRA"} onChange={(e) => setLoraRank(e.target.value)} />
          </Field>
        </div>
      </section>

      {/* Tabs */}
      <div className="workspace-tabs">
        <button
          className={`workspace-tab ${activeTab === "drafts" ? "workspace-tab--active" : ""}`}
          onClick={() => setActiveTab("drafts")}
          type="button"
        >
          🛠️ 训练草稿配置 (Drafts & Preflight)
        </button>
        <button
          className={`workspace-tab ${activeTab === "runs" ? "workspace-tab--active" : ""}`}
          onClick={() => setActiveTab("runs")}
          type="button"
        >
          📊 任务运行诊断 (Runs & Diagnostics)
        </button>
      </div>

      {activeTab === "drafts" ? <TrainingPage api={api} /> : <RunsPage api={api} />}
    </div>
  );
}

// =============================================================================
// 3. EchoWorkspace (对应 /echo)
// =============================================================================

export function EchoWorkspace({ api: _api }: PageProps) {
  const [toast, setToast] = useState<SaveNodeToastInfo | null>(null);
  const [suite, setSuite] = useState("通用指令遵循基准 (MT-Bench / AlpacaEval)");
  const [evaluator, setEvaluator] = useState<"exact_match.v1" | "llm_judge.v1">("llm_judge.v1");
  const [threshold, setThreshold] = useState("0.85");
  const [testSplit, setTestSplit] = useState("benchmark-alpaca-500");
  const [dimensions, setDimensions] = useState<string[]>([
    "指令遵循完整度",
    "事实准确性与 RAG 还原",
    "安全对齐与无有害输出",
  ]);

  const toggleDimension = (dim: string) => {
    setDimensions((prev) =>
      prev.includes(dim) ? prev.filter((d) => d !== dim) : [...prev, dim],
    );
  };

  const handleSaveNode = () => {
    const numThreshold = Number(threshold) || 0.8;
    saveOrUpdateNode(
      "evaluation",
      {
        suite,
        evaluator,
        threshold: numThreshold,
      },
      `质量评估: ${suite.slice(0, 16)}...`,
    );

    setToast({
      title: "已成功将当前配置同步至画布节点",
      detail: `已同步评估门禁配置：测试集 [${suite}]，评估引擎 [${evaluator}]，通过阈值 [${(numThreshold * 100).toFixed(0)}%]。`,
      nodeType: "evaluation",
    });
  };

  return (
    <div className="workspace-container">
      <div className="workspace-header-bar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <div>
          <span className="eyebrow" style={{ color: "#aaa0ee" }}>ECHO / EVALUATION & BENCHMARK WORKSPACE</span>
          <h1 style={{ margin: "4px 0", fontSize: "22px" }}>Echo 质量评估工作台</h1>
          <p className="page-description" style={{ margin: 0, fontSize: "13px" }}>
            配置模型评测指标、基准测试集与质量门禁阈值，保障模型推理与微调质量达到上线标准。
          </p>
        </div>
        <div className="workspace-header-actions">
          <SaveAsNodeButton onClick={handleSaveNode} />
        </div>
      </div>

      <SaveNodeToast toast={toast} onClose={() => setToast(null)} />

      {/* Metrics overview */}
      <div className="metric-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "14px", marginBottom: "16px" }}>
        <MetricCard label="评测引擎" value={evaluator === "llm_judge.v1" ? "LLM Judge" : "Exact Match"} detail="支持裁判大模型与精确正则比对" accent="lime" />
        <MetricCard label="门禁阈值" value={`${(Number(threshold) * 100).toFixed(0)}%`} detail="低于该综合得分将拦截部署" accent="orange" />
        <MetricCard label="评测维度" value={`${dimensions.length} 项`} detail="包含遵循度、事实性与安全红线" accent="blue" />
        <MetricCard label="历史评测通过率" value="94.2%" detail="近 30 次自动化评测成功放行" accent="lime" />
      </div>

      {/* Configuration panel */}
      <Panel title="评估规则与质量门禁设定 (Evaluation Gate Configuration)" meta={<span className="mono-label">ECHO RULES</span>}>
        <div className="form-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px" }}>
          <Field label="评测集名称 (Benchmark Suite)" hint="声明评估所采用的公共或领域基准套件名称">
            <input
              className="input-mono"
              value={suite}
              onChange={(e) => setSuite(e.target.value)}
              placeholder="e.g. 通用指令遵循基准"
            />
          </Field>

          <Field label="评估器引擎 (Evaluator Engine)" hint="精确匹配适合抽取类任务；LLM Judge 适合开放问答">
            <select
              className="input-mono"
              value={evaluator}
              onChange={(e) => setEvaluator(e.target.value as "exact_match.v1" | "llm_judge.v1")}
            >
              <option value="llm_judge.v1">llm_judge.v1 · 大模型裁判对齐评测</option>
              <option value="exact_match.v1">exact_match.v1 · 准确率精确匹配验证</option>
            </select>
          </Field>

          <Field label={`通过门禁阈值 (Pass Threshold): ${(Number(threshold) * 100).toFixed(0)}%`} hint="若最终评估分数低于此阈值，流水线将暂停自动部署">
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "4px" }}>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                style={{ flex: 1 }}
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
              />
              <span className="mono-label" style={{ fontSize: "14px", color: "var(--lime)", minWidth: "45px" }}>
                {(Number(threshold) * 100).toFixed(0)}%
              </span>
            </div>
          </Field>

          <Field label="测试集切分规格 (Test Split)" hint="选用固定的黄金基准子集以保障评测复现性">
            <select
              className="input-mono"
              value={testSplit}
              onChange={(e) => setTestSplit(e.target.value)}
            >
              <option value="benchmark-alpaca-500">benchmark-alpaca-500 (500 样例 · 通用)</option>
              <option value="eval-code-reasoning-300">eval-code-reasoning-300 (300 样例 · 代码/推理)</option>
              <option value="safety-redteam-200">safety-redteam-200 (200 样例 · 安全对抗防御)</option>
            </select>
          </Field>
        </div>

        <div style={{ marginTop: "16px" }}>
          <span className="field__label" style={{ display: "block", marginBottom: "8px" }}>评测考核维度 (Evaluation Dimensions)</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {[
              "指令遵循完整度",
              "事实准确性与 RAG 还原",
              "安全对齐与无有害输出",
              "代码可执行性与逻辑正确性",
              "结构化 JSON/Schema 依从",
            ].map((dim) => {
              const active = dimensions.includes(dim);
              return (
                <button
                  key={dim}
                  type="button"
                  onClick={() => toggleDimension(dim)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "4px",
                    border: active ? "1px solid var(--lime)" : "1px solid var(--line)",
                    background: active ? "rgba(201, 242, 123, 0.15)" : "transparent",
                    color: active ? "var(--lime)" : "var(--muted)",
                    fontSize: "12px",
                    cursor: "pointer",
                  }}
                >
                  {active ? "✓ " : "+ "}
                  {dim}
                </button>
              );
            })}
          </div>
        </div>
      </Panel>

      {/* Historical benchmark runs */}
      <Panel title="基准测试运行历史与对齐表现 (Benchmark Execution History)" meta={<span className="mono-label">3 RUNS RECORDED</span>}>
        <ResourceTable
          caption="Echo Benchmark Runs"
          rows={[
            {
              id: "run-echo-001",
              suite: "通用指令遵循基准 (MT-Bench / AlpacaEval)",
              engine: "llm_judge.v1",
              model: "cyrene-1.5b-instruct-v2",
              score: "88.4%",
              threshold: "80.0%",
              status: "PASSED",
              time: "2026-09-26 15:32",
            },
            {
              id: "run-echo-002",
              suite: "eval-code-reasoning-300",
              engine: "exact_match.v1",
              model: "cyrene-1.5b-base",
              score: "71.2%",
              threshold: "75.0%",
              status: "FAILED",
              time: "2026-09-26 14:10",
            },
            {
              id: "run-echo-003",
              suite: "safety-redteam-200",
              engine: "llm_judge.v1",
              model: "cyrene-1.5b-instruct-v2",
              score: "99.1%",
              threshold: "95.0%",
              status: "PASSED",
              time: "2026-09-26 11:45",
            },
          ]}
          columns={[
            {
              label: "评测套件",
              render: (row) => <strong>{row.suite}</strong>,
            },
            {
              label: "引擎",
              render: (row) => <span className="mono-label">{row.engine}</span>,
            },
            {
              label: "测试模型",
              render: (row) => row.model,
            },
            {
              label: "实际得分",
              render: (row) => <strong style={{ color: "var(--lime)" }}>{row.score}</strong>,
            },
            {
              label: "门禁阈值",
              render: (row) => row.threshold,
            },
            {
              label: "状态",
              render: (row) => <StatusPill value={row.status} />,
            },
            {
              label: "时间",
              render: (row) => row.time,
            },
          ]}
          rowKey={(row) => row.id}
        />
      </Panel>
    </div>
  );
}

// =============================================================================
// 4. ReactorWorkspace (对应 /reactor)
// =============================================================================

export function ReactorWorkspace({ api }: PageProps) {
  const [activeTab, setActiveTab] = useState<"models" | "deployments">("models");
  const [toast, setToast] = useState<SaveNodeToastInfo | null>(null);

  const handleSaveNode = () => {
    if (activeTab === "models") {
      const modelRef = "demo://models/base-1.5b";
      saveOrUpdateNode(
        "model",
        { modelRef },
        "基础模型 (Reactor)",
      );
      setToast({
        title: "已成功将当前配置同步至画布节点",
        detail: `已同步基础模型节点配置：模型引用为 [${modelRef}]。`,
        nodeType: "model",
      });
    } else {
      const deploymentName = "cyrene-fast-serving-v1";
      saveOrUpdateNode(
        "deployment",
        { name: deploymentName },
        "推理部署 (Reactor)",
      );
      setToast({
        title: "已成功将当前配置同步至画布节点",
        detail: `已同步推理部署节点配置：部署服务名为 [${deploymentName}]。`,
        nodeType: "deployment",
      });
    }
  };

  return (
    <div className="workspace-container">
      <div className="workspace-header-bar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <div>
          <span className="eyebrow" style={{ color: "#68b6db" }}>REACTOR / MODEL & INFERENCE WORKSPACE</span>
          <h1 style={{ margin: "4px 0", fontSize: "22px" }}>Reactor 基础模型与推理部署工作台</h1>
          <p className="page-description" style={{ margin: 0, fontSize: "13px" }}>
            集中管理基础模型资产制品与可移植镜像，配置分布式推理部署生命周期与弹性端点。
          </p>
        </div>
        <div className="workspace-header-actions">
          <SaveAsNodeButton
            title={activeTab === "models" ? "完成修改 · 保存为基础模型节点" : "完成修改 · 保存为推理部署节点"}
            onClick={handleSaveNode}
          />
        </div>
      </div>

      <SaveNodeToast toast={toast} onClose={() => setToast(null)} />

      {/* Tabs */}
      <div className="workspace-tabs">
        <button
          className={`workspace-tab ${activeTab === "models" ? "workspace-tab--active" : ""}`}
          onClick={() => setActiveTab("models")}
          type="button"
        >
          📦 基础模型资产 (Base Models & Artifacts)
        </button>
        <button
          className={`workspace-tab ${activeTab === "deployments" ? "workspace-tab--active" : ""}`}
          onClick={() => setActiveTab("deployments")}
          type="button"
        >
          🚀 推理部署服务 (Serving Deployments)
        </button>
      </div>

      {activeTab === "models" ? <ModelsPage api={api} /> : <DeploymentsPage api={api} />}
    </div>
  );
}

// =============================================================================
// 5. ExchangeWorkspace (对应 /exchange)
// =============================================================================

export function ExchangeWorkspace({ api }: PageProps) {
  const [activeTab, setActiveTab] = useState<"gateway" | "overview">("gateway");
  const [toast, setToast] = useState<SaveNodeToastInfo | null>(null);

  const handleSaveNode = () => {
    const modelId = "cyrene-chat-default";
    saveOrUpdateNode(
      "exchange_gateway",
      {
        modelId,
        requireApiKey: "true",
      },
      "API 网关接入 (Exchange)",
    );

    setToast({
      title: "已成功将当前配置同步至画布节点",
      detail: `已同步网关接入节点配置：对外模型名 [${modelId}]，强制 API Key 鉴权。`,
      nodeType: "exchange_gateway",
    });
  };

  return (
    <div className="workspace-container">
      <div className="workspace-header-bar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <div>
          <span className="eyebrow" style={{ color: "#48c774" }}>EXCHANGE / GATEWAY & PULSE WORKSPACE</span>
          <h1 style={{ margin: "4px 0", fontSize: "22px" }}>Exchange API 网关与系统观测大盘</h1>
          <p className="page-description" style={{ margin: 0, fontSize: "13px" }}>
            管理 OpenAI 兼容 API 路由、多租户 API Key 凭证与端点鉴权，全景观测服务健康与集群硬件大盘。
          </p>
        </div>
        <div className="workspace-header-actions">
          <SaveAsNodeButton onClick={handleSaveNode} />
        </div>
      </div>

      <SaveNodeToast toast={toast} onClose={() => setToast(null)} />

      {/* Tabs */}
      <div className="workspace-tabs">
        <button
          className={`workspace-tab ${activeTab === "gateway" ? "workspace-tab--active" : ""}`}
          onClick={() => setActiveTab("gateway")}
          type="button"
        >
          🔑 网关路由与密钥管理 (Gateway Routes & API Keys)
        </button>
        <button
          className={`workspace-tab ${activeTab === "overview" ? "workspace-tab--active" : ""}`}
          onClick={() => setActiveTab("overview")}
          type="button"
        >
          📈 服务健康与硬件大盘 (Service Pulse & System Overview)
        </button>
      </div>

      {activeTab === "gateway" ? <GatewayPage api={api} /> : <OverviewPage api={api} />}
    </div>
  );
}

// =============================================================================
// 6. NavigatorWorkspace (对应 /navigator)
// =============================================================================

export function NavigatorWorkspace({ api }: PageProps) {
  const [toast, setToast] = useState<SaveNodeToastInfo | null>(null);
  const [systemPrompt, setSystemPrompt] = useState("你是一个友好高效的 Cyrene 智能助手。");
  const [showPromptEditor, setShowPromptEditor] = useState(false);

  const handleSaveNode = () => {
    saveOrUpdateNode(
      "agent",
      { task: systemPrompt },
      "Agent 对话 (Navigator)",
    );

    setToast({
      title: "已成功将当前配置同步至画布节点",
      detail: `已同步 Agent 对话节点配置，当前系统提示词设定已固化至主画布。`,
      nodeType: "agent",
    });
  };

  return (
    <div className="workspace-container">
      <div className="workspace-header-bar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <div>
          <span className="eyebrow" style={{ color: "#d693b1" }}>NAVIGATOR / AI INTERACTIVE CLIENT</span>
          <h1 style={{ margin: "4px 0", fontSize: "22px" }}>Navigator AI 客户端对话工作台</h1>
          <p className="page-description" style={{ margin: 0, fontSize: "13px" }}>
            纯粹专注的 AI 客户端体验环境，支持模型选择、系统提示词定制与实时流式对话验证。
          </p>
        </div>
        <div className="workspace-header-actions">
          <Button
            tone="quiet"
            onClick={() => setShowPromptEditor((prev) => !prev)}
            style={{ fontSize: "12px" }}
          >
            {showPromptEditor ? "收起提示词设定" : "⚙ 预设提示词"}
          </Button>
          <SaveAsNodeButton onClick={handleSaveNode} />
        </div>
      </div>

      <SaveNodeToast toast={toast} onClose={() => setToast(null)} />

      {showPromptEditor && (
        <Panel title="预设系统提示词 (System Task Prompt)" meta={<span className="mono-label">AGENT PROMPT</span>} className="animate-fade-in">
          <Field label="System Prompt" hint="固化为 Agent 节点的预设系统指令">
            <textarea
              className="input-mono"
              rows={3}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              style={{ width: "100%", padding: "8px", borderRadius: "4px", background: "rgba(0,0,0,0.3)", color: "var(--text)" }}
            />
          </Field>
        </Panel>
      )}

      {/* Pure AI Chat experience based on ChatPage */}
      <ChatPage api={api} />
    </div>
  );
}
