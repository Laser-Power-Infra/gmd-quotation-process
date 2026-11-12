#!/bin/sh
# Usage: docket-auto-link-sync.sh  -- POSTs to $GMD_APP_SERVER/api/scheduler/docket-auto-link
# Runs the nightly docket auto-link: a live contract no docket carries yet is linked
# to the one docket of its party that matches it on every item code and qty. Only the
# link is written, never rates. Ambiguous and partial matches are left for the Match button.
#
# Failure modes, all of which must fail the job:
#   - Non-200: wget itself exits non-zero, and `set -e` aborts the script.
#   - 200 whose body reports success=false: caught by the grep below.
#   - 200 with success=true but a link whose write failed (`failed`): caught by the
#     counter check below, so a half-done run does not print OK.
#
# Env (set in the ofelia container, not committed):
#   GMD_APP_SERVER      base URL of this app, e.g. http://gmd-quotation-process:4570
#   GMD_SYNC_API_KEY    must match GMD_SYNC_API_KEY on the app
set -eu

# Fail loudly when the secret is missing, rather than sending an empty
# `x-api-key:` header and getting back an opaque 401.
: "${GMD_APP_SERVER:?GMD_APP_SERVER is not set in the ofelia container}"
: "${GMD_SYNC_API_KEY:?GMD_SYNC_API_KEY is not set in the ofelia container}"

# No trailing slash — the app runs with the default trailingSlash:false, so
# /docket-auto-link/ would cost a 308 redirect hop before reaching the handler.
url="${GMD_APP_SERVER}/api/scheduler/docket-auto-link"

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
body=$(wget -qO- -T 600 \
  --header 'Content-Type: application/json' \
  --header "x-api-key: ${GMD_SYNC_API_KEY}" \
  --post-data '{}' \
  "$url")

echo "$body"

if echo "$body" | grep -q '"success": *false'; then
  echo "ERROR: docket-auto-link reported success=false"
  exit 1
fi

# The job returns success:true unless it THROWS, so a link whose write failed still
# arrives as 200. Same reasoning as the failedWrites check in contract-review-sync.sh.
if echo "$body" | grep -q '"failed": *[1-9]'; then
  echo "ERROR: docket-auto-link reported failed links (see body)"
  exit 1
fi

echo "OK: docket-auto-link completed"
