// Shared environment loader for the verification scripts.
//
// These scripts run standalone with plain `node`, outside Next.js, so they
// cannot use src/lib/env.ts — nothing has loaded .env.local for them. This
// reads the file directly.
import fs from "node:fs";
import path from "node:path";

const ENV_PATH = path.join(import.meta.dirname, "..", "..", ".env.local");

export function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) {
    console.error(
      "No .env.local found.\n"
        + "Copy .env.example to .env.local and fill in your Supabase values."
    );
    process.exit(1);
  }

  const text = fs.readFileSync(ENV_PATH, "utf8");
  const read = (key) => {
    const line = text.split("\n").find((l) => l.trim().startsWith(key + "="));
    if (!line) return "";
    return line.trim().slice(key.length + 1).replace(/^["']|["']$/g, "");
  };

  const env = {
    url: read("NEXT_PUBLIC_SUPABASE_URL"),
    anon: read("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    service: read("SUPABASE_SERVICE_ROLE_KEY"),
    // Optional: only the schema-catalog script needs a direct Postgres
    // connection. The others go through the REST API.
    dbUrl: read("SUPABASE_DB_URL"),
  };

  for (const key of ["url", "anon", "service"]) {
    if (!env[key]) {
      console.error(`Missing ${key} in .env.local`);
      process.exit(1);
    }
  }
  return env;
}

/**
 * Minimal assertion helper shared by the scripts.
 *
 * Tracks failures so a script can exit non-zero, which is what makes these
 * usable as a gate before merging a phase.
 */
export function makeChecker() {
  let failures = 0;

  function check(label, ok, detail) {
    const prefix = ok ? "  PASS  " : "  FAIL  ";
    console.log(prefix + label + (detail ? " — " + detail : ""));
    if (!ok) failures += 1;
  }

  function finish(title) {
    if (failures === 0) {
      console.log(`\n${title}: ALL CHECKS PASSED`);
      process.exit(0);
    }
    console.log(`\n${failures} CHECK(S) FAILED`);
    process.exit(1);
  }

  return { check, finish };
}

/** Auth headers for a Supabase API key (anon or service role). */
export function keyHeaders(key) {
  return {
    apikey: key,
    Authorization: "Bearer " + key,
    "Content-Type": "application/json",
  };
}

/** Auth headers for acting AS a signed-in user, using their access token. */
export function userHeaders(anonKey, accessToken) {
  return {
    apikey: anonKey,
    Authorization: "Bearer " + accessToken,
    "Content-Type": "application/json",
  };
}

/**
 * Opens a direct Postgres connection, turning the two failures that actually
 * happen into a sentence rather than a stack trace.
 *
 * A free-tier Supabase project is PAUSED after about a week with no traffic,
 * and pausing tears down its hostname entirely — so the first sign of it is
 * `ENOTFOUND`, or a `tenant/user ... not found` error from the pooler. Neither
 * of those reads as "your project is asleep, go and press Restore", which is
 * what it means and the only thing to do about it.
 */
export async function connectDb(client, dbUrl) {
  try {
    await client.connect();
  } catch (error) {
    const text = String(error?.message ?? error);
    const host = (() => {
      try {
        return new URL(dbUrl ?? "").hostname;
      } catch {
        return "your database host";
      }
    })();

    if (
      error?.code === "ENOTFOUND"
      || text.includes("ENOTFOUND")
      || text.includes("tenant/user")
      || text.includes("not found")
    ) {
      console.error(
        "\nCannot reach the database at " + host + ".\n\n"
          + "The most likely reason is that the Supabase project is PAUSED. Free-tier\n"
          + "projects pause after about a week without traffic, and a paused project's\n"
          + "hostname stops resolving altogether — which is why this looks like the\n"
          + "server does not exist rather than like it is asleep.\n\n"
          + "To fix it: open dashboard.supabase.com, choose this project, and click\n"
          + "Restore. It takes a couple of minutes. Then run this command again.\n\n"
          + "If the project was deleted rather than paused, create a new one, put its\n"
          + "values in .env.local, and run `npm run db:push` before verifying.\n"
      );
      process.exit(1);
    }

    if (text.includes("password authentication failed")) {
      console.error(
        "\nThe database rejected the password in SUPABASE_DB_URL.\n"
          + "Dashboard -> Project Settings -> Database -> Connection string -> URI,\n"
          + "then replace [YOUR-PASSWORD] with your database password.\n"
      );
      process.exit(1);
    }

    throw error;
  }
}

/**
 * Confirms the REST API is up before a script starts making assertions.
 *
 * Without this, a paused project produces dozens of confusing FAIL lines —
 * every check "fails" because nothing answered, which reads like dozens of
 * separate bugs instead of one sleeping server.
 */
export async function requireApiReachable(url) {
  try {
    const res = await fetch(url + "/auth/v1/health", {
      signal: AbortSignal.timeout(15000),
    });
    if (res.status >= 500) throw new Error("HTTP " + res.status);
  } catch {
    console.error(
      "\nCannot reach the Supabase API at " + url + ".\n\n"
        + "The most likely reason is that the project is PAUSED — free-tier projects\n"
        + "pause after about a week without traffic. Open dashboard.supabase.com,\n"
        + "choose this project, click Restore, wait a couple of minutes, and run this\n"
        + "again.\n"
    );
    process.exit(1);
  }
}
