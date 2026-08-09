// Applies pending migrations to the remote database.
//
//   npm run db:push              apply pending migrations
//   npm run db:push -- --dry-run list what WOULD be applied
//
// Wraps `supabase db push`, reading SUPABASE_DB_URL from .env.local so it does
// not have to be exported into the shell first.
//
// Note a dry run checks migration HISTORY only — it does not parse or execute
// the SQL, so syntax errors surface on the real push.
//
// Child output is filtered so the database password can never be echoed into a
// terminal log if the CLI prints the connection string in an error.
import { spawn } from "node:child_process";
import { loadEnv } from "./lib/env.mjs";

const { dbUrl } = loadEnv();

if (!dbUrl) {
  console.error(
    "SUPABASE_DB_URL is not set in .env.local.\n"
      + "Dashboard → Project Settings → Database → Connection string → URI (Session pooler)."
  );
  process.exit(1);
}

const args = ["supabase", "db", "push", "--db-url", dbUrl, ...process.argv.slice(2)];
const child = spawn("npx", args, { stdio: ["inherit", "pipe", "pipe"] });

const redact = (chunk) =>
  chunk.toString().replace(/(postgres(ql)?:\/\/[^:]+:)[^@]*@/g, "$1***REDACTED***@");

child.stdout.on("data", (chunk) => process.stdout.write(redact(chunk)));
child.stderr.on("data", (chunk) => process.stderr.write(redact(chunk)));
child.on("close", (code) => process.exit(code ?? 1));
