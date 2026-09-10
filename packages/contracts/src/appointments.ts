import { z } from "zod";
export const appointmentSessionSchema = z.object({
  clinician: z.string().trim().min(1).max(100),
  location: z.string().trim().min(1).max(100),
  startsAt: z.number().int().nonnegative(),
  endsAt: z.number().int().nonnegative(),
  slotMinutes: z.number().int().min(5).max(120),
  mode: z.enum(["in-person", "telephone", "video", "online"]),
  blockedSlots: z.array(z.object({ startsAt: z.number().int().nonnegative(), reason: z.string().trim().min(1).max(500) })).default([]),
}).superRefine((value, context) => {
  const duration = value.endsAt - value.startsAt;
  if (duration <= 0 || duration > 24 * 60 * 60000 || duration % (value.slotMinutes * 60000))
    context.addIssue({ code: "custom", path: ["endsAt"], message: "Session must contain whole slots and last no more than 24 hours" });
});
export type AppointmentSession = z.infer<typeof appointmentSessionSchema>;
export const occupiesAppointmentSlot = (status: string) => !["cancelled", "rejected"].includes(status);
