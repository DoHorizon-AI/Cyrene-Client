import { expect, test } from "@playwright/test";

test("language selection updates Studio chrome and survives reload", async ({ page }) => {
  await page.goto("/");

  const selector = page.getByLabel("语言");
  await expect(selector).toHaveValue("zh-CN");
  await selector.selectOption("en-US");

  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(page.getByRole("button", { name: "File", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Language")).toHaveValue("en-US");
  await expect(page.getByRole("button", { name: "File", exact: true })).toBeVisible();

  await page.getByLabel("Language").selectOption("zh-CN");
  await expect(page.getByRole("button", { name: "文件", exact: true })).toBeVisible();
});
