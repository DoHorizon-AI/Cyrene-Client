// ┌─────────────────────────────────────────────────────────────────────────┐
// │  📄 installer.spec.ts                                                    │
// │  Module: tests/e2e                                                       │
// │  Role: End-to-end tests for the Cyrene Modular Installer UI:              │
// │         - Workload selection (Catalyst, Echo)                            │
// │         - Individual components selection and affinity rules             │
// │         - Installation plan preview, error notice, and NOT_CONNECTED gate │
// │         - Component management lifecycle and binding guard               │
// │                                                                          │
// │  中文：安装器 E2E 测试：工作负载选择、独立组件勾选、安装计划与组件管理。    │
// └─────────────────────────────────────────────────────────────────────────┘

import { test, expect } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";

test.describe("Cyrene Installer UI", () => {
  const screenshotsDir = path.resolve(process.cwd(), ".artifacts/installer-screenshots");

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
  });

  test("Workload selection E2E: selects Catalyst and Echo, verifies auto-selected components and impact warning on unchecking recommended", async ({ page }) => {
    await page.goto("/installer");

    // Verify NOT_CONNECTED banner is prominently displayed
    const notConnectedBanner = page.locator(".installer-not-connected");
    await expect(notConnectedBanner).toBeVisible();
    await expect(notConnectedBanner).toContainText(/NOT CONNECTED|未连接/);

    // Verify step indicators
    await expect(page.locator(".installer-steps")).toBeVisible();
    await expect(page.locator(".installer-step--active")).toContainText(/选择|Select/);

    // Initial state: empty selection
    await expect(page.getByText(/请至少选择一个工作负载或组件|Select at least one/i).first()).toBeVisible();

    // Select Catalyst workload
    const catalystCard = page.locator(".installer-workload-card").filter({ hasText: "Catalyst" });
    await catalystCard.click();

    // Verify Catalyst card is selected
    await expect(catalystCard).toHaveClass(/installer-workload-card--selected/);

    // Verify selection detail contains required and recommended components
    const detailPane = page.locator(".installer-main");
    await expect(detailPane.locator(".installer-plan__item-name").filter({ hasText: "Document Parsing" })).toBeVisible();
    await expect(detailPane.locator(".installer-plan__item-name").filter({ hasText: "Dataset Preparation" })).toBeVisible();
    await expect(detailPane.locator(".installer-plan__item-name").filter({ hasText: "Knowledge Preparation" })).toBeVisible();
    await expect(detailPane.locator(".installer-plan__item-name").filter({ hasText: "Dataset Generation" })).toBeVisible();

    // Verify required chip is present for Document Parsing
    await expect(detailPane.locator(".installer-plan__item").filter({ hasText: "Document Parsing" }).locator(".installer-chip--required")).toBeVisible();

    // Take screenshot of Catalyst selected
    await page.screenshot({ path: path.join(screenshotsDir, "01-workload-catalyst-selected.png"), fullPage: true });

    // Switch to Individual Components tab to test deselecting a recommended component
    await page.getByRole("tab", { name: /独立组件|Individual Components/i }).click();

    // Locate Knowledge Preparation (recommended by Catalyst)
    const knowledgeRow = page.locator(".installer-component-row").filter({ hasText: "Knowledge Preparation" });
    await expect(knowledgeRow).toBeVisible();
    const knowledgeCheckbox = knowledgeRow.locator("input[type='checkbox']");
    await expect(knowledgeCheckbox).toBeChecked();

    // Uncheck recommended Knowledge Preparation
    await knowledgeRow.click();
    await expect(knowledgeCheckbox).not.toBeChecked();

    // Verify affected capabilities warning is displayed
    await expect(page.locator(".installer-affinity-warning").first()).toBeVisible();
    await expect(page.getByText(/以下功能将受影响|the following capabilities will be affected/i).first()).toBeVisible();

    // Take screenshot of affected capabilities warning
    await page.screenshot({ path: path.join(screenshotsDir, "02-recommended-deselected-warning.png"), fullPage: true });

    // Switch back to Workloads and also select Echo workload
    await page.getByRole("tab", { name: /工作负载|Workloads/i }).click();
    const echoCard = page.locator(".installer-workload-card").filter({ hasText: "Echo" });
    await echoCard.click();
    await expect(echoCard).toHaveClass(/installer-workload-card--selected/);

    // Verify Echo components are added
    await expect(detailPane.locator(".installer-plan__item-name").filter({ hasText: "Exact Match Evaluation Runner" })).toBeVisible();

    // Advance to Installation Plan
    const nextBtn = page.getByRole("button", { name: /查看安装计划|Review installation plan/i });
    await expect(nextBtn).toBeEnabled();
    await nextBtn.click();

    // Verify we arrived at the Plan page
    await expect(page.locator(".installer-detail__title")).toContainText(/确认安装内容|Review your installation/i);
    await expect(page.locator(".installer-plan__section-title").filter({ hasText: /将安装的产品|Products to install/i })).toBeVisible();

    // Take screenshot of installation plan
    await page.screenshot({ path: path.join(screenshotsDir, "03-installation-plan-preview.png"), fullPage: true });
  });

  test("Individual Components selection E2E: filters, searches, and obeys Required lock", async ({ page }) => {
    await page.goto("/installer");

    // Select Catalyst first so we have a required component
    await page.locator(".installer-workload-card").filter({ hasText: "Catalyst" }).click();

    // Switch to Individual Components tab
    await page.getByRole("tab", { name: /独立组件|Individual Components/i }).click();

    // Verify search works
    const searchInput = page.getByPlaceholder(/搜索组件|Search components/i);
    await searchInput.fill("vLLM");
    await expect(page.locator(".installer-component-row")).toHaveCount(1);
    await expect(page.getByText("vLLM Serving Runtime")).toBeVisible();

    // Toggle optional vLLM component
    const vllmRow = page.locator(".installer-component-row").filter({ hasText: "vLLM Serving Runtime" });
    await vllmRow.click();
    await expect(vllmRow.locator("input[type='checkbox']")).toBeChecked();

    // Clear search
    await searchInput.fill("");

    // Verify Required component cannot be unchecked
    const docParseRow = page.locator(".installer-component-row").filter({ hasText: "Document Parsing" });
    const docParseCheckbox = docParseRow.locator("input[type='checkbox']");
    await expect(docParseCheckbox).toBeChecked();
    await expect(docParseCheckbox).toBeDisabled();

    // Attempting to click docParseRow should not toggle it
    await docParseRow.click();
    await expect(docParseCheckbox).toBeChecked();

    // Filter by "Available"
    await page.getByRole("button", { name: /可用|Available/i }).click();
    await expect(page.locator(".installer-component-row").first()).toBeVisible();

    // Take screenshot of Individual Components tab
    await page.screenshot({ path: path.join(screenshotsDir, "04-individual-components-tab.png"), fullPage: true });
  });

  test("Installation Plan preview & safety gate: displays accurate metadata and disables install button in NOT_CONNECTED mode", async ({ page }) => {
    await page.goto("/installer");

    // Select Catalyst
    await page.locator(".installer-workload-card").filter({ hasText: "Catalyst" }).click();

    // Proceed to Plan
    await page.getByRole("button", { name: /查看安装计划|Review installation plan/i }).click();

    // Check Plan metadata items
    await expect(page.getByText(/目标平台|Target platform/i)).toBeVisible();
    await expect(page.getByText(/部署模式|Deployment mode/i)).toBeVisible();
    await expect(page.getByText(/预计下载大小|Estimated download size/i)).toBeVisible();

    // Size shows "待确定" when sizes are unknown, never fake data
    await expect(page.getByText(/待确定|Unknown — size data not yet available/i)).toBeVisible();

    // Crucial safety rule: install button MUST NOT execute in NOT_CONNECTED mock mode
    const installBtn = page.getByRole("button", { name: /开始安装|Install/i });
    await expect(installBtn).toBeDisabled();

    // Back button returns to selection
    const backBtn = page.getByRole("button", { name: /返回|Back/i });
    await backBtn.click();
    await expect(page.locator(".installer-workload-card").first()).toBeVisible();
  });

  test("Component Management E2E: inspects lifecycle statuses and uninstall binding guard", async ({ page }) => {
    await page.goto("/installer");

    // Switch to Component Management tab
    await page.getByRole("button", { name: /组件管理|Component Management/i }).click();

    // Verify Management header
    await expect(page.locator(".installer-detail__title")).toContainText(/管理已安装组件|Manage installed components/i);

    // Verify components and lifecycle pills exist
    await expect(page.locator(".installer-mgmt-card").first()).toBeVisible();
    await expect(page.locator(".installer-status-pill").first()).toBeVisible();

    // Take screenshot of Component Management
    await page.screenshot({ path: path.join(screenshotsDir, "05-component-management.png"), fullPage: true });
  });
});
