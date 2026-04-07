"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { AtSign, Bold, Check, Code2, Hash, Italic, MessageSquarePlus, Paperclip, Plus, Search, SendHorizonal, Users, X } from "lucide-react";

import type {
  ChannelSummary,
  ConversationMessage,
  DmThreadSummary,
  HumanLoopItem,
  Session,
  WorkflowRequest,
} from "@/lib/types";
import {
  ActionButton,
  AvatarMark,
  Divider,
  EmptyState,
  GhostButton,
  ListRow,
  ScrollPanel,
  SectionTitle,
  StatusPill,
  SurfaceCard,
  TextArea,
  TextInput,
  cx,
} from "@/components/ui";

export type ConversationSelection = {
  kind: "channel" | "dm";
  id: string;
};

type ConversationSearchResult = {
  id: string;
  author_name: string;
  body: string;
  created_at: string;
};

type MentionOption = {
  id: string;
  label: string;
  handle: string;
  avatarUrl?: string | null;
  kind?: "ergo" | "member";
};

type StagedAttachment = {
  id: string;
  name: string;
  sizeLabel: string;
};

function hashColor(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = value.charCodeAt(index) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return {
    background: `hsla(${hue}, 72%, 58%, 0.18)`,
    foreground: `hsl(${hue}, 82%, 68%)`,
  };
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 KB";
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function mentionMatch(value: string, cursor: number) {
  const beforeCursor = value.slice(0, cursor);
  const match = /(^|\s)@([a-z0-9._-]*)$/i.exec(beforeCursor);
  if (!match) {
    return null;
  }
  const query = match[2] ?? "";
  return {
    start: cursor - query.length - 1,
    end: cursor,
    query: query.toLowerCase(),
  };
}

export function OrbitChatPane({
  session,
  channels,
  directMessages,
  selectedConversation,
  messages,
  conversationSearchResults = [],
  humanLoopItems = [],
  mentionOptions = [],
  conversationLoading = false,
  conversationTitle,
  conversationSearch,
  onConversationSearchChange,
  messageBody,
  onMessageBodyChange,
  onSendMessage,
  onRetryMessage,
  humanLoopAnswers = {},
  onHumanLoopAnswerChange = () => {},
  onSubmitHumanLoopAnswer = () => {},
  onResolveApproval = () => {},
  onSelectConversation,
  onOpenCreateChannel,
  onOpenStartDm,
  pendingAgent,
  selectedRunId = "",
  openHumanRequests = {},
  openApprovalRequests = {},
  workflowAnswers = {},
  onWorkflowAnswerChange = () => {},
  onAnswerHumanRequest = () => {},
}: {
  session: Session;
  channels: ChannelSummary[];
  directMessages: DmThreadSummary[];
  selectedConversation: ConversationSelection | null;
  messages: ConversationMessage[];
  conversationSearchResults?: ConversationSearchResult[];
  humanLoopItems: HumanLoopItem[];
  mentionOptions?: MentionOption[];
  conversationLoading?: boolean;
  conversationTitle: string;
  conversationSearch: string;
  onConversationSearchChange: (value: string) => void;
  messageBody: string;
  onMessageBodyChange: (value: string) => void;
  onSendMessage: () => void;
  onRetryMessage: (messageId: string) => void;
  humanLoopAnswers: Record<string, string>;
  onHumanLoopAnswerChange: (requestId: string, value: string) => void;
  onSubmitHumanLoopAnswer: (requestId: string) => void;
  onResolveApproval: (requestId: string, approved: boolean) => void;
  onSelectConversation: (next: ConversationSelection) => void;
  onOpenCreateChannel: () => void;
  onOpenStartDm: () => void;
  pendingAgent: boolean;
  selectedRunId: string;
  openHumanRequests: Record<string, WorkflowRequest>;
  openApprovalRequests: Record<string, WorkflowRequest>;
  workflowAnswers: Record<string, string>;
  onWorkflowAnswerChange: (requestId: string, value: string) => void;
  onAnswerHumanRequest: (requestId: string) => void;
}) {
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const stickToBottomRef = useRef(true);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [stagedAttachments, setStagedAttachments] = useState<StagedAttachment[]>([]);
  const conversationKey = selectedConversation ? `${selectedConversation.kind}:${selectedConversation.id}` : "none";
  const actionableMessageIds = useMemo(() => {
    const latestByKey = new Map<string, string>();
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      const metadata = message.metadata ?? {};
      const requestId = typeof metadata.request_id === "string" ? metadata.request_id : "";
      const promptType = typeof metadata.workflow_prompt_type === "string" ? metadata.workflow_prompt_type : "";
      const promptPhase = typeof metadata.workflow_prompt_phase === "string" ? metadata.workflow_prompt_phase : "";
      const workflowRunId = typeof metadata.workflow_run_id === "string" ? metadata.workflow_run_id : "";
      if (!requestId || !promptType || promptPhase !== "open" || workflowRunId !== selectedRunId) {
        continue;
      }
      const key = `${workflowRunId}:${promptType}:${requestId}`;
      if (!latestByKey.has(key)) {
        latestByKey.set(key, message.id);
      }
    }
    return new Set(latestByKey.values());
  }, [messages, selectedRunId]);
  const timeline = useMemo(() => {
    return [...messages, ...humanLoopItems].sort((left, right) => {
      const leftDate = new Date("created_at" in left ? left.created_at : 0).getTime();
      const rightDate = new Date("created_at" in right ? right.created_at : 0).getTime();
      return leftDate - rightDate;
    });
  }, [humanLoopItems, messages]);
  const hasConversationSearch = conversationSearch.trim().length > 0;
  const mentionState = useMemo(() => mentionMatch(messageBody, composerRef.current?.selectionStart ?? messageBody.length), [messageBody]);
  const mentionSuggestions = useMemo(() => {
    if (!mentionState) {
      return [];
    }
    const seen = new Set<string>();
    return mentionOptions
      .filter((option) => {
        const key = option.handle.toLowerCase();
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        if (!mentionState.query) {
          return true;
        }
        const query = mentionState.query;
        return option.handle.toLowerCase().includes(query) || option.label.toLowerCase().includes(query);
      })
      .slice(0, 6);
  }, [mentionOptions, mentionState]);

  useEffect(() => {
    setMentionIndex(0);
  }, [messageBody, selectedConversation?.id, selectedConversation?.kind]);

  useEffect(() => {
    setStagedAttachments([]);
  }, [conversationKey]);

  function renderAuthorMark(message: ConversationMessage) {
    if (message.author_kind === "agent") {
      return (
        <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[linear-gradient(135deg,#6fd1ff_0%,#8f7bff_55%,#ff9a6a_100%)] text-[11px] font-semibold text-white shadow-[0_8px_22px_rgba(80,104,255,0.22)]">
          ER
        </div>
      );
    }
    if (message.author_kind === "system") {
      return <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-panelStrong text-[11px] font-semibold text-ink">SY</div>;
    }
    return <AvatarMark label={message.author_name} className="h-8 w-8 shrink-0 rounded-[10px]" />;
  }

  useEffect(() => {
    stickToBottomRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      const timelineElement = timelineRef.current;
      if (!timelineElement) {
        return;
      }
      timelineElement.scrollTop = timelineElement.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [conversationKey]);

  useEffect(() => {
    if (conversationLoading || !stickToBottomRef.current) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const timelineElement = timelineRef.current;
      if (!timelineElement) {
        return;
      }
      timelineElement.scrollTop = timelineElement.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [conversationKey, timeline.length, pendingAgent, conversationLoading]);

  function onTimelineScroll() {
    const timelineElement = timelineRef.current;
    if (!timelineElement) {
      return;
    }
    const distanceFromBottom = timelineElement.scrollHeight - timelineElement.scrollTop - timelineElement.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 36;
  }

  function updateComposer(nextValue: string, nextCursor?: number) {
    onMessageBodyChange(nextValue);
    window.requestAnimationFrame(() => {
      if (!composerRef.current || nextCursor == null) {
        return;
      }
      composerRef.current.focus();
      composerRef.current.setSelectionRange(nextCursor, nextCursor);
    });
  }

  function wrapComposerSelection(prefix: string, suffix = prefix, placeholder = "text") {
    const textarea = composerRef.current;
    const start = textarea?.selectionStart ?? messageBody.length;
    const end = textarea?.selectionEnd ?? messageBody.length;
    const selectedText = messageBody.slice(start, end);
    const nextSelection = selectedText || placeholder;
    const nextValue = `${messageBody.slice(0, start)}${prefix}${nextSelection}${suffix}${messageBody.slice(end)}`;
    const nextCursor = start + prefix.length + nextSelection.length + suffix.length;
    updateComposer(nextValue, nextCursor);
  }

  function insertCodeBlock() {
    const textarea = composerRef.current;
    const start = textarea?.selectionStart ?? messageBody.length;
    const end = textarea?.selectionEnd ?? messageBody.length;
    const selectedText = messageBody.slice(start, end) || "code";
    const block = `\n\`\`\`\n${selectedText}\n\`\`\`\n`;
    updateComposer(`${messageBody.slice(0, start)}${block}${messageBody.slice(end)}`, start + block.length);
  }

  function applyMention(option: MentionOption) {
    const state = mentionState;
    if (!state) {
      return;
    }
    const mentionToken = `@${option.handle} `;
    const nextValue = `${messageBody.slice(0, state.start)}${mentionToken}${messageBody.slice(state.end)}`;
    updateComposer(nextValue, state.start + mentionToken.length);
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionSuggestions.length) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionIndex((current) => (current + 1) % mentionSuggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex((current) => (current - 1 + mentionSuggestions.length) % mentionSuggestions.length);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        applyMention(mentionSuggestions[mentionIndex] || mentionSuggestions[0]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMentionIndex(0);
        return;
      }
    }
  }

  function onStageAttachments(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (!files.length) {
      return;
    }
    setStagedAttachments((current) => [
      ...current,
      ...files.map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}`,
        name: file.name,
        sizeLabel: formatBytes(file.size),
      })),
    ]);
    event.target.value = "";
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
      <aside className="flex min-h-0 max-h-[min(34dvh,280px)] w-full shrink-0 flex-col border-b border-line bg-panelMuted/25 lg:max-h-none lg:w-[252px] lg:min-w-[252px] lg:border-b-0 lg:border-r">
        <div className="border-b border-line px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-quiet">Chat</p>
          <p className="mt-1 text-sm font-semibold text-ink">Channels and DMs</p>
        </div>

        <ScrollPanel className="max-h-[240px] flex-1 px-2.5 py-3 lg:max-h-none">
          <div className="space-y-5">
            <div>
              <div className="mb-2 flex items-center justify-between px-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-quiet">Channels</p>
                <GhostButton className="h-8 px-2.5 text-xs" onClick={onOpenCreateChannel}>
                  <Plus className="h-3.5 w-3.5" />
                  New
                </GhostButton>
              </div>
              <div className="space-y-1">
                {channels.map((channel) => {
                  const active = selectedConversation?.kind === "channel" && selectedConversation.id === channel.id;
                  const channelTone = hashColor(channel.id || channel.name);
                  return (
                    <button
                      key={channel.id}
                      type="button"
                      onClick={() => onSelectConversation({ kind: "channel", id: channel.id })}
                      className={cx(
                        "flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-1.5 text-left transition-[background-color,color] duration-150 ease-productive",
                        active ? "bg-panel text-ink" : "text-quiet hover:bg-panel/75 hover:text-ink",
                      )}
                    >
                      <span
                        className="flex h-6 w-6 items-center justify-center rounded-[8px]"
                        style={{ backgroundColor: active ? "var(--aw-panel-strong)" : channelTone.background, color: channelTone.foreground }}
                      >
                        <Hash className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{channel.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <Divider />

            <div>
              <div className="mb-2 flex items-center justify-between px-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-quiet">Direct messages</p>
                <GhostButton className="h-8 px-2.5 text-xs" onClick={onOpenStartDm}>
                  <MessageSquarePlus className="h-3.5 w-3.5" />
                  Start
                </GhostButton>
              </div>
              <div className="space-y-1">
                {directMessages.map((thread) => {
                  const active = selectedConversation?.kind === "dm" && selectedConversation.id === thread.id;
                  return (
                    <button
                      key={thread.id}
                      type="button"
                      onClick={() => onSelectConversation({ kind: "dm", id: thread.id })}
                      className={cx(
                        "flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-1.5 text-left transition-[background-color,color] duration-150 ease-productive",
                        active ? "bg-panel text-ink" : "text-quiet hover:bg-panel/75 hover:text-ink",
                      )}
                    >
                      <AvatarMark label={thread.title} src={thread.participant?.avatar_url} className="h-7 w-7 rounded-[9px]" />
                      <p className="min-w-0 flex-1 truncate text-sm font-medium">{thread.title}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </ScrollPanel>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 flex flex-col gap-3 border-b border-line px-4 py-3 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {selectedConversation?.kind === "channel" ? <Hash className="h-4 w-4 text-[#5b79f7] dark:text-[#9fb3ff]" /> : <Users className="h-4 w-4 text-quiet" />}
              <h3 className="truncate text-sm font-semibold tracking-[-0.02em] text-ink">{conversationTitle}</h3>
            </div>
            <p className="mt-1 text-xs text-quiet">Chat stays calm. Workflow detail belongs on the execution board.</p>
          </div>
          <div className="relative w-full lg:max-w-[280px]">
            <TextInput
              value={conversationSearch}
              onChange={(event) => onConversationSearchChange(event.target.value)}
              placeholder="Search this conversation"
              className="pl-9"
            />
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            {hasConversationSearch ? (
              <div className="aw-motion-pop absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-[14px] border border-line bg-panelStrong shadow-soft">
                <div className="border-b border-line px-3 py-2 text-[11px] uppercase tracking-[0.14em] text-quiet">
                  Matching messages
                </div>
                <div className="max-h-[280px] overflow-auto p-2">
                  {conversationSearchResults.length ? (
                    conversationSearchResults.map((result) => (
                      <div key={result.id} className="rounded-[10px] px-2.5 py-2 hover:bg-panel">
                        <div className="flex items-center gap-2 text-[11px] text-quiet">
                          <span className="font-medium text-ink">{result.author_name}</span>
                          <span>{new Date(result.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm text-ink">{result.body}</p>
                      </div>
                    ))
                  ) : (
                    <EmptyState title="No matching messages" detail="Try a different name or phrase. The conversation stays intact while you search." />
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div ref={timelineRef} onScroll={onTimelineScroll} className="scroll-region min-h-0 flex-1 px-4 py-4 sm:px-5 sm:py-5">
          <div className="space-y-3">
            {conversationLoading && !timeline.length ? (
              <EmptyState title="Loading conversation" detail="Pulling the latest messages while keeping the shell stable." />
            ) : timeline.length ? (
              timeline.map((entry, index) => {
                if ("request_kind" in entry) {
                  const isApproval = entry.request_kind === "approval";
                  const open = ["open", "requested"].includes(entry.status);
                  const answerValue = humanLoopAnswers[entry.request_id] || "";
                  return (
                    <SurfaceCard key={entry.id} className="border-line bg-panelStrong">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-ink">{entry.title}</p>
                          <p className="mt-1 text-xs text-quiet">
                            {new Date(entry.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                        <StatusPill tone={open ? "accent" : "muted"}>
                          {entry.status.replaceAll("_", " ")}
                        </StatusPill>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-ink">{entry.detail}</p>
                      {entry.response_text ? (
                        <div className="mt-3 rounded-pane border border-line bg-panel px-3 py-2 text-xs text-quiet">
                          Response: {entry.response_text}
                        </div>
                      ) : null}
                      {open ? (
                        isApproval ? (
                          <div className="mt-4 flex flex-wrap gap-2">
                            <ActionButton onClick={() => onResolveApproval(entry.request_id, true)}>
                              <Check className="h-4 w-4" />
                              Approve
                            </ActionButton>
                            <GhostButton className="h-10 px-3" onClick={() => onResolveApproval(entry.request_id, false)}>
                              <X className="h-4 w-4" />
                              Reject
                            </GhostButton>
                          </div>
                        ) : (
                          <div className="mt-4 space-y-3">
                            <TextArea
                              value={answerValue}
                              onChange={(event) => onHumanLoopAnswerChange(entry.request_id, event.target.value)}
                              placeholder="Answer ERGO and resume the workflow"
                              className="min-h-[96px]"
                            />
                            <div className="flex justify-end">
                              <ActionButton onClick={() => onSubmitHumanLoopAnswer(entry.request_id)} disabled={!answerValue.trim()}>
                                <SendHorizonal className="h-4 w-4" />
                                Send answer
                              </ActionButton>
                            </div>
                          </div>
                        )
                      ) : null}
                    </SurfaceCard>
                  );
                }
                const message = entry;
                const isCurrentUser = message.author_kind === "user" && message.author_name === session.user.display_name;
                const metadata = message.metadata ?? {};
                const requestId = typeof metadata.request_id === "string" ? metadata.request_id : "";
                const promptType = typeof metadata.workflow_prompt_type === "string" ? metadata.workflow_prompt_type : "";
                const workflowRunId = typeof metadata.workflow_run_id === "string" ? metadata.workflow_run_id : "";
                const canAct =
                  Boolean(requestId)
                  && workflowRunId === selectedRunId
                  && actionableMessageIds.has(message.id);
                const openHumanRequest = canAct && promptType === "human_request" ? openHumanRequests[requestId] : undefined;
                const openApprovalRequest = canAct && promptType === "approval_request" ? openApprovalRequests[requestId] : undefined;
                const previousEntry = index > 0 && !("request_kind" in timeline[index - 1]) ? (timeline[index - 1] as ConversationMessage) : null;
                const groupedWithPrevious =
                  Boolean(previousEntry)
                  && previousEntry?.author_name === message.author_name
                  && previousEntry?.author_kind === message.author_kind;
                return (
                  <div key={message.id} className="flex gap-3 rounded-[14px] px-2 py-1 transition-colors duration-150 ease-productive hover:bg-panel/45">
                    <div className="w-8 shrink-0 pt-0.5">
                      {groupedWithPrevious ? <div className="h-8 w-8" /> : renderAuthorMark(message)}
                    </div>
                    <div className="min-w-0 max-w-full flex-1 sm:max-w-[760px]">
                      <div className={cx("flex items-center gap-2", groupedWithPrevious && "sr-only")}>
                        <p className="text-sm font-medium text-ink">{isCurrentUser ? "You" : message.author_name}</p>
                        <span className="text-[11px] text-faint">
                          {new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        {message.pending ? <StatusPill tone="muted">sending</StatusPill> : null}
                        {message.transport_state === "pending_remote" ? <StatusPill tone="muted">syncing</StatusPill> : null}
                        {message.transport_state === "failed_remote" ? <StatusPill tone="danger">retry needed</StatusPill> : null}
                      </div>
                      <div className={cx("mt-0.5 rounded-[10px] px-2 py-1.5 text-sm leading-6 text-ink", isCurrentUser ? "bg-panel/70" : "bg-transparent")}>
                        {message.body}
                      </div>
                      {message.transport_state === "failed_remote" ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-quiet">
                          <span>{message.transport_error || "Message did not sync to Matrix yet."}</span>
                          <GhostButton className="h-8 px-2 text-xs" onClick={() => onRetryMessage(message.id)}>
                            Retry send
                          </GhostButton>
                        </div>
                      ) : null}
                      {openHumanRequest ? (
                        <div className="mt-2 rounded-pane border border-line bg-panel px-3 py-3">
                          <p className="text-xs font-medium uppercase tracking-[0.12em] text-quiet">Human clarification</p>
                          <p className="mt-1 text-xs text-quiet">{openHumanRequest.question || "Clarification required."}</p>
                          <TextArea
                            value={workflowAnswers[openHumanRequest.id] || ""}
                            onChange={(event) => onWorkflowAnswerChange(openHumanRequest.id, event.target.value)}
                            placeholder="Share the exact direction ERGO should follow"
                            className="mt-2 min-h-[88px]"
                          />
                          <div className="mt-2 flex justify-end">
                            <ActionButton
                              className="h-9 px-3 text-xs"
                              onClick={() => onAnswerHumanRequest(openHumanRequest.id)}
                              disabled={!(workflowAnswers[openHumanRequest.id] || "").trim()}
                            >
                              Send answer
                            </ActionButton>
                          </div>
                        </div>
                      ) : null}
                      {openApprovalRequest ? (
                        <div className="mt-2 rounded-pane border border-line bg-panel px-3 py-3">
                          <p className="text-xs font-medium uppercase tracking-[0.12em] text-quiet">Approval required</p>
                          <p className="mt-1 text-xs text-quiet">{openApprovalRequest.reason || "Approve or reject this workflow step."}</p>
                          <div className="mt-2 flex items-center justify-end gap-2">
                            <GhostButton className="h-9 px-3 text-xs" onClick={() => onResolveApproval(openApprovalRequest.id, false)}>
                              Reject
                            </GhostButton>
                            <ActionButton className="h-9 px-3 text-xs" onClick={() => onResolveApproval(openApprovalRequest.id, true)}>
                              Approve
                            </ActionButton>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })
            ) : (
              <EmptyState title="No messages yet" detail="Start the conversation here. Chat stays human-facing while workflow detail stays on the board." />
            )}

            {pendingAgent ? (
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[linear-gradient(135deg,#6fd1ff_0%,#8f7bff_55%,#ff9a6a_100%)] text-[11px] font-semibold text-white shadow-[0_8px_22px_rgba(80,104,255,0.22)]">
                  ER
                </div>
                <div className="rounded-[14px] border border-line bg-panelStrong px-4 py-3 text-sm text-quiet">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-accent animate-pulse" />
                    ERGO is preparing a response…
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="shrink-0 border-t border-line bg-canvas px-4 py-3 sm:px-5">
          <div className="rounded-pane border border-line bg-panelStrong p-3">
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {[
                { label: "Bold", icon: Bold, action: () => wrapComposerSelection("**", "**", "bold") },
                { label: "Italic", icon: Italic, action: () => wrapComposerSelection("*", "*", "italic") },
                { label: "Inline code", icon: Code2, action: () => wrapComposerSelection("`", "`", "code") },
                { label: "Code block", icon: Code2, action: insertCodeBlock },
                { label: "Mention", icon: AtSign, action: () => updateComposer(`${messageBody}${messageBody.endsWith(" ") || !messageBody ? "" : " "}@`, messageBody.length + (messageBody.endsWith(" ") || !messageBody ? 1 : 2)) },
                { label: "Attach files", icon: Paperclip, action: () => attachmentInputRef.current?.click() },
              ].map(({ label, icon: Icon, action }) => (
                <button
                  key={label}
                  type="button"
                  title={label}
                  aria-label={label}
                  onClick={action}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 text-xs font-medium text-quiet transition-[background-color,border-color,color] duration-150 ease-productive hover:bg-panelMuted hover:text-ink"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
              <input ref={attachmentInputRef} type="file" multiple className="hidden" onChange={onStageAttachments} />
            </div>
            {stagedAttachments.length ? (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {stagedAttachments.map((attachment) => (
                  <div key={attachment.id} className="inline-flex items-center gap-2 rounded-full border border-line bg-panel px-2.5 py-1 text-xs text-quiet">
                    <Paperclip className="h-3.5 w-3.5" />
                    <span className="font-medium text-ink">{attachment.name}</span>
                    <span>{attachment.sizeLabel}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${attachment.name}`}
                      onClick={() => setStagedAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full text-faint hover:bg-panelMuted hover:text-ink"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="relative">
              <TextArea
                ref={composerRef}
                value={messageBody}
                onChange={(event) => onMessageBodyChange(event.target.value)}
                onKeyDown={onComposerKeyDown}
                placeholder="@ERGO clean up the task board and keep chat calm"
                className="min-h-[84px] border-0 bg-transparent px-0 py-0"
              />
              {mentionSuggestions.length ? (
                <div className="aw-motion-pop absolute bottom-[calc(100%+10px)] left-0 z-20 min-w-[260px] overflow-hidden rounded-[14px] border border-line bg-panelStrong shadow-soft">
                  <div className="border-b border-line px-3 py-2 text-[11px] uppercase tracking-[0.14em] text-quiet">Mention someone</div>
                  <div className="max-h-[240px] overflow-auto p-2">
                    {mentionSuggestions.map((option, index) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => applyMention(option)}
                        className={cx(
                          "flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left transition-[background-color,color] duration-150 ease-productive",
                          index === mentionIndex ? "bg-panel text-ink" : "text-quiet hover:bg-panel hover:text-ink",
                        )}
                      >
                        <AvatarMark label={option.label} src={option.avatarUrl} className="h-7 w-7 rounded-[9px]" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{option.label}</p>
                          <p className="mt-0.5 text-[11px] text-faint">@{option.handle}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1 text-xs text-quiet">
                <p>Your message appears immediately and syncs in the background.</p>
                {stagedAttachments.length ? <p>Attachments are staged locally while the product upload flow is being wired.</p> : null}
              </div>
              <ActionButton onClick={onSendMessage} disabled={!messageBody.trim()}>
                <SendHorizonal className="h-4 w-4" />
                Send
              </ActionButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
