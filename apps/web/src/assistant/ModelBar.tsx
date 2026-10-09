import type {
  AssistantCapabilities,
  AssistantModel,
  AssistantPermission,
  AssistantRuntime,
} from "../../services/navigator/src/api";
import { permissionMessages, useAssistantMessages } from "./messages";

interface ModelBarProps {
  capabilities: AssistantCapabilities | null;
  runtime?: AssistantRuntime;
  models: AssistantModel[];
  modelInfo?: AssistantModel;
  runtimeId: AssistantRuntime["id"];
  providerId: string;
  model: string;
  effort: string;
  permission: AssistantPermission;
  selectionLocked: boolean;
  turnLocked: boolean;
  onRuntime(id: AssistantRuntime["id"]): void;
  onProvider(id: string): void;
  onModel(id: string): void;
  onEffort(value: string): void;
  onPermission(value: AssistantPermission): void;
}

export function ModelBar(props: ModelBarProps) {
  const m = useAssistantMessages();
  return (
    <div className="assistant-model-bar">
      <select
        aria-label={m("agent")}
        value={props.runtimeId}
        disabled={props.selectionLocked}
        onChange={(event) =>
          props.onRuntime(event.target.value as AssistantRuntime["id"])
        }
      >
        {props.capabilities?.runtimes.map((runtime) => (
          <option
            key={runtime.id}
            value={runtime.id}
            disabled={!runtime.available}
          >
            {runtime.name}
            {!runtime.available ? m("unavailable") : ""}
          </option>
        ))}
      </select>
      {props.runtimeId === "harness" && (
        <select
          aria-label={m("apiProvider")}
          value={props.providerId}
          disabled={props.selectionLocked}
          onChange={(event) => props.onProvider(event.target.value)}
        >
          <option
            value=""
            disabled={
              !props.runtime?.models.length &&
              !!props.capabilities?.providers.length
            }
          >
            {m("hostDefaultModel")}
          </option>
          {props.capabilities?.providers.map((provider) => (
            <option
              key={provider.id}
              value={provider.id}
              disabled={!provider.configured}
            >
              {provider.name}
            </option>
          ))}
        </select>
      )}
      {props.models.length > 0 && (
        <select
          aria-label={m("model")}
          value={props.model}
          disabled={props.turnLocked}
          onChange={(event) => props.onModel(event.target.value)}
        >
          {props.models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </select>
      )}
      {!!props.modelInfo?.efforts.length && (
        <select
          aria-label={m("reasoningEffort")}
          value={props.effort}
          disabled={props.turnLocked}
          onChange={(event) => props.onEffort(event.target.value)}
        >
          <option value="">{m("defaultReasoning")}</option>
          {props.modelInfo.efforts.map((effort) => (
            <option key={effort} value={effort}>
              {effort}
            </option>
          ))}
        </select>
      )}
      {!!props.runtime?.permissions.length && (
        <select
          aria-label={m("permissionMode")}
          value={props.permission}
          disabled={props.turnLocked}
          onChange={(event) => {
            const next = event.target.value as AssistantPermission;
            if (
              (next === "auto" || next === "full-access") &&
              !window.confirm(
                m(
                  "thisModeExecutesPermittedOperationsAutomaticallyEnableItFor",
                ),
              )
            )
              return;
            props.onPermission(next);
          }}
        >
          {props.runtime.permissions.map((permission) => (
            <option key={permission} value={permission}>
              {m(permissionMessages[permission])}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
