# PBG reminder scheduler

Daily Ofelia job for the PBG reminder emails. The application handles the
timing; this job only calls the endpoint once per day.

## Files

- `pbg-reminders.sh` — calls the reminder endpoint.
- `pbg-reminders.ofelia.ini` — Ofelia `[job-local]` fragment.

Copy both into the infra repo (keep the `infra/` layout).

## Install

1. Copy `pbg-reminders.sh` to `infra/pbg-reminders.sh` in the infra repo.
2. Make it executable:
   ```sh
   chmod +x infra/pbg-reminders.sh
   ```
3. Mount the infra folder into the Ofelia container at `/infra`:
   ```yaml
   services:
     ofelia:
       environment:
         TZ: Asia/Kolkata
         GMD_SYNC_API_KEY: ${GMD_SYNC_API_KEY}
       volumes:
         - ./infra:/infra:ro
   ```
   `GMD_SYNC_API_KEY` must match the app's value. It is already set in the
   app `.env`.
4. Add the job block from `pbg-reminders.ofelia.ini` to the Ofelia config:
   ```ini
   [job-local pbg-reminders]
   schedule = 0 9 * * *
   command = /bin/sh /infra/pbg-reminders.sh
   ```
5. Ensure the Ofelia container can reach the app on the same Docker network:
   ```text
   http://gmd-quotation-process:4570/api/scheduler/pbg-reminders
   ```

## Timezone

- Container on IST: use `schedule = 0 9 * * *` (09:00 IST).
- Container on UTC: use `schedule = 30 3 * * *` (09:00 IST).

Either way, run it **daily**. Do not schedule it weekly; the app calculates the
7-day PO cadence from `pbg_reminder_log`.

## What the job does

On every daily run:

- `mail_trigger = CONTINUE` only.
- `OPEN`, `Running`, `Expired` only; `CLOSED` is excluded.
- **30 days before expiry:** one mail per BG.
- **On expiry date:** first expired mail per PO + contact group.
- **Every 7 days:** all currently expired, non-closed BGs under that PO are
  included. A BG that expires between cycles joins the next cycle.
- **No PO number:** skipped and reported in the job result.
- **Failed send:** retried on the next daily run.

The app writes every attempt to `pbg_reminder_log`.

## Verify

Credential probe:

```sh
curl -i -H "x-api-key: $GMD_SYNC_API_KEY" \
  http://localhost:4570/api/scheduler/pbg-reminders
```

Manual run:

```sh
curl -i -X POST -H "x-api-key: $GMD_SYNC_API_KEY" \
  http://localhost:4570/api/scheduler/pbg-reminders
```

Then check:

- Ofelia logs
- app logs for `[SCHEDULER] pbg-reminders start` / `done`
- new `SENT` rows in `pbg_reminder_log`
- response `emailsSent`, `emailsFailed`, `skippedNoPo`

## Windows Task Scheduler alternative

If Ofelia is not used:

```powershell
$action = New-ScheduledTaskAction -Execute "curl.exe" `
  -Argument '-fsS --max-time 900 -X POST -H "x-api-key: <your-key>" http://localhost:4570/api/scheduler/pbg-reminders'

$trigger = New-ScheduledTaskTrigger -Daily -At 9:00am

Register-ScheduledTask -TaskName "GMD PBG Reminders" `
  -Action $action -Trigger $trigger
```
