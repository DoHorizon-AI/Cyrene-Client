import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Button, Field, formatDate, PageHeader, Panel, ResourceTable, StateBlock, StatusPill, text } from "../components";
import { type CredentialMetadata, type CreateModelImportInput, type JsonRecord } from "../api";
import { useI18n } from "../i18n";
import { type PageProps, resourceId, validationSummary, errorMessage } from "./shared";

/**
 * Reactor model imports, binding choices, validation evidence, and import form.
 * 提供 Reactor 模型导入、binding 选择、校验依据和导入表单。
 */
export function ModelsPage({ api }: PageProps) {
  const { t } = useI18n();
  const [reloadKey, setReloadKey] = useState(0);
  const [models, setModels] = useState<JsonRecord[] | null>(null);
  const [bindings, setBindings] = useState<JsonRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bindingError, setBindingError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sourceKind, setSourceKind] = useState<CreateModelImportInput["source"]["kind"]>("HUGGING_FACE");
  const [repository, setRepository] = useState("");
  const [revision, setRevision] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [servingBindingId, setServingBindingId] = useState("");
  const [credentialRef, setCredentialRef] = useState("");
  const [credentials, setCredentials] = useState<CredentialMetadata[] | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.allSettled([
      api.getModelImports(),
      api.getServingBindings(),
      api.getCredentials().catch(() => []),
    ]).then(([modelResult, bindingResult, credentialResult]) => {
      if (!active) {
        return;
      }
      if (modelResult.status === "fulfilled") {
        setModels(modelResult.value);
        setError(null);
      } else {
        setModels(null);
        setError(errorMessage(modelResult.reason));
      }
      if (bindingResult.status === "fulfilled") {
        setBindings(bindingResult.value);
        setBindingError(null);
      } else {
        setBindings([]);
        setBindingError(errorMessage(bindingResult.reason));
      }
      // Credentials are metadata only; the select exposes names, never secrets.
      // 中文：凭据只保留元数据；选择框只显示名称，绝不显示密钥。
      setCredentials(credentialResult.status === "fulfilled" ? credentialResult.value : null);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [api, reloadKey]);

  const submitImport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setNotice(null);
    const cleanName = name.trim();
    const cleanBinding = servingBindingId.trim();
    if (!cleanName || !cleanBinding) {
      setFormError("A model name and serving binding are required.");
      return;
    }
    const source =
      sourceKind === "HUGGING_FACE"
        ? { kind: "HUGGING_FACE" as const, repository: repository.trim(), revision: revision.trim() }
        : { kind: "LOCAL_PATH" as const, path: localPath.trim() };
    if (sourceKind === "HUGGING_FACE" && (!source.repository || !/^[a-f0-9]{40}$/i.test(source.revision))) {
      setFormError("Hugging Face imports require owner/name and a pinned 40-character revision.");
      return;
    }
    if (sourceKind === "LOCAL_PATH" && !localPath.trim().startsWith("/")) {
      setFormError("Local imports require an absolute path admitted by Reactor.");
      return;
    }
    const input: CreateModelImportInput = {
      name: cleanName,
      servingBindingId: cleanBinding,
      source,
      trustRemoteCode: false,
      ...(credentialRef.trim() ? { credentialRef: credentialRef.trim() } : {}),
    };
    setSubmitting(true);
    try {
      await api.createModelImport(input);
      setName("");
      setRepository("");
      setRevision("");
      setLocalPath("");
      setCredentialRef("");
      setNotice("Model import submitted. Reactor owns validation progress.");
      setReloadKey((value) => value + 1);
    } catch (submitError) {
      setFormError(errorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Reactor / 01"
        title={t("Models with receipts.")}
        description="Import a pinned source, then read Reactor's validation evidence before handing the artifact onward."
        action={<Button onClick={() => setReloadKey((value) => value + 1)} disabled={loading}>{t("Refresh models")}</Button>}
      />

      <Panel title={t("Import a model")} meta={<span className="mono-label">{t("TRUST REMOTE CODE: OFF")}</span>}>
        <form className="form-grid" onSubmit={submitImport}>
          <Field label="Display name">
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("Qwen 2.5 1.5B Instruct")} />
          </Field>
          <Field label="Serving binding" hint={bindingError ?? "The binding is selected from Reactor's live list."}>
            <input
              value={servingBindingId}
              onChange={(event) => setServingBindingId(event.target.value)}
              list="serving-bindings"
              placeholder={t("llama-factory-serving-v1")}
            />
            <datalist id="serving-bindings">
              {bindings.map((binding, index) => (
                <option key={resourceId(binding, index)} value={text(binding["bindingId"] ?? binding["id"])} />
              ))}
            </datalist>
          </Field>
          <Field label="Source kind">
            <select value={sourceKind} onChange={(event) => setSourceKind(event.target.value as CreateModelImportInput["source"]["kind"])}>
              <option value="HUGGING_FACE">{t("Hugging Face repository")}</option>
              <option value="LOCAL_PATH">{t("Local absolute path")}</option>
            </select>
          </Field>
          {sourceKind === "HUGGING_FACE" ? (
            <>
              <Field label="Repository" hint="owner/name">
                <input value={repository} onChange={(event) => setRepository(event.target.value)} placeholder={t("Qwen/Qwen2.5-1.5B-Instruct")} />
              </Field>
              <Field label="Pinned revision" hint="40 hexadecimal characters">
                <input className="input-mono" value={revision} onChange={(event) => setRevision(event.target.value)} placeholder={t("5fee7c4e...")} />
              </Field>
            </>
          ) : (
            <Field label="Absolute path" hint="Reactor validates access on the configured host.">
              <input className="input-mono" value={localPath} onChange={(event) => setLocalPath(event.target.value)} placeholder={t("/models/weights")} />
            </Field>
          )}
          <Field
            label="Credential"
            hint="Optional. Private repositories need one; names are shown, secrets never are."
          >
            <select
              className="input-mono"
              value={credentialRef}
              onChange={(event) => setCredentialRef(event.target.value)}
            >
              <option value="">{t("No credential (public repository)")}</option>
              {credentials?.map((credential) => (
                <option key={credential.id} value={credential.credentialRef}>
                  {credential.name} ({credential.provider})
                </option>
              ))}
            </select>
            {credentials === null ? (
              <span className="field__hint">{t("Credentials could not be loaded — add one on the Settings page first.")}</span>
            ) : null}
          </Field>
          <div className="form-actions">
            <Button tone="primary" type="submit" disabled={submitting}>{submitting ? "Submitting..." : "Start import"}</Button>
            {formError ? <span className="form-message form-message--error" role="alert">{formError}</span> : null}
            {notice ? <span className="form-message form-message--success">{notice}</span> : null}
          </div>
        </form>
      </Panel>

      <Panel title={t("Import ledger")} meta={models ? `${models.length} records` : "LIVE READ"}>
        {loading ? (
          <StateBlock kind="loading" title={t("Reading model imports")} detail="Reactor is the authority for import state and validation evidence." />
        ) : error ? (
          <StateBlock kind="error" title={t("Model imports unavailable")} detail={error} action={<Button onClick={() => setReloadKey((value) => value + 1)}>{t("Try again")}</Button>} />
        ) : models && models.length > 0 ? (
          <ResourceTable
            rows={models}
            rowKey={resourceId}
            caption="Reactor model imports"
            columns={[
              { label: "Model", render: (row) => <strong>{text(row["name"], "Unnamed import")}</strong> },
              { label: "State", render: (row) => <StatusPill value={text(row["state"], "UNKNOWN")} /> },
              { label: "Binding", render: (row) => <span className="input-mono">{text(row["servingBindingId"])}</span> },
              { label: "Evidence", render: (row) => validationSummary(row) },
              { label: "Updated", render: (row) => formatDate(row["updatedAt"]) },
            ]}
          />
        ) : (
          <StateBlock kind="empty" title={t("No imports yet")} detail="Submit a pinned model source above. Reactor will publish validation evidence here." />
        )}
      </Panel>
    </div>
  );
}
