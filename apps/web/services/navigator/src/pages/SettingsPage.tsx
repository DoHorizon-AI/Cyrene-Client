import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Button, Field, formatDate, PageHeader, Panel, ResourceTable, StateBlock, StatusPill } from "../components";
import { type CredentialMetadata, type SystemStatus } from "../api";
import { useI18n } from "../i18n";
import { type SettingsPageProps, Detail, errorMessage } from "./shared";

/**
 * Web Host session metadata and write-only credential administration.
 * 展示 Web Host 会话元数据并管理只写凭据。
 */
export function SettingsPage({ api, session }: SettingsPageProps) {
  const { t } = useI18n();
  const [reloadKey, setReloadKey] = useState(0);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [credentials, setCredentials] = useState<CredentialMetadata[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [systemError, setSystemError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("");
  const [kind, setKind] = useState("api-token");
  const [secret, setSecret] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.allSettled([api.getSystemStatus(), api.getCredentials()]).then(([systemResult, credentialsResult]) => {
      if (!active) {
        return;
      }
      if (systemResult.status === "fulfilled") {
        setSystem(systemResult.value);
        setSystemError(null);
      } else {
        setSystem(null);
        setSystemError(errorMessage(systemResult.reason));
      }
      if (credentialsResult.status === "fulfilled") {
        setCredentials(credentialsResult.value);
        setError(null);
      } else {
        setCredentials(null);
        setError(errorMessage(credentialsResult.reason));
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [api, reloadKey]);

  const createCredential = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || !provider.trim() || !secret) {
      setFormError("Name, provider, and secret are required.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    setNotice(null);
    try {
      await api.createCredential({ name: name.trim(), provider: provider.trim(), kind: kind.trim() || "generic", secret });
      setName("");
      setProvider("");
      setSecret("");
      setNotice("Credential metadata saved. The secret was accepted write-only and cannot be recovered here.");
      setReloadKey((value) => value + 1);
    } catch (createError) {
      setFormError(errorMessage(createError));
    } finally {
      setSubmitting(false);
    }
  };

  const revokeCredential = async (credential: CredentialMetadata) => {
    if (!window.confirm(`Revoke ${credential.name}? This cannot be undone.`)) {
      return;
    }
    setRevokingId(credential.id);
    setFormError(null);
    setNotice(null);
    try {
      await api.revokeCredential(credential.id);
      setNotice(`${credential.name} was revoked.`);
      setReloadKey((value) => value + 1);
    } catch (revokeError) {
      setFormError(errorMessage(revokeError));
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Web Host / 06"
        title={t("Keep the boundary boring.")}
        description="Session rotation, CSRF, proxy allowlists, and credential metadata are Web Host concerns. Secrets never become a Product read."
        action={<Button onClick={() => setReloadKey((value) => value + 1)} disabled={loading}>{t("Refresh settings")}</Button>}
      />

      <div className="settings-grid">
        <Panel title={t("Current session")} meta={<StatusPill value={session.state} />}>
          <dl className="detail-grid">
            <Detail label="Access state" value={session.authenticated ? "Authenticated" : "Anonymous"} />
            <Detail label="Access expires" value={formatDate(session.expiresAt)} />
            <Detail label="Refresh window" value={formatDate(session.refreshExpiresAt)} />
            <Detail label="Refreshable" value={session.refreshable ? "Yes" : "No"} />
          </dl>
          <p className="panel-footnote">{t("Access and refresh cookies remain HttpOnly. The UI keeps only the rotating CSRF token in memory.")}</p>
        </Panel>

        <Panel title={t("Navigator Web Host")} meta={<StatusPill value={system?.status ?? "UNKNOWN"} />}>
          {systemError ? <p className="inline-error">{systemError}</p> : null}
          <dl className="detail-grid">
            <Detail label="Service" value={system?.service ?? "Not reported"} mono />
            <Detail label="Version" value={system?.version ?? "Not reported"} mono />
            <Detail label="Active credentials" value={system ? String(system.credentials.active) : "--"} />
            <Detail label="Revoked credentials" value={system ? String(system.credentials.revoked) : "--"} />
          </dl>
          <div className="proxy-list">
            <p className="eyebrow">{t("Configured proxy paths")}</p>
            {system?.proxyPrefixes.length ? system.proxyPrefixes.map((prefix) => <code key={prefix}>{prefix}</code>) : <span className="muted">{t("No proxy prefixes reported.")}</span>}
          </div>
        </Panel>
      </div>

      <Panel title={t("Add credential metadata")} meta={<span className="mono-label">{t("SECRET NEVER READ BACK")}</span>}>
        <form className="form-grid" onSubmit={createCredential}>
          <Field label="Name">
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("Hugging Face access")} />
          </Field>
          <Field label="Provider">
            <input value={provider} onChange={(event) => setProvider(event.target.value)} placeholder={t("huggingface")} />
          </Field>
          <Field label="Kind">
            <input value={kind} onChange={(event) => setKind(event.target.value)} placeholder={t("api-token")} />
          </Field>
          <Field label="Secret" hint="The Web Host stores this for configured proxy resolution only.">
            <input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} autoComplete="new-password" placeholder={t("Paste once, never displayed")} />
          </Field>
          <div className="form-actions">
            <Button tone="primary" type="submit" disabled={submitting}>{submitting ? "Saving..." : "Save credential"}</Button>
            {formError ? <span className="form-message form-message--error" role="alert">{formError}</span> : null}
            {notice ? <span className="form-message form-message--success">{notice}</span> : null}
          </div>
        </form>
      </Panel>

      <Panel title={t("Credential metadata")} meta={credentials ? `${credentials.length} records` : "LIVE READ"}>
        {loading ? (
          <StateBlock kind="loading" title={t("Reading credential metadata")} detail="Only non-secret fields are returned by the Web Host." />
        ) : error ? (
          <StateBlock kind="error" title={t("Credentials unavailable")} detail={error} action={<Button onClick={() => setReloadKey((value) => value + 1)}>{t("Try again")}</Button>} />
        ) : credentials && credentials.length > 0 ? (
          <ResourceTable
            rows={credentials}
            rowKey={(row) => row.id}
            caption="Navigator Web Host credentials"
            columns={[
              { label: "Name", render: (row) => <strong>{row.name}</strong> },
              { label: "Provider", render: (row) => row.provider },
              { label: "Kind", render: (row) => <span className="input-mono">{row.kind}</span> },
              { label: "State", render: (row) => <StatusPill value={row.state} /> },
              { label: "Updated", render: (row) => formatDate(row.updatedAt) },
              { label: "Action", render: (row) => <Button tone="danger" disabled={row.state === "REVOKED" || revokingId !== null} onClick={() => void revokeCredential(row)}>{revokingId === row.id ? "Revoking..." : row.state === "REVOKED" ? "Revoked" : "Revoke"}</Button> },
            ]}
          />
        ) : (
          <StateBlock kind="empty" title={t("No credentials configured")} detail="Add a write-only credential metadata record when a configured Product proxy needs it." />
        )}
      </Panel>
    </div>
  );
}
