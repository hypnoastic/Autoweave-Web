"use client";

import {
  CalendarRange,
  Filter,
  FolderOpen,
  Layers3,
  Search,
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
  ShellPage,
  ShellPageSkeleton,
  StatusPill,
  SurfaceCard,
} from "@/components/ui";
import { AuthSessionError, fetchMyWork, fetchPreferences, readSession } from "@/lib/api";
import { buildPrimaryShellItems } from "@/lib/app-shell-nav";
import {
  derivePlanningCycles,
  derivePlanningViews,
  type PlanningCycle,
  type PlanningPreview,
  type PlanningView,
} from "@/lib/planning-derived";
import type { MyWorkPayload, NotificationItem } from "@/lib/types";

type PlanningMode = "cycles" | "views";

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
  items: PlanningPreview[];
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
}: {
  cycle: PlanningCycle;
  onOpen: (href: string) => void;
}) {
  return (
    <Panel className="flex min-h-0 flex-col overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-[-0.02em] text-ink">{cycle.label}</p>
            <p className="mt-1 text-xs leading-5 text-quiet">{cycle.detail}</p>
          </div>
          <StatusPill tone={cycle.tone}>{cycle.windowLabel}</StatusPill>
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
      <ScrollPanel className="flex-1 px-4 py-3">
        <PreviewRows items={cycle.highlights} onOpen={onOpen} />
      </ScrollPanel>
    </Panel>
  );
}

function PlanningViewDetail({
  view,
  onOpen,
}: {
  view: PlanningView;
  onOpen: (href: string) => void;
}) {
  return (
    <Panel className="flex min-h-0 flex-col overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-[-0.02em] text-ink">{view.label}</p>
            <p className="mt-1 text-xs leading-5 text-quiet">{view.detail}</p>
          </div>
          <GhostButton className="px-3 py-1.5 text-xs" onClick={() => onOpen(view.href)}>
            Open surface
          </GhostButton>
        </div>
      </div>
      <div className="grid gap-3 border-b border-line px-4 py-3 md:grid-cols-3">
        <SurfaceCard className="bg-panelStrong p-3 md:col-span-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-quiet">Items in view</p>
          <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-ink">{view.count}</p>
        </SurfaceCard>
        <InlineNotice
          tone={view.tone === "danger" ? "danger" : view.tone === "warning" ? "warning" : "neutral"}
          detail="These views are currently derived from live issue, approval, and teammate signals. Native saved views are the next planning slice."
          className="md:col-span-2"
        />
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
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
      setError(nextError instanceof Error ? nextError.message : "Unable to load planning surfaces.");
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  const cycles = useMemo(() => (payload ? derivePlanningCycles(payload) : []), [payload]);
  const views = useMemo(() => (payload ? derivePlanningViews(payload) : []), [payload]);

  const entries = planningMode === "cycles" ? cycles : views;
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
    ? filteredEntries.find((entry): entry is PlanningCycle => entry.id === selectedId) ?? filteredEntries[0] as PlanningCycle | undefined
    : undefined;
  const selectedView = planningMode === "views"
    ? filteredEntries.find((entry): entry is PlanningView => entry.id === selectedId) ?? filteredEntries[0] as PlanningView | undefined
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
      return (filteredEntries as PlanningCycle[]).map((entry) => ({
        key: entry.id,
        label: entry.label,
        detail: entry.windowLabel,
      }));
    }
    return (filteredEntries as PlanningView[]).map((entry) => ({
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
        : "Jump between pinned planning views derived from live operational work.",
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
  const cycleEntries = planningMode === "cycles" ? (filteredEntries as PlanningCycle[]) : [];
  const viewEntries = planningMode === "views" ? (filteredEntries as PlanningView[]) : [];

  return (
    <ShellPage className="gap-4">
      {error ? <InlineNotice tone="danger" detail={error} /> : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-quiet">{planningMode === "cycles" ? "Operational planning windows" : "Pinned work views"}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-ink">{planningMode === "cycles" ? "Cycles" : "Views"}</h1>
          <p className="mt-2 max-w-[64ch] text-sm leading-6 text-quiet">
            {planningMode === "cycles"
              ? "These windows keep execution, review pressure, and risk visible in one place while the native cycle model is still being introduced."
              : "These views pin the highest-signal work slices so the product behaves like a PM system first and a chat tool second."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <GhostButton onClick={() => router.push("/app/my-work")}>
            <Layers3 className="h-4 w-4" />
            Open my work
          </GhostButton>
          <ActionButton onClick={() => router.push(planningMode === "cycles" ? "/app/views" : "/app/cycles")}>
            {planningMode === "cycles" ? <Filter className="h-4 w-4" /> : <CalendarRange className="h-4 w-4" />}
            {planningMode === "cycles" ? "Open views" : "Open cycles"}
          </ActionButton>
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
                ? "Choose the lane you want to inspect without leaving the main shell."
                : "Use these slices to stay inside the PM surface instead of hunting through chat."}
            </p>
          </div>
          <ScrollPanel className="flex-1 px-4 py-3">
            <div className="space-y-2">
              {planningMode === "cycles"
                ? cycleEntries.map((entry) => (
                    <ListRow
                      key={entry.id}
                      eyebrow={entry.windowLabel}
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
                      eyebrow="Pinned view"
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
          <PlanningCycleDetail cycle={selectedCycle} onOpen={(href) => router.push(href)} />
        ) : null}
        {planningMode === "views" && selectedView ? (
          <PlanningViewDetail view={selectedView} onOpen={(href) => router.push(href)} />
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
    </ShellPage>
  );
}
