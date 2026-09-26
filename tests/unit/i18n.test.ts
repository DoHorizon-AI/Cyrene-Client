import { describe, expect, it } from "vitest";
import { LOCALE_STORAGE_KEY, normalizeLocale, resolveLocale, translate } from "../../apps/web/src/i18n";

describe("Studio locale contract", () => {
  it("uses the shared persistent preference key", () => {
    expect(LOCALE_STORAGE_KEY).toBe("cyrene.client.locale.v1");
  });

  it("prefers a supported stored locale over the browser locale", () => {
    expect(resolveLocale("en-US", "zh-CN")).toBe("en-US");
    expect(resolveLocale("zh-CN", "en-US")).toBe("zh-CN");
  });

  it("falls back to simplified Chinese only for Chinese browser locales", () => {
    expect(normalizeLocale("zh-Hans-CN")).toBe("zh-CN");
    expect(resolveLocale("fr-FR", "en-GB")).toBe("en-US");
  });

  it("translates workbench chrome without changing unknown domain values", () => {
    expect(translate("文件", "en-US")).toBe("File");
    expect(translate("文件", "zh-CN")).toBe("文件");
    expect(translate("pipelines.update", "en-US")).toBe("pipelines.update");
  });
});
