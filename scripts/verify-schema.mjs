// Verifies the applied migrations by reading Postgres's own catalog.
// Read-only: every statement here is a SELECT.
//
//   npm run verify:schema
import pg from "pg";
import { loadEnv, makeChecker } from "./lib/env.mjs";

const { Client } = pg;
const { dbUrl } = loadEnv();

if (!dbUrl) {
  console.error(
    "SUPABASE_DB_URL is required for this script (it reads Postgres's catalog\n"
      + "directly rather than going through the REST API). See .env.example."
  );
  process.exit(1);
}

const CORE = ["profiles", "agents", "listings", "bookings", "deals", "payments"];
const ALL = [...CORE, "auth_throttle"];

const { check, finish } = makeChecker();

const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

// -- 1. tables exist ---------------------------------------------------------
console.log("\n1. Tables exist");
const { rows: tables } = await client.query(
  `select tablename from pg_tables where schemaname = 'public' order by tablename`
);
const names = tables.map((t) => t.tablename);
for (const t of ALL) {
  check(t, names.includes(t), names.includes(t) ? undefined : "MISSING");
}
const extra = names.filter((n) => !ALL.includes(n));
if (extra.length) console.log("  note: other tables present: " + extra.join(", "));

// -- 2. RLS enabled ----------------------------------------------------------
console.log("\n2. Row Level Security enabled on every table");
const { rows: rlsRows } = await client.query(
  `select c.relname, c.relrowsecurity
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname = any($1)
    order by c.relname`,
  [ALL]
);
for (const r of rlsRows) {
  check(`${r.relname} RLS`, r.relrowsecurity, r.relrowsecurity ? "on" : "OFF");
}

// -- 3. policies -------------------------------------------------------------
console.log("\n3. Policies per table");
const { rows: policyRows } = await client.query(
  `select tablename, count(*)::int as n from pg_policies
    where schemaname = 'public' group by tablename order by tablename`
);
const policyCount = Object.fromEntries(policyRows.map((p) => [p.tablename, p.n]));
for (const t of ALL) {
  const n = policyCount[t] ?? 0;
  if (t === "auth_throttle") {
    // Deliberately zero: RLS on with no policies means deny-all, so the table
    // is reachable only through the SECURITY DEFINER rate-limit function.
    check("auth_throttle has 0 policies (deny-all, intended)", n === 0, `got ${n}`);
  } else {
    check(`${t}: ${n} policies`, n > 0, n > 0 ? undefined : "NO POLICIES = deny-all");
  }
}

// -- 4. grants ---------------------------------------------------------------
console.log("\n4. Grants — anon should reach only listings + agents (SELECT)");
const { rows: grantRows } = await client.query(
  `select table_name, grantee,
          string_agg(distinct privilege_type, ',' order by privilege_type) as privs
     from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon','authenticated','service_role')
    group by table_name, grantee order by table_name, grantee`
);
const grants = {};
for (const r of grantRows) grants[`${r.table_name}:${r.grantee}`] = r.privs;

const anonExpected = { listings: "SELECT", agents: "SELECT" };
for (const t of ALL) {
  const got = grants[`${t}:anon`];
  const want = anonExpected[t];
  if (want) {
    check(`anon -> ${t}`, got === want, `got ${got || "none"}, want ${want}`);
  } else {
    check(`anon -> ${t}: no access`, !got, got ? `UNEXPECTED ${got}` : undefined);
  }
}

// service_role needs real grants too — BYPASSRLS skips policies, not privileges.
for (const t of ALL) {
  const got = grants[`${t}:service_role`] || "";
  check(`service_role -> ${t} can SELECT`, got.includes("SELECT"), `got ${got || "none"}`);
}

console.log("  authenticated grants:");
for (const t of ALL) {
  console.log(`    ${t.padEnd(15)} ${grants[`${t}:authenticated`] || "(none)"}`);
}

// -- 5. enums ----------------------------------------------------------------
console.log("\n5. Enum types");
const { rows: enums } = await client.query(
  `select t.typname, count(e.enumlabel)::int as n
     from pg_type t
     join pg_enum e on e.enumtypid = t.oid
     join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' group by t.typname order by t.typname`
);
console.log("  " + enums.map((e) => `${e.typname}(${e.n})`).join(", "));
// 9 from Phase 1, plus listing_mode (independent / platform_direct) in Phase 2.
check("10 enum types", enums.length === 10, `found ${enums.length}`);

// -- 6. triggers -------------------------------------------------------------
console.log("\n6. Triggers");
const { rows: triggers } = await client.query(
  `select c.relname as tbl, t.tgname
     from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal and n.nspname in ('public','auth')
    order by c.relname, t.tgname`
);
for (const t of triggers) console.log(`    ${t.tbl}.${t.tgname}`);
for (const needed of [
  "on_auth_user_created",
  "profiles_guard_privileged_fields",
  "agents_guard_privileged_fields",
  // Phase 2. The first stops an owner writing their own money fields or
  // changing the listing mode after submission; the second un-signs the
  // commission agreement when the mode changes.
  "listings_guard_privileged_fields",
  "listings_mode_change_effects",
]) {
  const present = triggers.some((t) => t.tgname === needed);
  check(needed, present, present ? undefined : "MISSING");
}

// -- 7. the NULL-array constraint bugs stay fixed ----------------------------
console.log("\n7. Array constraints guard against the NULL trap");
const { rows: constraints } = await client.query(
  `select conname, pg_get_constraintdef(oid) as def
     from pg_constraint
    where conname like '%requires_photos%' or conname like '%proposed_slots%'`
);
for (const c of constraints) {
  const guarded = /coalesce/i.test(c.def);
  check(`${c.conname} uses coalesce`, guarded, guarded ? undefined : c.def);
}

// Same trap, different column. `listing_mode = 'platform_direct'` is NULL — not
// false — when no mode has been chosen, and a CHECK only rejects FALSE, so
// without the coalesce an unpaid listing could slip into the review queue.
const { rows: feeConstraint } = await client.query(
  `select conname, pg_get_constraintdef(oid) as def
     from pg_constraint where conname = 'listings_review_requires_settled_fee'`
);
check(
  "the fee constraint exists",
  feeConstraint.length === 1,
  feeConstraint.length ? undefined : "MISSING"
);
if (feeConstraint.length === 1) {
  const guarded = /coalesce/i.test(feeConstraint[0].def);
  check(
    "listings_review_requires_settled_fee uses coalesce on listing_mode",
    guarded,
    guarded ? undefined : feeConstraint[0].def
  );
}

// -- 8. no recursive cross-table policies ------------------------------------
// The bug that made every signed-in query fail with 42P17. A policy expression
// runs as the querying user, so an inline subquery against another RLS-guarded
// table can loop forever. Cross-table checks must sit behind SECURITY DEFINER
// functions instead.
console.log("\n8. No policy queries another table inline");
const { rows: allPolicies } = await client.query(
  `select tablename, policyname,
          coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr
     from pg_policies where schemaname = 'public'`
);
const others = (self) => CORE.filter((t) => t !== self);
for (const p of allPolicies) {
  const offending = others(p.tablename).filter((t) =>
    new RegExp(`\\bfrom\\s+(public\\.)?${t}\\b`, "i").test(p.expr)
  );
  check(
    `${p.tablename} / ${p.policyname}`,
    offending.length === 0,
    offending.length ? `inline subquery on ${offending.join(", ")}` : undefined
  );
}

await client.end();
finish("SCHEMA CATALOG");
