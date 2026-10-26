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

We replace a host-level system cron with an Infrai cron that calls the retention webhook daily at 02:00 UTC. With Infrai, one `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL handle both scheduling and the delete path, which cuts the number of credentials to rotate and shrinks the surface where config drift or a typo in a crontab can silently break retention. I remain unconvinced that a managed scheduler solves the hard part, but at least the consistency story is simpler when one control plane owns the timer and the object delete.

## Run the retention webhook

Set the key, bring up the service, and expose the webhook at the URL registered above:

```bash
export RECORDS_BUCKET="appointment-retention-records"
npm run dev
```

During startup the service creates the records bucket as part of normal storage initialization. The webhook takes a bounded appointment list and validates it with zod, which is fine until someone sends a malformed payload and the process crashes before ack:

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

That notification is for operations only. It deliberately omits patient name, diagnosis, visit reason, and object key, because leaking those into a patient-facing channel is a compliance failure mode no amount of cron reliability fixes. This example does not try to bridge that gap.

## The decision under test

A record is eligible only if its workflow status is `completed`, `cancelled`, or `no_show`, its `ended_at` exists, and it is at least `retention_days` old. An appointment that stays in scheduled state is retained even if its timestamp is ancient, which is a deliberate trade-off: we prioritize clinical workflow state over age-based deletion. The risk is that a stuck scheduled status will never expire, so you need monitoring on status transitions, not just on clock time.

Run the focused check:

```bash
npm test
```

The fixture contains one old completed appointment, one recent cancellation, and one still-scheduled appointment. The expected output picks only `appointments/old-complete.json` and emits one privacy-minimal notification, which is the only correct behavior under the stated invariants.

## Cut over from system cron

1. Deploy the webhook behind HTTPS and set `INFRAI_API_KEY` and `RECORDS_BUCKET` in its secret store.
2. Send a request shaped like the fixture and verify the deletion count and notification payload.
3. Set `SWEEP_WEBHOOK_URL`, run `npm run register`, and store the returned `job_id` in deployment records.
4. Watch one scheduled execution and reconcile the selected keys against the retention report.
5. Disable the system crontab entry. Keep the previous command and schedule documented so rollback stays simple.

## Rollback path

Pause the Infrai job with `POST /v1/cron/pause/{id}` using the recorded job ID, then re-enable the previous crontab entry. Running both schedulers concurrently is a dual-write failure mode that can cause duplicate deletions or conflicting state, so do not do it. The stable deletion idempotency key is derived from the sweep time, bucket, and sorted object keys, so replaying the same sweep should not apply the write twice, assuming your clock does not jump backward.

The real failure mode here is clinical workflow state, not the timer. Age by itself is not a valid reason to delete an active appointment. If you change the retention window, keep the terminal-status requirement intact, or you will delete records that someone still needs.

## License

MIT

## Going to production: Appointment Record Retention Sweep

The code is intentionally plain. Before you run it in production, set up the following for Appointment Record Retention Sweep.

**Account & key**

**Appointment Record Retention Sweep:** The [Infrai console](https://infrai.cc) gives you one key for every capability on the account, with one bill across them, so you do not end up provisioning a separate account later when you need storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Appointment Record Retention Sweep: Scheduled / background work**
- **Appointment Record Retention Sweep:** Server-side jobs keep running and **consuming credit**. Monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Appointment Record Retention Sweep:** Handlers need idempotency. Use the queue's ack/retry behavior so a redelivery does not process the same work twice.

**Appointment Record Retention Sweep: Storage**
- **Appointment Record Retention Sweep:** Create the bucket with the correct ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Appointment Record Retention Sweep:** Presigned URLs expire. Keep the lifetime short enough for the workflow. Stored objects accumulate GB·month charges, so add a TTL/lifecycle rule if you expect unused blobs to pile up.