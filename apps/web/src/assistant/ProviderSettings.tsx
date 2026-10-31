// ┌─────────────────────────────────────────────────────────────────────┐
// │ Module: assistant/ProviderSettings                                  │
// │ Role: Explain that runtime provider configuration remains host-owned.│
// │ 中文：模块职责：说明运行时提供方配置仍由宿主负责。                   │
// └─────────────────────────────────────────────────────────────────────┘

import { useAssistantMessages } from "./messages";

export function ProviderSettings() {
  const m = useAssistantMessages();
  return (
    <section className="assistant-aux assistant-provider" role="status">
      <h3>{m("apiConfiguration")}</h3>
      <p>{m("providerSettingsAreHostManagedAndUnavailableInClient")}</p>
    </section>
  );
}
