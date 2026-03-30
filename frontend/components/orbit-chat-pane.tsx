"use client";

import { Hash, MessageSquarePlus, Plus, Search, SendHorizonal, Users } from "lucide-react";

import type {
  ChannelSummary,
  ConversationMessage,
  DmThreadSummary,
  Session,
} from "@/lib/types";
import {
  ActionButton,
  AvatarMark,
  Divider,
  GhostButton,
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

export function OrbitChatPane({
  session,
  channels,
  directMessages,
  selectedConversation,
  messages,
  conversationTitle,
  conversationSearch,
  onConversationSearchChange,
  messageBody,
  onMessageBodyChange,
  onSendMessage,
  onSelectConversation,
  onOpenCreateChannel,
  onOpenStartDm,
  pendingAgent,
}: {
  session: Session;
  channels: ChannelSummary[];
  directMessages: DmThreadSummary[];
  selectedConversation: ConversationSelection | null;
  messages: ConversationMessage[];
  conversationTitle: string;
  conversationSearch: string;
  onConversationSearchChange: (value: string) => void;
  messageBody: string;
  onMessageBodyChange: (value: string) => void;
  onSendMessage: () => void;
  onSelectConversation: (next: ConversationSelection) => void;
  onOpenCreateChannel: () => void;
  onOpenStartDm: () => void;
  pendingAgent: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-card border border-line bg-panel shadow-panel">
      <aside className="flex w-[280px] min-w-[280px] flex-col border-r border-line bg-panelMuted/60">
        <div className="border-b border-line px-4 py-4">
          <SectionTitle
            eyebrow="Chat"
            title="Channels and DMs"
            detail="Channels stay at the top. Direct messages live only here, at the bottom of the same sidebar."
            dense
          />
        </div>

        <ScrollPanel className="flex-1 px-3 py-3">
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
                  return (
                    <button
                      key={channel.id}
                      className={cx(
                        "flex w-full items-center gap-3 rounded-chip px-3 py-2.5 text-left text-sm transition",
                        active ? "bg-accent text-accentContrast" : "text-quiet hover:bg-panel hover:text-ink",
                      )}
                      onClick={() => onSelectConversation({ kind: "channel", id: channel.id })}
                    >
                      <Hash className="h-4 w-4" />
                      <span className="truncate">{channel.name}</span>
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
                      className={cx(
                        "flex w-full items-center gap-3 rounded-chip px-3 py-2.5 text-left text-sm transition",
                        active ? "bg-accent text-accentContrast" : "text-quiet hover:bg-panel hover:text-ink",
                      )}
                      onClick={() => onSelectConversation({ kind: "dm", id: thread.id })}
                    >
                      <AvatarMark label={thread.title} src={thread.participant?.avatar_url} className="h-7 w-7" />
                      <span className="truncate">{thread.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </ScrollPanel>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {selectedConversation?.kind === "channel" ? <Hash className="h-4 w-4 text-quiet" /> : <Users className="h-4 w-4 text-quiet" />}
              <h3 className="truncate text-sm font-semibold tracking-[-0.02em] text-ink">{conversationTitle}</h3>
            </div>
            <p className="mt-1 text-xs text-quiet">Chat stays calm. Workflow detail belongs on the execution board, not in the channel.</p>
          </div>
          <div className="w-full max-w-[260px]">
            <TextInput
              value={conversationSearch}
              onChange={(event) => onConversationSearchChange(event.target.value)}
              placeholder="Search this conversation"
              className="pl-9"
            />
            <Search className="pointer-events-none relative -mt-8 ml-3 h-4 w-4 text-faint" />
          </div>
        </div>

        <ScrollPanel className="flex-1 px-5 py-5">
          <div className="space-y-4">
            {messages.length ? (
              messages.map((message) => {
                const isCurrentUser = message.author_kind === "user" && message.author_name === session.user.display_name;
                return (
                  <div key={message.id} className={cx("flex gap-3", isCurrentUser && "justify-end")}>
                    {!isCurrentUser ? <AvatarMark label={message.author_name} className="h-8 w-8 shrink-0" /> : null}
                    <div className={cx("max-w-[680px] min-w-0", isCurrentUser && "items-end")}>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-ink">{message.author_name}</p>
                        <span className="text-[11px] text-faint">
                          {new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        {message.pending ? <StatusPill tone="muted">sending</StatusPill> : null}
                      </div>
                      <div className={cx("mt-1 rounded-pane border border-line bg-panelMuted px-4 py-3 text-sm leading-6 text-ink", isCurrentUser && "bg-panelStrong")}>
                        {message.body}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <SurfaceCard className="border-dashed bg-panel">
                <p className="text-sm text-quiet">No messages in this conversation yet.</p>
              </SurfaceCard>
            )}

            {pendingAgent ? (
              <div className="flex gap-3">
                <AvatarMark label="ERGO" className="h-8 w-8 shrink-0" />
                <div className="rounded-pane border border-line bg-panelStrong px-4 py-3 text-sm text-quiet">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-accent animate-pulse" />
                    ERGO is working. Follow the execution board for detailed progress.
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </ScrollPanel>

        <div className="border-t border-line px-5 py-4">
          <div className="rounded-pane border border-line bg-panelStrong p-3">
            <TextArea
              value={messageBody}
              onChange={(event) => onMessageBodyChange(event.target.value)}
              placeholder="@ERGO clean up the task board and keep chat calm"
              className="min-h-[120px] border-0 bg-transparent px-0 py-0"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs text-quiet">Your message appears immediately. ERGO replies here only when humans need to see it.</p>
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
