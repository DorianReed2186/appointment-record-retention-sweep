import { z } from "zod";
import { infraiFromEnvironment } from "./infrai_client.js";

const task = z.string().url().parse(process.env.SWEEP_WEBHOOK_URL);
const infrai = infraiFromEnvironment();
const result = await infrai.cron.create({
  cron_expr: "0 2 * * *",
  task
});

console.log(JSON.stringify({ scheduled: true, job_id: result.job_id }, null, 2));
