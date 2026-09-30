import express from "express";
import { createHash } from "node:crypto";
import { ZodError } from "zod";
import { selectExpiredRecords, sweepRequestSchema } from "./cleanup_policy.js";
import { InfraiError, infraiFromEnvironment } from "./infrai_client.js";

const bucket = process.env.RECORDS_BUCKET ?? "appointment-retention-records";
const port = Number(process.env.PORT ?? 3000);
const infrai = infraiFromEnvironment();
const app = express();

app.use(express.json({ limit: "256kb" }));

app.post("/sweeps/appointments", async (request, response) => {
  try {
    const input = sweepRequestSchema.parse(request.body);
    const decision = selectExpiredRecords(input);
    if (decision.keys.length > 0) {
      const idempotencyKey = createHash("sha256")
        .update(`${input.as_of}:${bucket}:${decision.keys.slice().sort().join("|")}`)
        .digest("hex");
      await infrai.storage.object.delete_batch(bucket, {
        keys: decision.keys,
        idempotency_key: idempotencyKey
      });
    }
    response.status(200).json({
      deleted_count: decision.keys.length,
      notifications: decision.notifications
    });
  } catch (error) {
    if (error instanceof ZodError) {
      response.status(400).json({ error: "invalid_sweep_request", issues: error.issues });
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      response.status(status).json({ error: error.code });
      return;
    }
    response.status(500).json({ error: "cleanup_failed" });
  }
});

await infrai.storage.bucket.create({ name: bucket });
app.listen(port, () => {
  console.log(`Appointment cleanup webhook listening on port ${port}`);
});
