import type { Page } from "@playwright/test";

export async function menuAction(page: Page, menu: string, action: string) {
  const trigger = page.getByRole("navigation", { name: "主菜单" }).getByRole("button", { name: menu, exact: true });
  if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
  await page.locator(".ide-menu-popup").getByRole("button", { name: action, exact: true }).click();
  if (await trigger.getAttribute("aria-expanded") === "true") await trigger.press("Escape");
}
