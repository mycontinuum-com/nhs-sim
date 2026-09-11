import { z } from "zod";

export function normalizeTeamName(value: string): string {
  return value.toLowerCase().replace(/\s/gu, "");
}

export const teamNameSchema = z.string().transform(normalizeTeamName).pipe(z.string().min(2).max(80));
