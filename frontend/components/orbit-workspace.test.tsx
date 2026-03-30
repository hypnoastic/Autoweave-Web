import { fireEvent, render, screen } from "@testing-library/react";

import { OrbitWorkspace } from "@/components/orbit-workspace";
import { ThemeProvider } from "@/components/theme-provider";

const api = vi.hoisted(() => ({
  answerWorkflowHumanRequest: vi.fn(),
  createChannel: vi.fn(),
  createCodespace: vi.fn(),
  createDmThread: vi.fn(),
  fetchChannelMessages: vi.fn(),
  fetchDmThread: vi.fn(),
  fetchOrbit: vi.fn(),
  fetchPreferences: vi.fn(),
  inviteOrbitMember: vi.fn(),
  publishDemo: vi.fn(),
  readSession: vi.fn(),
  refreshPrsIssues: vi.fn(),
  resolveWorkflowApprovalRequest: vi.fn(),
  sendChannelMessage: vi.fn(),
  sendDmMessage: vi.fn(),
  updatePreferences: vi.fn(),
  updateNavigation: vi.fn(),
  writeSession: vi.fn(),
}));

vi.mock("@/lib/api", () => api);
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

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
    api.fetchPreferences.mockResolvedValue({ theme_preference: "system" });
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
      members: [{ id: "user_1", user_id: "user_1", role: "owner", display_name: "Octo Cat", login: "octocat" }],
      channels: [{ id: "channel_1", slug: "general", name: "general" }],
      direct_messages: [{ id: "dm_1", title: "ERGO", kind: "agent", participant: { login: "ERGO", display_name: "ERGO" } }],
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
    api.fetchChannelMessages.mockResolvedValue({
      channel: { id: "channel_1", slug: "general", name: "general" },
      messages: [],
    });
    api.fetchDmThread.mockResolvedValue({
      thread: { id: "dm_1", title: "ERGO" },
      messages: [],
    });
    api.updateNavigation.mockResolvedValue({});

    render(
      <ThemeProvider>
        <OrbitWorkspace orbitId="orbit_1" />
      </ThemeProvider>,
    );

    expect(await screen.findByText("Execution board")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /manager plan/i })[0]);
    expect((await screen.findAllByText("What exact flow should ERGO ship first?")).length).toBeGreaterThan(0);
  });
});
