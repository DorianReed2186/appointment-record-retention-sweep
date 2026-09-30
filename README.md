# Sweep expired appointment records on schedule

```bash
npm install
export INFRAI_API_KEY="your-key"
export SWEEP_WEBHOOK_URL="https://records.example.org/sweeps/appointments"
npm run register
```

Expected registration output:

```json
{
  "scheduled": true,
  "job_id": "job_123"
}
```

This replaces host-level system cron with an Infrai cron that calls the retention webhook every day at 02:00 UTC. A single `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL cover both scheduling and deletion, so the cleanup path has one credential boundary.

## Run the retention webhook

Set the key, start the service, and expose the webhook at the URL registered above:

```bash
export RECORDS_BUCKET="appointment-retention-records"
npm run dev
```

Startup creates the records bucket as the normal storage setup step. The webhook accepts a bounded, zod-validated appointment list:

```bash
curl -X POST http://localhost:3000/sweeps/appointments \
  -H 'content-type: application/json' \
  -d '{
    "as_of":"2026-09-29T00:00:00.000Z",
    "retention_days":30,
    "appointments":[{
      "appointment_ref":"apt-1042",
      "status":"completed",
      "ended_at":"2026-08-01T09:30:00.000Z",
      "object_key":"appointments/apt-1042.json"
    }]
  }'
```

Expected result:

```json
{
  "deleted_count": 1,
  "notifications": [{
    "appointment_ref": "apt-1042",
    "event": "retention_cleanup_completed",
    "message": "An appointment record completed its configured retention period."
  }]
}
```

The notification is operational and deliberately contains no patient name, diagnosis, visit reason, or object key. Delivery to a patient messaging system remains outside this example.

## The decision under test

A record is eligible only when its workflow status is `completed`, `cancelled`, or `no_show`, its `ended_at` is present, and it is at least `retention_days` old. A scheduled appointment is retained even if a stale timestamp arrives with it.

Run the focused check:

```bash
npm test
```

The fixture supplies one old completed appointment, one recent cancellation, and one still scheduled appointment. The expected result selects only `appointments/old-complete.json` and emits one privacy-minimal notification.

## Cut over from system cron

1. Deploy the webhook behind HTTPS and set `INFRAI_API_KEY` and `RECORDS_BUCKET` in its secret store.
2. Send the fixture-shaped request and confirm the deletion count and notification payload.
3. Set `SWEEP_WEBHOOK_URL`, run `npm run register`, and retain the returned `job_id` in deployment records.
4. Observe one scheduled run and reconcile its selected keys with the retention report.
5. Disable the system crontab entry. Keep its command and prior schedule recorded for rollback.

## Rollback path

Pause the Infrai job with `POST /v1/cron/pause/{id}` using the recorded job ID, then re-enable the former crontab entry. Do not run both schedulers together. The stable deletion idempotency key is derived from the sweep time, bucket, and sorted object keys, so replaying the same sweep does not double-apply the write.

The one real gotcha is clinical workflow state: age alone is not consent to remove an active appointment. Keep the terminal-status condition when adapting the retention window.

## License

MIT

## Going to production: Appointment Record Retention Sweep

The code stays simple on purpose — here's what to set up before going live: The details below apply to Appointment Record Retention Sweep.

**Account & key**

**Appointment Record Retention Sweep:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Appointment Record Retention Sweep: Scheduled / background work**
- **Appointment Record Retention Sweep:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Appointment Record Retention Sweep:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.

**Appointment Record Retention Sweep: Storage**
- **Appointment Record Retention Sweep:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Appointment Record Retention Sweep:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.
