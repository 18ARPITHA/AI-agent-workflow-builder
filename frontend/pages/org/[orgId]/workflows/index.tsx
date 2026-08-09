import { useState } from "react";
import { useRouter } from "next/router";
import { useQuery, useMutation } from "@apollo/client";
import { GET_ORG_WORKFLOWS, CREATE_WORKFLOW } from "../../../../graphql/documents";
import WorkflowBuilder from "../../../../components/WorkflowBuilder";
import QuotaIndicator from "../../../../components/QuotaIndicator";
import { nhost } from "../../../../lib/nhost";

export default function OrgWorkflows() {
  const router = useRouter();
  const orgId = router.query.orgId as string;
  const { data, loading, refetch } = useQuery(GET_ORG_WORKFLOWS, { variables: { orgId }, skip: !orgId });
  const [createWorkflow] = useMutation(CREATE_WORKFLOW);
  const [name, setName] = useState("");

  if (loading || !data) return <p style={{ padding: 40 }}>Loading…</p>;

  const me = nhost.auth.getUser();
  const myMembership = data.org_members.find((m: any) => m.user_id === me?.id);
  const myRole = myMembership?.role ?? "viewer";
  const canCreate = myRole === "owner" || myRole === "editor";

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await createWorkflow({ variables: { orgId, name, description: "" } });
    setName("");
    refetch();
  }

  return (
    <div style={{ maxWidth: 760, margin: "40px auto", display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <h2>{data.organizations_by_pk?.name}</h2>
        <QuotaIndicator
          used={data.organizations_by_pk?.quota_used ?? 0}
          allowed={data.organizations_by_pk?.quota_allowed ?? 0}
          resetAt={data.organizations_by_pk?.quota_reset_at}
        />
      </div>

      {canCreate && (
        <form onSubmit={handleCreate} style={{ display: "flex", gap: 8 }}>
          <input placeholder="new workflow name" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn" type="submit">
            Create workflow
          </button>
        </form>
      )}

      {data.workflows.map((wf: any) => (
        <WorkflowBuilder key={wf.id} workflow={wf} orgId={orgId} myRole={myRole} refetch={refetch} />
      ))}
    </div>
  );
}
