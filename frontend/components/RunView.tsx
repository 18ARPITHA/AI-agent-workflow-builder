import { useSubscription, useMutation } from "@apollo/client";
import { STEP_RUNS_SUBSCRIPTION, APPROVE_STEP } from "../graphql/documents";

export default function RunView({ runId, myRole }: { runId: string; myRole: "owner" | "editor" | "viewer" }) {
  const { data, loading, error } = useSubscription(STEP_RUNS_SUBSCRIPTION, { variables: { runId } });
  const [approveStep, { loading: approving }] = useMutation(APPROVE_STEP);

  if (loading && !data) return <p>Connecting…</p>;
  if (error) return <p style={{ color: "#ff7c7c" }}>{error.message}</p>;

  const run = data?.workflow_runs_by_pk;
  const steps = data?.step_runs ?? [];
  const canApprove = myRole === "owner" || myRole === "editor";

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <h3>Run status</h3>
        <span className={`pill ${run?.status}`}>{run?.status}</span>
      </div>
      {run?.error && <p style={{ color: "#ff7c7c" }}>{run.error}</p>}

      <ol style={{ display: "flex", flexDirection: "column", gap: 10, listStyle: "none", padding: 0 }}>
        {steps.map((s: any) => (
          <li key={s.id} className="card">
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <b>
                {s.step_order}. {s.workflow_step.name} <span style={{ opacity: 0.6 }}>({s.workflow_step.type})</span>
              </b>
              <span className={`pill ${s.status}`}>{s.status}</span>
            </div>
            {s.output && (
              <pre style={{ fontSize: 12, whiteSpace: "pre-wrap", opacity: 0.8 }}>
                {JSON.stringify(s.output, null, 2)}
              </pre>
            )}
            {s.error && <div style={{ color: "#ff7c7c", fontSize: 13 }}>{s.error}</div>}

            {s.status === "paused" && s.workflow_step.type === "approval_gate" && (
              <div style={{ marginTop: 8 }}>
                {canApprove ? (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      className="btn"
                      disabled={approving}
                      onClick={() => approveStep({ variables: { stepRunId: s.id, approve: true } })}
                    >
                      Approve
                    </button>
                    <button
                      className="btn danger"
                      disabled={approving}
                      onClick={() => approveStep({ variables: { stepRunId: s.id, approve: false } })}
                    >
                      Reject
                    </button>
                  </div>
                ) : (
                  <span style={{ opacity: 0.6, fontSize: 13 }}>Awaiting approval from an owner/editor</span>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
