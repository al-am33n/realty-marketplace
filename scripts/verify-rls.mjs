// Functional RLS check through PostgREST — the same path a browser takes.
// Uses the ANON key, i.e. the key that ships to every visitor's device.
//
//   npm run verify:rls
import { loadEnv, makeChecker, keyHeaders } from "./lib/env.mjs";

const { url, anon, service } = loadEnv();
const { check, finish } = makeChecker();

const anonH = keyHeaders(anon);
const svcH = keyHeaders(service);

console.log("\nA. Anonymous visitor (anon key — public, ships to the browser)");

// No grant at all: these must be refused outright.
for (const table of ["profiles", "bookings", "deals", "payments", "auth_throttle"]) {
  const res = await fetch(`${url}/rest/v1/${table}?select=*`, { headers: anonH });
  const blocked = res.status === 401 || res.status === 403 || res.status === 404;
  check(`anon cannot read ${table}`, blocked, `HTTP ${res.status}`);
  if (res.status === 200) {
    console.log("        LEAKED body: " + (await res.text()).slice(0, 160));
  }
}

// Readable, but must return nothing while no listing is live.
for (const table of ["listings", "agents"]) {
  const res = await fetch(`${url}/rest/v1/${table}?select=*`, { headers: anonH });
  const body = await res.text();
  check(`anon may query ${table}`, res.status === 200, `HTTP ${res.status}`);
  check(`  ...and sees 0 rows`, body.trim() === "[]", `body ${body.slice(0, 60)}`);
}

// Writes must be refused.
const insertListing = await fetch(`${url}/rest/v1/listings`, {
  method: "POST",
  headers: anonH,
  body: JSON.stringify({
    owner_id: "00000000-0000-0000-0000-000000000000",
    title: "Anonymous injection attempt",
    type: "rent",
    property_type: "apartment",
    price_kobo: 1,
    location_text: "nowhere",
  }),
});
check("anon cannot INSERT a listing", insertListing.status >= 400, `HTTP ${insertListing.status}`);

const insertPayment = await fetch(`${url}/rest/v1/payments`, {
  method: "POST",
  headers: anonH,
  body: JSON.stringify({
    user_id: "00000000-0000-0000-0000-000000000000",
    purpose: "listing_fee",
    amount_kobo: 1,
    paystack_ref: "fake_" + Date.now(),
  }),
});
check("anon cannot INSERT a payment", insertPayment.status >= 400, `HTTP ${insertPayment.status}`);

console.log("\nB. Service role (server-only key — must bypass RLS)");
// Regression guard: BYPASSRLS skips policies but NOT grants. With Supabase's
// automatic table exposure off, service_role once had no grants at all and
// every admin-client query returned 403, silently breaking verification.
for (const table of ["profiles", "payments", "auth_throttle"]) {
  const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, { headers: svcH });
  check(`service role can read ${table}`, res.status === 200, `HTTP ${res.status}`);
}

console.log("\nC. Rate limiter");
const callLimiter = (key, max) =>
  fetch(`${url}/rest/v1/rpc/check_rate_limit`, {
    method: "POST",
    headers: svcH,
    body: JSON.stringify({ p_key: key, p_max_attempts: max, p_window: "5 minutes" }),
  });

const first = await callLimiter("selftest:" + Date.now(), 2);
check("check_rate_limit callable by service role", first.status === 200, `HTTP ${first.status}`);

const burstKey = "selftest-burst:" + Date.now();
const results = [];
for (let i = 0; i < 3; i += 1) {
  const res = await callLimiter(burstKey, 2);
  results.push((await res.text()).trim());
}
check(
  "3rd attempt against a limit of 2 is refused",
  results[0] === "true" && results[1] === "true" && results[2] === "false",
  `got [${results.join(", ")}]`
);

const anonLimiter = await fetch(`${url}/rest/v1/rpc/check_rate_limit`, {
  method: "POST",
  headers: anonH,
  body: JSON.stringify({ p_key: "x", p_max_attempts: 1, p_window: "1 minutes" }),
});
check("anon cannot call check_rate_limit", anonLimiter.status >= 400, `HTTP ${anonLimiter.status}`);

finish("FUNCTIONAL RLS");
