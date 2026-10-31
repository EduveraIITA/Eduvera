import { z } from "zod";

const desiredNamePart = z.string().trim().max(150).refine(value => !/\p{Cc}/u.test(value), "Use a name without control characters.");

/** Account labels do not correct or link a canonical campus person. */
export const accountProfileChangeSchema = z.object({
  first_name: desiredNamePart,
  last_name: desiredNamePart,
  // Compare legacy values exactly, including their original spacing. PostgreSQL
  // permits 150 Unicode characters, which may occupy 300 JavaScript code units.
  expected_first_name: z.string().max(300),
  expected_last_name: z.string().max(300),
}).strict().refine(value => Boolean(value.first_name || value.last_name), "Enter your account name.");
