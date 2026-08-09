import { gql } from "@apollo/client";

// Org's workflows with steps, triggers, and most recent run status.
export const GET_ORG_WORKFLOWS = gql`
  query GetOrgWorkflows($orgId: uuid!) {
    organizations_by_pk(id: $orgId) {
      id
      name
      quota_used
      quota_allowed
      quota_reset_at
    }
    org_members(where: { org_id: { _eq: $orgId } }) {
      user_id
      role
    }
    workflows(where: { org_id: { _eq: $orgId } }, order_by: { created_at: desc }) {
      id
      name
      description
      is_active
      workflow_steps(order_by: { step_order: asc }) {
        id
        step_order
        type
        name
        config
      }
      workflow_triggers {
        id
        type
        config
        is_enabled
      }
      workflow_runs(order_by: { started_at: desc }, limit: 1) {
        id
        status
        started_at
        finished_at
      }
    }
  }
`;

export const CREATE_WORKFLOW = gql`
  mutation CreateWorkflow($orgId: uuid!, $name: String!, $description: String) {
    insert_workflows_one(object: { org_id: $orgId, name: $name, description: $description }) {
      id
    }
  }
`;

export const ADD_STEP = gql`
  mutation AddStep($workflowId: uuid!, $stepOrder: Int!, $type: step_type_enum!, $name: String!, $config: jsonb!) {
    insert_workflow_steps_one(
      object: { workflow_id: $workflowId, step_order: $stepOrder, type: $type, name: $name, config: $config }
    ) {
      id
    }
  }
`;

export const ADD_TRIGGER = gql`
  mutation AddTrigger($workflowId: uuid!, $type: trigger_type_enum!, $config: jsonb!) {
    insert_workflow_triggers_one(object: { workflow_id: $workflowId, type: $type, config: $config }) {
      id
    }
  }
`;

export const TRIGGER_WORKFLOW_RUN = gql`
  mutation TriggerWorkflowRun($workflowId: uuid!) {
    triggerWorkflowRun(input: { workflow_id: $workflowId }) {
      run_id
      status
    }
  }
`;

export const APPROVE_STEP = gql`
  mutation ApproveStep($stepRunId: uuid!, $approve: Boolean!) {
    approveStep(input: { step_run_id: $stepRunId, approve: $approve }) {
      step_run_id
      run_status
    }
  }
`;

// Live per-step progress for a run, including the "paused" state.
export const STEP_RUNS_SUBSCRIPTION = gql`
  subscription WatchStepRuns($runId: uuid!) {
    step_runs(where: { workflow_run_id: { _eq: $runId } }, order_by: { step_order: asc }) {
      id
      step_order
      status
      output
      error
      attempt_count
      approved_by
      approved_at
      started_at
      finished_at
      workflow_step {
        name
        type
        config
      }
    }
    workflow_runs_by_pk(id: $runId) {
      id
      status
      error
      started_at
      finished_at
    }
  }
`;
