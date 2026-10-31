/**
 * A stable set of same-origin proxy prefixes exposed by Navigator.
 * 中文：Navigator 暴露的一组稳定同源代理前缀。
 */
export const NAVIGATOR_PROXY_PATHS = {
  catalyst: "/api/v1/catalyst",
  echo: "/api/v1/echo",
  exchange: "/api/v1/exchange",
  navigator: "/api/v1/navigator",
  reactor: "/api/v1/reactor",
  yield: "/api/v1/yield",
} as const;

export const AUTH_SESSION_PATH = "/api/v1/auth/session";

export const AUTH_REFRESH_PATH = "/api/v1/auth/session/refresh";

export const AUTH_PAIR_PATH = "/api/v1/auth/pair";

export const AUTH_LOGOUT_PATH = "/api/v1/auth/session";
