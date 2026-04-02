"use client";

import {
  ArrowLeft,
  Bell,
  Command as CommandIcon,
  ExternalLink,
  FileCode2,
  Filter,
  GitPullRequest,
  Inbox,
  Keyboard,
  LayoutGrid,
  MailPlus,
  MessageSquare,
  MonitorPlay,
  Moon,
  Plus,
  Search,
  Settings2,
  Sun,
  User2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { OrbitChatPane, type ConversationSelection } from "@/components/orbit-chat-pane";
import { useTheme } from "@/components/theme-provider";
import {
  ActionButton,
  AppShell,
  AvatarMark,
  CenteredModal,
  cx,
  Divider,
  EmptyState as SharedEmptyState,
  FieldLabel,
  GhostButton,
  InlineNotice,
  LeftSlidePanel,
  ListRow,
  MenuItem,
  Panel,
  PageHeader,
  PageLoader,
  PopoverMenu,
  RailButton,
  RailCluster,
  RailSidebar,
  RightDetailPanel,
  ScrollPanel,
  SelectionChip,
  SectionTitle,
  ShellMain,
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
  sendChannelMessage,
  sendDmMessage,
  setPrimaryOrbitRepository,
  updateNavigation,
  updateOrbitMemberRole,
  updatePreferences,
  writeSession,
} from "@/lib/api";
import type {
  AvailableRepository,
  BoardItem,
  ConversationMessage,
  ConversationSendResult,
  DmThreadSummary,
  HumanLoopItem,
  NotificationItem,
  OrbitPayload,
  OrbitSearchResult,
  Session,
  ThemeMode,
  WorkflowRequest,
  WorkflowRun,
  WorkflowTask,
} from "@/lib/types";

const ORBIT_SECTIONS = [
  { key: "chat", label: "Chat", icon: MessageSquare },
  { key: "workflow", label: "Workflow", icon: LayoutGrid },
  { key: "prs", label: "PRs & issues", icon: GitPullRequest },
  { key: "codespaces", label: "Codespaces", icon: FileCode2 },
  { key: "demos", label: "Artifacts", icon: MonitorPlay },
] as const;

type OrbitSection = (typeof ORBIT_SECTIONS)[number]["key"];
type LeftPanelKind = "search" | "notifications" | null;
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
const RAIL_WIDTH = 88;
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

function useOutsideClose<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointer(event: MouseEvent) {
      if (!ref.current || ref.current.contains(event.target as Node)) {
        return;
      }
      onClose();
    }

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, onClose]);

  return ref;
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
      className="w-full rounded-pane border border-line bg-panelStrong px-4 py-4 text-left transition hover:bg-panelMuted"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{title}</p>
          <p className="mt-1 text-xs text-quiet">{detail}</p>
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
  const { mode, setMode } = useTheme();
  const [session, setSession] = useState<Session | null>(readSession());
  const [payload, setPayload] = useState<OrbitPayload | null>(null);
  const [section, setSection] = useState<OrbitSection>("chat");
  const [selectedConversation, setSelectedConversation] = useState<ConversationSelection | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [humanLoopItems, setHumanLoopItems] = useState<HumanLoopItem[]>([]);
  const [messageBody, setMessageBody] = useState("");
  const [conversationSearch, setConversationSearch] = useState("");
  const [activeLeftPanel, setActiveLeftPanel] = useState<LeftPanelKind>(null);
  const [detailPanel, setDetailPanel] = useState<DetailPanel>(null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showGlobalSettings, setShowGlobalSettings] = useState(false);
  const [showOrbitSettings, setShowOrbitSettings] = useState(false);
  const [showConnectRepository, setShowConnectRepository] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
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
  const [commandQuery, setCommandQuery] = useState("");
  const [remoteCommandResults, setRemoteCommandResults] = useState<OrbitSearchResult[]>([]);
  const [loadingCommandResults, setLoadingCommandResults] = useState(false);
  const [activeSavedView, setActiveSavedView] = useState<SavedViewKey>("all");
  const [updatingMemberRole, setUpdatingMemberRole] = useState<string | null>(null);
  const [activeCodespaceId, setActiveCodespaceId] = useState<string | null>(null);
  const [localAgentPending, setLocalAgentPending] = useState(false);
  const [localPendingConversation, setLocalPendingConversation] = useState<ConversationSelection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localPendingSince, setLocalPendingSince] = useState<number | null>(null);
  const previousContentSection = useRef<OrbitSection>("chat");
  const payloadRef = useRef<OrbitPayload | null>(null);
  const reloadRequestRef = useRef(0);
  const conversationRequestRef = useRef(0);
  const workflowPollRequestRef = useRef(0);
  const profileRef = useOutsideClose<HTMLDivElement>(showProfileMenu, () => setShowProfileMenu(false));

  function closeShellOverlays() {
    setActiveLeftPanel(null);
    setShowCommandPalette(false);
    setShowGlobalSettings(false);
    setShowOrbitSettings(false);
    setShowConnectRepository(false);
    setShowProfileMenu(false);
  }

  function openLeftPanel(panel: Exclude<LeftPanelKind, null>) {
    setShowCommandPalette(false);
    setShowGlobalSettings(false);
    setShowOrbitSettings(false);
    setShowConnectRepository(false);
    setShowProfileMenu(false);
    setActiveLeftPanel(panel);
  }

  function openCommandPalette() {
    setActiveLeftPanel(null);
    setShowGlobalSettings(false);
    setShowOrbitSettings(false);
    setShowConnectRepository(false);
    setShowProfileMenu(false);
    setShowCommandPalette(true);
    setCommandQuery("");
  }

  function openGlobalSettings() {
    setActiveLeftPanel(null);
    setShowCommandPalette(false);
    setShowOrbitSettings(false);
    setShowConnectRepository(false);
    setShowProfileMenu(false);
    setShowGlobalSettings(true);
  }

  function openOrbitSettings() {
    setActiveLeftPanel(null);
    setShowCommandPalette(false);
    setShowGlobalSettings(false);
    setShowConnectRepository(false);
    setShowProfileMenu(false);
    setShowOrbitSettings(true);
  }

  function toggleProfileMenu() {
    setActiveLeftPanel(null);
    setShowCommandPalette(false);
    setShowGlobalSettings(false);
    setShowOrbitSettings(false);
    setShowConnectRepository(false);
    setShowProfileMenu((current) => !current);
  }

  const selectedRun = payload?.workflow.selected_run ?? payload?.workflow.runs?.[0] ?? null;
  const selectedRunId = String(selectedRun?.id ?? "").trim();
  const workflowActive = isActiveRun(selectedRun);
  const workflowPendingInConversation = conversationMatchesRun(selectedRun, selectedConversation) && workflowActive;
  const pendingAgent =
    (localAgentPending && sameConversation(localPendingConversation, selectedConversation)) || workflowPendingInConversation;
  const workflowLanes = useMemo(() => workflowColumns(selectedRun), [selectedRun]);
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
      await loadConversation(nextSession, nextPayload, nextSelection, conversationRequestId);
      if (reloadRequestId !== reloadRequestRef.current && payloadRef.current != null) {
        return false;
      }
    } else {
      setMessages([]);
      setHumanLoopItems([]);
    }

    const nextCodespace =
      nextPayload.codespaces.find((item) => item.id === activeCodespaceId) ?? nextPayload.codespaces[0] ?? null;
    setActiveCodespaceId(nextCodespace?.id ?? null);
    return true;
  }

  async function loadConversation(
    nextSession: Session,
    nextPayload: OrbitPayload,
    nextSelection: ConversationSelection,
    requestId?: number,
    options?: { preferPayload?: boolean },
  ) {
    const currentRequestId = requestId ?? conversationRequestRef.current + 1;
    if (requestId == null) {
      conversationRequestRef.current = currentRequestId;
    }
    const payloadData = options?.preferPayload === false ? null : payloadConversationData(nextPayload, nextSelection);
    if (payloadData) {
      setMessages(payloadData.messages);
      setHumanLoopItems(payloadData.humanLoopItems);
      return;
    }
    if (nextSelection.kind === "dm") {
      const thread = await fetchDmThread(nextSession.token, orbitId, nextSelection.id);
      if (currentRequestId !== conversationRequestRef.current) {
        return;
      }
      setMessages(thread.messages);
      setHumanLoopItems(thread.human_loop_items ?? []);
      return;
    }
    const channelPayload = await fetchChannelMessages(nextSession.token, orbitId, nextSelection.id);
    if (currentRequestId !== conversationRequestRef.current) {
      return;
    }
    setMessages(channelPayload.messages);
    setHumanLoopItems(channelPayload.human_loop_items ?? []);
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
        await loadConversation(session, nextPayload, selectedConversation, undefined, { preferPayload: false });
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
    function handleShortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") {
        return;
      }
      event.preventDefault();
      openCommandPalette();
    }

    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    if (!showCommandPalette || !session) {
      return;
    }
    const term = commandQuery.trim();
    if (!term) {
      setRemoteCommandResults([]);
      setLoadingCommandResults(false);
      return;
    }
    let cancelled = false;
    setLoadingCommandResults(true);
    const handle = window.setTimeout(() => {
      void fetchOrbitSearch(session.token, orbitId, term, 18)
        .then((results) => {
          if (!cancelled) {
            setRemoteCommandResults(results);
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
  }, [showCommandPalette, session, orbitId, commandQuery]);

  const currentConversationTitle = useMemo(() => {
    if (!payload || !selectedConversation) {
      return "Chat";
    }
    if (selectedConversation.kind === "channel") {
      return payload.channels.find((channel) => channel.id === selectedConversation.id)?.name ?? "Channel";
    }
    return payload.direct_messages.find((thread) => thread.id === selectedConversation.id)?.title ?? "Direct message";
  }, [payload, selectedConversation]);

  const filteredMessages = useMemo(() => {
    const term = conversationSearch.trim().toLowerCase();
    if (!term) {
      return messages;
    }
    return messages.filter((message) => {
      const body = message.body.toLowerCase();
      const author = message.author_name.toLowerCase();
      return body.includes(term) || author.includes(term);
    });
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
          setSelectedConversation(next);
          setSection("chat");
          setActiveLeftPanel(null);
          void onSectionChange("chat");
          void loadConversation(session as Session, payload, next);
        },
      })),
      ...payload.direct_messages.map((thread) => ({
        key: `dm-${thread.id}`,
        label: thread.title,
        detail: "Direct message",
        action: () => {
          const next = { kind: "dm", id: thread.id } satisfies ConversationSelection;
          setSelectedConversation(next);
          setSection("chat");
          setActiveLeftPanel(null);
          void onSectionChange("chat");
          void loadConversation(session as Session, payload, next);
        },
      })),
      ...payload.members.map((member) => ({
        key: `member-${member.user_id}`,
        label: member.display_name || member.login || member.github_login || member.user_id,
        detail: "Member",
        action: () => {
          setShowStartDm(true);
          setDmDraft({ targetUserId: member.user_id });
          setActiveLeftPanel(null);
        },
      })),
      ...payload.prs.map((item) => ({
        key: `pr-${item.id}`,
        label: item.title,
        detail: item.repository_full_name ? `Pull request · ${item.repository_full_name}` : "Pull request",
        action: () => {
          setSection("prs");
          setDetailPanel({ kind: "pr", item });
          setActiveLeftPanel(null);
          void onSectionChange("prs");
        },
      })),
      ...payload.issues.map((item) => ({
        key: `issue-${item.id}`,
        label: item.title,
        detail: item.repository_full_name ? `Issue · ${item.repository_full_name}` : "Issue",
        action: () => {
          setSection("prs");
          setDetailPanel({ kind: "issue", item });
          setActiveLeftPanel(null);
          void onSectionChange("prs");
        },
      })),
      ...payload.codespaces.map((item) => ({
        key: `codespace-${item.id}`,
        label: item.name,
        detail: item.repository_full_name ? `Codespace · ${item.repository_full_name}` : "Codespace",
        action: () => {
          setSection("codespaces");
          setActiveCodespaceId(item.id);
          setActiveLeftPanel(null);
          void onSectionChange("codespaces");
        },
      })),
      ...artifacts.map((item) => ({
        key: `artifact-${item.id}`,
        label: item.title,
        detail: item.repository_full_name ? `Artifact · ${item.repository_full_name}` : `Artifact · ${formatStateLabel(item.artifact_kind)}`,
        action: () => {
          setSection("demos");
          setActiveLeftPanel(null);
          void onSectionChange("demos");
        },
      })),
      ...messages.filter((message) => !isLegacyWorkflowPromptMessage(message)).map((message) => ({
        key: `msg-${message.id}`,
        label: message.body,
        detail: `${message.author_name} in ${currentConversationTitle}`,
        action: () => setActiveLeftPanel(null),
      })),
    ];
    if (!term) {
      return items.slice(0, 10);
    }
    return items.filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(term)).slice(0, 14);
  }, [payload, leftSearch, messages, currentConversationTitle, session]);

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
          setDetailPanel({ kind: "pr", item: pr });
          void onSectionChange("prs");
          setActiveLeftPanel(null);
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
          setDetailPanel({ kind: "task", task });
          void onSectionChange("workflow");
          setActiveLeftPanel(null);
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
          void onSectionChange("workflow");
          setActiveLeftPanel(null);
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
          void onSectionChange("demos");
          setActiveLeftPanel(null);
        },
      });
    }

    return items;
  }, [payload, repositoryNameById, selectedRun]);

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

  const commandPaletteItems = useMemo(() => {
    if (!payload) {
      return [] as Array<{
        key: string;
        label: string;
        detail: string;
        action: () => void;
      }>;
    }
    if (commandQuery.trim()) {
      if (remoteCommandResults.length) {
        return remoteCommandResults.map((result) => ({
          key: result.key,
          label: result.label,
          detail: result.detail,
          action: () => void onSelectSearchResult(result),
        }));
      }
      return searchResults.slice(0, 10).map((item) => ({
        ...item,
        action: () => {
          item.action();
          setShowCommandPalette(false);
        },
      }));
    }
    return [
      {
        key: "cmd-chat",
        label: "Open chat",
        detail: "Move to the chat surface",
        action: () => {
          void onSectionChange("chat");
          setShowCommandPalette(false);
        },
      },
      {
        key: "cmd-workflow",
        label: "Open workflow",
        detail: "Move to the execution board",
        action: () => {
          void onSectionChange("workflow");
          setShowCommandPalette(false);
        },
      },
      {
        key: "cmd-inbox",
        label: "Open inbox",
        detail: "See mentions, approvals, and run outcomes",
        action: () => {
          openLeftPanel("notifications");
          setActiveSavedView("all");
        },
      },
      {
        key: "cmd-search",
        label: "Open orbit search",
        detail: "Browse conversations, runs, and artifacts",
        action: () => {
          openLeftPanel("search");
        },
      },
      {
        key: "cmd-create-channel",
        label: "Create channel",
        detail: "Open the channel creation modal",
        action: () => {
          setShowCreateChannel(true);
          setShowCommandPalette(false);
        },
      },
      {
        key: "cmd-start-dm",
        label: "Start direct message",
        detail: "Open the DM picker",
        action: () => {
          setShowStartDm(true);
          setShowCommandPalette(false);
        },
      },
      ...SAVED_VIEWS.filter((view) => view.key !== "all").map((view) => ({
        key: `cmd-view-${view.key}`,
        label: `${view.label} (${savedViewCounts[view.key] || 0})`,
        detail: "Open the inbox with this saved triage filter",
        action: () => {
          setActiveSavedView(view.key);
          openLeftPanel("notifications");
        },
      })),
      {
        key: "cmd-theme",
        label: mode === "dark" ? "Switch to light theme" : "Switch to dark theme",
        detail: "Toggle the product theme immediately",
        action: () => {
          void onChangeTheme(mode === "dark" ? "light" : "dark");
          setShowCommandPalette(false);
        },
      },
    ];
  }, [payload, commandQuery, remoteCommandResults, searchResults, savedViewCounts, mode]);

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

  if (!session || !payload) {
    return <PageLoader label="Loading orbit…" />;
  }

  async function onSectionChange(nextSection: OrbitSection) {
    if (!session || nextSection === section) {
      return;
    }
    if (nextSection !== "codespaces") {
      previousContentSection.current = nextSection;
    } else if (section !== "codespaces") {
      previousContentSection.current = section;
    }
    setSection(nextSection);
    await updateNavigation(session.token, { orbit_id: orbitId, section: nextSection });
  }

  async function onSelectConversation(nextSelection: ConversationSelection) {
    if (!session || !payload) {
      return;
    }
    setSelectedConversation(nextSelection);
    setConversationSearch("");
    setSection("chat");
    await updateNavigation(session.token, { orbit_id: orbitId, section: "chat" });
    await loadConversation(session, payload, nextSelection);
  }

  async function onOpenNotification(notification: NotificationItem) {
    setActiveLeftPanel(null);
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
    setShowCommandPalette(false);
    if (result.conversation_kind && result.conversation_id) {
      await onSelectConversation({ kind: result.conversation_kind, id: result.conversation_id });
      return;
    }
    if (result.section === "prs" && result.detail_kind === "pr" && result.detail_id) {
      const item = payload?.prs.find((entry) => entry.id === result.detail_id);
      if (item) {
        setDetailPanel({ kind: "pr", item });
      }
    }
    if (result.section === "prs" && result.detail_kind === "issue" && result.detail_id) {
      const item = payload?.issues.find((entry) => entry.id === result.detail_id);
      if (item) {
        setDetailPanel({ kind: "issue", item });
      }
    }
    if (result.section === "codespaces" && result.detail_id) {
      setActiveCodespaceId(result.detail_id);
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

  async function onCreateCodespace() {
    if (!session || !payload) {
      return;
    }
    try {
      const created = await createCodespace(session.token, orbitId, { name: `${payload.orbit.name} workspace` });
      setActiveCodespaceId(created.id);
      await onSectionChange("codespaces");
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

  async function onChangeTheme(nextMode: ThemeMode) {
    if (!session) {
      return;
    }
    setMode(nextMode);
    await updatePreferences(session.token, { theme_preference: nextMode });
  }

  function signOut() {
    writeSession(null);
    router.replace("/");
  }

  const selectedCodespace =
    payload.codespaces.find((item) => item.id === activeCodespaceId) ?? payload.codespaces[0] ?? null;

  const taskTimeline = detailPanel?.kind === "task" ? workflowTimeline(selectedRun, detailPanel.task) : [];
  const taskRequests =
    detailPanel?.kind === "task"
      ? [
          ...(selectedRun?.human_requests.filter((request) => request.task_id === detailPanel.task.id) ?? []),
          ...(selectedRun?.approval_requests.filter((request) => request.task_id === detailPanel.task.id) ?? []),
        ]
      : [];

  return (
    <AppShell
      sidebar={
        <RailSidebar>
          <RailCluster>
            <RailButton title="Back to dashboard" onClick={() => router.push("/app")}>
              <ArrowLeft className="h-4 w-4" />
            </RailButton>

            <div className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-panelStrong">
              <AvatarMark label={payload.orbit.name} src={payload.orbit.logo} className="h-11 w-11 rounded-[12px]" />
            </div>

            <Divider className="w-8" />

            <RailButton title="Search" onClick={() => openLeftPanel("search")}>
              <Search className="h-4 w-4" />
            </RailButton>

            <RailButton title="Command palette" onClick={openCommandPalette}>
              <CommandIcon className="h-4 w-4" />
            </RailButton>

            {ORBIT_SECTIONS.map(({ key, label, icon: Icon }) => (
              <RailButton
                key={key}
                title={label}
                active={section === key}
                onClick={() => void onSectionChange(key)}
              >
                <Icon className="h-4 w-4" />
              </RailButton>
            ))}
          </RailCluster>

          <RailCluster>
            <RailButton title="Orbit settings" onClick={openOrbitSettings}>
              <Settings2 className="h-4 w-4" />
            </RailButton>
            <RailButton title="Notifications" onClick={() => openLeftPanel("notifications")}>
              <Bell className="h-4 w-4" />
            </RailButton>
            <div className="relative" ref={profileRef}>
              <RailButton title="Profile" onClick={toggleProfileMenu}>
                <User2 className="h-4 w-4" />
              </RailButton>
              <PopoverMenu open={showProfileMenu} className="bottom-0 left-full top-auto ml-3 mt-0">
                <div className="px-3 py-2">
                  <p className="text-sm font-semibold text-ink">{session.user.display_name}</p>
                  <p className="text-xs text-quiet">{session.user.github_login}</p>
                </div>
                <MenuItem
                  onClick={() => {
                    openGlobalSettings();
                  }}
                >
                  <Settings2 className="h-4 w-4" />
                  Global settings
                </MenuItem>
                <MenuItem onClick={signOut}>
                  <ArrowLeft className="h-4 w-4" />
                  Sign out
                </MenuItem>
              </PopoverMenu>
            </div>
          </RailCluster>
        </RailSidebar>
      }
    >
      <ShellMain>
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden px-4 py-4 sm:px-5 sm:py-5 lg:px-6">
          {error ? (
            <InlineNotice className="mb-4" tone="danger" title="Orbit action blocked" detail={error} />
          ) : null}

          {section === "chat" ? (
            <OrbitChatPane
              session={session}
              channels={payload.channels}
              directMessages={payload.direct_messages}
              selectedConversation={selectedConversation}
              messages={filteredMessages}
              humanLoopItems={humanLoopItems}
              conversationTitle={currentConversationTitle}
              conversationSearch={conversationSearch}
              onConversationSearchChange={setConversationSearch}
              messageBody={messageBody}
              onMessageBodyChange={setMessageBody}
              onSendMessage={() => void onSendMessage()}
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
              <PageHeader
                eyebrow={payload.orbit.name}
                title="Execution board"
                detail="Workflow detail stays here. Chat remains clean."
                className="pb-5"
                actions={
                  <div className="flex items-center gap-2">
                    {selectedRun ? <StatusPill tone={boardTone(selectedRun.operator_status)}>{formatStateLabel(selectedRun.operator_status)}</StatusPill> : null}
                    {selectedRun ? <StatusPill tone="muted">{formatStateLabel(selectedRun.execution_status)}</StatusPill> : null}
                  </div>
                }
              />

              <Panel className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="border-b border-line px-5 py-4">
                  <SectionTitle
                    eyebrow="Workflow run"
                    title={selectedRun?.title || "No workflow yet"}
                    detail={selectedRun?.operator_summary || "Ask ERGO to build something and the board will populate here."}
                    dense
                  />
                </div>
                <ScrollPanel className="flex-1 px-5 py-5">
                  <div className="grid min-h-full gap-4 xl:grid-cols-3">
                    {workflowLanes.map((lane) => (
                      <div key={lane.key} className="flex min-h-[320px] flex-col rounded-pane border border-line bg-panelStrong p-4">
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
              <PageHeader
                eyebrow={payload.orbit.name}
                title="PRs and issues"
                detail="Review-ready code and tracked follow-up work stay repo-aware and operational."
                className="pb-5"
                actions={<GhostButton onClick={() => void onRefreshBoards()}>Sync GitHub</GhostButton>}
              />
              <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-2">
              <Panel className="flex min-h-0 flex-col overflow-hidden">
                <div className="border-b border-line px-5 py-4">
                  <SectionTitle
                    eyebrow="Pull requests"
                    title="Review-ready work"
                    detail="Operational status is clearer than a bare high/medium/low label."
                    dense
                  />
                </div>
                <ScrollPanel className="flex-1 px-5 py-5">
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

              <Panel className="flex min-h-0 flex-col overflow-hidden">
                <div className="border-b border-line px-5 py-4">
                  <SectionTitle
                    eyebrow="Issues"
                    title="Open tracked work"
                    detail="Issues stay separate from PRs so the board stays legible."
                    dense
                  />
                </div>
                <ScrollPanel className="flex-1 px-5 py-5">
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
            </div>
          ) : null}

          {section === "codespaces" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <PageHeader
                eyebrow={payload.orbit.name}
                title="Workspaces"
                detail="Branch-linked workspaces stay separate from chat and can take over the canvas when opened."
                className="pb-5"
                actions={
                  <ActionButton onClick={() => void onCreateCodespace()}>
                    <Plus className="h-4 w-4" />
                    Create workspace
                  </ActionButton>
                }
              />
              <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[320px_1fr]">
              <Panel className="flex min-h-0 flex-col overflow-hidden">
                <div className="border-b border-line px-5 py-4">
                  <SectionTitle
                    eyebrow="Codespaces"
                    title="Branch workspaces"
                    detail="Each workspace is tied to a branch-like context."
                    dense
                  />
                </div>
                <ScrollPanel className="flex-1 px-5 py-5">
                  <div className="space-y-3">
                    {payload.codespaces.length ? (
                      payload.codespaces.map((item) => (
                        <ListRow
                          key={item.id}
                          eyebrow="Workspace"
                          title={item.name}
                          detail={[item.repository_full_name, item.branch_name].filter(Boolean).join(" · ")}
                          active={activeCodespaceId === item.id}
                          trailing={<StatusPill tone={item.status === "running" ? "success" : "muted"}>{item.status}</StatusPill>}
                          onClick={() => setActiveCodespaceId(item.id)}
                        />
                      ))
                    ) : (
                      <EmptyState text="No codespaces yet. Create one and it will stay embedded here." />
                    )}
                  </div>
                </ScrollPanel>
              </Panel>

              <Panel className="flex min-h-0 flex-col overflow-hidden">
                <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
                  <div className="flex items-start gap-3">
                    <GhostButton
                      className="h-9 px-3"
                      onClick={() => void onSectionChange(previousContentSection.current || "chat")}
                    >
                      <ArrowLeft className="h-4 w-4" />
                      Back
                    </GhostButton>
                    <div>
                      <SectionTitle
                        eyebrow="Embedded workspace"
                        title={selectedCodespace?.name || "Select a codespace"}
                        detail={
                          selectedCodespace
                            ? [selectedCodespace.repository_full_name, selectedCodespace.branch_name].filter(Boolean).join(" · ")
                            : "The last active orbit section becomes the back target."
                        }
                        dense
                      />
                    </div>
                  </div>
                  {selectedCodespace?.editor_url ? (
                    <a href={selectedCodespace.editor_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-ink">
                      Open externally
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  ) : null}
                </div>

                {selectedCodespace ? (
                  selectedCodespace.editor_url ? (
                    <iframe
                      title={selectedCodespace.name}
                      src={selectedCodespace.editor_url}
                      className="h-full min-h-0 w-full flex-1 bg-white"
                    />
                  ) : (
                    <div className="flex flex-1 items-center justify-center px-8 py-8">
                      <EmptyState text="This codespace has no embeddable editor URL yet. Use the external editor link once it becomes available." />
                    </div>
                  )
                ) : (
                  <div className="flex flex-1 items-center justify-center px-8 py-8">
                    <EmptyState text="Select or create a codespace to open it inside the product shell." />
                  </div>
                )}
              </Panel>
              </div>
            </div>
          ) : null}

          {section === "demos" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <PageHeader
                eyebrow={payload.orbit.name}
                title="Artifacts"
                detail="Deliverables, previews, and publishable outputs stay linked to their repo and workflow scope."
                className="pb-5"
                actions={
                  <ActionButton onClick={() => void onPublishDemo()} disabled={!payload.permissions?.can_publish_artifact}>
                    <MonitorPlay className="h-4 w-4" />
                    Publish demo
                  </ActionButton>
                }
              />
              <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[1fr_320px]">
              <Panel className="flex min-h-0 flex-col overflow-hidden">
                <div className="border-b border-line px-5 py-4">
                  <SectionTitle
                    eyebrow="Artifacts"
                    title="Deliverables and previews"
                    detail="Draft PRs and demos stay linked to their repo scope instead of disappearing into workflow side effects."
                    dense
                  />
                </div>
                <ScrollPanel className="flex-1 px-5 py-5">
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
                <div className="border-b border-line px-5 py-4">
                  <SectionTitle
                    eyebrow="Orbit summary"
                    title={payload.orbit.name}
                    detail={payload.orbit.repo_full_name || "Repository pending"}
                    dense
                  />
                </div>
                <ScrollPanel className="flex-1 px-5 py-5">
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
        </div>

        <LeftSlidePanel
          open={activeLeftPanel === "search"}
          onClose={closeShellOverlays}
          offset={RAIL_WIDTH}
          width="min(380px, calc(100vw - 104px))"
          title="Search this orbit"
          description="Jump between conversations, members, PRs, issues, codespaces, artifacts, and clean message context."
        >
          <TextInput value={leftSearch} onChange={(event) => setLeftSearch(event.target.value)} placeholder="Search orbit surfaces" />
          <div className="mt-5 space-y-2">
            {searchResults.length ? (
              searchResults.map((item) => (
                <ListRow
                  key={item.key}
                  title={item.label}
                  detail={item.detail}
                  leading={<Search className="h-4 w-4" />}
                  onClick={item.action}
                />
              ))
            ) : (
              <EmptyState text="Nothing matched your search." />
            )}
          </div>
        </LeftSlidePanel>

        <LeftSlidePanel
          open={activeLeftPanel === "notifications"}
          onClose={closeShellOverlays}
          offset={RAIL_WIDTH}
          width="min(420px, calc(100vw - 104px))"
          title="Inbox"
          description="Triage saved views keep approvals, reviews, failures, and deliverables visible without noisy global agent presence."
        >
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
        </LeftSlidePanel>

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
          open={showCommandPalette}
          onClose={closeShellOverlays}
          title="Command palette"
          description="Jump between work, conversations, and triage views with Cmd/Ctrl+K."
          footer={
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-quiet">Typed search uses the orbit search API. Empty state shows quick actions.</p>
              <GhostButton onClick={closeShellOverlays}>Close</GhostButton>
            </div>
          }
        >
          <div className="space-y-4">
            <div className="relative">
              <Keyboard className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-quiet" />
              <TextInput
                value={commandQuery}
                onChange={(event) => setCommandQuery(event.target.value)}
                placeholder="Search or run a command"
                className="pl-10"
                autoFocus
              />
            </div>
            <div className="max-h-[420px] space-y-2 overflow-auto">
              {loadingCommandResults ? (
                <EmptyState text="Searching this orbit…" />
              ) : commandPaletteItems.length ? (
                commandPaletteItems.map((item) => (
                  <ListRow
                    key={item.key}
                    title={item.label}
                    detail={item.detail}
                    leading={<CommandIcon className="h-4 w-4" />}
                    onClick={item.action}
                  />
                ))
              ) : (
                <EmptyState text="No commands matched that search." />
              )}
            </div>
          </div>
        </CenteredModal>

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
          open={showGlobalSettings}
          onClose={closeShellOverlays}
          title="Global settings"
          description="Appearance and a few real user-facing preferences only."
          footer={
            <div className="flex items-center justify-end gap-3">
              <GhostButton onClick={closeShellOverlays}>Close</GhostButton>
            </div>
          }
        >
          <div className="space-y-5">
            <SurfaceCard className="bg-panelStrong">
              <SectionTitle eyebrow="Appearance" title="Theme" detail="Default to system, but keep the product consistent once you choose." dense />
              <div className="mt-4 flex flex-wrap gap-2">
                {[
                  { value: "system", label: "System", icon: Settings2 },
                  { value: "light", label: "Light", icon: Sun },
                  { value: "dark", label: "Dark", icon: Moon },
                ].map(({ value, label, icon: Icon }) => (
                  <SelectionChip
                    key={value}
                    active={mode === value}
                    className="px-3 py-2 text-sm"
                    onClick={() => void onChangeTheme(value as ThemeMode)}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </SelectionChip>
                ))}
              </div>
            </SurfaceCard>
            <SurfaceCard className="bg-panelStrong">
              <SectionTitle eyebrow="Identity" title={session.user.display_name} detail={session.user.github_login} dense />
              <p className="mt-3 text-sm text-quiet">GitHub remains the source of truth for identity in this V1 product.</p>
            </SurfaceCard>
          </div>
        </CenteredModal>

        <CenteredModal
          open={showOrbitSettings}
          onClose={closeShellOverlays}
          title="Orbit settings"
          description="Repo info, invite flow, and orbit-local operational settings."
          footer={
            <div className="flex items-center justify-end gap-3">
              <GhostButton onClick={closeShellOverlays}>Close</GhostButton>
            </div>
          }
        >
          <div className="space-y-5">
            <SurfaceCard className="bg-panelStrong">
              <div className="flex items-start justify-between gap-4">
                <SectionTitle
                  eyebrow="Repositories"
                  title={payload.repositories[0]?.full_name || payload.orbit.repo_full_name || "Repository pending"}
                  detail={payload.repositories.length > 1 ? `${payload.repositories.length} connected repositories` : "Primary repository drives legacy flows"}
                  dense
                />
                {payload.permissions?.can_bind_repo ? (
                  <GhostButton onClick={() => void onOpenRepositoryPicker()}>
                    <Plus className="h-4 w-4" />
                    Connect repository
                  </GhostButton>
                ) : null}
              </div>
              <div className="mt-4 space-y-3">
                {payload.repositories.length ? (
                  payload.repositories.map((repository) => {
                    const repoGrant = payload.permissions?.repo_grants?.[repository.id];
                    return (
                      <ListRow
                        key={repository.id}
                        eyebrow="Connected repository"
                        title={repository.full_name}
                        detail={`${repository.default_branch} branch${repoGrant ? ` · ${repoGrant} access` : ""}`}
                        trailing={
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            {repository.is_primary ? <StatusPill tone="accent">Primary</StatusPill> : null}
                            <StatusPill tone={repository.health_state === "healthy" ? "success" : "muted"}>{repository.health_state || "healthy"}</StatusPill>
                          </div>
                        }
                        supporting={
                          <>
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
                              <GhostButton onClick={() => void onMakeRepositoryPrimary(repository.id)}>Make primary</GhostButton>
                            ) : null}
                          </>
                        }
                      />
                    );
                  })
                ) : (
                  <p className="text-sm text-quiet">No connected repositories yet.</p>
                )}
              </div>
            </SurfaceCard>

            <SurfaceCard className="bg-panelStrong">
              <SectionTitle eyebrow="Invites" title="Invite collaborators" detail="Members are added to the repo and introduced in chat when they join." dense />
              {payload.permissions?.can_manage_members ? (
                <div className="mt-4 flex items-center gap-3">
                  <TextInput
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    placeholder="teammate@example.com"
                  />
                  <ActionButton onClick={() => void onInvite()} disabled={!inviteEmail.trim()}>
                    <MailPlus className="h-4 w-4" />
                    Invite
                  </ActionButton>
                </div>
              ) : (
                <p className="mt-4 text-sm text-quiet">Only orbit managers and owners can send invitations.</p>
              )}
            </SurfaceCard>

            <SurfaceCard className="bg-panelStrong">
              <SectionTitle
                eyebrow="Members"
                title="Workspace roles"
                detail="Orbit membership and repo scope stay separate. Owners can adjust workspace roles here."
                dense
              />
              <div className="mt-4 space-y-3">
                {payload.members.map((member) => (
                  <ListRow
                    key={member.user_id}
                    eyebrow="Member"
                    title={member.display_name || member.login || member.github_login || member.user_id}
                    detail={[member.github_login || member.login, member.is_self ? "You" : null].filter(Boolean).join(" · ")}
                    supporting={
                      <>
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
                      </>
                    }
                  />
                ))}
              </div>
            </SurfaceCard>
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
      </ShellMain>
    </AppShell>
  );
}
