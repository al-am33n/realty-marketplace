// Phase 1 end-to-end security test.
//
// Creates real users, acts as them through PostgREST, and asserts the database
// refuses everything it should. Cleans up after itself, including on failure.
//
//   npm run verify:e2e
//
// Users are created through the admin API with email_confirm: true, so this
// needs no working SMTP.
import { loadEnv, makeChecker, keyHeaders, userHeaders } from "./lib/env.mjs";

const { url, anon, service } = loadEnv();
const { check, finish } = makeChecker();

const svcH = keyHeaders(service);
const anonH = keyHeaders(anon);
const asUser = (token) => userHeaders(anon, token);

const stamp = Date.now();
const createdUserIds = [];
let createdListingId = null;

async function createUser(email, password, metadata) {
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: svcH,
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: metadata }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`createUser ${email}: ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  }
  createdUserIds.push(body.id);
  return body.id;
}

async function signIn(email, password) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`signIn ${email}: ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body.access_token;
}

async function profileOf(userId) {
  const res = await fetch(`${url}/rest/v1/profiles?user_id=eq.${userId}&select=*`, {
    headers: svcH,
  });
  return (await res.json())[0];
}

async function cleanup() {
  if (createdListingId) {
    await fetch(`${url}/rest/v1/listings?id=eq.${createdListingId}`, {
      method: "DELETE",
      headers: svcH,
    }).catch(() => {});
  }
  for (const id of createdUserIds) {
    await fetch(`${url}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: svcH }).catch(
      () => {}
    );
  }
}

try {
  const PASSWORD = "TestPass123";
  const landlordEmail = `landlord.${stamp}@example.com`;
  const renterEmail = `renter.${stamp}@example.com`;
  const sneakyEmail = `sneaky.${stamp}@example.com`;

  console.log("\n1. Sign-up trigger creates the profile row with the right role");
  const landlordId = await createUser(landlordEmail, PASSWORD, {
    full_name: "Ada Landlord",
    phone: "+2348031234567",
    role: "landlord",
  });
  const landlordProfile = await profileOf(landlordId);
  check("profile row auto-created by trigger", Boolean(landlordProfile));
  check("role = landlord", landlordProfile?.role === "landlord", `got ${landlordProfile?.role}`);
  check("full_name carried across", landlordProfile?.full_name === "Ada Landlord");
  check("phone carried across", landlordProfile?.phone === "+2348031234567");
  check("verified defaults to FALSE", landlordProfile?.verified === false);

  console.log("\n2. Privilege escalation at sign-up is refused");
  const sneakyId = await createUser(sneakyEmail, PASSWORD, {
    full_name: "Mallory",
    role: "admin", // forged in the request
  });
  const sneakyProfile = await profileOf(sneakyId);
  check(
    "requested role 'admin' downgraded to renter_buyer",
    sneakyProfile?.role === "renter_buyer",
    `got ${sneakyProfile?.role}`
  );

  console.log("\n3. A signed-in user cannot escalate their own privileges");
  const landlordToken = await signIn(landlordEmail, PASSWORD);

  const selfVerify = await fetch(`${url}/rest/v1/profiles?user_id=eq.${landlordId}`, {
    method: "PATCH",
    headers: asUser(landlordToken),
    body: JSON.stringify({ verified: true }),
  });
  const selfVerifyBody = await selfVerify.text();
  check("cannot set own verified = true", selfVerify.status >= 400, `HTTP ${selfVerify.status}`);
  check(
    "  ...blocked by the guard trigger",
    /Verification status is set by the system/.test(selfVerifyBody),
    selfVerifyBody.slice(0, 90)
  );

  const selfAdmin = await fetch(`${url}/rest/v1/profiles?user_id=eq.${landlordId}`, {
    method: "PATCH",
    headers: asUser(landlordToken),
    body: JSON.stringify({ role: "admin" }),
  });
  const selfAdminBody = await selfAdmin.text();
  check("cannot set own role = admin", selfAdmin.status >= 400, `HTTP ${selfAdmin.status}`);
  check(
    "  ...blocked by the guard trigger",
    /cannot change your own role/.test(selfAdminBody),
    selfAdminBody.slice(0, 90)
  );

  const renameSelf = await fetch(`${url}/rest/v1/profiles?user_id=eq.${landlordId}`, {
    method: "PATCH",
    headers: { ...asUser(landlordToken), Prefer: "return=representation" },
    body: JSON.stringify({ full_name: "Ada Landlord-Okoro" }),
  });
  check("CAN still edit own name", renameSelf.status === 200, `HTTP ${renameSelf.status}`);

  console.log("\n4. Cross-user isolation");
  const renterId = await createUser(renterEmail, PASSWORD, {
    full_name: "Bola Renter",
    role: "renter_buyer",
  });
  const renterToken = await signIn(renterEmail, PASSWORD);

  const allProfiles = await fetch(`${url}/rest/v1/profiles?select=*`, {
    headers: asUser(renterToken),
  });
  const allProfileRows = await allProfiles.json();
  check(
    "renter sees only their own profile row",
    Array.isArray(allProfileRows) && allProfileRows.length === 1,
    `saw ${Array.isArray(allProfileRows) ? allProfileRows.length : "?"} rows`
  );
  check("  ...and it is their own", allProfileRows?.[0]?.user_id === renterId);

  const targetProfile = await fetch(
    `${url}/rest/v1/profiles?user_id=eq.${landlordId}&select=*`,
    { headers: asUser(renterToken) }
  );
  const targetRows = await targetProfile.json();
  check(
    "renter cannot read the landlord's profile (phone number)",
    Array.isArray(targetRows) && targetRows.length === 0,
    `saw ${targetRows.length} rows`
  );

  console.log("\n5. The verification gate blocks listing creation");
  const draft = {
    owner_id: landlordId,
    title: "Two bedroom flat in Wuse 2",
    type: "rent",
    property_type: "apartment",
    price_kobo: 250000000,
    location_text: "Wuse 2, Abuja",
  };
  const blockedCreate = await fetch(`${url}/rest/v1/listings`, {
    method: "POST",
    headers: asUser(landlordToken),
    body: JSON.stringify(draft),
  });
  check(
    "UNVERIFIED landlord cannot create a listing",
    blockedCreate.status >= 400,
    `HTTP ${blockedCreate.status}`
  );

  console.log("\n6. After verification (the /auth/callback path), creation works");
  const markVerified = await fetch(`${url}/rest/v1/profiles?user_id=eq.${landlordId}`, {
    method: "PATCH",
    headers: svcH,
    body: JSON.stringify({ verified: true, verified_at: new Date().toISOString() }),
  });
  check(
    "admin client CAN set verified",
    markVerified.status < 300,
    `HTTP ${markVerified.status}`
  );

  const verifiedToken = await signIn(landlordEmail, PASSWORD);
  const created = await fetch(`${url}/rest/v1/listings`, {
    method: "POST",
    headers: { ...asUser(verifiedToken), Prefer: "return=representation" },
    body: JSON.stringify(draft),
  });
  const createdBody = await created.json();
  check("VERIFIED landlord can create a draft listing", created.status === 201, `HTTP ${created.status}`);
  createdListingId = createdBody?.[0]?.id;
  check("  ...and it starts as a draft", createdBody?.[0]?.status === "draft");

  console.log("\n7. An owner cannot publish their own listing");
  const selfPublish = await fetch(`${url}/rest/v1/listings?id=eq.${createdListingId}`, {
    method: "PATCH",
    headers: asUser(verifiedToken),
    body: JSON.stringify({ status: "live" }),
  });
  check(
    "owner cannot set status = live (manual review is mandatory)",
    selfPublish.status >= 400,
    `HTTP ${selfPublish.status}`
  );

  console.log("\n8. Draft listings are invisible to everyone else");
  const publicView = await fetch(`${url}/rest/v1/listings?select=*`, { headers: anonH });
  const publicRows = await publicView.json();
  check("anonymous visitor sees 0 listings", publicRows.length === 0, `saw ${publicRows.length}`);

  const otherUserView = await fetch(`${url}/rest/v1/listings?select=*`, {
    headers: asUser(renterToken),
  });
  const otherUserRows = await otherUserView.json();
  check("another signed-in user also sees 0", otherUserRows.length === 0, `saw ${otherUserRows.length}`);

  console.log("\n9. The 3-photo minimum actually holds");
  // Satisfy the OTHER two submission constraints first (map pin, commission
  // clause) so the photo count is the only thing left that can fail —
  // otherwise Postgres reports whichever constraint it hits first and we would
  // not really be testing the photo rule.
  await fetch(`${url}/rest/v1/listings?id=eq.${createdListingId}`, {
    method: "PATCH",
    headers: asUser(verifiedToken),
    body: JSON.stringify({
      lat: 9.0765,
      lng: 7.3986,
      commission_clause_agreed_at: new Date().toISOString(),
      commission_clause_version: "v1",
    }),
  });

  for (const [label, images] of [
    ["ZERO", []],
    ["TWO", ["a.jpg", "b.jpg"]],
  ]) {
    const res = await fetch(`${url}/rest/v1/listings?id=eq.${createdListingId}`, {
      method: "PATCH",
      headers: asUser(verifiedToken),
      body: JSON.stringify({ status: "pending_review", images }),
    });
    const body = await res.text();
    check(`${label} photos is rejected`, res.status >= 400, `HTTP ${res.status}`);
    check("  ...specifically by the photo constraint", /requires_photos/.test(body), body.slice(0, 110));
  }

  const threePhotos = await fetch(`${url}/rest/v1/listings?id=eq.${createdListingId}`, {
    method: "PATCH",
    headers: { ...asUser(verifiedToken), Prefer: "return=representation" },
    body: JSON.stringify({ status: "pending_review", images: ["a.jpg", "b.jpg", "c.jpg"] }),
  });
  const threeBody = await threePhotos.json();
  check("THREE photos is accepted", threePhotos.status === 200, `HTTP ${threePhotos.status}`);
  check("  ...and the listing moves to pending_review", threeBody?.[0]?.status === "pending_review");

  const stillHidden = await fetch(`${url}/rest/v1/listings?select=*`, { headers: anonH });
  const stillHiddenRows = await stillHidden.json();
  check(
    "a pending_review listing is STILL invisible to the public",
    stillHiddenRows.length === 0,
    `saw ${stillHiddenRows.length}`
  );

  console.log("\n10. Cleanup");
  await cleanup();
  const leftover = await fetch(`${url}/rest/v1/profiles?select=user_id`, { headers: svcH });
  const leftoverRows = await leftover.json();
  check(
    "all test users removed",
    Array.isArray(leftoverRows) && leftoverRows.length === 0,
    `${leftoverRows.length} profile(s) remain`
  );

  finish("PHASE 1 END-TO-END");
} catch (error) {
  console.error("\nERROR: " + error.message);
  await cleanup();
  process.exit(1);
}
