import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

for (const rebuildOwner of [false, true]) test(`logout waits for in-flight refresh and removes its cookie (rebuilt owner: ${rebuildOwner})`, async ({ page, context }) => {
  const entry = `/@fs/${resolve("apps/web/services/navigator/src/api.ts").replaceAll("\\", "/")}`;
  const session = { authenticated: true, state: "AUTHENTICATED", sessionId: "fixture-session", expiresAt: null,
    refreshExpiresAt: null, refreshable: true, csrfToken: "old-csrf", refreshed: false };
  let release!: () => void, arrived!: () => void, logoutSent = false, logoutCsrf: string | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const refreshArrived = new Promise<void>(resolve => { arrived = resolve; });
  await page.route("**/src/main.tsx", route => route.fulfill({ contentType: "text/javascript", body: "export {};" }));
  await page.route("**/api/v1/auth/**", async route => {
    if (route.request().url().endsWith("/refresh")) {
      arrived(); await gate;
      return route.fulfill({ json: { ...session, csrfToken: "rotated-csrf", refreshed: true },
        headers: { "Set-Cookie": "fixture_auth=refreshed; Path=/; HttpOnly; SameSite=Lax" } });
    }
    if (route.request().method() === "DELETE") {
      logoutSent = true; logoutCsrf = route.request().headers()["x-csrf-token"];
      return route.fulfill({ status: 204, headers: { "Set-Cookie": "fixture_auth=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax" } });
    }
    return route.fulfill({ json: session });
  });
  await page.goto("/");
  await page.evaluate(async entry => {
    const { NavigatorApi } = await import(entry);
    const state = window as any;
    state.api = new NavigatorApi();
    await state.api.getSession();
    state.refresh = state.api.refreshSession();
  }, entry);
  await refreshArrived;
  await page.evaluate(async ({ entry, rebuildOwner }) => {
    const state = window as any;
    const { NavigatorApi } = await import(entry);
    state.logoutOwner = rebuildOwner ? new NavigatorApi() : state.api;
    state.logout = state.logoutOwner.logout();
  }, { entry, rebuildOwner });
  expect(logoutSent).toBe(false);
  release();
  await page.evaluate(async () => { await (window as any).logout; await (window as any).refresh; });
  expect(logoutSent).toBe(true);
  expect(logoutCsrf).toBe("rotated-csrf");
  expect((await context.cookies()).find(cookie => cookie.name === "fixture_auth")).toBeUndefined();
  expect(await page.evaluate(() => (window as any).api.sessionCsrfToken)).toBeNull();
  expect(await page.evaluate(() => (window as any).logoutOwner.sessionCsrfToken)).toBeNull();
});
