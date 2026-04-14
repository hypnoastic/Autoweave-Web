import { fireEvent, render, screen } from "@testing-library/react";

import { AuthenticatedAppShell } from "@/components/authenticated-shell";
import { PlanningScreen } from "@/components/planning-screen";
import { ThemeProvider } from "@/components/theme-provider";

const api = vi.hoisted(() => ({
  fetchMyWork: vi.fn(),
  fetchPreferences: vi.fn(),
  readSession: vi.fn(),
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
  });

  it("renders the cycles surface with execution and risk windows", async () => {
    renderPlanning("cycles");

    expect(await screen.findByRole("heading", { name: "Cycles" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Views" })).toBeInTheDocument();
    expect(screen.getAllByText("Execution window").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ship the release cut").length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button", { name: /Risk window/i })[0]);

    expect(await screen.findByText("Fix staging schema drift")).toBeInTheDocument();
  });

  it("renders the views surface and switches into the review queue", async () => {
    renderPlanning("views");

    expect(await screen.findByRole("heading", { name: "Views" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cycles" })).toBeInTheDocument();
    expect(screen.getAllByText("Assigned to me").length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button", { name: /Needs review/i })[0]);

    expect(await screen.findByText("Approval requested for release promotion")).toBeInTheDocument();
    expect(screen.getAllByText("Review release branch promotion").length).toBeGreaterThan(0);
  });
});
