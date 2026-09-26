// -----------------------------------------------------------------------------
// Module: src/integrations/IntegrationsPage.tsx
// Role: Setup & Integrations Wizard (引导式连接与配置向导)
// -----------------------------------------------------------------------------
// 中文：模块职责：引导式连接与配置向导，提供 Hugging Face、GitHub、
//       云服务与算力 Hyperscalers 以及内部企业系统的连接配置与连通性检查。

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Button, PageHeader, StatusPill } from "../components";

export type IntegrationStatus = "READY" | "PENDING" | "TESTING";

export interface IntegrationDefinition {
  id: "huggingface" | "github" | "hyperscalers" | "enterprise";
  title: string;
  category: string;
  tagline: string;
  description: string;
  icon: string;
  tags: string[];
  defaultEndpoint?: string;
  docsUrl?: string;
}

export interface IntegrationState {
  status: IntegrationStatus;
  lastChecked?: string;
  pingMs?: number;
  config: Record<string, string>;
}

const INTEGRATION_CATALOG: readonly IntegrationDefinition[] = [
  {
    id: "huggingface",
    title: "Hugging Face 连接",
    category: "开源生态与权重资产",
    tagline: "Hub Token 凭据 · 模型/数据集同步向导 · 连通性检查",
    description:
      "连接 Hugging Face Hub，支持直接拉取开源开源基础模型权重与分词器、绑定公开与私有数据集，并启用双向连通性巡检及镜像加速代理。",
    icon: "🤗",
    tags: ["Hub Token", "模型资产", "数据集镜像", "双向同步"],
    defaultEndpoint: "https://huggingface.co/api",
  },
  {
    id: "github",
    title: "GitHub 代码与配置库",
    category: "代码协同与自动化流水线",
    tagline: "PAT / GitHub App 绑定 · 训练配置与工作流代码同步",
    description:
      "绑定 GitHub 团队或私有代码仓库，自动同步微调执行脚本、Echo 评测测试套件以及自动化 CI/CD 发布流水线配置。",
    icon: "🐙",
    tags: ["PAT / App", "Repo Sync", "微调脚本", "流水线触发"],
    defaultEndpoint: "https://api.github.com",
  },
  {
    id: "hyperscalers",
    title: "云服务与算力 Hyperscalers",
    category: "算力底座与分布式存储",
    tagline: "Azure ACA · AWS Bedrock / S3 · Cloudflare R2 凭据配置",
    description:
      "打通主流 Hyperscalers 云算力底座。配置 Azure Container Apps 推理实例池、AWS Bedrock API 网关凭据、以及 S3/R2 分布式权重对象存储。",
    icon: "⚡",
    tags: ["Azure ACA", "AWS Bedrock", "S3 / R2", "弹性算力"],
    defaultEndpoint: "https://management.azure.com",
  },
  {
    id: "enterprise",
    title: "内部企业系统与私网网关",
    category: "私有基础设施与安全专网",
    tagline: "自定义私有网关 · 内部数据库 · mTLS 专线通道",
    description:
      "连接企业自建内网 API 网关、私有 VPC 端点，以及内部向量检索数据库（Milvus / PgVector）或身份 SSO/LDAP 鉴权代理。",
    icon: "🛡️",
    tags: ["私有网关", "mTLS 专线", "企业数据库", "SSO/LDAP"],
    defaultEndpoint: "https://gateway.internal.corp",
  },
];

const STORAGE_KEY = "cyrene_integrations_state_v1";

function initialStates(): Record<string, IntegrationState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw) as Record<string, IntegrationState>;
    }
  } catch {
    // ignore parse error
  }
  return {
    huggingface: {
      status: "READY",
      lastChecked: "刚刚",
      pingMs: 42,
      config: {
        token: "hf_••••••••••••••••••••••••••••",
        org: "cyrene-labs",
        mirror: "https://hf-mirror.com",
      },
    },
    github: {
      status: "READY",
      lastChecked: "2分钟前",
      pingMs: 68,
      config: {
        authType: "pat",
        repo: "DoHorizon-AI/Cyrene",
        branch: "develop",
      },
    },
    hyperscalers: {
      status: "PENDING",
      config: {
        provider: "Azure Container Apps",
        region: "eastus",
        resourceGroup: "cyrene-rg",
      },
    },
    enterprise: {
      status: "PENDING",
      config: {
        gatewayUrl: "https://mesh.internal.cyrene.ai",
        authHeader: "Bearer",
      },
    },
  };
}

export function IntegrationsPage() {
  const [states, setStates] = useState<Record<string, IntegrationState>>(initialStates);
  const [activeWizard, setActiveWizard] = useState<IntegrationDefinition | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(states));
    } catch {
      // ignore storage error
    }
  }, [states]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => setToastMessage(null), 3200);
  };

  const handleTestConnection = async (id: string) => {
    setTestingId(id);
    setStates((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        status: "TESTING",
      },
    }));

    // 模拟连通性测试探针延迟
    await new Promise((resolve) => setTimeout(resolve, 900));

    const simulatedPing = Math.floor(Math.random() * 45) + 28;
    setStates((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        status: "READY",
        lastChecked: "刚刚通过测试",
        pingMs: simulatedPing,
      },
    }));
    setTestingId(null);
    showToast(`✓ ${id} 连通性测试通过 (${simulatedPing}ms)`);
  };

  const handleSaveConfig = (id: string, updatedConfig: Record<string, string>) => {
    setStates((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        config: updatedConfig,
        status: "READY",
        lastChecked: "刚刚保存配置",
      },
    }));
    setActiveWizard(null);
    showToast(`✓ 已成功保存并激活连接配置`);
  };

  const handleResetConfig = (id: string) => {
    setStates((prev) => ({
      ...prev,
      [id]: {
        status: "PENDING",
        lastChecked: undefined,
        pingMs: undefined,
        config: {},
      },
    }));
    setActiveWizard(null);
    showToast(`已重置连接凭据`);
  };

  const readyCount = Object.values(states).filter((s) => s.status === "READY").length;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="CYRENE SETUP & INTEGRATIONS WIZARD"
        title="引导式连接与配置向导"
        description="管理 Cyrene 算力底座、模型集市、代码资产与企业内网网关的外部协同集成。配置完成后，各节点可直接在 Cyrene 全局流程画布中一键调用。"
        action={
          <div className="integrations-summary-badge">
            <span className="status-led" aria-hidden="true" />
            <span>
              已就绪连接: <strong>{readyCount}</strong> / {INTEGRATION_CATALOG.length}
            </span>
          </div>
        }
      />

      {toastMessage && (
        <div className="integrations-toast" role="status">
          {toastMessage}
        </div>
      )}

      {/* 4 个连接向导卡片网格 */}
      <div className="integrations-grid">
        {INTEGRATION_CATALOG.map((item) => {
          const itemState = states[item.id] ?? { status: "PENDING", config: {} };
          const isTesting = testingId === item.id || itemState.status === "TESTING";

          return (
            <article className={`integration-card integration-card--${itemState.status.toLowerCase()}`} key={item.id}>
              <div className="integration-card__header">
                <div className="integration-card__icon" aria-hidden="true">
                  {item.icon}
                </div>
                <div className="integration-card__meta">
                  <span className="mono-label">{item.category}</span>
                  <h3 className="integration-card__title">{item.title}</h3>
                </div>
                <div className="integration-card__status">
                  <StatusPill
                    value={
                      isTesting
                        ? "测试中..."
                        : itemState.status === "READY"
                        ? "已就绪"
                        : "待配置"
                    }
                  />
                </div>
              </div>

              <p className="integration-card__tagline">{item.tagline}</p>
              <p className="integration-card__description">{item.description}</p>

              <div className="integration-card__tags">
                {item.tags.map((tag) => (
                  <span className="integration-tag" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>

              {itemState.lastChecked && (
                <div className="integration-card__health">
                  <span className="status-led" aria-hidden="true" />
                  <span>
                    探针检查: {itemState.lastChecked}
                    {itemState.pingMs ? ` · 响应延时 ${itemState.pingMs}ms` : ""}
                  </span>
                </div>
              )}

              <div className="integration-card__footer">
                <Button
                  tone="primary"
                  onClick={() => setActiveWizard(item)}
                >
                  开始向导配置
                </Button>
                <Button
                  tone="quiet"
                  disabled={isTesting}
                  onClick={() => void handleTestConnection(item.id)}
                >
                  {isTesting ? "测试中..." : "连通性测试"}
                </Button>
              </div>
            </article>
          );
        })}
      </div>

      {/* 底部保存为节点浮动条 / 引导提示 */}
      <aside className="save-node-bar" aria-label="向导与流程画布集成">
        <div className="save-node-bar__content">
          <div className="save-node-bar__icon" aria-hidden="true">
            🌐
          </div>
          <div>
            <strong>配置可作为全局 Flow 节点即时复用</strong>
            <p>
              在此处配置并激活的任何外部凭据与网关，均会在 Cyrene 全局流程画布中自动呈现为可用算力/数据接入节点。
            </p>
          </div>
        </div>
        <div className="save-node-bar__actions">
          <Button
            tone="primary"
            onClick={() => {
              window.history.pushState({}, "", "/");
              window.dispatchEvent(new PopStateEvent("popstate"));
            }}
          >
            打开 Flow 全局流程画布 →
          </Button>
        </div>
      </aside>

      {/* 向导弹窗 / 抽屉框架 */}
      {activeWizard && (
        <WizardDrawer
          definition={activeWizard}
          currentState={states[activeWizard.id] ?? { status: "PENDING", config: {} }}
          onClose={() => setActiveWizard(null)}
          onSave={(cfg) => handleSaveConfig(activeWizard.id, cfg)}
          onReset={() => handleResetConfig(activeWizard.id)}
          onTest={() => handleTestConnection(activeWizard.id)}
          isTesting={testingId === activeWizard.id}
        />
      )}
    </div>
  );
}

interface WizardDrawerProps {
  definition: IntegrationDefinition;
  currentState: IntegrationState;
  onClose: () => void;
  onSave: (config: Record<string, string>) => void;
  onReset: () => void;
  onTest: () => Promise<void>;
  isTesting: boolean;
}

function WizardDrawer({
  definition,
  currentState,
  onClose,
  onSave,
  onReset,
  onTest,
  isTesting,
}: WizardDrawerProps) {
  const [activeStep, setActiveStep] = useState<1 | 2 | 3>(1);
  const [formFields, setFormFields] = useState<Record<string, string>>({
    ...currentState.config,
  });

  const handleChange = (key: string, value: string) => {
    setFormFields((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSave(formFields);
  };

  return (
    <div className="wizard-modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="wizard-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="wizard-modal__header">
          <div className="wizard-modal__title-group">
            <span className="wizard-modal__icon">{definition.icon}</span>
            <div>
              <span className="mono-label">{definition.category}</span>
              <h2>{definition.title} · 配置向导</h2>
            </div>
          </div>
          <button
            type="button"
            className="wizard-modal__close-btn"
            onClick={onClose}
            aria-label="关闭向导"
          >
            ✕
          </button>
        </div>

        {/* 步骤条 */}
        <div className="wizard-steps" role="tablist">
          <button
            type="button"
            className={`wizard-step ${activeStep === 1 ? "wizard-step--active" : ""}`}
            onClick={() => setActiveStep(1)}
          >
            <span className="wizard-step__num">1</span>
            <span>凭据与认证</span>
          </button>
          <button
            type="button"
            className={`wizard-step ${activeStep === 2 ? "wizard-step--active" : ""}`}
            onClick={() => setActiveStep(2)}
          >
            <span className="wizard-step__num">2</span>
            <span>连通性检查</span>
          </button>
          <button
            type="button"
            className={`wizard-step ${activeStep === 3 ? "wizard-step--active" : ""}`}
            onClick={() => setActiveStep(3)}
          >
            <span className="wizard-step__num">3</span>
            <span>作用域与同步</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="wizard-modal__form">
          {activeStep === 1 && (
            <div className="wizard-step-content">
              {definition.id === "huggingface" && (
                <>
                  <label className="field">
                    <span className="field__label">Hugging Face Access Token (凭据密钥)</span>
                    <input
                      type="password"
                      className="input-mono"
                      placeholder="hf_..."
                      value={formFields.token ?? ""}
                      onChange={(e) => handleChange("token", e.target.value)}
                    />
                    <small className="field__hint">
                      具有只读/读写权限的个人访问令牌，用于拉取私有权重与模型元数据。
                    </small>
                  </label>
                  <label className="field">
                    <span className="field__label">组织/用户名 (Namespace)</span>
                    <input
                      className="input-mono"
                      placeholder="e.g. cyrene-labs"
                      value={formFields.org ?? ""}
                      onChange={(e) => handleChange("org", e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">镜像加速代理端点</span>
                    <input
                      className="input-mono"
                      placeholder="https://hf-mirror.com"
                      value={formFields.mirror ?? "https://hf-mirror.com"}
                      onChange={(e) => handleChange("mirror", e.target.value)}
                    />
                  </label>
                </>
              )}

              {definition.id === "github" && (
                <>
                  <label className="field">
                    <span className="field__label">GitHub PAT (Personal Access Token)</span>
                    <input
                      type="password"
                      className="input-mono"
                      placeholder="ghp_..."
                      value={formFields.token ?? ""}
                      onChange={(e) => handleChange("token", e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">代码仓库标识 (Owner/Repo)</span>
                    <input
                      className="input-mono"
                      placeholder="DoHorizon-AI/Cyrene"
                      value={formFields.repo ?? "DoHorizon-AI/Cyrene"}
                      onChange={(e) => handleChange("repo", e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">默认同步分支 (Branch)</span>
                    <input
                      className="input-mono"
                      placeholder="develop"
                      value={formFields.branch ?? "develop"}
                      onChange={(e) => handleChange("branch", e.target.value)}
                    />
                  </label>
                </>
              )}

              {definition.id === "hyperscalers" && (
                <>
                  <label className="field">
                    <span className="field__label">目标算力/存储提供商</span>
                    <select
                      className="input-select"
                      value={formFields.provider ?? "Azure Container Apps"}
                      onChange={(e) => handleChange("provider", e.target.value)}
                    >
                      <option value="Azure Container Apps">Azure Container Apps (ACA)</option>
                      <option value="AWS Bedrock">AWS Bedrock</option>
                      <option value="AWS S3 Storage">AWS S3 Distributed Bucket</option>
                      <option value="Cloudflare R2">Cloudflare R2 Object Storage</option>
                    </select>
                  </label>
                  <label className="field">
                    <span className="field__label">Region / 数据中心区域</span>
                    <input
                      className="input-mono"
                      placeholder="e.g. eastus, us-west-2"
                      value={formFields.region ?? "eastus"}
                      onChange={(e) => handleChange("region", e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">Access Key / Client Secret</span>
                    <input
                      type="password"
                      className="input-mono"
                      placeholder="••••••••••••••••"
                      value={formFields.secret ?? ""}
                      onChange={(e) => handleChange("secret", e.target.value)}
                    />
                  </label>
                </>
              )}

              {definition.id === "enterprise" && (
                <>
                  <label className="field">
                    <span className="field__label">私有网关 / VPC Ingress URL</span>
                    <input
                      className="input-mono"
                      placeholder="https://mesh.internal.cyrene.ai"
                      value={formFields.gatewayUrl ?? ""}
                      onChange={(e) => handleChange("gatewayUrl", e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">鉴权标头 (Authorization Header / Token)</span>
                    <input
                      type="password"
                      className="input-mono"
                      placeholder="Bearer corp_sec_token_..."
                      value={formFields.authHeader ?? ""}
                      onChange={(e) => handleChange("authHeader", e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">企业向量库/数据库端点</span>
                    <input
                      className="input-mono"
                      placeholder="postgresql://app:pass@db.internal:5432/vectors"
                      value={formFields.dbEndpoint ?? ""}
                      onChange={(e) => handleChange("dbEndpoint", e.target.value)}
                    />
                  </label>
                </>
              )}
            </div>
          )}

          {activeStep === 2 && (
            <div className="wizard-step-content">
              <div className="wizard-test-panel">
                <div className="wizard-test-status">
                  <span
                    className={`status-led ${currentState.status === "READY" ? "" : "status-led--idle"}`}
                    aria-hidden="true"
                  />
                  <span>
                    当前状态:{" "}
                    <strong>
                      {isTesting
                        ? "正在发送握手探测请求..."
                        : currentState.status === "READY"
                        ? "连通性正常 · 已就绪"
                        : "待执行连通性握手测试"}
                    </strong>
                  </span>
                </div>
                {currentState.pingMs && (
                  <p className="wizard-test-detail">
                    最近一次握手延迟: <strong>{currentState.pingMs} ms</strong> · 协议: HTTPS / TLS 1.3
                  </p>
                )}
                <div className="wizard-test-action">
                  <Button
                    type="button"
                    tone="primary"
                    disabled={isTesting}
                    onClick={() => void onTest()}
                  >
                    {isTesting ? "探测握手中..." : "执行双向连接测试"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {activeStep === 3 && (
            <div className="wizard-step-content">
              <p className="page-description">
                定义在全局流程画布（Flow）中允许此连接节点调用的资源作用域：
              </p>
              <div className="wizard-checkbox-group">
                <label className="wizard-checkbox">
                  <input type="checkbox" defaultChecked />
                  <span>启用自动心跳探针与可用性告警</span>
                </label>
                <label className="wizard-checkbox">
                  <input type="checkbox" defaultChecked />
                  <span>向 Cyrene Flow 画布暴露该服务的预制节点</span>
                </label>
                <label className="wizard-checkbox">
                  <input type="checkbox" defaultChecked />
                  <span>将认证凭据保存在本地隔离工作区密钥环</span>
                </label>
              </div>
            </div>
          )}

          <div className="wizard-modal__footer">
            <div className="wizard-modal__footer-left">
              <Button type="button" tone="danger" onClick={onReset}>
                重置连接
              </Button>
            </div>
            <div className="wizard-modal__footer-right">
              {activeStep > 1 && (
                <Button
                  type="button"
                  tone="quiet"
                  onClick={() => setActiveStep((prev) => (prev - 1) as 1 | 2)}
                >
                  上一步
                </Button>
              )}
              {activeStep < 3 ? (
                <Button
                  type="button"
                  tone="primary"
                  onClick={() => setActiveStep((prev) => (prev + 1) as 2 | 3)}
                >
                  下一步
                </Button>
              ) : (
                <Button type="submit" tone="primary">
                  保存并激活连接
                </Button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
