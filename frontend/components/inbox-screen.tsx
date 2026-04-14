"use client";

import {
  AtSign,
  Bot,
  ChevronDown,
  ChevronRight,
  Inbox as InboxIcon,
  Paperclip,
  Plus,
  Search,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  type AppShellConfig,
  useAuthenticatedShell,
  useAuthenticatedShellConfig,
} from "@/components/authenticated-shell";
import { useTheme } from "@/components/theme-provider";
import {
  ActionButton,
  AvatarMark,
  CenteredModal,
  EmptyState,
  GhostButton,
  InlineNotice,
  ListRow,
  ScrollPanel,
  SelectionChip,
  ShellPage,
  ShellPageSkeleton,
  StatusPill,
  TextArea,
  cx,
} from "@/components/ui";
import {
  AuthSessionError,
  createDmThread,
  createOrbit,
  fetchDmThread,
  fetchInbox,
  fetchPreferences,
  readSession,
  sendDmMessage,
  updateNavigation,
} from "@/lib/api";
import { buildPrimaryShellItems } from "@/lib/app-shell-nav";
import type {
  ConversationMessage,
  HumanLoopItem,
  InboxAction,
  InboxItem,
  InboxNavigationTarget,
  InboxPayload,
  InboxScope,
  Orbit,
} from "@/lib/types";

type OrbitDraft = {
  name: string;
  description: string;
  logo: string;
  logoFileName: string;
  inviteEmails: string;
  private: boolean;
};

type InboxTabKey = "inbox" | "chats" | "sources";
type MobileSurface = "list" | "chat";

const EMPTY_ORBIT_DRAFT: OrbitDraft = {
  name: "",
  description: "",
  logo: "",
  logoFileName: "",
  inviteEmails: "",
  private: true,
};

const INBOX_TABS: Array<{ key: InboxTabKey; label: string }> = [
  { key: "inbox", label: "Inbox" },
  { key: "chats", label: "Chats" },
  { key: "sources", label: "Sources" },
];

const COMPOSER_MODES = [
  { key: "brief", label: "Brief" },
  { key: "triage", label: "Triage" },
  { key: "deep_dive", label: "Deep dive" },
] as const;

const MENTION_TOKENS = ["@ERGO", "@workflow", "@sources"];

function isImageLogo(value?: string | null) {
  return Boolean(value && (value.startsWith("data:") || value.startsWith("http")));
}

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function attentionTone(item: InboxItem) {
  if (item.attention === "high") {
    return item.kind === "source" ? ("success" as const) : ("accent" as const);
  }
  if (item.kind === "source") {
    return "success" as const;
  }
  return "muted" as const;
}

function itemMatchesTab(item: InboxItem, tab: InboxTabKey) {
  if (tab === "inbox") {
    return true;
  }
  if (tab === "chats") {
    return ["briefing", "briefing_chat", "chat", "mention", "dm", "clarification"].includes(item.kind);
  }
  return ["source", "artifact"].includes(item.kind);
}

function RecentOrbitSidebarContent({
  scopes,
  onSelectOrbit,
}: {
  scopes: InboxScope[];
  onSelectOrbit: (orbitId: string) => void;
}) {
  const { sidebarCollapsed } = useAuthenticatedShell();

  return (
    <div className="space-y-1.5">
      {scopes.length ? (
        scopes.slice(0, 5).map((scope) => (
          <button
            key={scope.orbit_id}
            type="button"
            title={scope.orbit_name}
            aria-label={scope.orbit_name}
            onClick={() => onSelectOrbit(scope.orbit_id)}
            className={cx(
              "group flex min-h-[36px] w-full items-center gap-2 overflow-hidden rounded-[10px] py-1.5 text-left transition-[background-color,color,transform] duration-200 ease-productive hover:bg-shellMuted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focusRing focus-visible:ring-offset-0 active:scale-[0.99] motion-reduce:transform-none motion-reduce:transition-none",
              sidebarCollapsed ? "justify-start px-0 pl-[9px]" : "justify-start pl-[9px] pr-2.5 text-[#a6a9b0]",
            )}
          >
            <div className={cx("h-[20px] w-[20px] rounded-[8px]", scope.is_active ? "bg-[#e8e7e1]" : "bg-shellMuted")} />
            <span
              className={cx(
                "min-w-0 overflow-hidden whitespace-nowrap text-[13px] font-medium transition-[max-width,opacity] duration-200 ease-productive motion-reduce:transition-none group-hover:text-ink",
                scope.is_active ? "text-ink" : "text-[#a6a9b0]",
                sidebarCollapsed ? "max-w-0 opacity-0" : "max-w-[120px] opacity-100",
              )}
            >
              {scope.orbit_name}
            </span>
          </button>
        ))
      ) : (
        !sidebarCollapsed ? <p className="px-2.5 text-xs text-quiet">No recent orbits yet.</p> : null
      )}
    </div>
  );
}

function RecentOrbitSidebarSkeleton() {
  const { sidebarCollapsed } = useAuthenticatedShell();

  return (
    <div className="space-y-1.5">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className={cx(
            "flex min-h-[36px] w-full items-center gap-2 rounded-[10px] py-1.5",
            sidebarCollapsed ? "justify-start px-0 pl-[9px]" : "justify-start pl-[9px] pr-2.5",
          )}
        >
          <div className="h-[18px] w-[18px] rounded-[6px] bg-shellMuted" />
          <div className={cx("h-3 rounded-full bg-shellMuted", sidebarCollapsed ? "hidden" : "w-20")} />
        </div>
      ))}
    </div>
  );
}

function InboxRow({
  item,
  active,
  onClick,
}: {
  item: InboxItem;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "w-full rounded-[16px] border px-4 py-3 text-left transition-[background-color,border-color,box-shadow,transform] duration-200 ease-productive hover:border-lineStrong hover:bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focusRing focus-visible:ring-offset-0 active:scale-[0.995]",
        active
          ? "border-lineStrong bg-panel shadow-[inset_0_0_0_1px_var(--aw-border-strong)]"
          : "border-line bg-panelStrong",
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cx("mt-1.5 flex h-2.5 w-2.5 shrink-0 rounded-full", item.unread ? "bg-accent/80" : "bg-line")} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium uppercase tracking-[0.14em] text-quiet">
            <span>{item.source_label || "Inbox"}</span>
            <span className="h-1 w-1 rounded-full bg-faint/70" />
            <span>{formatTimestamp(item.created_at)}</span>
          </div>
          <div className="mt-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-[-0.02em] text-ink">{item.title}</p>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-quiet">{item.preview}</p>
            </div>
            <StatusPill tone={attentionTone(item)}>{item.status_label}</StatusPill>
          </div>
        </div>
      </div>
    </button>
  );
}

function isHumanMessage(message: ConversationMessage) {
  return ["human", "user"].includes(String(message.author_kind || "").toLowerCase());
}

function ErgoConversation({
  activeScope,
  selectedItem,
  messages,
  humanLoopItems,
  loading,
  composer,
  onComposerChange,
  composerMode,
  onComposerModeChange,
  stagedFiles,
  onAttachmentClick,
  onFilesSelected,
  onInsertMention,
  onAction,
  onSend,
  sending,
  attachmentInputRef,
}: {
  activeScope: InboxScope | null;
  selectedItem: InboxItem | null;
  messages: ConversationMessage[];
  humanLoopItems: HumanLoopItem[];
  loading: boolean;
  composer: string;
  onComposerChange: (value: string) => void;
  composerMode: (typeof COMPOSER_MODES)[number]["key"];
  onComposerModeChange: (value: (typeof COMPOSER_MODES)[number]["key"]) => void;
  stagedFiles: File[];
  onAttachmentClick: () => void;
  onFilesSelected: (files: File[]) => void;
  onInsertMention: (token: string) => void;
  onAction: (action: InboxAction) => void;
  onSend: () => void;
  sending: boolean;
  attachmentInputRef: { current: HTMLInputElement | null };
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line px-4 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-[-0.02em] text-ink">{activeScope?.orbit_name ?? "ERGO"}</p>
            <p className="text-[11px] text-quiet">{activeScope?.repository_full_name ?? "Orbit context pending"}</p>
          </div>
          {selectedItem ? <StatusPill tone={attentionTone(selectedItem)}>{selectedItem.status_label}</StatusPill> : null}
        </div>
        {selectedItem ? (
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3 border-t border-line pt-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-ink">{selectedItem.title}</p>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-quiet">{selectedItem.detail.summary}</p>
            </div>
            {selectedItem.detail.next_actions.length ? (
              <div className="flex flex-wrap gap-2">
                {selectedItem.detail.next_actions.slice(0, 2).map((action) => (
                  <GhostButton key={action.label} className="px-2.5 py-1.5 text-[11px]" onClick={() => onAction(action)}>
                    {action.label}
                    <ChevronRight className="h-3.5 w-3.5" />
                  </GhostButton>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <ScrollPanel className="flex-1 px-4 py-2.5">
        {loading ? (
          <EmptyState title="Loading ERGO thread" detail="Pulling the current orbit thread and any pending operational follow-up." />
        ) : messages.length || humanLoopItems.length ? (
          <div className="space-y-2.5">
            {messages.map((message) => {
              const mine = isHumanMessage(message);
              return (
                <div key={message.id} className={cx("flex", mine ? "justify-end" : "justify-start")}>
                  <div
                    className={cx(
                      "max-w-[min(100%,40rem)] rounded-[16px] border px-3.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]",
                      mine ? "border-accent/30 bg-accent/12 text-ink" : "border-line bg-panelStrong text-ink",
                    )}
                  >
                    <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em]">
                      <span className={mine ? "text-accent" : "text-quiet"}>{message.author_name || (mine ? "You" : "ERGO")}</span>
                      <span className={mine ? "text-accent/70" : "text-faint"}>{formatTimestamp(message.created_at)}</span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{message.body}</p>
                  </div>
                </div>
              );
            })}

            {humanLoopItems.length ? (
              <div className="space-y-3 border-t border-line pt-4">
                {humanLoopItems.map((item) => (
                  <div key={item.id} className="rounded-[16px] border border-line bg-panel px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold tracking-[-0.02em] text-ink">{item.title}</p>
                        <p className="mt-2 text-sm leading-6 text-quiet">{item.detail}</p>
                      </div>
                      <StatusPill tone={item.status === "resolved" ? "success" : "warning"}>{item.status}</StatusPill>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <EmptyState
            title="No ERGO thread yet"
            detail="Start the orbit thread here. New messages stay paired with inbox context, review state, and the active scope."
            action={
              <div className="flex flex-wrap gap-2">
                {MENTION_TOKENS.map((token) => (
                  <GhostButton key={token} className="px-3 py-2 text-xs" onClick={() => onInsertMention(token)}>
                    <AtSign className="h-3.5 w-3.5" />
                    {token.replace("@", "")}
                  </GhostButton>
                ))}
              </div>
            }
          />
        )}
      </ScrollPanel>

      <div className="border-t border-line px-4 py-2.5">
        <div className="rounded-[18px] border border-lineStrong bg-panel px-4 py-3 shadow-[0_16px_34px_rgba(0,0,0,0.16)]">
          <div className="flex items-start gap-3">
            <div className="hidden rounded-[18px] border border-line bg-panelStrong p-2.5 text-quiet sm:flex">
              <Bot className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <TextArea
                value={composer}
                onChange={(event) => onComposerChange(event.target.value)}
                placeholder="Message ERGO about this orbit"
                className="min-h-[72px] border-none bg-transparent px-0 py-0 text-[15px] leading-7 focus:bg-transparent focus-visible:ring-0"
              />

              {stagedFiles.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {stagedFiles.map((file) => (
                    <SelectionChip key={file.name} className="cursor-default border-line bg-panelStrong text-ink hover:bg-panelStrong">
                      <Paperclip className="h-3.5 w-3.5" />
                      {file.name}
                    </SelectionChip>
                  ))}
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <GhostButton className="px-3 py-2 text-xs" onClick={onAttachmentClick}>
                    <Paperclip className="h-3.5 w-3.5" />
                    Attach
                  </GhostButton>
                  <input
                    ref={attachmentInputRef}
                    type="file"
                    className="hidden"
                    multiple
                    onChange={(event) => onFilesSelected(Array.from(event.target.files ?? []))}
                  />
                  <div className="flex flex-wrap gap-2">
                    {MENTION_TOKENS.map((token) => (
                      <SelectionChip key={token} onClick={() => onInsertMention(token)}>
                        <AtSign className="h-3.5 w-3.5" />
                        {token.replace("@", "")}
                      </SelectionChip>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {COMPOSER_MODES.map((mode) => (
                    <SelectionChip key={mode.key} active={composerMode === mode.key} onClick={() => onComposerModeChange(mode.key)}>
                      {mode.label}
                    </SelectionChip>
                  ))}
                  <ActionButton onClick={onSend} disabled={sending || !composer.trim() || !activeScope}>
                    {sending ? "Sending…" : "Send to ERGO"}
                  </ActionButton>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function InboxScreen({ mode: surfaceMode = "inbox" }: { mode?: "inbox" | "chat" } = {}) {
  const router = useRouter();
  const { mode: themeMode, setMode } = useTheme();
  const [session, setSession] = useState(readSession());
  const [payload, setPayload] = useState<InboxPayload | null>(null);
  const [activeTab, setActiveTab] = useState<InboxTabKey>(surfaceMode === "chat" ? "chats" : "inbox");
  const [selectedItemId, setSelectedItemId] = useState<string>("briefing-ergo");
  const [composer, setComposer] = useState("");
  const [composerMode, setComposerMode] = useState<(typeof COMPOSER_MODES)[number]["key"]>("brief");
  const [selectedScopeId, setSelectedScopeId] = useState<string | null>(null);
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [showCreateOrbit, setShowCreateOrbit] = useState(false);
  const [draft, setDraft] = useState<OrbitDraft>(EMPTY_ORBIT_DRAFT);
  const [savingOrbit, setSavingOrbit] = useState(false);
  const [sendingComposer, setSendingComposer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [mobileSurface, setMobileSurface] = useState<MobileSurface>(surfaceMode === "chat" ? "chat" : "list");
  const [threadMessages, setThreadMessages] = useState<ConversationMessage[]>([]);
  const [humanLoopItems, setHumanLoopItems] = useState<HumanLoopItem[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadOverrides, setThreadOverrides] = useState<Record<string, string>>({});
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  async function reload(preferredItemId?: string) {
    const nextSession = readSession();
    setSession(nextSession);
    if (!nextSession) {
      router.replace("/");
      return;
    }

    try {
      const [nextInbox, preferences] = await Promise.all([fetchInbox(nextSession.token), fetchPreferences(nextSession.token)]);
      setPayload(nextInbox);
      setSelectedScopeId((current) => {
        const preferred = current ?? nextInbox.active_scope?.orbit_id ?? nextInbox.scopes[0]?.orbit_id ?? null;
        if (preferred && nextInbox.scopes.some((scope) => scope.orbit_id === preferred)) {
          return preferred;
        }
        return nextInbox.active_scope?.orbit_id ?? nextInbox.scopes[0]?.orbit_id ?? null;
      });
      setSelectedItemId((current) => {
        const preferred = preferredItemId ?? current;
        return nextInbox.items.some((item) => item.id === preferred) ? preferred : nextInbox.briefing.id;
      });
      if (preferences.theme_preference !== themeMode) {
        setMode(preferences.theme_preference);
      }
      setError(null);
    } catch (nextError) {
      if (nextError instanceof AuthSessionError) {
        setSession(null);
        setPayload(null);
        router.replace("/");
        return;
      }
      setError(nextError instanceof Error ? nextError.message : "Unable to load the inbox.");
    }
  }

  useEffect(() => {
    void reload();
  }, [surfaceMode]);

  const activeScope = useMemo(
    () => payload?.scopes.find((scope) => scope.orbit_id === selectedScopeId) ?? payload?.active_scope ?? null,
    [payload, selectedScopeId],
  );

  const ergoThreadId = activeScope ? threadOverrides[activeScope.orbit_id] ?? activeScope.ergo_thread_id ?? null : null;

  useEffect(() => {
    if (!session || !selectedScopeId) {
      return;
    }
    void updateNavigation(session.token, { orbit_id: selectedScopeId, section: surfaceMode }).catch(() => {});
  }, [session, selectedScopeId, surfaceMode]);

  useEffect(() => {
    if (!session || !activeScope) {
      setThreadMessages([]);
      setHumanLoopItems([]);
      return;
    }
    if (!ergoThreadId) {
      setThreadMessages([]);
      setHumanLoopItems([]);
      setThreadLoading(false);
      return;
    }

    let cancelled = false;
    setThreadLoading(true);

    void fetchDmThread(session.token, activeScope.orbit_id, ergoThreadId)
      .then((thread) => {
        if (cancelled) {
          return;
        }
        setThreadMessages(thread.messages ?? []);
        setHumanLoopItems(thread.human_loop_items ?? []);
      })
      .catch((nextError) => {
        if (cancelled) {
          return;
        }
        setError(nextError instanceof Error ? nextError.message : "Unable to load the ERGO thread.");
      })
      .finally(() => {
        if (!cancelled) {
          setThreadLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeScope, ergoThreadId, session]);

  const filteredItems = useMemo(() => {
    if (!payload) {
      return [] as InboxItem[];
    }
    return payload.items.filter((item) => itemMatchesTab(item, activeTab));
  }, [payload, activeTab]);

  useEffect(() => {
    if (!filteredItems.length) {
      return;
    }
    if (!filteredItems.some((item) => item.id === selectedItemId)) {
      setSelectedItemId(filteredItems[0].id);
    }
  }, [filteredItems, selectedItemId]);

  const selectedItem = useMemo(
    () => filteredItems.find((item) => item.id === selectedItemId) ?? payload?.items.find((item) => item.id === selectedItemId) ?? null,
    [filteredItems, payload, selectedItemId],
  );

  const searchResults = useMemo(() => {
    if (!payload) {
      return [] as Array<{ key: string; label: string; detail: string; action: () => void }>;
    }
    const term = search.trim().toLowerCase();
    const inboxMatches = payload.items
      .filter((item) => !term || `${item.title} ${item.preview} ${item.source_label}`.toLowerCase().includes(term))
      .slice(0, 8)
      .map((item) => ({
        key: item.id,
        label: item.title,
        detail: item.source_label || item.preview,
        action: () => {
          setSelectedItemId(item.id);
          setActiveTab(item.kind === "source" ? "sources" : "inbox");
          setMobileSurface("chat");
        },
      }));
    const orbitMatches = payload.scopes
      .filter((scope) => !term || `${scope.orbit_name} ${scope.repository_full_name ?? ""}`.toLowerCase().includes(term))
      .slice(0, 5)
      .map((scope) => ({
        key: `orbit-${scope.orbit_id}`,
        label: scope.orbit_name,
        detail: scope.repository_full_name || "Open orbit",
        action: () => router.push(`/app/orbits/${scope.orbit_id}`),
      }));
    return [...inboxMatches, ...orbitMatches];
  }, [payload, router, search]);

  const notificationsContent = useMemo(() => {
    if (!payload) {
      return <EmptyState detail="Loading activity…" />;
    }
    const focusItems = payload.items.filter((item) => item.id !== payload.briefing.id).slice(0, 8);
    if (!focusItems.length) {
      return (
        <EmptyState
          title="Inbox is quiet"
          detail="Approvals, mentions, recent conversations, and source updates will surface here when they matter."
        />
      );
    }
    return (
      <div className="space-y-2">
        {focusItems.map((item) => (
          <ListRow
            key={item.id}
            eyebrow="Inbox item"
            title={item.title}
            detail={item.preview}
            trailing={<StatusPill tone={attentionTone(item)}>{item.status_label}</StatusPill>}
            onClick={() => {
              setSelectedItemId(item.id);
              setMobileSurface("chat");
            }}
          />
        ))}
      </div>
    );
  }, [payload]);

  const shellConfig = useMemo<AppShellConfig>(
    () => ({
      mode: "inbox",
      breadcrumb: [surfaceMode === "chat" ? "Chat" : "Inbox"],
      items: buildPrimaryShellItems(router, surfaceMode === "chat" ? "chat" : "inbox", {
        onCreateOrbit: () => setShowCreateOrbit(true),
      }),
      secondaryContent: payload ? (
        <RecentOrbitSidebarContent scopes={payload.scopes} onSelectOrbit={(orbitId) => router.push(`/app/orbits/${orbitId}`)} />
      ) : (
        <RecentOrbitSidebarSkeleton />
      ),
      search: {
        title: surfaceMode === "chat" ? "Search chat" : "Search inbox",
        description:
          surfaceMode === "chat"
            ? "Find the right ERGO thread, conversation, or orbit without leaving the shell."
            : "Find the right triage item, briefing, or orbit without leaving the shell.",
        query: search,
        onQueryChange: setSearch,
        placeholder: surfaceMode === "chat" ? "Search chats or jump to an orbit" : "Search inbox or jump to an orbit",
        content: searchResults.length ? (
          <div className="max-h-[420px] space-y-2 overflow-auto">
            {searchResults.map((item) => (
              <ListRow key={item.key} title={item.label} detail={item.detail} leading={<Search className="h-4 w-4" />} onClick={item.action} />
            ))}
          </div>
        ) : (
          <EmptyState title="No matches" detail="Try a different orbit name, source label, or briefing term." />
        ),
      },
      notifications: {
        title: surfaceMode === "chat" ? "Agent activity" : "Inbox triage",
        description:
          surfaceMode === "chat"
            ? "The latest high-signal work around ERGO threads, approvals, and delivery."
            : "The latest high-signal items already feeding the Inbox workbench.",
        content: notificationsContent,
      },
    }),
    [notificationsContent, payload, router, search, searchResults, surfaceMode],
  );

  useAuthenticatedShellConfig(shellConfig);

  async function onCreateOrbit() {
    if (!session || !draft.name.trim()) {
      return;
    }
    setSavingOrbit(true);
    setError(null);
    try {
      const orbit = (await createOrbit(session.token, {
        name: draft.name.trim(),
        description: draft.description.trim(),
        logo: draft.logo || null,
        private: draft.private,
        invite_emails: draft.inviteEmails
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      })) as Orbit;
      setShowCreateOrbit(false);
      setDraft(EMPTY_ORBIT_DRAFT);
      router.push(`/app/orbits/${orbit.id}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to create the orbit.");
    } finally {
      setSavingOrbit(false);
    }
  }

  function onLogoUpload(file: File | undefined) {
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setDraft((current) => ({
        ...current,
        logo: typeof reader.result === "string" ? reader.result : "",
        logoFileName: file.name,
      }));
    };
    reader.readAsDataURL(file);
  }

  function onInsertMention(token: string) {
    setComposer((current) => `${current}${current.trim() ? " " : ""}${token} `);
  }

  async function ensureErgoThread(scope: InboxScope) {
    let threadId = threadOverrides[scope.orbit_id] ?? scope.ergo_thread_id ?? null;
    if (threadId) {
      return threadId;
    }
    const thread = await createDmThread(session!.token, scope.orbit_id, {
      target_kind: "agent",
      target_login: "ERGO",
    });
    threadId = thread.id;
    setThreadOverrides((current) => ({ ...current, [scope.orbit_id]: threadId! }));
    return threadId;
  }

  async function onComposerSubmit() {
    if (!session || !activeScope || !composer.trim()) {
      return;
    }

    const body = composer.trim();
    setSendingComposer(true);
    setError(null);
    setMobileSurface("chat");

    try {
      const threadId = await ensureErgoThread(activeScope);
      const optimisticMessage: ConversationMessage = {
        id: `pending-${Date.now()}`,
        author_kind: "human",
        author_name: payload?.me.display_name || "You",
        body,
        metadata: { pending: true },
        created_at: new Date().toISOString(),
        dm_thread_id: threadId,
        pending: true,
      };
      setThreadMessages((current) => [...current, optimisticMessage]);

      const result = await sendDmMessage(session.token, activeScope.orbit_id, threadId, body);
      setThreadMessages((current) => {
        const withoutPending = current.filter((message) => message.id !== optimisticMessage.id);
        const nextMessages = [...withoutPending, result.message];
        if (result.ergo) {
          nextMessages.push(result.ergo);
        }
        return nextMessages;
      });
      setComposer("");
      setStagedFiles([]);
      await reload(selectedItemId);
    } catch (nextError) {
      setThreadMessages((current) => current.filter((message) => !message.pending));
      setError(nextError instanceof Error ? nextError.message : "Unable to send that message to ERGO.");
    } finally {
      setSendingComposer(false);
    }
  }

  async function onAction(action: InboxAction) {
    if (action.href) {
      window.open(action.href, "_blank", "noopener,noreferrer");
      return;
    }
    const target = action.navigation;
    if (!target) {
      return;
    }
    await openNavigationTarget(target);
  }

  async function openNavigationTarget(target: InboxNavigationTarget) {
    if (!session) {
      return;
    }

    if (target.section === "inbox") {
      router.push("/app/inbox");
      return;
    }

    if (target.section === "chat" && target.orbit_id) {
      setSelectedScopeId(target.orbit_id);
      setMobileSurface("chat");
      return;
    }

    if (target.section === "chat") {
      router.push("/app/chat");
      return;
    }

    if (target.orbit_id) {
      await updateNavigation(session.token, { orbit_id: target.orbit_id, section: target.section }).catch(() => {});
      router.push(`/app/orbits/${target.orbit_id}`);
      return;
    }

    if (target.section === "dashboard") {
      router.push("/app/my-work");
    }
  }

  function onSelectItem(itemId: string) {
    setSelectedItemId(itemId);
    setMobileSurface("chat");
  }

  if (!session || !payload) {
    return <ShellPageSkeleton mode="inbox" />;
  }

  return (
    <>
      <ShellPage className="gap-0">
        {error ? <InlineNotice tone="danger" detail={error} /> : null}

        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="hidden h-full lg:flex">
            <div className={cx("flex min-w-[296px] flex-col border-r border-line", surfaceMode === "chat" ? "w-[296px]" : "w-[312px]")}>
              <div className="border-b border-line px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-semibold tracking-[-0.02em] text-ink">{activeScope?.orbit_name ?? (surfaceMode === "chat" ? "ERGO Chat" : "ERGO Inbox")}</p>
                  <GhostButton className="px-3 py-2 text-xs" onClick={() => setShowCreateOrbit(true)}>
                    <Plus className="h-3.5 w-3.5" />
                    Orbit
                  </GhostButton>
                </div>
              </div>

              <div className="border-b border-line px-4 py-2.5">
                <div className="relative">
                  <GhostButton className="w-full justify-between px-3 py-2 text-sm" onClick={() => setScopeMenuOpen((current) => !current)}>
                    <span className="truncate">{activeScope?.orbit_name ?? "Select orbit"}</span>
                    <ChevronDown className="h-4 w-4" />
                  </GhostButton>
                  {scopeMenuOpen ? (
                    <div className="absolute left-0 top-full z-20 mt-2 w-full rounded-[16px] border border-line bg-shell p-2 shadow-[0_20px_50px_rgba(0,0,0,0.3)]">
                      {payload.scopes.length ? (
                        payload.scopes.map((scope) => (
                          <button
                            key={scope.orbit_id}
                            type="button"
                            onClick={() => {
                              setSelectedScopeId(scope.orbit_id);
                              setScopeMenuOpen(false);
                              setMobileSurface("chat");
                            }}
                            className={cx(
                              "flex w-full items-start justify-between gap-3 rounded-[12px] px-3 py-2.5 text-left text-sm transition-colors hover:bg-panel",
                              scope.orbit_id === activeScope?.orbit_id ? "bg-panel text-ink" : "text-quiet",
                            )}
                          >
                            <div className="min-w-0">
                              <p className="truncate font-medium">{scope.orbit_name}</p>
                              <p className="mt-1 truncate text-xs text-faint">{scope.repository_full_name || "Repository pending"}</p>
                            </div>
                            {scope.is_active ? <StatusPill tone="accent">Active</StatusPill> : null}
                          </button>
                        ))
                      ) : (
                        <EmptyState title="No orbit scope yet" detail="Create your first orbit to give ERGO operational context." />
                      )}
                    </div>
                  ) : null}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {INBOX_TABS.map((tab) => (
                    <SelectionChip key={tab.key} active={activeTab === tab.key} onClick={() => setActiveTab(tab.key)}>
                      {tab.label}
                    </SelectionChip>
                  ))}
                </div>
              </div>

              <ScrollPanel className="flex-1 px-3 py-2.5">
                <div className="space-y-2">
                  {filteredItems.length ? (
                    filteredItems.map((item) => <InboxRow key={item.id} item={item} active={item.id === selectedItem?.id} onClick={() => onSelectItem(item.id)} />)
                  ) : activeTab === "sources" ? (
                    <EmptyState
                      title="No sources yet"
                      detail="Artifacts, demos, and repo-backed context will show up here once ERGO has something operational to reference."
                      action={<GhostButton onClick={() => setShowCreateOrbit(true)}>Create orbit</GhostButton>}
                    />
                  ) : payload.scopes.length === 0 ? (
                    <EmptyState
                      title="Start your first workspace"
                      detail="Inbox becomes useful once AutoWeave has at least one orbit to summarize, monitor, and route ERGO through."
                      action={<ActionButton onClick={() => setShowCreateOrbit(true)}>Create orbit</ActionButton>}
                    />
                  ) : (
                    <EmptyState title="No inbox items" detail="This filter is quiet right now. Switch tabs or send a new ERGO request." />
                  )}
                </div>
              </ScrollPanel>
            </div>

            <ErgoConversation
              activeScope={activeScope}
              selectedItem={selectedItem}
              messages={threadMessages}
              humanLoopItems={humanLoopItems}
              loading={threadLoading}
              composer={composer}
              onComposerChange={setComposer}
              composerMode={composerMode}
              onComposerModeChange={setComposerMode}
              stagedFiles={stagedFiles}
              onAttachmentClick={() => attachmentInputRef.current?.click()}
              onFilesSelected={setStagedFiles}
              onInsertMention={onInsertMention}
              onAction={onAction}
              onSend={onComposerSubmit}
              sending={sendingComposer}
              attachmentInputRef={attachmentInputRef}
            />
          </div>

          <div className="flex h-full flex-col lg:hidden">
            <div className="border-b border-line px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-semibold tracking-[-0.02em] text-ink">{activeScope?.orbit_name ?? (surfaceMode === "chat" ? "ERGO Chat" : "ERGO Inbox")}</p>
                <GhostButton className="px-3 py-2 text-xs" onClick={() => setShowCreateOrbit(true)}>
                  <Plus className="h-3.5 w-3.5" />
                  Orbit
                </GhostButton>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {[
                  { key: "list", label: "Inbox" },
                  { key: "chat", label: "Chat" },
                ].map((surface) => (
                  <SelectionChip key={surface.key} active={mobileSurface === surface.key} onClick={() => setMobileSurface(surface.key as MobileSurface)}>
                    {surface.label}
                  </SelectionChip>
                ))}
              </div>
            </div>

            {mobileSurface === "list" ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="border-b border-line px-4 py-2.5">
                  <div className="relative">
                    <GhostButton className="w-full justify-between px-3 py-2 text-sm" onClick={() => setScopeMenuOpen((current) => !current)}>
                      <span className="truncate">{activeScope?.orbit_name ?? "Select orbit"}</span>
                      <ChevronDown className="h-4 w-4" />
                    </GhostButton>
                    {scopeMenuOpen ? (
                      <div className="absolute left-0 top-full z-20 mt-2 w-full rounded-[16px] border border-line bg-shell p-2 shadow-[0_20px_50px_rgba(0,0,0,0.3)]">
                        {payload.scopes.map((scope) => (
                          <button
                            key={scope.orbit_id}
                            type="button"
                            onClick={() => {
                              setSelectedScopeId(scope.orbit_id);
                              setScopeMenuOpen(false);
                            }}
                            className={cx(
                              "flex w-full items-start justify-between gap-3 rounded-[12px] px-3 py-2.5 text-left text-sm transition-colors hover:bg-panel",
                              scope.orbit_id === activeScope?.orbit_id ? "bg-panel text-ink" : "text-quiet",
                            )}
                          >
                            <div className="min-w-0">
                              <p className="truncate font-medium">{scope.orbit_name}</p>
                              <p className="mt-1 truncate text-xs text-faint">{scope.repository_full_name || "Repository pending"}</p>
                            </div>
                            {scope.is_active ? <StatusPill tone="accent">Active</StatusPill> : null}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {INBOX_TABS.map((tab) => (
                      <SelectionChip key={tab.key} active={activeTab === tab.key} onClick={() => setActiveTab(tab.key)}>
                        {tab.label}
                      </SelectionChip>
                    ))}
                  </div>
                </div>
                <ScrollPanel className="flex-1 px-3 py-2.5">
                  <div className="space-y-2">
                    {filteredItems.map((item) => (
                      <InboxRow key={item.id} item={item} active={item.id === selectedItem?.id} onClick={() => onSelectItem(item.id)} />
                    ))}
                  </div>
                </ScrollPanel>
              </div>
            ) : null}

            {mobileSurface === "chat" ? (
              <ErgoConversation
                activeScope={activeScope}
                selectedItem={selectedItem}
                messages={threadMessages}
                humanLoopItems={humanLoopItems}
                loading={threadLoading}
                composer={composer}
                onComposerChange={setComposer}
                composerMode={composerMode}
                onComposerModeChange={setComposerMode}
                stagedFiles={stagedFiles}
                onAttachmentClick={() => attachmentInputRef.current?.click()}
                onFilesSelected={setStagedFiles}
                onInsertMention={onInsertMention}
                onAction={onAction}
                onSend={onComposerSubmit}
                sending={sendingComposer}
                attachmentInputRef={attachmentInputRef}
              />
            ) : null}
          </div>
        </div>
      </ShellPage>

      <CenteredModal
        open={showCreateOrbit}
        onClose={() => setShowCreateOrbit(false)}
        title="Create a new orbit"
        description="Start a GitHub-backed workspace so Inbox can summarize the work, route ERGO, and surface the right decisions."
        footer={
          <div className="flex items-center justify-end gap-3">
            <GhostButton onClick={() => setShowCreateOrbit(false)}>Cancel</GhostButton>
            <ActionButton onClick={onCreateOrbit} disabled={savingOrbit || !draft.name.trim()}>
              {savingOrbit ? "Creating…" : "Create orbit"}
            </ActionButton>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-quiet">Orbit name</p>
            <TextArea
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              className="mt-2 min-h-0"
              rows={1}
            />
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-quiet">Description</p>
            <TextArea
              value={draft.description}
              onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
              className="mt-2 min-h-[88px]"
            />
          </div>
          <div className="rounded-pane border border-line bg-panel p-4">
            <div className="flex items-center gap-3">
              <AvatarMark label={draft.name || "Orbit"} src={isImageLogo(draft.logo) ? draft.logo : null} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{draft.logoFileName || "Orbit mark"}</p>
                <p className="text-xs text-quiet">Upload a logo or keep the generated initials.</p>
              </div>
            </div>
            <GhostButton className="mt-3" onClick={() => logoInputRef.current?.click()}>
              <Paperclip className="h-4 w-4" />
              Upload logo
            </GhostButton>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => onLogoUpload(event.target.files?.[0])}
            />
          </div>
        </div>
      </CenteredModal>
    </>
  );
}
