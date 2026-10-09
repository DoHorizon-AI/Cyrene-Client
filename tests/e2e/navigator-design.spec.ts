import { expect, test, type Page } from "@playwright/test";

const session = {
  authenticated: true,
  state: "AUTHENTICATED",
  sessionId: "design-fixture",
  expiresAt: "2099-01-01T00:00:00Z",
  refreshExpiresAt: "2099-01-02T00:00:00Z",
  refreshable: true,
  csrfToken: "design-fixture",
  refreshed: false,
};

async function pageRoutes(page: Page, responses: Record<string, unknown>) {
  await page.route("**/api/v1/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/auth/session") return route.fulfill({ json: session });
    return route.fulfill({ json: responses[path] ?? [] });
  });
}

test("Navigator service markers retain lifecycle meaning in both languages", async ({ page }) => {
  await pageRoutes(page, {
    "/api/v1/system/status": {
      service: "Navigator", status: "OK", version: "fixture", workspaceId: "local",
      authenticated: true, proxyPrefixes: [], credentials: { active: 0, revoked: 0 },
      observedAt: "2026-10-09T00:00:00Z",
      plugins: [
        { name: "Ready plugin", state: "READY" },
        { name: "Queued plugin", state: "QUEUED" },
        { name: "Degraded plugin", state: "DEGRADED" },
        { name: "Inactive plugin", state: "INACTIVE" },
        { name: "Failed plugin", state: "FAILED" },
      ],
    },
  });
  await page.goto("/overview");
  const states = [
    ["Ready plugin", "good"], ["Queued plugin", "live"], ["Degraded plugin", "warn"],
    ["Inactive plugin", "muted"], ["Failed plugin", "bad"],
  ] as const;
  for (const [name, tone] of states) {
    const row = page.locator(".service-row").filter({ hasText: name });
    await expect(row.locator(".service-dot")).toHaveClass(`service-dot service-dot--${tone}`);
    await expect(row.locator(".status-pill")).toHaveClass(`status-pill status-pill--${tone}`);
  }
  await page.getByLabel("语言", { exact: true }).selectOption("en-US");
  await expect(page.locator(".service-row").filter({ hasText: "Degraded plugin" }).locator(".status-pill")).toHaveText("DEGRADED");
  await expect(page.locator(".service-row").filter({ hasText: "Degraded plugin" }).locator(".service-dot")).toHaveClass("service-dot service-dot--warn");
});

test("Reactor timeline shows reached phases and the failed step without later phases", async ({ page }) => {
  const responses: Record<string, unknown> = {
    "/api/v1/reactor/deployments": [{ id: "deployment-fixture", name: "Fixture deployment", observedState: "FAILED", desiredState: "RUNNING" }],
    "/api/v1/reactor/deployments/deployment-fixture/events": {
      deploymentId: "deployment-fixture",
      events: ["QUEUED", "LOADING", "FAILED"].map((phase, i) => ({
        sequence: i + 1, phase, message: `Fixture ${phase}`, occurredAt: "2026-10-09T00:00:00Z",
        failureCode: phase === "FAILED" ? "MODEL_LOAD_FAILED" : null,
      })),
    },
  };
  await pageRoutes(page, responses);
  await page.goto("/deployments");
  await page.getByRole("button", { name: "加载历史", exact: true }).click();
  const timeline = page.getByRole("list", { name: "部署阶段", exact: true });
  await expect(timeline.locator(".dh-step")).toHaveCount(3);
  await expect(timeline.locator(".dh-step[data-state='done']")).toHaveCount(2);
  await expect(timeline.locator(".dh-step[data-state='blocked']")).toHaveCount(1);
  await expect(timeline).not.toContainText("PROBING");
  await expect(timeline).not.toContainText("READY");
  await expect(page.locator(".dh-event-row__failure")).toContainText("MODEL_LOAD_FAILED");
  await page.getByLabel("语言", { exact: true }).selectOption("en-US");
  await expect(page.getByRole("list", { name: "Deployment phases", exact: true }).locator(".dh-step[data-state='blocked']")).toContainText("FAILED");
});
