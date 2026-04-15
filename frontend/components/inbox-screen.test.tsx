import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AuthenticatedAppShell } from "@/components/authenticated-shell";
import { InboxScreen } from "@/components/inbox-screen";
import { ThemeProvider } from "@/components/theme-provider";

const api = vi.hoisted(() => ({
  markNotificationRead: vi.fn(),
  createDmThread: vi.fn(),
  createOrbit: vi.fn(),
  fetchDmThread: vi.fn(),
  fetchInbox: vi.fn(),
  fetchOrbit: vi.fn(),
  fetchPreferences: vi.fn(),
  readSession: vi.fn(),
  resolveWorkflowApprovalRequest: vi.fn(),
  sendDmMessage: vi.fn(),
  updateOrbitIssue: vi.fn(),
  updateNavigation: vi.fn(),
  updatePreferences: vi.fn(),
  writeSession: vi.fn(),
}));
const mockRouter = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
}));

let mockPathname = "/app";

vi.mock("@/lib/api", () => api);
vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  usePathname: () => mockPathname,
}));

function inboxPayload(overrides: Record<string, unknown> = {}) {
  return {
    me: {
      id: "user_1",
      github_login: "octocat",
      display_name: "Octo Cat",
    },
    summary: {
      needs_attention: 3,
      review_queue: 1,
      review_requests: 1,
      blocked_work: 0,
      stale_work: 0,
      approvals: 0,
      mentions: 1,
      agent_asks: 0,
      active_sources: 1,
      recent_chats: 2,
      recent_orbits: 1,
    },
    briefing: {
      id: "briefing-ergo",
      kind: "briefing",
      bucket: "agent",
      reason_label: "Briefing",
      title: "ERGO briefing",
      preview: "Orbit One is the active ERGO scope for new Inbox questions.",
      source_label: "Orbit One",
      status_label: "Pinned",
      attention: "high",
      unread: false,
      created_at: new Date().toISOString(),
      orbit_id: "orbit_1",
      orbit_name: "Orbit One",
      navigation: { orbit_id: "orbit_1", section: "chat", conversation_kind: "dm", conversation_id: "dm_ergo" },
      detail: {
        summary: "Orbit One is the active ERGO scope for new Inbox questions. 3 inbox signals are still unread.",
        key_context: [
          { label: "Unread", value: "3" },
          { label: "Review queue", value: "1" },
        ],
        related_entities: [{ label: "Default scope", value: "Orbit One" }],
        next_actions: [{ label: "Open active orbit", navigation: { orbit_id: "orbit_1", section: "chat" } }],
        metadata: [{ label: "Mode", value: "Operational briefing" }],
        conversation_excerpt: [{ author: "ERGO", body: "I have current context on Orbit One.", created_at: new Date().toISOString() }],
      },
    },
    items: [
      {
        id: "briefing-ergo",
        kind: "briefing",
        bucket: "agent",
        reason_label: "Briefing",
        title: "ERGO briefing",
        preview: "Orbit One is the active ERGO scope for new Inbox questions.",
        source_label: "Orbit One",
        status_label: "Pinned",
        attention: "high",
        unread: false,
        created_at: new Date().toISOString(),
        orbit_id: "orbit_1",
        orbit_name: "Orbit One",
        navigation: { orbit_id: "orbit_1", section: "chat" },
        detail: {
          summary: "Orbit One is the active ERGO scope for new Inbox questions. 3 inbox signals are still unread.",
          key_context: [{ label: "Unread", value: "3" }],
          related_entities: [{ label: "Default scope", value: "Orbit One" }],
          next_actions: [{ label: "Open active orbit", navigation: { orbit_id: "orbit_1", section: "chat" } }],
          metadata: [],
          conversation_excerpt: [],
        },
      },
      {
        id: "notif_1",
        kind: "mention",
        bucket: "mentions",
        reason_label: "Mention",
        title: "Mentioned in workflow review",
        preview: "You were mentioned in the release review thread.",
        source_label: "Orbit One · Pull request · Mention",
        status_label: "Unread",
        attention: "high",
        unread: true,
        created_at: new Date().toISOString(),
        orbit_id: "orbit_1",
        orbit_name: "Orbit One",
        navigation: { orbit_id: "orbit_1", section: "chat" },
        action_context: { notification_id: "notif_1" },
        detail: {
          summary: "You were mentioned in a review conversation.",
          key_context: [{ label: "Type", value: "Mention" }],
          related_entities: [{ label: "Orbit", value: "Orbit One" }],
          next_actions: [{ label: "Open chat", navigation: { orbit_id: "orbit_1", section: "chat" } }],
          metadata: [],
          conversation_excerpt: [],
        },
      },
      {
        id: "artifact_1",
        kind: "source",
        bucket: "sources",
        reason_label: "Source",
        title: "Release notes draft",
        preview: "The latest release notes artifact is ready.",
        source_label: "Orbit One · octocat/orbit-one · Report",
        status_label: "Ready",
        attention: "normal",
        unread: false,
        created_at: new Date().toISOString(),
        orbit_id: "orbit_1",
        orbit_name: "Orbit One",
        navigation: { orbit_id: "orbit_1", section: "demos" },
        detail: {
          summary: "Release notes draft is available as a recent source artifact.",
          key_context: [{ label: "Kind", value: "Report" }],
          related_entities: [{ label: "Orbit", value: "Orbit One" }],
          next_actions: [{ label: "Open artifact surface", navigation: { orbit_id: "orbit_1", section: "demos" } }],
          metadata: [],
          conversation_excerpt: [],
        },
      },
    ],
    scopes: [
      {
        orbit_id: "orbit_1",
        orbit_name: "Orbit One",
        orbit_slug: "orbit-one",
        repository_full_name: "octocat/orbit-one",
        ergo_thread_id: "dm_ergo",
        is_active: true,
      },
    ],
    active_scope: {
      orbit_id: "orbit_1",
      orbit_name: "Orbit One",
      orbit_slug: "orbit-one",
      repository_full_name: "octocat/orbit-one",
      ergo_thread_id: "dm_ergo",
      is_active: true,
    },
    notifications: [],
    ...overrides,
  };
}

function dmPayload(overrides: Record<string, unknown> = {}) {
  return {
    thread: {
      id: "dm_ergo",
      title: "ERGO",
      kind: "agent",
    },
    messages: [
      {
        id: "msg_1",
        author_kind: "agent",
        author_name: "ERGO",
        body: "I have current context on Orbit One.",
        metadata: {},
        created_at: new Date().toISOString(),
        dm_thread_id: "dm_ergo",
      },
    ],
    human_loop_items: [],
    ...overrides,
  };
}

function renderInbox(props: Parameters<typeof InboxScreen>[0] = {}) {
  mockPathname = "/app";
  return render(
    <ThemeProvider>
      <AuthenticatedAppShell>
        <InboxScreen {...props} />
      </AuthenticatedAppShell>
    </ThemeProvider>,
  );
}

describe("InboxScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname = "/app";
    api.readSession.mockReturnValue({
      token: "session-token",
      user: {
        id: "user_1",
        github_login: "octocat",
        display_name: "Octo Cat",
      },
    });
    api.fetchPreferences.mockResolvedValue({ theme_preference: "system" });
    api.fetchDmThread.mockResolvedValue(dmPayload());
    api.fetchOrbit.mockResolvedValue({
      orbit: {
        id: "orbit_1",
        slug: "orbit-one",
        name: "Orbit One",
        description: "Primary delivery orbit",
        repo_full_name: "octocat/orbit-one",
        repo_private: true,
        default_branch: "main",
      },
      members: [],
      native_issues: [],
      issues: [],
      prs: [],
    });
    api.updateNavigation.mockResolvedValue({});
    api.updateOrbitIssue.mockResolvedValue({});
    api.resolveWorkflowApprovalRequest.mockResolvedValue({});
    api.markNotificationRead.mockResolvedValue({});
  });

  it("renders the decluttered ERGO inbox and keeps chat active when an item is selected", async () => {
    api.fetchInbox.mockResolvedValue(inboxPayload());

    renderInbox();

    expect(await screen.findByText("I have current context on Orbit One.")).toBeInTheDocument();
    expect(screen.getAllByPlaceholderText("Message ERGO about this orbit").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Orbit One").length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button", { name: /Mentioned in workflow review/i })[0]);

    expect((await screen.findAllByText("You were mentioned in a review conversation.")).length).toBeGreaterThan(0);
    expect(screen.getAllByPlaceholderText("Message ERGO about this orbit").length).toBeGreaterThan(0);
  });

  it("filters source items into the Sources bucket", async () => {
    api.fetchInbox.mockResolvedValue(inboxPayload());

    renderInbox();

    await screen.findByText("I have current context on Orbit One.");
    fireEvent.click(screen.getAllByRole("button", { name: /^Sources/ })[0]);

    expect(screen.getAllByRole("button", { name: /Release notes draft/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Mentioned in workflow review/i })).not.toBeInTheDocument();
  });

  it("routes composer sends through the selected orbit ERGO DM thread and refreshes the inbox", async () => {
    api.fetchInbox
      .mockResolvedValueOnce(
        inboxPayload({
          scopes: [
            {
              orbit_id: "orbit_1",
              orbit_name: "Orbit One",
              orbit_slug: "orbit-one",
              repository_full_name: "octocat/orbit-one",
              ergo_thread_id: null,
              is_active: true,
            },
          ],
          active_scope: {
            orbit_id: "orbit_1",
            orbit_name: "Orbit One",
            orbit_slug: "orbit-one",
            repository_full_name: "octocat/orbit-one",
            ergo_thread_id: null,
            is_active: true,
          },
        }),
      )
      .mockResolvedValueOnce(inboxPayload());
    api.createDmThread.mockResolvedValue({ id: "dm_ergo_new" });
    api.sendDmMessage.mockResolvedValue({
      message: {
        id: "msg_human",
        author_kind: "human",
        author_name: "Octo Cat",
        body: "Give me the latest release summary",
        metadata: {},
        created_at: new Date().toISOString(),
        dm_thread_id: "dm_ergo_new",
      },
      ergo: {
        id: "msg_ergo",
        author_kind: "agent",
        author_name: "ERGO",
        body: "Release summary is ready.",
        metadata: {},
        created_at: new Date().toISOString(),
        dm_thread_id: "dm_ergo_new",
      },
    });

    renderInbox();

    expect(await screen.findAllByPlaceholderText("Message ERGO about this orbit")).not.toHaveLength(0);
    fireEvent.change(screen.getAllByPlaceholderText("Message ERGO about this orbit")[0], {
      target: { value: "Give me the latest release summary" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send to ERGO" }));

    await waitFor(() =>
      expect(api.createDmThread).toHaveBeenCalledWith("session-token", "orbit_1", {
        target_kind: "agent",
        target_login: "ERGO",
      }),
    );
    expect(api.sendDmMessage).toHaveBeenCalledWith("session-token", "orbit_1", "dm_ergo_new", "Give me the latest release summary");
    await waitFor(() => expect(api.fetchInbox).toHaveBeenCalledTimes(2));
  });

  it("renders native issue context when chat is opened from a deep link", async () => {
    api.fetchInbox.mockResolvedValue(inboxPayload());
    api.fetchOrbit.mockResolvedValue({
      orbit: {
        id: "orbit_1",
        slug: "orbit-one",
        name: "Orbit One",
        description: "Primary delivery orbit",
        repo_full_name: "octocat/orbit-one",
        repo_private: true,
        default_branch: "main",
      },
      native_issues: [
        {
          id: "pm_1",
          number: 1,
          title: "Model the issue board",
          detail: "Keep planning inside the orbit shell.",
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
      members: [],
      issues: [],
      prs: [],
    });

    renderInbox({ mode: "chat", contextOrbitId: "orbit_1", contextIssueId: "pm_1", contextSourceKind: "native_issue" });

    expect((await screen.findAllByText("PM-1 · Model the issue board")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Keep planning inside the orbit shell.").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Open orbit/i }).length).toBeGreaterThan(0);
    expect(api.fetchOrbit).toHaveBeenCalledWith("session-token", "orbit_1");

    fireEvent.click(screen.getAllByRole("button", { name: /Open orbit/i })[0]);

    expect(mockRouter.push).toHaveBeenCalledWith("/app/orbits/orbit_1?section=issues&detailKind=native_issue&detailId=pm_1");
  });

  it("updates the selected native issue directly from the triage workspace", async () => {
    const reviewItem = {
      id: "native-review-pm_1",
      kind: "native_issue",
      bucket: "review",
      reason_label: "Review request",
      title: "PM-1 · Review dense inbox layout",
      preview: "Waiting for review follow-up.",
      source_label: "Orbit One · octocat/orbit-one",
      status_label: "In review",
      attention: "high",
      unread: true,
      created_at: new Date().toISOString(),
      orbit_id: "orbit_1",
      orbit_name: "Orbit One",
      navigation: { orbit_id: "orbit_1", section: "issues", detail_kind: "native_issue", detail_id: "pm_1" },
      detail: {
        summary: "Waiting for review follow-up.",
        key_context: [],
        related_entities: [],
        next_actions: [{ label: "Open issue", navigation: { orbit_id: "orbit_1", section: "issues", detail_kind: "native_issue", detail_id: "pm_1" } }],
        metadata: [],
        conversation_excerpt: [],
      },
    };
    api.fetchInbox
      .mockResolvedValueOnce(inboxPayload({ items: [inboxPayload().briefing, reviewItem] }))
      .mockResolvedValueOnce(inboxPayload({ items: [inboxPayload().briefing, { ...reviewItem, status_label: "Ready to merge" }] }));
    api.fetchOrbit.mockResolvedValue({
      orbit: {
        id: "orbit_1",
        slug: "orbit-one",
        name: "Orbit One",
        description: "Primary delivery orbit",
        repo_full_name: "octocat/orbit-one",
        repo_private: true,
        default_branch: "main",
      },
      members: [
        {
          user_id: "user_1",
          github_login: "octocat",
          display_name: "Octo Cat",
          role: "owner",
          introduced: true,
          avatar_url: null,
        },
      ],
      cycles: [
        {
          id: "cycle_1",
          name: "April stabilization",
          goal: "Hold the release line steady.",
          status: "active",
          starts_at: null,
          ends_at: null,
          issue_count: 1,
          completed_count: 0,
          active_count: 1,
          review_count: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: "cycle_2",
          name: "May launch",
          goal: "Prepare the launch cut.",
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
      native_issues: [
        {
          id: "pm_1",
          number: 1,
          title: "Review dense inbox layout",
          detail: "Waiting for review follow-up.",
          status: "in_review",
          priority: "medium",
          source_kind: "manual",
          cycle_id: null,
          cycle_name: null,
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
      issues: [],
      prs: [],
    });

    renderInbox();

    const statusSelect = await screen.findByDisplayValue("In review");
    fireEvent.change(statusSelect, { target: { value: "ready_to_merge" } });

    await waitFor(() =>
      expect(api.updateOrbitIssue).toHaveBeenCalledWith("session-token", "orbit_1", "pm_1", {
        status: "ready_to_merge",
      }),
    );
    await waitFor(() => expect(api.fetchInbox).toHaveBeenCalledTimes(2));
  });

  it("updates the selected issue cycle directly from the triage workspace", async () => {
    const blockedItem = {
      id: "native-blocked-pm_1",
      kind: "native_issue",
      bucket: "blocked",
      reason_label: "Blocked work",
      title: "PM-1 · Restore launch readiness",
      preview: "Blocked until the issue moves into the next cycle.",
      source_label: "Orbit One · octocat/orbit-one",
      status_label: "Blocked",
      attention: "high",
      unread: true,
      created_at: new Date().toISOString(),
      orbit_id: "orbit_1",
      orbit_name: "Orbit One",
      navigation: { orbit_id: "orbit_1", section: "issues", detail_kind: "native_issue", detail_id: "pm_1" },
      detail: {
        summary: "Blocked until the issue moves into the next cycle.",
        key_context: [],
        related_entities: [],
        next_actions: [{ label: "Open issue", navigation: { orbit_id: "orbit_1", section: "issues", detail_kind: "native_issue", detail_id: "pm_1" } }],
        metadata: [],
        conversation_excerpt: [],
      },
    };
    api.fetchInbox
      .mockResolvedValueOnce(inboxPayload({ items: [inboxPayload().briefing, blockedItem] }))
      .mockResolvedValueOnce(inboxPayload({ items: [inboxPayload().briefing, { ...blockedItem, status_label: "Planned" }] }));
    api.fetchOrbit.mockResolvedValue({
      orbit: {
        id: "orbit_1",
        slug: "orbit-one",
        name: "Orbit One",
        description: "Primary delivery orbit",
        repo_full_name: "octocat/orbit-one",
        repo_private: true,
        default_branch: "main",
      },
      members: [
        {
          user_id: "user_1",
          github_login: "octocat",
          display_name: "Octo Cat",
          role: "owner",
          introduced: true,
          avatar_url: null,
        },
      ],
      cycles: [
        {
          id: "cycle_1",
          name: "April stabilization",
          goal: "Hold the release line steady.",
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
          goal: "Prepare the launch cut.",
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
      native_issues: [
        {
          id: "pm_1",
          number: 1,
          title: "Restore launch readiness",
          detail: "Blocked until the issue moves into the next cycle.",
          status: "blocked",
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
          is_blocked: true,
          has_sub_issues: false,
          stale: false,
          stale_working_days: 0,
          activity: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      issues: [],
      prs: [],
    });

    renderInbox();

    expect((await screen.findAllByText("PM-1 · Restore launch readiness")).length).toBeGreaterThan(0);
    await screen.findByRole("option", { name: "May launch" });

    fireEvent.change(screen.getByLabelText("Issue cycle"), { target: { value: "cycle_2" } });

    await waitFor(() =>
      expect(api.updateOrbitIssue).toHaveBeenCalledWith("session-token", "orbit_1", "pm_1", {
        cycle_id: "cycle_2",
      }),
    );
  });

  it("marks mentions as read directly from the triage workspace", async () => {
    api.fetchInbox
      .mockResolvedValueOnce(inboxPayload())
      .mockResolvedValueOnce(
        inboxPayload({
          items: [
            inboxPayload().briefing,
            {
              ...inboxPayload().items[1],
              unread: false,
              status_label: "Read",
              action_context: { notification_id: "notif_1" },
            },
          ],
        }),
      );

    renderInbox();

    expect(await screen.findByText("You were mentioned in a review conversation.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark read" }));

    await waitFor(() => expect(api.markNotificationRead).toHaveBeenCalledWith("session-token", "notif_1"));
    await waitFor(() => expect(api.fetchInbox).toHaveBeenCalledTimes(2));
  });

  it("resolves approvals directly from the inbox workspace", async () => {
    const approvalItem = {
      id: "notif_approval_1",
      kind: "approval",
      bucket: "approvals",
      reason_label: "Approval",
      title: "Release signoff",
      preview: "Human approval is required before the release can continue.",
      source_label: "Orbit One · octocat/orbit-one",
      status_label: "Needs approval",
      attention: "high",
      unread: true,
      created_at: new Date().toISOString(),
      orbit_id: "orbit_1",
      orbit_name: "Orbit One",
      navigation: { orbit_id: "orbit_1", section: "workflow" },
      action_context: {
        notification_id: "notif_approval_1",
        workflow_run_id: "run_1",
        request_id: "approval_1",
        request_kind: "approval",
      },
      detail: {
        summary: "Release signoff requires a human decision before execution can continue.",
        key_context: [],
        related_entities: [],
        next_actions: [{ label: "Open workflow", navigation: { orbit_id: "orbit_1", section: "workflow" } }],
        metadata: [],
        conversation_excerpt: [],
      },
    };
    api.fetchInbox
      .mockResolvedValueOnce(inboxPayload({ items: [inboxPayload().briefing, approvalItem] }))
      .mockResolvedValueOnce(inboxPayload({ items: [inboxPayload().briefing] }));

    renderInbox();

    expect(await screen.findByText("Release signoff requires a human decision before execution can continue.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() =>
      expect(api.resolveWorkflowApprovalRequest).toHaveBeenCalledWith("session-token", "orbit_1", {
        workflow_run_id: "run_1",
        request_id: "approval_1",
        approved: true,
      }),
    );
    await waitFor(() => expect(api.markNotificationRead).toHaveBeenCalledWith("session-token", "notif_approval_1"));
    await waitFor(() => expect(api.fetchInbox).toHaveBeenCalledTimes(2));
  });

  it("primes a stale-issue ERGO follow-up directly from the inbox workspace", async () => {
    const staleItem = {
      id: "native-stale-pm_1",
      kind: "native_issue",
      bucket: "stale",
      reason_label: "Stale",
      title: "PM-1 · Follow up on stale issue",
      preview: "This issue has gone quiet.",
      source_label: "Orbit One · octocat/orbit-one",
      status_label: "4d stale",
      attention: "normal",
      unread: false,
      created_at: new Date().toISOString(),
      orbit_id: "orbit_1",
      orbit_name: "Orbit One",
      navigation: { orbit_id: "orbit_1", section: "issues", detail_kind: "native_issue", detail_id: "pm_1" },
      detail: {
        summary: "This issue needs a fresh update or a stage change.",
        key_context: [],
        related_entities: [],
        next_actions: [{ label: "Open issue", navigation: { orbit_id: "orbit_1", section: "issues", detail_kind: "native_issue", detail_id: "pm_1" } }],
        metadata: [],
        conversation_excerpt: [],
      },
    };
    api.fetchInbox.mockResolvedValue(inboxPayload({ items: [inboxPayload().briefing, staleItem] }));
    api.fetchOrbit.mockResolvedValue({
      orbit: {
        id: "orbit_1",
        slug: "orbit-one",
        name: "Orbit One",
        description: "Primary delivery orbit",
        repo_full_name: "octocat/orbit-one",
        repo_private: true,
        default_branch: "main",
      },
      members: [
        {
          user_id: "user_1",
          github_login: "octocat",
          display_name: "Octo Cat",
          role: "owner",
          introduced: true,
          avatar_url: null,
        },
      ],
      cycles: [
        {
          id: "cycle_1",
          name: "April stabilization",
          goal: "Hold the release line steady.",
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
      ],
      native_issues: [
        {
          id: "pm_1",
          number: 1,
          title: "Follow up on stale issue",
          detail: "This issue needs a fresh update or a stage change.",
          status: "planned",
          priority: "medium",
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
          stale: true,
          stale_working_days: 4,
          activity: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      issues: [],
      prs: [],
    });

    renderInbox();

    expect(await screen.findByText("This issue needs a fresh update or a stage change.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ask ERGO for update" }));

    expect(screen.getAllByDisplayValue(/has been stale for 4 working days/i).length).toBeGreaterThan(0);
  });
});
