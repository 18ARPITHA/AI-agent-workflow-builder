const GRAPHQL_URL = process.env.NHOST_GRAPHQL_URL;
const ADMIN_SECRET = process.env.HASURA_ADMIN_SECRET;

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
  const emails = ["owner-a@example.com", "editor-a@example.com", "owner-b@example.com"];
  console.log("Deleting leftover demo users...");
  const result = await admin(
    `mutation($emails: [citext!]!) {
       deleteUsers: delete_authUsers(where: { email: { _in: $emails } }) { affected_rows }
     }`,
    { emails }
  );
  console.log("Deleted:", result);

  console.log("Deleting leftover orgs...");
  const orgs = await admin(
    `mutation { delete_organizations(where: { name: { _in: ["Org A", "Org B"] } }) { affected_rows } }`,
    {}
  );
  console.log("Deleted orgs:", orgs);
}

main().catch((err) => {
  console.error("Cleanup failed:", err.message);
  process.exit(1);
});
