import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AuthenticatedAppShell } from "@/components/authenticated-shell";
import { PlanningScreen } from "@/components/planning-screen";
import { ThemeProvider } from "@/components/theme-provider";

const api = vi.hoisted(() => ({
  createOrbitCycle: vi.fn(),
  createSavedView: vi.fn(),
  deleteOrbitCycle: vi.fn(),
  deleteSavedView: vi.fn(),
  fetchPlanningCycles: vi.fn(),
  fetchMyWork: vi.fn(),
  fetchPreferences: vi.fn(),
  fetchSavedViews: vi.fn(),
  readSession: vi.fn(),
  updateOrbitCycle: vi.fn(),
  updateSavedView: vi.fn(),
  updatePreferences: vi.fn(),
  writeSession: vi.fn(),
}));
const mockRouter = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
}));

let mockPathname = "/app/cycles";

vi.mock("@/lib/api", () => api);
vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  usePathname: () => mockPathname,
}));

function myWorkPayload() {
  return {
    me: {
      id: "user_1",
      github_login: "octocat",
      display_name: "Octo Cat",
    },
    summary: {
      active_work_items: 2,
      active_issues: 2,
      blocked_issues: 1,
      review_queue: 1,
      approvals: 1,
      running_codespaces: 1,
      recent_orbits: 1,
    },
    work_items: [
      {
        id: "work_1",
        title: "Prepare release automation",
        status: "in_process",
        agent: "ERGO",
        branch_name: "feat/release-cut",
        summary: "ERGO is preparing the release automation pass.",
        updated_at: new Date().toISOString(),
      },
      {
        id: "work_2",
        title: "Resolve flaky staging deploy",
        status: "blocked",
        agent: "ERGO",
        summary: "Staging deploy is blocked on a failing migration check.",
        updated_at: new Date().toISOString(),
      },
    ],
    active_issues: [
      {
        id: "issue_1",
        number: 18,
        title: "Ship the release cut",
        state: "open",
        operational_status: "in_progress",
        url: "https://example.com/issues/18",
        repository_full_name: "octocat/orbit-one",
      },
    ],
    blocked_issues: [
      {
        id: "issue_2",
        number: 22,
        title: "Fix staging schema drift",
        state: "open",
        operational_status: "blocked",
        url: "https://example.com/issues/22",
        repository_full_name: "octocat/orbit-one",
      },
    ],
    review_queue: [
      {
        id: "pr_1",
        number: 12,
        title: "Review release branch promotion",
        state: "open",
        operational_status: "awaiting_review",
        url: "https://example.com/prs/12",
        repository_full_name: "octocat/orbit-one",
      },
    ],
    approvals: [
      {
        id: "notif_1",
        kind: "approval",
        title: "Approval requested for release promotion",
        detail: "A human approval is still required before merge.",
        status: "unread",
        source_kind: "workflow",
        source_id: "run_1",
        created_at: new Date().toISOString(),
        metadata: {},
      },
    ],
    recent_orbits: [
      {
        id: "orbit_1",
        slug: "orbit-one",
        name: "Orbit One",
        description: "Primary delivery orbit",
        repo_full_name: "octocat/orbit-one",
        repo_private: true,
        default_branch: "main",
      },
    ],
    codespaces: [
      {
        id: "cs_1",
        name: "orbit-one-release",
        branch_name: "feat/release-cut",
        workspace_path: "/workspace/orbit-one",
        status: "running",
        repository_full_name: "octocat/orbit-one",
      },
    ],
    notifications: [
      {
        id: "notif_2",
        kind: "run_failed",
        title: "Staging rollout failed",
        detail: "The rollout failed during verification.",
        status: "unread",
        source_kind: "workflow",
        source_id: "run_2",
        created_at: new Date().toISOString(),
        metadata: {},
      },
    ],
  };
}

function renderPlanning(mode: "cycles" | "views") {
  mockPathname = mode === "cycles" ? "/app/cycles" : "/app/views";
  return render(
    <ThemeProvider>
      <AuthenticatedAppShell>
        <PlanningScreen mode={mode} />
      </AuthenticatedAppShell>
    </ThemeProvider>,
  );
}

function savedViewsPayload() {
  return {
    views: [
      {
        id: "system-assigned-to-me",
        label: "Assigned to me",
        detail: "Everything currently owned by you across orbit-native issue work.",
        tone: "accent",
        count: 2,
        kind: "system",
        filter_summary: ["All orbits", "Assigned to me", "Open work"],
        filters: {
          orbit_id: null,
          statuses: [],
          priorities: [],
          labels: [],
          assignee_scope: "me",
          cycle_scope: "any",
          stale_only: false,
          relation_scope: "any",
          hierarchy_scope: "any",
        },
        pinned: false,
        pin_rank: 0,
        preview: [
          {
            id: "native-pm_1",
            kind: "native_issue",
            eyebrow: "Orbit One",
            title: "PM-1 · Ship the release cut",
            detail: "April stabilization · Priority high",
            supporting: "octocat/orbit-one",
            status: "In progress",
            tone: "accent",
            href: "/app/orbits/orbit_1",
            timestamp: new Date().toISOString(),
          },
        ],
      },
      {
        id: "system-needs-review",
        label: "Needs review",
        detail: "Native issues currently waiting on review or merge readiness.",
        tone: "warning",
        count: 1,
        kind: "system",
        filter_summary: ["All orbits", "All assignees", "In review", "Ready to merge"],
        filters: {
          orbit_id: null,
          statuses: ["in_review", "ready_to_merge"],
          priorities: [],
          labels: [],
          assignee_scope: "all",
          cycle_scope: "any",
          stale_only: false,
          relation_scope: "any",
          hierarchy_scope: "any",
        },
        pinned: false,
        pin_rank: 0,
        preview: [
          {
            id: "native-pm_2",
            kind: "native_issue",
            eyebrow: "Orbit One",
            title: "PM-2 · Review release branch promotion",
            detail: "April stabilization · Priority medium",
            supporting: "octocat/orbit-one",
            status: "Ready to merge",
            tone: "warning",
            href: "/app/orbits/orbit_1",
            timestamp: new Date().toISOString(),
          },
        ],
      },
    ],
  };
}

function planningCyclesPayload() {
  return {
    cycles: [
      {
        id: "cycle_1",
        orbit_id: "orbit_1",
        orbit_name: "Orbit One",
        label: "April stabilization",
        detail: "Land the PM shell cleanup.",
        window_label: "Apr 14 - Apr 25",
        tone: "warning",
        status: "active",
        goal: "Land the PM shell cleanup.",
        starts_at: "2026-04-14T00:00:00Z",
        ends_at: "2026-04-25T00:00:00Z",
        metrics: {
          count: 3,
          review: 1,
          blocked: 1,
          stale: 0,
          completed: 0,
        },
        highlights: [
          {
            id: "native-pm_1",
            kind: "native_issue",
            eyebrow: "Orbit One",
            title: "PM-1 · Ship the release cut",
            detail: "April stabilization · Priority high",
            supporting: "octocat/orbit-one",
            status: "In progress",
            tone: "accent",
            href: "/app/orbits/orbit_1?section=issues&detailKind=native_issue&detailId=pm_1",
            timestamp: new Date().toISOString(),
          },
        ],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: "cycle_2",
        orbit_id: "orbit_1",
        orbit_name: "Orbit One",
        label: "Release hardening",
        detail: "Prepare the release review train.",
        window_label: "planned",
        tone: "accent",
        status: "planned",
        goal: "Prepare the release review train.",
        starts_at: null,
        ends_at: null,
        metrics: {
          count: 1,
          review: 0,
          blocked: 0,
          stale: 0,
          completed: 0,
        },
        highlights: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  };
}

describe("PlanningScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.readSession.mockReturnValue({
      token: "session-token",
      user: {
        id: "user_1",
        github_login: "octocat",
        display_name: "Octo Cat",
      },
    });
    api.fetchPreferences.mockResolvedValue({ theme_preference: "system" });
    api.fetchMyWork.mockResolvedValue(myWorkPayload());
    api.fetchSavedViews.mockResolvedValue(savedViewsPayload());
    api.fetchPlanningCycles.mockResolvedValue(planningCyclesPayload());
    api.createOrbitCycle.mockResolvedValue({});
    api.createSavedView.mockResolvedValue(savedViewsPayload());
    api.deleteOrbitCycle.mockResolvedValue({ ok: true, id: "cycle_1" });
    api.deleteSavedView.mockResolvedValue(savedViewsPayload());
    api.updateOrbitCycle.mockResolvedValue({});
    api.updateSavedView.mockResolvedValue(savedViewsPayload());
    vi.stubGlobal("confirm", vi.fn(() => true));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the cycles surface with real workspace cycles", async () => {
    renderPlanning("cycles");

    expect(await screen.findByRole("heading", { name: "Cycles" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open views/i })).toBeInTheDocument();
    expect(screen.getAllByText("April stabilization").length).toBeGreaterThan(0);
    expect(screen.getAllByText("PM-1 · Ship the release cut").length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button", { name: /Release hardening/i })[0]);

    expect((await screen.findAllByText("Prepare the release review train.")).length).toBeGreaterThan(0);
  });

  it("renders the views surface and switches into the review queue", async () => {
    renderPlanning("views");

    expect(await screen.findByRole("heading", { name: "Views" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open cycles/i })).toBeInTheDocument();
    expect(screen.getAllByText("Assigned to me").length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button", { name: /Needs review/i })[0]);

    expect(await screen.findByText("PM-2 · Review release branch promotion")).toBeInTheDocument();
    expect(screen.getAllByText("Ready to merge").length).toBeGreaterThan(0);
  });

  it("creates a custom saved view from the views surface", async () => {
    api.createSavedView.mockResolvedValue({
      views: [
        ...savedViewsPayload().views,
        {
          id: "view_1",
          label: "High priority cycle work",
          detail: "Keep urgent issues with explicit cycle ownership visible across active orbits.",
          tone: "accent",
          count: 1,
          kind: "custom",
          filter_summary: ["Orbit One", "Assigned to me", "In progress", "Priority high", "In a cycle"],
          filters: {
            orbit_id: "orbit_1",
            statuses: ["in_progress"],
            priorities: ["high"],
            labels: [],
            assignee_scope: "me",
            cycle_scope: "with_cycle",
            stale_only: false,
            relation_scope: "any",
            hierarchy_scope: "any",
          },
          pinned: false,
          pin_rank: 0,
          preview: [
            {
              id: "native-pm_1",
              kind: "native_issue",
              eyebrow: "Orbit One",
              title: "PM-1 · Ship the release cut",
              detail: "April stabilization · Priority high",
              supporting: "octocat/orbit-one",
              status: "In progress",
              tone: "accent",
              href: "/app/orbits/orbit_1",
              timestamp: new Date().toISOString(),
            },
          ],
        },
      ],
    });

    renderPlanning("views");

    expect(await screen.findByRole("heading", { name: "Views" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /New view/i }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "High priority cycle work" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), {
      target: { value: "Keep urgent issues with explicit cycle ownership visible across active orbits." },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Orbit One" }).at(-1)!);
    fireEvent.click(screen.getByRole("button", { name: "In progress" }));
    fireEvent.click(screen.getByRole("button", { name: "high" }));
    fireEvent.click(screen.getByRole("button", { name: "Assigned to me" }));
    fireEvent.click(screen.getByRole("button", { name: "In a cycle" }));
    fireEvent.click(screen.getByRole("button", { name: /^Create view$/i }));

    expect(api.createSavedView).toHaveBeenCalledWith("session-token", {
      name: "High priority cycle work",
      description: "Keep urgent issues with explicit cycle ownership visible across active orbits.",
      orbit_id: "orbit_1",
      statuses: ["in_progress"],
      priorities: ["high"],
      labels: [],
      assignee_scope: "me",
      cycle_scope: "with_cycle",
      stale_only: false,
      relation_scope: "any",
      hierarchy_scope: "any",
    });
    expect(await screen.findAllByText("High priority cycle work")).not.toHaveLength(0);
  });

  it("pins and deletes a custom saved view", async () => {
    api.fetchSavedViews.mockResolvedValue({
      views: [
        ...savedViewsPayload().views,
        {
          id: "view_1",
          label: "Risk watch",
          detail: "Track blocked work.",
          tone: "danger",
          count: 1,
          kind: "custom",
          filter_summary: ["Orbit One", "All assignees", "Open work", "Dependency risk"],
          filters: {
            orbit_id: "orbit_1",
            statuses: [],
            priorities: [],
            labels: [],
            assignee_scope: "all",
            cycle_scope: "any",
            stale_only: false,
            relation_scope: "blocked",
            hierarchy_scope: "any",
          },
          pinned: false,
          pin_rank: 0,
          preview: [],
        },
      ],
    });
    api.updateSavedView.mockResolvedValue({
      views: [
        ...savedViewsPayload().views,
        {
          id: "view_1",
          label: "Risk watch",
          detail: "Track blocked work.",
          tone: "danger",
          count: 1,
          kind: "custom",
          filter_summary: ["Orbit One", "All assignees", "Open work", "Dependency risk"],
          filters: {
            orbit_id: "orbit_1",
            statuses: [],
            priorities: [],
            labels: [],
            assignee_scope: "all",
            cycle_scope: "any",
            stale_only: false,
            relation_scope: "blocked",
            hierarchy_scope: "any",
          },
          pinned: true,
          pin_rank: 1,
          preview: [],
        },
      ],
    });
    api.deleteSavedView.mockResolvedValue(savedViewsPayload());

    renderPlanning("views");

    expect(await screen.findByRole("heading", { name: "Views" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /Risk watch/i })[0]);
    fireEvent.click(screen.getByRole("button", { name: /Pin/i }));
    await waitFor(() => expect(api.updateSavedView).toHaveBeenCalledWith("session-token", "view_1", { pinned: true }));

    fireEvent.click(screen.getByRole("button", { name: /Delete/i }));
    await waitFor(() => expect(api.deleteSavedView).toHaveBeenCalledWith("session-token", "view_1"));
  });

  it("creates and updates a real cycle from the planning surface", async () => {
    renderPlanning("cycles");

    expect(await screen.findByRole("heading", { name: "Cycles" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /New cycle/i }));
    fireEvent.change(screen.getByRole("combobox", { name: "Orbit" }), { target: { value: "orbit_1" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Release hardening" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Goal" }), { target: { value: "Prepare the release review train." } });
    fireEvent.click(screen.getByRole("button", { name: /^Create cycle$/i }));

    await waitFor(() =>
      expect(api.createOrbitCycle).toHaveBeenCalledWith("session-token", "orbit_1", {
        name: "Release hardening",
        goal: "Prepare the release review train.",
        status: "active",
        starts_at: null,
        ends_at: null,
      }),
    );

    fireEvent.click(screen.getAllByRole("button", { name: /April stabilization/i })[0]);
    fireEvent.click(screen.getByRole("button", { name: /Edit cycle/i }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "April release control" } });
    fireEvent.click(screen.getByRole("button", { name: /Save cycle/i }));

    await waitFor(() =>
      expect(api.updateOrbitCycle).toHaveBeenCalledWith("session-token", "orbit_1", "cycle_1", {
        name: "April release control",
        goal: "Land the PM shell cleanup.",
        status: "active",
        starts_at: "2026-04-14T00:00:00.000Z",
        ends_at: "2026-04-25T00:00:00.000Z",
      }),
    );
  });
});
