"use client";

import {
  ChevronRight,
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
  PageHeader,
  ScrollPanel,
  SectionTitle,
  ShellPage,
  ShellPageSkeleton,
  StatusPill,
  SurfaceCard,
  TextArea,
  TextInput,
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
  search,
  onSearchChange,
  orbits,
  onSelectOrbit,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  orbits: Orbit[];
  onSelectOrbit: (orbitId: string) => void;
}) {
  return (
    <div className="space-y-4">
      <TextInput
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder="Search by orbit name or repository"
        autoFocus
      />
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
  return (
    <div className="space-y-3">
      <div className="px-1">
        <SectionTitle
          eyebrow="Home"
          title="Recent orbits"
          detail="Keep active work close without turning the dashboard into a dense admin surface."
          dense
        />
      </div>
      <div className="space-y-2">
        {recentOrbits.length ? (
          recentOrbits.slice(0, 6).map((orbit) => (
            <ListRow
              key={orbit.id}
              title={orbit.name}
              detail={orbit.repo_full_name || "Repository pending"}
              leading={<AvatarMark label={orbit.name} src={isImageLogo(orbit.logo) ? orbit.logo : null} className="h-8 w-8 rounded-[11px]" />}
              onClick={() => onSelectOrbit(orbit.id)}
            />
          ))
        ) : (
          <EmptyState title="No recent orbits" detail="Create a new orbit or open one from search to pin it into this workspace frame." />
        )}
      </div>
    </div>
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
        icon: LayoutGrid,
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
      <div className="px-1">
        <SectionTitle eyebrow="Home" title="Recent orbits" detail="Loading orbit context…" dense />
      </div>
    ),
    search: {
      title: "Search orbits",
      description: "Jump to a recent orbit or scan the current product surface quickly.",
      content: (
        <DashboardSearchSurface
          search={search}
          onSearchChange={setSearch}
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
      <ShellPage>
        <PageHeader
          eyebrow={`Hello, ${payload.me.display_name}`}
          title="Everything important, nothing noisy."
          detail="Priority surfaces only what needs attention. Workspaces stay visible. Search and notifications stay close without taking over the canvas."
          actions={
            <ActionButton onClick={() => setShowCreateOrbit(true)}>
              <Plus className="h-4 w-4" />
              New Orbit
            </ActionButton>
          }
        />

        {error ? (
          <InlineNotice
            className="mt-4"
            tone="danger"
            title="Dashboard action blocked"
            detail={error}
          />
        ) : null}

        <div className="mt-5 grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
          <Panel className="flex min-h-0 flex-col overflow-hidden">
            <div className="border-b border-line px-5 py-4">
              <SectionTitle eyebrow="Priority" title="Signals worth looking at" detail="Approvals, ready reviews, completed work, and live demos appear here only when they matter." dense />
            </div>
            <ScrollPanel className="flex-1 px-4 py-4">
              <div className="space-y-2.5">
                {payload.priority_items.length ? (
                  payload.priority_items.map((item, index) => (
                    <ListRow
                      key={index}
                      eyebrow="Priority signal"
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
                  <EmptyState detail="Create an orbit, ask ERGO to build something, and meaningful signals will surface here." />
                )}
              </div>
            </ScrollPanel>
          </Panel>

          <Panel className="flex min-h-0 flex-col overflow-hidden">
            <div className="border-b border-line px-5 py-4">
              <SectionTitle eyebrow="Workspaces" title="Recent branch contexts" detail="Open a workspace, see whether it is running, and get back to active development quickly." dense />
            </div>
            <ScrollPanel className="flex-1 px-4 py-4">
              <div className="space-y-2.5">
                {payload.codespaces.length ? (
                  payload.codespaces.map((item) => (
                    <ListRow
                      key={item.id}
                      eyebrow="Workspace"
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
