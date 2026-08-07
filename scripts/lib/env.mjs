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
