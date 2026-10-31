// ┌─────────────────────────────────────────────────────────────────────┐
// │ Module: assistant/ModelBar                                          │
// │ Role: Show the runtime ownership boundary for the thin Client UI.   │
// │ 中文：模块职责：说明轻量 Client 界面中的运行时权威边界。             │
// └─────────────────────────────────────────────────────────────────────┘

import { useAssistantMessages } from "./messages";

export function ModelBar() {
  const m = useAssistantMessages();
  return (
    <p className="assistant-model-bar" role="note">
      {m("navigatorOwnsTheRuntimeSelection")}
    </p>
  );
}
