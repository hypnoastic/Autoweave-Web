"use client";

import { InboxScreen } from "@/components/inbox-screen";
import type { ChatSourceKind } from "@/lib/chat-links";

export function ChatScreen({
  contextOrbitId,
  contextIssueId,
  contextSourceKind,
}: {
  contextOrbitId?: string;
  contextIssueId?: string;
  contextSourceKind?: ChatSourceKind;
}) {
  return (
    <InboxScreen
      mode="chat"
      contextOrbitId={contextOrbitId}
      contextIssueId={contextIssueId}
      contextSourceKind={contextSourceKind}
    />
  );
}
