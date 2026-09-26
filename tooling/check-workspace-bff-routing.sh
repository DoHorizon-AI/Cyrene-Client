#!/bin/sh
set -eu

image=${1:-cyrene-client-web:ci}
container_prefix="workspace-bff-routing-$$"
default_container="${container_prefix}-default"
incomplete_container="${container_prefix}-incomplete"
principal_only_container="${container_prefix}-principal-only"

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
    'proxy_pass http://$workspace_bff_upstream;' \
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
    --env CYRENE_WORKSPACE_BFF_UPSTREAM=missing-workspace-bff:8080
assert_status "$principal_only_container" 401 \
    --header 'Authorization: Bearer browser-controlled' \
    --header 'X-MS-CLIENT-PRINCIPAL: untrusted' \
    http://127.0.0.1/api/workspace/v1/health
