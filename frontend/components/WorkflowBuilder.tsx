import { useState } from "react";
import { useMutation } from "@apollo/client";
import { useRouter } from "next/router";
import { ADD_STEP, ADD_TRIGGER, TRIGGER_WORKFLOW_RUN } from "../graphql/documents";

const STEP_TYPES = ["llm_call", "http_request", "db_write", "notify", "conditional_branch", "approval_gate"];
const TRIGGER_TYPES = ["manual", "webhook", "scheduled", "database_event"];
const OWNER_ONLY_STEPS = new Set(["db_write", "notify"]);

export default function WorkflowBuilder({
  workflow,
  orgId,
  myRole,
  refetch,
}: {
  workflow: any;
  orgId: string;
  myRole: "owner" | "editor" | "viewer";
  refetch: () => void;
}) {
  const router = useRouter();
  const [stepType, setStepType] = useState("llm_call");
  const [stepName, setStepName] = useState("");
  const [stepConfig, setStepConfig] = useState("{}");
  const [triggerType, setTriggerType] = useState("manual");
  const [triggerConfig, setTriggerConfig] = useState("{}");
  const [err, setErr] = useState("");

  const [addStep] = useMutation(ADD_STEP);
  const [addTrigger] = useMutation(ADD_TRIGGER);
  const [triggerRun, { loading: running }] = useMutation(TRIGGER_WORKFLOW_RUN);

  const canEdit = myRole === "owner" || myRole === "editor";
  const canRun = canEdit; // viewers can't trigger runs (spec)
  const canAddStepType = (t: string) => myRole === "owner" || (myRole === "editor" && !OWNER_ONLY_STEPS.has(t));
  const canAddTriggerType = (t: string) => myRole === "owner" || (myRole === "editor" && t !== "webhook");

  async function handleAddStep(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      const nextOrder = (workflow.workflow_steps?.length ?? 0) + 1;
      await addStep({
        variables: {
          workflowId: workflow.id,
          stepOrder: nextOrder,
          type: stepType,
          name: stepName || `${stepType}_${nextOrder}`,
          config: JSON.parse(stepConfig || "{}"),
        },
      });
      setStepName("");
      setStepConfig("{}");
      refetch();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function handleAddTrigger(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      await addTrigger({
        variables: { workflowId: workflow.id, type: triggerType, config: JSON.parse(triggerConfig || "{}") },
      });
      setTriggerConfig("{}");
      refetch();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function handleRun() {
    setErr("");
    try {
      const { data } = await triggerRun({ variables: { workflowId: workflow.id } });
      router.push(`/org/${orgId}/runs/${data.triggerWorkflowRun.run_id}`);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>{workflow.name}</h3>
        {canRun && (
          <button className="btn" onClick={handleRun} disabled={running}>
            {running ? "Starting…" : "Run"}
          </button>
        )}
      </div>
      <p style={{ opacity: 0.7 }}>{workflow.description}</p>

      <h4>Steps</h4>
      <ol>
        {workflow.workflow_steps.map((s: any) => (
          <li key={s.id}>
            <b>{s.name}</b> — {s.type}
          </li>
        ))}
      </ol>
      {canEdit && (
        <form onSubmit={handleAddStep} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          <select value={stepType} onChange={(e) => setStepType(e.target.value)}>
            {STEP_TYPES.filter(canAddStepType).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input placeholder="step name" value={stepName} onChange={(e) => setStepName(e.target.value)} />
          <input
            placeholder='config JSON, e.g. {"prompt_template":"..."}'
            style={{ minWidth: 260 }}
            value={stepConfig}
            onChange={(e) => setStepConfig(e.target.value)}
          />
          <button className="btn secondary" type="submit">
            Add step
          </button>
        </form>
      )}

      <h4>Triggers</h4>
      <ul>
        {workflow.workflow_triggers.map((t: any) => (
          <li key={t.id}>
            {t.type} {t.is_enabled ? "" : "(disabled)"}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form onSubmit={handleAddTrigger} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select value={triggerType} onChange={(e) => setTriggerType(e.target.value)}>
            {TRIGGER_TYPES.filter(canAddTriggerType).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            placeholder='config JSON, e.g. {"cron":"*/15 * * * *"}'
            style={{ minWidth: 260 }}
            value={triggerConfig}
            onChange={(e) => setTriggerConfig(e.target.value)}
          />
          <button className="btn secondary" type="submit">
            Add trigger
          </button>
        </form>
      )}

      <h4>Recent run</h4>
      {workflow.workflow_runs?.[0] ? (
        <a href={`/org/${orgId}/runs/${workflow.workflow_runs[0].id}`}>
          <span className={`pill ${workflow.workflow_runs[0].status}`}>{workflow.workflow_runs[0].status}</span>
        </a>
      ) : (
        <span style={{ opacity: 0.6 }}>No runs yet</span>
      )}

      {err && <div style={{ color: "#ff7c7c", marginTop: 10 }}>{err}</div>}
    </div>
  );
}
