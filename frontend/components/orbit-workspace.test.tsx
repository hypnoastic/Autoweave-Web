import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AuthenticatedAppShell } from "@/components/authenticated-shell";
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
  fetchOrbitSearch: vi.fn(),
  fetchPreferences: vi.fn(),
  fetchWorkflow: vi.fn(),
  inviteOrbitMember: vi.fn(),
  publishDemo: vi.fn(),
  readSession: vi.fn(),
  refreshPrsIssues: vi.fn(),
  resolveWorkflowApprovalRequest: vi.fn(),
  sendChannelMessage: vi.fn(),
  sendDmMessage: vi.fn(),
  setPrimaryOrbitRepository: vi.fn(),
  updatePreferences: vi.fn(),
  updateOrbitMemberRole: vi.fn(),
  updateNavigation: vi.fn(),
  writeSession: vi.fn(),
}));
const mockRouter = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));

let mockPathname = "/app/orbits/orbit_1";

vi.mock("@/lib/api", () => api);
vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  usePathname: () => mockPathname,
}));

function renderOrbit() {
  mockPathname = "/app/orbits/orbit_1";
  return render(
    <ThemeProvider>
      <AuthenticatedAppShell>
        <OrbitWorkspace orbitId="orbit_1" />
      </AuthenticatedAppShell>
    </ThemeProvider>,
  );
}

describe("OrbitWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.removeItem?.("autoweave-shell-sidebar-collapsed");
    mockPathname = "/app/orbits/orbit_1";
  });

  it("hydrates the orbit shell from the bootstrap payload before the full orbit payload finishes", async () => {
    let resolveFullOrbit: ((value: unknown) => void) | null = null;

    api.readSession.mockReturnValue({
      token: "session-token",
      user: {
        id: "user_1",
        github_login: "octocat",
        display_name: "Octo Cat",
      },
    });
    api.fetchPreferences.mockResolvedValue({ theme_preference: "system" });
    api.fetchOrbit.mockImplementation((_token: string, _orbitId: string, options?: { bootstrap?: boolean }) => {
      const payload = {
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
          can_manage_roles: true,
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
        artifacts: [],
        navigation: { orbit_id: "orbit_1", section: "chat" },
      };
      if (options?.bootstrap) {
        return Promise.resolve(payload);
      }
      return new Promise((resolve) => {
        resolveFullOrbit = resolve;
      });
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

    renderOrbit();

    expect(await screen.findByRole("button", { name: "Search" })).toBeInTheDocument();
    expect(api.fetchOrbit).toHaveBeenNthCalledWith(1, "session-token", "orbit_1", { bootstrap: true });
    expect(api.fetchOrbit).toHaveBeenNthCalledWith(2, "session-token", "orbit_1");

    await act(async () => {
      resolveFullOrbit?.({
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
          can_manage_roles: true,
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
        artifacts: [],
        navigation: { orbit_id: "orbit_1", section: "chat" },
      });
    });
  });

  it("renders the orbit shell before preferences finish loading", async () => {
    let resolvePreferences: ((value: { theme_preference: "system" }) => void) | null = null;

    api.readSession.mockReturnValue({
      token: "session-token",
      user: {
        id: "user_1",
        github_login: "octocat",
        display_name: "Octo Cat",
      },
    });
    api.fetchPreferences.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePreferences = resolve;
        }),
    );
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
        can_manage_roles: true,
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
      artifacts: [],
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

    renderOrbit();

    expect(await screen.findByRole("button", { name: "Search" })).toBeInTheDocument();

    await act(async () => {
      resolvePreferences?.({ theme_preference: "system" });
    });
  });

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
      artifacts: [],
      navigation: { orbit_id: "orbit_1", section: "workflow" },
    });
    api.fetchWorkflow.mockResolvedValue({
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

    renderOrbit();

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
      artifacts: [],
      navigation: { orbit_id: "orbit_1", section: "chat" },
    });
    api.fetchWorkflow.mockResolvedValue({
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

    renderOrbit();

    expect((await screen.findAllByText("Approval required")).length).toBeGreaterThan(0);
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

  it("polls the dedicated workflow endpoint when a run is active and refreshes the active conversation", async () => {
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
        status: "degraded",
        selected_run_id: "run_1",
        runs: [
          {
            id: "run_1",
            title: "Build the review workflow",
            status: "running",
            operator_status: "waiting_for_human",
            operator_summary: "Waiting for live sync",
            execution_status: "waiting_for_human",
            execution_summary: "Waiting for live sync",
            tasks: [],
            events: [],
            human_requests: [],
            approval_requests: [],
          },
        ],
        selected_run: {
          id: "run_1",
          title: "Build the review workflow",
          status: "running",
          operator_status: "waiting_for_human",
          operator_summary: "Waiting for live sync",
          execution_status: "waiting_for_human",
          execution_summary: "Waiting for live sync",
          tasks: [],
          events: [],
          human_requests: [],
          approval_requests: [],
        },
      },
      prs: [],
      issues: [],
      codespaces: [],
      demos: [],
      artifacts: [],
      navigation: { orbit_id: "orbit_1", section: "chat" },
    });
    api.fetchWorkflow.mockResolvedValue({
      status: "ok",
      selected_run_id: "run_1",
      runs: [
        {
          id: "run_1",
          title: "Build the review workflow",
          status: "running",
          operator_status: "waiting_for_human",
          operator_summary: "ERGO needs a clarification",
          execution_status: "waiting_for_human",
          execution_summary: "Waiting for answer",
          tasks: [],
          events: [],
          human_requests: [{ id: "human_1", task_id: "task_1", status: "open", question: "What should ship first?" }],
          approval_requests: [],
        },
      ],
      selected_run: {
        id: "run_1",
        title: "Build the review workflow",
        status: "running",
        operator_status: "waiting_for_human",
        operator_summary: "ERGO needs a clarification",
        execution_status: "waiting_for_human",
        execution_summary: "Waiting for answer",
        tasks: [],
        events: [],
        human_requests: [{ id: "human_1", task_id: "task_1", status: "open", question: "What should ship first?" }],
        approval_requests: [],
      },
    });
    api.fetchChannelMessages.mockResolvedValue({
      channel: { id: "channel_1", slug: "general", name: "general" },
      messages: [],
      human_loop_items: [
        {
          id: "loop_1",
          request_id: "human_1",
          request_kind: "clarification",
          workflow_run_id: "run_1",
          status: "open",
          title: "Clarification needed",
          detail: "What should ship first?",
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

    renderOrbit();

    await waitFor(() => expect(api.fetchWorkflow).toHaveBeenCalledWith("session-token", "orbit_1"));
    await waitFor(() => expect(api.fetchChannelMessages).toHaveBeenCalledWith("session-token", "orbit_1", "channel_1"));
    expect(await screen.findByText("Clarification needed")).toBeInTheDocument();
  });

  it("loads available repositories from the shared settings nav item and connects a new repo", async () => {
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
      artifacts: [],
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

    renderOrbit();

    expect((await screen.findAllByText("general")).length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Settings$/ }));
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

  it("opens a codespace in the full canvas and returns to the workspace list from the top bar back button", async () => {
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
      repositories: [],
      members: [{ id: "user_1", user_id: "user_1", role: "owner", display_name: "Octo Cat", login: "octocat" }],
      channels: [{ id: "channel_1", slug: "general", name: "general" }],
      direct_messages: [{ id: "dm_1", title: "ERGO", kind: "agent", participant: { login: "ERGO", display_name: "ERGO" } }],
      messages: [],
      human_loop_items: [],
      notifications: [],
      permissions: {
        orbit_role: "owner",
        repo_grants: {},
        can_manage_members: true,
        can_manage_settings: true,
        can_manage_integrations: true,
        can_bind_repo: true,
        can_publish_artifact: true,
      },
      workflow: { status: "ok", selected_run_id: null, selected_run: null, runs: [] },
      prs: [],
      issues: [],
      codespaces: [
        {
          id: "codespace_1",
          name: "Orbit workspace",
          status: "running",
          repository_full_name: "octocat/orbit-one",
          branch_name: "feature/orbit-shell",
          workspace_path: "/workspace/orbit-one",
          editor_url: "https://example.com/editor",
        },
      ],
      demos: [],
      artifacts: [],
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

    renderOrbit();

    expect(await screen.findByRole("button", { name: "Codespaces" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Codespaces" }));
    });

    expect(await screen.findByText("Orbit workspace")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getAllByText("Orbit workspace")[0]);
    });

    expect(await screen.findByTitle("Orbit workspace")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    });

    await waitFor(() => expect(screen.queryByTitle("Orbit workspace")).not.toBeInTheDocument());
    expect(screen.getByText("Branch workspaces")).toBeInTheDocument();
  });

  it("updates the theme preference from the persistent top bar", async () => {
    api.readSession.mockReturnValue({
      token: "session-token",
      user: {
        id: "user_1",
        github_login: "octocat",
        display_name: "Octo Cat",
      },
    });
    api.fetchPreferences.mockResolvedValue({ theme_preference: "dark" });
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
      repositories: [],
      members: [{ id: "user_1", user_id: "user_1", role: "owner", display_name: "Octo Cat", login: "octocat" }],
      channels: [{ id: "channel_1", slug: "general", name: "general" }],
      direct_messages: [{ id: "dm_1", title: "ERGO", kind: "agent", participant: { login: "ERGO", display_name: "ERGO" } }],
      messages: [],
      human_loop_items: [],
      notifications: [],
      permissions: {
        orbit_role: "owner",
        repo_grants: {},
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
      artifacts: [],
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
    api.updatePreferences.mockResolvedValue({ theme_preference: "light" });

    renderOrbit();

    expect((await screen.findAllByText("general")).length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /switch to light theme/i }));
    });

    await waitFor(() =>
      expect(api.updatePreferences).toHaveBeenCalledWith("session-token", {
        theme_preference: "light",
      }),
    );
  });

  it("shows repo-aware inbox items and filters legacy workflow prompt messages out of search", async () => {
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
      notifications: [
        {
          id: "notif_1",
          kind: "artifact",
          title: "Artifact ready",
          detail: "Release notes draft is ready.",
          status: "unread",
          source_kind: "artifact",
          source_id: "artifact_1",
          channel_id: null,
          dm_thread_id: null,
          metadata: { repository_full_name: "octocat/orbit-one", artifact_kind: "report" },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
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
      artifacts: [
        {
          id: "artifact_1",
          repository_id: "repo_1",
          repository_full_name: "octocat/orbit-one",
          repository_url: "https://github.com/octocat/orbit-one",
          work_item_id: "work_1",
          workflow_run_id: "run_1",
          source_kind: "work_item",
          source_id: "work_1",
          artifact_kind: "report",
          title: "Release notes draft",
          summary: "A repo-scoped report artifact.",
          status: "ready",
          external_url: "https://example.com/artifact",
          metadata: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      navigation: { orbit_id: "orbit_1", section: "chat" },
    });
    api.fetchChannelMessages.mockResolvedValue({
      channel: { id: "channel_1", slug: "general", name: "general" },
      messages: [
        {
          id: "msg_legacy",
          orbit_id: "orbit_1",
          channel_id: "channel_1",
          dm_thread_id: null,
          user_id: null,
          author_kind: "system",
          author_name: "System",
          body: "Approved an ERGO release signoff",
          metadata: { workflow_prompt: true },
          created_at: new Date().toISOString(),
        },
      ],
      human_loop_items: [
        {
          id: "hli_approval_1",
          request_id: "approval_1",
          request_kind: "approval",
          workflow_run_id: "run_1",
          work_item_id: "work_item_1",
          task_id: "task_1",
          task_key: "manager_plan",
          status: "requested",
          title: "Approval required",
          detail: "Release signoff",
          response_text: null,
          channel_id: "channel_1",
          dm_thread_id: null,
          metadata: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          resolved_at: null,
        },
      ],
    });
    api.fetchDmThread.mockResolvedValue({
      thread: { id: "dm_1", title: "ERGO" },
      messages: [],
      human_loop_items: [],
    });
    api.updateNavigation.mockResolvedValue({});

    renderOrbit();

    expect((await screen.findAllByText("general")).length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /open notifications/i }));
    });
    expect(await screen.findByText("Artifact ready")).toBeInTheDocument();
    expect(await screen.findByText("octocat/orbit-one · Release notes draft is ready.")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    });
    const searchInput = screen.getByPlaceholderText("Search this orbit or run a quick action");
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "approved" } });
    });
    await waitFor(() => expect(screen.getByText("No commands or search results matched that query.")).toBeInTheDocument());

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "release notes" } });
    });
    expect((await screen.findAllByText("Release notes draft")).length).toBeGreaterThan(0);
  });

  it("opens shell search with Ctrl+K and renders remote orbit search results", async () => {
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
        can_manage_roles: true,
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
      artifacts: [],
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
    api.fetchOrbitSearch.mockResolvedValue([
      {
        key: "artifact-1",
        kind: "artifact",
        label: "Release notes draft",
        detail: "Artifact · octocat/orbit-one",
        section: "demos",
        metadata: {},
      },
    ]);
    api.updateNavigation.mockResolvedValue({});

    renderOrbit();

    expect((await screen.findAllByText("general")).length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    });

    expect(await screen.findByRole("dialog", { name: "Search this orbit" })).toBeInTheDocument();
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("Search this orbit or run a quick action"), { target: { value: "release notes" } });
    });

    await waitFor(() => expect(api.fetchOrbitSearch).toHaveBeenCalledWith("session-token", "orbit_1", "release notes", 18));
    expect(await screen.findByText("Release notes draft")).toBeInTheDocument();
  });

  it("closes the inbox before opening shell search from the persistent sidebar", async () => {
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
      notifications: [
        {
          id: "notif_1",
          kind: "artifact",
          title: "Artifact ready",
          detail: "Release notes draft is ready.",
          status: "unread",
          source_kind: "artifact",
          source_id: "artifact_1",
          channel_id: null,
          dm_thread_id: null,
          metadata: { repository_full_name: "octocat/orbit-one", artifact_kind: "report" },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      permissions: {
        orbit_role: "owner",
        repo_grants: { repo_1: "admin" },
        can_manage_members: true,
        can_manage_roles: true,
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
      artifacts: [],
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

    renderOrbit();

    expect((await screen.findAllByText("general")).length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /open notifications/i }));
    });
    expect(await screen.findByRole("dialog", { name: "Inbox" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    });

    expect(await screen.findByRole("dialog", { name: "Search this orbit" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Inbox" })).not.toBeInTheDocument();
  });

  it("filters triage saved views and updates member roles from orbit settings", async () => {
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
      members: [
        { id: "user_1", user_id: "user_1", role: "owner", display_name: "Octo Cat", login: "octocat", is_self: true },
        { id: "user_2", user_id: "user_2", role: "contributor", display_name: "Team Mate", login: "teammate" },
      ],
      channels: [{ id: "channel_1", slug: "general", name: "general" }],
      direct_messages: [{ id: "dm_1", title: "ERGO", kind: "agent", participant: { login: "ERGO", display_name: "ERGO" } }],
      messages: [],
      human_loop_items: [],
      notifications: [
        {
          id: "notif_approval",
          kind: "approval",
          title: "Approval required",
          detail: "Release signoff",
          status: "unread",
          source_kind: "approval",
          source_id: "approval_1",
          channel_id: "channel_1",
          dm_thread_id: null,
          metadata: { repository_ids: ["repo_1"] },
          created_at: new Date().toISOString(),
        },
        {
          id: "notif_artifact",
          kind: "artifact",
          title: "Artifact ready",
          detail: "Release notes draft is ready.",
          status: "unread",
          source_kind: "artifact",
          source_id: "artifact_1",
          channel_id: null,
          dm_thread_id: null,
          metadata: { repository_full_name: "octocat/orbit-one" },
          created_at: new Date().toISOString(),
        },
      ],
      permissions: {
        orbit_role: "owner",
        repo_grants: { repo_1: "admin" },
        can_manage_members: true,
        can_manage_roles: true,
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
      artifacts: [
        {
          id: "artifact_1",
          repository_id: "repo_1",
          repository_full_name: "octocat/orbit-one",
          repository_url: "https://github.com/octocat/orbit-one",
          work_item_id: null,
          workflow_run_id: null,
          source_kind: "demo",
          source_id: "demo_1",
          artifact_kind: "report",
          title: "Release notes draft",
          summary: "A ready report artifact",
          status: "ready",
          external_url: "https://example.com/artifact",
          metadata: {},
          updated_at: new Date().toISOString(),
        },
      ],
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
    api.updateOrbitMemberRole.mockResolvedValue({ ok: true });

    renderOrbit();

    expect((await screen.findAllByText("general")).length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /open notifications/i }));
    });
    expect((await screen.findAllByText("Approval required")).length).toBeGreaterThan(0);

    const artifactViewButtons = screen.getAllByRole("button", { name: /Artifacts/i });
    await act(async () => {
      fireEvent.click(artifactViewButtons[artifactViewButtons.length - 1]);
    });
    expect(await screen.findByText("Artifact ready")).toBeInTheDocument();
    expect(screen.queryByText("Approval required")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Settings$/ }));
    });
    expect(await screen.findByText("Workspace roles")).toBeInTheDocument();

    const managerButtons = screen.getAllByRole("button", { name: "Manager" });
    await act(async () => {
      fireEvent.click(managerButtons[managerButtons.length - 1]);
    });

    await waitFor(() => expect(api.updateOrbitMemberRole).toHaveBeenCalledWith("session-token", "orbit_1", "user_2", "manager"));
  });

  it("uses the orbit payload for the default general conversation without a second channel fetch", async () => {
    api.fetchChannelMessages.mockClear();
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
      members: [{ id: "user_1", user_id: "user_1", role: "owner", display_name: "Octo Cat", login: "octocat", is_self: true }],
      channels: [{ id: "channel_1", slug: "general", name: "general" }],
      direct_messages: [{ id: "dm_1", title: "ERGO", kind: "agent", participant: { login: "ERGO", display_name: "ERGO" } }],
      messages: [
        {
          id: "msg_1",
          author_kind: "user",
          author_name: "Octo Cat",
          body: "Orbit payload message",
          metadata: {},
          created_at: new Date().toISOString(),
          channel_id: "channel_1",
          dm_thread_id: null,
        },
      ],
      human_loop_items: [],
      notifications: [],
      permissions: {
        orbit_role: "owner",
        repo_grants: { repo_1: "admin" },
        can_manage_members: true,
        can_manage_roles: true,
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
      artifacts: [],
      navigation: { orbit_id: "orbit_1", section: "chat" },
    });
    api.fetchDmThread.mockResolvedValue({
      thread: { id: "dm_1", title: "ERGO" },
      messages: [],
      human_loop_items: [],
    });
    api.updateNavigation.mockResolvedValue({});

    renderOrbit();

    expect((await screen.findAllByText("Orbit payload message")).length).toBeGreaterThan(0);
    expect(api.fetchChannelMessages).not.toHaveBeenCalled();
  });

  it("gates artifact publishing and invite controls for non-managers", async () => {
    api.readSession.mockReturnValue({
      token: "session-token",
      user: {
        id: "user_2",
        github_login: "teammate",
        display_name: "Team Mate",
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
      members: [
        { id: "user_1", user_id: "user_1", role: "owner", display_name: "Octo Cat", login: "octocat" },
        { id: "user_2", user_id: "user_2", role: "viewer", display_name: "Team Mate", login: "teammate", is_self: true },
      ],
      channels: [{ id: "channel_1", slug: "general", name: "general" }],
      direct_messages: [{ id: "dm_1", title: "ERGO", kind: "agent", participant: { login: "ERGO", display_name: "ERGO" } }],
      messages: [],
      human_loop_items: [],
      notifications: [],
      permissions: {
        orbit_role: "viewer",
        repo_grants: {},
        can_manage_members: false,
        can_manage_roles: false,
        can_manage_settings: false,
        can_manage_integrations: false,
        can_bind_repo: false,
        can_publish_artifact: false,
      },
      workflow: { status: "ok", selected_run_id: null, selected_run: null, runs: [] },
      prs: [],
      issues: [],
      codespaces: [],
      demos: [],
      artifacts: [],
      navigation: { orbit_id: "orbit_1", section: "demos" },
    });
    api.fetchDmThread.mockResolvedValue({
      thread: { id: "dm_1", title: "ERGO" },
      messages: [],
      human_loop_items: [],
    });
    api.updateNavigation.mockResolvedValue({});

    renderOrbit();

    expect(await screen.findByRole("button", { name: /publish demo/i })).toBeDisabled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Settings$/ }));
    });

    expect(await screen.findByText("Only orbit managers and owners can send invitations.")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("teammate@example.com")).not.toBeInTheDocument();
  });
});
