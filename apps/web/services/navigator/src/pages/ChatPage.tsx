import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Button, Field, PageHeader, Panel, StateBlock, StatusPill } from "../components";
import { type ActiveRoutePayload } from "../api";
import { studioProductFetch } from "../../../../src/products/transport";
import { pushRoute } from "../router";
import { useI18n } from "../i18n";
import { type PageProps, Detail, errorMessage } from "./shared";

/**
 * Interactive test chat surface bound to the session's active Gateway route.
 * 提供绑定到当前会话活动 Gateway 路由的交互式测试聊天界面。
 */
export function ChatPage({ api }: PageProps) {
  const { t } = useI18n();
  const [activeRoute, setActiveRoute] = useState<ActiveRoutePayload | null>(null);
  const [loadingRoute, setLoadingRoute] = useState(true);
  const [routeError, setRouteError] = useState<string | null>(null);

  // API Key stored in sessionStorage ONLY (never localStorage or server)
  // 中文：API key 仅存储在 sessionStorage 中，绝不写入 localStorage 或服务器。
  const [apiKey, setApiKey] = useState(() => {
    if (typeof window !== "undefined" && window.sessionStorage) {
      return window.sessionStorage.getItem("cyrene_chat_api_key") ?? "";
    }
    return "";
  });

  const handleApiKeyChange = (val: string) => {
    setApiKey(val);
    if (typeof window !== "undefined" && window.sessionStorage) {
      window.sessionStorage.setItem("cyrene_chat_api_key", val);
    }
  };

  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant" | "system"; content: string }>>([
    { role: "system", content: "You are a helpful AI assistant." },
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadingRoute(true);
    void api.getActiveRoute().then(
      (res) => {
        if (!active) return;
        setActiveRoute(res);
        setRouteError(null);
        setLoadingRoute(false);
      },
      (err) => {
        if (!active) return;
        setActiveRoute(null);
        setRouteError(errorMessage(err));
        setLoadingRoute(false);
      },
    );
    return () => {
      active = false;
    };
  }, [api]);

  const sendMessage = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const prompt = inputMessage.trim();
    if (!prompt || sending || !activeRoute) return;
    if (!apiKey.trim()) {
      setChatError("Please enter your Exchange API key to send messages.");
      return;
    }

    const updatedMessages = [...messages, { role: "user" as const, content: prompt }];
    setMessages(updatedMessages);
    setInputMessage("");
    setSending(true);
    setChatError(null);

    const assistantIndex = updatedMessages.length;
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const response = await studioProductFetch("/api/proxy/exchange-gateway/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey.trim()}`,
          Accept: "text/event-stream, application/json",
        },
        body: JSON.stringify({
          model: activeRoute.modelId,
          messages: updatedMessages,
          stream: true,
        }),
      });

      if (!response.ok) {
        let errDetail = `HTTP ${response.status}`;
        try {
          const errJson = (await response.json()) as Record<string, unknown>;
          if (errJson && typeof errJson["detail"] === "string") {
            errDetail = errJson["detail"];
          }
        } catch {
          // ignore parse error
          // 中文：忽略解析错误。
        }
        throw new Error(errDetail);
      }

      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let accumulated = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(":")) continue;
            if (trimmed.startsWith("data:")) {
              const dataStr = trimmed.slice(5).trim();
              if (dataStr === "[DONE]") {
                break;
              }
              try {
                const parsed = JSON.parse(dataStr) as {
                  choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
                };
                const delta =
                  parsed.choices?.[0]?.delta?.content ??
                  parsed.choices?.[0]?.message?.content ??
                  "";
                accumulated += delta;
                setMessages((prev) => {
                  const copy = [...prev];
                  copy[assistantIndex] = { role: "assistant", content: accumulated };
                  return copy;
                });
              } catch {
                // Ignore parse errors on stream chunks
                // 中文：忽略 SSE 数据块的解析错误。
              }
            }
          }
        }
      } else {
        const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const content = data.choices?.[0]?.message?.content ?? "";
        setMessages((prev) => {
          const copy = [...prev];
          copy[assistantIndex] = { role: "assistant", content };
          return copy;
        });
      }
    } catch (err) {
      setChatError(errorMessage(err));
      setMessages((prev) => {
        const copy = [...prev];
        if (copy[assistantIndex] && !copy[assistantIndex]?.content) {
          copy.splice(assistantIndex, 1);
        }
        return copy;
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Exchange / Interactive Chat"
        title={t("Test models with active route.")}
        description="Interact directly with the model bound to this session through Exchange Gateway proxy."
      />

      {loadingRoute ? (
        <StateBlock kind="loading" title={t("Loading active route")} detail="Checking session active route configuration." />
      ) : routeError || !activeRoute ? (
        <Panel title={t("No active route selected")}>
          <StateBlock
            kind="empty"
            title={t("Active route required")}
            detail={routeError ?? "No gateway route has been activated for this session yet. Go to Gateway to select and activate a route."}
            action={
              <Button tone="primary" onClick={() => pushRoute("gateway")}>{t("Go to Gateway")}</Button>
            }
          />
        </Panel>
      ) : (
        <>
          <Panel
            title={`Active route: ${activeRoute.modelId}`}
            meta={<StatusPill value="CONNECTED" />}
          >
            <dl className="detail-grid">
              <Detail label="Model ID" value={activeRoute.modelId} mono />
              <Detail label="Base URL" value={activeRoute.baseUrl} mono />
              <Detail label="Endpoint ID" value={activeRoute.gatewayEndpointId} mono />
              {activeRoute.apiKeyHint ? <Detail label="Key hint" value={activeRoute.apiKeyHint} /> : null}
            </dl>

            <div style={{ marginTop: "16px" }}>
              <Field
                label="Exchange API Key"
                hint="Key is held strictly in browser sessionStorage and sent via Authorization: Bearer."
              >
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => handleApiKeyChange(e.target.value)}
                  placeholder={t("cyk_live_...")}
                  className="input-mono"
                />
              </Field>
            </div>
          </Panel>

          <Panel
            title={t("Chat conversation")}
            meta={
              <Button
                onClick={() =>
                  setMessages([{ role: "system", content: "You are a helpful AI assistant." }])
                }
              >{t("Clear history")}</Button>
            }
          >
            {chatError ? (
              <div className="callout callout--red" style={{ marginBottom: "12px" }}>
                <span className="callout__mark" aria-hidden="true">!</span>
                <p><strong>{t("Error:")}</strong> {chatError}</p>
              </div>
            ) : null}

            <div className="dh-chat">
              {messages.filter((m) => m.role !== "system").length === 0 ? (
                <div className="dh-chat__empty">{t("Start conversation with")}<code>{activeRoute.modelId}</code>
                </div>
              ) : (
                messages
                  .filter((m) => m.role !== "system")
                  .map((msg, idx) => (
                    <div key={idx} className={msg.role === "user" ? "dh-chat__message dh-chat__message--user" : "dh-chat__message"}>
                      <span className="dh-chat__role">
                        {msg.role === "user" ? "YOU" : <span className="dh-mono">{activeRoute.modelId}</span>}
                      </span>
                      <div className="dh-chat__bubble">
                        {msg.content || (sending && idx === messages.length - 1 ? "..." : "")}
                      </div>
                    </div>
                  ))
              )}
            </div>

            <form className="dh-chat__composer" onSubmit={sendMessage}>
              <input
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder={t("Type a message...")}
                disabled={sending || !apiKey.trim()}
              />
              <Button tone="primary" type="submit" disabled={sending || !inputMessage.trim() || !apiKey.trim()}>
                {sending ? "Sending..." : "Send"}
              </Button>
            </form>
          </Panel>
        </>
      )}
    </div>
  );
}
