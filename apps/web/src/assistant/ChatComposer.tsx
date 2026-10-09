import type { WorkAttachment } from "../../services/navigator/src/api";
import { useAssistantMessages } from "./messages";

interface ChatComposerProps {
  draft: string;
  attachments: WorkAttachment[];
  documentName: string;
  pending: boolean;
  busy: boolean;
  uploading: boolean;
  canOperate: boolean;
  active: boolean;
  sendDisabled: boolean;
  onDraft(value: string): void;
  onRemove(id: string): void;
  onRetry(): void;
  onAttach(): void;
  onSend(): void;
  onStop(): void;
}

export function ChatComposer(props: ChatComposerProps) {
  const m = useAssistantMessages();
  return (
    <>
      {props.pending && (
        <div className="assistant-error" role="status">
          {m("submissionIsUnconfirmedCheckTaskHistoryOrRetryThe")}
          <button disabled={props.busy} onClick={props.onRetry}>
            {m("retryRequest")}
          </button>
        </div>
      )}
      <div className="assistant-chips">
        {props.attachments.map((item) => (
          <button
            key={item.id}
            disabled={props.busy || props.pending}
            onClick={() => props.onRemove(item.id)}
          >
            {item.name} ×
          </button>
        ))}
      </div>
      <div className="assistant-composer">
        <textarea
          aria-label={m("message")}
          placeholder={m("askPlanOrWorkInYourWorkspace")}
          value={props.draft}
          disabled={!props.canOperate || props.pending}
          onChange={(event) => props.onDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              props.onSend();
            }
          }}
        />
        <div className="assistant-compose-tools">
          <button
            disabled={
              props.uploading ||
              props.busy ||
              props.pending ||
              !props.canOperate
            }
            onClick={props.onAttach}
          >
            {m("attachFiles")}
          </button>
          <small>{props.documentName}</small>
          <span />
          {props.active ? (
            <button
              disabled={props.busy || !props.canOperate}
              onClick={props.onStop}
            >
              {m("stop")}
            </button>
          ) : (
            <button
              className="assistant-send"
              aria-label={m("send")}
              disabled={props.sendDisabled}
              onClick={props.onSend}
            >
              ↑
            </button>
          )}
        </div>
      </div>
    </>
  );
}
