// Module: apps/web/src/device-approval/DeviceApprovalRoute.tsx
// Role: Probe the same-origin BFF session before mounting approval actions.
// 中文：模块职责：先读取同源 BFF session，再决定审批页面可用状态。

import { useEffect, useMemo, useState } from "react";
import { DeviceApprovalPage, type DeviceApprovalSessionStatus } from "./DeviceApprovalPage";
import { SameOriginDeviceApprovalTransport } from "./bff-transport";
import { DeviceApprovalClient } from "./client";

/**
 * Resolves the real same-origin session without exposing or acquiring a browser bearer token.
 * Only an authenticated session enables approval; canceled probes cannot update an unmounted route.
 * 中文：通过真实同源 BFF session 判断页面状态，不在浏览器取得或保存 bearer token。
 */
export function DeviceApprovalRoute() {
  const transport = useMemo(() => new SameOriginDeviceApprovalTransport(), []);
  const api = useMemo(() => new DeviceApprovalClient(transport), [transport]);
  const [sessionStatus, setSessionStatus] = useState<DeviceApprovalSessionStatus>("checking");

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    void transport.checkSession(controller.signal).then(
      (status) => {
        if (active) setSessionStatus(status);
      },
      () => {
        if (active) setSessionStatus("unavailable");
      },
    );

    return () => {
      active = false;
      controller.abort();
    };
  }, [transport]);

  // Do not expose approval methods until the BFF has returned a recognized session outcome.
  const pageApi = sessionStatus === "checking" || sessionStatus === "unavailable" ? undefined : api;

  return <DeviceApprovalPage api={pageApi} sessionStatus={sessionStatus} />;
}
