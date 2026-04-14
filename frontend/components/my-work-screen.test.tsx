import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AuthenticatedAppShell } from "@/components/authenticated-shell";
import { MyWorkScreen } from "@/components/my-work-screen";
import { ThemeProvider } from "@/components/theme-provider";

const api = vi.hoisted(() => ({
  fetchMyWork: vi.fn(),
  fetchOrbit: vi.fn(),
  fetchPreferences: vi.fn(),
  readSession: vi.fn(),
  updateOrbitIssue: vi.fn(),
  updatePreferences: vi.fn(),
  writeSession: vi.fn(),
}));

const mockRouter = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
}));

let mockPathname = "/app/my-work";

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
      active_work_items: 1,
      active_issues: 1,
      blocked_issues: 0,
      stale_issues: 0,
      review_queue: 1,
      approvals: 0,
      running_codespaces: 0,
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
    ],
    active_issues: [
      {
        id: "issue_1",
        number: 18,
        title: "Ship the release cut",
        state: "open",
        operational_status: "in_progress",
        url: "https://example.com/issues/18",
        source_kind: "native_issue",
        orbit_id: "orbit_1",
        cycle_id: "cycle_1",
        cycle_name: "April stabilization",
        assignee_user_id: "user_1",
        assignee_display_name: "Octo Cat",
        repository_full_name: "octocat/orbit-one",
        labels: [],
        stale: false,
        stale_working_days: 0,
        blocked_by_count: 0,
        sub_issue_count: 0,
      },
    ],
    blocked_issues: [],
    stale_issues: [],
    review_queue: [
      {
        id: "pr_1",
        number: 12,
        title: "Review release branch promotion",
        state: "open",
        operational_status: "awaiting_review",
        url: "https://example.com/prs/12",
        source_kind: "pr",
        orbit_id: "orbit_1",
        repository_full_name: "octocat/orbit-one",
      },
    ],
    native_issues: [
      {
        id: "issue_1",
        number: 18,
        title: "Ship the release cut",
        detail: "Coordinate release promotion with ERGO and review owners.",
        status: "in_progress",
        priority: "high",
        source_kind: "manual",
        cycle_id: "cycle_1",
        cycle_name: "April stabilization",
        assignee_user_id: "user_1",
        assignee_display_name: "Octo Cat",
        orbit_id: "orbit_1",
        orbit_name: "Orbit One",
        repository_full_name: "octocat/orbit-one",
        labels: [],
        parent_issue_id: null,
        parent_issue: null,
        sub_issues: [],
        relations: { blocked_by: [], blocking: [], related: [], duplicate: [] },
        relation_counts: { blocked_by: 0, blocking: 0, related: 0, duplicate: 0 },
        is_blocked: false,
        has_sub_issues: false,
        stale: false,
        stale_working_days: 0,
        activity: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    issue_labels: [],
    approvals: [],
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
    codespaces: [],
    notifications: [],
  };
}

function orbitPayload() {
  return {
    orbit: {
      id: "orbit_1",
      slug: "orbit-one",
      name: "Orbit One",
      description: "Primary delivery orbit",
      repo_full_name: "octocat/orbit-one",
      repo_private: true,
      default_branch: "main",
    },
    repositories: [],
    members: [
      {
        user_id: "user_1",
        github_login: "octocat",
        display_name: "Octo Cat",
        role: "owner",
        introduced: true,
      },
      {
        user_id: "user_2",
        github_login: "taylor",
        display_name: "Taylor Ops",
        role: "member",
        introduced: true,
      },
    ],
    channels: [],
    direct_messages: [],
    messages: [],
    human_loop_items: [],
    notifications: [],
    workflow: {
      run: null,
      tasks: [],
      human_requests: [],
      approval_requests: [],
      events: [],
    },
    prs: [],
    issues: [],
    native_issues: [],
    issue_labels: [],
    cycles: [
      {
        id: "cycle_1",
        name: "April stabilization",
        goal: "Keep the current release line stable.",
        status: "active",
        starts_at: null,
        ends_at: null,
        issue_count: 1,
        completed_count: 0,
        active_count: 1,
        review_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: "cycle_2",
        name: "May launch",
        goal: "Prepare the launch window.",
        status: "planned",
        starts_at: null,
        ends_at: null,
        issue_count: 0,
        completed_count: 0,
        active_count: 0,
        review_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    codespaces: [],
    demos: [],
    artifacts: [],
  };
}

function renderMyWork() {
  mockPathname = "/app/my-work";
  return render(
    <ThemeProvider>
      <AuthenticatedAppShell>
        <MyWorkScreen />
      </AuthenticatedAppShell>
    </ThemeProvider>,
  );
}

describe("MyWorkScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname = "/app/my-work";
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
    api.fetchOrbit.mockResolvedValue(orbitPayload());
    api.updateOrbitIssue.mockResolvedValue({});
  });

  it("updates the cycle directly from the my-work queue", async () => {
    renderMyWork();

    expect(await screen.findByText("Ship the release cut")).toBeInTheDocument();
    await screen.findByRole("option", { name: "May launch" });

    fireEvent.change(screen.getByLabelText("Issue cycle"), { target: { value: "cycle_2" } });

    await waitFor(() =>
      expect(api.updateOrbitIssue).toHaveBeenCalledWith("session-token", "orbit_1", "issue_1", {
        cycle_id: "cycle_2",
      }),
    );
  });

  it("updates the owner directly from the my-work queue", async () => {
    renderMyWork();

    expect(await screen.findByText("Ship the release cut")).toBeInTheDocument();
    await screen.findByRole("option", { name: "Taylor Ops" });

    fireEvent.change(screen.getByLabelText("Issue owner"), { target: { value: "user_2" } });

    await waitFor(() =>
      expect(api.updateOrbitIssue).toHaveBeenCalledWith("session-token", "orbit_1", "issue_1", {
        assignee_user_id: "user_2",
      }),
    );
  });
});
