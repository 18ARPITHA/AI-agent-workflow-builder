/**
 * Seeds the exact scenario the Final Task walkthrough needs:
 *   Org A: owner-a@example.com (owner), editor-a@example.com (editor)
 *   Org B: owner-b@example.com (owner)
 * Run with: NHOST_BACKEND_URL=... HASURA_ADMIN_SECRET=... ts-node scripts/seed.ts
 *
 * Users are created through nhost's auth REST API (so passwords are hashed
 * correctly by the auth service); org/org_members rows are then inserted
 * directly via the Hasura admin secret, which bypasses the row permissions
 * in hasura/metadata entirely — that's expected and is why this is a seed
 * script and not a GraphQL mutation exposed to the "user" role.
 */

const BACKEND_URL = process.env.NHOST_BACKEND_URL ?? "http://localhost:1337";
const ADMIN_SECRET = process.env.HASURA_ADMIN_SECRET ?? "nhost-admin-secret";
const GRAPHQL_URL = `${BACKEND_URL}/v1/graphql`;
const PASSWORD = "Passw0rd!2026";

async function signUp(email: string) {
  const res = await fetch(`${BACKEND_URL}/v1/auth/signup/email-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`signup ${email} failed: ${JSON.stringify(data)}`);
  return data.session.user.id as string;
}

async function admin(query: string, variables: any) {
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
  const ownerA = await signUp("owner-a@example.com");
  const editorA = await signUp("editor-a@example.com");
  const ownerB = await signUp("owner-b@example.com");

  const { insert_organizations } = await admin(
    `mutation($orgs: [organizations_insert_input!]!) {
       insert_organizations(objects: $orgs) { returning { id name } }
     }`,
    { orgs: [{ name: "Org A", quota_allowed: 1000 }, { name: "Org B", quota_allowed: 1000 }] }
  );
  const orgA = insert_organizations.returning[0].id;
  const orgB = insert_organizations.returning[1].id;

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

  console.log("Seeded:");
  console.log({ orgA, orgB, ownerA, editorA, ownerB, password: PASSWORD });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
