#!/bin/sh
# Usage: website-prices-sync.sh  -- POSTs to $GMD_APP_SERVER/api/scheduler/website-prices
# Pushes every RawMaterial erpItemCode + cost to the GM Dalui website, which
# prices its /purchase ready-stock catalogue from it (null/0/missing -> "Price on
# request"). Read-only on this side; each run sends a full snapshot, so re-running
# is idempotent.
#
# Scheduled at :55, after the other hourly jobs.
#
# Env (set in the ofelia container, not committed):
#   GMD_APP_SERVER      base URL of this app, e.g. http://gmd-quotation-process:4570
#   GMD_SYNC_API_KEY    must match GMD_SYNC_API_KEY on the app
# The website URL and key (WEBSITE_PRICE_SYNC_URL / _API_KEY) live on the app, not here.
set -eu

: "${GMD_APP_SERVER:?GMD_APP_SERVER is not set in the ofelia container}"
: "${GMD_SYNC_API_KEY:?GMD_SYNC_API_KEY is not set in the ofelia container}"

url="${GMD_APP_SERVER}/api/scheduler/website-prices"

# Cheap credential probe first: GET authenticates but does NOT run the job.
probe=$(wget -qO- -T 30 --header "x-api-key: ${GMD_SYNC_API_KEY}" "${url}" || true)
case "$probe" in
  *'"auth":"ok"'*) : ;;
  *)
    echo "ERROR: credential probe failed for $url"
    echo "$probe"
    exit 1
    ;;
esac

echo "POST $url (key length ${#GMD_SYNC_API_KEY})"
body=$(wget -qO- -T 300 \
  --header 'Content-Type: application/json' \
  --header "x-api-key: ${GMD_SYNC_API_KEY}" \
  --post-data '{}' \
  "$url")

echo "$body"

if echo "$body" | grep -q '"success": *false'; then
  echo "ERROR: website price push reported success=false"
  exit 1
fi

echo "OK: website price push completed"
