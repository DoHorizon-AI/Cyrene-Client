import type {
  AssistantRuntime,
  NavigatorTaskEvent,
  NavigatorTaskRecord,
  WorkApproval,
  WorkAttachment,
  WorkInput,
} from "../../services/navigator/src/api";
import { assistantEventLabel } from "../../services/navigator/src/task-event-stream";
import { changedPipelineRecords, taskWorkflow } from "./model";
import { Approvals } from "./Approvals";
import Markdown from "./Markdown";
import { statusMessages, useAssistantMessages } from "./messages";

interface TaskMessagesProps {
  task: NavigatorTaskRecord;
  events: NavigatorTaskEvent[];
  approvals: WorkApproval[];
  inputs: WorkInput[];
  answers: Record<string, string>;
  runtime?: AssistantRuntime;
  pipelineId: string;
  workspaceId: string;
  disabled: boolean;
  onOpenWorkflow(id: string): void;
  onDecide(
    approval: WorkApproval,
    decision: "approved" | "rejected",
    scope?: "once" | "task",
  ): void;
  onAnswer(input: WorkInput): void;
  onAnswerChange(id: string, value: string): void;
}

export function TaskMessages(props: TaskMessagesProps) {
  const m = useAssistantMessages();
  const { task, events } = props;
  const workflow = taskWorkflow(task);
  const changed = changedPipelineRecords(events).filter(
    (record) => record.workspaceId === props.workspaceId,
  );
  return (
    <div data-task-id={task.id}>
      <article className="assistant-message user">
        <strong>{m("you")}</strong>
        <p>{task.prompt}</p>
        {workflow && (
          <details>
            <summary>
              {m("pipelineWhenSent")}: {workflow.name}
            </summary>
            <pre>{JSON.stringify(task.metadata.workflow, null, 2)}</pre>
          </details>
        )}
        {Array.isArray(task.metadata.attachments) && (
          <small>
            {(task.metadata.attachments as WorkAttachment[])
              .map((item) => item.name)
              .join(" · ")}
          </small>
        )}
      </article>
      {task.reasoning && (
        <article className="assistant-message">
          <details>
            <summary>{m("reasoning")}</summary>
            <Markdown text={task.reasoning} />
          </details>
        </article>
      )}
      {task.output && (
        <article className="assistant-message">
          <Markdown text={task.output} />
        </article>
      )}
      {events
        .filter(
          (event) =>
            ![
              "task.output",
              "task.reasoning",
              "text-delta",
              "reasoning-delta",
            ].includes(event.name),
        )
        .map((event) => (
          <article className="assistant-message tool" key={event.sequence}>
            <small>
              ⌘{" "}
              {event.name === "tool-call" || event.name === "tool-result"
                ? `${String(event.data.tool ?? "Tool")} · ${event.name}`
                : assistantEventLabel(event)}
            </small>
          </article>
        ))}
      {changed.map((record) => (
        <article
          className="assistant-message assistant-workflow-result"
          key={record.document.id}
        >
          <span>
            {m("savedPipeline")}: {record.document.name} · v
            {record.graphRevision}
          </span>
          <button onClick={() => props.onOpenWorkflow(record.document.id)}>
            {m("viewInCanvas")}
          </button>
        </article>
      ))}
      <Approvals
        approvals={props.approvals.filter((item) => item.taskId === task.id)}
        inputs={props.inputs.filter((item) => item.taskId === task.id)}
        answers={props.answers}
        workflow={workflow}
        samePipeline={!workflow || workflow.pipelineId === props.pipelineId}
        allowTaskScope={
          props.runtime?.approvalScopes?.includes("task") === true
        }
        disabled={props.disabled}
        onDecide={props.onDecide}
        onAnswer={props.onAnswer}
        onAnswerChange={props.onAnswerChange}
      />
      <article className="assistant-message assistant-muted">
        <span>{m(statusMessages[task.status])}</span> · <code>{task.id}</code>
        {task.error && <p role="alert">{task.error}</p>}
        {workflow && !changed.length && (
          <button onClick={() => props.onOpenWorkflow(workflow.pipelineId)}>
            {m("viewOriginatingPipeline")}
          </button>
        )}
      </article>
    </div>
  );
}
