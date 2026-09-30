import { z } from "zod";

export const sweepRequestSchema = z.object({
  as_of: z.string().datetime(),
  retention_days: z.number().int().positive().max(3650),
  appointments: z.array(z.object({
    appointment_ref: z.string().min(1),
    status: z.enum(["scheduled", "completed", "cancelled", "no_show"]),
    ended_at: z.string().datetime().nullable(),
    object_key: z.string().min(1)
  })).max(500)
});

export type SweepRequest = z.infer<typeof sweepRequestSchema>;

export type CleanupDecision = {
  keys: string[];
  notifications: Array<{
    appointment_ref: string;
    event: "retention_cleanup_completed";
    message: string;
  }>;
};

export function selectExpiredRecords(input: SweepRequest): CleanupDecision {
  const cutoff = new Date(input.as_of).getTime() - input.retention_days * 86_400_000;
  const terminal = new Set(["completed", "cancelled", "no_show"]);
  const stale = input.appointments.filter((appointment) =>
    terminal.has(appointment.status) &&
    appointment.ended_at !== null &&
    new Date(appointment.ended_at).getTime() <= cutoff
  );

  return {
    keys: stale.map((appointment) => appointment.object_key),
    notifications: stale.map((appointment) => ({
      appointment_ref: appointment.appointment_ref,
      event: "retention_cleanup_completed",
      message: "An appointment record completed its configured retention period."
    }))
  };
}
