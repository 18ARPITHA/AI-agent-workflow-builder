const AUTH_URL = process.env.NHOST_AUTH_URL;
const GRAPHQL_URL = process.env.NHOST_GRAPHQL_URL;
const ADMIN_SECRET = process.env.HASURA_ADMIN_SECRET;
const PASSWORD = "Passw0rd!2026";

if (!AUTH_URL || !GRAPHQL_URL || !ADMIN_SECRET) {
  console.error("Set NHOST_AUTH_URL, NHOST_GRAPHQL_URL, and HASURA_ADMIN_SECRET env vars first.");
  process.exit(1);
}

async function signUp(email) {
  const res = await fetch(`${AUTH_URL}/signup/email-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`signup ${email} failed: ${JSON.stringify(data)}`);
  return data.session.user.id;
}

async function admin(query, variables) {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hasura-admin-secret": ADMIN_SECRET },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data;
}

async function main() {
  console.log("Signing up demo users...");
  const ownerA = await signUp("owner-a@example.com");
  const editorA = await signUp("editor-a@example.com");
  const ownerB = await signUp("owner-b@example.com");

  console.log("Creating organizations...");
  const { insert_organizations } = await admin(
    `mutation($orgs: [organizations_insert_input!]!) {
       insert_organizations(objects: $orgs) { returning { id name } }
     }`,
    { orgs: [{ name: "Org A", quota_allowed: 1000 }, { name: "Org B", quota_allowed: 1000 }] }
  );
  const orgA = insert_organizations.returning[0].id;
  const orgB = insert_organizations.returning[1].id;

  console.log("Assigning roles...");
  await admin(
    `mutation($members: [org_members_insert_input!]!) {
       insert_org_members(objects: $members) { affected_rows }
     }`,
    {
      members: [
        { org_id: orgA, user_id: ownerA, role: "owner" },
        { org_id: orgA, user_id: editorA, role: "editor" },
        { org_id: orgB, user_id: ownerB, role: "owner" },
      ],
    }
  );

  console.log("\n✅ Seeded successfully. Log in with password:", PASSWORD);
  console.log({
    "Org A owner": "owner-a@example.com",
    "Org A editor": "editor-a@example.com",
    "Org B owner": "owner-b@example.com",
    orgA_id: orgA,
    orgB_id: orgB,
  });
}

main().catch((err) => {
  console.error("\n❌ Seed failed:", err.message);
  process.exit(1);
});
