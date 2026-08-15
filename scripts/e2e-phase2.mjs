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
async function createCompleteListing(
  ownerId,
  { status = "draft", feeWaived = false, listingMode = "independent", type = "rent" } = {}
) {
  const res = await fetch(`${url}/rest/v1/listings`, {
    method: "POST",
    headers: { ...svcH, Prefer: "return=representation" },
    body: JSON.stringify({
      owner_id: ownerId,
      title: `Test listing ${stamp} ${createdListingIds.length}`,
      type,
      listing_mode: listingMode,
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

  console.log("\n7. Payment recording is idempotent");
  // Paystack delivers the same webhook more than once — on timeout, on a
  // non-2xx response, sometimes just because an ack was slow. A handler that
  // checks "already processed?" and then writes has a window where two
  // simultaneous deliveries both see "no". record_listing_fee_payment does it
  // in one statement so that window does not exist.
  const payUserEmail = `p2.payer.${stamp}@example.com`;
  const payUserId = await createUser(payUserEmail, PASSWORD, {
    full_name: "Paying Landlord",
    role: "landlord",
  });
  const payListingId = await createCompleteListing(payUserId);
  const ref = `listing_${payListingId}_${stamp}`;

  const recordPayment = () =>
    fetch(`${url}/rest/v1/rpc/record_listing_fee_payment`, {
      method: "POST",
      headers: svcH,
      body: JSON.stringify({
        p_paystack_ref: ref,
        p_user_id: payUserId,
        p_listing_id: payListingId,
        p_amount_kobo: 500000,
        p_payload: { event: "charge.success", test: true },
      }),
    }).then(async (r) => ({ status: r.status, body: await r.json() }));

  const firstDelivery = await recordPayment();
  check(
    "first delivery is processed",
    firstDelivery.body?.[0]?.newly_processed === true,
    JSON.stringify(firstDelivery.body)?.slice(0, 120)
  );

  const paidRow = await fetch(
    `${url}/rest/v1/listings?id=eq.${payListingId}&select=listing_fee_paid`,
    { headers: svcH }
  ).then((r) => r.json());
  check("  ...and marks the listing fee paid", paidRow?.[0]?.listing_fee_paid === true);

  // Fire several duplicates at once, exactly as a retry storm would.
  const duplicates = await Promise.all([recordPayment(), recordPayment(), recordPayment()]);
  const reprocessed = duplicates.filter((d) => d.body?.[0]?.newly_processed === true).length;
  check(
    "3 duplicate deliveries are all recognised as duplicates",
    reprocessed === 0,
    `${reprocessed} were wrongly reprocessed`
  );

  const paymentRows = await fetch(
    `${url}/rest/v1/payments?paystack_ref=eq.${ref}&select=id,amount_kobo,status`,
    { headers: svcH }
  ).then((r) => r.json());
  check(
    "exactly ONE payment row exists for the reference",
    Array.isArray(paymentRows) && paymentRows.length === 1,
    `${Array.isArray(paymentRows) ? paymentRows.length : "?"} rows`
  );
  check("  ...recorded as success", paymentRows?.[0]?.status === "success");

  // A signed-in user must never be able to mark their own fee paid.
  const payerToken = await signIn(payUserEmail, PASSWORD);
  const selfRecord = await fetch(`${url}/rest/v1/rpc/record_listing_fee_payment`, {
    method: "POST",
    headers: asUser(payerToken),
    body: JSON.stringify({
      p_paystack_ref: `forged_${stamp}`,
      p_user_id: payUserId,
      p_listing_id: payListingId,
      p_amount_kobo: 500000,
      p_payload: {},
    }),
  });
  check(
    "a signed-in user cannot record a payment themselves",
    selfRecord.status >= 400,
    `HTTP ${selfRecord.status}`
  );

  // Clean up the payment row directly — it is not covered by listing cleanup.
  await fetch(`${url}/rest/v1/payments?paystack_ref=eq.${ref}`, {
    method: "DELETE",
    headers: svcH,
  });

  // -------------------------------------------------------------------------
  // Platform-Direct mode.
  //
  // The mode decides whether money is owed at all, so every rule around it is
  // checked here against the live database rather than trusted from the SQL.
  // Phase 1 and Phase 2 both produced bugs that looked correct in the migration
  // and were only visible when a real request hit them.
  // -------------------------------------------------------------------------
  console.log("\n8. Platform-Direct listings");

  const pdEmail = `p2.pd.${stamp}@example.com`;
  const pdOwnerId = await createUser(pdEmail, PASSWORD, {
    full_name: "PD Landlord",
    role: "landlord",
  });
  const pdToken = await signIn(pdEmail, PASSWORD);

  // A Platform-Direct listing pays no fee, so it must be able to reach review
  // with listing_fee_paid and fee_waived both false — the case the original
  // fee constraint would have blocked outright.
  const pdListingId = await createCompleteListing(pdOwnerId, {
    listingMode: "platform_direct",
    type: "sale",
  });
  const pdSubmit = await fetch(`${url}/rest/v1/listings?id=eq.${pdListingId}`, {
    method: "PATCH",
    headers: { ...asUser(pdToken), Prefer: "return=representation" },
    body: JSON.stringify({ status: "pending_review" }),
  });
  check(
    "a Platform-Direct listing reaches review with no fee paid and none waived",
    pdSubmit.ok,
    `HTTP ${pdSubmit.status}`
  );

  // Sales only to start. A rental must be refused by the database, not merely
  // hidden by the form.
  const pdRental = await fetch(`${url}/rest/v1/listings`, {
    method: "POST",
    headers: { ...svcH, Prefer: "return=representation" },
    body: JSON.stringify({
      owner_id: pdOwnerId,
      title: `Test listing ${stamp} pd-rental`,
      type: "rent",
      listing_mode: "platform_direct",
      property_type: "apartment",
      price_kobo: 250000000,
      location_text: "Wuse 2, Abuja",
      status: "draft",
    }),
  });
  check(
    "a rental cannot be Platform-Direct",
    pdRental.status >= 400,
    `HTTP ${pdRental.status}`
  );
  if (pdRental.ok) {
    const created = await pdRental.json();
    createdListingIds.push(created[0].id);
  }

  // A listing may not enter review with no mode chosen — the commercial terms
  // would be blank in front of the reviewer.
  const noModeId = await createCompleteListing(pdOwnerId, { listingMode: null });
  const noModeSubmit = await fetch(`${url}/rest/v1/listings?id=eq.${noModeId}`, {
    method: "PATCH",
    headers: asUser(pdToken),
    body: JSON.stringify({ status: "pending_review" }),
  });
  check(
    "a listing with no mode chosen cannot be submitted for review",
    noModeSubmit.status >= 400,
    `HTTP ${noModeSubmit.status}`
  );

  // The waiver pool is finite and meant for landlords who owe a fee. A
  // Platform-Direct listing owes nothing, so claiming one would silently take a
  // free month away from someone who needed it.
  const pdDraftId = await createCompleteListing(pdOwnerId, {
    listingMode: "platform_direct",
    type: "sale",
  });
  const pdWaiver = await fetch(`${url}/rest/v1/rpc/claim_listing_fee_waiver`, {
    method: "POST",
    headers: asUser(pdToken),
    body: JSON.stringify({ p_listing_id: pdDraftId }),
  });
  const pdWaiverBody = await pdWaiver.json();
  const pdWaiverRow = Array.isArray(pdWaiverBody) ? pdWaiverBody[0] : pdWaiverBody;
  check(
    "a Platform-Direct listing cannot claim a fee waiver",
    pdWaiverRow?.granted === false && pdWaiverRow?.reason === "platform_direct_no_fee",
    `granted=${pdWaiverRow?.granted} reason=${pdWaiverRow?.reason}`
  );

  // The mode is a commercial term. Frozen once the listing has left the owner's
  // hands — otherwise: publish free as Platform-Direct, then switch.
  const pdFreeze = await fetch(`${url}/rest/v1/listings?id=eq.${pdListingId}`, {
    method: "PATCH",
    headers: asUser(pdToken),
    body: JSON.stringify({ listing_mode: "independent" }),
  });
  check(
    "the mode cannot be changed once the listing is under review",
    pdFreeze.status >= 400,
    `HTTP ${pdFreeze.status}`
  );

  // Switching mode on a draft un-signs the commission agreement, because the
  // two modes say opposite things about whether the platform is a party to the
  // sale — and it returns any claimed waiver to the pool.
  const switchId = await createCompleteListing(pdOwnerId, { type: "sale" });

  // The waiver is set directly rather than claimed through the RPC, because
  // section 6 deliberately leaves the pool at its cap — a claim here would be
  // refused, and the test would then "pass" against a listing that never held a
  // waiver at all. Granting it outright is what this check actually needs.
  // The database connection is a superuser with no auth.uid(), which the
  // privileged-field guard treats as trusted server-side code.
  await db.query("update public.listings set fee_waived = true where id = $1", [switchId]);
  const { rows: beforeSwitch } = await db.query(
    "select fee_waived from public.listings where id = $1",
    [switchId]
  );
  check(
    "the draft holds a waiver before the mode changes",
    beforeSwitch[0].fee_waived === true,
    `fee_waived=${beforeSwitch[0].fee_waived}`
  );

  await fetch(`${url}/rest/v1/listings?id=eq.${switchId}`, {
    method: "PATCH",
    headers: asUser(pdToken),
    body: JSON.stringify({ listing_mode: "platform_direct" }),
  });
  const { rows: afterSwitch } = await db.query(
    "select listing_mode, fee_waived, commission_clause_agreed_at, commission_clause_version"
      + " from public.listings where id = $1",
    [switchId]
  );
  check(
    "switching to Platform-Direct releases the claimed waiver",
    afterSwitch[0].fee_waived === false,
    `fee_waived=${afterSwitch[0].fee_waived}`
  );
  check(
    "switching mode un-signs the commission agreement",
    afterSwitch[0].commission_clause_agreed_at === null
      && afterSwitch[0].commission_clause_version === null,
    `agreed_at=${afterSwitch[0].commission_clause_agreed_at}`
  );

  // Money that genuinely changed hands is never released by a trigger. The
  // owner is stopped and told to get in touch instead.
  const paidId = await createCompleteListing(pdOwnerId, { type: "sale" });
  await db.query("update public.listings set listing_fee_paid = true where id = $1", [paidId]);
  const paidSwitch = await fetch(`${url}/rest/v1/listings?id=eq.${paidId}`, {
    method: "PATCH",
    headers: asUser(pdToken),
    body: JSON.stringify({ listing_mode: "platform_direct" }),
  });
  check(
    "the mode cannot be changed once the fee has actually been paid",
    paidSwitch.status >= 400,
    `HTTP ${paidSwitch.status}`
  );

  console.log("\n9. Cleanup");
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
