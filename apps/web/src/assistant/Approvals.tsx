import type { WorkApproval, WorkInput } from "../../services/navigator/src/api";
import { useAssistantMessages } from "./messages";

interface ApprovalsProps {
  approvals: WorkApproval[];
  inputs: WorkInput[];
  answers: Record<string, string>;
  workflow: { name: string; pipelineId: string } | null;
  samePipeline: boolean;
  allowTaskScope: boolean;
  disabled: boolean;
  onDecide(
    approval: WorkApproval,
    decision: "approved" | "rejected",
    scope?: "once" | "task",
  ): void;
  onAnswer(input: WorkInput): void;
  onAnswerChange(id: string, value: string): void;
}

export function Approvals(props: ApprovalsProps) {
  const m = useAssistantMessages();
  return (
    <>
      {props.approvals.map((approval) => (
        <article key={approval.id} className="assistant-message approval">
          <strong>
            {m("approvalRequired")}: {approval.summary}
          </strong>
          {props.workflow && (
            <p>
              {m("originatingPipeline")}: {props.workflow.name}{" "}
              <code>{props.workflow.pipelineId}</code>
            </p>
          )}
          {!props.samePipeline && (
            <p role="status">
              {m("theCanvasChangedThisApprovalStillBelongsToThe")}
            </p>
          )}
          <details>
            <summary>{m("operationDetails")}</summary>
            <pre>{JSON.stringify(approval.details, null, 2)}</pre>
          </details>
          <div className="assistant-actions">
            <button
              disabled={props.disabled}
              onClick={() => props.onDecide(approval, "approved")}
            >
              {m("allowOnce")}
            </button>
            {props.allowTaskScope && (
              <button
                disabled={props.disabled}
                onClick={() => props.onDecide(approval, "approved", "task")}
              >
                {m("allowThisOperationTypeForThisTask")}
              </button>
            )}
            <button
              disabled={props.disabled}
              onClick={() => props.onDecide(approval, "rejected")}
            >
              {m("decline")}
            </button>
          </div>
        </article>
      ))}
      {props.inputs.map((input) => (
        <article key={input.id} className="assistant-message approval">
          <strong>{input.summary}</strong>
          <textarea
            aria-label={m("requestedInput")}
            value={props.answers[input.id] ?? ""}
            onChange={(event) =>
              props.onAnswerChange(input.id, event.target.value)
            }
          />
          <button
            disabled={props.disabled || !props.answers[input.id]?.trim()}
            onClick={() => props.onAnswer(input)}
          >
            {m("answer")}
          </button>
        </article>
      ))}
    </>
  );
}
