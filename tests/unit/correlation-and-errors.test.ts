import { describe, it, expect, vi } from "vitest";
import {
  SettingsClient,
  ServiceError,
  formatDiagnosticSummary,
} from "../../apps/web/src/services/client";

const jsonResponse = (value: unknown, status = 200, headers?: Record<string, string>) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/problem+json", ...headers },
  });

describe("RFC 9457 Problem Details and W3C correlation handling in Client", () => {
  it("extracts canonical error code, traceId, requestId, and recoveryAction from Problem Details", async () => {
    const problemPayload = {
      type: "https://errors.cyrene.dev/catalyst/product.catalyst.dataset_not_found",
      title: "Dataset not found",
      status: 404,
      detail: "The requested Dataset does not exist.",
      code: "PRODUCT.CATALYST.DATASET_NOT_FOUND",
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      requestId: "req-abc-12345",
      recoveryAction: "user_action_required",
      retryable: false,
    };

    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(problemPayload, 404));
    const client = new SettingsClient(fetcher);

    let caught: unknown = null;
    try {
      await client.datasets();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ServiceError);
    const serviceError = caught as ServiceError;
    expect(serviceError.code).toBe("PRODUCT.CATALYST.DATASET_NOT_FOUND");
    expect(serviceError.status).toBe(404);
    expect(serviceError.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(serviceError.requestId).toBe("req-abc-12345");
    expect(serviceError.recoveryAction).toBe("user_action_required");
    expect(serviceError.retryable).toBe(false);

    // Formatted diagnostic summary includes message, recoveryAction, requestId, traceId
    // 格式化的诊断摘要包含 message、recoveryAction、requestId 和 traceId。
    const summary = formatDiagnosticSummary(serviceError);
    expect(summary).toContain("资源或设置接口不存在。");
    expect(summary).toContain("PRODUCT.CATALYST.DATASET_NOT_FOUND");
    expect(summary).toContain("建议操作: user_action_required");
    expect(summary).toContain("Request ID: req-abc-12345");
    expect(summary).toContain("Trace ID: 4bf92f3577b34da6a3ce929d0e0e4736");
  });

  it("handles legacy underscore-separated error codes", async () => {
    const problemPayload = {
      code: "CATALYST_IDEMPOTENCY_CONFLICT",
      traceId: "9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d",
      requestId: "req-xyz-999",
      recoveryAction: "safely_retry",
      retryable: true,
    };

    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(problemPayload, 409));
    const client = new SettingsClient(fetcher);

    await expect(client.datasets()).rejects.toMatchObject({
      code: "CATALYST_IDEMPOTENCY_CONFLICT",
      status: 409,
      traceId: "9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d",
      requestId: "req-xyz-999",
      recoveryAction: "safely_retry",
      retryable: true,
    });
  });

  it("safely falls back when Problem Details is empty or non-JSON without exposing raw payloads", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("Internal Server Error", { status: 500 }));
    const client = new SettingsClient(fetcher);

    await expect(client.datasets()).rejects.toMatchObject({
      code: "NON_JSON",
      status: 500,
    });
  });

  it("automatically generates and propagates X-Request-ID header on requests", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([]));
    const client = new SettingsClient(fetcher);

    await client.datasets();
    expect(fetcher).toHaveBeenCalledOnce();
    const [, init] = fetcher.mock.calls[0];
    const headers = new Headers(init?.headers);
    const reqId = headers.get("X-Request-ID");
    expect(reqId).not.toBeNull();
    expect(reqId).toMatch(/^req-[a-f0-9]{12}$/);
  });
});

describe("W3C trace context propagation from the browser", () => {
  it("sends a well-formed traceparent and a request id on every call", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([]));
    const client = new SettingsClient(fetcher);

    await client.datasets();

    const headers = new Headers((fetcher.mock.calls[0][1] as RequestInit).headers);
    const traceparent = headers.get("traceparent") ?? "";
    expect(traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(traceparent.slice(3, 35)).not.toMatch(/^0+$/);
    expect(traceparent.slice(36, 52)).not.toMatch(/^0+$/);
    expect(headers.get("X-Request-ID")).toMatch(/^req-[0-9a-f]{12}$/);
  });

  it("keeps the trace id across a refresh-and-retry but not the span", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ code: "SESSION_EXPIRED" }, 401))
      .mockResolvedValueOnce(jsonResponse({ authenticated: true, refreshable: true, csrfToken: "csrf-1" }))
      .mockResolvedValueOnce(jsonResponse([]));
    const client = new SettingsClient(fetcher);

    await client.datasets();

    const first = new Headers((fetcher.mock.calls[0][1] as RequestInit).headers).get("traceparent") ?? "";
    const retried = new Headers((fetcher.mock.calls[2][1] as RequestInit).headers).get("traceparent") ?? "";
    expect(retried.slice(3, 35)).toBe(first.slice(3, 35));
    expect(retried.slice(36, 52)).not.toBe(first.slice(36, 52));
  });

});
