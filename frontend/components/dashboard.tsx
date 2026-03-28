"use client";

import { Bell, Home, Plus, Search, User2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { createOrbit, fetchDashboard, fetchOrbits, readSession } from "@/lib/api";
import type { DashboardPayload, Orbit } from "@/lib/types";
import { ActionButton, GhostButton, Panel, SectionTitle } from "@/components/ui";

type OrbitDraft = {
  name: string;
  description: string;
  logo: string;
  inviteEmails: string;
  private: boolean;
};

const EMPTY_ORBIT_DRAFT: OrbitDraft = {
  name: "",
  description: "",
  logo: "",
  inviteEmails: "",
  private: true,
};

export function DashboardScreen() {
  const [session, setSession] = useState(readSession());
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [orbits, setOrbits] = useState<Orbit[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState("");
  const [showCreateOrbit, setShowCreateOrbit] = useState(false);
  const [draft, setDraft] = useState<OrbitDraft>(EMPTY_ORBIT_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function reload() {
    const nextSession = readSession();
    setSession(nextSession);
    if (!nextSession) {
      window.location.href = "/";
      return;
    }
    const [nextDashboard, nextOrbits] = await Promise.all([
      fetchDashboard(nextSession.token),
      fetchOrbits(nextSession.token),
    ]);
    setPayload(nextDashboard);
    setOrbits(nextOrbits);
  }

  useEffect(() => {
    void reload();
  }, []);

  const filteredOrbits = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return orbits;
    }
    return orbits.filter((orbit) => {
      const haystack = `${orbit.name} ${orbit.description} ${orbit.repo_full_name ?? ""}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [orbits, search]);

  if (!session || !payload) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-quiet">Loading dashboard…</div>;
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
        logo: draft.logo.trim() || null,
        private: draft.private,
        invite_emails: draft.inviteEmails
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      })) as Orbit;
      setShowCreateOrbit(false);
      setDraft(EMPTY_ORBIT_DRAFT);
      window.location.href = `/app/orbits/${orbit.id}`;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to create the orbit.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-canvas">
      <aside className={`flex flex-col border-r border-line bg-panel px-4 py-5 transition-all ${collapsed ? "w-[96px]" : "w-[292px]"}`}>
        <button
          className="mb-6 flex w-full items-center gap-3 rounded-2xl border border-line px-3 py-3 text-left"
          onClick={() => setCollapsed((value) => !value)}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-ink bg-ink text-xs font-semibold text-white">AW</div>
          {!collapsed ? (
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-quiet">Home</p>
              <p className="text-sm font-medium">AutoWeave</p>
            </div>
          ) : null}
        </button>

        {!collapsed ? (
          <label className="mb-4 flex items-center gap-3 rounded-2xl border border-line bg-[#fbfbfa] px-3 py-3 text-sm text-quiet">
            <Search className="h-4 w-4" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search orbits"
              className="w-full border-0 bg-transparent outline-none"
            />
          </label>
        ) : null}

        <nav className="space-y-2">
          {[
            { icon: Home, label: "Home", href: "/app" },
            { icon: Plus, label: "Create orbit", href: "#create" },
            { icon: Search, label: "Search", href: "#search" },
          ].map(({ icon: Icon, label, href }) => (
            <button
              key={label}
              className="flex w-full items-center gap-3 rounded-2xl border border-transparent px-3 py-3 text-sm text-quiet transition hover:border-line hover:bg-[#fbfbfa] hover:text-ink"
              onClick={() => {
                if (href === "#create") {
                  setShowCreateOrbit(true);
                  return;
                }
                if (href === "#search") {
                  setCollapsed(false);
                  return;
                }
                window.location.href = href;
              }}
            >
              <Icon className="h-4 w-4" />
              {!collapsed ? <span>{label}</span> : null}
            </button>
          ))}
        </nav>

        <div className="mt-8">
          <p className={`px-3 text-[11px] uppercase tracking-[0.24em] text-quiet ${collapsed ? "sr-only" : ""}`}>Recent orbits</p>
          <div className="mt-3 space-y-2">
            {filteredOrbits.slice(0, 5).map((orbit) => (
              <Link
                key={orbit.id}
                href={`/app/orbits/${orbit.id}`}
                className="flex items-center gap-3 rounded-2xl border border-transparent px-3 py-3 transition hover:border-line hover:bg-white"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-line bg-[#f2f0ea] text-xs font-semibold">
                  {(orbit.logo || orbit.name).slice(0, 2).toUpperCase()}
                </div>
                {!collapsed ? (
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{orbit.name}</p>
                    <p className="truncate text-xs text-quiet">{orbit.repo_full_name || "Repository pending"}</p>
                  </div>
                ) : null}
              </Link>
            ))}
          </div>
        </div>

        <div className="mt-auto flex flex-col gap-2 pt-10">
          {[Bell, User2].map((Icon, index) => (
            <button key={index} className="flex items-center gap-3 rounded-2xl px-3 py-3 text-sm text-quiet hover:bg-[#fbfbfa] hover:text-ink">
              <Icon className="h-4 w-4" />
              {!collapsed ? <span>{index === 0 ? "Notifications" : session.user.display_name}</span> : null}
            </button>
          ))}
        </div>
      </aside>

      <main className="flex-1 px-6 py-8 lg:px-10">
        <div className="flex items-start justify-between gap-6">
          <SectionTitle
            eyebrow="Dashboard"
            title={`Hello, welcome, ${payload.me.display_name}`}
            detail="Priority keeps live work, approvals, and demos close. Codespaces surface the branch-oriented editor contexts you touched most recently."
          />
          <div className="flex gap-3">
            <GhostButton onClick={() => void reload()}>Refresh</GhostButton>
            <ActionButton onClick={() => setShowCreateOrbit(true)}>New orbit</ActionButton>
          </div>
        </div>

        <div className="mt-8 grid gap-6 xl:grid-cols-[1.35fr_0.95fr]">
          <Panel className="p-6">
            <SectionTitle eyebrow="Priority" title="What needs attention" detail="Work items, approvals, and live demos surface here first." />
            <div className="mt-5 grid gap-4">
              {payload.priority_items.length ? (
                payload.priority_items.map((item, index) => (
                  <div key={index} className="rounded-[22px] border border-line bg-[#fbfbfa] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-ink">{String(item.title ?? "Priority item")}</p>
                      <span className="rounded-full border border-line px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-quiet">
                        {String(item.status ?? "active")}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-quiet">
                      Agent: {String(item.agent ?? "ERGO")}
                      {item.branch_name ? ` · ${String(item.branch_name)}` : ""}
                    </p>
                    {item.draft_pr_url ? (
                      <a className="mt-3 inline-flex text-sm font-medium underline underline-offset-4" href={String(item.draft_pr_url)} target="_blank">
                        Open draft PR
                      </a>
                    ) : null}
                    {item.demo_url ? (
                      <a className="mt-3 inline-flex text-sm font-medium underline underline-offset-4" href={String(item.demo_url)} target="_blank">
                        Open live demo
                      </a>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="rounded-[22px] border border-dashed border-line bg-[#faf9f6] p-5 text-sm text-quiet">
                  No priority work yet. Create an orbit and ask ERGO to build something.
                </div>
              )}
            </div>
          </Panel>

          <div className="grid gap-6">
            <Panel className="p-6">
              <SectionTitle eyebrow="Codespaces" title="Recent workspace contexts" detail="Each codespace maps to a branch-oriented local editor container." />
              <div className="mt-5 space-y-3">
                {payload.codespaces.length ? (
                  payload.codespaces.map((item) => (
                    <div key={item.id} className="rounded-[22px] border border-line bg-[#fbfbfa] p-4">
                      <p className="text-sm font-semibold">{item.name}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.24em] text-quiet">{item.branch_name}</p>
                      <div className="mt-3 flex items-center justify-between text-sm">
                        <span className="text-quiet">{item.status}</span>
                        {item.editor_url ? (
                          <a className="font-medium text-ink underline underline-offset-4" href={item.editor_url} target="_blank">
                            Open
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[22px] border border-dashed border-line bg-[#faf9f6] p-5 text-sm text-quiet">
                    No codespaces created yet.
                  </div>
                )}
              </div>
            </Panel>

            <Panel className="p-6">
              <SectionTitle eyebrow="Signals" title="Recent notifications" detail="Navigation memory and demo signals kept in the product layer." />
              <div className="mt-5 space-y-3">
                {payload.notifications.length ? (
                  payload.notifications.map((note, index) => (
                    <div key={`${note.kind}-${index}`} className="rounded-[22px] border border-line bg-[#fbfbfa] p-4 text-sm text-quiet">
                      {note.label}
                    </div>
                  ))
                ) : (
                  <div className="rounded-[22px] border border-dashed border-line bg-[#faf9f6] p-5 text-sm text-quiet">
                    No notifications yet.
                  </div>
                )}
              </div>
            </Panel>
          </div>
        </div>
      </main>

      {showCreateOrbit ? (
        <div className="fixed inset-0 z-40 flex bg-black/30 backdrop-blur-[1px]">
          <div className="ml-auto flex h-full w-full max-w-xl flex-col border-l border-line bg-panel px-6 py-6 shadow-panel">
            <div className="flex items-start justify-between gap-4">
              <SectionTitle
                eyebrow="New orbit"
                title="Create a GitHub-backed orbit"
                detail="Version one creates a new repository, initializes the orbit, and lets you invite teammates immediately."
              />
              <button className="rounded-full border border-line p-2 text-quiet" onClick={() => setShowCreateOrbit(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-6 grid gap-4">
              <label className="grid gap-2">
                <span className="text-[11px] uppercase tracking-[0.24em] text-quiet">Name</span>
                <input
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  className="rounded-2xl border border-line bg-[#fbfbfa] px-4 py-3 text-sm outline-none"
                  placeholder="Autoweave Ops"
                />
              </label>

              <label className="grid gap-2">
                <span className="text-[11px] uppercase tracking-[0.24em] text-quiet">Description</span>
                <textarea
                  value={draft.description}
                  onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                  className="min-h-24 rounded-2xl border border-line bg-[#fbfbfa] px-4 py-3 text-sm outline-none"
                  placeholder="Build the product control plane and developer workflow."
                />
              </label>

              <label className="grid gap-2">
                <span className="text-[11px] uppercase tracking-[0.24em] text-quiet">Logo text</span>
                <input
                  value={draft.logo}
                  onChange={(event) => setDraft((current) => ({ ...current, logo: event.target.value }))}
                  className="rounded-2xl border border-line bg-[#fbfbfa] px-4 py-3 text-sm outline-none"
                  placeholder="AW"
                />
              </label>

              <label className="grid gap-2">
                <span className="text-[11px] uppercase tracking-[0.24em] text-quiet">Invite emails</span>
                <input
                  value={draft.inviteEmails}
                  onChange={(event) => setDraft((current) => ({ ...current, inviteEmails: event.target.value }))}
                  className="rounded-2xl border border-line bg-[#fbfbfa] px-4 py-3 text-sm outline-none"
                  placeholder="teammate@example.com, reviewer@example.com"
                />
              </label>

              <label className="flex items-center gap-3 rounded-2xl border border-line bg-[#fbfbfa] px-4 py-4 text-sm">
                <input
                  checked={draft.private}
                  onChange={(event) => setDraft((current) => ({ ...current, private: event.target.checked }))}
                  type="checkbox"
                />
                Create the orbit repository as private
              </label>

              {error ? <div className="rounded-2xl border border-line bg-[#f6f4ef] px-4 py-3 text-sm text-ink">{error}</div> : null}
            </div>

            <div className="mt-auto flex justify-end gap-3 pt-6">
              <GhostButton onClick={() => setShowCreateOrbit(false)}>Cancel</GhostButton>
              <ActionButton onClick={onCreateOrbit} disabled={saving || !draft.name.trim()}>
                {saving ? "Creating…" : "Create orbit"}
              </ActionButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
