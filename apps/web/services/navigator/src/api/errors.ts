/**
 * An RFC 9457 or Web Host error raised before a page can render a result.
 * 中文：页面渲染结果之前发生的 RFC 9457 或 Web Host 错误。
 */
export class NavigatorHttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  readonly retryable: boolean;

  constructor(
    status: number,
    code: string,
    detail: string,
    retryable: boolean,
  ) {
    super(detail);
    this.name = "NavigatorHttpError";
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.retryable = retryable;
  }
}

/**
 * Raised when a response does not satisfy the small client-side wire contract.
 * 中文：响应不符合精简客户端 wire contract 时抛出的错误。
 */
export class NavigatorContractError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "NavigatorContractError";
  }
}
