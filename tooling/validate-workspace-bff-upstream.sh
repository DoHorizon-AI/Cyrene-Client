#!/bin/sh
# Validates trusted Workspace BFF routing settings before Nginx renders them.
# 中文：在 Nginx 渲染配置前校验受信的 Workspace BFF 路由设置。
set -eu

# Reports invalid routing settings and stops container startup.
# 中文：报告无效路由设置并阻止容器启动。
fail() {
    printf 'Invalid Workspace BFF Nginx configuration: %s\n' "$1" >&2
    exit 1
}

enabled=${CYRENE_WORKSPACE_BFF_ENABLED:-false}
upstream=${CYRENE_WORKSPACE_BFF_UPSTREAM:-}
resolver=${CYRENE_WORKSPACE_BFF_DNS_RESOLVER:-}
expected_domain=${CYRENE_WORKSPACE_BFF_EXPECTED_ENV_DOMAIN:-}

case "$enabled" in
    true|false) ;;
    *) fail 'CYRENE_WORKSPACE_BFF_ENABLED must be exactly true or false' ;;
esac

case "$expected_domain" in
    ''|*[!a-z0-9.-]*|.*|*.) fail 'trusted ACA environment domain is malformed' ;;
    *..*) fail 'trusted ACA environment domain is malformed' ;;
esac
if ! printf '%s\n' "$expected_domain" | awk -F. '
    NF < 2 || length($0) > 253 { exit 1 }
    {
        for (i = 1; i <= NF; i++) {
            if (length($i) > 63 || $i !~ /^[a-z0-9-]+$/ || $i ~ /^-/ || $i ~ /-$/) exit 1
        }
    }
'; then
    fail 'trusted ACA environment domain is malformed'
fi

if ! printf '%s\n' "$resolver" | awk -F. '
    NF != 4 { exit 1 }
    {
        for (i = 1; i <= 4; i++) {
            if ($i !~ /^[0-9]+$/ || length($i) > 3 || $i + 0 > 255 || (length($i) > 1 && substr($i, 1, 1) == "0")) exit 1
        }
    }
'; then
    fail 'CYRENE_WORKSPACE_BFF_DNS_RESOLVER must be one IPv4 address without a port'
fi

if [ -n "$upstream" ]; then
    expected_upstream="cyrene-workspace-bff.internal.${expected_domain}"
    if [ "$upstream" != "$expected_upstream" ]; then
        fail 'CYRENE_WORKSPACE_BFF_UPSTREAM must be exactly the configured BFF internal FQDN'
    fi
fi
