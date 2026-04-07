"use client";

import {
  ChevronRight,
  House,
  LayoutGrid,
  Plus,
  Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  AuthSessionError,
  createOrbit,
  fetchDashboard,
  fetchOrbits,
  fetchPreferences,
  readSession,
} from "@/lib/api";
import type { DashboardPayload, Orbit } from "@/lib/types";
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
  FieldHint,
  FieldLabel,
  GhostButton,
  InlineNotice,
  ListRow,
  Panel,
  ScrollPanel,
  ShellPage,
  ShellPageSkeleton,
  StatusPill,
  SurfaceCard,
  TextArea,
  TextInput,
  cx,
} from "@/components/ui";

type OrbitDraft = {
  name: string;
  description: string;
  logo: string;
  logoFileName: string;
  inviteEmails: string;
  private: boolean;
};

const EMPTY_ORBIT_DRAFT: OrbitDraft = {
  name: "",
  description: "",
  logo: "",
  logoFileName: "",
  inviteEmails: "",
  private: true,
};

function isImageLogo(value?: string | null) {
  return Boolean(value && (value.startsWith("data:") || value.startsWith("http")));
}

function DashboardSearchSurface({
  orbits,
  onSelectOrbit,
}: {
  orbits: Orbit[];
  onSelectOrbit: (orbitId: string) => void;
}) {
  return (
    <div className="max-h-[420px] space-y-2 overflow-auto">
      {orbits.length ? (
        orbits.map((orbit) => (
          <ListRow
            key={orbit.id}
            title={orbit.name}
            detail={orbit.repo_full_name || "Repository pending"}
            leading={<AvatarMark label={orbit.name} src={isImageLogo(orbit.logo) ? orbit.logo : null} />}
            onClick={() => onSelectOrbit(orbit.id)}
          />
        ))
      ) : (
        <EmptyState title="No matching orbits" detail="Try a different orbit name or repository filter." />
      )}
      </div>
  );
}

function DashboardNotificationsSurface({
  notifications,
}: {
  notifications: Array<{ kind: string; label: string; detail?: string }>;
}) {
  return notifications.length ? (
    <div className="space-y-3">
      {notifications.map((item, index) => (
        <ListRow
          key={`${item.kind}-${index}`}
          eyebrow="Activity"
          title={item.label}
          detail={item.detail}
          trailing={<StatusPill tone="muted">{item.kind}</StatusPill>}
        />
      ))}
    </div>
  ) : (
    <EmptyState title="No notifications yet" detail="Approvals, reviews, and run updates will surface here when they need attention." />
  );
}

function DashboardSidebarContent({
  recentOrbits,
  onSelectOrbit,
}: {
  recentOrbits: DashboardPayload["recent_orbits"];
  onSelectOrbit: (orbitId: string) => void;
}) {
  const { sidebarCollapsed } = useAuthenticatedShell();

  return (
    <div className="space-y-1.5">
      {recentOrbits.length ? (
        recentOrbits.slice(0, 4).map((orbit) => (
          <button
            key={orbit.id}
            type="button"
            title={orbit.name}
            aria-label={orbit.name}
            onClick={() => onSelectOrbit(orbit.id)}
            className={cx(
              "group flex min-h-[36px] w-full items-center gap-2 overflow-hidden rounded-[10px] py-1.5 text-left transition-[background-color,color,transform] duration-200 ease-productive hover:bg-shellMuted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focusRing focus-visible:ring-offset-0 active:scale-[0.99] motion-reduce:transform-none motion-reduce:transition-none",
              sidebarCollapsed ? "justify-start px-0 pl-[9px]" : "justify-start pl-[9px] pr-2.5 text-[#a6a9b0]",
            )}
          >
            <AvatarMark
              label={orbit.name}
              src={isImageLogo(orbit.logo) ? orbit.logo : null}
              className="h-[20px] w-[20px] rounded-[8px]"
            />
            <span
              className={cx(
                "min-w-0 overflow-hidden whitespace-nowrap text-[13px] font-medium text-[#a6a9b0] transition-[max-width,opacity] duration-200 ease-productive motion-reduce:transition-none group-hover:text-ink",
                sidebarCollapsed ? "max-w-0 opacity-0" : "max-w-[120px] opacity-100",
              )}
            >
              {orbit.name}
            </span>
          </button>
        ))
      ) : (
        !sidebarCollapsed ? <p className="px-2.5 text-xs text-quiet">No recent orbits yet.</p> : null
      )}
    </div>
  );
}

function DashboardSidebarContentSkeleton() {
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

function DashboardScreenBody({
  payload,
  error,
  onCreateOrbitClick,
}: {
  payload: DashboardPayload;
  error: string | null;
  onCreateOrbitClick: () => void;
}) {
  const activePriorityCount = payload.priority_items.length;
  const runningWorkspaceCount = payload.codespaces.filter((item) => item.status === "running").length;

  return (
    <ShellPage className="gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-quiet">Hello, {payload.me.display_name}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-quiet">
            <span>{activePriorityCount} priority signals</span>
            <span className="h-1 w-1 rounded-full bg-faint/60" />
            <span>{payload.codespaces.length} workspaces</span>
            <span className="h-1 w-1 rounded-full bg-faint/60" />
            <span>{payload.recent_orbits.length} recent orbits</span>
          </div>
        </div>
        <ActionButton onClick={onCreateOrbitClick}>
          <Plus className="h-4 w-4" />
          New Orbit
        </ActionButton>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <SurfaceCard className="bg-panelStrong p-3.5">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-quiet">Priority</p>
          <div className="mt-2 flex items-end justify-between gap-3">
            <div>
              <p className="text-2xl font-semibold tracking-[-0.04em] text-ink">{activePriorityCount}</p>
              <p className="text-xs text-quiet">Active approvals, reviews, and completion signals.</p>
            </div>
            <StatusPill tone={activePriorityCount ? "accent" : "muted"}>
              {activePriorityCount ? "live" : "quiet"}
            </StatusPill>
          </div>
        </SurfaceCard>
        <SurfaceCard className="bg-panelStrong p-3.5">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-quiet">Workspaces</p>
          <div className="mt-2 flex items-end justify-between gap-3">
            <div>
              <p className="text-2xl font-semibold tracking-[-0.04em] text-ink">{payload.codespaces.length}</p>
              <p className="text-xs text-quiet">{runningWorkspaceCount} currently running and ready to reopen.</p>
            </div>
            <StatusPill tone={runningWorkspaceCount ? "success" : "muted"}>
              {runningWorkspaceCount ? "running" : "idle"}
            </StatusPill>
          </div>
        </SurfaceCard>
        <SurfaceCard className="bg-panelStrong p-3.5">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-quiet">Recent orbits</p>
          <div className="mt-2 flex items-end justify-between gap-3">
            <div>
              <p className="text-2xl font-semibold tracking-[-0.04em] text-ink">{payload.recent_orbits.length}</p>
              <p className="text-xs text-quiet">Fast return paths stay in the rail and here in summary only.</p>
            </div>
            <StatusPill tone="muted">focus</StatusPill>
          </div>
        </SurfaceCard>
      </div>

      {error ? <InlineNotice tone="danger" title="Dashboard action blocked" detail={error} /> : null}

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        <Panel className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold tracking-[-0.02em] text-ink">Priority queue</h2>
              <p className="mt-1 text-xs text-quiet">Only the highest-signal approvals, reviews, demos, and completions.</p>
            </div>
            <StatusPill tone={activePriorityCount ? "accent" : "muted"}>
              {activePriorityCount}
            </StatusPill>
          </div>
          <ScrollPanel className="flex-1 px-3 py-3">
            <div className="space-y-2">
              {payload.priority_items.length ? (
                payload.priority_items.map((item, index) => (
                  <ListRow
                    key={index}
                    title={String(item.title ?? "Work item")}
                    detail={String(item.summary ?? item.agent ?? "ERGO")}
                    trailing={
                      <StatusPill tone={String(item.status ?? "").includes("review") ? "accent" : "muted"}>
                        {String(item.status ?? "active")}
                      </StatusPill>
                    }
                    supporting={
                      <>
                        {item.branch_name ? <span>{String(item.branch_name)}</span> : null}
                        {item.agent ? <span>{String(item.agent)}</span> : null}
                        {item.demo_url ? (
                          <a href={String(item.demo_url)} target="_blank" rel="noreferrer" className="font-medium text-ink underline underline-offset-4">
                            Open demo
                          </a>
                        ) : null}
                        {item.draft_pr_url ? (
                          <a href={String(item.draft_pr_url)} target="_blank" rel="noreferrer" className="font-medium text-ink underline underline-offset-4">
                            Review PR
                          </a>
                        ) : null}
                      </>
                    }
                  />
                ))
              ) : (
                <EmptyState detail="Meaningful execution signals will appear here once work starts moving." />
              )}
            </div>
          </ScrollPanel>
        </Panel>

        <Panel className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold tracking-[-0.02em] text-ink">Recent workspaces</h2>
              <p className="mt-1 text-xs text-quiet">Return to active branches quickly without opening a full orbit first.</p>
            </div>
            <StatusPill tone={runningWorkspaceCount ? "success" : "muted"}>
              {runningWorkspaceCount ? `${runningWorkspaceCount} running` : "idle"}
            </StatusPill>
          </div>
          <ScrollPanel className="flex-1 px-3 py-3">
            <div className="space-y-2">
              {payload.codespaces.length ? (
                payload.codespaces.map((item) => (
                  <ListRow
                    key={item.id}
                    title={item.name}
                    detail={[item.branch_name, item.workspace_path].filter(Boolean).join(" · ")}
                    trailing={<StatusPill tone={item.status === "running" ? "success" : "muted"}>{item.status}</StatusPill>}
                    supporting={
                      item.editor_url ? (
                        <a href={item.editor_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-ink">
                          Open editor
                          <ChevronRight className="h-4 w-4" />
                        </a>
                      ) : null
                    }
                  />
                ))
              ) : (
                <EmptyState detail="Workspaces appear here with a running or stopped state once they are created inside an orbit." />
              )}
            </div>
          </ScrollPanel>
        </Panel>
      </div>
    </ShellPage>
  );
}

export function DashboardScreen() {
  const router = useRouter();
  const { mode, setMode } = useTheme();
  const [session, setSession] = useState(readSession());
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [orbits, setOrbits] = useState<Orbit[]>([]);
  const [showCreateOrbit, setShowCreateOrbit] = useState(false);
  const [draft, setDraft] = useState<OrbitDraft>(EMPTY_ORBIT_DRAFT);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function reload() {
    const nextSession = readSession();
    setSession(nextSession);
    if (!nextSession) {
      router.replace("/");
      return;
    }
    try {
      const [nextDashboard, nextOrbits, preferences] = await Promise.all([
        fetchDashboard(nextSession.token),
        fetchOrbits(nextSession.token),
        fetchPreferences(nextSession.token),
      ]);
      setPayload(nextDashboard);
      setOrbits(nextOrbits);
      if (preferences.theme_preference !== mode) {
        setMode(preferences.theme_preference);
      }
      setError(null);
    } catch (nextError) {
      if (nextError instanceof AuthSessionError) {
        setSession(null);
        setPayload(null);
        setOrbits([]);
        router.replace("/");
        return;
      }
      setError(nextError instanceof Error ? nextError.message : "Unable to load the dashboard.");
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  const filteredOrbits = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return orbits;
    }
    return orbits.filter((orbit) => `${orbit.name} ${orbit.description} ${orbit.repo_full_name ?? ""}`.toLowerCase().includes(term));
  }, [orbits, search]);

  const notifications = useMemo(() => {
    if (!payload) {
      return [];
    }
    const priorityNotes = payload.priority_items.slice(0, 4).map((item) => ({
      kind: "priority",
      label: String(item.title ?? "Work item"),
      detail: String(item.status ?? "active"),
    }));
    return [...priorityNotes, ...(payload.notifications ?? []).map((item) => ({ ...item, detail: item.kind }))];
  }, [payload]);

  const shellConfig = useMemo<AppShellConfig>(() => ({
    mode: "dashboard",
    breadcrumb: ["Dashboard"],
    items: [
      {
        key: "home",
        label: "Dashboard",
        icon: House,
        active: true,
        onSelect: () => router.push("/app"),
      },
      {
        key: "new-orbit",
        label: "New orbit",
        icon: Plus,
        onSelect: () => setShowCreateOrbit(true),
      },
    ],
    secondaryContent: payload ? (
      <DashboardSidebarContent
        recentOrbits={payload.recent_orbits}
        onSelectOrbit={(orbitId) => router.push(`/app/orbits/${orbitId}`)}
      />
    ) : (
      <DashboardSidebarContentSkeleton />
    ),
    search: {
      title: "Search orbits",
      description: "Jump to a recent orbit or scan the current product surface quickly.",
      query: search,
      onQueryChange: setSearch,
      placeholder: "Search by orbit name or repository",
      content: (
        <DashboardSearchSurface
          orbits={filteredOrbits}
          onSelectOrbit={(orbitId) => router.push(`/app/orbits/${orbitId}`)}
        />
      ),
    },
    notifications: {
      title: "Notifications",
      description: "The broader activity stream, including the high-signal items already surfaced in Priority.",
      content: <DashboardNotificationsSurface notifications={notifications} />,
    },
  }), [filteredOrbits, notifications, payload, router, search]);

  useAuthenticatedShellConfig(shellConfig);

  async function onCreateOrbit() {
    if (!session || !draft.name.trim()) {
      return;
    }
    setSaving(true);
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
      setSaving(false);
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

  if (!session || !payload) {
    return <ShellPageSkeleton mode="dashboard" />;
  }

  return (
    <>
      <DashboardScreenBody payload={payload} error={error} onCreateOrbitClick={() => setShowCreateOrbit(true)} />

      <CenteredModal
        open={showCreateOrbit}
        onClose={() => setShowCreateOrbit(false)}
        title="Create a new orbit"
        description="Start a GitHub-backed workspace with a clear name, a sharp logo, and the right collaborators from the beginning."
        footer={
          <div className="flex items-center justify-end gap-3">
            <GhostButton onClick={() => setShowCreateOrbit(false)}>Cancel</GhostButton>
            <ActionButton onClick={onCreateOrbit} disabled={saving || !draft.name.trim()}>
              {saving ? "Creating…" : "Create orbit"}
            </ActionButton>
          </div>
        }
      >
        <div className="grid gap-4 md:grid-cols-[1fr_1.2fr]">
          <SurfaceCard className="flex flex-col items-center justify-center gap-4 bg-panelStrong">
            <AvatarMark
              label={draft.name || "AW"}
              src={draft.logo || null}
              className="h-20 w-20 rounded-[14px] text-xl"
            />
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-chip border border-line bg-panel px-3 py-2 text-sm font-medium text-ink">
              <Upload className="h-4 w-4" />
              {draft.logoFileName || "Upload logo"}
              <input type="file" accept="image/*" className="hidden" onChange={(event) => onLogoUpload(event.target.files?.[0])} />
            </label>
            <FieldHint>Upload a small square mark. The current backend stores it as a text URL or data URL.</FieldHint>
          </SurfaceCard>

          <div className="grid gap-4">
            <label className="grid gap-2">
              <FieldLabel>Name</FieldLabel>
              <TextInput value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Orbit Control" />
            </label>
            <label className="grid gap-2">
              <FieldLabel>Description</FieldLabel>
              <TextArea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Coordinate product work, reviews, and runtime execution without clutter." />
            </label>
            <label className="grid gap-2">
              <FieldLabel>Invite emails</FieldLabel>
              <TextInput value={draft.inviteEmails} onChange={(event) => setDraft((current) => ({ ...current, inviteEmails: event.target.value }))} placeholder="reviewer@example.com, ops@example.com" />
            </label>
            <label className="flex items-center gap-3 rounded-pane border border-line bg-panelStrong px-4 py-3 text-sm text-ink">
              <input type="checkbox" checked={draft.private} onChange={(event) => setDraft((current) => ({ ...current, private: event.target.checked }))} />
              Create the GitHub repository as private
            </label>
          </div>
        </div>
      </CenteredModal>
    </>
  );
}
