import assert from "node:assert/strict";
import test from "node:test";
import { selectExpiredRecords, sweepRequestSchema } from "../src/cleanup_policy.js";

test("deletes only terminal appointments beyond retention", () => {
  const input = sweepRequestSchema.parse({
    as_of: "2026-09-29T00:00:00.000Z",
    retention_days: 30,
    appointments: [
      {
        appointment_ref: "apt-old-complete",
        status: "completed",
        ended_at: "2026-08-01T00:00:00.000Z",
        object_key: "appointments/old-complete.json"
      },
      {
        appointment_ref: "apt-recent-cancel",
        status: "cancelled",
        ended_at: "2026-09-20T00:00:00.000Z",
        object_key: "appointments/recent-cancel.json"
      },
      {
        appointment_ref: "apt-still-scheduled",
        status: "scheduled",
        ended_at: "2026-07-01T00:00:00.000Z",
        object_key: "appointments/still-scheduled.json"
      }
    ]
  });

  const decision = selectExpiredRecords(input);

  assert.deepEqual(decision.keys, ["appointments/old-complete.json"]);
  assert.deepEqual(decision.notifications.map((item) => item.appointment_ref), [
    "apt-old-complete"
  ]);
});
