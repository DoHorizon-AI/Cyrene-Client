import type { LegacyChat } from "./legacy-history";
import Markdown from "./Markdown";
import { useAssistantMessages } from "./messages";

export function LegacyHistory({
  chats,
  selectedId,
  onSelect,
}: {
  chats: LegacyChat[];
  selectedId: string;
  onSelect(id: string): void;
}) {
  const m = useAssistantMessages();
  return (
    <div className="assistant-aux">
      <p role="status">
        {m("legacyChatsAreReadOnlyExportedApprovalsAndExecutions")}
      </p>
      <select
        aria-label={m("legacyChat")}
        value={selectedId}
        onChange={(event) => onSelect(event.target.value)}
      >
        {chats.map((chat) => (
          <option key={chat.id} value={chat.id}>
            {chat.title || chat.id} · {chat.runtime}
          </option>
        ))}
      </select>
      {chats
        .find((chat) => chat.id === selectedId)
        ?.events.map((event) => (
          <article
            key={event.seq}
            className={`assistant-message ${event.type === "user" ? "user" : ""}`}
          >
            <small>{event.type}</small>
            <Markdown text={event.text} />
          </article>
        ))}
    </div>
  );
}
