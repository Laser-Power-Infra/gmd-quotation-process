#!/bin/sh
# Usage: pbg-reminders.sh  -- POSTs to /api/scheduler/pbg-reminders
# Daily PBG reminder job.
#
# The application decides which mails are due:
#   - exactly 30 days before expiry, once per BG
#   - on the expiry date, then every 7 days per PO + contact group
#
# Run this once per day (09:00 IST recommended). Do NOT run it weekly;
# the 7-day interval is calculated inside the application from
# pbg_reminder_log.
#
# Failure modes, all of which must fail the job:
#   - Non-200: wget itself exits non-zero, and `set -e` aborts the script.
#   - 200 whose body reports success=false (a mail failed to send): caught by
#     the grep below. Failed sends are retried on the next daily run.
#
# Env (set in the ofelia container, not committed):
#   GMD_SYNC_API_KEY    must match GMD_SYNC_API_KEY on the app
set -eu

# Fail loudly when the secret is missing, rather than sending an empty
# `x-api-key:` header and getting back an opaque 401.
: "${GMD_SYNC_API_KEY:?GMD_SYNC_API_KEY is not set in the ofelia container}"

url="http://gmd-quotation-process:4570/api/scheduler/pbg-reminders"

# Cheap credential probe first: GET authenticates but sends no mail.
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
body=$(wget -qO- -T 900 \
  --header 'Content-Type: application/json' \
  --header "x-api-key: ${GMD_SYNC_API_KEY}" \
  --post-data '{}' \
  "$url")

echo "$body"

if echo "$body" | grep -q '"success": *false'; then
  echo "ERROR: pbg reminders reported success=false"
  exit 1
fi

echo "OK: pbg reminders completed"
