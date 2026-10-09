import { useAssistantMessages } from "./messages";

interface ChatHeaderProps {
  selectionDisabled: boolean;
  busy: boolean;
  canConfigure: boolean;
  expanded: boolean;
  onNew(): void;
  onHistory(): void;
  onRefresh(): void;
  onSettings(): void;
  onTools(): void;
  onDock(): void;
}

export function ChatHeader(props: ChatHeaderProps) {
  const m = useAssistantMessages();
  return (
    <header className="assistant-heading">
      <strong>AI Assistant</strong>
      <button
        aria-label={m("newChat")}
        title={m("newChat")}
        disabled={props.selectionDisabled}
        onClick={props.onNew}
      >
        ＋
      </button>
      <button aria-label={m("chatHistory")} onClick={props.onHistory}>
        ◷
      </button>
      <button
        aria-label={m("refreshAgents")}
        disabled={props.busy}
        onClick={props.onRefresh}
      >
        ↻
      </button>
      {props.canConfigure && (
        <button aria-label={m("assistantSettings")} onClick={props.onSettings}>
          ⚙
        </button>
      )}
      <button aria-label={m("mcpTools")} onClick={props.onTools}>
        MCP
      </button>
      <button
        aria-label={props.expanded ? m("dockRight") : m("openInEditor")}
        onClick={props.onDock}
      >
        {props.expanded ? "⇥" : "↗"}
      </button>
    </header>
  );
}
