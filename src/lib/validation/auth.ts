import { z } from "zod";

/**
 * Validation schemas for the auth forms.
 *
 * These run on the SERVER, inside Server Actions. The browser may also use them
 * for instant feedback, but the server check is the one that counts:
 * client-side validation is a convenience for honest users and no obstacle at
 * all to a dishonest one, who can simply send a request straight to the API.
 *
 * CLAUDE.md: "Validate all input server-side (never trust client-side
 * validation alone), using a schema library (Zod)."
 */

/** Roles a person may choose at sign-up. 'admin' is deliberately absent — it is
 *  granted manually in the database, and the handle_new_user trigger rejects it
 *  even if someone forges the request. */
export const SIGNUP_ROLES = ["renter_buyer", "landlord", "agent"] as const;
export type SignupRole = (typeof SIGNUP_ROLES)[number];

/**
 * Normalises a Nigerian phone number to E.164 format (+234...).
 *
 * People write their number every which way — 0803 123 4567, 08031234567,
 * +234 803 123 4567, 234-803-123-4567. Storing one canonical form means a
 * lookup works regardless of how it was typed, and it is the format an SMS
 * provider will expect when phone OTP is switched on later.
 */
export function normalizeNigerianPhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "");

  // 0803... (11 digits, local format)
  if (/^0\d{10}$/.test(digits)) return `+234${digits.slice(1)}`;
  // 234803... (13 digits, no plus)
  if (/^234\d{10}$/.test(digits)) return `+${digits}`;
  // +234803...
  if (/^\+234\d{10}$/.test(digits)) return digits;
  // 803... (10 digits, leading zero omitted)
  if (/^[789]\d{9}$/.test(digits)) return `+234${digits}`;

  return null;
}

const phoneField = z
  .string()
  .trim()
  .min(1, "Enter your phone number")
  .transform((value, ctx) => {
    const normalized = normalizeNigerianPhone(value);
    if (!normalized) {
      ctx.addIssue({
        code: "custom",
        // Plain language with a concrete example — per the UI spec's
        // accessibility rule that errors explain rather than just reject.
        message: "Enter a valid Nigerian phone number, for example 0803 123 4567",
      });
      return z.NEVER;
    }
    return normalized;
  });

const passwordField = z
  .string()
  .min(8, "Your password must be at least 8 characters")
  .max(72, "Your password must be 72 characters or fewer")
  // 72 is not arbitrary: bcrypt, which Supabase uses to hash passwords, ignores
  // anything past 72 bytes. Rejecting longer input is honest about the limit
  // rather than silently truncating it.
  .refine((value) => /[a-zA-Z]/.test(value) && /\d/.test(value), {
    message: "Include at least one letter and one number",
  });

export const signupSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Enter your full name")
    .max(80, "That name is too long"),
  email: z.email("Enter a valid email address").toLowerCase().trim(),
  phone: phoneField,
  password: passwordField,
  role: z.enum(SIGNUP_ROLES, {
    message: "Choose how you'll be using Realty Marketplace",
  }),
});

export const loginSchema = z.object({
  email: z.email("Enter a valid email address").toLowerCase().trim(),
  // No strength rules on login: the password was validated when it was set, and
  // applying rules here would tell an attacker which passwords are impossible.
  password: z.string().min(1, "Enter your password"),
  next: z.string().optional(),
});

export const otpSchema = z.object({
  token: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code we sent you"),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Shape returned by every auth Server Action, so the forms can render results
 * consistently.
 *
 * `fieldErrors` places a message next to the specific input it belongs to,
 * which the UI spec requires: "Form errors are shown in plain language next to
 * the specific field, not just a generic 'something went wrong' banner."
 */
export type AuthFormState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
  /** Values to re-populate the form with, so a failed submit doesn't wipe it.
   *  Passwords are never echoed back. */
  values?: Record<string, string>;
};

/** Turns a Zod failure into the flat shape the forms expect. */
export function toFieldErrors(error: z.ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    (result[key] ??= []).push(issue.message);
  }
  return result;
}
