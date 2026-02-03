#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# NexusX — Smoke Test Script
# infrastructure/scripts/smoke-test.sh
#
# Post-deploy verification for staging and production.
# Usage: ./smoke-test.sh <staging|production>
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

ENV="${1:-staging}"
PASS=0
FAIL=0
TOTAL=0

# ─── Resolve base URL ───
if [ "$ENV" = "production" ]; then
  BASE_URL="${PRODUCTION_URL:-https://api.nexusx.io}"
  WEB_URL="${PRODUCTION_WEB_URL:-https://nexusx.io}"
else
  BASE_URL="${STAGING_URL:-https://staging-api.nexusx.io}"
  WEB_URL="${STAGING_WEB_URL:-https://staging.nexusx.io}"
fi

echo "══════════════════════════════════════════════"
echo "  NexusX Smoke Tests — ${ENV}"
echo "  API:  ${BASE_URL}"
echo "  Web:  ${WEB_URL}"
echo "══════════════════════════════════════════════"
echo ""

# ─── Test Helper ───
check() {
  local name="$1"
  local url="$2"
  local expected_status="${3:-200}"

  TOTAL=$((TOTAL + 1))
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null || echo "000")

  if [ "$status" = "$expected_status" ]; then
    echo "  ✅  ${name} (${status})"
    PASS=$((PASS + 1))
  else
    echo "  ❌  ${name} — expected ${expected_status}, got ${status}"
    FAIL=$((FAIL + 1))
  fi
}

check_json() {
  local name="$1"
  local url="$2"
  local jq_filter="$3"

  TOTAL=$((TOTAL + 1))
  local response
  response=$(curl -s --max-time 10 "$url" 2>/dev/null || echo "{}")
  local result
  result=$(echo "$response" | jq -r "$jq_filter" 2>/dev/null || echo "null")

  if [ "$result" != "null" ] && [ "$result" != "" ]; then
    echo "  ✅  ${name} (${result})"
    PASS=$((PASS + 1))
  else
    echo "  ❌  ${name} — jq filter returned null"
    FAIL=$((FAIL + 1))
  fi
}

# ─── Gateway Health ───
echo "▸ Gateway"
check "Health check"       "${BASE_URL}/health"
check "Readiness check"    "${BASE_URL}/ready"
check "Status endpoint"    "${BASE_URL}/status"

# ─── API Endpoints ───
echo ""
echo "▸ API Endpoints"
check "List listings"      "${BASE_URL}/api/listings"
check "Price ticker"       "${BASE_URL}/api/prices/ticker"
check "Platform stats"     "${BASE_URL}/api/stats"

# ─── AI Router ───
echo ""
echo "▸ AI Router"
check "Router search (POST)" "${BASE_URL}/api/search" "200"

# ─── Auth (expect 401 without key) ───
echo ""
echo "▸ Auth Guard"
check "Proxy without key"  "${BASE_URL}/v1/test-listing/test" "401"

# ─── Web Frontend ───
echo ""
echo "▸ Web Frontend"
check "Homepage"           "${WEB_URL}/"
check "Marketplace"        "${WEB_URL}/marketplace"

# ─── Results ───
echo ""
echo "══════════════════════════════════════════════"
echo "  Results: ${PASS}/${TOTAL} passed, ${FAIL} failed"
echo "══════════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "⚠️  ${FAIL} smoke test(s) failed on ${ENV}!"
  exit 1
fi

echo ""
echo "🎉  All smoke tests passed on ${ENV}!"
exit 0
