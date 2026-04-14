"use client";

import {
  AlertTriangle,
  Bot,
  FolderOpen,
  GitPullRequest,
  Layers3,
  MessageSquare,
  Search,
  TimerReset,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  type AppShellConfig,
  useAuthenticatedShellConfig,
} from "@/components/authenticated-shell";
import { useTheme } from "@/components/theme-provider";
import {
  ActionButton,
  EmptyState,
  GhostButton,
  InlineNotice,
  ListRow,
  Panel,
  ScrollPanel,
  SelectionChip,
  ShellPage,
  ShellPageSkeleton,
  StatusPill,
  SurfaceCard,
} from "@/components/ui";
import { AuthSessionError, fetchMyWork, fetchPreferences, readSession } from "@/lib/api";
import { buildPrimaryShellItems } from "@/lib/app-shell-nav";
import type { BoardItem, MyWorkPayload, NotificationItem, WorkItemSummary } from "@/lib/types";

function formatFreshness(value: string | undefined) {
  if (!value) {
    return "Recently updated";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Recently updated";
  }
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function boardTone(item: BoardItem) {
  const status = String(item.operational_status || item.state || "").toLowerCase();
  if (["blocked", "changes_requested"].includes(status)) {
    return "danger" as const;
  }
  if (["awaiting_review", "in_review", "ready_for_review", "ready_to_merge"].includes(status)) {
    return "accent" as const;
  }
  if (["done", "closed", "merged", "completed", "resolved"].includes(status)) {
    return "success" as const;
  }
  if (["in_progress", "planned", "triage", "backlog"].includes(status)) {
    return "muted" as const;
  }
  return "muted" as const;
}

function workTone(item: WorkItemSummary) {
  const status = String(item.status || "").toLowerCase();
  if (["blocked", "failed"].includes(status)) {
    return "danger" as const;
  }
  if (["in_review", "needs_input"].includes(status)) {
    return "accent" as const;
  }
  if (["completed"].includes(status)) {
    return "success" as const;
  }
  return "muted" as const;
}

function notificationTone(item: NotificationItem) {
  if (item.kind === "run_failed") {
    return "danger" as const;
  }
  if (["approval", "clarification"].includes(item.kind)) {
    return "accent" as const;
  }
  return "muted" as const;
}

export function MyWorkScreen() {
  const router = useRouter();
  const { mode, setMode } = useTheme();
  const [session, setSession] = useState(readSession());
  const [payload, setPayload] = useState<MyWorkPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | "needs-review" | "blocked" | "agent">("all");

  async function reload() {
    const nextSession = readSession();
    setSession(nextSession);
    if (!nextSession) {
      router.replace("/");
      return;
    }
    try {
      const [nextPayload, preferences] = await Promise.all([
        fetchMyWork(nextSession.token),
        fetchPreferences(nextSession.token),
      ]);
      setPayload(nextPayload);
      if (preferences.theme_preference !== mode) {
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
      setError(nextError instanceof Error ? nextError.message : "Unable to load My Work.");
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  const searchResults = useMemo(() => {
    if (!payload) {
      return [];
    }
    const term = search.trim().toLowerCase();
    const issueMatches = payload.active_issues
      .filter((item) => !term || `${item.title} ${item.repository_full_name ?? ""}`.toLowerCase().includes(term))
      .slice(0, 6)
      .map((item) => ({
        key: `issue-${item.id}`,
        label: item.title,
        detail: item.repository_full_name ? `Issue · ${item.repository_full_name}` : "Issue",
        action: () => router.push("/app/orbits"),
      }));
    const workMatches = payload.work_items
      .filter((item) => !term || `${item.title} ${item.summary ?? ""}`.toLowerCase().includes(term))
      .slice(0, 6)
      .map((item) => ({
        key: `work-${item.id}`,
        label: item.title,
        detail: item.summary || item.status,
        action: () => router.push("/app/chat"),
      }));
    const orbitMatches = payload.recent_orbits
      .filter((item) => !term || `${item.name} ${item.repo_full_name ?? ""}`.toLowerCase().includes(term))
      .slice(0, 6)
      .map((item) => ({
        key: `orbit-${item.id}`,
        label: item.name,
        detail: item.repo_full_name || "Open orbit",
        action: () => router.push(`/app/orbits/${item.id}`),
      }));
    return [...issueMatches, ...workMatches, ...orbitMatches].slice(0, 12);
  }, [payload, router, search]);

  const notificationsContent = useMemo(() => {
    if (!payload?.notifications.length) {
      return (
        <EmptyState
          title="No new signals"
          detail="Approvals, failures, and clarifications will surface here as they need attention."
        />
      );
    }
    return (
      <div className="space-y-2">
        {payload.notifications.slice(0, 8).map((item) => (
          <ListRow
            key={item.id}
            eyebrow="Activity"
            title={item.title}
            detail={item.detail}
            trailing={<StatusPill tone={notificationTone(item)}>{item.kind.replaceAll("_", " ")}</StatusPill>}
          />
        ))}
      </div>
    );
  }, [payload]);

  const filteredIssues = useMemo(() => {
    if (!payload) {
      return [];
    }
    if (activeFilter === "needs-review") {
      return payload.review_queue;
    }
    if (activeFilter === "blocked") {
      return payload.blocked_issues;
    }
    return payload.active_issues;
  }, [activeFilter, payload]);

  const shellConfig = useMemo<AppShellConfig>(() => ({
    mode: "dashboard",
    breadcrumb: ["My Work"],
    items: buildPrimaryShellItems(router, "my-work"),
    secondaryContent: payload ? (
      <div className="space-y-1.5">
        {payload.recent_orbits.length ? (
          payload.recent_orbits.slice(0, 5).map((orbit) => (
            <button
              key={orbit.id}
              type="button"
              title={orbit.name}
              aria-label={orbit.name}
              onClick={() => router.push(`/app/orbits/${orbit.id}`)}
              className="group flex min-h-[36px] w-full items-center gap-2 overflow-hidden rounded-[10px] py-1.5 pl-[9px] pr-2.5 text-left text-[#a6a9b0] transition-[background-color,color,transform] duration-200 ease-productive hover:bg-shellMuted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focusRing focus-visible:ring-offset-0 active:scale-[0.99] motion-reduce:transform-none motion-reduce:transition-none"
            >
              <div className="h-[18px] w-[18px] rounded-[6px] bg-shellMuted" />
              <span className="min-w-0 truncate text-[13px] font-medium group-hover:text-ink">{orbit.name}</span>
            </button>
          ))
        ) : (
          <p className="px-2.5 text-xs text-quiet">No recent orbits yet.</p>
        )}
      </div>
    ) : null,
    search: {
      title: "Search work",
      description: "Jump to the next issue, ERGO task, or orbit without leaving the shell.",
      query: search,
      onQueryChange: setSearch,
      placeholder: "Search issues, tasks, or orbits",
      content: searchResults.length ? (
        <div className="max-h-[420px] space-y-2 overflow-auto">
          {searchResults.map((item) => (
            <ListRow key={item.key} title={item.label} detail={item.detail} leading={<Search className="h-4 w-4" />} onClick={item.action} />
          ))}
        </div>
      ) : (
        <EmptyState title="No matches" detail="Try an issue title, orbit name, or ERGO task summary." />
      ),
    },
    notifications: {
      title: "Operational signals",
      description: "Live approvals, failures, and clarifications across the work you own right now.",
      content: notificationsContent,
    },
  }), [notificationsContent, payload, router, search, searchResults]);

  useAuthenticatedShellConfig(shellConfig);

  if (!session || !payload) {
    return <ShellPageSkeleton mode="dashboard" />;
  }

  return (
    <ShellPage className="gap-4">
      {error ? <InlineNotice tone="danger" detail={error} /> : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-quiet">Control your current queue</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-ink">My Work</h1>
          <p className="mt-2 max-w-[64ch] text-sm leading-6 text-quiet">
            Native issues, review pressure, and ERGO execution stay in one operating surface. Chat remains available, but the work is the primary object.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <GhostButton onClick={() => router.push("/app/chat")}>
            <MessageSquare className="h-4 w-4" />
            Open chat
          </GhostButton>
          <ActionButton onClick={() => router.push("/app/orbits")}>
            <FolderOpen className="h-4 w-4" />
            Browse orbits
          </ActionButton>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-4">
        <SurfaceCard className="bg-panelStrong p-3.5">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-quiet">ERGO tasks</p>
          <div className="mt-2 flex items-end justify-between gap-3">
            <div>
              <p className="text-2xl font-semibold tracking-[-0.04em] text-ink">{payload.summary.active_work_items}</p>
              <p className="text-xs text-quiet">Delegated execution items still moving through delivery.</p>
            </div>
            <StatusPill tone={payload.summary.active_work_items ? "accent" : "muted"}>{payload.summary.active_work_items ? "live" : "quiet"}</StatusPill>
          </div>
        </SurfaceCard>
        <SurfaceCard className="bg-panelStrong p-3.5">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-quiet">Review queue</p>
          <div className="mt-2 flex items-end justify-between gap-3">
            <div>
              <p className="text-2xl font-semibold tracking-[-0.04em] text-ink">{payload.summary.review_queue}</p>
              <p className="text-xs text-quiet">Pull requests waiting for review or changes response.</p>
            </div>
            <StatusPill tone={payload.summary.review_queue ? "warning" : "muted"}>{payload.summary.review_queue ? "watch" : "clear"}</StatusPill>
          </div>
        </SurfaceCard>
        <SurfaceCard className="bg-panelStrong p-3.5">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-quiet">Blocked</p>
          <div className="mt-2 flex items-end justify-between gap-3">
            <div>
              <p className="text-2xl font-semibold tracking-[-0.04em] text-ink">{payload.summary.blocked_issues}</p>
              <p className="text-xs text-quiet">Issues that need a decision before ERGO or humans can progress.</p>
            </div>
            <StatusPill tone={payload.summary.blocked_issues ? "danger" : "muted"}>{payload.summary.blocked_issues ? "blocked" : "clear"}</StatusPill>
          </div>
        </SurfaceCard>
        <SurfaceCard className="bg-panelStrong p-3.5">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-quiet">Approvals</p>
          <div className="mt-2 flex items-end justify-between gap-3">
            <div>
              <p className="text-2xl font-semibold tracking-[-0.04em] text-ink">{payload.summary.approvals}</p>
              <p className="text-xs text-quiet">Signals requiring human confirmation or clarification.</p>
            </div>
            <StatusPill tone={payload.summary.approvals ? "accent" : "muted"}>{payload.summary.approvals ? "pending" : "quiet"}</StatusPill>
          </div>
        </SurfaceCard>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1.18fr)_minmax(360px,0.82fr)]">
        <div className="grid min-h-0 gap-4">
          <Panel className="flex min-h-0 flex-col overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
              <div>
                <p className="text-sm font-semibold tracking-[-0.02em] text-ink">Issue queue</p>
                <p className="mt-1 text-xs text-quiet">Keep delivery pressure and project state visible before opening chat.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <SelectionChip active={activeFilter === "all"} onClick={() => setActiveFilter("all")}>
                  <Layers3 className="h-3.5 w-3.5" />
                  Active
                </SelectionChip>
                <SelectionChip active={activeFilter === "needs-review"} onClick={() => setActiveFilter("needs-review")}>
                  <GitPullRequest className="h-3.5 w-3.5" />
                  Needs review
                </SelectionChip>
                <SelectionChip active={activeFilter === "blocked"} onClick={() => setActiveFilter("blocked")}>
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Blocked
                </SelectionChip>
              </div>
            </div>
            <ScrollPanel className="flex-1 px-4 py-3">
              <div className="space-y-2">
                {filteredIssues.length ? (
                  filteredIssues.map((item) => (
                    <ListRow
                      key={item.id}
                      eyebrow={item.repository_full_name || "Orbit issue"}
                      title={item.title}
                      detail={
                        item.source_kind === "native_issue"
                          ? `PM-${item.number} · ${item.cycle_name || item.repository_full_name || "Native issue"}`
                          : `#${item.number} · ${item.repository_full_name || "Issue queue"}`
                      }
                      trailing={<StatusPill tone={boardTone(item)}>{String(item.operational_status || item.state).replaceAll("_", " ")}</StatusPill>}
                    />
                  ))
                ) : (
                  <EmptyState title="No issues in this lane" detail="Once GitHub-linked issues and native PM work are active, the queue will fill here." />
                )}
              </div>
            </ScrollPanel>
          </Panel>

          <Panel className="flex min-h-0 flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <div>
                <p className="text-sm font-semibold tracking-[-0.02em] text-ink">ERGO execution</p>
                <p className="mt-1 text-xs text-quiet">Cloud-agent work stays visible as teammate activity, not hidden inside a chat thread.</p>
              </div>
              <SelectionChip active={activeFilter === "agent"} onClick={() => setActiveFilter("agent")}>
                <Bot className="h-3.5 w-3.5" />
                ERGO
              </SelectionChip>
            </div>
            <ScrollPanel className="flex-1 px-4 py-3">
              <div className="space-y-2">
                {payload.work_items.length ? (
                  payload.work_items.map((item) => (
                    <ListRow
                      key={item.id}
                      eyebrow={item.agent}
                      title={item.title}
                      detail={item.summary || "Execution queued in the delivery pipeline."}
                      supporting={
                        <>
                          <span>{formatFreshness(item.updated_at)}</span>
                          {item.branch_name ? <span>Branch {item.branch_name}</span> : null}
                        </>
                      }
                      trailing={<StatusPill tone={workTone(item)}>{item.status.replaceAll("_", " ")}</StatusPill>}
                    />
                  ))
                ) : (
                  <EmptyState title="No active ERGO tasks" detail="Delegated work items will appear here once the agent has accepted or resumed a request." />
                )}
              </div>
            </ScrollPanel>
          </Panel>
        </div>

        <div className="grid min-h-0 gap-4">
          <Panel className="flex min-h-0 flex-col overflow-hidden">
            <div className="border-b border-line px-4 py-3">
              <p className="text-sm font-semibold tracking-[-0.02em] text-ink">Review and approvals</p>
              <p className="mt-1 text-xs text-quiet">Keep merge pressure and human checkpoints visible together.</p>
            </div>
            <ScrollPanel className="flex-1 px-4 py-3">
              <div className="space-y-2">
                {payload.review_queue.length ? (
                  payload.review_queue.map((item) => (
                    <ListRow
                      key={item.id}
                      eyebrow={item.source_kind === "native_issue" ? item.cycle_name || "Native review" : item.repository_full_name || "Repository review"}
                      title={item.title}
                      detail={item.source_kind === "native_issue" ? `PM-${item.number}` : `PR #${item.number}`}
                      trailing={<StatusPill tone={boardTone(item)}>{String(item.operational_status || item.state).replaceAll("_", " ")}</StatusPill>}
                    />
                  ))
                ) : (
                  <EmptyState title="Review queue is clear" detail="Open reviews and changes requests will return here automatically." />
                )}
                {payload.approvals.length ? (
                  payload.approvals.map((item) => (
                    <ListRow
                      key={item.id}
                      eyebrow="Approval"
                      title={item.title}
                      detail={item.detail}
                      trailing={<StatusPill tone={notificationTone(item)}>{item.kind.replaceAll("_", " ")}</StatusPill>}
                    />
                  ))
                ) : null}
              </div>
            </ScrollPanel>
          </Panel>

          <Panel className="flex min-h-0 flex-col overflow-hidden">
            <div className="border-b border-line px-4 py-3">
              <p className="text-sm font-semibold tracking-[-0.02em] text-ink">Workspace readiness</p>
              <p className="mt-1 text-xs text-quiet">Track which projects and workspaces are warm enough to resume immediately.</p>
            </div>
            <ScrollPanel className="flex-1 px-4 py-3">
              <div className="space-y-2">
                {payload.recent_orbits.map((orbit) => (
                  <ListRow
                    key={orbit.id}
                    eyebrow={orbit.repo_full_name || "Orbit"}
                    title={orbit.name}
                    detail={orbit.description || "Project coordination surface"}
                    trailing={<GhostButton className="px-3 py-1.5 text-xs" onClick={() => router.push(`/app/orbits/${orbit.id}`)}>Open</GhostButton>}
                  />
                ))}
                {payload.codespaces.length ? (
                  payload.codespaces.map((item) => (
                    <ListRow
                      key={item.id}
                      eyebrow="Codespace"
                      title={item.name}
                      detail={item.repository_full_name || item.workspace_path}
                      trailing={<StatusPill tone={item.status === "running" ? "success" : "muted"}>{item.status}</StatusPill>}
                      supporting={
                        <>
                          <TimerReset className="h-3.5 w-3.5" />
                          <span>{item.branch_name}</span>
                        </>
                      }
                    />
                  ))
                ) : (
                  <EmptyState title="No warm workspaces" detail="Codespaces will surface here when a branch workspace is provisioned for active work." />
                )}
              </div>
            </ScrollPanel>
          </Panel>
        </div>
      </div>
    </ShellPage>
  );
}
