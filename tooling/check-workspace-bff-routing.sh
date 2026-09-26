#!/bin/sh
# Checks Workspace BFF routing defaults, startup validation, and HTTP behavior.
# 中文：检查 Workspace BFF 路由默认值、启动校验与 HTTP 行为。
set -eu

image=${1:-cyrene-client-web:ci}
container_prefix="workspace-bff-routing-$$"
default_container="${container_prefix}-default"
incomplete_container="${container_prefix}-incomplete"
principal_only_container="${container_prefix}-principal-only"
expected_env_domain="whitefield-8c4d4393.eastasia.azurecontainerapps.io"
valid_upstream="cyrene-workspace-bff.internal.${expected_env_domain}"

cleanup() {
    docker rm --force \
        "$default_container" \
        "$incomplete_container" \
        "$principal_only_container" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

rendered_config=$(docker run --rm \
    --add-host cyrene-catalyst:127.0.0.1 \
    --add-host cyrene-echo:127.0.0.1 \
    --add-host cyrene-reactor:127.0.0.1 \
    --add-host cyrene-yield:127.0.0.1 \
    --add-host cyrene-exchange:127.0.0.1 \
    "$image" nginx -T 2>&1)
for expected_line in \
    'set $workspace_bff_enabled "false";' \
    'proxy_pass https://$workspace_bff_upstream;' \
    'proxy_ssl_server_name on;' \
    'proxy_ssl_name $workspace_bff_upstream;' \
    'proxy_ssl_verify on;' \
    'proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;' \
    'proxy_set_header Authorization "Bearer $http_x_ms_token_aad_access_token";' \
    'proxy_set_header X-MS-CLIENT-PRINCIPAL "";'; do
    if ! printf '%s\n' "$rendered_config" | grep -Fq "$expected_line"; then
        printf 'Rendered Nginx config is missing: %s\n' "$expected_line" >&2
        exit 1
    fi
done

start_container() {
    name=$1
    shift
    docker run --rm --detach \
        --name "$name" \
        --add-host cyrene-catalyst:127.0.0.1 \
        --add-host cyrene-echo:127.0.0.1 \
        --add-host cyrene-reactor:127.0.0.1 \
        --add-host cyrene-yield:127.0.0.1 \
        --add-host cyrene-exchange:127.0.0.1 \
        "$@" \
        "$image" >/dev/null

    attempt=0
    until docker exec "$name" wget --quiet --tries=1 --spider \
        http://127.0.0.1/healthz >/dev/null 2>&1; do
        attempt=$((attempt + 1))
        if [ "$attempt" -ge 30 ]; then
            docker logs "$name" >&2 || true
            return 1
        fi
        sleep 0.1
    done
}

assert_status() {
    name=$1
    expected_status=$2
    shift 2
    response=$(docker exec "$name" sh -c \
        'wget --server-response --output-document=/dev/null "$@" 2>&1 || true' \
        sh "$@")
    printf '%s\n' "$response"
    printf '%s' "$response" | grep -Fq "HTTP/1.1 $expected_status"
}

# Confirms invalid upstream values fail before Nginx accepts the configuration.
# 中文：确认无效 upstream 值会在 Nginx 接受配置前被拒绝。
assert_startup_rejects_upstream() {
    candidate=$1
    if output=$(docker run --rm \
        --env CYRENE_WORKSPACE_BFF_ENABLED=true \
        --env "CYRENE_WORKSPACE_BFF_UPSTREAM=$candidate" \
        "$image" nginx -t 2>&1); then
        printf 'Invalid upstream unexpectedly passed startup validation: %s\n' "$candidate" >&2
        exit 1
    fi
    if ! printf '%s\n' "$output" | grep -Fq 'CYRENE_WORKSPACE_BFF_UPSTREAM must be exactly'; then
        printf 'Startup failed for an unexpected reason with upstream: %s\n' "$candidate" >&2
        printf '%s\n' "$output" >&2
        exit 1
    fi
}

for invalid_upstream in \
    "https://${valid_upstream}" \
    "${valid_upstream}:443" \
    "${valid_upstream}/api" \
    "${valid_upstream} extra" \
    "${valid_upstream}; return 200" \
    "attacker.internal.${expected_env_domain}"; do
    assert_startup_rejects_upstream "$invalid_upstream"
done

if output=$(docker run --rm \
    --env CYRENE_WORKSPACE_BFF_ENABLED=yes \
    "$image" nginx -t 2>&1); then
    printf 'Invalid enable flag unexpectedly passed startup validation.\n' >&2
    exit 1
fi
printf '%s\n' "$output" | grep -Fq 'CYRENE_WORKSPACE_BFF_ENABLED must be exactly true or false'

if output=$(docker run --rm \
    --env 'CYRENE_WORKSPACE_BFF_EXPECTED_ENV_DOMAIN=attacker.example; return 200' \
    "$image" nginx -t 2>&1); then
    printf 'Injected trusted ACA domain unexpectedly passed startup validation.\n' >&2
    exit 1
fi
printf '%s\n' "$output" | grep -Fq 'trusted ACA environment domain is malformed'

if output=$(docker run --rm \
    --env CYRENE_WORKSPACE_BFF_DNS_RESOLVER=168.63.129.16:53 \
    "$image" nginx -t 2>&1); then
    printf 'Resolver with a port unexpectedly passed startup validation.\n' >&2
    exit 1
fi
printf '%s\n' "$output" | grep -Fq 'CYRENE_WORKSPACE_BFF_DNS_RESOLVER must be one IPv4 address without a port'

start_container "$default_container"
assert_status "$default_container" 404 \
    http://127.0.0.1/api/workspace/v1
assert_status "$default_container" 503 \
    http://127.0.0.1/api/workspace/v1/health
docker rm --force "$default_container" >/dev/null

start_container "$incomplete_container" \
    --env CYRENE_WORKSPACE_BFF_ENABLED=true
assert_status "$incomplete_container" 503 \
    http://127.0.0.1/api/workspace/v1/health
docker rm --force "$incomplete_container" >/dev/null

start_container "$principal_only_container" \
    --env CYRENE_WORKSPACE_BFF_ENABLED=true \
    --env "CYRENE_WORKSPACE_BFF_UPSTREAM=$valid_upstream"
assert_status "$principal_only_container" 401 \
    --header 'Authorization: Bearer browser-controlled' \
    --header 'X-MS-CLIENT-PRINCIPAL: untrusted' \
    http://127.0.0.1/api/workspace/v1/health
