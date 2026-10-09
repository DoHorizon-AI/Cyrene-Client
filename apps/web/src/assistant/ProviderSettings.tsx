import { useState } from "react";
import type {
  NavigatorApi,
  AssistantProvider,
  AssistantProtocol,
} from "../../services/navigator/src/api";
import type { ExecutorSchemas } from "../../services/navigator/src/generated/contracts";
import { useAssistantMessages } from "./messages";

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function ProviderSettings({
  providers,
  api,
  onChanged,
}: {
  providers: AssistantProvider[];
  api: NavigatorApi;
  onChanged(): Promise<void>;
}) {
  const m = useAssistantMessages();
  const [id, setId] = useState(""),
    [name, setName] = useState(""),
    [baseUrl, setBaseUrl] = useState(""),
    [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState(""),
    [efforts, setEfforts] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [protocol, setProtocol] =
      useState<AssistantProtocol>("openai-completions"),
    [images, setImages] = useState(false);
  const select = (value: string) => {
    const provider = providers.find((item) => item.id === value);
    setId(value);
    setName(provider?.name ?? "");
    setBaseUrl(provider?.baseUrl ?? "");
    setApiKey("");
    setModels(provider?.models.map((item) => item.id).join("\n") ?? "");
    setEfforts(provider?.models[0]?.efforts.join(",") ?? "");
    setProtocol(provider?.protocol ?? "openai-completions");
    setImages(provider?.models[0]?.images === true);
  };
  return (
    <form
      className="assistant-aux assistant-provider"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        const previous = providers.find((provider) => provider.id === id);
        const supportedEfforts = new Set([
          "minimal",
          "low",
          "medium",
          "high",
          "xhigh",
          "max",
        ]);
        const levelValues = efforts
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        if (levelValues.some((value) => !supportedEfforts.has(value))) {
          setError(m("reasoningEffortMustBeMinimalLowMediumHighXhigh"));
          setBusy(false);
          return;
        }
        const defaultsChanged =
          efforts !== (previous?.models[0]?.efforts.join(",") ?? "") ||
          images !== (previous?.models[0]?.images === true);
        const input: ExecutorSchemas["ApiProviderInput"] = {
          name: name.trim(),
          protocol,
          baseUrl: baseUrl.trim(),
          ...(apiKey ? { apiKey } : {}),
          models: models
            .split(/[\n,]/)
            .map((value) => value.trim())
            .filter(Boolean)
            .map((value) => {
              const existing = previous?.models.find(
                (model) => model.id === value,
              );
              const model =
                existing && !defaultsChanged
                  ? existing
                  : { id: value, efforts: levelValues, images };
              return {
                ...model,
                efforts: model.efforts.filter(
                  (
                    value,
                  ): value is NonNullable<
                    ExecutorSchemas["ModelInput"]["efforts"]
                  >[number] => supportedEfforts.has(value),
                ),
              };
            }),
        };
        // Clear the credential field immediately. It is never persisted in browser storage.
        setApiKey("");
        void api
          .saveAssistantProvider(id.trim(), input)
          .then(onChanged, (reason) => setError(message(reason)))
          .finally(() => setBusy(false));
      }}
    >
      <h3>{m("apiConfiguration")}</h3>
      <p>{m("credentialsAreSavedByTheNavigatorHostEnterModels")}</p>
      <label>
        {m("existingProvider")}
        <select
          aria-label={m("existingProvider")}
          value={providers.some((provider) => provider.id === id) ? id : ""}
          onChange={(event) => select(event.target.value)}
        >
          <option value="">{m("newProvider")}</option>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        ID
        <input
          required
          pattern="[a-z][a-z0-9-]{0,63}"
          maxLength={64}
          value={id}
          onChange={(event) => setId(event.target.value)}
        />
      </label>
      <label>
        {m("name")}
        <input
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        {m("apiProtocol")}
        <select
          aria-label={m("apiProtocol")}
          value={protocol}
          onChange={(event) =>
            setProtocol(event.target.value as AssistantProtocol)
          }
        >
          <option value="openai-completions">OpenAI Chat Completions</option>
          <option value="openai-responses">OpenAI Responses</option>
          <option value="anthropic-messages">Anthropic Messages</option>
        </select>
      </label>
      <label>
        Base URL
        <input
          required
          type="url"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
      </label>
      <label>
        API Key
        <input
          type="password"
          autoComplete="off"
          value={apiKey}
          placeholder={m("leaveEmptyToKeepCurrentCredentials")}
          onChange={(event) => setApiKey(event.target.value)}
        />
      </label>
      <label>
        {m("modelIDsOnePerLine")}
        <textarea
          required
          value={models}
          onChange={(event) => setModels(event.target.value)}
        />
      </label>
      <label>
        {m("reasoningLevelsCommaSeparatedOptional")}
        <input
          value={efforts}
          onChange={(event) => setEfforts(event.target.value)}
        />
      </label>
      <label className="assistant-checkbox">
        <input
          type="checkbox"
          checked={images}
          onChange={(event) => setImages(event.target.checked)}
        />
        {m("theseModelsSupportImageInputs")}
      </label>
      <div className="assistant-actions">
        <button disabled={busy || !id.trim() || !models.trim()}>
          {m("save")}
        </button>
        {providers.some((provider) => provider.id === id) && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void api
                .deleteAssistantProvider(id)
                .then(
                  async () => {
                    select("");
                    await onChanged();
                  },
                  (reason) => setError(message(reason)),
                )
                .finally(() => setBusy(false));
            }}
          >
            {m("deleteProvider")}
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
