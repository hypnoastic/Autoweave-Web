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
});
