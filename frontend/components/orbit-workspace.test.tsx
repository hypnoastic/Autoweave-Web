import { render, screen } from "@testing-library/react";

import { OrbitWorkspace } from "@/components/orbit-workspace";

const api = vi.hoisted(() => ({
  answerWorkflowHumanRequest: vi.fn(),
  createCodespace: vi.fn(),
  fetchDmThread: vi.fn(),
  fetchOrbit: vi.fn(),
  inviteOrbitMember: vi.fn(),
  publishDemo: vi.fn(),
  readSession: vi.fn(),
  refreshPrsIssues: vi.fn(),
  resolveWorkflowApprovalRequest: vi.fn(),
  sendDmMessage: vi.fn(),
  sendOrbitMessage: vi.fn(),
  updateNavigation: vi.fn(),
}));

vi.mock("@/lib/api", () => api);

describe("OrbitWorkspace", () => {
  it("renders workflow clarifications from the runtime snapshot", async () => {
    api.readSession.mockReturnValue({
      token: "session-token",
      user: {
        id: "user_1",
        github_login: "octocat",
        display_name: "Octo Cat",
      },
    });
    api.fetchOrbit.mockResolvedValue({
      orbit: {
        id: "orbit_1",
        slug: "orbit-1",
        name: "Orbit One",
        description: "Test orbit",
        repo_full_name: "octocat/orbit-one",
        repo_private: true,
        default_branch: "main",
      },
      members: [{ user_id: "user_1", role: "owner" }],
      channels: [{ id: "channel_1", slug: "general", name: "general" }],
      direct_messages: [{ id: "dm_1", title: "ERGO" }],
      messages: [],
      workflow: {
        status: "ok",
        selected_run_id: "run_1",
        runs: [
          {
            id: "run_1",
            title: "Build the review workflow",
            status: "running",
            operator_status: "waiting_for_human",
            operator_summary: "ERGO needs a clarification",
            execution_status: "active",
            execution_summary: "manager_plan is waiting",
            tasks: [
              {
                id: "task_1",
                task_key: "manager_plan",
                title: "Manager plan",
                assigned_role: "manager",
                state: "waiting_for_human",
                description: "Clarify what should ship first",
              },
            ],
            events: [],
            human_requests: [
              {
                id: "human_1",
                task_id: "task_1",
                task_key: "manager_plan",
                status: "open",
                question: "What exact flow should ERGO ship first?",
              },
            ],
            approval_requests: [],
          },
        ],
        selected_run: {
          id: "run_1",
          title: "Build the review workflow",
          status: "running",
          operator_status: "waiting_for_human",
          operator_summary: "ERGO needs a clarification",
          execution_status: "active",
          execution_summary: "manager_plan is waiting",
          tasks: [
            {
              id: "task_1",
              task_key: "manager_plan",
              title: "Manager plan",
              assigned_role: "manager",
              state: "waiting_for_human",
              description: "Clarify what should ship first",
            },
          ],
          events: [],
          human_requests: [
            {
              id: "human_1",
              task_id: "task_1",
              task_key: "manager_plan",
              status: "open",
              question: "What exact flow should ERGO ship first?",
            },
          ],
          approval_requests: [],
        },
      },
      prs: [],
      issues: [],
      codespaces: [],
      demos: [],
      navigation: { orbit_id: "orbit_1", section: "workflow" },
    });
    api.fetchDmThread.mockResolvedValue({
      thread: { id: "dm_1", title: "ERGO" },
      messages: [],
    });
    api.updateNavigation.mockResolvedValue({});

    render(<OrbitWorkspace orbitId="orbit_1" />);

    expect(await screen.findByText("Kanban execution board")).toBeInTheDocument();
    expect(screen.getByText("Clarification needed")).toBeInTheDocument();
    expect(screen.getByText("What exact flow should ERGO ship first?")).toBeInTheDocument();
  });
});
