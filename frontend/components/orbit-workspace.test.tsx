import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { OrbitWorkspace } from "@/components/orbit-workspace";
import { ThemeProvider } from "@/components/theme-provider";

const api = vi.hoisted(() => ({
  answerWorkflowHumanRequest: vi.fn(),
  connectOrbitRepository: vi.fn(),
  createChannel: vi.fn(),
  createCodespace: vi.fn(),
  createDmThread: vi.fn(),
  fetchAvailableRepositories: vi.fn(),
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
  setPrimaryOrbitRepository: vi.fn(),
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
      repositories: [
        {
          id: "repo_1",
          provider: "github",
          full_name: "octocat/orbit-one",
          owner_name: "octocat",
          repo_name: "orbit-one",
          is_private: true,
          default_branch: "main",
          status: "active",
        },
      ],
      members: [{ id: "user_1", user_id: "user_1", role: "owner", display_name: "Octo Cat", login: "octocat" }],
      channels: [{ id: "channel_1", slug: "general", name: "general" }],
      direct_messages: [{ id: "dm_1", title: "ERGO", kind: "agent", participant: { login: "ERGO", display_name: "ERGO" } }],
      messages: [],
      human_loop_items: [],
      notifications: [],
      permissions: {
        orbit_role: "owner",
        repo_grants: { repo_1: "admin" },
        can_manage_members: true,
        can_manage_settings: true,
        can_manage_integrations: true,
        can_bind_repo: true,
        can_publish_artifact: true,
      },
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
      human_loop_items: [],
    });
    api.fetchDmThread.mockResolvedValue({
      thread: { id: "dm_1", title: "ERGO" },
      messages: [],
      human_loop_items: [],
    });
    api.updateNavigation.mockResolvedValue({});

    render(
      <ThemeProvider>
        <OrbitWorkspace orbitId="orbit_1" />
      </ThemeProvider>,
    );

    expect(await screen.findByText("Execution board")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /manager plan/i })[0]);
    });
    expect((await screen.findAllByText("What exact flow should ERGO ship first?")).length).toBeGreaterThan(0);
  });

  it("renders inline approval cards in chat and resolves them through the API", async () => {
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
      repositories: [
        {
          id: "repo_1",
          provider: "github",
          full_name: "octocat/orbit-one",
          owner_name: "octocat",
          repo_name: "orbit-one",
          is_private: true,
          default_branch: "main",
          status: "active",
        },
      ],
      members: [{ id: "user_1", user_id: "user_1", role: "owner", display_name: "Octo Cat", login: "octocat" }],
      channels: [{ id: "channel_1", slug: "general", name: "general" }],
      direct_messages: [{ id: "dm_1", title: "ERGO", kind: "agent", participant: { login: "ERGO", display_name: "ERGO" } }],
      messages: [],
      human_loop_items: [],
      notifications: [],
      permissions: {
        orbit_role: "owner",
        repo_grants: { repo_1: "admin" },
        can_manage_members: true,
        can_manage_settings: true,
        can_manage_integrations: true,
        can_bind_repo: true,
        can_publish_artifact: true,
      },
      workflow: {
        status: "ok",
        selected_run_id: "run_1",
        runs: [
          {
            id: "run_1",
            title: "Build the review workflow",
            status: "running",
            operator_status: "waiting_for_approval",
            operator_summary: "ERGO needs approval",
            execution_status: "waiting_for_approval",
            execution_summary: "Waiting for release signoff",
            source_channel_id: "channel_1",
            repository_ids: ["repo_1"],
            tasks: [],
            events: [],
            human_requests: [],
            approval_requests: [{ id: "approval_1", task_id: "task_1", task_key: "manager_plan", status: "requested", reason: "Release signoff" }],
          },
        ],
        selected_run: {
          id: "run_1",
          title: "Build the review workflow",
          status: "running",
          operator_status: "waiting_for_approval",
          operator_summary: "ERGO needs approval",
          execution_status: "waiting_for_approval",
          execution_summary: "Waiting for release signoff",
          source_channel_id: "channel_1",
          repository_ids: ["repo_1"],
          tasks: [],
          events: [],
          human_requests: [],
          approval_requests: [{ id: "approval_1", task_id: "task_1", task_key: "manager_plan", status: "requested", reason: "Release signoff" }],
        },
      },
      prs: [],
      issues: [],
      codespaces: [],
      demos: [],
      navigation: { orbit_id: "orbit_1", section: "chat" },
    });
    api.fetchChannelMessages.mockResolvedValue({
      channel: { id: "channel_1", slug: "general", name: "general" },
      messages: [],
      human_loop_items: [
        {
          id: "loop_1",
          request_id: "approval_1",
          request_kind: "approval",
          workflow_run_id: "run_1",
          status: "requested",
          title: "Approval required",
          detail: "Release signoff",
          metadata: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    });
    api.fetchDmThread.mockResolvedValue({
      thread: { id: "dm_1", title: "ERGO" },
      messages: [],
      human_loop_items: [],
    });
    api.updateNavigation.mockResolvedValue({});
    api.resolveWorkflowApprovalRequest.mockResolvedValue({ ok: true });

    render(
      <ThemeProvider>
        <OrbitWorkspace orbitId="orbit_1" />
      </ThemeProvider>,
    );

    expect(await screen.findByText("Approval required")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    });
    await waitFor(() =>
      expect(api.resolveWorkflowApprovalRequest).toHaveBeenCalledWith("session-token", "orbit_1", {
        workflow_run_id: "run_1",
        request_id: "approval_1",
        approved: true,
      }),
    );
  });

  it("loads available repositories from orbit settings and connects a new repo", async () => {
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
      repositories: [
        {
          id: "repo_1",
          provider: "github",
          full_name: "octocat/orbit-one",
          owner_name: "octocat",
          repo_name: "orbit-one",
          is_private: true,
          default_branch: "main",
          status: "active",
          health_state: "healthy",
          is_primary: true,
          binding_status: "active",
        },
      ],
      members: [{ id: "user_1", user_id: "user_1", role: "owner", display_name: "Octo Cat", login: "octocat" }],
      channels: [{ id: "channel_1", slug: "general", name: "general" }],
      direct_messages: [{ id: "dm_1", title: "ERGO", kind: "agent", participant: { login: "ERGO", display_name: "ERGO" } }],
      messages: [],
      human_loop_items: [],
      notifications: [],
      permissions: {
        orbit_role: "owner",
        repo_grants: { repo_1: "admin" },
        can_manage_members: true,
        can_manage_settings: true,
        can_manage_integrations: true,
        can_bind_repo: true,
        can_publish_artifact: true,
      },
      workflow: { status: "ok", selected_run_id: null, selected_run: null, runs: [] },
      prs: [],
      issues: [],
      codespaces: [],
      demos: [],
      navigation: { orbit_id: "orbit_1", section: "chat" },
    });
    api.fetchChannelMessages.mockResolvedValue({
      channel: { id: "channel_1", slug: "general", name: "general" },
      messages: [],
      human_loop_items: [],
    });
    api.fetchDmThread.mockResolvedValue({
      thread: { id: "dm_1", title: "ERGO" },
      messages: [],
      human_loop_items: [],
    });
    api.updateNavigation.mockResolvedValue({});
    api.fetchAvailableRepositories.mockResolvedValue([
      {
        provider: "github",
        full_name: "octocat/platform-ops",
        owner_name: "octocat",
        repo_name: "platform-ops",
        is_private: true,
        default_branch: "main",
        status: "available",
      },
    ]);
    api.connectOrbitRepository.mockResolvedValue({ ok: true });

    render(
      <ThemeProvider>
        <OrbitWorkspace orbitId="orbit_1" />
      </ThemeProvider>,
    );

    expect((await screen.findAllByText("general")).length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /orbit settings/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /connect repository/i }));
    });

    expect(await screen.findByText("octocat/platform-ops")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    });

    await waitFor(() =>
      expect(api.connectOrbitRepository).toHaveBeenCalledWith("session-token", "orbit_1", {
        repo_full_name: "octocat/platform-ops",
        make_primary: false,
      }),
    );
  });
});
