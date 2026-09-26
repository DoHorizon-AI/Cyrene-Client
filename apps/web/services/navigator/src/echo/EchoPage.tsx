// -----------------------------------------------------------------------------
// Module: src/echo/EchoPage.tsx
// Role: cyrene echo (质量评测与门禁控制台)
// -----------------------------------------------------------------------------
// 中文：模块职责：cyrene echo 质量评测服务控制台，负责模型质量评测套件、
//       门禁规则校验与自动化评估指标监控。

import { useState } from "react";
import type { PageProps } from "../pages";
import { Button, PageHeader, Panel, StatusPill } from "../components";

interface EvaluationSuite {
  id: string;
  name: string;
  category: string;
  description: string;
  defaultThreshold: number;
  evaluator: "exact_match.v1" | "llm_judge.v1";
}

interface EvaluationRecord {
  id: string;
  modelName: string;
  suiteName: string;
  score: number;
  threshold: number;
  status: "PASSED" | "FAILED" | "EVALUATING";
  evaluator: string;
  timestamp: string;
  latencyMs: number;
}

const DEFAULT_SUITES: readonly EvaluationSuite[] = [
  {
    id: "suite-instruction",
    name: "通用指令遵循基准 (IFEval)",
    category: "指令遵循",
    description: "多约束指令遵循严格度验证，涵盖格式约束、字数限制及负向指令排查。",
    defaultThreshold: 0.85,
    evaluator: "exact_match.v1",
  },
  {
    id: "suite-reasoning",
    name: "GSM8K & Math 数学推理",
    category: "复杂逻辑",
    description: "多步链式推理能力校验，防止多轮思考过程中的跳步与数值漂移。",
    defaultThreshold: 0.8,
    evaluator: "exact_match.v1",
  },
  {
    id: "suite-factuality",
    name: "事实性与幻觉抑制 (Hallucination)",
    category: "安全合规",
    description: "针对知识性问答进行双向交叉检索比对，量化幻觉发生率与不确定度。",
    defaultThreshold: 0.9,
    evaluator: "llm_judge.v1",
  },
  {
    id: "suite-code",
    name: "HumanEval 代码合成基准",
    category: "代码工程",
    description: "标准 Python/TypeScript 单元测试用例通过率验证。",
    defaultThreshold: 0.75,
    evaluator: "exact_match.v1",
  },
];

const INITIAL_RECORDS: EvaluationRecord[] = [
  {
    id: "eval-001",
    modelName: "demo://models/base-1.5b (v2-lora)",
    suiteName: "通用指令遵循基准 (IFEval)",
    score: 0.88,
    threshold: 0.85,
    status: "PASSED",
    evaluator: "exact_match.v1",
    timestamp: "10分钟前",
    latencyMs: 1420,
  },
  {
    id: "eval-002",
    modelName: "demo://models/base-1.5b (v1-full)",
    suiteName: "GSM8K & Math 数学推理",
    score: 0.76,
    threshold: 0.8,
    status: "FAILED",
    evaluator: "exact_match.v1",
    timestamp: "35分钟前",
    latencyMs: 2310,
  },
  {
    id: "eval-003",
    modelName: "demo://models/base-1.5b (v2-lora)",
    suiteName: "事实性与幻觉抑制 (Hallucination)",
    score: 0.94,
    threshold: 0.9,
    status: "PASSED",
    evaluator: "llm_judge.v1",
    timestamp: "1小时前",
    latencyMs: 3890,
  },
];

export function EchoPage({ api: _api }: PageProps) {
  const [records, setRecords] = useState<EvaluationRecord[]>(INITIAL_RECORDS);
  const [selectedSuite, setSelectedSuite] = useState<string>("suite-instruction");
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const runEvaluation = async () => {
    setIsEvaluating(true);
    const suite = DEFAULT_SUITES.find((s) => s.id === selectedSuite) ?? DEFAULT_SUITES[0];
    const newRecordId = `eval-${Date.now().toString().slice(-4)}`;

    const pendingRecord: EvaluationRecord = {
      id: newRecordId,
      modelName: "demo://models/base-1.5b (最新权重)",
      suiteName: suite.name,
      score: 0,
      threshold: suite.defaultThreshold,
      status: "EVALUATING",
      evaluator: suite.evaluator,
      timestamp: "评测中...",
      latencyMs: 0,
    };

    setRecords((prev) => [pendingRecord, ...prev]);

    await new Promise((resolve) => setTimeout(resolve, 1200));

    const simulatedScore = +(0.82 + Math.random() * 0.15).toFixed(2);
    const passed = simulatedScore >= suite.defaultThreshold;

    setRecords((prev) =>
      prev.map((r) =>
        r.id === newRecordId
          ? {
              ...r,
              score: simulatedScore,
              status: passed ? "PASSED" : "FAILED",
              timestamp: "刚刚完成",
              latencyMs: Math.floor(Math.random() * 800) + 1200,
            }
          : r
      )
    );
    setIsEvaluating(false);
    setNotice(`评测任务已完成：得分为 ${(simulatedScore * 100).toFixed(0)}% · 门禁结果: ${passed ? "通过" : "未通过"}`);
    window.setTimeout(() => setNotice(null), 4000);
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="CYRENE ECHO / QUALITY EVALUATION"
        title="模型评测与质量门禁"
        description="cyrene echo 提供端到端自动化模型评测套件，支持指令遵循、逻辑推理、幻觉检测门禁；评测规则可保存为 Flow 节点无缝编排。"
        action={
          <Button tone="primary" disabled={isEvaluating} onClick={() => void runEvaluation()}>
            {isEvaluating ? "正在执行基准评测..." : "启动评测任务"}
          </Button>
        }
      />

      {notice && (
        <div className="integrations-toast" role="status">
          {notice}
        </div>
      )}

      {/* 评测套件选择与规格 */}
      <Panel title="基准测试套件 (Evaluation Benchmark Suites)">
        <div className="echo-suites-grid">
          {DEFAULT_SUITES.map((suite) => (
            <div
              key={suite.id}
              className={`echo-suite-card ${selectedSuite === suite.id ? "echo-suite-card--selected" : ""}`}
              onClick={() => setSelectedSuite(suite.id)}
            >
              <div className="echo-suite-card__header">
                <span className="mono-label">{suite.category}</span>
                <span className="status-pill status-pill--good">
                  阈值 ≥ {(suite.defaultThreshold * 100).toFixed(0)}%
                </span>
              </div>
              <h4 className="echo-suite-card__title">{suite.name}</h4>
              <p className="echo-suite-card__desc">{suite.description}</p>
              <div className="echo-suite-card__meta">
                <span>评估器: {suite.evaluator}</span>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {/* 历史评测与门禁记录 */}
      <Panel title="评测历史与质量门禁报告">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>评测编号</th>
                <th>被测模型制品</th>
                <th>评测套件</th>
                <th>得分 / 门禁阈值</th>
                <th>门禁判定</th>
                <th>评估延迟</th>
                <th>完成时间</th>
              </tr>
            </thead>
            <tbody>
              {records.map((rec) => (
                <tr key={rec.id}>
                  <td className="mono-label">{rec.id}</td>
                  <td>
                    <strong>{rec.modelName}</strong>
                  </td>
                  <td>{rec.suiteName}</td>
                  <td>
                    <span className="mono-label">
                      {rec.status === "EVALUATING"
                        ? "计算中..."
                        : `${(rec.score * 100).toFixed(0)}% (门限: ${(rec.threshold * 100).toFixed(0)}%)`}
                    </span>
                  </td>
                  <td>
                    <StatusPill
                      value={
                        rec.status === "EVALUATING"
                          ? "EVALUATING"
                          : rec.status === "PASSED"
                          ? "READY"
                          : "FAILED"
                      }
                    />
                  </td>
                  <td>{rec.latencyMs ? `${rec.latencyMs} ms` : "-"}</td>
                  <td>{rec.timestamp}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* 保存为节点浮动条 */}
      <aside className="save-node-bar" aria-label="保存评测规则为节点">
        <div className="save-node-bar__content">
          <div className="save-node-bar__icon" aria-hidden="true">
            🧪
          </div>
          <div>
            <strong>将当前评测规则保存为 Flow 节点</strong>
            <p>
              将所选套件与门禁阈值直接封装为 cyrene flow 的“质量评估 (Echo)”节点，串联在微调后与部署前。
            </p>
          </div>
        </div>
        <div className="save-node-bar__actions">
          <Button
            tone="primary"
            onClick={() => {
              setNotice("✓ 当前评测门禁规则已同步至全局 Flow 画布节点");
              window.setTimeout(() => setNotice(null), 3000);
            }}
          >
            保存为 Echo 流程节点
          </Button>
        </div>
      </aside>
    </div>
  );
}
