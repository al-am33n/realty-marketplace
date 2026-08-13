// Phase 2 end-to-end test: listing lifecycle, fee waiver, admin moderation.
//
//   npm run verify:e2e2
//
// Creates its own users and listings and removes them afterwards, including on
// failure. It must never touch pre-existing accounts or listings — the cleanup
// only deletes ids this run created.
//
// The waiver test seeds the pool close to its cap and then restores it, because
// leaving stray waived rows behind would permanently eat into a real 50-listing
// subsidy.
import pg from "pg";
import { loadEnv, makeChecker, keyHeaders, userHeaders } from "./lib/env.mjs";

const { url, anon, service, dbUrl } = loadEnv();
const { check, finish } = makeChecker();

const svcH = keyHeaders(service);
const anonH = keyHeaders(anon);
const asUser = (token) => userHeaders(anon, token);

const stamp = Date.now();
const createdUserIds = [];
const createdListingIds = [];

const db = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function createUser(email, password, metadata) {
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: svcH,
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: metadata }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`createUser ${email}: ${res.status} ${JSON.stringify(body)}`);
  createdUserIds.push(body.id);
  // Verified is set by the auth callback in real use; do it directly here.
  await fetch(`${url}/rest/v1/profiles?user_id=eq.${body.id}`, {
    method: "PATCH",
    headers: svcH,
    body: JSON.stringify({ verified: true, verified_at: new Date().toISOString() }),
  });
  return body.id;
}

async function signIn(email, password) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`signIn ${email}: ${res.status} ${JSON.stringify(body)}`);
  return body.access_token;
}

/** A listing complete enough to leave draft, apart from the fee. */
async function createCompleteListing(ownerId, { status = "draft", feeWaived = false } = {}) {
  const res = await fetch(`${url}/rest/v1/listings`, {
    method: "POST",
    headers: { ...svcH, Prefer: "return=representation" },
    body: JSON.stringify({
      owner_id: ownerId,
      title: `Test listing ${stamp} ${createdListingIds.length}`,
      type: "rent",
      property_type: "apartment",
      price_kobo: 250000000,
      location_text: "Wuse 2, Abuja",
      lat: 9.0765,
      lng: 7.3986,
      images: ["a.jpg", "b.jpg", "c.jpg"],
      commission_clause_agreed_at: new Date().toISOString(),
      commission_clause_version: "v1",
      fee_waived: feeWaived,
      status,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`createListing: ${res.status} ${JSON.stringify(body)}`);
  createdListingIds.push(body[0].id);
  return body[0].id;
}

async function cleanup() {
  for (const id of createdListingIds) {
    await fetch(`${url}/rest/v1/listings?id=eq.${id}`, { method: "DELETE", headers: svcH }).catch(
      () => {}
    );
  }
  for (const id of createdUserIds) {
    await fetch(`${url}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: svcH }).catch(
      () => {}
    );
  }
}

const PASSWORD = "TestPass123";

try {
  await db.connect();

  // Record the real waiver count so we can assert we restored it at the end.
  const { rows: poolBefore } = await db.query(
    "select count(*)::int as n from public.listings where fee_waived"
  );
  const waiversBefore = poolBefore[0].n;

  console.log("\n1. Listing lifecycle: submit for review");
  const landlordEmail = `p2.landlord.${stamp}@example.com`;
  const landlordId = await createUser(landlordEmail, PASSWORD, {
    full_name: "Phase2 Landlord",
    role: "landlord",
  });
  const landlordToken = await signIn(landlordEmail, PASSWORD);

  // Incomplete listing: no fee settled yet.
  const incompleteId = await createCompleteListing(landlordId);

  const earlySubmit = await fetch(`${url}/rest/v1/listings?id=eq.${incompleteId}`, {
    method: "PATCH",
    headers: asUser(landlordToken),
    body: JSON.stringify({ status: "pending_review" }),
  });
  const earlyBody = await earlySubmit.text();
  check(
    "cannot submit with an unsettled listing fee",
    earlySubmit.status >= 400,
    `HTTP ${earlySubmit.status}`
  );
  check(
    "  ...blocked by the settled-fee constraint",
    /settled_fee/.test(earlyBody),
    earlyBody.slice(0, 110)
  );

  console.log("\n2. An owner cannot write the platform-controlled fields");
  // Regression guard. RLS restricts rows and statuses but NOT columns, so
  // before the guard trigger a landlord could PATCH fee_waived: true onto their
  // own listing and take a free listing whenever they liked. Confirmed against
  // the live API before the fix.
  for (const [field, payload] of [
    ["fee_waived", { fee_waived: true }],
    ["listing_fee_paid", { listing_fee_paid: true }],
    ["view_count", { view_count: 99999 }],
    ["published_at", { published_at: new Date().toISOString() }],
    ["booking_locked_at", { booking_locked_at: new Date().toISOString() }],
  ]) {
    const res = await fetch(`${url}/rest/v1/listings?id=eq.${incompleteId}`, {
      method: "PATCH",
      headers: asUser(landlordToken),
      body: JSON.stringify(payload),
    });
    check(`owner cannot set ${field}`, res.status >= 400, `HTTP ${res.status}`);
  }

  console.log("\n3. Fee waiver — basics");
  const claim = async (token, listingId) => {
    const res = await fetch(`${url}/rest/v1/rpc/claim_listing_fee_waiver`, {
      method: "POST",
      headers: token ? asUser(token) : svcH,
      body: JSON.stringify({ p_listing_id: listingId }),
    });
    return { status: res.status, body: await res.json() };
  };

  const first = await claim(landlordToken, incompleteId);
  check("owner can claim a waiver", first.status === 200 && first.body?.[0]?.granted === true,
    JSON.stringify(first.body)?.slice(0, 120));

  const again = await claim(landlordToken, incompleteId);
  check(
    "claiming twice is idempotent (no second waiver consumed)",
    again.body?.[0]?.granted === true && again.body?.[0]?.reason === "already_waived",
    JSON.stringify(again.body)?.slice(0, 120)
  );

  // A different user must not be able to waive someone else's listing.
  const otherEmail = `p2.other.${stamp}@example.com`;
  const otherId = await createUser(otherEmail, PASSWORD, {
    full_name: "Someone Else",
    role: "landlord",
  });
  const otherToken = await signIn(otherEmail, PASSWORD);
  const stolen = await claim(otherToken, incompleteId);
  check(
    "a stranger cannot claim a waiver on someone else's listing",
    stolen.body?.[0]?.granted === false && stolen.body?.[0]?.reason === "not_owner",
    JSON.stringify(stolen.body)?.slice(0, 120)
  );

  console.log("\n3. Fee waiver — one open draft waiver per owner");
  const secondDraft = await createCompleteListing(landlordId);
  const secondClaim = await claim(landlordToken, secondDraft);
  check(
    "cannot hold two waived drafts at once (anti-drain guard)",
    secondClaim.body?.[0]?.granted === false
      && secondClaim.body?.[0]?.reason === "owner_has_open_waiver",
    JSON.stringify(secondClaim.body)?.slice(0, 140)
  );

  console.log("\n4. Now submit the waived listing for review");
  const submit = await fetch(`${url}/rest/v1/listings?id=eq.${incompleteId}`, {
    method: "PATCH",
    headers: { ...asUser(landlordToken), Prefer: "return=representation" },
    body: JSON.stringify({ status: "pending_review" }),
  });
  const submitBody = await submit.json();
  check("waived listing CAN be submitted", submit.status === 200, `HTTP ${submit.status}`);
  check("  ...status is pending_review", submitBody?.[0]?.status === "pending_review");

  const ownerPublish = await fetch(`${url}/rest/v1/listings?id=eq.${incompleteId}`, {
    method: "PATCH",
    headers: asUser(landlordToken),
    body: JSON.stringify({ status: "live" }),
  });
  check(
    "owner still cannot publish their own listing",
    ownerPublish.status >= 400,
    `HTTP ${ownerPublish.status}`
  );

  console.log("\n5. Admin moderation");
  const adminEmail = `p2.admin.${stamp}@example.com`;
  const adminId = await createUser(adminEmail, PASSWORD, {
    full_name: "Phase2 Admin",
    role: "renter_buyer",
  });
  await db.query("update public.profiles set role='admin' where user_id=$1", [adminId]);
  const adminToken = await signIn(adminEmail, PASSWORD);

  const queue = await fetch(
    `${url}/rest/v1/listings?status=eq.pending_review&select=id`,
    { headers: asUser(adminToken) }
  );
  const queueRows = await queue.json();
  check(
    "admin sees the pending listing in the queue",
    Array.isArray(queueRows) && queueRows.some((r) => r.id === incompleteId),
    `saw ${Array.isArray(queueRows) ? queueRows.length : "?"} pending`
  );

  const nonAdminQueue = await fetch(
    `${url}/rest/v1/listings?status=eq.pending_review&select=id`,
    { headers: asUser(otherToken) }
  );
  const nonAdminRows = await nonAdminQueue.json();
  check(
    "a non-admin sees nothing in the queue",
    Array.isArray(nonAdminRows) && nonAdminRows.length === 0,
    `saw ${nonAdminRows.length}`
  );

  // Reject with a reason.
  const reject = await fetch(`${url}/rest/v1/listings?id=eq.${incompleteId}`, {
    method: "PATCH",
    headers: { ...asUser(adminToken), Prefer: "return=representation" },
    body: JSON.stringify({
      status: "rejected",
      rejection_reason: "The photos show a different property from the one described.",
    }),
  });
  const rejectBody = await reject.json();
  check("admin can reject with a reason", reject.status === 200, `HTTP ${reject.status}`);
  check("  ...status is rejected", rejectBody?.[0]?.status === "rejected");

  const rejectNoReason = await fetch(`${url}/rest/v1/listings?id=eq.${secondDraft}`, {
    method: "PATCH",
    headers: asUser(adminToken),
    body: JSON.stringify({ status: "rejected" }),
  });
  check(
    "rejecting without a reason is refused by the database",
    rejectNoReason.status >= 400,
    `HTTP ${rejectNoReason.status}`
  );

  // Owner sees the reason and can fix + resubmit.
  const ownerView = await fetch(
    `${url}/rest/v1/listings?id=eq.${incompleteId}&select=rejection_reason,status`,
    { headers: asUser(landlordToken) }
  );
  const ownerRows = await ownerView.json();
  check(
    "owner can read the rejection reason",
    ownerRows?.[0]?.rejection_reason?.includes("different property"),
    JSON.stringify(ownerRows?.[0])?.slice(0, 120)
  );

  const resubmit = await fetch(`${url}/rest/v1/listings?id=eq.${incompleteId}`, {
    method: "PATCH",
    headers: { ...asUser(landlordToken), Prefer: "return=representation" },
    body: JSON.stringify({ status: "pending_review", rejection_reason: null }),
  });
  check("owner can fix and resubmit after rejection", resubmit.status === 200,
    `HTTP ${resubmit.status}`);

  // Approve.
  const approve = await fetch(`${url}/rest/v1/listings?id=eq.${incompleteId}`, {
    method: "PATCH",
    headers: { ...asUser(adminToken), Prefer: "return=representation" },
    body: JSON.stringify({ status: "live", published_at: new Date().toISOString() }),
  });
  const approveBody = await approve.json();
  check("admin can approve to live", approve.status === 200, `HTTP ${approve.status}`);
  check("  ...status is live", approveBody?.[0]?.status === "live");

  const publicView = await fetch(`${url}/rest/v1/listings?select=id`, { headers: anonH });
  const publicRows = await publicView.json();
  check(
    "the approved listing is NOW publicly visible",
    Array.isArray(publicRows) && publicRows.some((r) => r.id === incompleteId),
    `anon sees ${publicRows.length} live`
  );

  console.log("\n6. Fee waiver — the race the advisory lock exists to prevent");
  // Seed the pool to one below its cap, then have several owners claim at the
  // same instant. Without serialisation they would all read the same count and
  // all be granted; exactly one must win.
  const { rows: capRow } = await db.query("select waiver_cap from public.listing_fee_waiver_status()");
  const cap = capRow[0].waiver_cap;
  const { rows: usedRow } = await db.query(
    "select count(*)::int as n from public.listings where fee_waived"
  );
  const toSeed = cap - 1 - usedRow[0].n;

  const fillerIds = [];
  for (let i = 0; i < toSeed; i++) {
    // status 'closed' so these do not sit in the owner's open-draft slot and do
    // not appear in the public listing or the review queue.
    fillerIds.push(await createCompleteListing(otherId, { status: "closed", feeWaived: true }));
  }

  const { rows: nowUsed } = await db.query(
    "select count(*)::int as n from public.listings where fee_waived"
  );
  check(`pool seeded to ${cap - 1} used`, nowUsed[0].n === cap - 1, `is ${nowUsed[0].n}`);

  // Five owners, five listings, five simultaneous claims, one waiver left.
  const racers = [];
  for (let i = 0; i < 5; i++) {
    const email = `p2.race${i}.${stamp}@example.com`;
    const uid = await createUser(email, PASSWORD, { full_name: `Racer ${i}`, role: "landlord" });
    const token = await signIn(email, PASSWORD);
    const listingId = await createCompleteListing(uid);
    racers.push({ token, listingId });
  }

  const raceResults = await Promise.all(
    racers.map((r) => claim(r.token, r.listingId))
  );
  const grantedCount = raceResults.filter((r) => r.body?.[0]?.granted === true).length;
  const exhausted = raceResults.filter((r) => r.body?.[0]?.reason === "pool_exhausted").length;

  check(
    "exactly ONE of 5 simultaneous claims is granted",
    grantedCount === 1,
    `granted=${grantedCount}, pool_exhausted=${exhausted}`
  );

  const { rows: finalUsed } = await db.query(
    "select count(*)::int as n from public.listings where fee_waived"
  );
  check(
    `waiver pool never exceeds its cap of ${cap}`,
    finalUsed[0].n === cap,
    `is ${finalUsed[0].n}`
  );

  // Must retry a racer that LOST. Retrying the winner would return
  // "already_waived" — correct behaviour, but not what this check is about.
  const loserIndex = raceResults.findIndex((r) => r.body?.[0]?.granted !== true);
  const overCap = await claim(racers[loserIndex].token, racers[loserIndex].listingId);
  check(
    "further claims are refused once the pool is exhausted",
    overCap.body?.[0]?.granted === false && overCap.body?.[0]?.reason === "pool_exhausted",
    JSON.stringify(overCap.body)?.slice(0, 120)
  );

  console.log("\n7. Cleanup");
  await cleanup();
  createdListingIds.length = 0;
  createdUserIds.length = 0;

  const { rows: poolAfter } = await db.query(
    "select count(*)::int as n from public.listings where fee_waived"
  );
  check(
    "waiver pool restored to its pre-test value",
    poolAfter[0].n === waiversBefore,
    `was ${waiversBefore}, now ${poolAfter[0].n}`
  );

  const { rows: leftover } = await db.query(
    "select count(*)::int as n from public.listings where title like $1",
    [`Test listing ${stamp}%`]
  );
  check("no test listings left behind", leftover[0].n === 0, `${leftover[0].n} remain`);

  finish("PHASE 2 END-TO-END");
} catch (error) {
  console.error("\nERROR: " + error.message);
  await cleanup();
  process.exit(1);
} finally {
  await db.end().catch(() => {});
}
