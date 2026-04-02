"use client";

import {
  Bell,
  ChevronRight,
  Home,
  LogOut,
  Moon,
  Plus,
  Search,
  Settings2,
  Sun,
  Upload,
  User2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  AuthSessionError,
  createOrbit,
  fetchDashboard,
  fetchOrbits,
  fetchPreferences,
  readSession,
  updatePreferences,
  writeSession,
} from "@/lib/api";
import type { DashboardPayload, Orbit } from "@/lib/types";
import { useTheme } from "@/components/theme-provider";
import {
  ActionButton,
  AppShell,
  AvatarMark,
  CenteredModal,
  ContextSidebar,
  cx,
  Divider,
  EmptyState,
  FieldHint,
  FieldLabel,
  GhostButton,
  InlineNotice,
  ListRow,
  LeftSlidePanel,
  MenuItem,
  Panel,
  PageHeader,
  PageLoader,
  PopoverMenu,
  RailButton,
  RailCluster,
  RailSidebar,
  ScrollPanel,
  SelectionChip,
  SectionTitle,
  ShellMain,
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
const DASHBOARD_RAIL_OFFSET = 88;

type LeftPanelKind = "search" | "notifications" | null;

function isImageLogo(value?: string | null) {
  return Boolean(value && (value.startsWith("data:") || value.startsWith("http")));
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

export function DashboardScreen() {
  const router = useRouter();
  const { mode, setMode } = useTheme();
  const [session, setSession] = useState(readSession());
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [orbits, setOrbits] = useState<Orbit[]>([]);
  const [activeLeftPanel, setActiveLeftPanel] = useState<LeftPanelKind>(null);
  const [showCreateOrbit, setShowCreateOrbit] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [draft, setDraft] = useState<OrbitDraft>(EMPTY_ORBIT_DRAFT);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const profileRef = useOutsideClose<HTMLDivElement>(showProfileMenu, () => setShowProfileMenu(false));

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
    const priorityNotes = payload.priority_items
      .slice(0, 4)
      .map((item) => ({
        kind: "priority",
        label: String(item.title ?? "Work item"),
        detail: String(item.status ?? "active"),
      }));
    return [...priorityNotes, ...(payload.notifications ?? []).map((item) => ({ ...item, detail: item.kind }))];
  }, [payload]);

  if (!session || !payload) {
    return <PageLoader label="Loading dashboard…" />;
  }

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

  function signOut() {
    writeSession(null);
    router.replace("/");
  }

  return (
    <AppShell
      sidebar={
        <>
          <RailSidebar>
            <RailCluster>
              <button
                className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-[#161616] text-[12px] font-semibold tracking-[-0.02em] text-white transition hover:opacity-90 dark:bg-[#f5f5f5] dark:text-[#141414]"
                onClick={() => router.push("/app")}
                aria-label="AutoWeave home"
              >
                AW
              </button>

              <Divider className="w-8" />

              <RailButton title="Home" active onClick={() => router.push("/app")}>
                <Home className="h-4 w-4" />
              </RailButton>
              <RailButton title="New orbit" onClick={() => setShowCreateOrbit(true)}>
                <Plus className="h-4 w-4" />
              </RailButton>
              <RailButton title="Search" onClick={() => setActiveLeftPanel("search")}>
                <Search className="h-4 w-4" />
              </RailButton>
            </RailCluster>

            <RailCluster>
              <RailButton title="Notifications" onClick={() => setActiveLeftPanel("notifications")}>
                <Bell className="h-4 w-4" />
              </RailButton>
              <div className="relative" ref={profileRef}>
                <RailButton title="Profile" onClick={() => setShowProfileMenu((current) => !current)}>
                  <User2 className="h-4 w-4" />
                </RailButton>
                <PopoverMenu open={showProfileMenu} className="bottom-0 left-full top-auto ml-3 mt-0">
                  <div className="px-3 py-2">
                    <p className="text-sm font-semibold text-ink">{session.user.display_name}</p>
                    <p className="text-xs text-quiet">{session.user.github_login}</p>
                  </div>
                  <MenuItem onClick={() => { setShowSettings(true); setShowProfileMenu(false); }}>
                    <Settings2 className="h-4 w-4" />
                    Global settings
                  </MenuItem>
                  <MenuItem onClick={signOut}>
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </MenuItem>
                </PopoverMenu>
              </div>
            </RailCluster>
          </RailSidebar>

          <ContextSidebar
            eyebrow="Home"
            title="Workspace OS"
            detail="Recent orbits stay close to the main canvas so the dashboard and orbit views feel like one working frame."
          >
            <div className="space-y-2">
              {payload.recent_orbits.slice(0, 6).length ? (
                payload.recent_orbits.slice(0, 6).map((orbit) => (
                  <ListRow
                    key={orbit.id}
                    title={orbit.name}
                    detail={orbit.repo_full_name || "Repository pending"}
                    leading={<AvatarMark label={orbit.name} src={isImageLogo(orbit.logo) ? orbit.logo : null} className="h-8 w-8 rounded-[11px]" />}
                    onClick={() => router.push(`/app/orbits/${orbit.id}`)}
                  />
                ))
              ) : (
                <EmptyState title="No recent orbits" detail="Create a new orbit or open one from search to keep it in this context rail." />
              )}
            </div>
          </ContextSidebar>
        </>
      }
    >
      <ShellMain>
        <div className="mx-auto flex min-w-0 w-full max-w-[1440px] flex-1 flex-col overflow-hidden px-5 py-4 lg:px-7">
          <PageHeader
            eyebrow={`Hello, ${payload.me.display_name}`}
            title="Everything important, nothing noisy."
            detail="Priority surfaces only what needs attention. Codespaces stay visible. Search, notifications, and settings stay off the main canvas until you need them."
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
                <SectionTitle eyebrow="Codespaces" title="Recent branch contexts" detail="Open a workspace, see whether it is running, and get back to active development quickly." dense />
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
                    <EmptyState detail="Codespaces appear here with a running or stopped state once they are created inside an orbit." />
                  )}
                </div>
              </ScrollPanel>
            </Panel>
          </div>
        </div>

        <LeftSlidePanel
          open={activeLeftPanel === "search"}
          onClose={() => setActiveLeftPanel(null)}
          offset={DASHBOARD_RAIL_OFFSET}
          title="Search orbits"
          description="Jump to a recent orbit or scan the current product surface quickly."
        >
          <TextInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by orbit name or repository" />
          <div className="mt-5 space-y-2">
            {filteredOrbits.length ? (
              filteredOrbits.map((orbit) => (
                <Link
                  key={orbit.id}
                  href={`/app/orbits/${orbit.id}`}
                  className="block"
                  onClick={() => setActiveLeftPanel(null)}
                >
                  <ListRow
                    title={orbit.name}
                    detail={orbit.repo_full_name || "Repository pending"}
                    leading={<AvatarMark label={orbit.name} src={isImageLogo(orbit.logo) ? orbit.logo : null} />}
                  />
                </Link>
              ))
            ) : (
              <EmptyState title="No matching orbits" detail="Try a different orbit name or repository filter." />
            )}
          </div>
        </LeftSlidePanel>

        <LeftSlidePanel
          open={activeLeftPanel === "notifications"}
          onClose={() => setActiveLeftPanel(null)}
          offset={DASHBOARD_RAIL_OFFSET}
          title="Notifications"
          description="The broader activity stream, including the high-signal items already surfaced in Priority."
        >
          <div className="space-y-3">
            {notifications.length ? (
              notifications.map((item, index) => (
                <ListRow
                  key={`${item.kind}-${index}`}
                  eyebrow="Activity"
                  title={item.label}
                  detail={"detail" in item && item.detail ? String(item.detail) : undefined}
                  trailing={<StatusPill tone="muted">{item.kind}</StatusPill>}
                />
              ))
            ) : (
              <EmptyState title="No notifications yet" detail="When approvals, reviews, or run updates need attention, they will surface here." />
            )}
          </div>
        </LeftSlidePanel>

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

        <CenteredModal
          open={showSettings}
          onClose={() => setShowSettings(false)}
          title="Global settings"
          description="Quiet preferences that shape how the product feels without cluttering the interface."
          footer={
            <div className="flex items-center justify-end gap-3">
              <GhostButton onClick={() => setShowSettings(false)}>Close</GhostButton>
            </div>
          }
        >
          <div className="space-y-5">
            <SurfaceCard className="bg-panelStrong">
              <SectionTitle eyebrow="Appearance" title="Theme" detail="Default to system, but let the product stay consistent once you choose." dense />
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
                    onClick={async () => {
                      const nextMode = value as typeof mode;
                      setMode(nextMode);
                      await updatePreferences(session.token, { theme_preference: nextMode });
                    }}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </SelectionChip>
                ))}
              </div>
            </SurfaceCard>
            <SurfaceCard className="bg-panelStrong">
              <SectionTitle eyebrow="Profile" title={session.user.display_name} detail={session.user.github_login} dense />
              <p className="mt-3 text-sm text-quiet">GitHub is still the source of truth for identity in this V1 product.</p>
            </SurfaceCard>
          </div>
        </CenteredModal>
      </ShellMain>
    </AppShell>
  );
}
