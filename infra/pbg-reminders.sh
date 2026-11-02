#!/bin/sh
set -eu

# Daily PBG reminder job.
#
# The application decides which mails are due:
#   - exactly 30 days before expiry, once per BG
#   - on the expiry date, then every 7 days per PO + contact group
#
# Run this once per day (09:00 IST recommended). Do NOT run it weekly;
# the 7-day interval is calculated inside the application from
# pbg_reminder_log.
curl -fsS --max-time 900 -X POST \
  -H "x-api-key: ${GMD_SYNC_API_KEY}" \
  "http://gmd-quotation-process:4570/api/scheduler/pbg-reminders"
