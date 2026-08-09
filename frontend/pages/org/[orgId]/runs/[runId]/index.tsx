import { useRouter } from "next/router";
import { useQuery, gql } from "@apollo/client";
import RunView from "../../../../../components/RunView";
import { nhost } from "../../../../../lib/nhost";

const MY_ROLE = gql`
  query MyRole($orgId: uuid!) {
    org_members(where: { org_id: { _eq: $orgId } }) {
      user_id
      role
    }
  }
`;

export default function RunPage() {
  const router = useRouter();
  const orgId = router.query.orgId as string;
  const runId = router.query.runId as string;
  const { data } = useQuery(MY_ROLE, { variables: { orgId }, skip: !orgId });

  if (!runId) return null;
  const me = nhost.auth.getUser();
  const myRole = data?.org_members?.find((m: any) => m.user_id === me?.id)?.role ?? "viewer";

  return (
    <div style={{ maxWidth: 760, margin: "40px auto" }}>
      <a href={`/org/${orgId}/workflows`}>&larr; back to workflows</a>
      <RunView runId={runId} myRole={myRole} />
    </div>
  );
}
