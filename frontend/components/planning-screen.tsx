"use client";

import {
  CalendarRange,
  Filter,
  FolderOpen,
  Layers3,
  Pin,
  Plus,
  Search,
  Trash2,
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
  CenteredModal,
  EmptyState,
  FieldLabel,
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
  TextArea,
  TextInput,
} from "@/components/ui";
import {
  AuthSessionError,
  createOrbitCycle,
  createSavedView,
  deleteOrbitCycle,
  deleteSavedView,
  fetchPlanningCycles,
  fetchMyWork,
  fetchPreferences,
  fetchSavedViews,
  readSession,
  updateOrbitCycle,
  updateSavedView,
} from "@/lib/api";
import { buildPrimaryShellItems } from "@/lib/app-shell-nav";
import type {
  MyWorkPayload,
  NotificationItem,
  PlanningCycleSummary,
  PlanningCyclesPayload,
  SavedPlanningView,
  SavedViewPreview,
  SavedViewsPayload,
} from "@/lib/types";

type PlanningMode = "cycles" | "views";

type ViewDraft = {
  name: string;
  description: string;
  orbitId: string;
  statuses: string[];
  priorities: string[];
  labels: string[];
  assigneeScope: "all" | "me";
  cycleScope: "any" | "with_cycle" | "without_cycle";
  staleOnly: boolean;
  relationScope: "any" | "blocked" | "related";
  hierarchyScope: "any" | "root" | "parent" | "child";
};

type CycleDraft = {
  orbitId: string;
  name: string;
  goal: string;
  status: "active" | "planned" | "completed" | "archived";
  startsAt: string;
  endsAt: string;
};

const VIEW_DRAFT: ViewDraft = {
  name: "",
  description: "",
  orbitId: "",
  statuses: [],
  priorities: [],
  labels: [],
  assigneeScope: "all",
  cycleScope: "any",
  staleOnly: false,
  relationScope: "any",
  hierarchyScope: "any",
};

const CYCLE_DRAFT: CycleDraft = {
  orbitId: "",
  name: "",
  goal: "",
  status: "active",
  startsAt: "",
  endsAt: "",
};

function toggleSelection(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function isoDate(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  return value.slice(0, 10);
}

function hydrateViewDraft(view: SavedPlanningView): ViewDraft {
  return {
    name: view.label,
    description: view.detail,
    orbitId: view.filters.orbit_id || "",
    statuses: [...view.filters.statuses],
    priorities: [...view.filters.priorities],
    labels: [...view.filters.labels],
    assigneeScope: view.filters.assignee_scope === "me" ? "me" : "all",
    cycleScope:
      view.filters.cycle_scope === "with_cycle" || view.filters.cycle_scope === "without_cycle"
        ? view.filters.cycle_scope
        : "any",
    staleOnly: Boolean(view.filters.stale_only),
    relationScope:
      view.filters.relation_scope === "blocked" || view.filters.relation_scope === "related"
        ? view.filters.relation_scope
        : "any",
    hierarchyScope:
      view.filters.hierarchy_scope === "root" || view.filters.hierarchy_scope === "parent" || view.filters.hierarchy_scope === "child"
        ? view.filters.hierarchy_scope
        : "any",
  };
}

function hydrateCycleDraft(cycle: PlanningCycleSummary): CycleDraft {
  return {
    orbitId: cycle.orbit_id,
    name: cycle.label,
    goal: cycle.goal || "",
    status:
      cycle.status === "planned" || cycle.status === "completed" || cycle.status === "archived"
        ? cycle.status
        : "active",
    startsAt: isoDate(cycle.starts_at),
    endsAt: isoDate(cycle.ends_at),
  };
}

function notificationTone(item: NotificationItem) {
  if (item.kind === "run_failed") {
    return "danger" as const;
  }
  if (["approval", "clarification"].includes(item.kind)) {
    return "warning" as const;
  }
  return "muted" as const;
}

function RecentOrbitsSidebar({
  payload,
  onOpenOrbit,
}: {
  payload: MyWorkPayload;
  onOpenOrbit: (orbitId: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      {payload.recent_orbits.length ? (
        payload.recent_orbits.slice(0, 5).map((orbit) => (
          <button
            key={orbit.id}
            type="button"
            title={orbit.name}
            aria-label={orbit.name}
            onClick={() => onOpenOrbit(orbit.id)}
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
  );
}

function PreviewRows({
  items,
  onOpen,
}: {
  items: SavedViewPreview[];
  onOpen: (href: string) => void;
}) {
  if (!items.length) {
    return (
      <EmptyState
        title="No items in this lane"
        detail="The underlying queue is currently quiet. As issue state and teammate work change, the lane will populate automatically."
      />
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <ListRow
          key={item.id}
          eyebrow={item.eyebrow}
          title={item.title}
          detail={item.detail}
          supporting={item.supporting ? <span>{item.supporting}</span> : undefined}
          trailing={<StatusPill tone={item.tone}>{item.status}</StatusPill>}
          onClick={() => onOpen(item.href)}
        />
      ))}
    </div>
  );
}

function PlanningCycleDetail({
  cycle,
  onOpen,
  onEdit,
  onDelete,
}: {
  cycle: PlanningCycleSummary;
  onOpen: (href: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Panel className="flex min-h-0 flex-col overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-[-0.02em] text-ink">{cycle.label}</p>
            <p className="mt-1 text-xs leading-5 text-quiet">{cycle.detail}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <StatusPill tone="muted">{cycle.orbit_name}</StatusPill>
              <StatusPill tone="muted">{cycle.status.replaceAll("_", " ")}</StatusPill>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={cycle.tone}>{cycle.window_label}</StatusPill>
            <GhostButton className="px-2.5 py-1.5 text-[11px]" onClick={onEdit}>
              Edit cycle
            </GhostButton>
            <GhostButton className="px-2.5 py-1.5 text-[11px]" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </GhostButton>
          </div>
        </div>
      </div>
      <div className="grid gap-3 border-b border-line px-4 py-3 md:grid-cols-3">
        <SurfaceCard className="bg-panelStrong p-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-quiet">Total items</p>
          <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-ink">{cycle.metrics.count}</p>
        </SurfaceCard>
        <SurfaceCard className="bg-panelStrong p-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-quiet">Review pressure</p>
          <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-ink">{cycle.metrics.review}</p>
        </SurfaceCard>
        <SurfaceCard className="bg-panelStrong p-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-quiet">Blocked risk</p>
          <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-ink">{cycle.metrics.blocked}</p>
        </SurfaceCard>
      </div>
      <div className="grid gap-3 border-b border-line px-4 py-3 md:grid-cols-2">
        <SurfaceCard className="bg-panelStrong p-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-quiet">Stale work</p>
          <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-ink">{cycle.metrics.stale}</p>
        </SurfaceCard>
        <SurfaceCard className="bg-panelStrong p-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-quiet">Completed</p>
          <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-ink">{cycle.metrics.completed}</p>
        </SurfaceCard>
      </div>
      <ScrollPanel className="flex-1 px-4 py-3">
        <PreviewRows items={cycle.highlights} onOpen={onOpen} />
      </ScrollPanel>
    </Panel>
  );
}

function PlanningViewDetail({
  view,
  onOpen,
  onPinToggle,
  onEdit,
  onDelete,
}: {
  view: SavedPlanningView;
  onOpen: (href: string) => void;
  onPinToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Panel className="flex min-h-0 flex-col overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-[-0.02em] text-ink">{view.label}</p>
            <p className="mt-1 text-xs leading-5 text-quiet">{view.detail}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={view.kind === "custom" ? "accent" : "muted"}>
              {view.kind === "custom" ? (view.pinned ? "Pinned custom view" : "Custom view") : "System view"}
            </StatusPill>
            {view.kind === "custom" ? (
              <>
                <GhostButton className="px-2.5 py-1.5 text-[11px]" onClick={onPinToggle}>
                  <Pin className="h-3.5 w-3.5" />
                  {view.pinned ? "Unpin" : "Pin"}
                </GhostButton>
                <GhostButton className="px-2.5 py-1.5 text-[11px]" onClick={onEdit}>
                  Edit
                </GhostButton>
                <GhostButton className="px-2.5 py-1.5 text-[11px]" onClick={onDelete}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </GhostButton>
              </>
            ) : null}
          </div>
        </div>
      </div>
      <div className="grid gap-3 border-b border-line px-4 py-3 md:grid-cols-3">
        <SurfaceCard className="bg-panelStrong p-3 md:col-span-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-quiet">Items in view</p>
          <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-ink">{view.count}</p>
        </SurfaceCard>
        <SurfaceCard className="bg-panelStrong p-3 md:col-span-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-quiet">Filters</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {view.filter_summary.map((item) => (
              <StatusPill key={`${view.id}-${item}`} tone="muted">
                {item}
              </StatusPill>
            ))}
          </div>
        </SurfaceCard>
      </div>
      <ScrollPanel className="flex-1 px-4 py-3">
        <PreviewRows items={view.preview} onOpen={onOpen} />
      </ScrollPanel>
    </Panel>
  );
}

export function PlanningScreen({ mode: planningMode }: { mode: PlanningMode }) {
  const router = useRouter();
  const { mode, setMode } = useTheme();
  const [session, setSession] = useState(readSession());
  const [payload, setPayload] = useState<MyWorkPayload | null>(null);
  const [planningCyclesPayload, setPlanningCyclesPayload] = useState<PlanningCyclesPayload | null>(null);
  const [savedViewsPayload, setSavedViewsPayload] = useState<SavedViewsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreateView, setShowCreateView] = useState(false);
  const [editingViewId, setEditingViewId] = useState<string | null>(null);
  const [viewDraft, setViewDraft] = useState<ViewDraft>(VIEW_DRAFT);
  const [creatingView, setCreatingView] = useState(false);
  const [showCycleEditor, setShowCycleEditor] = useState(false);
  const [editingCycleId, setEditingCycleId] = useState<string | null>(null);
  const [cycleDraft, setCycleDraft] = useState<CycleDraft>(CYCLE_DRAFT);
  const [savingCycle, setSavingCycle] = useState(false);

  async function reload() {
    const nextSession = readSession();
    setSession(nextSession);
    if (!nextSession) {
      router.replace("/");
      return;
    }
    try {
      const [nextPayload, preferences, nextSavedViews, nextCycles] = await Promise.all([
        fetchMyWork(nextSession.token),
        fetchPreferences(nextSession.token),
        planningMode === "views" ? fetchSavedViews(nextSession.token) : Promise.resolve(null),
        planningMode === "cycles" ? fetchPlanningCycles(nextSession.token) : Promise.resolve(null),
      ]);
      setPayload(nextPayload);
      setSavedViewsPayload(nextSavedViews);
      setPlanningCyclesPayload(nextCycles);
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
      setError(nextError instanceof Error ? nextError.message : "Unable to load planning surfaces.");
    }
  }

  useEffect(() => {
    void reload();
  }, [planningMode]);

  async function onSaveView() {
    if (!session || !viewDraft.name.trim()) {
      return;
    }
    setCreatingView(true);
    try {
      const payload = {
        name: viewDraft.name.trim(),
        description: viewDraft.description.trim() || null,
        orbit_id: viewDraft.orbitId || null,
        statuses: viewDraft.statuses,
        priorities: viewDraft.priorities,
        labels: viewDraft.labels,
        assignee_scope: viewDraft.assigneeScope,
        cycle_scope: viewDraft.cycleScope,
        stale_only: viewDraft.staleOnly,
        relation_scope: viewDraft.relationScope,
        hierarchy_scope: viewDraft.hierarchyScope,
      };
      const nextSavedViews = editingViewId
        ? await updateSavedView(session.token, editingViewId, payload)
        : await createSavedView(session.token, payload);
      setSavedViewsPayload(nextSavedViews);
      setShowCreateView(false);
      setEditingViewId(null);
      setViewDraft(VIEW_DRAFT);
      const savedEntry = nextSavedViews.views.find(
        (entry) => entry.kind === "custom" && entry.label === payload.name,
      );
      setSelectedId(savedEntry?.id ?? nextSavedViews.views[0]?.id ?? null);
      setError(null);
    } catch (nextError) {
      if (nextError instanceof AuthSessionError) {
        setSession(null);
        setPayload(null);
        setSavedViewsPayload(null);
        setPlanningCyclesPayload(null);
        router.replace("/");
        return;
      }
      setError(nextError instanceof Error ? nextError.message : "Unable to save the view.");
    } finally {
      setCreatingView(false);
    }
  }

  async function onTogglePinView(view: SavedPlanningView) {
    if (!session || view.kind !== "custom") {
      return;
    }
    try {
      const nextSavedViews = await updateSavedView(session.token, view.id, { pinned: !view.pinned });
      setSavedViewsPayload(nextSavedViews);
      setSelectedId(view.id);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to update the view pin.");
    }
  }

  async function onDeleteView(view: SavedPlanningView) {
    if (!session || view.kind !== "custom" || !window.confirm(`Delete ${view.label}?`)) {
      return;
    }
    try {
      const nextSavedViews = await deleteSavedView(session.token, view.id);
      setSavedViewsPayload(nextSavedViews);
      setSelectedId(nextSavedViews.views[0]?.id ?? null);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to delete the saved view.");
    }
  }

  async function onSaveCycle() {
    if (!session || !cycleDraft.name.trim() || !cycleDraft.orbitId) {
      return;
    }
    setSavingCycle(true);
    try {
      const payload = {
        name: cycleDraft.name.trim(),
        goal: cycleDraft.goal.trim() || null,
        status: cycleDraft.status,
        starts_at: cycleDraft.startsAt ? new Date(`${cycleDraft.startsAt}T00:00:00Z`).toISOString() : null,
        ends_at: cycleDraft.endsAt ? new Date(`${cycleDraft.endsAt}T00:00:00Z`).toISOString() : null,
      };
      if (editingCycleId) {
        await updateOrbitCycle(session.token, cycleDraft.orbitId, editingCycleId, payload);
      } else {
        await createOrbitCycle(session.token, cycleDraft.orbitId, payload);
      }
      await reload();
      setShowCycleEditor(false);
      setEditingCycleId(null);
      setCycleDraft(CYCLE_DRAFT);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to save the cycle.");
    } finally {
      setSavingCycle(false);
    }
  }

  async function onDeleteCycle(cycle: PlanningCycleSummary) {
    if (!session || !window.confirm(`Delete ${cycle.label}?`)) {
      return;
    }
    try {
      await deleteOrbitCycle(session.token, cycle.orbit_id, cycle.id);
      await reload();
      setSelectedId(null);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to delete the cycle.");
    }
  }

  const cycles = useMemo(() => planningCyclesPayload?.cycles ?? [], [planningCyclesPayload]);
  const views = useMemo(() => savedViewsPayload?.views ?? [], [savedViewsPayload]);

  const entries = planningMode === "cycles" ? cycles : views;
  const availableLabels = payload?.issue_labels ?? [];
  const filteredEntries = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return entries;
    }
    return entries.filter((entry) => `${entry.label} ${entry.detail}`.toLowerCase().includes(term));
  }, [entries, search]);

  useEffect(() => {
    if (!filteredEntries.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !filteredEntries.some((entry) => entry.id === selectedId)) {
      setSelectedId(filteredEntries[0].id);
    }
  }, [filteredEntries, selectedId]);

  const selectedCycle = planningMode === "cycles"
    ? filteredEntries.find((entry): entry is PlanningCycleSummary => entry.id === selectedId) ?? filteredEntries[0] as PlanningCycleSummary | undefined
    : undefined;
  const selectedView = planningMode === "views"
    ? filteredEntries.find((entry): entry is SavedPlanningView => entry.id === selectedId) ?? filteredEntries[0] as SavedPlanningView | undefined
    : undefined;

  const notificationsContent = useMemo(() => {
    if (!payload?.notifications.length) {
      return <EmptyState title="No new planning signals" detail="Reviews, failures, and approval requests will show up here as the workspace changes." />;
    }
    return (
      <div className="space-y-2">
        {payload.notifications.slice(0, 8).map((item) => (
          <ListRow
            key={item.id}
            eyebrow="Signal"
            title={item.title}
            detail={item.detail}
            trailing={<StatusPill tone={notificationTone(item)}>{item.kind.replaceAll("_", " ")}</StatusPill>}
          />
        ))}
      </div>
    );
  }, [payload]);

  const searchResults = useMemo(() => {
    if (planningMode === "cycles") {
      return (filteredEntries as PlanningCycleSummary[]).map((entry) => ({
        key: entry.id,
        label: entry.label,
        detail: entry.window_label,
      }));
    }
    return (filteredEntries as SavedPlanningView[]).map((entry) => ({
      key: entry.id,
      label: entry.label,
      detail: `${entry.count} items`,
    }));
  }, [filteredEntries, planningMode]);

  const shellConfig = useMemo<AppShellConfig>(() => ({
    mode: "dashboard",
    breadcrumb: [planningMode === "cycles" ? "Cycles" : "Views"],
    items: buildPrimaryShellItems(router, planningMode),
    secondaryContent: payload ? (
      <RecentOrbitsSidebar payload={payload} onOpenOrbit={(orbitId) => router.push(`/app/orbits/${orbitId}`)} />
    ) : null,
    search: {
      title: planningMode === "cycles" ? "Search cycles" : "Search views",
      description: planningMode === "cycles"
        ? "Jump between the current execution, review, and risk windows."
        : "Jump between saved issue views without leaving the PM shell.",
      query: search,
      onQueryChange: setSearch,
      placeholder: planningMode === "cycles" ? "Search operational cycles" : "Search pinned views",
      content: searchResults.length ? (
        <div className="max-h-[420px] space-y-2 overflow-auto">
          {searchResults.map((item) => (
            <ListRow
              key={item.key}
              title={item.label}
              detail={item.detail}
              leading={<Search className="h-4 w-4" />}
              onClick={() => setSelectedId(item.key)}
            />
          ))}
        </div>
      ) : (
        <EmptyState title="No matches" detail="Try a different planning term." />
      ),
    },
    notifications: {
      title: planningMode === "cycles" ? "Cycle signals" : "View signals",
      description: "The underlying notifications feeding these PM surfaces right now.",
      content: notificationsContent,
    },
  }), [notificationsContent, payload, planningMode, router, search, searchResults]);

  useAuthenticatedShellConfig(shellConfig);

  if (!session || !payload) {
    return <ShellPageSkeleton mode="dashboard" />;
  }

  const summaryCards = planningMode === "cycles"
    ? cycles.map((cycle) => ({
        id: cycle.id,
        label: cycle.label,
        value: cycle.metrics.count,
        detail: cycle.detail,
        tone: cycle.tone,
      }))
    : views.slice(0, 3).map((view) => ({
        id: view.id,
        label: view.label,
        value: view.count,
        detail: view.detail,
        tone: view.tone,
      }));
  const cycleEntries = planningMode === "cycles" ? (filteredEntries as PlanningCycleSummary[]) : [];
  const viewEntries = planningMode === "views" ? (filteredEntries as SavedPlanningView[]) : [];

  return (
    <ShellPage className="gap-4">
      {error ? <InlineNotice tone="danger" detail={error} /> : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-quiet">{planningMode === "cycles" ? "Operational planning windows" : "Pinned work views"}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-ink">{planningMode === "cycles" ? "Cycles" : "Views"}</h1>
          <p className="mt-2 max-w-[64ch] text-sm leading-6 text-quiet">
            {planningMode === "cycles"
              ? "Real orbit cycles now carry scope, review pressure, and delivery risk across the workspace."
              : "Saved views pin real issue slices across orbits so planning stays operational and repeatable instead of getting rebuilt from scratch."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <GhostButton onClick={() => router.push("/app/my-work")}>
            <Layers3 className="h-4 w-4" />
            Open my work
          </GhostButton>
          {planningMode === "cycles" ? (
            <>
              <GhostButton onClick={() => router.push("/app/views")}>
                <Filter className="h-4 w-4" />
                Open views
              </GhostButton>
              <ActionButton
                onClick={() => {
                  setEditingCycleId(null);
                  setCycleDraft({ ...CYCLE_DRAFT, orbitId: payload.recent_orbits[0]?.id || "" });
                  setShowCycleEditor(true);
                }}
              >
                <Plus className="h-4 w-4" />
                New cycle
              </ActionButton>
            </>
          ) : (
            <>
              <GhostButton onClick={() => router.push("/app/cycles")}>
                <CalendarRange className="h-4 w-4" />
                Open cycles
              </GhostButton>
              <ActionButton onClick={() => setShowCreateView(true)}>
                <Plus className="h-4 w-4" />
                New view
              </ActionButton>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        {summaryCards.map((card) => (
          <SurfaceCard key={card.id} className="bg-panelStrong p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-quiet">{card.label}</p>
                <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-ink">{card.value}</p>
                <p className="mt-1 text-xs text-quiet">{card.detail}</p>
              </div>
              <StatusPill tone={card.tone}>{card.value ? "live" : "quiet"}</StatusPill>
            </div>
          </SurfaceCard>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(320px,0.82fr)_minmax(0,1.18fr)]">
        <Panel className="flex min-h-0 flex-col overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <p className="text-sm font-semibold tracking-[-0.02em] text-ink">
              {planningMode === "cycles" ? "Planning windows" : "Pinned views"}
            </p>
            <p className="mt-1 text-xs text-quiet">
              {planningMode === "cycles"
                ? "Real orbit cycles grouped across the workspace."
                : "Saved views stay focused on native issue work, not chat threads or one-off filters."}
            </p>
          </div>
          <ScrollPanel className="flex-1 px-4 py-3">
            <div className="space-y-2">
              {planningMode === "cycles"
                ? cycleEntries.map((entry) => (
                    <ListRow
                      key={entry.id}
                      eyebrow={entry.window_label}
                      title={entry.label}
                      detail={entry.detail}
                      active={entry.id === selectedId}
                      trailing={<StatusPill tone={entry.tone}>{entry.metrics.count}</StatusPill>}
                      onClick={() => setSelectedId(entry.id)}
                    />
                  ))
                : viewEntries.map((entry) => (
                    <ListRow
                      key={entry.id}
                      eyebrow={entry.kind === "custom" ? (entry.pinned ? "Pinned custom view" : "Custom view") : "System view"}
                      title={entry.label}
                      detail={entry.detail}
                      active={entry.id === selectedId}
                      trailing={<StatusPill tone={entry.tone}>{entry.count}</StatusPill>}
                      onClick={() => setSelectedId(entry.id)}
                    />
                  ))}
            </div>
          </ScrollPanel>
        </Panel>

        {planningMode === "cycles" && selectedCycle ? (
          <PlanningCycleDetail
            cycle={selectedCycle}
            onOpen={(href) => router.push(href)}
            onEdit={() => {
              setEditingCycleId(selectedCycle.id);
              setCycleDraft(hydrateCycleDraft(selectedCycle));
              setShowCycleEditor(true);
            }}
            onDelete={() => void onDeleteCycle(selectedCycle)}
          />
        ) : planningMode === "cycles" ? (
          <Panel className="flex min-h-0 items-center justify-center p-6">
            <EmptyState
              title="No cycles"
              detail="Create a real orbit cycle to start grouping native issue work across the workspace."
            />
          </Panel>
        ) : null}
        {planningMode === "views" && selectedView ? (
          <PlanningViewDetail
            view={selectedView}
            onOpen={(href) => router.push(href)}
            onPinToggle={() => void onTogglePinView(selectedView)}
            onEdit={() => {
              setEditingViewId(selectedView.id);
              setViewDraft(hydrateViewDraft(selectedView));
              setShowCreateView(true);
            }}
            onDelete={() => void onDeleteView(selectedView)}
          />
        ) : planningMode === "views" ? (
          <Panel className="flex min-h-0 items-center justify-center p-6">
            <EmptyState
              title="No saved views"
              detail="Create a view to pin an issue slice across orbits and keep it available from the shell."
            />
          </Panel>
        ) : null}
      </div>

      <Panel className="overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <p className="text-sm font-semibold tracking-[-0.02em] text-ink">Orbit coverage</p>
          <p className="mt-1 text-xs text-quiet">The projects currently feeding the planning model.</p>
        </div>
        <ScrollPanel className="max-h-[260px] px-4 py-3">
          <div className="space-y-2">
            {payload.recent_orbits.length ? (
              payload.recent_orbits.map((orbit) => (
                <ListRow
                  key={orbit.id}
                  eyebrow={orbit.repo_full_name || "Orbit"}
                  title={orbit.name}
                  detail={orbit.description || "Project coordination surface"}
                  trailing={
                    <GhostButton className="px-3 py-1.5 text-xs" onClick={() => router.push(`/app/orbits/${orbit.id}`)}>
                      <FolderOpen className="h-3.5 w-3.5" />
                      Open
                    </GhostButton>
                  }
                />
              ))
            ) : (
              <EmptyState
                title="No orbits in scope"
                detail="Create or connect an orbit to turn these planning surfaces into real project control planes."
              />
            )}
          </div>
        </ScrollPanel>
      </Panel>

      <CenteredModal
        open={planningMode === "views" && showCreateView}
        onClose={() => {
          setShowCreateView(false);
          setEditingViewId(null);
          setViewDraft(VIEW_DRAFT);
        }}
        title={editingViewId ? "Edit saved view" : "Create saved view"}
        description="Pin a native issue slice so the shell keeps surfacing it without rebuilding filters every time."
        footer={
          <div className="flex items-center justify-end gap-3">
            <GhostButton
              onClick={() => {
                setShowCreateView(false);
                setEditingViewId(null);
                setViewDraft(VIEW_DRAFT);
              }}
            >
              Cancel
            </GhostButton>
            <ActionButton onClick={() => void onSaveView()} disabled={creatingView || !viewDraft.name.trim()}>
              {creatingView ? "Saving…" : editingViewId ? "Save view" : "Create view"}
            </ActionButton>
          </div>
        }
      >
        <div className="space-y-4">
          <label className="grid gap-2">
            <FieldLabel>Name</FieldLabel>
            <TextInput
              value={viewDraft.name}
              onChange={(event) => setViewDraft((current) => ({ ...current, name: event.target.value }))}
              placeholder="High priority cycle work"
            />
          </label>
          <label className="grid gap-2">
            <FieldLabel>Description</FieldLabel>
            <TextArea
              value={viewDraft.description}
              onChange={(event) => setViewDraft((current) => ({ ...current, description: event.target.value }))}
              placeholder="Keep urgent issues with explicit cycle ownership visible across active orbits."
            />
          </label>
          <div className="space-y-2">
            <FieldLabel>Orbit scope</FieldLabel>
            <div className="flex flex-wrap gap-2">
              <SelectionChip active={!viewDraft.orbitId} onClick={() => setViewDraft((current) => ({ ...current, orbitId: "" }))}>
                All orbits
              </SelectionChip>
              {payload?.recent_orbits.map((orbit) => (
                <SelectionChip
                  key={orbit.id}
                  active={viewDraft.orbitId === orbit.id}
                  onClick={() => setViewDraft((current) => ({ ...current, orbitId: orbit.id }))}
                >
                  {orbit.name}
                </SelectionChip>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <FieldLabel>Stages</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {[
                { value: "triage", label: "Triage" },
                { value: "planned", label: "Planned" },
                { value: "in_progress", label: "In progress" },
                { value: "in_review", label: "Review" },
                { value: "ready_to_merge", label: "Ready to merge" },
              ].map((status) => (
                <SelectionChip
                  key={status.value}
                  active={viewDraft.statuses.includes(status.value)}
                  onClick={() => setViewDraft((current) => ({ ...current, statuses: toggleSelection(current.statuses, status.value) }))}
                >
                  {status.label}
                </SelectionChip>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <FieldLabel>Priority</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {["low", "medium", "high", "urgent"].map((priority) => (
                <SelectionChip
                  key={priority}
                  active={viewDraft.priorities.includes(priority)}
                  onClick={() => setViewDraft((current) => ({ ...current, priorities: toggleSelection(current.priorities, priority) }))}
                >
                  {priority}
                </SelectionChip>
              ))}
            </div>
          </div>
          {availableLabels.length ? (
            <div className="space-y-2">
              <FieldLabel>Labels</FieldLabel>
              <div className="flex flex-wrap gap-2">
                {availableLabels.map((label) => (
                  <SelectionChip
                    key={label.id}
                    active={viewDraft.labels.includes(label.slug)}
                    onClick={() => setViewDraft((current) => ({ ...current, labels: toggleSelection(current.labels, label.slug) }))}
                  >
                    {label.name}
                  </SelectionChip>
                ))}
              </div>
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <FieldLabel>Ownership</FieldLabel>
              <div className="flex flex-wrap gap-2">
                <SelectionChip
                  active={viewDraft.assigneeScope === "all"}
                  onClick={() => setViewDraft((current) => ({ ...current, assigneeScope: "all" }))}
                >
                  All assignees
                </SelectionChip>
                <SelectionChip
                  active={viewDraft.assigneeScope === "me"}
                  onClick={() => setViewDraft((current) => ({ ...current, assigneeScope: "me" }))}
                >
                  Assigned to me
                </SelectionChip>
              </div>
            </div>
            <div className="space-y-2">
              <FieldLabel>Cycle scope</FieldLabel>
              <div className="flex flex-wrap gap-2">
                <SelectionChip
                  active={viewDraft.cycleScope === "any"}
                  onClick={() => setViewDraft((current) => ({ ...current, cycleScope: "any" }))}
                >
                  Any cycle
                </SelectionChip>
                <SelectionChip
                  active={viewDraft.cycleScope === "with_cycle"}
                  onClick={() => setViewDraft((current) => ({ ...current, cycleScope: "with_cycle" }))}
                >
                  In a cycle
                </SelectionChip>
                <SelectionChip
                  active={viewDraft.cycleScope === "without_cycle"}
                  onClick={() => setViewDraft((current) => ({ ...current, cycleScope: "without_cycle" }))}
                >
                  No cycle
                </SelectionChip>
              </div>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <FieldLabel>Freshness</FieldLabel>
              <div className="flex flex-wrap gap-2">
                <SelectionChip
                  active={!viewDraft.staleOnly}
                  onClick={() => setViewDraft((current) => ({ ...current, staleOnly: false }))}
                >
                  Any age
                </SelectionChip>
                <SelectionChip
                  active={viewDraft.staleOnly}
                  onClick={() => setViewDraft((current) => ({ ...current, staleOnly: true }))}
                >
                  Stale only
                </SelectionChip>
              </div>
            </div>
            <div className="space-y-2">
              <FieldLabel>Relations</FieldLabel>
              <div className="flex flex-wrap gap-2">
                <SelectionChip
                  active={viewDraft.relationScope === "any"}
                  onClick={() => setViewDraft((current) => ({ ...current, relationScope: "any" }))}
                >
                  Any links
                </SelectionChip>
                <SelectionChip
                  active={viewDraft.relationScope === "blocked"}
                  onClick={() => setViewDraft((current) => ({ ...current, relationScope: "blocked" }))}
                >
                  Dependency risk
                </SelectionChip>
                <SelectionChip
                  active={viewDraft.relationScope === "related"}
                  onClick={() => setViewDraft((current) => ({ ...current, relationScope: "related" }))}
                >
                  Linked work
                </SelectionChip>
              </div>
            </div>
            <div className="space-y-2">
              <FieldLabel>Hierarchy</FieldLabel>
              <div className="flex flex-wrap gap-2">
                <SelectionChip
                  active={viewDraft.hierarchyScope === "any"}
                  onClick={() => setViewDraft((current) => ({ ...current, hierarchyScope: "any" }))}
                >
                  Any depth
                </SelectionChip>
                <SelectionChip
                  active={viewDraft.hierarchyScope === "root"}
                  onClick={() => setViewDraft((current) => ({ ...current, hierarchyScope: "root" }))}
                >
                  Root issues
                </SelectionChip>
                <SelectionChip
                  active={viewDraft.hierarchyScope === "parent"}
                  onClick={() => setViewDraft((current) => ({ ...current, hierarchyScope: "parent" }))}
                >
                  Sub-issues
                </SelectionChip>
                <SelectionChip
                  active={viewDraft.hierarchyScope === "child"}
                  onClick={() => setViewDraft((current) => ({ ...current, hierarchyScope: "child" }))}
                >
                  Parent issues
                </SelectionChip>
              </div>
            </div>
          </div>
        </div>
      </CenteredModal>

      <CenteredModal
        open={planningMode === "cycles" && showCycleEditor}
        onClose={() => {
          setShowCycleEditor(false);
          setEditingCycleId(null);
          setCycleDraft(CYCLE_DRAFT);
        }}
        title={editingCycleId ? "Edit cycle" : "Create cycle"}
        description="Keep delivery commitments explicit across each orbit instead of deriving them from queue pressure."
        footer={
          <div className="flex items-center justify-end gap-3">
            <GhostButton
              onClick={() => {
                setShowCycleEditor(false);
                setEditingCycleId(null);
                setCycleDraft(CYCLE_DRAFT);
              }}
            >
              Cancel
            </GhostButton>
            <ActionButton onClick={() => void onSaveCycle()} disabled={savingCycle || !cycleDraft.orbitId || !cycleDraft.name.trim()}>
              {savingCycle ? "Saving…" : editingCycleId ? "Save cycle" : "Create cycle"}
            </ActionButton>
          </div>
        }
      >
        <div className="space-y-4">
          <label className="grid gap-2">
            <FieldLabel>Orbit</FieldLabel>
            <select
              value={cycleDraft.orbitId}
              onChange={(event) => setCycleDraft((current) => ({ ...current, orbitId: event.target.value }))}
              disabled={Boolean(editingCycleId)}
              className="rounded-chip border border-line bg-panel px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-lineStrong focus-visible:ring-2 focus-visible:ring-focusRing disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="">Select orbit</option>
              {payload.recent_orbits.map((orbit) => (
                <option key={orbit.id} value={orbit.id}>
                  {orbit.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2">
            <FieldLabel>Name</FieldLabel>
            <TextInput
              value={cycleDraft.name}
              onChange={(event) => setCycleDraft((current) => ({ ...current, name: event.target.value }))}
              placeholder="April stabilization"
            />
          </label>
          <label className="grid gap-2">
            <FieldLabel>Goal</FieldLabel>
            <TextArea
              value={cycleDraft.goal}
              onChange={(event) => setCycleDraft((current) => ({ ...current, goal: event.target.value }))}
              placeholder="Land the PM shell cleanup and unblock release review."
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="grid gap-2">
              <FieldLabel>Status</FieldLabel>
              <select
                value={cycleDraft.status}
                onChange={(event) => setCycleDraft((current) => ({ ...current, status: event.target.value as CycleDraft["status"] }))}
                className="rounded-chip border border-line bg-panel px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-lineStrong focus-visible:ring-2 focus-visible:ring-focusRing"
              >
                <option value="active">Active</option>
                <option value="planned">Planned</option>
                <option value="completed">Completed</option>
                <option value="archived">Archived</option>
              </select>
            </label>
            <label className="grid gap-2">
              <FieldLabel>Starts</FieldLabel>
              <TextInput
                type="date"
                value={cycleDraft.startsAt}
                onChange={(event) => setCycleDraft((current) => ({ ...current, startsAt: event.target.value }))}
              />
            </label>
            <label className="grid gap-2">
              <FieldLabel>Ends</FieldLabel>
              <TextInput
                type="date"
                value={cycleDraft.endsAt}
                onChange={(event) => setCycleDraft((current) => ({ ...current, endsAt: event.target.value }))}
              />
            </label>
          </div>
        </div>
      </CenteredModal>
    </ShellPage>
  );
}
