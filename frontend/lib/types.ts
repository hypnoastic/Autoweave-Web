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

export type GitHubAppInstallationSummary = {
  id: string;
  installation_id: number;
  account_login?: string | null;
  account_type?: string | null;
  display_name: string;
  setup_action?: string | null;
};

export type GitHubAppStatus = {
  configured: boolean;
  app_slug?: string | null;
  install_url?: string | null;
  active_installation?: GitHubAppInstallationSummary | null;
};

export type ChatSyncBootstrap = {
  enabled: boolean;
  provider: string;
  base_url?: string;
  access_token?: string;
  user_id?: string;
  device_id?: string | null;
  room_bindings: Array<{
    room_id: string;
    room_kind: string;
    channel_id?: string | null;
    dm_thread_id?: string | null;
  }>;
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

export type OrbitRepository = {
  id: string;
  provider: string;
  full_name: string;
  owner_name: string;
  repo_name: string;
  url?: string | null;
  is_private: boolean;
  default_branch: string;
  status: string;
  health_state?: string | null;
  is_primary?: boolean;
  binding_status?: string | null;
};

export type AvailableRepository = {
  id?: string | null;
  provider: string;
  full_name: string;
  owner_name: string;
  repo_name: string;
  url?: string | null;
  is_private: boolean;
  default_branch: string;
  status: string;
  health_state?: string | null;
  already_connected?: boolean;
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
  transport_state?: string | null;
  transport_error?: string | null;
};

export type HumanLoopItem = {
  id: string;
  request_id: string;
  request_kind: string;
  workflow_run_id: string;
  work_item_id?: string | null;
  task_id?: string | null;
  task_key?: string | null;
  status: string;
  title: string;
  detail: string;
  response_text?: string | null;
  channel_id?: string | null;
  dm_thread_id?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  resolved_at?: string | null;
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
  human_loop_items: HumanLoopItem[];
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
  work_item_id?: string | null;
  source_channel_id?: string | null;
  source_dm_thread_id?: string | null;
  repository_ids?: string[];
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

export type WorkItemSummary = {
  id: string;
  title: string;
  status: string;
  agent: string;
  branch_name?: string | null;
  draft_pr_url?: string | null;
  demo_url?: string | null;
  workflow_run_id?: string | null;
  summary?: string | null;
  updated_at: string;
};

export type IssueLabelSummary = {
  id: string;
  name: string;
  slug: string;
  tone: string;
  issue_count?: number;
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
  repository_id?: string | null;
  repository_full_name?: string | null;
  repository_url?: string | null;
  linked_work_item_id?: string | null;
  linked_workflow_run_id?: string | null;
  source_kind?: string | null;
  orbit_id?: string | null;
  cycle_id?: string | null;
  cycle_name?: string | null;
  assignee_user_id?: string | null;
  assignee_display_name?: string | null;
  labels?: IssueLabelSummary[];
  stale?: boolean;
  stale_working_days?: number;
  parent_issue_id?: string | null;
  sub_issue_count?: number;
  blocked_by_count?: number;
  related_count?: number;
  is_blocked?: boolean;
};

export type CodespaceSummary = {
  id: string;
  name: string;
  branch_name: string;
  workspace_path: string;
  status: string;
  editor_url?: string | null;
  work_item_id?: string | null;
  workflow_run_id?: string | null;
  repository_id?: string | null;
  repository_full_name?: string | null;
  repository_url?: string | null;
};

export type DemoSummary = {
  id: string;
  title: string;
  source_path: string;
  status: string;
  url?: string | null;
  work_item_id?: string | null;
  workflow_run_id?: string | null;
  repository_id?: string | null;
  repository_full_name?: string | null;
  repository_url?: string | null;
};

export type ArtifactSummary = {
  id: string;
  artifact_kind: string;
  title: string;
  summary?: string | null;
  status: string;
  external_url?: string | null;
  work_item_id?: string | null;
  workflow_run_id?: string | null;
  source_kind: string;
  source_id: string;
  metadata: Record<string, unknown>;
  updated_at: string;
  repository_id?: string | null;
  repository_full_name?: string | null;
  repository_url?: string | null;
};

export type UserPreferences = {
  theme_preference: ThemeMode;
};

export type NotificationItem = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  status: string;
  channel_id?: string | null;
  dm_thread_id?: string | null;
  source_kind: string;
  source_id: string;
  created_at: string;
  metadata: Record<string, unknown>;
};

export type PermissionSnapshot = {
  orbit_role: string;
  repo_grants: Record<string, string>;
  can_manage_members: boolean;
  can_manage_roles: boolean;
  can_manage_settings: boolean;
  can_manage_integrations: boolean;
  can_bind_repo: boolean;
  can_publish_artifact: boolean;
};

export type OrbitSearchResult = {
  key: string;
  kind: string;
  label: string;
  detail: string;
  section: string;
  conversation_kind?: "channel" | "dm" | null;
  conversation_id?: string | null;
  detail_kind?: "pr" | "issue" | "native_issue" | null;
  detail_id?: string | null;
  workflow_run_id?: string | null;
  metadata: Record<string, unknown>;
};

export type OrbitCycle = {
  id: string;
  name: string;
  goal?: string | null;
  status: string;
  starts_at?: string | null;
  ends_at?: string | null;
  issue_count: number;
  completed_count: number;
  active_count: number;
  review_count: number;
  created_at: string;
  updated_at: string;
};

export type NativeOrbitIssueReference = {
  id: string;
  number: number;
  title: string;
  status: string;
  priority: string;
  cycle_id?: string | null;
  cycle_name?: string | null;
  assignee_user_id?: string | null;
  assignee_display_name?: string | null;
  orbit_id?: string | null;
  orbit_name?: string | null;
  labels: IssueLabelSummary[];
  stale: boolean;
  stale_working_days: number;
};

export type NativeIssueActivity = {
  id: string;
  action_type: string;
  actor_user_id?: string | null;
  actor_display_name?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type NativeOrbitIssue = {
  id: string;
  number: number;
  title: string;
  detail?: string | null;
  status: string;
  priority: string;
  source_kind: string;
  cycle_id?: string | null;
  cycle_name?: string | null;
  assignee_user_id?: string | null;
  assignee_display_name?: string | null;
  created_by_user_id?: string | null;
  created_by_display_name?: string | null;
  orbit_id?: string | null;
  orbit_name?: string | null;
  repository_connection_id?: string | null;
  repository_id?: string | null;
  repository_full_name?: string | null;
  repository_url?: string | null;
  labels: IssueLabelSummary[];
  parent_issue_id?: string | null;
  parent_issue?: NativeOrbitIssueReference | null;
  sub_issues: NativeOrbitIssueReference[];
  relations: {
    blocked_by: NativeOrbitIssueReference[];
    blocking: NativeOrbitIssueReference[];
    related: NativeOrbitIssueReference[];
    duplicate: NativeOrbitIssueReference[];
  };
  relation_counts: {
    blocked_by: number;
    blocking: number;
    related: number;
    duplicate: number;
  };
  is_blocked: boolean;
  has_sub_issues: boolean;
  stale: boolean;
  stale_working_days: number;
  activity: NativeIssueActivity[];
  created_at: string;
  updated_at: string;
};

export type OrbitPayload = {
  orbit: Orbit;
  repositories: OrbitRepository[];
  members: OrbitMember[];
  channels: ChannelSummary[];
  direct_messages: DmThreadSummary[];
  messages: ConversationMessage[];
  human_loop_items: HumanLoopItem[];
  notifications: NotificationItem[];
  permissions?: PermissionSnapshot | null;
  workflow: WorkflowSnapshot;
  prs: BoardItem[];
  issues: BoardItem[];
  native_issues: NativeOrbitIssue[];
  issue_labels: IssueLabelSummary[];
  cycles: OrbitCycle[];
  codespaces: CodespaceSummary[];
  demos: DemoSummary[];
  artifacts: ArtifactSummary[];
  navigation?: { orbit_id?: string | null; section?: string } | null;
  preferences?: UserPreferences | null;
};

export type DashboardPayload = {
  me: UserSummary;
  recent_orbits: Orbit[];
  priority_items: WorkItemSummary[];
  codespaces: CodespaceSummary[];
  notifications: Array<{ kind: string; label: string }>;
  preferences?: UserPreferences | null;
};

export type MyWorkPayload = {
  me: UserSummary;
  summary: {
    active_work_items: number;
    active_issues: number;
    blocked_issues: number;
    stale_issues: number;
    review_queue: number;
    approvals: number;
    running_codespaces: number;
    recent_orbits: number;
  };
  work_items: WorkItemSummary[];
  active_issues: BoardItem[];
  blocked_issues: BoardItem[];
  stale_issues: BoardItem[];
  review_queue: BoardItem[];
  native_issues: NativeOrbitIssue[];
  issue_labels: IssueLabelSummary[];
  approvals: NotificationItem[];
  recent_orbits: Orbit[];
  codespaces: CodespaceSummary[];
  notifications: NotificationItem[];
};

export type SavedViewPreview = {
  id: string;
  kind: string;
  eyebrow: string;
  title: string;
  detail: string;
  supporting?: string;
  status: string;
  tone: "accent" | "danger" | "muted" | "success" | "warning";
  href: string;
  timestamp?: string;
};

export type SavedPlanningView = {
  id: string;
  label: string;
  detail: string;
  tone: "accent" | "danger" | "muted" | "success" | "warning";
  count: number;
  kind: "system" | "custom";
  filter_summary: string[];
  preview: SavedViewPreview[];
  created_at?: string | null;
  updated_at?: string | null;
};

export type SavedViewsPayload = {
  views: SavedPlanningView[];
};

export type InboxBucketKey = "all" | "review" | "blocked" | "stale" | "approvals" | "mentions" | "agent" | "sources";

export type InboxNavigationTarget = {
  orbit_id?: string | null;
  section: string;
  conversation_kind?: "channel" | "dm" | null;
  conversation_id?: string | null;
  detail_kind?: "pr" | "issue" | "native_issue" | null;
  detail_id?: string | null;
};

export type InboxAction = {
  label: string;
  navigation?: InboxNavigationTarget | null;
  href?: string | null;
};

export type InboxDetail = {
  summary: string;
  key_context: Array<{ label: string; value: string }>;
  related_entities: Array<{ label: string; value: string }>;
  next_actions: InboxAction[];
  metadata: Array<{ label: string; value: string }>;
  conversation_excerpt: Array<{ author: string; body: string; created_at: string }>;
};

export type InboxItem = {
  id: string;
  kind: string;
  bucket?: InboxBucketKey;
  reason_label?: string | null;
  title: string;
  preview: string;
  source_label: string;
  status_label: string;
  attention: "normal" | "high";
  unread: boolean;
  created_at: string;
  orbit_id?: string | null;
  orbit_name?: string | null;
  navigation?: InboxNavigationTarget | null;
  detail: InboxDetail;
};

export type InboxScope = {
  orbit_id: string;
  orbit_name: string;
  orbit_slug: string;
  repository_full_name?: string | null;
  ergo_thread_id?: string | null;
  is_active: boolean;
};

export type InboxPayload = {
  me: UserSummary;
  summary: {
    needs_attention: number;
    review_queue: number;
    review_requests: number;
    blocked_work: number;
    stale_work: number;
    approvals: number;
    mentions: number;
    agent_asks: number;
    active_sources: number;
    recent_chats: number;
    recent_orbits: number;
  };
  briefing: InboxItem;
  items: InboxItem[];
  scopes: InboxScope[];
  active_scope?: InboxScope | null;
  notifications: NotificationItem[];
};
