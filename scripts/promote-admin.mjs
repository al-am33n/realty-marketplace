// Promotes an existing account to the admin role.
//
//   npm run promote-admin -- someone@example.com
//
// Admin is deliberately NOT self-serve: the handle_new_user trigger refuses a
// client-supplied role of 'admin' at sign-up, and the
// guard_profile_privileged_fields trigger stops a signed-in user changing their
// own role. So promotion has to come from trusted server-side code — which is
// what this is. It needs SUPABASE_DB_URL, which only the operator has.
//
// Reports the before and after state rather than succeeding silently, so it is
// obvious exactly which account changed.
import pg from "pg";
import { loadEnv, connectDb } from "./lib/env.mjs";

const email = process.argv[2];

if (!email) {
  console.error("Usage: npm run promote-admin -- <email>");
  process.exit(1);
}

const { dbUrl } = loadEnv();
if (!dbUrl) {
  console.error("SUPABASE_DB_URL is required. See .env.example.");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
});
await connectDb(client, dbUrl);

try {
  const { rows: before } = await client.query(
    `select u.id,
            u.email,
            u.email_confirmed_at is not null as email_confirmed,
            p.role,
            p.verified
       from auth.users u
       left join public.profiles p on p.user_id = u.id
      where lower(u.email) = lower($1)`,
    [email]
  );

  if (before.length === 0) {
    console.error(`No account found for ${email}.`);
    console.error("The person has to sign up first — this only changes an existing profile.");
    process.exit(1);
  }

  if (!before[0].role) {
    console.error("That auth account has no profiles row, which should be impossible.");
    console.error("Check the handle_new_user trigger before going further.");
    process.exit(1);
  }

  console.log("Before:");
  console.table(before);

  if (before[0].role === "admin") {
    console.log(`\n${email} is already an admin. Nothing to do.`);
    process.exit(0);
  }

  // auth.uid() is null on a direct database connection, so
  // guard_profile_privileged_fields treats this as trusted server-side code and
  // allows the role change — the same route /auth/callback uses to set
  // `verified`. A signed-in user attempting this is refused by that trigger.
  const { rows: after } = await client.query(
    `update public.profiles
        set role = 'admin'
      where user_id = $1
      returning user_id, role, verified`,
    [before[0].id]
  );

  console.log("\nAfter:");
  console.table(after);

  const { rows: admins } = await client.query(
    `select u.email
       from public.profiles p
       join auth.users u on u.id = p.user_id
      where p.role = 'admin'
      order by u.email`
  );
  console.log("\nAll admins now:");
  console.table(admins);
} finally {
  await client.end();
}
