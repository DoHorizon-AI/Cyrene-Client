import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Button, Field, formatDate, PageHeader, Panel, ResourceTable, StateBlock, StatusPill, text } from "../components";
import { type ApiKeyMetadata, type JsonRecord, type SystemStatus } from "../api";
import { pushRoute } from "../router";
import { useI18n } from "../i18n";
import { type PageProps, Detail, resourceId, errorMessage } from "./shared";

/**
 * Exchange Gateway routes, invocation snippets, and API key lifecycle administration.
 * 管理 Exchange Gateway 路由、调用示例和 API key 生命周期。
 */
export function GatewayPage({ api }: PageProps) {
  const { t } = useI18n();
  const [reloadKey, setReloadKey] = useState(0);
  const [routes, setRoutes] = useState<JsonRecord[] | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<JsonRecord | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeyMetadata[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeCodeTab, setActiveCodeTab] = useState<"curl" | "python" | "javascript">("curl");

  // New key form state
  // 中文：新建 API key 表单状态。
  const [keyName, setKeyName] = useState("");
  const [expiresDays, setExpiresDays] = useState("");
  const [modelScope, setModelScope] = useState("");
  const [creatingKey, setCreatingKey] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [createdKeyName, setCreatedKeyName] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [copiedBaseUrl, setCopiedBaseUrl] = useState(false);
  const [system, setSystem] = useState<SystemStatus | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.allSettled([
      api.getGatewayRoutes(),
      api.listApiKeys().catch(() => []),
      api.getSystemStatus(),
    ]).then(([routesRes, keysRes, systemRes]) => {
      if (!active) return;
      if (routesRes.status === "fulfilled") {
        setRoutes(routesRes.value);
        if (routesRes.value.length > 0) {
          setSelectedRoute((prev) => prev ?? routesRes.value[0]);
        }
        setError(null);
      } else {
        setRoutes(null);
        setError(errorMessage(routesRes.reason));
      }

      if (keysRes.status === "fulfilled") {
        setApiKeys(keysRes.value);
      } else {
        setApiKeys([]);
      }

      // A missing status only costs us the published gateway URL; the route and
      // key panels above must still render.
      // 中文：状态缺失只会导致无法显示已发布的 Gateway URL；上方的路由和密钥面板仍必须正常显示。
      setSystem(systemRes.status === "fulfilled" ? systemRes.value : null);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [api, reloadKey]);

  const refresh = () => setReloadKey((v) => v + 1);

  const confirmRoute = async (route: JsonRecord) => {
    const id = text(route["id"]);
    const version = typeof route["resourceVersion"] === "number" ? route["resourceVersion"] : 1;
    setActionError(null);
    setActionNotice(null);
    try {
      await api.confirmGatewayRoute(id, version);
      setActionNotice(`Route ${text(route["modelPattern"] || route["model_pattern"] || id)} confirmed and published.`);
      refresh();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  const handleCreateKey = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = keyName.trim();
    if (!name) return;
    setCreatingKey(true);
    setActionError(null);
    try {
      let expiresAt: string | null = null;
      const days = parseInt(expiresDays, 10);
      if (!isNaN(days) && days > 0) {
        expiresAt = new Date(Date.now() + days * 86400000).toISOString();
      }
      const scope = modelScope
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await api.createApiKey(text(selectedRoute?.["id"] ?? ""), {
        name,
        expiresAt,
        modelScope: scope,
      });
      setCreatedSecret(res.secret);
      setCreatedKeyName(res.key.name);
      setKeyName("");
      setExpiresDays("");
      setModelScope("");
      refresh();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setCreatingKey(false);
    }
  };

  const handleRevokeKey = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to revoke API key "${name}"? This action is immediate and permanent.`)) {
      return;
    }
    setActionError(null);
    try {
      await api.revokeApiKey(id);
      refresh();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  // The published gateway URL wins. Deriving it in the browser assumed Exchange
  // sits on one fixed port, which is wrong for the dev stack (8000) and for any
  // HTTPS deployment, so every snippet below was pointing at a dead endpoint.
  // 中文：优先使用已发布的 Gateway URL。若在浏览器中自行推导地址，就等于假设 Exchange 固定使用一个端口；开发环境端口为 8000，HTTPS 部署也不同，因此下方所有调用示例都会指向失效 Endpoint。
  const baseUrl =
    system?.gatewayBaseUrl ??
    (typeof window !== "undefined"
      ? `${window.location.protocol}//${window.location.hostname}:8003/v1`
      : "http://localhost:8003/v1");

  const handleUseInNavigator = async (route: JsonRecord) => {
    const gatewayEndpointId = text(route["gatewayEndpointId"] || route["gateway_endpoint_id"] || route["id"]);
    const model = text(route["modelPattern"] || route["model_pattern"] || route["targetModel"] || "default-model");
    try {
      await api.setActiveRoute({
        gatewayEndpointId,
        modelId: model,
        baseUrl,
        apiKeyHint: text(route["name"] || model),
      });
      pushRoute("chat");
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  const modelId = text(
    selectedRoute?.["modelPattern"] ?? selectedRoute?.["model_pattern"] ?? selectedRoute?.["targetModel"] ?? "default-model"
  );

  const snippets = {
    curl: `curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer <API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "${modelId}", "messages": [{"role":"user","content":"Hello"}]}'`,
    python: `from openai import OpenAI

client = OpenAI(api_key="<API_KEY>", base_url="${baseUrl}")
response = client.chat.completions.create(
    model="${modelId}",
    messages=[{"role": "user", "content": "Hello"}]
)
print(response.choices[0].message.content)`,
    javascript: `import OpenAI from 'openai';

const client = new OpenAI({ apiKey: '<API_KEY>', baseURL: '${baseUrl}' });
const response = await client.chat.completions.create({
    model: '${modelId}',
    messages: [{ role: 'user', content: 'Hello' }],
});
console.log(response.choices[0].message.content);`,
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Exchange / Gateway"
        title={t("Routes, API keys, and client configuration.")}
        description="Exchange acts as the single OpenAI-compatible data plane. Publish model routes, copy client integration code, and manage caller API keys."
        action={
          <Button onClick={refresh} disabled={loading} aria-label={t("Refresh gateway")}>
            {loading ? "Reading..." : "Refresh"}
          </Button>
        }
      />

      {actionNotice ? (
        <div className="callout callout--blue">
          <span className="callout__mark" aria-hidden="true">✓</span>
          <p>{actionNotice}</p>
        </div>
      ) : null}
      {actionError ? (
        <div className="callout callout--red">
          <span className="callout__mark" aria-hidden="true">!</span>
          <p><strong>{t("Error:")}</strong> {actionError}</p>
        </div>
      ) : null}

      {/* 1. Gateway Routes Table */}
      <Panel
        title={t("Gateway routes")}
        meta={routes ? `${routes.length} configured` : "EXCHANGE OWNER"}
      >
        {loading && !routes ? (
          <StateBlock kind="loading" title={t("Reading Gateway routes")} detail="Exchange is returning published model routes." />
        ) : error ? (
          <StateBlock kind="error" title={t("Routes unavailable")} detail={error} />
        ) : routes && routes.length > 0 ? (
          <ResourceTable
            rows={routes}
            rowKey={resourceId}
            caption="Exchange published routes"
            columns={[
              {
                label: "Model alias",
                render: (row) => {
                  const pattern = text(row["modelPattern"] || row["model_pattern"]);
                  const isSelected = selectedRoute && text(selectedRoute["id"]) === text(row["id"]);
                  return (
                    <button
                      className={isSelected ? "link-button link-button--selected" : "link-button"}
                      onClick={() => setSelectedRoute(row)}
                    >
                      {pattern} {isSelected ? "◀ (Selected)" : ""}
                    </button>
                  );
                },
              },
              {
                label: "Target binding",
                render: (row) => <span className="input-mono">{text(row["targetBindingId"] || row["target_binding_id"])}</span>,
              },
              {
                label: "Status",
                render: (row) => {
                  const state = text(row["state"], "ACTIVE");
                  return <StatusPill value={state} />;
                },
              },
              {
                label: "Action",
                render: (row) => {
                  const state = text(row["state"], "ACTIVE");
                  if (state === "DRAFT") {
                    return (
                      <Button tone="primary" onClick={() => void confirmRoute(row)}>{t("确认发布")}</Button>
                    );
                  }
                  return (
                    <div className="dh-toolbar">
                      <Button onClick={() => setSelectedRoute(row)}>{t("View detail")}</Button>
                      <Button tone="primary" onClick={() => void handleUseInNavigator(row)}>{t("在 Navigator 中使用")}</Button>
                    </div>
                  );
                },
              },
            ]}
          />
        ) : (
          <StateBlock
            kind="empty"
            title={t("No Gateway routes")}
            detail="Publish a serving deployment or add a route draft in Exchange to expose models."
          />
        )}
      </Panel>

      {/* 2. Selected Route Detail Panel */}
      {selectedRoute ? (
        <Panel
          title={`Route detail: ${modelId}`}
          meta={<StatusPill value={text(selectedRoute["state"], "ACTIVE")} />}
        >
          <dl className="detail-grid">
            <Detail label="Model ID" value={modelId} mono />
            <Detail
              label="Base URL"
              value={baseUrl}
              mono
            />
            <Detail label="Target binding" value={text(selectedRoute["targetBindingId"] || selectedRoute["target_binding_id"])} mono />
            <Detail label="Created" value={formatDate(selectedRoute["createdAt"] || selectedRoute["created_at"])} />
          </dl>

          <div className="dh-toolbar dh-toolbar--spaced">
            <Button
              onClick={() => {
                void navigator.clipboard.writeText(baseUrl);
                setCopiedBaseUrl(true);
                setTimeout(() => setCopiedBaseUrl(false), 2000);
              }}
            >
              {copiedBaseUrl ? "Base URL Copied!" : "Copy Base URL"}
            </Button>
            <Button
              tone="primary"
              onClick={() => void handleUseInNavigator(selectedRoute)}
            >{t("在 Navigator 中使用")}</Button>
          </div>

          <div className="dh-integration">
            <div className="dh-toolbar dh-integration__bar">
              <strong className="dh-section-label">{t("Integration code:")}</strong>
              <div className="dh-segmented">
                {(["curl", "python", "javascript"] as const).map((tab) => (
                  <Button
                    key={tab}
                    tone={activeCodeTab === tab ? "primary" : "quiet"}
                    aria-pressed={activeCodeTab === tab}
                    onClick={() => setActiveCodeTab(tab)}
                  >
                    {tab === "curl" ? "cURL" : tab === "python" ? "Python" : "JavaScript"}
                  </Button>
                ))}
              </div>
              <Button
                onClick={() => {
                  void navigator.clipboard.writeText(snippets[activeCodeTab]);
                  setCopiedSnippet(true);
                  setTimeout(() => setCopiedSnippet(false), 2000);
                }}
              >
                {copiedSnippet ? "Copied!" : "Copy snippet"}
              </Button>
            </div>
            <pre className="dh-code-block">
              <code>{snippets[activeCodeTab]}</code>
            </pre>
          </div>
        </Panel>
      ) : null}

      {/* 3. API Keys Management Panel */}
      <Panel
        title={t("Gateway API keys")}
        meta={apiKeys ? `${apiKeys.filter((k) => k.state === "ACTIVE").length} active` : "EXCHANGE KEYS"}
      >
        {createdSecret ? (
          <div className="callout callout--orange callout--stacked">
            <div className="callout__title">
              <span className="callout__mark" aria-hidden="true">!</span>
              <strong>{t("API Key Created:")}{createdKeyName}</strong>
            </div>
            <p>{t("此密钥不会再次显示，请立即复制并安全保存。关闭后将无法重新查看完整明文。")}</p>
            <div className="dh-toolbar callout__secret">
              <input
                readOnly
                value={createdSecret}
                className="input-mono"
              />
              <Button
                tone="primary"
                onClick={() => {
                  void navigator.clipboard.writeText(createdSecret);
                  setCopiedKey(true);
                  setTimeout(() => setCopiedKey(false), 2000);
                }}
              >
                {copiedKey ? "Copied!" : "Copy key"}
              </Button>
              <Button onClick={() => setCreatedSecret(null)}>{t("Close")}</Button>
            </div>
          </div>
        ) : null}

        <form className="credential-form" onSubmit={handleCreateKey} style={{ marginBottom: "24px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px", alignItems: "flex-end" }}>
            <Field label="Key name *" hint="Human-readable identifier">
              <input
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                placeholder={t("e.g. production-client")}
                required
              />
            </Field>
            <Field label="Expiration (days)" hint="Optional (leave blank for no expiry)">
              <input
                type="number"
                min="1"
                value={expiresDays}
                onChange={(e) => setExpiresDays(e.target.value)}
                placeholder={t("e.g. 90")}
              />
            </Field>
            <Field label="Model scope" hint="Optional comma-separated aliases">
              <input
                value={modelScope}
                onChange={(e) => setModelScope(e.target.value)}
                placeholder={t("default: all models")}
              />
            </Field>
            <div>
              <Button tone="primary" type="submit" disabled={creatingKey || !keyName.trim()}>
                {creatingKey ? "Creating..." : "Create API Key"}
              </Button>
            </div>
          </div>
        </form>

        {apiKeys && apiKeys.length > 0 ? (
          <ResourceTable
            rows={apiKeys}
            rowKey={(row) => row.id}
            caption="Exchange API keys"
            columns={[
              { label: "Name", render: (row) => <strong>{row.name}</strong> },
              {
                label: "Key",
                render: (row) => <span className="input-mono">{`cyk_...${row.id.slice(-4)}`}</span>,
              },
              {
                label: "Status",
                render: (row) => <StatusPill value={row.state} />,
              },
              {
                label: "Model scope",
                render: (row) => row.modelScope && row.modelScope.length > 0 ? row.modelScope.join(", ") : "All models",
              },
              {
                label: "Created",
                render: (row) => formatDate(row.createdAt),
              },
              {
                label: "Expires",
                render: (row) => row.expiresAt ? formatDate(row.expiresAt) : "Never",
              },
              {
                label: "Action",
                render: (row) => {
                  if (row.state === "ACTIVE") {
                    return (
                      <Button tone="danger" onClick={() => void handleRevokeKey(row.id, row.name)}>{t("Revoke")}</Button>
                    );
                  }
                  return <span className="muted">{t("Revoked")}</span>;
                },
              },
            ]}
          />
        ) : (
          <StateBlock
            kind="empty"
            title={t("No API keys")}
            detail="Create an API key above to allow client applications to authenticate with the Exchange gateway."
          />
        )}
      </Panel>
    </div>
  );
}
