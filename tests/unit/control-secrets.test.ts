import { describe, expect, it, vi } from "vitest";
import { readConfiguredSecret } from "../../apps/control/secrets";

describe("control service secrets", () => {
  it("reads and trims a mounted secret file", async () => {
    const reader = vi.fn(async () => "  dedicated-token\n");
    await expect(readConfiguredSecret("PRODUCT_TOKEN", { PRODUCT_TOKEN_FILE: "/run/secrets/product" }, reader)).resolves.toBe("dedicated-token");
    expect(reader).toHaveBeenCalledWith("/run/secrets/product", "utf8");
  });

  it("rejects ambiguous and empty secret configuration", async () => {
    await expect(readConfiguredSecret("PRODUCT_TOKEN", { PRODUCT_TOKEN: "inline", PRODUCT_TOKEN_FILE: "/run/secrets/product" }, async () => "file")).rejects.toThrow("mutually exclusive");
    await expect(readConfiguredSecret("PRODUCT_TOKEN", { PRODUCT_TOKEN_FILE: "/run/secrets/product" }, async () => " \n")).rejects.toThrow("empty secret");
  });
});
