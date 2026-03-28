export type Session = {
  token: string;
  user: {
    id: string;
    github_login: string;
    display_name: string;
    email?: string | null;
    avatar_url?: string | null;
  };
};

export type Orbit = {
  id: string;
  slug: string;
  name: string;
  description: string;
  logo?: string | null;
  repo_full_name?: string | null;
  repo_url?: string | null;
  repo_private: boolean;
  default_branch: string;
};

export type DmThreadPayload = {
  thread: { id: string; title: string };
  messages: Array<{
    id: string;
    author_kind: string;
    author_name: string;
    body: string;
    metadata: Record<string, unknown>;
    created_at: string;
  }>;
};

export type WorkflowTask = {
  id: string;
  task_key: string;
  title: string;
  assigned_role: string;
  state: string;
  description?: string | null;
  block_reason?: string | null;
  input_json?: Record<string, unknown> | null;
  output_json?: Record<string, unknown> | null;
  worker_summary?: string | null;
};

export type WorkflowRequest = {
  id: string;
  task_id: string;
  task_key?: string | null;
  status: string;
  question?: string | null;
  answer_text?: string | null;
  reason?: string | null;
};

export type WorkflowRun = {
  id: string;
  title: string;
  status: string;
  operator_status: string;
  operator_summary: string;
  execution_status: string;
  execution_summary: string;
  tasks: WorkflowTask[];
  events: Array<{
    id: string;
    event_type: string;
    source: string;
    agent_role?: string | null;
    message?: string | null;
    sequence_no?: number;
  }>;
  human_requests: WorkflowRequest[];
  approval_requests: WorkflowRequest[];
};

export type WorkflowSnapshot = {
  status: string;
  load_error?: string | null;
  selected_run_id?: string | null;
  selected_run?: WorkflowRun | null;
  runs: WorkflowRun[];
};

export type OrbitPayload = {
  orbit: Orbit;
  members: Array<{ user_id: string; role: string }>;
  channels: Array<{ id: string; slug: string; name: string }>;
  direct_messages: Array<{ id: string; title: string }>;
  messages: Array<{
    id: string;
    author_kind: string;
    author_name: string;
    body: string;
    metadata: Record<string, unknown>;
    created_at: string;
  }>;
  workflow: WorkflowSnapshot;
  prs: Array<{ id: string; number: number; title: string; state: string; url: string; priority: string }>;
  issues: Array<{ id: string; number: number; title: string; state: string; url: string; priority: string }>;
  codespaces: Array<{ id: string; name: string; branch_name: string; workspace_path: string; status: string; editor_url?: string | null }>;
  demos: Array<{ id: string; title: string; source_path: string; status: string; url?: string | null }>;
  navigation?: { orbit_id?: string | null; section?: string } | null;
};

export type DashboardPayload = {
  me: Session["user"];
  recent_orbits: Orbit[];
  priority_items: Array<Record<string, unknown>>;
  codespaces: OrbitPayload["codespaces"];
  notifications: Array<{ kind: string; label: string }>;
};
