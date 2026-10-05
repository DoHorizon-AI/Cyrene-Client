// Module: tests/e2e/device-approval-route.spec.ts
// Role: Verify the routed approval page follows the real BFF session probe lifecycle.
// 中文：模块职责：验证审批路由按 BFF session 探测结果更新状态并在卸载后停止更新。

import { expect, test } from "@playwright/test";

const SESSION_ROUTE = "**/api/workspace/v1/session";

// This contract-shaped response is a browser test fixture, not an identity or login proof.
function sessionResponse(expiresAt: string) {
  return {
    issuer: "https://login.microsoftonline.com/test-tenant/v2.0",
    subject: "device-approval-route-test-subject",
    organizationId: "device-approval-route-test-organization",
    expiresAt,
    csrfToken: `v1.${Date.parse(expiresAt)}.${"A".repeat(43)}`,
  };
}

test("keeps approval disabled while checking, then enables it for an unexpired BFF session", async ({ page }) => {
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let markRequestStarted!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    markRequestStarted = resolve;
  });
  const mutationRequests: string[] = [];

  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && path.includes("device-authorizations")) {
      mutationRequests.push(`${request.method()} ${path}`);
    }
  });
  await page.route(SESSION_ROUTE, async (route) => {
    markRequestStarted();
    await responseGate;
    try {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(sessionResponse(new Date(Date.now() + 5 * 60_000).toISOString())),
      });
    } catch {
      // React StrictMode may already have canceled its first read-only probe.
    }
  });

  await page.goto("/device-approval");
  await requestStarted;
  await expect(page.getByText("Checking the interactive user session…")).toBeVisible();
  await expect(page.getByLabel("Device user code")).toBeDisabled();

  releaseResponse();
  await expect(page.getByText(/Signed-in session detected/)).toBeVisible();
  await expect(page.getByLabel("Device user code")).toBeEnabled();
  expect(mutationRequests).toEqual([]);
});

test("keeps controls disabled for an anonymous session", async ({ page }) => {
  await page.route(SESSION_ROUTE, (route) => route.fulfill({ status: 401, body: "" }));
  await page.goto("/device-approval");

  await expect(page.getByText(/Sign in through your organization's Cyrene identity provider/)).toBeVisible();
  await expect(page.getByLabel("Device user code")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Review device" })).toBeDisabled();
});

test("shows unavailable and keeps controls disabled when the BFF cannot serve a session", async ({ page }) => {
  await page.route(SESSION_ROUTE, (route) => route.fulfill({ status: 503, body: "" }));
  await page.goto("/device-approval");

  await expect(page.getByText(/Local Web Host pairing does not prove organization membership/)).toBeVisible();
  await expect(page.getByText(/same-origin device approval service is not configured/i)).toBeVisible();
  await expect(page.getByLabel("Device user code")).toBeDisabled();
});

test("treats an expired BFF session as unavailable", async ({ page }) => {
  await page.route(SESSION_ROUTE, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(sessionResponse(new Date(Date.now() - 60_000).toISOString())),
  }));
  await page.goto("/device-approval");

  await expect(page.getByText(/Local Web Host pairing does not prove organization membership/)).toBeVisible();
  await expect(page.getByLabel("Device user code")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Review device" })).toBeDisabled();
});

test("ignores a late session result after the approval route unmounts", async ({ page }) => {
  let markRequestStarted!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    markRequestStarted = resolve;
  });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route(SESSION_ROUTE, async (route) => {
    markRequestStarted();
    await new Promise((resolve) => setTimeout(resolve, 200));
    try {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(sessionResponse(new Date(Date.now() + 5 * 60_000).toISOString())),
      });
    } catch {
      // The navigation intentionally aborts the pending read-only request.
    }
  });

  await page.goto("/device-approval");
  await requestStarted;
  await page.goto("/");
  await page.waitForTimeout(250);

  expect(new URL(page.url()).pathname).toBe("/");
  expect(pageErrors).toEqual([]);
});
