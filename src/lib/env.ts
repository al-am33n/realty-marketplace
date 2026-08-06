import { z } from "zod";

/**
 * Environment variable validation.
 *
 * An environment variable is a setting supplied to the app from outside the
 * code — API keys, database URLs. They live in `.env.local` (never committed)
 * in development, and in the hosting dashboard in production.
 *
 * Without validation, a missing or misspelled variable surfaces much later as a
 * confusing runtime crash ("cannot read property of undefined"). Checking them
 * once, here, means the app fails immediately with a message that says exactly
 * what is wrong.
 *
 * ---------------------------------------------------------------------------
 * THE KEY SPLIT — the most important security boundary in the project.
 *
 *   NEXT_PUBLIC_*        Anything with this prefix is baked into the JavaScript
 *                        sent to the browser. Treat it as fully public. The
 *                        Supabase anon/publishable key belongs here: it is safe
 *                        precisely BECAUSE the RLS policies constrain what it
 *                        can read or write.
 *
 *   SUPABASE_SERVICE_ROLE_KEY
 *                        BYPASSES RLS COMPLETELY. It can read every user's
 *                        phone number and rewrite any payment record. It has no
 *                        NEXT_PUBLIC_ prefix, so Next.js will not send it to the
 *                        browser — and `serverEnv()` below throws if anything
 *                        tries to read it from client-side code.
 * ---------------------------------------------------------------------------
 */

/** Variables that are safe in the browser. */
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .url("NEXT_PUBLIC_SUPABASE_URL must be a full URL, e.g. https://abcdefgh.supabase.co"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(20, "NEXT_PUBLIC_SUPABASE_ANON_KEY looks too short to be a real key"),
  NEXT_PUBLIC_SITE_URL: z
    .url("NEXT_PUBLIC_SITE_URL must be a full URL, e.g. http://localhost:3000")
    .default("http://localhost:3000"),
});

/** Server-only variables. Never reference these from a Client Component. */
const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(20, "SUPABASE_SERVICE_ROLE_KEY looks too short to be a real key"),
});

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  • ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
}

/**
 * Note the variables are written out longhand rather than looped over.
 * Next.js replaces `process.env.NEXT_PUBLIC_X` with its literal value at build
 * time by scanning the source text — a dynamic lookup like `process.env[name]`
 * would not be substituted and would arrive as undefined in the browser.
 */
const parsedPublic = publicSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
});

if (!parsedPublic.success) {
  throw new Error(
    "Missing or invalid environment variables.\n"
      + formatIssues(parsedPublic.error)
      + "\n\nCopy .env.example to .env.local and fill in the values from your "
      + "Supabase project dashboard (Project Settings → API).\n"
  );
}

export const env = parsedPublic.data;

/**
 * Reads the server-only variables. Call this inside route handlers, Server
 * Actions and webhooks — never at the top level of a shared module, or the
 * check would also run during the client build.
 */
export function serverEnv() {
  if (typeof window !== "undefined") {
    throw new Error(
      "serverEnv() was called in the browser. The service role key must never "
        + "reach client-side code."
    );
  }

  const parsed = serverSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });

  if (!parsed.success) {
    throw new Error(
      "Missing or invalid server environment variables.\n" + formatIssues(parsed.error)
    );
  }

  return parsed.data;
}
