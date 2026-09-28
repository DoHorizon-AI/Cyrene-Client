// Module: tests/e2e/device-approval.spec.ts
// Role: Verify the browser page stays inert without trusted identity and Host routing.
// 中文：模块职责：验证缺少可信身份和 Host 路由时页面保持不可操作。

import { expect, test } from "@playwright/test";

test("device approval route fails closed when trusted identity and the same-origin service are absent", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.includes("device-authorizations") || path === "/api/v1/auth/session") requests.push(`${request.method()} ${path}`);
  });
  await page.goto("/device-approval");

  await expect(page.getByRole("heading", { name: "Review this device" })).toBeVisible();
  await expect(page.getByText(/Local Web Host pairing does not prove organization membership/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Review device" })).toBeDisabled();
  await expect(page.getByLabel("Device user code")).toBeDisabled();
  await expect(page.getByText(/same-origin device approval service is not configured/i)).toBeVisible();
  expect(requests).toEqual([]);
});
