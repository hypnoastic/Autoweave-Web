import { fireEvent, render, screen } from "@testing-library/react";

import { OrbitChatPane } from "@/components/orbit-chat-pane";

describe("OrbitChatPane", () => {
  it("renders workflow prompt actions inside chat messages", () => {
    const onAnswerHumanRequest = vi.fn();
    const onResolveApproval = vi.fn();

    render(
      <OrbitChatPane
        session={{
          token: "session",
          user: {
            id: "user_1",
            github_login: "octocat",
            display_name: "Octo Cat",
          },
        }}
        channels={[{ id: "channel_1", slug: "general", name: "general" }]}
        directMessages={[{ id: "dm_1", title: "ERGO" }]}
        selectedConversation={{ kind: "channel", id: "channel_1" }}
        messages={[
          {
            id: "msg_1",
            author_kind: "agent",
            author_name: "ERGO",
            body: "Clarification needed: Which section should ship first?",
            metadata: {
              workflow_prompt: true,
              workflow_prompt_type: "human_request",
              workflow_prompt_phase: "open",
              workflow_run_id: "run_1",
              request_id: "human_1",
            },
            created_at: new Date().toISOString(),
            channel_id: "channel_1",
            dm_thread_id: null,
          },
          {
            id: "msg_2",
            author_kind: "agent",
            author_name: "ERGO",
            body: "Approval required: Approve release to main branch",
            metadata: {
              workflow_prompt: true,
              workflow_prompt_type: "approval_request",
              workflow_prompt_phase: "open",
              workflow_run_id: "run_1",
              request_id: "approval_1",
            },
            created_at: new Date().toISOString(),
            channel_id: "channel_1",
            dm_thread_id: null,
          },
        ]}
        conversationTitle="general"
        conversationSearch=""
        onConversationSearchChange={() => {}}
        messageBody=""
        onMessageBodyChange={() => {}}
        onSendMessage={() => {}}
        onRetryMessage={() => {}}
        onSelectConversation={() => {}}
        onOpenCreateChannel={() => {}}
        onOpenStartDm={() => {}}
        pendingAgent={false}
        selectedRunId="run_1"
        openHumanRequests={{
          human_1: {
            id: "human_1",
            task_id: "task_1",
            status: "open",
            question: "Which section should ship first?",
          },
        }}
        openApprovalRequests={{
          approval_1: {
            id: "approval_1",
            task_id: "task_1",
            status: "requested",
            reason: "Approve release to main branch",
          },
        }}
        workflowAnswers={{ human_1: "Ship chat first." }}
        onWorkflowAnswerChange={() => {}}
        onAnswerHumanRequest={onAnswerHumanRequest}
        onResolveApproval={onResolveApproval}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    expect(onAnswerHumanRequest).toHaveBeenCalledWith("human_1");

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onResolveApproval).toHaveBeenCalledWith("approval_1", true);
  });

  it("shows a loading state while a conversation is refreshing", () => {
    render(
      <OrbitChatPane
        session={{
          token: "session",
          user: {
            id: "user_1",
            github_login: "octocat",
            display_name: "Octo Cat",
          },
        }}
        channels={[{ id: "channel_1", slug: "general", name: "general" }]}
        directMessages={[{ id: "dm_1", title: "ERGO" }]}
        selectedConversation={{ kind: "channel", id: "channel_1" }}
        messages={[]}
        humanLoopItems={[]}
        conversationLoading
        conversationTitle="general"
        conversationSearch=""
        onConversationSearchChange={() => {}}
        messageBody=""
        onMessageBodyChange={() => {}}
        onSendMessage={() => {}}
        onRetryMessage={() => {}}
        onSelectConversation={() => {}}
        onOpenCreateChannel={() => {}}
        onOpenStartDm={() => {}}
        pendingAgent={false}
        selectedRunId=""
        openHumanRequests={{}}
        openApprovalRequests={{}}
        workflowAnswers={{}}
        onWorkflowAnswerChange={() => {}}
        onAnswerHumanRequest={() => {}}
        onResolveApproval={() => {}}
      />,
    );

    expect(screen.getByText("Loading conversation")).toBeInTheDocument();
  });

  it("shows retry affordances for Matrix transport failures", () => {
    const onRetryMessage = vi.fn();

    render(
      <OrbitChatPane
        session={{
          token: "session",
          user: {
            id: "user_1",
            github_login: "octocat",
            display_name: "Octo Cat",
          },
        }}
        channels={[{ id: "channel_1", slug: "general", name: "general" }]}
        directMessages={[]}
        selectedConversation={{ kind: "channel", id: "channel_1" }}
        messages={[
          {
            id: "msg_1",
            author_kind: "user",
            author_name: "Octo Cat",
            body: "Needs retry",
            metadata: {},
            created_at: new Date().toISOString(),
            channel_id: "channel_1",
            dm_thread_id: null,
            transport_state: "failed_remote",
            transport_error: "Matrix unavailable",
          },
        ]}
        humanLoopItems={[]}
        conversationTitle="general"
        conversationSearch=""
        onConversationSearchChange={() => {}}
        messageBody=""
        onMessageBodyChange={() => {}}
        onSendMessage={() => {}}
        onRetryMessage={onRetryMessage}
        onSelectConversation={() => {}}
        onOpenCreateChannel={() => {}}
        onOpenStartDm={() => {}}
        pendingAgent={false}
        selectedRunId=""
        openHumanRequests={{}}
        openApprovalRequests={{}}
        workflowAnswers={{}}
        onWorkflowAnswerChange={() => {}}
        onAnswerHumanRequest={() => {}}
        onResolveApproval={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry send" }));
    expect(onRetryMessage).toHaveBeenCalledWith("msg_1");
  });

  it("keeps the composer inside a bounded mobile chat pane", () => {
    const { container } = render(
      <OrbitChatPane
        session={{
          token: "session",
          user: {
            id: "user_1",
            github_login: "octocat",
            display_name: "Octo Cat",
          },
        }}
        channels={[{ id: "channel_1", slug: "general", name: "general" }]}
        directMessages={[{ id: "dm_1", title: "ERGO" }]}
        selectedConversation={{ kind: "channel", id: "channel_1" }}
        messages={[]}
        humanLoopItems={[]}
        conversationTitle="general"
        conversationSearch=""
        onConversationSearchChange={() => {}}
        messageBody=""
        onMessageBodyChange={() => {}}
        onSendMessage={() => {}}
        onRetryMessage={() => {}}
        onSelectConversation={() => {}}
        onOpenCreateChannel={() => {}}
        onOpenStartDm={() => {}}
        pendingAgent={false}
        selectedRunId=""
        openHumanRequests={{}}
        openApprovalRequests={{}}
        workflowAnswers={{}}
        onWorkflowAnswerChange={() => {}}
        onAnswerHumanRequest={() => {}}
        onResolveApproval={() => {}}
      />,
    );

    const pane = container.firstElementChild;
    const aside = container.querySelector("aside");
    const composer = screen.getByPlaceholderText("@ERGO clean up the task board and keep chat calm").closest("div.border-t");

    expect(pane).toHaveClass("h-full", "min-h-0", "overflow-hidden");
    expect(aside).toHaveClass("max-h-[min(34dvh,280px)]", "shrink-0");
    expect(composer).toHaveClass("shrink-0");
  });

  it("offers mention suggestions from the richer composer flow", () => {
    const onMessageBodyChange = vi.fn();

    render(
      <OrbitChatPane
        session={{
          token: "session",
          user: {
            id: "user_1",
            github_login: "octocat",
            display_name: "Octo Cat",
          },
        }}
        channels={[{ id: "channel_1", slug: "general", name: "general" }]}
        directMessages={[{ id: "dm_1", title: "ERGO" }]}
        selectedConversation={{ kind: "channel", id: "channel_1" }}
        messages={[]}
        humanLoopItems={[]}
        mentionOptions={[
          { id: "mention-ergo", label: "ERGO", handle: "ERGO", kind: "ergo" },
          { id: "mention-octo", label: "Octo Cat", handle: "octocat", kind: "member" },
        ]}
        conversationTitle="general"
        conversationSearch=""
        onConversationSearchChange={() => {}}
        messageBody="@er"
        onMessageBodyChange={onMessageBodyChange}
        onSendMessage={() => {}}
        onRetryMessage={() => {}}
        onSelectConversation={() => {}}
        onOpenCreateChannel={() => {}}
        onOpenStartDm={() => {}}
        pendingAgent={false}
        selectedRunId=""
        openHumanRequests={{}}
        openApprovalRequests={{}}
        workflowAnswers={{}}
        onWorkflowAnswerChange={() => {}}
        onAnswerHumanRequest={() => {}}
        onResolveApproval={() => {}}
      />,
    );

    expect(screen.getByText("Mention someone")).toBeInTheDocument();
    const ergoButtons = screen.getAllByRole("button", { name: /ERGO/i });
    fireEvent.click(ergoButtons[ergoButtons.length - 1]);
    expect(onMessageBodyChange).toHaveBeenCalledWith("@ERGO ");
  });
});
