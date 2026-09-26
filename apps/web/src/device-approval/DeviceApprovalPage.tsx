// Module: apps/web/src/device-approval/DeviceApprovalPage.tsx
// Role: Authenticated device-approval review UI, inert until a trusted Host adapter is supplied.
// 中文：模块职责：设备审批页面；只有可信会话与同源 Host 适配器接入后才开放操作。

import { useEffect, useMemo, useState } from "react";
import {
  DeviceApprovalClient,
  type CompleteDeviceApprovalResponse,
  type CreateDeviceApprovalChallengeResponse,
  type DenyDeviceAuthorizationRequest,
  requestWebAuthnAssertion,
} from "./client";
import "./device-approval.css";

export type DeviceApprovalSessionStatus = "checking" | "authenticated" | "anonymous" | "unavailable";

interface Props {
  api?: DeviceApprovalClient;
  sessionStatus: DeviceApprovalSessionStatus;
}

interface LookupRequest extends DenyDeviceAuthorizationRequest {}

/**
 * Reviews the exact device and scope returned by Platform before allowing a decision.
 * The browser only sends a WebAuthn assertion; certificate private keys never enter this flow.
 * 中文：先展示 Platform 返回的设备与范围，再允许决策；浏览器只发送 WebAuthn 断言，不接触证书私钥。
 */
export function DeviceApprovalPage({ api, sessionStatus }: Props) {
  const [userCode, setUserCode] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [challenge, setChallenge] = useState<CreateDeviceApprovalChallengeResponse | null>(null);
  const [lookup, setLookup] = useState<LookupRequest | null>(null);
  const [decision, setDecision] = useState<string | null>(null);
  const [resumeApproval, setResumeApproval] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const canUseApproval = Boolean(api) && sessionStatus === "authenticated";
  const expired = challenge !== null && Math.min(
    Date.parse(challenge.authorization.expiresAt),
    Date.parse(challenge.challengeExpiresAt),
  ) <= now;
  const statusMessage = useMemo(() => {
    if (sessionStatus === "checking") return "Checking the interactive user session…";
    if (sessionStatus === "anonymous") return api
      ? "Sign in through your organization's Cyrene identity provider, then return here."
      : "Sign in through your organization's Cyrene identity provider, then return here. The same-origin device approval service is not configured for this Web Host.";
    if (sessionStatus === "unavailable") return api
      ? "Interactive user identity is not available in this Client surface. Local Web Host pairing does not prove organization membership."
      : "Interactive user identity is not available in this Client surface. Local Web Host pairing does not prove organization membership. The same-origin device approval service is not configured for this Web Host.";
    if (!api) return "The same-origin device approval service is not configured for this Web Host.";
    return "Signed-in session detected. Platform still checks membership and the exact organization/workspace scope.";
  }, [api, sessionStatus]);

  async function resolveDevice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api || !canUseApproval || busy || challenge) return;
    const request: LookupRequest = {
      userCode: userCode.trim(),
      scope: { organizationId: organizationId.trim(), workspaceId: workspaceId.trim() },
    };
    if (!request.userCode || !request.scope.organizationId || !request.scope.workspaceId) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await api.createChallenge(request);
      setLookup(request);
      setChallenge(response);
      setMessage("Review the device and exact scope below before deciding.");
    } catch {
      setMessage("The approval request could not be loaded. No device decision was recorded.");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!api || !challenge || !canUseApproval || (!resumeApproval && expired) || busy || decision) return;
    if (!navigator.credentials?.get) {
      setMessage("This browser does not provide WebAuthn. No approval was submitted.");
      return;
    }
    setBusy(true);
    let request: { webauthnAssertion?: Awaited<ReturnType<typeof requestWebAuthnAssertion>> } = {};
    if (!resumeApproval) {
      setMessage("Waiting for WebAuthn verification in the browser…");
      try {
        request = { webauthnAssertion: await requestWebAuthnAssertion(challenge.webauthnOptions) };
      } catch {
        setMessage("WebAuthn was cancelled or failed. No approval request was sent.");
        setBusy(false);
        return;
      }
    }
    setMessage(resumeApproval ? "Resuming the same authorization…" : "Sending the assertion for verification…");
    try {
      // Once the request may have reached Platform, resume the same approval ID without replaying a one-time assertion.
      // 请求可能到达 Platform 后，用同一 approval ID 恢复；不重放一次性 WebAuthn 断言。
      if (!resumeApproval) setResumeApproval(true);
      const result = await api.completeApproval(challenge.approvalId, request);
      setDecision("Approval recorded");
      setResumeApproval(false);
      setMessage(`Approved by ${result.approvedBy.issuer}/${result.approvedBy.subject} at ${formatDate(result.approvedAt)}. ${approvalStateMessage(result.state)}`);
    } catch {
      setMessage("Approval could not be confirmed. Retry to resume the same authorization if issuance was committed; no success is assumed.");
    } finally {
      setBusy(false);
    }
  }

  async function deny() {
    if (!api || !challenge || !lookup || !canUseApproval || expired || busy || decision) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await api.denyAuthorization(lookup);
      setDecision("Denied");
      setMessage(`Enrollment denied by ${result.deniedBy.subject} at ${formatDate(result.deniedAt)}.`);
    } catch {
      setMessage("The denial could not be confirmed. No success is assumed; refresh the request or contact your administrator.");
    } finally {
      setBusy(false);
    }
  }

  function startAnotherReview() {
    setChallenge(null);
    setLookup(null);
    setDecision(null);
    setMessage("");
  }

  const formDisabled = !canUseApproval || busy || challenge !== null;
  const decisionDisabled = !canUseApproval || busy || !challenge || (expired && !resumeApproval) || decision !== null;

  return <main className="device-approval-page">
    <header className="approval-topbar">
      <a className="approval-brand" href="/" aria-label="Cyrene Client home"><span>C↗</span><b>Cyrene</b></a>
      <span className="approval-topbar-label">SECURITY REVIEW <i /> DEVICE ENROLLMENT</span>
    </header>

    <div className="approval-layout">
      <section className="approval-intro">
        <p className="approval-eyebrow">WORKSPACE DEVICE · HUMAN APPROVAL</p>
        <h1>Review this device</h1>
        <p className="approval-lede">Check the device identity, target workspace, and CSR fingerprints before approving access.</p>
        <div className="approval-rule" />
        <p className="approval-copy">Approval requires a trusted signed-in user and a browser WebAuthn assertion. Denial uses the same authenticated scope check and does not issue a certificate.</p>
        <p className="approval-copy">This flow creates a <strong>WorkspaceDevice certificate</strong>. It does not issue a Microsoft token, workload token, or certificate private key to this browser.</p>
        <div className="approval-identity-note" role="status" aria-live="polite">
          <span className={`approval-state-dot is-${sessionStatus}`} />
          <p>{statusMessage}</p>
        </div>
      </section>

      <section className="approval-card" aria-label="Device authorization review">
        <div className="approval-card-heading">
          <div><span className="approval-eyebrow">AUTHORIZATION LOOKUP</span><h2>Enter the request details</h2></div>
          {challenge && <span className="approval-generation">GEN {challenge.authorization.authorizationGeneration}</span>}
        </div>

        <form className="approval-lookup" onSubmit={(event) => void resolveDevice(event)}>
          <label><span>Device user code</span><input required autoComplete="one-time-code" maxLength={14} pattern="[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}(-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}){2}" value={userCode} disabled={formDisabled} onChange={(event) => setUserCode(event.target.value.toUpperCase())} placeholder="ABCD-EFGH-JKLM" /></label>
          <div className="approval-scope-fields">
            <label><span>Organization ID</span><input required autoComplete="off" value={organizationId} disabled={formDisabled} onChange={(event) => setOrganizationId(event.target.value)} /></label>
            <label><span>Workspace ID</span><input required autoComplete="off" value={workspaceId} disabled={formDisabled} onChange={(event) => setWorkspaceId(event.target.value)} /></label>
          </div>
          <button className="approval-button approval-button--lookup" type="submit" disabled={formDisabled || !userCode.trim() || !organizationId.trim() || !workspaceId.trim()}>
            {busy && !challenge ? "Checking request…" : "Review device"}
          </button>
        </form>

        {message && <p className="approval-message" role="status" aria-live="polite">{message}</p>}

        {challenge && <>
          <div className="approval-details" aria-label="Device details">
            <div className="approval-details-title"><div><span className="approval-eyebrow">DEVICE DETAILS</span><h3>Confirm the identity</h3></div><span className={`approval-expiry ${expired ? "is-expired" : ""}`}>{expired ? "EXPIRED" : "EXPIRES"}</span></div>
            <dl>
              <div><dt>Device ID</dt><dd>{challenge.authorization.deviceId}</dd></div>
              <div><dt>Authorization ID</dt><dd>{challenge.authorization.authorizationId}</dd></div>
              <div><dt>Organization</dt><dd>{challenge.authorization.scope.organizationId}</dd></div>
              <div><dt>Workspace</dt><dd>{challenge.authorization.scope.workspaceId}</dd></div>
              <div><dt>CSR SHA-256</dt><dd className="approval-fingerprint">{challenge.authorization.csrSha256}</dd></div>
              <div><dt>CSR SPKI SHA-256</dt><dd className="approval-fingerprint">{challenge.authorization.csrSpkiSha256}</dd></div>
              <div><dt>Authorization expires</dt><dd>{formatDate(challenge.authorization.expiresAt)}</dd></div>
              <div><dt>WebAuthn challenge expires</dt><dd>{formatDate(challenge.challengeExpiresAt)}</dd></div>
            </dl>
          </div>

          {!decision && <div className="approval-decisions">
            <button className="approval-button approval-button--approve" type="button" disabled={decisionDisabled} onClick={() => void approve()}>
              {busy ? (message.startsWith("Waiting") ? "Waiting for passkey…" : resumeApproval ? "Resuming approval…" : "Submitting approval…") : resumeApproval ? "Resume approval" : "Approve with passkey"}
            </button>
            <button className="approval-button approval-button--deny" type="button" disabled={decisionDisabled || resumeApproval} onClick={() => void deny()}>Deny enrollment</button>
          </div>}
          {decision && <div className="approval-result" role="status"><strong>{decision}</strong><p>Only the authorization decision is shown here. Certificate delivery is a separate device-code and acknowledgement flow.</p></div>}
          <button className="approval-reset" type="button" disabled={busy || resumeApproval} onClick={startAnotherReview}>Review another request</button>
        </>}

        <footer className="approval-card-footer">User code is only a lookup value. The server validates the signed-in user and exact workspace membership.</footer>
      </section>
    </div>
  </main>;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function approvalStateMessage(state: CompleteDeviceApprovalResponse["state"]): string {
  if (state === "DEVICE_AUTHORIZATION_LIFECYCLE_STATE_ISSUING") return "Certificate issuance is in progress.";
  if (state === "DEVICE_AUTHORIZATION_LIFECYCLE_STATE_DELIVERY_PENDING") return "Certificate delivery is waiting for the device acknowledgement.";
  return "The device acknowledged certificate delivery.";
}
