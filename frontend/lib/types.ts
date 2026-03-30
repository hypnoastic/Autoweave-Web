export type ThemeMode = "system" | "light" | "dark";

export type UserSummary = {
  id: string;
  github_login: string;
  display_name: string;
  email?: string | null;
  avatar_url?: string | null;
};

export type Session = {
  token: string;
  user: UserSummary;
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

export type ConversationMessage = {
  id: string;
  author_kind: string;
  author_name: string;
  body: string;
  metadata: Record<string, unknown>;
  created_at: string;
  channel_id?: string | null;
  dm_thread_id?: string | null;
  pending?: boolean;
};

export type ConversationSendResult = {
  message: ConversationMessage;
  ergo?: ConversationMessage | null;
  work_item?: Record<string, unknown> | null;
};

export type ChannelSummary = {
  id: string;
  slug: string;
  name: string;
  kind?: string;
};

export type DmParticipantSummary = {
  id: string;
  user_id?: string | null;
  login: string;
  github_login?: string;
  display_name: string;
  avatar_url?: string | null;
  role?: string;
  is_self?: boolean;
};

export type DmThreadSummary = {
  id: string;
  title: string;
  kind?: string;
  participant?: DmParticipantSummary | null;
};

export type OrbitMember = {
  id?: string;
  user_id: string;
  role: string;
  display_name?: string | null;
  login?: string;
  github_login?: string;
  avatar_url?: string | null;
  introduced?: boolean;
  is_self?: boolean;
};

export type DmThreadPayload = {
  thread: DmThreadSummary;
  messages: ConversationMessage[];
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

export type WorkflowEvent = {
  id: string;
  event_type: string;
  source: string;
  agent_role?: string | null;
  message?: string | null;
  sequence_no?: number;
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
  events: WorkflowEvent[];
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

export type BoardItem = {
  id: string;
  number: number;
  title: string;
  state: string;
  operational_status?: string;
  url: string;
  priority?: string;
  branch_name?: string | null;
};

export type CodespaceSummary = {
  id: string;
  name: string;
  branch_name: string;
  workspace_path: string;
  status: string;
  editor_url?: string | null;
};

export type DemoSummary = {
  id: string;
  title: string;
  source_path: string;
  status: string;
  url?: string | null;
};

export type UserPreferences = {
  theme_preference: ThemeMode;
};

export type OrbitPayload = {
  orbit: Orbit;
  members: OrbitMember[];
  channels: ChannelSummary[];
  direct_messages: DmThreadSummary[];
  messages: ConversationMessage[];
  workflow: WorkflowSnapshot;
  prs: BoardItem[];
  issues: BoardItem[];
  codespaces: CodespaceSummary[];
  demos: DemoSummary[];
  navigation?: { orbit_id?: string | null; section?: string } | null;
  preferences?: UserPreferences | null;
};

export type DashboardPayload = {
  me: UserSummary;
  recent_orbits: Orbit[];
  priority_items: Array<Record<string, unknown>>;
  codespaces: CodespaceSummary[];
  notifications: Array<{ kind: string; label: string }>;
  preferences?: UserPreferences | null;
};
