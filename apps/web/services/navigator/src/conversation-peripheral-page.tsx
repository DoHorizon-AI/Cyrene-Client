// ┌─────────────────────────────────────────────────────────────────────┐
// │ Module: Conversation media and Bilibili workspace                   │
// │ Role: Operate owner-backed media, speech, and provider workflows.   │
// │ 中文：模块职责：操作媒体、语音和第三方平台所属工作流。                │
// └─────────────────────────────────────────────────────────────────────┘

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Button, PageHeader, Panel, StateBlock, StatusPill } from "./components";
import { newConversationMemoryKey, type ActorBackupAttachment, type BilibiliAccount, type BilibiliLinkFlow, type BilibiliLinkStatus, type BilibiliOperationCatalog, type BilibiliReadOperationId, type BilibiliWriteOperationId, type ConversationMediaAsset, type ConversationMediaAssetRead, type NavigatorApi, type SpeechConfig, type SpeechStatus, type SpeechTranscription, type WorkAttachment, type WorkOperationReceipt } from "./api";
import { useI18n } from "./i18n";
import { errorMessage } from "./pages/shared";
import "./conversation-assistant.css";

type Props = { api: NavigatorApi; workspaceId: string; canWrite: boolean; canOperate: boolean };
type PeripheralTab = "media" | "bilibili";

/** Present safe peripheral controls backed by Navigator Work APIs. */
export function ConversationPeripheralPage({ api, workspaceId, canWrite, canOperate }: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<PeripheralTab>("media");
  const [hostWorkspaceId, setHostWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState("");
  const aligned = !!workspaceId && hostWorkspaceId === workspaceId;
  const mayWrite = canWrite && aligned;
  const mayOperate = canOperate && aligned;

  useEffect(() => {
    let active = true;
    setLoading(true); setWorkspaceError(""); setHostWorkspaceId(null);
    void api.getSystemStatus().then((status) => {
      if (!active) return;
      if (!status.workspaceId) throw new Error(t("Navigator did not report a workspace identity."));
      if (status.workspaceId !== workspaceId) throw new Error(t("Selected workspace does not match the Navigator host."));
      setHostWorkspaceId(status.workspaceId);
    }).catch((reason: unknown) => { if (active) setWorkspaceError(errorMessage(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, workspaceId, t]);

  return <div className="conversation-assistant">
    <nav className="conversation-assistant__tabs" role="tablist" aria-label={t("Peripheral conversation sections")}>
      <button type="button" role="tab" aria-selected={tab === "media"} aria-controls="conversation-peripheral-panel" onClick={() => setTab("media")}>{t("Media & speech")}</button>
      <button type="button" role="tab" aria-selected={tab === "bilibili"} aria-controls="conversation-peripheral-panel" onClick={() => setTab("bilibili")}>{t("Bilibili")}</button>
    </nav>
    <div id="conversation-peripheral-panel" role="tabpanel" aria-label={tab === "media" ? t("Media & speech") : t("Bilibili")}>
      {loading || workspaceError ? <StateBlock kind={loading ? "loading" : "error"} title={loading ? t("Verifying Navigator workspace") : t("Conversation assistant unavailable")} detail={loading ? t("Checking the paired host before reading workspace data.") : workspaceError} />
        : tab === "media" ? <MediaSpeechPanel api={api} workspaceId={workspaceId} mayWrite={mayWrite} />
          : <BilibiliPanel api={api} workspaceId={workspaceId} mayOperate={mayOperate} />}
    </div>
  </div>;
}

function MediaSpeechPanel({ api, workspaceId, mayWrite }: { api: NavigatorApi; workspaceId: string; mayWrite: boolean }) {
  const { t } = useI18n();
  const [assets, setAssets] = useState<ConversationMediaAsset[]>([]);
  const [assetCursor, setAssetCursor] = useState<string | null>(null);
  const [assetSearch, setAssetSearch] = useState("");
  const [assetError, setAssetError] = useState("");
  const [assetLoaded, setAssetLoaded] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [assetDetail, setAssetDetail] = useState<(ConversationMediaAssetRead & { previewUrl: string }) | null>(null);
  const assetPreviewUrl = useRef("");
  const [assetTitle, setAssetTitle] = useState("");
  const [assetAltText, setAssetAltText] = useState("");
  const [assetTags, setAssetTags] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [attachment, setAttachment] = useState<WorkAttachment | null>(null);
  const [renderTitle, setRenderTitle] = useState("");
  const [renderContent, setRenderContent] = useState("");
  const [renderTheme, setRenderTheme] = useState("light");
  const [renderedCard, setRenderedCard] = useState<(ConversationMediaAssetRead & { previewUrl: string }) | null>(null);
  const renderedCardUrl = useRef("");
  const [speechConfig, setSpeechConfig] = useState<SpeechConfig | null>(null);
  const [speechStatus, setSpeechStatus] = useState<SpeechStatus | null>(null);
  const [languageHint, setLanguageHint] = useState("");
  const [transcription, setTranscription] = useState<SpeechTranscription | null>(null);
  const [speechError, setSpeechError] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const loadAssets = useCallback(async (append = false, cursor?: string | null) => {
    setAssetError("");
    try {
      const page = await api.searchConversationMediaAssets(workspaceId, { query: assetSearch, limit: 20, ...(cursor ? { cursor } : {}) });
      setAssets((current) => append ? [...current, ...page.items.filter((item) => !current.some((existing) => existing.assetId === item.assetId))] : page.items);
      setAssetCursor(page.nextCursor); setAssetLoaded(true);
    } catch (reason) { setAssetError(errorMessage(reason)); setAssetLoaded(false); if (!append) setAssets([]); }
  }, [api, workspaceId, assetSearch]);

  const loadPeripheral = useCallback(async () => {
    await loadAssets();
    const results = await Promise.allSettled([api.getSpeechConfig(workspaceId), api.getSpeechStatus(workspaceId)]);
    const failures: string[] = [];
    if (results[0]?.status === "fulfilled") { setSpeechConfig(results[0].value); setLanguageHint(results[0].value.defaultLanguageHint ?? ""); } else failures.push(errorMessage(results[0]?.reason));
    if (results[1]?.status === "fulfilled") setSpeechStatus(results[1].value); else failures.push(errorMessage(results[1]?.reason));
    setSpeechError(failures.join(" · "));
  }, [api, workspaceId, loadAssets]);

  useEffect(() => { void loadPeripheral(); }, [loadPeripheral, reloadKey]);
  useEffect(() => () => { if (assetPreviewUrl.current) URL.revokeObjectURL(assetPreviewUrl.current); if (renderedCardUrl.current) URL.revokeObjectURL(renderedCardUrl.current); }, []);

  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key); setAssetError(""); setSpeechError(""); setNotice("");
    try { await action(); setNotice(success); }
    catch (reason) { const message = errorMessage(reason); if (key.startsWith("speech")) setSpeechError(message); else setAssetError(message); }
    finally { setBusy(""); }
  };

  const uploadSelectedFile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!mayWrite || !file || busy) return;
    if (file.size < 1 || file.size > 10_000_000) { setAssetError(t("Choose a file from 1 byte to 10 MB.")); return; }
    const mediaType = file.type || "application/octet-stream";
    setBusy("upload"); setAssetError(""); setNotice(""); setTranscription(null);
    try {
      const contentBase64 = await fileToBase64(file);
      const saved = await api.uploadWorkAttachment(workspaceId, { name: file.name, mediaType, contentBase64 });
      setAttachment(saved); setAssetTitle(file.name.replace(/\.[^.]+$/, ""));
      setNotice(`${t("Attachment uploaded to Work")}: ${saved.sha256}`);
    } catch (reason) { setAssetError(errorMessage(reason)); }
    finally { setBusy(""); }
  };

  const importAttachment = async () => {
    if (!mayWrite || !attachment || !assetTitle.trim() || busy) return;
    if (!attachment.mediaType.startsWith("image/")) { setAssetError(t("Only image attachments can be imported into the visual media catalog.")); return; }
    setBusy("import"); setAssetError(""); setNotice("");
    try {
      const saved = await api.importConversationMediaAsset(workspaceId, { attachmentDigest: attachment.sha256, title: assetTitle.trim(), altText: assetAltText.trim(), tags: assetTags.split(",").map((tag) => tag.trim()).filter(Boolean) });
      setAssets((current) => [saved, ...current.filter((item) => item.assetId !== saved.assetId)]); setSelectedAssetId(saved.assetId); setNotice(`${t("Media asset imported")}: ${saved.assetId}`);
    } catch (reason) { setAssetError(errorMessage(reason)); }
    finally { setBusy(""); }
  };

  const inspectAsset = async (assetId: string) => {
    setBusy(`inspect:${assetId}`); setAssetError(""); setAssetDetail(null);
    try {
      const detail = await api.getConversationMediaAsset(workspaceId, assetId);
      const blob = await api.downloadConversationMediaAsset(workspaceId, assetId, detail.downloadPath, detail.asset.digest);
      if (assetPreviewUrl.current) URL.revokeObjectURL(assetPreviewUrl.current);
      const previewUrl = URL.createObjectURL(blob); assetPreviewUrl.current = previewUrl;
      setSelectedAssetId(assetId); setAssetDetail({ ...detail, previewUrl });
    }
    catch (reason) { setAssetError(errorMessage(reason)); }
    finally { setBusy(""); }
  };

  const deleteAsset = async (asset: ConversationMediaAsset) => {
    if (!mayWrite || busy || !window.confirm(t("Soft-delete this media asset? It can be restored later."))) return;
    setBusy(`delete:${asset.assetId}`); setAssetError(""); setNotice("");
    try { await api.deleteConversationMediaAsset(workspaceId, asset.assetId); setNotice(t("Media asset soft-deleted.")); await loadAssets(); if (selectedAssetId === asset.assetId) setAssetDetail(null); }
    catch (reason) { setAssetError(errorMessage(reason)); }
    finally { setBusy(""); }
  };

  const restoreAsset = async (asset: ConversationMediaAsset) => {
    if (!mayWrite || busy) return;
    setBusy(`restore:${asset.assetId}`); setAssetError(""); setNotice("");
    try { const restored = await api.restoreConversationMediaAsset(workspaceId, asset.assetId); setAssets((current) => current.map((item) => item.assetId === restored.assetId ? restored : item)); setNotice(t("Media asset restored.")); }
    catch (reason) { setAssetError(errorMessage(reason)); }
    finally { setBusy(""); }
  };

  const renderCard = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!mayWrite || !renderTitle.trim() || !renderContent.trim() || busy) return;
    setBusy("render"); setAssetError(""); setNotice(""); setRenderedCard(null);
    try { const result = await api.renderConversationMediaCard(workspaceId, { title: renderTitle.trim(), content: renderContent.trim(), theme: renderTheme }); const blob = await api.downloadConversationMediaAsset(workspaceId, result.asset.assetId, result.downloadPath, result.asset.digest); if (renderedCardUrl.current) URL.revokeObjectURL(renderedCardUrl.current); const previewUrl = URL.createObjectURL(blob); renderedCardUrl.current = previewUrl; setRenderedCard({ ...result, previewUrl }); setNotice(`${t("Card rendered as a Work attachment")}: ${result.attachment.sha256}`); await loadAssets(); }
    catch (reason) { setAssetError(errorMessage(reason)); }
    finally { setBusy(""); }
  };

  const saveSpeechConfig = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!mayWrite || busy) return;
    setBusy("speech-config"); setSpeechError(""); setNotice("");
    try { const saved = await api.putSpeechConfig(workspaceId, { enabled: speechConfig?.enabled ?? false, ...(languageHint.trim() ? { defaultLanguageHint: languageHint.trim() } : {}) }); setSpeechConfig(saved); setNotice(t("Speech preferences saved.")); }
    catch (reason) { setSpeechError(errorMessage(reason)); }
    finally { setBusy(""); }
  };

  const transcribe = async () => {
    if (!mayWrite || !attachment || !speechConfig?.enabled || !speechStatus?.available || !speechConfig.allowedMediaTypes.includes(attachment.mediaType) || busy) return;
    setBusy("speech-transcribe"); setSpeechError(""); setNotice(""); setTranscription(null);
    try { setTranscription(await api.transcribeWorkAttachment(workspaceId, { attachmentDigest: attachment.sha256, ...(languageHint.trim() ? { languageHint: languageHint.trim() } : {}) })); }
    catch (reason) { setSpeechError(errorMessage(reason)); }
    finally { setBusy(""); }
  };

  return <div className="page-stack">
    <PageHeader eyebrow={t("CONVERSATION ASSISTANT")} title={t("Media & speech")} description={t("Upload through Work attachments, manage actor-owned media assets, and inspect speech-provider readiness.")} action={<Button onClick={() => setReloadKey((value) => value + 1)} disabled={busy !== ""}>{t("Refresh")}</Button>} />
    {!mayWrite && <p className="dh-notice product-readonly">{t("This session is read-only. Viewing is available; media and speech changes require products.write.")}</p>}
    {assetError && <p role="alert" className="dh-notice dh-notice--danger">{assetError}</p>}{notice && <p role="status" className="dh-notice">{notice}</p>}
    <div className="conversation-assistant__grid">
      <Panel title={t("Upload an attachment") }>
        <form className="conversation-assistant__form" onSubmit={(event) => void uploadSelectedFile(event)}>
          <label>{t("Image or audio file")}<input type="file" accept="image/*,audio/*" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setAttachment(null); setTranscription(null); }} disabled={!mayWrite || busy !== ""} /></label>
          <p className="conversation-assistant__help">{t("The file is uploaded to the authenticated Work attachment store (10 MB maximum). Media import accepts images; speech transcription accepts only server-listed audio types.")}</p>
          <Button tone="primary" disabled={!mayWrite || !file || busy !== ""} loading={busy === "upload"}>{t("Upload to Work")}</Button>
        </form>
        {attachment && <div className="conversation-assistant__attachment"><strong>{attachment.name}</strong><small>{attachment.mediaType} · {attachment.size} bytes · SHA-256 {attachment.sha256}</small></div>}
        {attachment?.mediaType.startsWith("image/") && attachment && <form className="conversation-assistant__form" onSubmit={(event) => { event.preventDefault(); void importAttachment(); }}>
          <h3>{t("Import into media catalog")}</h3><label>{t("Title")}<input value={assetTitle} onChange={(event) => setAssetTitle(event.target.value)} disabled={!mayWrite || busy !== ""} /></label>
          <label>{t("Alt text")}<input value={assetAltText} onChange={(event) => setAssetAltText(event.target.value)} disabled={!mayWrite || busy !== ""} /></label>
          <label>{t("Tags (comma separated)")}<input value={assetTags} onChange={(event) => setAssetTags(event.target.value)} disabled={!mayWrite || busy !== ""} /></label>
          <Button tone="primary" disabled={!mayWrite || !assetTitle.trim() || busy !== ""} loading={busy === "import"}>{t("Import asset")}</Button>
        </form>}
      </Panel>
      <Panel title={t("Speech provider") } meta={speechStatus ? <StatusPill value={speechStatus.available ? "available" : "unavailable"} /> : undefined}>
        {speechError && <StateBlock kind="error" title={t("Speech service unavailable")} detail={speechError} />}
        {speechStatus && <dl className="conversation-assistant__facts"><dt>{t("Provider available")}</dt><dd>{speechStatus.available ? t("Yes") : t("No")}</dd><dt>{t("Model")}</dt><dd>{speechStatus.model ?? t("Not configured")}</dd><dt>{t("Reason")}</dt><dd>{speechStatus.reasonCode ?? t("No provider error")}</dd></dl>}
        {speechConfig && <form className="conversation-assistant__form" onSubmit={(event) => void saveSpeechConfig(event)}>
          <label className="conversation-assistant__checkbox"><input type="checkbox" checked={speechConfig.enabled} onChange={(event) => setSpeechConfig({ ...speechConfig, enabled: event.target.checked })} disabled={!mayWrite || busy !== ""} />{t("Enable speech transcription")}</label>
          <label>{t("Default language hint")}<input value={languageHint} onChange={(event) => setLanguageHint(event.target.value)} disabled={!mayWrite || busy !== ""} /></label>
          <p className="conversation-assistant__help">{t("Allowed media types")}: {speechConfig.allowedMediaTypes.join(", ") || t("None reported")} · {speechConfig.maxUploadBytes} {t("bytes maximum")}</p>
          <Button tone="primary" disabled={!mayWrite || busy !== ""} loading={busy === "speech-config"}>{t("Save speech preferences")}</Button>
        </form>}
        {attachment && <div className="conversation-assistant__form"><Button onClick={() => void transcribe()} disabled={!mayWrite || !speechConfig?.enabled || !speechStatus?.available || !speechConfig.allowedMediaTypes.includes(attachment.mediaType) || busy !== ""} loading={busy === "speech-transcribe"}>{t("Transcribe uploaded audio")}</Button>{speechConfig && !speechConfig.allowedMediaTypes.includes(attachment.mediaType) && <p className="conversation-assistant__help">{t("This attachment type is not accepted by the configured speech provider.")}</p>}</div>}
        {transcription && <section className="conversation-assistant__transcript" aria-label={t("Transcription result")}><h3>{transcription.status === "no_speech" ? t("No speech detected") : t("Transcription")}</h3><p>{transcription.text || t("The provider returned no speech text.")}</p><small>{transcription.model ?? t("Model unavailable")} · {transcription.detectedLanguage ?? t("Language unknown")} · {transcription.durationMs ?? t("Duration unknown")} ms</small>{transcription.segments.length > 0 && <ol>{transcription.segments.map((segment, index) => <li key={`${segment.startMs}-${index}`}>{formatMillis(segment.startMs)}–{formatMillis(segment.endMs)} · {segment.text}</li>)}</ol>}</section>}
      </Panel>
      <Panel title={t("Media catalog")} meta={<span>{assetLoaded ? assets.length : t("Not loaded")}</span>}>
        <form className="conversation-assistant__inline-read" onSubmit={(event) => { event.preventDefault(); void loadAssets(); }}><label>{t("Search assets")}<input value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} /></label><Button>{t("Search")}</Button></form>
        {assetError ? <StateBlock kind="error" title={t("Media catalog unavailable")} detail={assetError} /> : assets.length ? <ul className="conversation-assistant__list">{assets.map((asset) => <li key={asset.assetId} className={asset.deletedAt !== null ? "is-selected" : undefined}><div><strong>{asset.title} · {asset.mimeType}</strong><p>{asset.altText || t("No alt text")}</p><small>{asset.assetId} · {asset.byteSize} bytes · {asset.width}×{asset.height} · {t("Tags")}: {asset.tags.join(", ") || t("None")}</small>{asset.deletedAt !== null && <StatusPill value="deleted" />}</div><div className="conversation-assistant__actions"><Button onClick={() => void inspectAsset(asset.assetId)} disabled={busy !== ""}>{t("Inspect")}</Button>{asset.deletedAt === null ? <Button tone="danger" onClick={() => void deleteAsset(asset)} disabled={!mayWrite || busy !== ""}>{t("Soft delete")}</Button> : <Button onClick={() => void restoreAsset(asset)} disabled={!mayWrite || busy !== ""}>{t("Restore")}</Button>}</div></li>)}</ul> : assetLoaded ? <StateBlock kind="empty" title={t("No media assets")} detail={t("Navigator returned an empty actor-owned media catalog.")} /> : <StateBlock kind="loading" title={t("Loading media catalog")} detail={t("Reading the current actor's media assets from Navigator.")} />}
        {assetCursor && <Button onClick={() => void loadAssets(true, assetCursor)} disabled={busy !== ""}>{t("Load more")}</Button>}
        {assetDetail && <section className="conversation-assistant__asset-detail"><h3>{t("Asset details")}</h3><img src={assetDetail.previewUrl} alt={assetDetail.asset.altText || assetDetail.asset.title} /><dl className="conversation-assistant__facts"><dt>{t("Asset ID")}</dt><dd>{assetDetail.asset.assetId}</dd><dt>{t("Digest")}</dt><dd>{assetDetail.asset.digest}</dd><dt>{t("Attachment")}</dt><dd>{assetDetail.attachment.name} · {assetDetail.attachment.size} bytes</dd><dt>{t("Created")}</dt><dd>{formatEpoch(assetDetail.asset.createdAt)}</dd></dl><a href={assetDetail.previewUrl} target="_blank" rel="noreferrer">{t("Open original attachment")}</a></section>}
      </Panel>
      <Panel title={t("Render media card") }>
        <form className="conversation-assistant__form" onSubmit={(event) => void renderCard(event)}>
          <label>{t("Card title")}<input value={renderTitle} onChange={(event) => setRenderTitle(event.target.value)} disabled={!mayWrite || busy !== ""} /></label>
          <label>{t("Card content")}<textarea rows={4} value={renderContent} onChange={(event) => setRenderContent(event.target.value)} disabled={!mayWrite || busy !== ""} /></label>
          <label>{t("Theme")}<select value={renderTheme} onChange={(event) => setRenderTheme(event.target.value)} disabled={!mayWrite || busy !== ""}><option value="light">{t("Light")}</option><option value="dark">{t("Dark")}</option><option value="warm">{t("Warm")}</option></select></label>
          <p className="conversation-assistant__help">{t("Rendering creates a private PNG attachment. It does not send the image to a conversation.")}</p>
          <Button tone="primary" disabled={!mayWrite || !renderTitle.trim() || !renderContent.trim() || busy !== ""} loading={busy === "render"}>{t("Render PNG card")}</Button>
        </form>
        {renderedCard && <div className="conversation-assistant__asset-detail"><img src={renderedCard.previewUrl} alt={renderedCard.asset.altText || renderedCard.asset.title} /><p>{renderedCard.asset.assetId} · {renderedCard.attachment.sha256}</p><a href={renderedCard.previewUrl} target="_blank" rel="noreferrer">{t("Open rendered PNG")}</a></div>}
      </Panel>
    </div>
  </div>;
}

const READ_TOOL_SPECS: Record<BilibiliReadOperationId, { label: string; fields: string[]; required: string[]; example: Record<string, unknown> }> = {
  "bilibili.search": { label: "Search", fields: ["keyword", "search_type", "page"], required: ["keyword", "search_type"], example: { keyword: "", search_type: "video", page: 1 } },
  "bilibili.user.find": { label: "Find user", fields: ["user_id"], required: ["user_id"], example: { user_id: "" } },
  "bilibili.video.read": { label: "Read video metadata and subtitles", fields: ["video_id"], required: ["video_id"], example: { video_id: "" } },
  "bilibili.comments.list": { label: "List comments", fields: ["video_id", "root_comment_id", "page", "limit"], required: ["video_id"], example: { video_id: "", root_comment_id: "0", page: 1, limit: 20 } },
  "bilibili.dynamics.list": { label: "List user dynamics", fields: ["user_id", "cursor", "limit"], required: ["user_id"], example: { user_id: "", limit: 20 } },
  "bilibili.dynamic.read": { label: "Read dynamic", fields: ["dynamic_id"], required: ["dynamic_id"], example: { dynamic_id: "" } },
  "bilibili.dm.list": { label: "List direct messages", fields: ["peer_user_id", "cursor", "limit"], required: ["peer_user_id"], example: { peer_user_id: "", limit: 20 } },
  "bilibili.dm.read": { label: "Read direct message", fields: ["peer_user_id", "message_id"], required: ["peer_user_id", "message_id"], example: { peer_user_id: "", message_id: "" } },
};
const WRITE_TOOL_SPECS: Record<BilibiliWriteOperationId, { label: string; fields: string[]; required: string[]; example: Record<string, unknown> }> = {
  "bilibili.comment.create": { label: "Create comment", fields: ["video_id", "root_comment_id", "parent_comment_id", "content"], required: ["video_id", "root_comment_id", "parent_comment_id", "content"], example: { video_id: "", root_comment_id: "0", parent_comment_id: "0", content: "" } },
  "bilibili.dynamic.publish": { label: "Publish dynamic", fields: ["user_id", "content"], required: ["user_id", "content"], example: { user_id: "", content: "" } },
  "bilibili.dm.send": { label: "Send direct message", fields: ["peer_user_id", "content"], required: ["peer_user_id", "content"], example: { peer_user_id: "", content: "" } },
};

type PendingBilibiliWriteIntent = { operationId: BilibiliWriteOperationId; idempotencyKey: string };

function pendingBilibiliWriteStorageKey(workspaceId: string): string {
  return "cyrene:bilibili-pending-write:" + workspaceId;
}

function readPendingBilibiliWriteIntent(workspaceId: string): PendingBilibiliWriteIntent | null {
  try {
    const raw = globalThis.sessionStorage.getItem(pendingBilibiliWriteStorageKey(workspaceId));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    if (typeof row["operationId"] !== "string" || !Object.hasOwn(WRITE_TOOL_SPECS, row["operationId"])
      || typeof row["idempotencyKey"] !== "string" || !/^[\x21-\x7e]{1,200}$/.test(row["idempotencyKey"])) return null;
    return { operationId: row["operationId"] as BilibiliWriteOperationId, idempotencyKey: row["idempotencyKey"] };
  } catch { return null; }
}

function savePendingBilibiliWriteIntent(workspaceId: string, intent: PendingBilibiliWriteIntent | null): boolean {
  try {
    const key = pendingBilibiliWriteStorageKey(workspaceId);
    if (intent) globalThis.sessionStorage.setItem(key, JSON.stringify(intent));
    else globalThis.sessionStorage.removeItem(key);
    return true;
  } catch { return false; }
}

function BilibiliPanel({ api, workspaceId, mayOperate }: Pick<Props, "api" | "workspaceId"> & { mayOperate: boolean }) {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<BilibiliAccount[]>([]);
  const [accountsError, setAccountsError] = useState("");
  const [connections, setConnections] = useState<import("./api").BilibiliConnection[]>([]);
  const [connectionsError, setConnectionsError] = useState("");
  const [connectionRef, setConnectionRef] = useState("");
  const [linkFlow, setLinkFlow] = useState<BilibiliLinkFlow | null>(null);
  const [linkStatus, setLinkStatus] = useState<BilibiliLinkStatus | null>(null);
  const [qrValid, setQrValid] = useState(false);
  const [catalog, setCatalog] = useState<BilibiliOperationCatalog | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [operationId, setOperationId] = useState<BilibiliReadOperationId | BilibiliWriteOperationId>("bilibili.search");
  const [argumentsText, setArgumentsText] = useState(JSON.stringify(READ_TOOL_SPECS["bilibili.search"].example, null, 2));
  const [result, setResult] = useState<unknown>(null);
  const [receipt, setReceipt] = useState<WorkOperationReceipt | null>(null);
  const [receiptId, setReceiptId] = useState("");
  const [writeIntent, setWriteIntent] = useState<PendingBilibiliWriteIntent | null>(() => readPendingBilibiliWriteIntent(workspaceId));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const readOps = useMemo(() => catalog?.readOperations ?? [], [catalog]);
  const writeOps = useMemo(() => catalog?.writeOperations ?? [], [catalog]);

  const loadAccounts = useCallback(async () => {
    try {
      setAccounts(await api.getBilibiliAccounts(workspaceId)); setAccountsError("");
    } catch (reason) { setAccounts([]); setAccountsError(errorMessage(reason)); }
  }, [api, workspaceId]);
  useEffect(() => { void loadAccounts(); }, [loadAccounts, reloadKey]);

  const loadConnections = useCallback(async () => {
    try {
      const items = await api.getBilibiliConnections(workspaceId); setConnections(items); setConnectionsError("");
      if (!connectionRef && items[0]?.enabled) setConnectionRef(items[0].connectionRef);
    } catch (reason) { setConnections([]); setConnectionsError(errorMessage(reason)); }
  }, [api, workspaceId, connectionRef]);
  useEffect(() => { void loadConnections(); }, [loadConnections, reloadKey]);

  useEffect(() => {
    if (!connectionRef) { setCatalog(null); setCatalogError(""); return; }
    let active = true;
    void api.listBilibiliReadOperations(workspaceId, connectionRef).then((value) => { if (active) { setCatalog(value); setCatalogError(""); } }, (reason) => { if (active) { setCatalog(null); setCatalogError(errorMessage(reason)); } });
    return () => { active = false; };
  }, [api, workspaceId, connectionRef, reloadKey]);

  useEffect(() => {
    if (!catalog) return;
    const supported = catalog.readOperations.includes(operationId as BilibiliReadOperationId) || catalog.writeOperations.includes(operationId as BilibiliWriteOperationId);
    if (supported) return;
    const next = catalog.readOperations[0] ?? catalog.writeOperations[0];
    if (next) {
      setOperationId(next);
      const spec = next in WRITE_TOOL_SPECS ? WRITE_TOOL_SPECS[next as BilibiliWriteOperationId] : READ_TOOL_SPECS[next as BilibiliReadOperationId];
      setArgumentsText(JSON.stringify(spec.example, null, 2));
    }
  }, [catalog, operationId]);

  const beginLink = async () => {
    if (!mayOperate || busy) return;
    setBusy("link"); setError(""); setNotice(""); setLinkFlow(null); setLinkStatus(null); setQrValid(false);
    try {
      const flow = await api.beginBilibiliLink(workspaceId);
      if (flow.status === "pending" && flow.qrCodeBase64 && flow.qrCodeSha256) {
        const valid = await validatePng(flow.qrCodeBase64, flow.qrCodeSha256);
        if (!valid) throw new Error(t("Navigator returned a QR image whose PNG digest could not be verified."));
        setQrValid(true); setNotice(t("QR login started. The image is held only in this page until it expires or is cleared."));
      } else setNotice(t("Navigator reports that the QR flow is already expired."));
      setLinkFlow(flow);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(""); }
  };

  const pollLink = async () => {
    if (!mayOperate || !linkFlow || busy) return;
    setBusy("link-status"); setError(""); setNotice("");
    try {
      const status = await api.getBilibiliLinkStatus(workspaceId, linkFlow.loginFlowId); setLinkStatus(status);
      if (status.status === "linked") { setLinkFlow(null); setQrValid(false); await Promise.all([loadAccounts(), loadConnections()]); setNotice(t("Bilibili profile is linked. Navigator returned safe account metadata.")); }
      else if (status.status === "expired") { setLinkFlow(null); setQrValid(false); setNotice(t("QR login expired. Start a new link flow if you still need to connect.")); }
      else setNotice(`${t("Login status")}: ${status.status}`);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(""); }
  };

  const currentOperationIsWrite = operationId in WRITE_TOOL_SPECS;
  const hasUnresolvedWrite = !!writeIntent && receipt?.operation.status !== "verified";
  const changeOperation = (value: string) => {
    const next = value as BilibiliReadOperationId | BilibiliWriteOperationId; setOperationId(next);
    const spec = next in WRITE_TOOL_SPECS ? WRITE_TOOL_SPECS[next as BilibiliWriteOperationId] : READ_TOOL_SPECS[next as BilibiliReadOperationId];
    setArgumentsText(JSON.stringify(spec.example, null, 2)); setResult(null); setReceipt(null);
    if (receipt?.operation.status === "verified") {
      setWriteIntent(null);
      savePendingBilibiliWriteIntent(workspaceId, null);
    }
  };

  const parseArguments = (): Record<string, unknown> => {
    const value: unknown = JSON.parse(argumentsText);
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(t("Tool arguments must be a JSON object."));
    const args = value as Record<string, unknown>;
    const spec = currentOperationIsWrite ? WRITE_TOOL_SPECS[operationId as BilibiliWriteOperationId] : READ_TOOL_SPECS[operationId as BilibiliReadOperationId];
    const unknownKeys = Object.keys(args).filter((key) => !spec.fields.includes(key));
    const missing = spec.required.filter((key) => !(key in args));
    if (unknownKeys.length) throw new Error(`${t("Unsupported argument keys")}: ${unknownKeys.join(", ")}`);
    if (missing.length) throw new Error(`${t("Required arguments are missing")}: ${missing.join(", ")}`);
    return args;
  };

  const runOperation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!mayOperate || !connectionRef.trim() || !connections.some((connection) => connection.connectionRef === connectionRef && connection.enabled) || busy || (currentOperationIsWrite && hasUnresolvedWrite)) return;
    let args: Record<string, unknown>;
    try { args = parseArguments(); } catch (reason) { setError(errorMessage(reason)); return; }
    setBusy("operation"); setError(""); setNotice(""); setResult(null); setReceipt(null);
    try {
      if (currentOperationIsWrite) {
        if (!window.confirm(`${t("This will request a Bilibili write operation")}: ${operationId}. ${t("An uncertain result will not be resent automatically.")}`)) return;
        const intent = { operationId: operationId as BilibiliWriteOperationId, idempotencyKey: newConversationMemoryKey() };
        if (!savePendingBilibiliWriteIntent(workspaceId, intent)) {
          setError(t("Could not preserve the Bilibili write reference. No provider operation was sent."));
          return;
        }
        setWriteIntent(intent);
        const saved = await api.runBilibiliWrite(workspaceId, connectionRef.trim(), intent.operationId, { idempotencyKey: intent.idempotencyKey, arguments: args });
        setReceipt(saved); setReceiptId(saved.operation.id); setNotice(bilibiliWriteNotice(saved, t));
        if (saved.operation.status === "verified") {
          setWriteIntent(null);
          savePendingBilibiliWriteIntent(workspaceId, null);
        }
      } else {
        const saved = await api.runBilibiliRead(workspaceId, connectionRef.trim(), operationId as BilibiliReadOperationId, args); setResult(saved); setNotice(t("Provider read operation completed; the displayed payload is the returned result."));
      }
    } catch (reason) { setError(errorMessage(reason)); if (currentOperationIsWrite) setNotice(t("The write request did not return a receipt. Reconcile the same idempotency key before creating another write intent.")); }
    finally { setBusy(""); }
  };

  const reconcileSameIntent = async () => {
    if (!writeIntent || busy) return;
    setBusy("reconcile-intent"); setError(""); setNotice("");
    try {
      const saved = await api.getBilibiliOperationByIdempotencyKey(workspaceId, writeIntent.idempotencyKey);
      if (saved.operation.operationType !== "tool.provider.v1:" + writeIntent.operationId) throw new Error(t("The saved receipt does not match this Bilibili operation."));
      setReceipt(saved); setReceiptId(saved.operation.id); setNotice(bilibiliWriteNotice(saved, t));
      if (saved.operation.status === "verified") {
        setWriteIntent(null);
        savePendingBilibiliWriteIntent(workspaceId, null);
      }
    }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(""); }
  };

  const readReceipt = async () => {
    if (!receiptId.trim() || busy) return;
    setBusy("receipt"); setError(""); setNotice("");
    try { const saved = await api.getWorkOperationReceipt(workspaceId, receiptId.trim()); setReceipt(saved); setNotice(`${t("Operation receipt read back")}: ${saved.operation.status} · ${String(saved.operation.evidence["status"] ?? t("Outcome not reported"))}`); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(""); }
  };

  const selectedConnection = connections.find((connection) => connection.connectionRef === connectionRef) ?? null;
  const readOperationOptions = readOps.filter((id): id is BilibiliReadOperationId => id in READ_TOOL_SPECS);
  const writeOperationOptions = writeOps.filter((id): id is BilibiliWriteOperationId => id in WRITE_TOOL_SPECS);
  const selectedOperationAvailable = currentOperationIsWrite ? writeOperationOptions.includes(operationId as BilibiliWriteOperationId) : readOperationOptions.includes(operationId as BilibiliReadOperationId);

  return <div className="page-stack">
    <PageHeader eyebrow={t("CONVERSATION ASSISTANT")} title={t("Bilibili")} description={t("Link a Bilibili account through the configured Navigator flow, select an owned Exchange connection, run allowlisted reads, and track writes through durable Work receipts.")} action={<Button onClick={() => setReloadKey((value) => value + 1)} disabled={busy !== ""}>{t("Refresh")}</Button>} />
    {!mayOperate && <p className="dh-notice product-readonly">{t("This session is read-only. Viewing is available; Bilibili login and provider operations require products.operate.")}</p>}
    {error && <p role="alert" className="dh-notice dh-notice--danger">{error}</p>}{notice && <p role="status" className="dh-notice">{notice}</p>}
    <div className="conversation-assistant__grid">
      <Panel title={t("Owned accounts")} meta={<span>{accounts.length}</span>}>
        {accountsError ? <StateBlock kind="error" title={t("Account profiles unavailable")} detail={accountsError} /> : accounts.length ? <ul className="conversation-assistant__list">{accounts.map((account) => <li key={account.profileRef}><div><strong>{account.displayName ?? account.profileRef}</strong><p>{account.externalSubject ?? t("External subject not provided")}</p><small>{account.profileRef} · {t("Auth status")}: {account.authStatus} · {t("Access")}: {account.accessMode} · {t("Credential expiry")}: {account.expiresAt === null ? t("Not reported") : formatEpochSeconds(account.expiresAt)} · {t("Credential revision")}: {account.credentialRevision}</small><details><summary>{t("Account scope")}</summary><pre className="conversation-assistant__json">{JSON.stringify(account.targetScope, null, 2)}</pre></details></div></li>)}</ul> : <StateBlock kind="empty" title={t("No owned Bilibili profiles")} detail={t("Exchange returned no Bilibili profile for this actor. The UI does not create a local account record.")} />}
        <div className="conversation-assistant__form"><p className="conversation-assistant__help">{t("New login is bound to the Navigator server's configured Bilibili auth profile. The browser cannot choose credentials or profile references.")}</p><Button tone="primary" onClick={() => void beginLink()} disabled={!mayOperate || busy !== ""} loading={busy === "link"}>{t("Start QR link")}</Button></div>
        {linkFlow && qrValid && linkFlow.qrCodeBase64 && <section className="conversation-assistant__qr"><h3>{t("Scan to link Bilibili")}</h3><img src={`data:image/png;base64,${linkFlow.qrCodeBase64}`} alt={t("Ephemeral Bilibili login QR code")} /><p>{t("Expires")}: {new Date(linkFlow.expiresAt).toLocaleString()}</p><small>{t("QR digest verified in browser")}: {linkFlow.qrCodeSha256}</small><div className="conversation-assistant__actions"><Button onClick={() => void pollLink()} disabled={!mayOperate || busy !== ""} loading={busy === "link-status"}>{t("Poll link status")}</Button><Button onClick={() => { setLinkFlow(null); setLinkStatus(null); setQrValid(false); }}>{t("Clear QR")}</Button></div></section>}
        {linkFlow && !qrValid && <p className="conversation-assistant__help">{t("The QR flow is expired and has no image to display.")} <Button onClick={() => { setLinkFlow(null); setLinkStatus(null); }}>{t("Clear QR")}</Button></p>}
        {linkStatus && <p className="conversation-assistant__help">{t("Link status")}: {linkStatus.status}{linkStatus.profile ? ` · ${linkStatus.profile.displayName ?? linkStatus.profile.profileRef}` : ""}{linkStatus.reloginRequired ? ` · ${t("Relogin required")}` : ""}</p>}
      </Panel>
      <Panel title={t("Bilibili connection")}>
        {connectionsError ? <StateBlock kind="error" title={t("Bilibili connections unavailable")} detail={connectionsError} /> : connections.length ? <label className="conversation-assistant__form">{t("Connection") }<select value={connectionRef} onChange={(event) => setConnectionRef(event.target.value)} disabled={busy !== ""}>{connections.map((connection) => <option key={connection.connectionRef} value={connection.connectionRef} disabled={!connection.enabled}>{connection.displayName} · {connection.provider}{connection.enabled ? "" : ` · ${t("Disabled")}`}</option>)}</select></label> : <StateBlock kind="empty" title={t("No Bilibili connections")} detail={t("Exchange returned no Bilibili connection for this actor. Select an owned connection before running provider tools.")} />}
        {selectedConnection && <p className="conversation-assistant__help">{t("Connection reference")}: {selectedConnection.connectionRef} · {selectedConnection.enabled ? t("Enabled") : t("Disabled")}</p>}
      </Panel>
      <Panel title={t("Provider operation catalog")}>
        {catalogError ? <StateBlock kind="error" title={t("Bilibili operations unavailable")} detail={catalogError} /> : catalog ? <><p className="conversation-assistant__help">{t("Navigator returned the provider allowlist. Read results and receipts below come from server routes; no local provider data is synthesized.")}</p><dl className="conversation-assistant__facts"><dt>{t("Read operations")}</dt><dd>{catalog.readOperations.join(", ") || t("None available")}</dd><dt>{t("Write operations")}</dt><dd>{catalog.writeOperations.join(", ") || t("None available")}</dd></dl></> : <StateBlock kind="loading" title={t("Loading operation catalog")} detail={t("Reading the fixed Navigator operation allowlist.")} />}
      </Panel>
      <Panel title={t("Provider tools")}>
        <form className="conversation-assistant__form" onSubmit={(event) => void runOperation(event)}>
          <label>{t("Connection") }<select value={connectionRef} onChange={(event) => setConnectionRef(event.target.value)} disabled={!connections.some((connection) => connection.enabled) || busy !== ""}><option value="">{t("Select an enabled Bilibili connection")}</option>{connections.map((connection) => <option key={connection.connectionRef} value={connection.connectionRef} disabled={!connection.enabled}>{connection.displayName} · {connection.connectionRef}</option>)}</select></label>
          <label>{t("Operation") }<select value={operationId} onChange={(event) => changeOperation(event.target.value)} disabled={!catalog || busy !== ""}>{readOperationOptions.length > 0 && <optgroup label={t("Read-only operations")}>{readOperationOptions.map((id) => <option key={id} value={id}>{READ_TOOL_SPECS[id].label} · {id}</option>)}</optgroup>}{writeOperationOptions.length > 0 && <optgroup label={t("Write operations")}>{writeOperationOptions.map((id) => <option key={id} value={id}>{WRITE_TOOL_SPECS[id].label} · {id}</option>)}</optgroup>}</select></label>
          <label>{t("Provider arguments JSON")}<textarea rows={10} value={argumentsText} onChange={(event) => setArgumentsText(event.target.value)} disabled={busy !== ""} /></label>
          {currentOperationIsWrite && <p className="conversation-assistant__help">{t("Writes require an explicit confirmation and immutable Work receipt. If the result is uncertain, read its receipt by the same idempotency key; this UI never resends an unresolved write or marks it verified.")}</p>}
          {operationId === "bilibili.video.read" && <p className="conversation-assistant__help">{t("Video results report metadata or available subtitles; they do not imply that the video itself was watched.")}</p>}
          <Button tone={currentOperationIsWrite ? "danger" : "primary"} disabled={!mayOperate || !selectedConnection?.enabled || !selectedOperationAvailable || busy !== "" || !catalog || (currentOperationIsWrite && hasUnresolvedWrite)} loading={busy === "operation"}>{currentOperationIsWrite ? t("Run write operation") : t("Run read operation")}</Button>
        </form>
        {writeIntent && receipt?.operation.status !== "verified" && <Button onClick={() => void reconcileSameIntent()} disabled={busy !== ""} loading={busy === "reconcile-intent"}>{t("Reconcile same write intent")}</Button>}
        {result !== null && <section><h3>{t("Provider read result")}</h3><pre className="conversation-assistant__json">{JSON.stringify(result, null, 2)}</pre></section>}
        {receipt && <section><h3>{t("Work operation receipt")}</h3><StatusPill value={receipt.operation.status} /><dl className="conversation-assistant__facts"><dt>{t("Receipt ID")}</dt><dd>{receipt.operation.id}</dd><dt>{t("Operation")}</dt><dd>{receipt.operation.operationType}</dd><dt>{t("Idempotency key")}</dt><dd>{receipt.operation.idempotencyKey}</dd><dt>{t("Created")}</dt><dd>{formatEpoch(receipt.operation.createdAt)}</dd><dt>{t("Updated")}</dt><dd>{formatEpoch(receipt.operation.updatedAt)}</dd></dl><details><summary>{t("Receipt evidence")}</summary><pre className="conversation-assistant__json">{JSON.stringify(receipt.operation.evidence, null, 2)}</pre></details></section>}
      </Panel>
      <Panel title={t("Read back an operation receipt")}>
        <div className="conversation-assistant__inline-read"><label>{t("Receipt ID")}<input value={receiptId} onChange={(event) => setReceiptId(event.target.value)} /></label><Button onClick={() => void readReceipt()} disabled={!receiptId.trim() || busy !== ""} loading={busy === "receipt"}>{t("Read receipt")}</Button></div>
      </Panel>
    </div>
  </div>;
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

async function validatePng(base64: string, expectedSha256: string): Promise<boolean> {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || !globalThis.crypto?.subtle) return false;
  try {
    const decoded = atob(base64), pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (decoded.length < pngSignature.length || pngSignature.some((byte, index) => decoded.charCodeAt(index) !== byte)) return false;
    const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    const actual = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return actual === expectedSha256;
  } catch { return false; }
}

function bilibiliWriteNotice(receipt: WorkOperationReceipt, translate: (message: string) => string): string {
  const outcome = receipt.operation.evidence["status"];
  if (outcome === "REJECTED") return translate("Bilibili write was rejected; the receipt records that no side effect was accepted.");
  if (receipt.operation.status === "uncertain" || outcome === "UNKNOWN_RESULT") return translate("Bilibili write result is uncertain. Do not create a new write intent; read the receipt first.");
  if (receipt.operation.status === "verified" && outcome === "SUCCEEDED") return translate("Bilibili write succeeded and its readback was verified.");
  return `${translate("Operation receipt recorded")}: ${receipt.operation.status}`;
}

function formatEpoch(value: number): string { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function formatEpochSeconds(value: number): string { return formatEpoch(value * 1000); }
function formatMillis(value: number): string { return `${Math.floor(value / 60_000).toString().padStart(2, "0")}:${((value % 60_000) / 1000).toFixed(1).padStart(4, "0")}`; }
