import { useI18n } from "../i18n";
import type { chatSessions } from "./model";
import { statusMessages, useAssistantMessages } from "./messages";

interface HistoryProps {
  sessions: ReturnType<typeof chatSessions>;
  selectionDisabled: boolean;
  busy: boolean;
  hasEarlier: boolean;
  hasLegacy: boolean;
  onSelect(id: string): void;
  onLoadEarlier(): void;
  onReadLegacy(): void;
  onViewLegacy(): void;
}

export function History(props: HistoryProps) {
  const { locale } = useI18n();
  const m = useAssistantMessages();
  return (
    <div className="assistant-aux">
      <button onClick={props.onReadLegacy}>{m("readLegacyChatExport")}</button>
      {props.hasLegacy && (
        <button onClick={props.onViewLegacy}>
          {m("viewImportedLegacyChats")}
        </button>
      )}
      {props.sessions.map((session) => (
        <div className="assistant-history" key={session.id}>
          <button
            disabled={props.selectionDisabled}
            onClick={() => props.onSelect(session.id)}
          >
            <strong>
              {session.turns[0].title || session.turns[0].prompt.slice(0, 60)}
            </strong>
            <small>
              {session.turns.length} {m("turns")} ·{" "}
              {new Date(session.turns.at(-1)!.createdAt).toLocaleString(locale)}{" "}
              · {m(statusMessages[session.turns.at(-1)!.status])}
            </small>
          </button>
        </div>
      ))}
      {props.hasEarlier && (
        <button disabled={props.busy} onClick={props.onLoadEarlier}>
          {m("loadEarlierHistory")}
        </button>
      )}
    </div>
  );
}
