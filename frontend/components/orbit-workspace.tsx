"use client";

import {
  ArrowLeft,
  Bell,
  ExternalLink,
  FileCode2,
  GitPullRequest,
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
  FieldLabel,
  GhostButton,
  IconButton,
  LeftSlidePanel,
  MenuItem,
  Panel,
  PopoverMenu,
  RightDetailPanel,
  ScrollPanel,
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
  fetchPreferences,
  inviteOrbitMember,
  publishDemo,
  readSession,
  refreshPrsIssues,
  resolveWorkflowApprovalRequest,
  sendChannelMessage,
  sendDmMessage,
  setPrimaryOrbitRepository,
  updateNavigation,
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
  OrbitPayload,
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
  { key: "demos", label: "Demos", icon: MonitorPlay },
] as const;

type OrbitSection = (typeof ORBIT_SECTIONS)[number]["key"];
type LeftPanelKind = "search" | "notifications" | null;
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

function OrbitRailButton({
  active = false,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <IconButton aria-label={title} title={title} active={active} className="h-10 w-10 rounded-[11px]" onClick={onClick}>
      {children}
    </IconButton>
  );
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
  return (
    <SurfaceCard className="border-dashed bg-panel">
      <p className="text-sm text-quiet">{text}</p>
    </SurfaceCard>
  );
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
  const [activeCodespaceId, setActiveCodespaceId] = useState<string | null>(null);
  const [localAgentPending, setLocalAgentPending] = useState(false);
  const [localPendingConversation, setLocalPendingConversation] = useState<ConversationSelection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localPendingSince, setLocalPendingSince] = useState<number | null>(null);
  const previousContentSection = useRef<OrbitSection>("chat");
  const reloadRequestRef = useRef(0);
  const conversationRequestRef = useRef(0);
  const profileRef = useOutsideClose<HTMLDivElement>(showProfileMenu, () => setShowProfileMenu(false));

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

  async function loadConversation(
    nextSession: Session,
    nextPayload: OrbitPayload,
    nextSelection: ConversationSelection,
    requestId?: number,
  ) {
    const currentRequestId = requestId ?? conversationRequestRef.current + 1;
    if (requestId == null) {
      conversationRequestRef.current = currentRequestId;
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
      const [nextPayload, preferences] = await Promise.all([
        fetchOrbit(nextSession.token, orbitId),
        fetchPreferences(nextSession.token),
      ]);
      if (reloadRequestId !== reloadRequestRef.current) {
        return;
      }
      setPayload(nextPayload);
      setError(null);

      if (preferences.theme_preference !== mode) {
        setMode(preferences.theme_preference);
      }

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
        if (reloadRequestId !== reloadRequestRef.current) {
          return;
        }
      } else {
        setMessages([]);
        setHumanLoopItems([]);
      }

      const nextCodespace =
        nextPayload.codespaces.find((item) => item.id === activeCodespaceId) ?? nextPayload.codespaces[0] ?? null;
      setActiveCodespaceId(nextCodespace?.id ?? null);
    } catch (nextError) {
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
    const handle = window.setInterval(() => {
      void reload(selectedConversation);
    }, 4000);
    return () => window.clearInterval(handle);
  }, [session, payload, workflowActive, localAgentPending, orbitId, selectedConversation]);

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

  const searchResults = useMemo(() => {
    if (!payload) {
      return [];
    }
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
        detail: "Pull request",
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
        detail: "Issue",
        action: () => {
          setSection("prs");
          setDetailPanel({ kind: "issue", item });
          setActiveLeftPanel(null);
          void onSectionChange("prs");
        },
      })),
      ...messages.map((message) => ({
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

  const notificationItems = useMemo(() => {
    if (!payload) {
      return [];
    }
    if ((payload.notifications ?? []).length) {
      return (payload.notifications ?? []).slice(0, 8).map((notification) => ({
        key: notification.id,
        label: notification.title,
        detail: notification.detail,
        tone:
          notification.kind === "approval"
            ? ("accent" as const)
            : notification.kind === "clarification"
              ? ("accent" as const)
              : ("muted" as const),
      }));
    }
    const notifications: Array<{ key: string; label: string; detail: string; tone: "muted" | "accent" | "success" | "danger" }> = [];
    for (const request of selectedRun?.approval_requests ?? []) {
      if (request.status === "requested") {
        notifications.push({
          key: `approval-${request.id}`,
          label: "Release signoff needed",
          detail: request.reason || "A run is waiting for human approval before release.",
          tone: "accent",
        });
      }
    }
    for (const request of selectedRun?.human_requests ?? []) {
      if (request.status === "open") {
        notifications.push({
          key: `human-${request.id}`,
          label: "ERGO needs clarification",
          detail: request.question || "A human answer is required to continue.",
          tone: "accent",
        });
      }
    }
    for (const task of (selectedRun?.tasks ?? []).slice(0, 4)) {
      notifications.push({
        key: `task-${task.id}`,
        label: task.title || task.task_key,
        detail: formatStateLabel(task.state),
        tone: taskTone(task.state),
      });
    }
    for (const demo of payload.demos.slice(0, 2)) {
      notifications.push({
        key: `demo-${demo.id}`,
        label: demo.title,
        detail: demo.status === "running" && demo.url ? "Demo is live" : formatStateLabel(demo.status),
        tone: demo.status === "running" ? "success" : "muted",
      });
    }
    return notifications;
  }, [payload, selectedRun]);

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
    return <div className="flex min-h-dvh items-center justify-center text-sm text-quiet">Loading orbit…</div>;
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
        <aside className="flex h-dvh w-[88px] flex-col items-center justify-between border-r border-line bg-panel px-3 py-4">
          <div className="flex flex-col items-center gap-3">
            <OrbitRailButton title="Back to dashboard" onClick={() => router.push("/app")}>
              <ArrowLeft className="h-4 w-4" />
            </OrbitRailButton>

            <div className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-panelStrong">
              <AvatarMark label={payload.orbit.name} src={payload.orbit.logo} className="h-11 w-11 rounded-[12px]" />
            </div>

            <Divider className="w-8" />

            <OrbitRailButton title="Search" onClick={() => setActiveLeftPanel("search")}>
              <Search className="h-4 w-4" />
            </OrbitRailButton>

            {ORBIT_SECTIONS.map(({ key, label, icon: Icon }) => (
              <OrbitRailButton
                key={key}
                title={label}
                active={section === key}
                onClick={() => void onSectionChange(key)}
              >
                <Icon className="h-4 w-4" />
              </OrbitRailButton>
            ))}
          </div>

          <div className="flex flex-col items-center gap-3">
            <OrbitRailButton title="Orbit settings" onClick={() => setShowOrbitSettings(true)}>
              <Settings2 className="h-4 w-4" />
            </OrbitRailButton>
            <OrbitRailButton title="Notifications" onClick={() => setActiveLeftPanel("notifications")}>
              <Bell className="h-4 w-4" />
            </OrbitRailButton>
            <div className="relative" ref={profileRef}>
              <OrbitRailButton title="Profile" onClick={() => setShowProfileMenu((current) => !current)}>
                <User2 className="h-4 w-4" />
              </OrbitRailButton>
              <PopoverMenu open={showProfileMenu} className="bottom-0 left-full top-auto ml-3 mt-0">
                <div className="px-3 py-2">
                  <p className="text-sm font-semibold text-ink">{session.user.display_name}</p>
                  <p className="text-xs text-quiet">{session.user.github_login}</p>
                </div>
                <MenuItem
                  onClick={() => {
                    setShowGlobalSettings(true);
                    setShowProfileMenu(false);
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
          </div>
        </aside>
      }
    >
      <ShellMain>
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden px-5 py-5 lg:px-6">
          {error ? (
            <SurfaceCard className="mb-4 border-red-500/20 bg-red-500/10 text-sm text-red-700 dark:text-red-300">
              {error}
            </SurfaceCard>
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
              <div className="flex items-start justify-between gap-6 pb-5">
                <div>
                  <p className="text-sm text-quiet">{payload.orbit.name}</p>
                  <h1 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-ink">
                    Execution board
                  </h1>
                  <p className="mt-2 text-sm text-quiet">
                    Workflow detail stays here. Chat remains clean.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {selectedRun ? <StatusPill tone={boardTone(selectedRun.operator_status)}>{formatStateLabel(selectedRun.operator_status)}</StatusPill> : null}
                  {selectedRun ? <StatusPill tone="muted">{formatStateLabel(selectedRun.execution_status)}</StatusPill> : null}
                </div>
              </div>

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
            <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-2">
              <Panel className="flex min-h-0 flex-col overflow-hidden">
                <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
                  <SectionTitle
                    eyebrow="Pull requests"
                    title="Review-ready work"
                    detail="Operational status is clearer than a bare high/medium/low label."
                    dense
                  />
                  <GhostButton onClick={() => void onRefreshBoards()}>Sync GitHub</GhostButton>
                </div>
                <ScrollPanel className="flex-1 px-5 py-5">
                  <div className="space-y-3">
                    {payload.prs.length ? (
                      payload.prs.map((item) => (
                        <BoardCard
                          key={item.id}
                          title={`PR #${item.number} · ${item.title}`}
                          detail={item.branch_name || "Branch not captured yet"}
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
                          detail={item.priority ? `Priority ${item.priority}` : "Tracked in GitHub"}
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
            <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[320px_1fr]">
              <Panel className="flex min-h-0 flex-col overflow-hidden">
                <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
                  <SectionTitle
                    eyebrow="Codespaces"
                    title="Branch workspaces"
                    detail="Each workspace is tied to a branch-like context."
                    dense
                  />
                  <ActionButton onClick={() => void onCreateCodespace()}>
                    <Plus className="h-4 w-4" />
                    Create
                  </ActionButton>
                </div>
                <ScrollPanel className="flex-1 px-5 py-5">
                  <div className="space-y-3">
                    {payload.codespaces.length ? (
                      payload.codespaces.map((item) => (
                        <button
                          key={item.id}
                          className={cx(
                            "w-full rounded-pane border px-4 py-4 text-left transition",
                            activeCodespaceId === item.id
                              ? "border-lineStrong bg-panel text-ink"
                              : "border-line bg-panelStrong hover:bg-panelMuted",
                          )}
                          onClick={() => setActiveCodespaceId(item.id)}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-ink">{item.name}</p>
                              <p className="mt-1 truncate text-xs text-quiet">{item.branch_name}</p>
                            </div>
                            <StatusPill tone={item.status === "running" ? "success" : "muted"}>{item.status}</StatusPill>
                          </div>
                        </button>
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
                        detail={selectedCodespace?.branch_name || "The last active orbit section becomes the back target."}
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
          ) : null}

          {section === "demos" ? (
            <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[1fr_320px]">
              <Panel className="flex min-h-0 flex-col overflow-hidden">
                <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
                  <SectionTitle
                    eyebrow="Demos"
                    title="Published previews"
                    detail="Keep this simple for now. Demos live here and surface into the dashboard when they matter."
                    dense
                  />
                  <ActionButton onClick={() => void onPublishDemo()}>
                    <MonitorPlay className="h-4 w-4" />
                    Publish demo
                  </ActionButton>
                </div>
                <ScrollPanel className="flex-1 px-5 py-5">
                  <div className="space-y-3">
                    {payload.demos.length ? (
                      payload.demos.map((demo) => (
                        <SurfaceCard key={demo.id} className="bg-panelStrong">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-ink">{demo.title}</p>
                              <p className="mt-1 truncate text-xs text-quiet">{demo.source_path}</p>
                            </div>
                            <StatusPill tone={demo.status === "running" ? "success" : "muted"}>{demo.status}</StatusPill>
                          </div>
                          {demo.url ? (
                            <a href={demo.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-ink">
                              Open demo
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          ) : null}
                        </SurfaceCard>
                      ))
                    ) : (
                      <EmptyState text="No demos are published for this orbit yet." />
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
                      <p className="font-semibold text-ink">Current demos</p>
                      <p className="mt-2 text-quiet">
                        Keep publishing lightweight. This pass does not overbuild deployment or preview orchestration.
                      </p>
                    </SurfaceCard>
                    <SurfaceCard className="bg-panelStrong">
                      <p className="font-semibold text-ink">Codespace source</p>
                      <p className="mt-2 text-quiet">
                        Demos publish from the currently selected or most recent codespace workspace path.
                      </p>
                    </SurfaceCard>
                  </div>
                </ScrollPanel>
              </Panel>
            </div>
          ) : null}
        </div>

        <LeftSlidePanel
          open={activeLeftPanel === "search"}
          onClose={() => setActiveLeftPanel(null)}
          offset={RAIL_WIDTH}
          title="Search this orbit"
          description="Jump between conversations, members, PRs, issues, and currently loaded message context."
        >
          <TextInput value={leftSearch} onChange={(event) => setLeftSearch(event.target.value)} placeholder="Search orbit surfaces" />
          <div className="mt-5 space-y-2">
            {searchResults.length ? (
              searchResults.map((item) => (
                <button
                  key={item.key}
                  className="flex w-full items-start gap-3 rounded-pane border border-line bg-panelStrong px-4 py-3 text-left transition hover:bg-panelMuted"
                  onClick={item.action}
                >
                  <Search className="mt-0.5 h-4 w-4 shrink-0 text-quiet" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{item.label}</p>
                    <p className="truncate text-xs text-quiet">{item.detail}</p>
                  </div>
                </button>
              ))
            ) : (
              <EmptyState text="Nothing matched your search." />
            )}
          </div>
        </LeftSlidePanel>

        <LeftSlidePanel
          open={activeLeftPanel === "notifications"}
          onClose={() => setActiveLeftPanel(null)}
          offset={RAIL_WIDTH}
          title="Notifications"
          description="Priority-worthy changes, broader activity, and runtime prompts live here instead of in the main canvas."
        >
          <div className="space-y-3">
            {notificationItems.length ? (
              notificationItems.map((item) => (
                <SurfaceCard key={item.key} className="bg-panelStrong">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">{item.label}</p>
                      <p className="mt-1 text-xs text-quiet">{item.detail}</p>
                    </div>
                    <StatusPill tone={item.tone}>active</StatusPill>
                  </div>
                </SurfaceCard>
              ))
            ) : (
              <EmptyState text="No important activity yet." />
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
                <button
                  key={member.user_id}
                  className={cx(
                    "flex w-full items-center gap-3 rounded-pane border px-4 py-3 text-left transition",
                    dmDraft.targetUserId === member.user_id
                      ? "border-lineStrong bg-panel"
                      : "border-line bg-panelStrong hover:bg-panelMuted",
                  )}
                  onClick={() => setDmDraft({ targetUserId: member.user_id })}
                >
                  <AvatarMark
                    label={member.display_name || member.login || member.github_login || member.user_id}
                    src={member.avatar_url}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {member.display_name || member.login || member.github_login || member.user_id}
                    </p>
                    <p className="truncate text-xs text-quiet">{member.role}</p>
                  </div>
                </button>
              ))}
            <button
              className={cx(
                "flex w-full items-center gap-3 rounded-pane border px-4 py-3 text-left transition",
                dmDraft.targetUserId === "ERGO" ? "border-lineStrong bg-panel" : "border-line bg-panelStrong hover:bg-panelMuted",
              )}
              onClick={() => setDmDraft({ targetUserId: "ERGO" })}
            >
              <AvatarMark label="ERGO" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">ERGO</p>
                <p className="truncate text-xs text-quiet">Agent DM</p>
              </div>
            </button>
          </div>
        </CenteredModal>

        <CenteredModal
          open={showGlobalSettings}
          onClose={() => setShowGlobalSettings(false)}
          title="Global settings"
          description="Appearance and a few real user-facing preferences only."
          footer={
            <div className="flex items-center justify-end gap-3">
              <GhostButton onClick={() => setShowGlobalSettings(false)}>Close</GhostButton>
            </div>
          }
        >
          <div className="space-y-5">
            <SurfaceCard className="bg-panelStrong">
              <SectionTitle eyebrow="Appearance" title="Theme" detail="Default to system, but keep the product consistent once you choose." dense />
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {[
                  { value: "system", label: "System", icon: Settings2 },
                  { value: "light", label: "Light", icon: Sun },
                  { value: "dark", label: "Dark", icon: Moon },
                ].map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    className={cx(
                      "flex items-center justify-center gap-2 rounded-chip border px-3 py-3 text-sm font-medium transition",
                      mode === value ? "border-accent bg-accent text-accentContrast" : "border-line bg-panel text-ink hover:bg-panelMuted",
                    )}
                    onClick={() => void onChangeTheme(value as ThemeMode)}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
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
          onClose={() => setShowOrbitSettings(false)}
          title="Orbit settings"
          description="Repo info, invite flow, and orbit-local operational settings."
          footer={
            <div className="flex items-center justify-end gap-3">
              <GhostButton onClick={() => setShowOrbitSettings(false)}>Close</GhostButton>
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
                      <SurfaceCard key={repository.id} className="bg-panel">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-ink">{repository.full_name}</p>
                            <p className="mt-1 truncate text-xs text-quiet">
                              {repository.default_branch} branch
                              {repoGrant ? ` · ${repoGrant} access` : ""}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            {repository.is_primary ? <StatusPill tone="accent">Primary</StatusPill> : null}
                            <StatusPill tone={repository.health_state === "healthy" ? "success" : "muted"}>{repository.health_state || "healthy"}</StatusPill>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
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
                        </div>
                      </SurfaceCard>
                    );
                  })
                ) : (
                  <p className="text-sm text-quiet">No connected repositories yet.</p>
                )}
              </div>
            </SurfaceCard>

            <SurfaceCard className="bg-panelStrong">
              <SectionTitle eyebrow="Invites" title="Invite collaborators" detail="Members are added to the repo and introduced in chat when they join." dense />
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
                  <SurfaceCard key={repository.full_name} className="bg-panelStrong">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">{repository.full_name}</p>
                        <p className="mt-1 truncate text-xs text-quiet">
                          {repository.default_branch} branch · {repository.is_private ? "Private" : "Public"}
                        </p>
                      </div>
                      <ActionButton onClick={() => void onConnectRepository(repository.full_name)}>Connect</ActionButton>
                    </div>
                  </SurfaceCard>
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
