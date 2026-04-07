"use client";

import {
  Bug,
  ExternalLink,
  FileCode2,
  Files,
  Filter,
  GitPullRequest,
  House,
  MailPlus,
  MessageSquare,
  Plus,
  Search,
  Settings2,
  Workflow,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  type AppShellConfig,
  useAuthenticatedShell,
  useAuthenticatedShellConfig,
} from "@/components/authenticated-shell";
import { OrbitChatPane, type ConversationSelection } from "@/components/orbit-chat-pane";
import { useTheme } from "@/components/theme-provider";
import {
  ActionButton,
  AvatarMark,
  CenteredModal,
  EmptyState as SharedEmptyState,
  FieldLabel,
  GhostButton,
  InlineNotice,
  ListRow,
  Panel,
  RightDetailPanel,
  ScrollPanel,
  SelectionChip,
  SectionTitle,
  ShellPage,
  ShellPageSkeleton,
  StatusPill,
  SurfaceCard,
  TextArea,
  TextInput,
} from "@/components/ui";
import {
  AuthSessionError,
  answerWorkflowHumanRequest,
  connectOrbitRepository,
  createChannel,
  createCodespace,
  createDmThread,
  fetchChatSyncBootstrap,
  fetchAvailableRepositories,
  fetchChannelMessages,
  fetchDmThread,
  fetchOrbit,
  fetchOrbitSearch,
  fetchPreferences,
  fetchWorkflow,
  inviteOrbitMember,
  publishDemo,
  readSession,
  refreshPrsIssues,
  resolveWorkflowApprovalRequest,
  retryMessageTransport,
  sendChannelMessage,
  sendDmMessage,
  setPrimaryOrbitRepository,
  updateNavigation,
  updateOrbitMemberRole,
} from "@/lib/api";
import type {
  AvailableRepository,
  BoardItem,
  ChatSyncBootstrap,
  ConversationMessage,
  ConversationSendResult,
  DmThreadSummary,
  HumanLoopItem,
  NotificationItem,
  OrbitPayload,
  OrbitSearchResult,
  Session,
  WorkflowRequest,
  WorkflowRun,
  WorkflowTask,
} from "@/lib/types";
import { MatrixChatSyncAdapter, type ConversationSelection as MatrixConversationSelection } from "@/lib/chat-sync/matrix";

const ORBIT_SECTIONS = [
  { key: "chat", label: "Chat", icon: MessageSquare },
  { key: "workflow", label: "Workflow", icon: Workflow },
  { key: "prs", label: "PRs", icon: GitPullRequest },
  { key: "issues", label: "Issues", icon: Bug },
  { key: "codespaces", label: "Codespaces", icon: FileCode2 },
  { key: "demos", label: "Artifacts", icon: Files },
] as const;

type OrbitSection = (typeof ORBIT_SECTIONS)[number]["key"];
type SavedViewKey =
  | "all"
  | "my_work"
  | "needs_approval"
  | "needs_clarification"
  | "review_queue"
  | "blocked_work"
  | "failed_runs"
  | "recent_artifacts";
type DetailPanel =
  | { kind: "task"; task: WorkflowTask }
  | { kind: "pr"; item: BoardItem }
  | { kind: "issue"; item: BoardItem }
  | null;

type ChannelDraft = { name: string };
type DmDraft = { targetUserId: string };

const CHANNEL_DRAFT: ChannelDraft = { name: "" };
const DM_DRAFT: DmDraft = { targetUserId: "" };
const LOCAL_AGENT_PENDING_TIMEOUT_MS = 120_000;
const SAVED_VIEWS: Array<{ key: SavedViewKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "my_work", label: "My work" },
  { key: "needs_approval", label: "Approvals" },
  { key: "needs_clarification", label: "Clarifications" },
  { key: "review_queue", label: "Review queue" },
  { key: "blocked_work", label: "Blocked" },
  { key: "failed_runs", label: "Failed runs" },
  { key: "recent_artifacts", label: "Artifacts" },
];

function isActiveRun(run: WorkflowRun | null) {
  if (!run) {
    return false;
  }
  const statusValues = [run.status, run.operator_status, run.execution_status].map((value) => String(value || "").toLowerCase());
  return statusValues.some((value) =>
    ["running", "active", "waiting_for_human", "waiting_for_approval", "in_progress"].includes(value),
  );
}

function conversationMatchesRun(run: WorkflowRun | null, selection: ConversationSelection | null) {
  if (!run || !selection) {
    return false;
  }
  if (selection.kind === "channel") {
    return run.source_channel_id === selection.id;
  }
  return run.source_dm_thread_id === selection.id;
}

function sameConversation(left: ConversationSelection | null, right: ConversationSelection | null) {
  if (!left || !right) {
    return false;
  }
  return left.kind === right.kind && left.id === right.id;
}

function conversationCacheKey(selection: ConversationSelection) {
  return `${selection.kind}:${selection.id}`;
}

function formatStateLabel(value: string | undefined | null) {
  const normalized = String(value || "").trim().replaceAll("_", " ");
  if (!normalized) {
    return "unknown";
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function taskTone(state: string) {
  if (state === "completed") {
    return "success" as const;
  }
  if (state === "blocked" || state === "failed") {
    return "danger" as const;
  }
  if (state === "waiting_for_human" || state === "waiting_for_approval") {
    return "accent" as const;
  }
  return "muted" as const;
}

function boardTone(status: string | undefined) {
  const normalized = String(status || "").toLowerCase();
  if (["completed", "merged", "closed"].includes(normalized)) {
    return "success" as const;
  }
  if (["blocked", "changes_requested"].includes(normalized)) {
    return "danger" as const;
  }
  if (["awaiting_review", "in_review"].includes(normalized)) {
    return "accent" as const;
  }
  return "muted" as const;
}

function OrbitSectionBar({
  label,
  detail,
  actions,
}: {
  label: string;
  detail: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold tracking-[-0.02em] text-ink">{label}</p>
        <p className="mt-1 text-xs text-quiet">{detail}</p>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

function SettingsGroup({
  eyebrow,
  title,
  detail,
  action,
  children,
}: {
  eyebrow?: string;
  title: string;
  detail?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[16px] border border-lineStrong bg-panelStrong/95">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          {eyebrow ? <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-quiet">{eyebrow}</p> : null}
          <p className="mt-1 text-sm font-semibold tracking-[-0.02em] text-ink">{title}</p>
          {detail ? <p className="mt-1 text-xs leading-5 text-quiet">{detail}</p> : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

function isLegacyWorkflowPromptMessage(message: ConversationMessage) {
  const metadata = message.metadata ?? {};
  if (metadata.workflow_prompt || metadata.workflow_prompt_type || metadata.workflow_prompt_phase) {
    return true;
  }
  if (message.author_kind !== "system") {
    return false;
  }
  return /answered an ERGO clarification request|approved an ERGO release signoff|rejected an ERGO release signoff/i.test(message.body);
}

function notificationTone(kind: string, status: string) {
  if (status === "unread" && ["approval", "clarification", "run_failed"].includes(kind)) {
    return "accent" as const;
  }
  if (["run_failed"].includes(kind)) {
    return "danger" as const;
  }
  if (["run_completed", "artifact"].includes(kind)) {
    return "success" as const;
  }
  return "muted" as const;
}

function notificationStatusLabel(item: NotificationItem) {
  if (item.status === "unread") {
    return "Unread";
  }
  return formatStateLabel(item.kind);
}

function provisionalTaskState(workItemStatus: string | undefined) {
  const normalized = String(workItemStatus || "").toLowerCase();
  if (normalized === "completed") {
    return "completed";
  }
  if (normalized === "blocked" || normalized === "failed") {
    return "blocked";
  }
  if (normalized === "queued") {
    return "ready";
  }
  return "in_progress";
}

function mergeProvisionalWorkflow(
  current: OrbitPayload,
  result: ConversationSendResult,
  requestBody: string,
): OrbitPayload {
  const workItem = result.work_item as Record<string, unknown> | null | undefined;
  if (!workItem) {
    return current;
  }
  const workflowRef = String(workItem.workflow_ref ?? workItem.workflow_run_id ?? "").trim();
  if (!workflowRef) {
    return current;
  }
  const taskState = provisionalTaskState(String(workItem.status || ""));
  const provisionalRun: WorkflowRun = {
    id: workflowRef,
    title: requestBody,
    status: taskState === "completed" ? "completed" : "running",
    operator_status: taskState === "completed" ? "completed" : "active",
    operator_summary: "ERGO accepted the request and started workflow execution.",
    execution_status: taskState === "completed" ? "completed" : "active",
    execution_summary: taskState === "completed" ? "Workflow completed." : "Dispatching worker execution.",
    tasks: [
      {
        id: String(workItem.id || workflowRef),
        task_key: "ergo_request",
        title: String(workItem.title || requestBody.slice(0, 80) || "ERGO request"),
        assigned_role: "ERGO",
        state: taskState,
        description: "Provisional task card while runtime workflow snapshot is loading.",
        worker_summary: "queued",
      },
    ],
    events: [],
    human_requests: [],
    approval_requests: [],
  };

  const existingRuns = current.workflow.runs || [];
  const dedupedRuns = [provisionalRun, ...existingRuns.filter((run) => run.id !== provisionalRun.id)];
  return {
    ...current,
    workflow: {
      ...current.workflow,
      selected_run_id: provisionalRun.id,
      selected_run: provisionalRun,
      runs: dedupedRuns,
    },
  };
}

function payloadConversationData(nextPayload: OrbitPayload, selection: ConversationSelection) {
  if (selection.kind !== "channel") {
    return null;
  }
  const general = nextPayload.channels.find((channel) => channel.slug === "general") ?? nextPayload.channels[0];
  if (!general || general.id !== selection.id) {
    return null;
  }
  return {
    messages: nextPayload.messages,
    humanLoopItems: nextPayload.human_loop_items ?? [],
  };
}

function workflowColumns(run: WorkflowRun | null) {
  const tasks = run?.tasks ?? [];
  return [
    {
      key: "ready",
      label: "Ready",
      cards: tasks.filter((task) => ["ready", "waiting_for_dependency"].includes(task.state)),
    },
    {
      key: "in_process",
      label: "In Process",
      cards: tasks.filter((task) =>
        ["in_progress", "waiting_for_human", "waiting_for_approval", "blocked"].includes(task.state),
      ),
    },
    {
      key: "completed",
      label: "Completed",
      cards: tasks.filter((task) => task.state === "completed"),
    },
  ];
}

function workflowTimeline(run: WorkflowRun | null, task: WorkflowTask | null) {
  if (!run || !task) {
    return [];
  }
  const taskKey = String(task.task_key || "").toLowerCase();
  const assignedRole = String(task.assigned_role || "").toLowerCase();
  return run.events.filter((event) => {
    const role = String(event.agent_role || "").toLowerCase();
    const message = String(event.message || "").toLowerCase();
    if (role && role === assignedRole) {
      return true;
    }
    if (taskKey && message.includes(taskKey)) {
      return true;
    }
    return false;
  });
}

function BoardCard({
  title,
  detail,
  tone,
  label,
  onClick,
}: {
  title: string;
  detail: string;
  tone: "muted" | "accent" | "success" | "danger";
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="w-full rounded-pane border border-line bg-panelStrong px-3.5 py-3 text-left transition hover:bg-panelMuted"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{title}</p>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-quiet">{detail}</p>
        </div>
        <StatusPill tone={tone}>{label}</StatusPill>
      </div>
    </button>
  );
}

function EmptyState({ text }: { text: string }) {
  return <SharedEmptyState detail={text} />;
}

export function OrbitWorkspace({ orbitId }: { orbitId: string }) {
  const router = useRouter();
  const { closeNotifications, closeSearch, openNotifications, openSearch, searchOpen } = useAuthenticatedShell();
  const { mode, setMode } = useTheme();
  const [session, setSession] = useState<Session | null>(readSession());
  const [payload, setPayload] = useState<OrbitPayload | null>(null);
  const [section, setSection] = useState<OrbitSection>("chat");
  const [selectedConversation, setSelectedConversation] = useState<ConversationSelection | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [humanLoopItems, setHumanLoopItems] = useState<HumanLoopItem[]>([]);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [messageBody, setMessageBody] = useState("");
  const [conversationSearch, setConversationSearch] = useState("");
  const [detailPanel, setDetailPanel] = useState<DetailPanel>(null);
  const [showOrbitSettings, setShowOrbitSettings] = useState(false);
  const [showConnectRepository, setShowConnectRepository] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showStartDm, setShowStartDm] = useState(false);
  const [channelDraft, setChannelDraft] = useState<ChannelDraft>(CHANNEL_DRAFT);
  const [dmDraft, setDmDraft] = useState<DmDraft>(DM_DRAFT);
  const [inviteEmail, setInviteEmail] = useState("");
  const [availableRepositories, setAvailableRepositories] = useState<AvailableRepository[]>([]);
  const [repositorySearch, setRepositorySearch] = useState("");
  const [loadingAvailableRepositories, setLoadingAvailableRepositories] = useState(false);
  const [workflowAnswers, setWorkflowAnswers] = useState<Record<string, string>>({});
  const [leftSearch, setLeftSearch] = useState("");
  const [remoteCommandResults, setRemoteCommandResults] = useState<OrbitSearchResult[]>([]);
  const [loadingCommandResults, setLoadingCommandResults] = useState(false);
  const [activeSavedView, setActiveSavedView] = useState<SavedViewKey>("all");
  const [updatingMemberRole, setUpdatingMemberRole] = useState<string | null>(null);
  const [activeCodespaceId, setActiveCodespaceId] = useState<string | null>(null);
  const [codespaceMode, setCodespaceMode] = useState<"browse" | "open">("browse");
  const [localAgentPending, setLocalAgentPending] = useState(false);
  const [localPendingConversation, setLocalPendingConversation] = useState<ConversationSelection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localPendingSince, setLocalPendingSince] = useState<number | null>(null);
  const previousContentSection = useRef<OrbitSection>("chat");
  const payloadRef = useRef<OrbitPayload | null>(null);
  const reloadRequestRef = useRef(0);
  const conversationRequestRef = useRef(0);
  const workflowPollRequestRef = useRef(0);
  const conversationCacheRef = useRef<Record<string, { messages: ConversationMessage[]; humanLoopItems: HumanLoopItem[] }>>({});
  const matrixAdapterRef = useRef<MatrixChatSyncAdapter | null>(null);
  const matrixBootstrapRef = useRef<ChatSyncBootstrap | null>(null);

  function openOrbitSettings() {
    setShowConnectRepository(false);
    setShowOrbitSettings(true);
  }

  const selectedRun = payload?.workflow.selected_run ?? payload?.workflow.runs?.[0] ?? null;
  const selectedRunId = String(selectedRun?.id ?? "").trim();
  const workflowActive = isActiveRun(selectedRun);
  const workflowPendingInConversation = conversationMatchesRun(selectedRun, selectedConversation) && workflowActive;
  const pendingAgent =
    (localAgentPending && sameConversation(localPendingConversation, selectedConversation)) || workflowPendingInConversation;
  const workflowLanes = useMemo(() => workflowColumns(selectedRun), [selectedRun]);
  const workflowMetrics = useMemo(() => {
    const tasks = selectedRun?.tasks ?? [];
    return {
      total: tasks.length,
      blocked: tasks.filter((task) => ["blocked", "failed"].includes(task.state)).length,
      waiting: tasks.filter((task) => ["waiting_for_human", "waiting_for_approval"].includes(task.state)).length,
      completed: tasks.filter((task) => task.state === "completed").length,
    };
  }, [selectedRun]);
  const selectedCodespace =
    payload?.codespaces.find((item) => item.id === activeCodespaceId) ?? payload?.codespaces[0] ?? null;
  const openHumanRequests = useMemo(
    () => Object.fromEntries((selectedRun?.human_requests ?? []).filter((request) => request.status === "open").map((request) => [request.id, request])),
    [selectedRun],
  );
  const openApprovalRequests = useMemo(
    () => Object.fromEntries((selectedRun?.approval_requests ?? []).filter((request) => request.status === "requested").map((request) => [request.id, request])),
    [selectedRun],
  );

  useEffect(() => {
    payloadRef.current = payload;
  }, [payload]);

  useEffect(() => {
    if (!selectedConversation) {
      return;
    }
    conversationCacheRef.current[conversationCacheKey(selectedConversation)] = {
      messages,
      humanLoopItems,
    };
  }, [selectedConversation, messages, humanLoopItems]);

  async function applyOrbitPayload(
    nextSession: Session,
    nextPayload: OrbitPayload,
    options: {
      reloadRequestId: number;
      requestedSelection?: ConversationSelection | null;
    },
  ) {
    const { reloadRequestId, requestedSelection } = options;
    const canHydrateOrbit = reloadRequestId === reloadRequestRef.current || payloadRef.current == null;
    if (!canHydrateOrbit) {
      return false;
    }
    setPayload(nextPayload);
    setError(null);

    const nextSection = (nextPayload.navigation?.section as OrbitSection | undefined) ?? section ?? "chat";
    if (nextSection && ORBIT_SECTIONS.some((item) => item.key === nextSection)) {
      setSection(nextSection);
      if (nextSection !== "codespaces") {
        setCodespaceMode("browse");
      }
    }

    const nextSelectedRun = nextPayload.workflow?.selected_run ?? nextPayload.workflow?.runs?.[0] ?? null;
    const nextWorkflowActive = isActiveRun(nextSelectedRun);
    if (nextWorkflowActive) {
      setLocalAgentPending(false);
      setLocalPendingConversation(null);
      setLocalPendingSince(null);
    } else if (
      localAgentPending
      && localPendingSince != null
      && Date.now() - localPendingSince > LOCAL_AGENT_PENDING_TIMEOUT_MS
    ) {
      setLocalAgentPending(false);
      setLocalPendingConversation(null);
      setLocalPendingSince(null);
    }

    const nextSelection = deriveSelection(nextPayload, requestedSelection ?? selectedConversation);
    setSelectedConversation(nextSelection);
    if (nextSelection) {
      const conversationRequestId = conversationRequestRef.current + 1;
      conversationRequestRef.current = conversationRequestId;
      void loadConversation(nextSession, nextPayload, nextSelection, conversationRequestId);
    } else {
      setMessages([]);
      setHumanLoopItems([]);
      setConversationLoading(false);
    }

    const nextCodespace =
      nextPayload.codespaces.find((item) => item.id === activeCodespaceId) ?? nextPayload.codespaces[0] ?? null;
    setActiveCodespaceId(nextCodespace?.id ?? null);
    if (!nextCodespace) {
      setCodespaceMode("browse");
    }
    return true;
  }

  async function loadConversation(
    nextSession: Session,
    nextPayload: OrbitPayload,
    nextSelection: ConversationSelection,
    requestId?: number,
    options?: { preferPayload?: boolean; silent?: boolean },
  ) {
    const currentRequestId = requestId ?? conversationRequestRef.current + 1;
    if (requestId == null) {
      conversationRequestRef.current = currentRequestId;
    }
    const cacheKey = conversationCacheKey(nextSelection);
    const cachedConversation = conversationCacheRef.current[cacheKey];
    const payloadData = options?.preferPayload === false ? null : payloadConversationData(nextPayload, nextSelection);
    if (payloadData) {
      conversationCacheRef.current[cacheKey] = payloadData;
      setMessages(payloadData.messages);
      setHumanLoopItems(payloadData.humanLoopItems);
      setConversationLoading(false);
      return;
    }
    if (cachedConversation) {
      setMessages(cachedConversation.messages);
      setHumanLoopItems(cachedConversation.humanLoopItems);
    } else if (!options?.silent) {
      setMessages([]);
      setHumanLoopItems([]);
    }
    if (!options?.silent) {
      setConversationLoading(true);
    }
    try {
      if (nextSelection.kind === "dm") {
        const thread = await fetchDmThread(nextSession.token, orbitId, nextSelection.id);
        if (currentRequestId !== conversationRequestRef.current) {
          return;
        }
        conversationCacheRef.current[cacheKey] = {
          messages: thread.messages,
          humanLoopItems: thread.human_loop_items ?? [],
        };
        setMessages(thread.messages);
        setHumanLoopItems(thread.human_loop_items ?? []);
        return;
      }
      const channelPayload = await fetchChannelMessages(nextSession.token, orbitId, nextSelection.id);
      if (currentRequestId !== conversationRequestRef.current) {
        return;
      }
      conversationCacheRef.current[cacheKey] = {
        messages: channelPayload.messages,
        humanLoopItems: channelPayload.human_loop_items ?? [],
      };
      setMessages(channelPayload.messages);
      setHumanLoopItems(channelPayload.human_loop_items ?? []);
    } finally {
      if (currentRequestId === conversationRequestRef.current && !options?.silent) {
        setConversationLoading(false);
      }
    }
  }

  async function refreshConversationOnly(
    nextSession: Session,
    nextSelection: ConversationSelection,
    options?: { silent?: boolean; preserveRequestId?: boolean },
  ) {
    const currentRequestId = options?.preserveRequestId ? conversationRequestRef.current : conversationRequestRef.current + 1;
    if (!options?.preserveRequestId) {
      conversationRequestRef.current = currentRequestId;
    }
    const cacheKey = conversationCacheKey(nextSelection);
    if (!options?.silent) {
      setConversationLoading(true);
    }
    try {
      if (nextSelection.kind === "dm") {
        const thread = await fetchDmThread(nextSession.token, orbitId, nextSelection.id);
        if (currentRequestId !== conversationRequestRef.current) {
          return;
        }
        conversationCacheRef.current[cacheKey] = {
          messages: thread.messages,
          humanLoopItems: thread.human_loop_items ?? [],
        };
        setMessages(thread.messages);
        setHumanLoopItems(thread.human_loop_items ?? []);
        return;
      }
      const channelPayload = await fetchChannelMessages(nextSession.token, orbitId, nextSelection.id);
      if (currentRequestId !== conversationRequestRef.current) {
        return;
      }
      conversationCacheRef.current[cacheKey] = {
        messages: channelPayload.messages,
        humanLoopItems: channelPayload.human_loop_items ?? [],
      };
      setMessages(channelPayload.messages);
      setHumanLoopItems(channelPayload.human_loop_items ?? []);
    } finally {
      if (!options?.silent && currentRequestId === conversationRequestRef.current) {
        setConversationLoading(false);
      }
    }
  }

  async function refreshActiveWorkflow() {
    const currentPayload = payloadRef.current;
    if (!session || !currentPayload) {
      return;
    }
    const pollRequestId = workflowPollRequestRef.current + 1;
    workflowPollRequestRef.current = pollRequestId;
    try {
      const nextWorkflow = await fetchWorkflow(session.token, orbitId);
      if (pollRequestId !== workflowPollRequestRef.current) {
        return;
      }
      const nextPayload = {
        ...currentPayload,
        workflow: nextWorkflow,
      };
      setPayload(nextPayload);
      setError(null);

      const nextSelectedRun = nextWorkflow.selected_run ?? nextWorkflow.runs?.[0] ?? null;
      const nextWorkflowActive = isActiveRun(nextSelectedRun);
      if (nextWorkflowActive) {
        setLocalAgentPending(false);
        setLocalPendingConversation(null);
        setLocalPendingSince(null);
      } else if (
        localAgentPending
        && localPendingSince != null
        && Date.now() - localPendingSince > LOCAL_AGENT_PENDING_TIMEOUT_MS
      ) {
        setLocalAgentPending(false);
        setLocalPendingConversation(null);
        setLocalPendingSince(null);
      }

      if (selectedConversation) {
        void loadConversation(session, nextPayload, selectedConversation, undefined, {
          preferPayload: false,
          silent: true,
        });
      }
      if (!nextWorkflowActive && workflowActive) {
        await reload(selectedConversation);
      }
    } catch (nextError) {
      if (nextError instanceof AuthSessionError) {
        setSession(null);
        setPayload(null);
        setMessages([]);
        setHumanLoopItems([]);
        setConversationLoading(false);
        router.replace("/");
        return;
      }
      setError(nextError instanceof Error ? nextError.message : "Unable to refresh workflow state.");
    }
  }

  function deriveSelection(nextPayload: OrbitPayload, requested?: ConversationSelection | null) {
    const availableChannelIds = new Set(nextPayload.channels.map((channel) => channel.id));
    const availableDmIds = new Set(nextPayload.direct_messages.map((thread) => thread.id));
    if (requested) {
      if (requested.kind === "channel" && availableChannelIds.has(requested.id)) {
        return requested;
      }
      if (requested.kind === "dm" && availableDmIds.has(requested.id)) {
        return requested;
      }
    }
    const general = nextPayload.channels.find((channel) => channel.slug === "general") ?? nextPayload.channels[0];
    return general ? ({ kind: "channel", id: general.id } satisfies ConversationSelection) : null;
  }

  async function reload(requestedSelection?: ConversationSelection | null) {
    const reloadRequestId = reloadRequestRef.current + 1;
    reloadRequestRef.current = reloadRequestId;
    const nextSession = readSession();
    setSession(nextSession);
    if (!nextSession) {
      router.replace("/");
      return;
    }
    try {
      const preferencesPromise = fetchPreferences(nextSession.token)
        .then((preferences) => ({ preferences, error: null as Error | null }))
        .catch((error) => ({ preferences: null, error: error as Error }));
      if (payloadRef.current == null) {
        const bootstrapPayload = await fetchOrbit(nextSession.token, orbitId, { bootstrap: true });
        await applyOrbitPayload(nextSession, bootstrapPayload, {
          reloadRequestId,
          requestedSelection,
        });
      }
      const nextPayload = await fetchOrbit(nextSession.token, orbitId);
      await applyOrbitPayload(nextSession, nextPayload, {
        reloadRequestId,
        requestedSelection,
      });

      const { preferences, error: preferenceError } = await preferencesPromise;
      if (preferenceError) {
        if (preferenceError instanceof AuthSessionError) {
          setSession(null);
          setPayload(null);
          setMessages([]);
          setHumanLoopItems([]);
          setConversationLoading(false);
          router.replace("/");
        }
        return;
      }
      if (preferences && preferences.theme_preference !== mode) {
        setMode(preferences.theme_preference);
      }
    } catch (nextError) {
      const canReportError = reloadRequestId === reloadRequestRef.current || payloadRef.current == null;
      if (!canReportError) {
        return;
      }
      if (nextError instanceof AuthSessionError) {
        setSession(null);
        setPayload(null);
        setMessages([]);
        setHumanLoopItems([]);
        setConversationLoading(false);
        router.replace("/");
        return;
      }
      setError(nextError instanceof Error ? nextError.message : "Unable to load this orbit.");
    }
  }

  useEffect(() => {
    void reload();
  }, [orbitId]);

  useEffect(() => {
    if (!session || !payload) {
      void matrixAdapterRef.current?.stop();
      matrixBootstrapRef.current = null;
      return;
    }
    let cancelled = false;
    const adapter = matrixAdapterRef.current ?? new MatrixChatSyncAdapter();
    matrixAdapterRef.current = adapter;
    void fetchChatSyncBootstrap(session.token, orbitId)
      .then(async (bootstrap) => {
        if (cancelled) {
          return;
        }
        matrixBootstrapRef.current = bootstrap;
        if (!bootstrap.enabled) {
          await adapter.stop();
          return;
        }
        await adapter.start(bootstrap, (selection: MatrixConversationSelection) => {
          if (cancelled || !session) {
            return;
          }
          if (sameConversation(selection, selectedConversation)) {
            void refreshConversationOnly(session, selection, { silent: true });
            return;
          }
          delete conversationCacheRef.current[conversationCacheKey(selection)];
        });
      })
      .catch(() => {
        matrixBootstrapRef.current = null;
      });
    return () => {
      cancelled = true;
    };
  }, [session, payload, orbitId, selectedConversation]);

  useEffect(() => {
    if (!session || !payload || (!workflowActive && !localAgentPending)) {
      return;
    }
    void refreshActiveWorkflow();
    const handle = window.setInterval(() => {
      void refreshActiveWorkflow();
    }, 4000);
    return () => window.clearInterval(handle);
  }, [session, workflowActive, localAgentPending, orbitId, selectedConversation]);

  useEffect(() => {
    if (!localAgentPending || localPendingSince == null) {
      return;
    }
    const handle = window.setInterval(() => {
      if (Date.now() - localPendingSince > LOCAL_AGENT_PENDING_TIMEOUT_MS) {
        setLocalAgentPending(false);
        setLocalPendingConversation(null);
        setLocalPendingSince(null);
      }
    }, 1000);
    return () => window.clearInterval(handle);
  }, [localAgentPending, localPendingSince]);

  useEffect(() => {
    if (!searchOpen || !session) {
      return;
    }
    const term = leftSearch.trim();
    if (!term) {
      setRemoteCommandResults([]);
      setLoadingCommandResults(false);
      return;
    }
    let cancelled = false;
    setLoadingCommandResults(true);
    const handle = window.setTimeout(() => {
      void Promise.resolve(fetchOrbitSearch(session.token, orbitId, term, 18))
        .then((results) => {
          if (!cancelled) {
            setRemoteCommandResults(Array.isArray(results) ? results : []);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setRemoteCommandResults([]);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoadingCommandResults(false);
          }
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [searchOpen, session, orbitId, leftSearch]);

  useEffect(() => {
    if (!session || !selectedConversation) {
      return;
    }
    const hasUnconfirmedMessages = messages.some((message) =>
      ["pending_remote", "failed_remote"].includes(String(message.transport_state || "").toLowerCase()),
    );
    if (!hasUnconfirmedMessages) {
      return;
    }
    const handle = window.setInterval(() => {
      void refreshConversationOnly(session, selectedConversation, { silent: true, preserveRequestId: true });
    }, 3500);
    return () => window.clearInterval(handle);
  }, [session, selectedConversation, messages]);

  const currentConversationTitle = useMemo(() => {
    if (!payload || !selectedConversation) {
      return "Chat";
    }
    if (selectedConversation.kind === "channel") {
      return payload.channels.find((channel) => channel.id === selectedConversation.id)?.name ?? "Channel";
    }
    return payload.direct_messages.find((thread) => thread.id === selectedConversation.id)?.title ?? "Direct message";
  }, [payload, selectedConversation]);

  const conversationSearchResults = useMemo(() => {
    const term = conversationSearch.trim().toLowerCase();
    if (!term) {
      return [];
    }
    return messages.filter((message) => {
      const body = message.body.toLowerCase();
      const author = message.author_name.toLowerCase();
      return body.includes(term) || author.includes(term);
    }).slice(0, 8);
  }, [conversationSearch, messages]);

  const repositoryNameById = useMemo(
    () => new Map((payload?.repositories ?? []).map((repository) => [repository.id, repository.full_name])),
    [payload],
  );

  const searchResults = useMemo(() => {
    if (!payload) {
      return [];
    }
    const artifacts = payload.artifacts ?? [];
    const term = leftSearch.trim().toLowerCase();
    const items = [
      ...payload.channels.map((channel) => ({
        key: `channel-${channel.id}`,
        label: `#${channel.name}`,
        detail: "Channel",
        action: () => {
          const next = { kind: "channel", id: channel.id } satisfies ConversationSelection;
          closeSearch();
          void onSelectConversation(next);
        },
      })),
      ...payload.direct_messages.map((thread) => ({
        key: `dm-${thread.id}`,
        label: thread.title,
        detail: "Direct message",
        action: () => {
          const next = { kind: "dm", id: thread.id } satisfies ConversationSelection;
          closeSearch();
          void onSelectConversation(next);
        },
      })),
      ...payload.members.map((member) => ({
        key: `member-${member.user_id}`,
        label: member.display_name || member.login || member.github_login || member.user_id,
        detail: "Member",
        action: () => {
          closeSearch();
          setShowStartDm(true);
          setDmDraft({ targetUserId: member.user_id });
        },
      })),
      ...payload.prs.map((item) => ({
        key: `pr-${item.id}`,
        label: item.title,
        detail: item.repository_full_name ? `Pull request · ${item.repository_full_name}` : "Pull request",
        action: () => {
          closeSearch();
          setSection("prs");
          setDetailPanel({ kind: "pr", item });
          void onSectionChange("prs");
        },
      })),
      ...payload.issues.map((item) => ({
        key: `issue-${item.id}`,
        label: item.title,
        detail: item.repository_full_name ? `Issue · ${item.repository_full_name}` : "Issue",
        action: () => {
          closeSearch();
          setSection("issues");
          setDetailPanel({ kind: "issue", item });
          void onSectionChange("issues");
        },
      })),
      ...payload.codespaces.map((item) => ({
        key: `codespace-${item.id}`,
        label: item.name,
        detail: item.repository_full_name ? `Codespace · ${item.repository_full_name}` : "Codespace",
        action: () => {
          closeSearch();
          setSection("codespaces");
          setActiveCodespaceId(item.id);
          void onSectionChange("codespaces");
        },
      })),
      ...artifacts.map((item) => ({
        key: `artifact-${item.id}`,
        label: item.title,
        detail: item.repository_full_name ? `Artifact · ${item.repository_full_name}` : `Artifact · ${formatStateLabel(item.artifact_kind)}`,
        action: () => {
          closeSearch();
          setSection("demos");
          void onSectionChange("demos");
        },
      })),
      ...messages.filter((message) => !isLegacyWorkflowPromptMessage(message)).map((message) => ({
        key: `msg-${message.id}`,
        label: message.body,
        detail: `${message.author_name} in ${currentConversationTitle}`,
        action: () => closeSearch(),
      })),
    ];
    if (!term) {
      return items.slice(0, 10);
    }
    return items.filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(term)).slice(0, 14);
  }, [payload, leftSearch, messages, currentConversationTitle, closeSearch]);

  const triageItems = useMemo(() => {
    if (!payload) {
      return [] as Array<{
        key: string;
        label: string;
        detail: string;
        tone: "muted" | "accent" | "success" | "danger";
        status: string;
        viewKeys: SavedViewKey[];
        item?: NotificationItem;
        action?: () => void;
      }>;
    }
    const items: Array<{
      key: string;
      label: string;
      detail: string;
      tone: "muted" | "accent" | "success" | "danger";
      status: string;
      viewKeys: SavedViewKey[];
      item?: NotificationItem;
      action?: () => void;
    }> = [];
    const seen = new Set<string>();
    const pushItem = (item: (typeof items)[number]) => {
      if (seen.has(item.key)) {
        return;
      }
      seen.add(item.key);
      items.push(item);
    };

    for (const notification of payload.notifications ?? []) {
      const repositoryIds = Array.isArray(notification.metadata?.repository_ids)
        ? notification.metadata.repository_ids
        : [];
      const repositoryName = typeof notification.metadata?.repository_full_name === "string"
        ? notification.metadata.repository_full_name
        : repositoryIds.map((value) => repositoryNameById.get(String(value))).find(Boolean);
      const context = repositoryName ? `${repositoryName} · ` : "";
      const viewKeys: SavedViewKey[] = ["all"];
      if (["mention", "dm", "channel_activity", "run_completed"].includes(notification.kind)) {
        viewKeys.push("my_work");
      }
      if (notification.kind === "approval") {
        viewKeys.push("needs_approval");
      }
      if (notification.kind === "clarification") {
        viewKeys.push("needs_clarification");
      }
      if (notification.kind === "run_failed") {
        viewKeys.push("blocked_work", "failed_runs");
      }
      if (notification.kind === "artifact") {
        viewKeys.push("recent_artifacts");
      }
      pushItem({
        key: notification.id,
        label: notification.title,
        detail: `${context}${notification.detail}`,
        tone: notificationTone(notification.kind, notification.status),
        status: notificationStatusLabel(notification),
        viewKeys,
        item: notification,
        action: () => void onOpenNotification(notification),
      });
    }

    for (const pr of payload.prs.filter((item) => ["awaiting_review", "changes_requested"].includes(String(item.operational_status || "").toLowerCase()))) {
      pushItem({
        key: `review-${pr.id}`,
        label: `Review queue · ${pr.title}`,
        detail: pr.repository_full_name || "Pull request awaiting review",
        tone: boardTone(pr.operational_status),
        status: formatStateLabel(pr.operational_status || pr.state),
        viewKeys: ["all", "review_queue"],
        action: () => {
          closeNotifications();
          setDetailPanel({ kind: "pr", item: pr });
          void onSectionChange("prs");
        },
      });
    }

    for (const task of (selectedRun?.tasks ?? []).filter((item) => item.state === "blocked")) {
      pushItem({
        key: `blocked-task-${task.id}`,
        label: task.title || task.task_key,
        detail: task.block_reason || task.description || "Blocked work item",
        tone: "danger",
        status: "Blocked",
        viewKeys: ["all", "blocked_work"],
        action: () => {
          closeNotifications();
          setDetailPanel({ kind: "task", task });
          void onSectionChange("workflow");
        },
      });
    }

    for (const run of payload.workflow.runs.filter((item) => String(item.status || "").toLowerCase() === "failed")) {
      pushItem({
        key: `failed-run-${run.id}`,
        label: run.title,
        detail: run.execution_summary || run.operator_summary || "Run failed",
        tone: "danger",
        status: "Failed",
        viewKeys: ["all", "blocked_work", "failed_runs"],
        action: () => {
          closeNotifications();
          void onSectionChange("workflow");
        },
      });
    }

    for (const artifact of (payload.artifacts ?? []).slice(0, 6)) {
      pushItem({
        key: `artifact-${artifact.id}`,
        label: artifact.title,
        detail: artifact.repository_full_name || artifact.summary || formatStateLabel(artifact.artifact_kind),
        tone: artifact.status === "ready" || artifact.status === "running" ? "success" : "muted",
        status: formatStateLabel(artifact.status),
        viewKeys: ["all", "recent_artifacts"],
        action: () => {
          closeNotifications();
          void onSectionChange("demos");
        },
      });
    }

    return items;
  }, [payload, repositoryNameById, selectedRun, closeNotifications]);

  const filteredTriageItems = useMemo(() => {
    if (activeSavedView === "all") {
      return triageItems;
    }
    return triageItems.filter((item) => item.viewKeys.includes(activeSavedView));
  }, [activeSavedView, triageItems]);

  const savedViewCounts = useMemo(
    () =>
      Object.fromEntries(
        SAVED_VIEWS.map((view) => [view.key, triageItems.filter((item) => item.viewKeys.includes(view.key)).length]),
      ) as Record<SavedViewKey, number>,
    [triageItems],
  );

  const shellSearchItems = useMemo(() => {
    if (!payload) {
      return [] as Array<{
        key: string;
        label: string;
        detail: string;
        action: () => void;
      }>;
    }
    if (leftSearch.trim()) {
      if (remoteCommandResults.length) {
        return remoteCommandResults.map((result) => ({
          key: result.key,
          label: result.label,
          detail: result.detail,
          action: () => void onSelectSearchResult(result),
        }));
      }
      return searchResults.slice(0, 10);
    }
    return [
      {
        key: "cmd-chat",
        label: "Open chat",
        detail: "Move to the chat surface",
        action: () => {
          closeSearch();
          void onSectionChange("chat");
        },
      },
      {
        key: "cmd-workflow",
        label: "Open workflow",
        detail: "Move to the execution board",
        action: () => {
          closeSearch();
          void onSectionChange("workflow");
        },
      },
      {
        key: "cmd-inbox",
        label: "Open inbox",
        detail: "See mentions, approvals, and run outcomes",
        action: () => {
          closeSearch();
          setActiveSavedView("all");
          openNotifications();
        },
      },
      {
        key: "cmd-create-channel",
        label: "Create channel",
        detail: "Open the channel creation modal",
        action: () => {
          closeSearch();
          setShowCreateChannel(true);
        },
      },
      {
        key: "cmd-start-dm",
        label: "Start direct message",
        detail: "Open the DM picker",
        action: () => {
          closeSearch();
          setShowStartDm(true);
        },
      },
      {
        key: "cmd-prs",
        label: "Open pull requests",
        detail: "Move to the repo review surface",
        action: () => {
          closeSearch();
          void onSectionChange("prs");
        },
      },
      {
        key: "cmd-issues",
        label: "Open issues",
        detail: "Move to the tracked issue surface",
        action: () => {
          closeSearch();
          void onSectionChange("issues");
        },
      },
      {
        key: "cmd-workspaces",
        label: "Open workspaces",
        detail: "Move to the branch workspace surface",
        action: () => {
          closeSearch();
          void onSectionChange("codespaces");
        },
      },
      ...SAVED_VIEWS.filter((view) => view.key !== "all").map((view) => ({
        key: `cmd-view-${view.key}`,
        label: `${view.label} (${savedViewCounts[view.key] || 0})`,
        detail: "Open the inbox with this saved triage filter",
        action: () => {
          closeSearch();
          setActiveSavedView(view.key);
          openNotifications();
        },
      })),
    ];
  }, [payload, leftSearch, remoteCommandResults, searchResults, savedViewCounts, closeSearch, openNotifications]);

  const connectedRepositoryIds = useMemo(() => new Set((payload?.repositories ?? []).map((repository) => repository.id)), [payload]);

  const repositoryOptions = useMemo(() => {
    const term = repositorySearch.trim().toLowerCase();
    return availableRepositories
      .filter((repository) => !connectedRepositoryIds.has(repository.id ?? ""))
      .filter((repository) => {
        if (!term) {
          return true;
        }
        return `${repository.full_name} ${repository.default_branch}`.toLowerCase().includes(term);
      });
  }, [availableRepositories, connectedRepositoryIds, repositorySearch]);

  const currentSectionLabel = ORBIT_SECTIONS.find((item) => item.key === section)?.label ?? "Orbit";
  const shellConfig = useMemo<AppShellConfig>(
    () => ({
      mode: "orbit",
      breadcrumb: payload
        ? section === "codespaces" && codespaceMode === "open" && selectedCodespace
          ? [payload.orbit.name, "Codespaces", selectedCodespace.name]
          : [payload.orbit.name, currentSectionLabel]
        : ["Orbit"],
      backAction:
        section === "codespaces" && codespaceMode === "open"
          ? () => {
              setCodespaceMode("browse");
            }
          : undefined,
      items: [
        {
          key: "dashboard",
          label: "Dashboard",
          icon: House,
          active: false,
          onSelect: () => router.push("/app"),
        },
        ...ORBIT_SECTIONS.map(({ key, label, icon }) => ({
          key,
          label,
          icon,
          active: section === key,
          onSelect: () => void onSectionChange(key),
        })),
        {
          key: "settings",
          label: "Orbit settings",
          icon: Settings2,
          active: showOrbitSettings,
          onSelect: openOrbitSettings,
        },
      ],
      search: {
        title: "Search this orbit",
        description: "Jump between conversations, work, artifacts, and triage without leaving the shell.",
        query: leftSearch,
        onQueryChange: setLeftSearch,
        placeholder: "Search this orbit or run a quick action",
        content: (
          <div className="max-h-[420px] space-y-2 overflow-auto">
            {loadingCommandResults ? (
              <EmptyState text="Searching this orbit…" />
            ) : shellSearchItems.length ? (
              shellSearchItems.map((item) => (
                <ListRow
                  key={item.key}
                  title={item.label}
                  detail={item.detail}
                  leading={<Search className="h-4 w-4" />}
                  onClick={item.action}
                />
              ))
            ) : (
              <EmptyState text="No commands or search results matched that query." />
            )}
          </div>
        ),
      },
      notifications: {
        title: "Inbox",
        description: "Saved triage views keep approvals, reviews, failures, and deliverables visible without noisy agent presence.",
        content: (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {SAVED_VIEWS.map((view) => (
                <SelectionChip
                  key={view.key}
                  active={activeSavedView === view.key}
                  onClick={() => setActiveSavedView(view.key)}
                >
                  <Filter className="h-3.5 w-3.5" />
                  {view.label}
                  <span className="text-[11px] opacity-80">{savedViewCounts[view.key] || 0}</span>
                </SelectionChip>
              ))}
            </div>
            {filteredTriageItems.length ? (
              filteredTriageItems.map((item) => (
                <ListRow
                  key={item.key}
                  eyebrow="Inbox item"
                  title={item.label}
                  detail={item.detail}
                  trailing={<StatusPill tone={item.tone}>{item.status}</StatusPill>}
                  onClick={() => (item.action ? item.action() : undefined)}
                  className={!item.action ? "pointer-events-none opacity-70" : undefined}
                />
              ))
            ) : (
              <EmptyState text="Nothing matches this saved view right now." />
            )}
          </div>
        ),
      },
    }),
    [
      payload,
      currentSectionLabel,
      section,
      codespaceMode,
      selectedCodespace,
      showOrbitSettings,
      leftSearch,
      loadingCommandResults,
      shellSearchItems,
      activeSavedView,
      savedViewCounts,
      filteredTriageItems,
      router,
    ],
  );

  useAuthenticatedShellConfig(shellConfig);

  if (!session || !payload) {
    return <ShellPageSkeleton mode="orbit" />;
  }

  async function onSectionChange(nextSection: OrbitSection) {
    if (!session || nextSection === section) {
      return;
    }
    if (nextSection !== "codespaces") {
      previousContentSection.current = nextSection;
      setCodespaceMode("browse");
    } else if (section !== "codespaces") {
      previousContentSection.current = section;
      setCodespaceMode("browse");
    }
    setSection(nextSection);
    void updateNavigation(session.token, { orbit_id: orbitId, section: nextSection }).catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : "Unable to update orbit navigation.");
    });
  }

  async function onSelectConversation(nextSelection: ConversationSelection) {
    if (!session || !payload) {
      return;
    }
    if (sameConversation(selectedConversation, nextSelection) && section === "chat") {
      return;
    }
    setSelectedConversation(nextSelection);
    setConversationSearch("");
    setSection("chat");
    void updateNavigation(session.token, { orbit_id: orbitId, section: "chat" }).catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : "Unable to update orbit navigation.");
    });
    void loadConversation(session, payload, nextSelection);
  }

  async function onOpenNotification(notification: NotificationItem) {
    closeNotifications();
    if (notification.dm_thread_id) {
      await onSelectConversation({ kind: "dm", id: notification.dm_thread_id });
      return;
    }
    if (notification.channel_id) {
      await onSelectConversation({ kind: "channel", id: notification.channel_id });
      return;
    }
    if (notification.source_kind === "artifact") {
      await onSectionChange("demos");
      return;
    }
    if (notification.source_kind === "workflow_run_status" || notification.kind.startsWith("run_")) {
      await onSectionChange("workflow");
      return;
    }
    if (notification.source_kind === "approval" || notification.source_kind === "clarification") {
      await onSectionChange("chat");
      return;
    }
  }

  async function onSelectSearchResult(result: OrbitSearchResult) {
    closeSearch();
    if (result.conversation_kind && result.conversation_id) {
      await onSelectConversation({ kind: result.conversation_kind, id: result.conversation_id });
      return;
    }
    if (result.section === "prs" && result.detail_kind === "pr" && result.detail_id) {
      const item = payload?.prs.find((entry) => entry.id === result.detail_id);
      if (item) {
        setDetailPanel({ kind: "pr", item });
        await onSectionChange("prs");
        return;
      }
    }
    if (result.section === "prs" && result.detail_kind === "issue" && result.detail_id) {
      const item = payload?.issues.find((entry) => entry.id === result.detail_id);
      if (item) {
        setDetailPanel({ kind: "issue", item });
        await onSectionChange("issues");
        return;
      }
    }
    if (result.section === "issues" && result.detail_kind === "issue" && result.detail_id) {
      const item = payload?.issues.find((entry) => entry.id === result.detail_id);
      if (item) {
        setDetailPanel({ kind: "issue", item });
        await onSectionChange("issues");
        return;
      }
    }
    if (result.section === "codespaces" && result.detail_id) {
      setActiveCodespaceId(result.detail_id);
      setCodespaceMode("open");
    }
    if (result.workflow_run_id && payload?.workflow.runs.some((run) => run.id === result.workflow_run_id)) {
      void onSectionChange("workflow");
      return;
    }
    if (result.section && ORBIT_SECTIONS.some((item) => item.key === result.section)) {
      await onSectionChange(result.section as OrbitSection);
    }
  }

  async function onCreateChannel() {
    if (!session || !channelDraft.name.trim()) {
      return;
    }
    try {
      const channel = await createChannel(session.token, orbitId, { name: channelDraft.name.trim() });
      setShowCreateChannel(false);
      setChannelDraft(CHANNEL_DRAFT);
      await reload({ kind: "channel", id: channel.id });
      setSection("chat");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to create the channel.");
    }
  }

  async function onStartDm() {
    if (!session || !dmDraft.targetUserId) {
      return;
    }
    try {
      const thread =
        dmDraft.targetUserId === "ERGO"
          ? await createDmThread(session.token, orbitId, { target_kind: "agent", target_login: "ERGO" })
          : await createDmThread(session.token, orbitId, { target_user_id: dmDraft.targetUserId });
      const next = { kind: "dm", id: thread.id } satisfies ConversationSelection;
      setShowStartDm(false);
      setDmDraft(DM_DRAFT);
      await reload(next);
      setSection("chat");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to start that direct message.");
    }
  }

  async function onSendMessage() {
    if (!session || !selectedConversation || !messageBody.trim()) {
      return;
    }
    const body = messageBody.trim();
    const optimisticId = `pending-${Date.now()}`;
    const optimisticMessage: ConversationMessage = {
      id: optimisticId,
      author_kind: "user",
      author_name: session.user.display_name,
      body,
      metadata: {},
      created_at: new Date().toISOString(),
      channel_id: selectedConversation.kind === "channel" ? selectedConversation.id : null,
      dm_thread_id: selectedConversation.kind === "dm" ? selectedConversation.id : null,
      pending: true,
    };
    setMessages((current) => [...current, optimisticMessage]);
    setMessageBody("");
    const startsWorkIntent = /@?ergo/i.test(body);
    if (startsWorkIntent) {
      setLocalAgentPending(true);
      setLocalPendingConversation(selectedConversation);
      setLocalPendingSince(Date.now());
    }

    try {
      const result =
        selectedConversation.kind === "channel"
          ? await sendChannelMessage(session.token, orbitId, selectedConversation.id, body)
          : await sendDmMessage(session.token, orbitId, selectedConversation.id, body);
      setMessages((current) => {
        const withoutPending = current.filter((message) => message.id !== optimisticId);
        const nextMessages = [...withoutPending, result.message];
        if (result.ergo) {
          nextMessages.push(result.ergo);
        }
        return nextMessages;
      });
      if (!result.work_item) {
        setLocalAgentPending(false);
        setLocalPendingConversation(null);
        setLocalPendingSince(null);
      }
      setPayload((current) => {
        if (!current) {
          return current;
        }
        return mergeProvisionalWorkflow(current, result, body);
      });
      await reload(selectedConversation);
    } catch (nextError) {
      setMessages((current) => current.filter((message) => message.id !== optimisticId));
      setLocalAgentPending(false);
      setLocalPendingConversation(null);
      setLocalPendingSince(null);
      setError(nextError instanceof Error ? nextError.message : "Unable to send the message.");
    }
  }

  async function onRetryMessage(messageId: string) {
    if (!session || !selectedConversation) {
      return;
    }
    try {
      const result = await retryMessageTransport(session.token, orbitId, messageId);
      setMessages((current) =>
        current.map((message) => (message.id === messageId ? result.message : message)),
      );
      await refreshConversationOnly(session, selectedConversation, { silent: true, preserveRequestId: true });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to retry that message.");
    }
  }

  async function onCreateCodespace() {
    if (!session || !payload) {
      return;
    }
    try {
      const created = await createCodespace(session.token, orbitId, { name: `${payload.orbit.name} workspace` });
      await onSectionChange("codespaces");
      setActiveCodespaceId(created.id);
      setCodespaceMode("open");
      await reload(selectedConversation);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to create the codespace.");
    }
  }

  async function onPublishDemo() {
    if (!session || !payload) {
      return;
    }
    const sourcePath = payload.codespaces.find((item) => item.id === activeCodespaceId)?.workspace_path ?? payload.codespaces[0]?.workspace_path;
    if (!sourcePath) {
      setError("Create a codespace first so there is something to publish.");
      return;
    }
    try {
      await publishDemo(session.token, orbitId, {
        title: `${payload.orbit.name} demo`,
        source_path: sourcePath,
      });
      await reload(selectedConversation);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to publish the demo.");
    }
  }

  async function onInvite() {
    if (!session || !inviteEmail.trim()) {
      return;
    }
    try {
      await inviteOrbitMember(session.token, orbitId, inviteEmail.trim());
      setInviteEmail("");
      await reload(selectedConversation);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to send the invite.");
    }
  }

  async function onUpdateMemberRole(memberUserId: string, role: string) {
    if (!session) {
      return;
    }
    setUpdatingMemberRole(memberUserId);
    try {
      await updateOrbitMemberRole(session.token, orbitId, memberUserId, role);
      await reload(selectedConversation);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to change that member role.");
    } finally {
      setUpdatingMemberRole(null);
    }
  }

  async function onOpenRepositoryPicker() {
    if (!session) {
      return;
    }
    setShowConnectRepository(true);
    setLoadingAvailableRepositories(true);
    setRepositorySearch("");
    try {
      const repositories = await fetchAvailableRepositories(session.token, orbitId);
      setAvailableRepositories(repositories);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to load repositories.");
    } finally {
      setLoadingAvailableRepositories(false);
    }
  }

  async function onConnectRepository(repoFullName: string) {
    if (!session) {
      return;
    }
    try {
      await connectOrbitRepository(session.token, orbitId, { repo_full_name: repoFullName, make_primary: false });
      setShowConnectRepository(false);
      setAvailableRepositories([]);
      await reload(selectedConversation);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to connect that repository.");
    }
  }

  async function onMakeRepositoryPrimary(repositoryId: string) {
    if (!session) {
      return;
    }
    try {
      await setPrimaryOrbitRepository(session.token, orbitId, repositoryId);
      await reload(selectedConversation);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to change the primary repository.");
    }
  }

  async function onAnswerHumanRequest(requestId: string) {
    if (!session || !selectedRun) {
      return;
    }
    const answerText = (workflowAnswers[requestId] || "").trim();
    if (!answerText) {
      return;
    }
    await answerWorkflowHumanRequest(session.token, orbitId, {
      workflow_run_id: selectedRun.id,
      request_id: requestId,
      answer_text: answerText,
    });
    setWorkflowAnswers((current) => ({ ...current, [requestId]: "" }));
    await reload(selectedConversation);
  }

  async function onResolveApproval(requestId: string, approved: boolean) {
    if (!session || !selectedRun) {
      return;
    }
    await resolveWorkflowApprovalRequest(session.token, orbitId, {
      workflow_run_id: selectedRun.id,
      request_id: requestId,
      approved,
    });
    await reload(selectedConversation);
  }

  async function onRefreshBoards() {
    if (!session) {
      return;
    }
    await refreshPrsIssues(session.token, orbitId);
    await reload(selectedConversation);
  }

  const taskTimeline = detailPanel?.kind === "task" ? workflowTimeline(selectedRun, detailPanel.task) : [];
  const taskRequests =
    detailPanel?.kind === "task"
      ? [
          ...(selectedRun?.human_requests.filter((request) => request.task_id === detailPanel.task.id) ?? []),
          ...(selectedRun?.approval_requests.filter((request) => request.task_id === detailPanel.task.id) ?? []),
        ]
      : [];

  return (
    <>
      <ShellPage className={section === "codespaces" && codespaceMode === "open" ? "px-0 py-0" : undefined}>
          {error ? (
            <InlineNotice className="mb-4" tone="danger" title="Orbit action blocked" detail={error} />
          ) : null}

          {section === "chat" ? (
            <OrbitChatPane
              session={session}
              channels={payload.channels}
              directMessages={payload.direct_messages}
              selectedConversation={selectedConversation}
              messages={messages}
              conversationSearchResults={conversationSearchResults}
              humanLoopItems={humanLoopItems}
              conversationLoading={conversationLoading}
              conversationTitle={currentConversationTitle}
              conversationSearch={conversationSearch}
              onConversationSearchChange={setConversationSearch}
              messageBody={messageBody}
              onMessageBodyChange={setMessageBody}
              onSendMessage={() => void onSendMessage()}
              onRetryMessage={(messageId) => void onRetryMessage(messageId)}
              humanLoopAnswers={workflowAnswers}
              onHumanLoopAnswerChange={(requestId, value) => setWorkflowAnswers((current) => ({ ...current, [requestId]: value }))}
              onSubmitHumanLoopAnswer={(requestId) => void onAnswerHumanRequest(requestId)}
              onResolveApproval={(requestId, approved) => void onResolveApproval(requestId, approved)}
              onSelectConversation={(next) => void onSelectConversation(next)}
              onOpenCreateChannel={() => setShowCreateChannel(true)}
              onOpenStartDm={() => setShowStartDm(true)}
              pendingAgent={pendingAgent}
              selectedRunId={selectedRunId}
              openHumanRequests={openHumanRequests}
              openApprovalRequests={openApprovalRequests}
              workflowAnswers={workflowAnswers}
              onWorkflowAnswerChange={(requestId, value) => setWorkflowAnswers((current) => ({ ...current, [requestId]: value }))}
              onAnswerHumanRequest={(requestId) => void onAnswerHumanRequest(requestId)}
            />
          ) : null}

          {section === "workflow" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <Panel className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <OrbitSectionBar
                  label={selectedRun?.title || "Execution board"}
                  detail={selectedRun?.operator_summary || "Workflow detail stays here. Chat remains clean."}
                  actions={
                    <div className="flex items-center gap-2">
                      {selectedRun ? <StatusPill tone={boardTone(selectedRun.operator_status)}>{formatStateLabel(selectedRun.operator_status)}</StatusPill> : null}
                      {selectedRun ? <StatusPill tone="muted">{formatStateLabel(selectedRun.execution_status)}</StatusPill> : null}
                    </div>
                  }
                />
                <ScrollPanel className="flex-1 px-3 py-3">
                  <div className="mb-3 grid gap-2 lg:grid-cols-4">
                    {[
                      { label: "Total tasks", value: workflowMetrics.total, tone: "muted" as const },
                      { label: "Blocked", value: workflowMetrics.blocked, tone: workflowMetrics.blocked ? "danger" as const : "muted" as const },
                      { label: "Waiting", value: workflowMetrics.waiting, tone: workflowMetrics.waiting ? "accent" as const : "muted" as const },
                      { label: "Completed", value: workflowMetrics.completed, tone: workflowMetrics.completed ? "success" as const : "muted" as const },
                    ].map((metric) => (
                      <SurfaceCard key={metric.label} className="bg-panelStrong p-3">
                        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-quiet">{metric.label}</p>
                        <div className="mt-2 flex items-center justify-between gap-3">
                          <p className="text-xl font-semibold tracking-[-0.03em] text-ink">{metric.value}</p>
                          <StatusPill tone={metric.tone}>{metric.value}</StatusPill>
                        </div>
                      </SurfaceCard>
                    ))}
                  </div>
                  <div className="grid min-h-0 gap-3 xl:grid-cols-3">
                  {workflowLanes.map((lane) => (
                    <div key={lane.key} className="flex min-h-[320px] flex-col rounded-pane border border-line bg-panelStrong p-3.5">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-ink">{lane.label}</p>
                        <StatusPill tone="muted">{lane.cards.length}</StatusPill>
                      </div>
                      <div className="mt-4 flex-1 space-y-3">
                        {lane.cards.length ? (
                          lane.cards.map((task) => (
                            <BoardCard
                              key={task.id}
                              title={task.title || task.task_key}
                              detail={`${task.assigned_role} · ${task.description || "Execution detail lives in the side panel."}`}
                              tone={taskTone(task.state)}
                              label={formatStateLabel(task.state)}
                              onClick={() => setDetailPanel({ kind: "task", task })}
                            />
                          ))
                        ) : (
                          <EmptyState text="Nothing in this lane right now." />
                        )}
                      </div>
                    </div>
                  ))}
                  </div>
                </ScrollPanel>
              </Panel>
            </div>
          ) : null}

          {section === "prs" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <Panel className="flex min-h-0 flex-col overflow-hidden">
                <OrbitSectionBar
                  label="Pull requests"
                  detail="Repo-aware review work with readiness and merge state kept visible."
                  actions={
                    <div className="flex items-center gap-2">
                      <StatusPill tone="muted">{payload.prs.length}</StatusPill>
                      <GhostButton onClick={() => void onRefreshBoards()}>Sync GitHub</GhostButton>
                    </div>
                  }
                />
                <ScrollPanel className="flex-1 px-4 py-4">
                  <div className="space-y-3">
                    {payload.prs.length ? (
                      payload.prs.map((item) => (
                        <BoardCard
                          key={item.id}
                          title={`PR #${item.number} · ${item.title}`}
                          detail={
                            [item.repository_full_name, item.branch_name || "Branch not captured yet"]
                              .filter(Boolean)
                              .join(" · ")
                          }
                          tone={boardTone(item.operational_status)}
                          label={formatStateLabel(item.operational_status || item.state)}
                          onClick={() => setDetailPanel({ kind: "pr", item })}
                        />
                      ))
                    ) : (
                      <EmptyState text="No pull requests are mirrored into this orbit yet." />
                    )}
                  </div>
                </ScrollPanel>
              </Panel>
            </div>
          ) : null}

          {section === "issues" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <Panel className="flex min-h-0 flex-col overflow-hidden">
                <OrbitSectionBar
                  label="Issues"
                  detail="Tracked product and engineering work stays separate from review-ready pull requests."
                  actions={
                    <div className="flex items-center gap-2">
                      <StatusPill tone="muted">{payload.issues.length}</StatusPill>
                      <GhostButton onClick={() => void onRefreshBoards()}>Sync GitHub</GhostButton>
                    </div>
                  }
                />
                <ScrollPanel className="flex-1 px-4 py-4">
                  <div className="space-y-3">
                    {payload.issues.length ? (
                      payload.issues.map((item) => (
                        <BoardCard
                          key={item.id}
                          title={`Issue #${item.number} · ${item.title}`}
                          detail={
                            [item.repository_full_name, item.priority ? `Priority ${item.priority}` : "Tracked in GitHub"]
                              .filter(Boolean)
                              .join(" · ")
                          }
                          tone={boardTone(item.operational_status)}
                          label={formatStateLabel(item.operational_status || item.state)}
                          onClick={() => setDetailPanel({ kind: "issue", item })}
                        />
                      ))
                    ) : (
                      <EmptyState text="No issues are mirrored into this orbit yet." />
                    )}
                  </div>
                </ScrollPanel>
              </Panel>
            </div>
          ) : null}

          {section === "codespaces" ? (
            codespaceMode === "open" && selectedCodespace ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-panelStrong">
                {selectedCodespace.editor_url ? (
                  <iframe
                    title={selectedCodespace.name}
                    src={selectedCodespace.editor_url}
                    className="h-full min-h-0 w-full flex-1 bg-white"
                  />
                ) : (
                  <div className="flex flex-1 items-center justify-center px-8 py-8">
                    <EmptyState text="This codespace has no embeddable editor URL yet. Use the external editor link once it becomes available." />
                  </div>
                )}
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <Panel className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <OrbitSectionBar
                    label="Workspaces"
                    detail="Open a branch workspace and it takes over the canvas. Use the top back button to return here."
                    actions={
                      <ActionButton onClick={() => void onCreateCodespace()}>
                        <Plus className="h-4 w-4" />
                        Create workspace
                      </ActionButton>
                    }
                  />
                  <ScrollPanel className="flex-1 px-4 py-4">
                    <div className="space-y-3">
                      {payload.codespaces.length ? (
                        payload.codespaces.map((item) => (
                          <ListRow
                            key={item.id}
                            title={item.name}
                            detail={[item.repository_full_name, item.branch_name].filter(Boolean).join(" · ")}
                            active={activeCodespaceId === item.id}
                            trailing={<StatusPill tone={item.status === "running" ? "success" : "muted"}>{item.status}</StatusPill>}
                            onClick={() => {
                              setActiveCodespaceId(item.id);
                              setCodespaceMode("open");
                            }}
                          />
                        ))
                      ) : (
                        <EmptyState text="No codespaces yet. Create one and it will open here." />
                      )}
                    </div>
                  </ScrollPanel>
                </Panel>
              </div>
            )
          ) : null}

          {section === "demos" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[1fr_320px]">
              <Panel className="flex min-h-0 flex-col overflow-hidden">
                <OrbitSectionBar
                  label="Artifacts"
                  detail="Deliverables, previews, and publishable outputs stay tied to repo scope instead of disappearing into workflow side effects."
                  actions={
                    <ActionButton onClick={() => void onPublishDemo()} disabled={!payload.permissions?.can_publish_artifact}>
                      <Files className="h-4 w-4" />
                      Publish demo
                    </ActionButton>
                  }
                />
                <ScrollPanel className="flex-1 px-4 py-4">
                  <div className="space-y-3">
                    {(payload.artifacts ?? []).length ? (
                      (payload.artifacts ?? []).map((artifact) => (
                        <ListRow
                          key={artifact.id}
                          eyebrow={formatStateLabel(artifact.artifact_kind)}
                          title={artifact.title}
                          detail={[artifact.repository_full_name, artifact.summary || formatStateLabel(artifact.artifact_kind)].filter(Boolean).join(" · ")}
                          trailing={
                            <StatusPill tone={artifact.status === "running" || artifact.status === "ready" ? "success" : "muted"}>
                              {formatStateLabel(artifact.status)}
                            </StatusPill>
                          }
                          supporting={
                            artifact.external_url ? (
                              <a href={artifact.external_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-ink">
                                Open artifact
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            ) : null
                          }
                        />
                      ))
                    ) : (
                      <EmptyState text="No artifacts are linked into this orbit yet." />
                    )}
                  </div>
                </ScrollPanel>
              </Panel>

              <Panel className="flex min-h-0 flex-col overflow-hidden">
                <OrbitSectionBar
                  label="Artifact context"
                  detail={payload.orbit.repo_full_name || "Repository pending"}
                />
                <ScrollPanel className="flex-1 px-4 py-4">
                  <div className="space-y-4 text-sm">
                    <SurfaceCard className="bg-panelStrong">
                      <p className="font-semibold text-ink">Repository spread</p>
                      <p className="mt-2 text-quiet">
                        {payload.repositories.length > 1
                          ? `${payload.repositories.length} repositories are bound to this orbit. Artifacts keep their repo identity when the product syncs or renders them.`
                          : "The current artifact set is still anchored to the primary repository when no secondary bindings exist."}
                      </p>
                    </SurfaceCard>
                    <SurfaceCard className="bg-panelStrong">
                      <p className="font-semibold text-ink">Codespace source</p>
                      <p className="mt-2 text-quiet">
                        Demos publish from the currently selected or most recent codespace workspace path, and the resulting artifact keeps the workspace repository binding.
                      </p>
                    </SurfaceCard>
                  </div>
                </ScrollPanel>
              </Panel>
              </div>
            </div>
          ) : null}
      </ShellPage>

        <RightDetailPanel
          open={detailPanel !== null}
          onClose={() => setDetailPanel(null)}
          title={
            detailPanel?.kind === "task"
              ? detailPanel.task.title || detailPanel.task.task_key
              : detailPanel?.item.title || "Detail"
          }
          description={
            detailPanel?.kind === "task"
              ? "Readable task progression, requests, and context."
              : detailPanel?.kind === "pr"
                ? "Pull request detail with GitHub handoff."
                : detailPanel?.kind === "issue"
                  ? "Issue detail with status and GitHub handoff."
                  : undefined
          }
        >
          {detailPanel?.kind === "task" ? (
            <div className="space-y-5">
              <SurfaceCard className="bg-panelStrong">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">{detailPanel.task.assigned_role}</p>
                    <p className="mt-1 text-xs text-quiet">{detailPanel.task.description || "No additional description provided."}</p>
                  </div>
                  <StatusPill tone={taskTone(detailPanel.task.state)}>{formatStateLabel(detailPanel.task.state)}</StatusPill>
                </div>
              </SurfaceCard>

              <div className="space-y-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-quiet">Timeline</p>
                {taskTimeline.length ? (
                  <div className="space-y-4">
                    {taskTimeline.map((event, index) => (
                      <div key={`${event.id}-${index}`} className="flex gap-3">
                        <div className="flex w-4 justify-center">
                          <div className="mt-1 h-2.5 w-2.5 rounded-full bg-accent" />
                        </div>
                        <div className="min-w-0 flex-1 pb-4">
                          <p className="text-sm font-medium text-ink">{event.message || event.event_type}</p>
                          <p className="mt-1 text-xs text-quiet">
                            {event.source}
                            {event.sequence_no ? ` · #${event.sequence_no}` : ""}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState text="No task-scoped timeline entries have been projected yet." />
                )}
              </div>

              {taskRequests.length ? (
                <div className="space-y-3">
                  <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-quiet">Requests</p>
                  {taskRequests.map((request) => (
                    <SurfaceCard key={request.id} className="bg-panelStrong">
                      <p className="text-sm font-semibold text-ink">
                        {request.question ? "Human input" : "Approval"}
                      </p>
                      <p className="mt-1 text-xs text-quiet">{request.question || request.reason || "Waiting for action."}</p>
                    </SurfaceCard>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {detailPanel?.kind === "pr" || detailPanel?.kind === "issue" ? (
            <div className="space-y-5">
              <SurfaceCard className="bg-panelStrong">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">{detailPanel.item.title}</p>
                    <p className="mt-1 text-xs text-quiet">#{detailPanel.item.number}</p>
                  </div>
                  <StatusPill tone={boardTone(detailPanel.item.operational_status)}>
                    {formatStateLabel(detailPanel.item.operational_status || detailPanel.item.state)}
                  </StatusPill>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {detailPanel.item.priority ? <StatusPill tone="muted">{detailPanel.item.priority}</StatusPill> : null}
                  {detailPanel.item.branch_name ? <StatusPill tone="muted">{detailPanel.item.branch_name}</StatusPill> : null}
                  {detailPanel.item.repository_full_name ? <StatusPill tone="muted">{detailPanel.item.repository_full_name}</StatusPill> : null}
                  {detailPanel.item.linked_workflow_run_id ? <StatusPill tone="accent">Run linked</StatusPill> : null}
                </div>
              </SurfaceCard>

              <a
                href={detailPanel.item.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-chip border border-accent bg-accent px-4 py-2.5 text-sm font-medium text-accentContrast transition hover:opacity-90"
              >
                <ExternalLink className="h-4 w-4" />
                Open on GitHub
              </a>
            </div>
          ) : null}
        </RightDetailPanel>

        <CenteredModal
          open={showCreateChannel}
          onClose={() => setShowCreateChannel(false)}
          title="Create channel"
          description="Keep the chat sidebar structured and channel-focused."
          footer={
            <div className="flex items-center justify-end gap-3">
              <GhostButton onClick={() => setShowCreateChannel(false)}>Cancel</GhostButton>
              <ActionButton onClick={() => void onCreateChannel()} disabled={!channelDraft.name.trim()}>
                Create channel
              </ActionButton>
            </div>
          }
        >
          <label className="grid gap-2">
            <FieldLabel>Channel name</FieldLabel>
            <TextInput
              value={channelDraft.name}
              onChange={(event) => setChannelDraft({ name: event.target.value })}
              placeholder="design-review"
            />
          </label>
        </CenteredModal>

        <CenteredModal
          open={showStartDm}
          onClose={() => setShowStartDm(false)}
          title="Start direct message"
          description="DMs live only inside the chat section, not as a top-level product area."
          footer={
            <div className="flex items-center justify-end gap-3">
              <GhostButton onClick={() => setShowStartDm(false)}>Cancel</GhostButton>
              <ActionButton onClick={() => void onStartDm()} disabled={!dmDraft.targetUserId}>
                Start DM
              </ActionButton>
            </div>
          }
        >
          <div className="space-y-3">
            {payload.members
              .filter((member) => !member.is_self)
              .map((member) => (
                <ListRow
                  key={member.user_id}
                  title={member.display_name || member.login || member.github_login || member.user_id}
                  detail={member.role}
                  leading={
                    <AvatarMark
                      label={member.display_name || member.login || member.github_login || member.user_id}
                      src={member.avatar_url}
                    />
                  }
                  active={dmDraft.targetUserId === member.user_id}
                  onClick={() => setDmDraft({ targetUserId: member.user_id })}
                />
              ))}
            <ListRow
              title="ERGO"
              detail="Agent DM"
              leading={<AvatarMark label="ERGO" />}
              active={dmDraft.targetUserId === "ERGO"}
              onClick={() => setDmDraft({ targetUserId: "ERGO" })}
            />
          </div>
        </CenteredModal>

        <CenteredModal
          open={showOrbitSettings}
          onClose={() => setShowOrbitSettings(false)}
          title="Orbit settings"
          description="Repo info, invite flow, and orbit-local operational settings."
          panelClassName="max-w-[760px] border-lineStrong bg-panelStrong shadow-[0_26px_72px_rgba(0,0,0,0.28)]"
          bodyClassName="px-4 py-4 sm:px-5 sm:py-4"
        >
          <div className="space-y-3">
            <SettingsGroup
              eyebrow="Repositories"
              title={payload.repositories[0]?.full_name || payload.orbit.repo_full_name || "Repository pending"}
              detail={payload.repositories.length > 1 ? `${payload.repositories.length} connected repositories` : "Primary repository drives legacy flows"}
              action={
                payload.permissions?.can_bind_repo ? (
                  <GhostButton className="h-8 px-3 text-xs" onClick={() => void onOpenRepositoryPicker()}>
                    <Plus className="h-3.5 w-3.5" />
                    Connect repository
                  </GhostButton>
                ) : null
              }
            >
              {payload.repositories.length ? (
                <div className="space-y-2">
                  {payload.repositories.map((repository) => {
                    const repoGrant = payload.permissions?.repo_grants?.[repository.id];
                    return (
                      <div key={repository.id} className="rounded-[14px] border border-line bg-panel px-3 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-ink">{repository.full_name}</p>
                            <p className="mt-1 text-xs text-quiet">
                              {repository.default_branch} branch{repoGrant ? ` · ${repoGrant} access` : ""}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {repository.is_primary ? <StatusPill tone="accent">Primary</StatusPill> : null}
                            <StatusPill tone={repository.health_state === "healthy" ? "success" : "muted"}>
                              {repository.health_state || "healthy"}
                            </StatusPill>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {repository.url ? (
                            <a
                              href={repository.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 text-sm font-medium text-ink"
                            >
                              Open GitHub repository
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          ) : null}
                          {!repository.is_primary && payload.permissions?.can_bind_repo ? (
                            <GhostButton className="h-8 px-3 text-xs" onClick={() => void onMakeRepositoryPrimary(repository.id)}>
                              Make primary
                            </GhostButton>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-quiet">No connected repositories yet.</p>
              )}
            </SettingsGroup>

            <SettingsGroup
              eyebrow="Invites"
              title="Invite collaborators"
              detail="Members are added to the repo and introduced in chat when they join."
            >
              {payload.permissions?.can_manage_members ? (
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <TextInput
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    placeholder="teammate@example.com"
                  />
                  <ActionButton className="h-10 px-4" onClick={() => void onInvite()} disabled={!inviteEmail.trim()}>
                    <MailPlus className="h-4 w-4" />
                    Invite
                  </ActionButton>
                </div>
              ) : (
                <p className="text-sm text-quiet">Only orbit managers and owners can send invitations.</p>
              )}
            </SettingsGroup>

            <SettingsGroup
              eyebrow="Members"
              title="Workspace roles"
              detail="Orbit membership and repo scope stay separate. Owners can adjust workspace roles here."
            >
              <div className="space-y-2">
                {payload.members.map((member) => (
                  <div key={member.user_id} className="rounded-[14px] border border-line bg-panel px-3 py-3">
                    <div className="flex flex-wrap items-start gap-3">
                      <AvatarMark
                        label={member.display_name || member.login || member.github_login || member.user_id}
                        className="h-8 w-8 rounded-[10px]"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">
                          {member.display_name || member.login || member.github_login || member.user_id}
                        </p>
                        <p className="mt-1 text-xs text-quiet">
                          {[member.github_login || member.login, member.is_self ? "You" : null].filter(Boolean).join(" · ")}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {[
                            { value: "owner", label: "Owner" },
                            { value: "manager", label: "Manager" },
                            { value: "contributor", label: "Contributor" },
                            { value: "viewer", label: "Viewer" },
                          ].map((option) => (
                            <SelectionChip
                              key={`${member.user_id}-${option.value}`}
                              active={member.role === option.value}
                              onClick={() => void onUpdateMemberRole(member.user_id, option.value)}
                              disabled={
                                !payload.permissions?.can_manage_roles
                                || updatingMemberRole === member.user_id
                                || member.role === option.value
                                || (member.is_self && option.value !== "owner")
                              }
                            >
                              {option.label}
                            </SelectionChip>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </SettingsGroup>
          </div>
        </CenteredModal>

        <CenteredModal
          open={showConnectRepository}
          onClose={() => setShowConnectRepository(false)}
          title="Connect repository"
          description="Bind another GitHub repository to this orbit without breaking the current primary repo flow."
          footer={
            <div className="flex items-center justify-end gap-3">
              <GhostButton onClick={() => setShowConnectRepository(false)}>Close</GhostButton>
            </div>
          }
        >
          <div className="space-y-4">
            <TextInput
              value={repositorySearch}
              onChange={(event) => setRepositorySearch(event.target.value)}
              placeholder="Search repositories"
            />
            <div className="max-h-[360px] space-y-3 overflow-auto">
              {loadingAvailableRepositories ? (
                <EmptyState text="Loading available repositories…" />
              ) : repositoryOptions.length ? (
                repositoryOptions.map((repository) => (
                  <ListRow
                    key={repository.full_name}
                    eyebrow="Available repository"
                    title={repository.full_name}
                    detail={`${repository.default_branch} branch · ${repository.is_private ? "Private" : "Public"}`}
                    trailing={<ActionButton onClick={() => void onConnectRepository(repository.full_name)}>Connect</ActionButton>}
                  />
                ))
              ) : (
                <EmptyState text="No additional repositories are available to connect." />
              )}
            </div>
          </div>
        </CenteredModal>
    </>
  );
}
