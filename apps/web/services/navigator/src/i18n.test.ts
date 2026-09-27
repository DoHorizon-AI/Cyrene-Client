import { describe, expect, it } from "vitest";
import { LOCALE_STORAGE_KEY, normalizeLocale, resolveLocale, translate } from "./i18n";

describe("Navigator locale contract", () => {
  it("matches the Studio preference key", () => {
    expect(LOCALE_STORAGE_KEY).toBe("cyrene.client.locale.v1");
  });

  it("keeps a supported stored locale", () => {
    expect(resolveLocale("en-US", "zh-CN")).toBe("en-US");
    expect(resolveLocale("zh-CN", "en-US")).toBe("zh-CN");
  });

  it("normalizes browser language variants", () => {
    expect(normalizeLocale("zh-TW")).toBe("zh-CN");
    expect(resolveLocale("de-DE", "en-GB")).toBe("en-US");
  });

  it("translates console labels while preserving unknown API values", () => {
    expect(translate("Overview", "zh-CN")).toBe("概览");
    expect(translate("Overview", "en-US")).toBe("Overview");
    expect(translate("MODEL_READY", "zh-CN")).toBe("MODEL_READY");
  });
});
