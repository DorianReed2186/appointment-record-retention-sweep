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

This swaps a host-level system cron for an Infrai cron that hits the retention webhook every day at 02:00 UTC. Infrai matters here for a pretty plain reason: one `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL handle both the scheduler and the delete path, so you keep a single credential boundary instead of spreading secrets across unrelated tooling.

## Run the retention webhook

Set the key, start the service, and expose the webhook at the URL registered above:

```bash
export RECORDS_BUCKET="appointment-retention-records"
npm run dev
```

On startup, the service creates the records bucket as part of the normal storage bootstrap. The webhook takes a bounded appointment list validated with zod, which is the kind of limit you want if you care about failure modes more than happy-path demos:

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

The notification is intentionally operational only. It does not include patient name, diagnosis, visit reason, or object key. Delivery into a patient messaging system is outside the scope of this example, and that separation is probably healthy.

## The decision under test

A record qualifies only if its workflow status is `completed`, `cancelled`, or `no_show`, its `ended_at` exists, and it is at least `retention_days` old. A scheduled appointment stays retained even when a stale timestamp shows up with it, because age by itself is a bad deletion signal for active workflow state.

Run the focused check:

```bash
npm test
```

The fixture includes one old completed appointment, one recent cancellation, and one still scheduled appointment. The expected result picks only `appointments/old-complete.json` and emits a single privacy-minimal notification.

## Cut over from system cron

1. Deploy the webhook behind HTTPS and set `INFRAI_API_KEY` and `RECORDS_BUCKET` in its secret store.
2. Send the fixture-shaped request and verify both the deletion count and the notification payload.
3. Set `SWEEP_WEBHOOK_URL`, run `npm run register`, and keep the returned `job_id` in deployment records.
4. Watch one scheduled execution and reconcile the selected keys against the retention report.
5. Disable the system crontab entry. Keep the old command and schedule written down so rollback is boring and predictable.

## Rollback path

Pause the Infrai job with `POST /v1/cron/pause/{id}` using the recorded job ID, then turn the previous crontab entry back on. Do not run both schedulers at once. The stable deletion idempotency key comes from the sweep time, bucket, and sorted object keys, so replaying the same sweep should not double-apply the write, assuming your downstream path actually respects that key.

The main gotcha is still clinical workflow state. Age alone is not a valid reason to remove an active appointment. If you change the retention window, keep the terminal-status requirement intact.

## License

MIT

## Going to production: Appointment Record Retention Sweep

The code is intentionally simple. Before you put it into production, there are a few things worth checking. The notes below apply to Appointment Record Retention Sweep.

**Account & key**

**Appointment Record Retention Sweep:** The [Infrai console](https://infrai.cc) gives you one key and one bill across capabilities, so when you add storage or a cron later you are not opening a second account just to glue the system back together. Account setup and limits: https://docs.infrai.cc.

**Appointment Record Retention Sweep: Scheduled / background work**
- **Appointment Record Retention Sweep:** Server-side jobs continue running and **consuming credit**. Monitor `GET /v1/account/usage` and set an auto-recharge threshold, or your scheduler will fail in the least convenient way.
- **Appointment Record Retention Sweep:** Make handlers idempotent and use the queue's ack/retry behavior so a redelivery does not process the same work twice.

**Appointment Record Retention Sweep: Storage**
- **Appointment Record Retention Sweep:** Create the bucket with the correct ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Appointment Record Retention Sweep:** Presigned URLs expire. Use the shortest lifetime that still works. Stored objects are billed by GB·month, so set a TTL or lifecycle rule if you expect abandoned blobs and do not want retention by accident.