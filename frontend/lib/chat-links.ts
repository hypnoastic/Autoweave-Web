export type ChatSourceKind = "native_issue" | "issue" | "pr";

type SearchParamReader = {
  get(name: string): string | null;
};

export type ChatRouteContext = {
  orbitId: string | null;
  issueId: string | null;
  sourceKind: ChatSourceKind | null;
};

const CHAT_SOURCE_KINDS = new Set<ChatSourceKind>(["native_issue", "issue", "pr"]);

export function buildChatHref({
  orbitId,
  issueId,
  sourceKind,
}: {
  orbitId?: string | null;
  issueId?: string | null;
  sourceKind?: ChatSourceKind | null;
}) {
  if (!orbitId) {
    return "/app/chat";
  }
  const params = new URLSearchParams();
  params.set("orbitId", orbitId);
  if (issueId) {
    params.set("issueId", issueId);
  }
  if (issueId && sourceKind) {
    params.set("sourceKind", sourceKind);
  }
  return `/app/chat?${params.toString()}`;
}

export function parseChatRouteContext(searchParams: SearchParamReader | null | undefined): ChatRouteContext {
  const orbitId = searchParams?.get("orbitId")?.trim() || null;
  const issueId = orbitId ? searchParams?.get("issueId")?.trim() || null : null;
  const rawSourceKind = issueId ? searchParams?.get("sourceKind")?.trim() || null : null;
  const sourceKind = rawSourceKind && CHAT_SOURCE_KINDS.has(rawSourceKind as ChatSourceKind) ? (rawSourceKind as ChatSourceKind) : null;
  return {
    orbitId,
    issueId,
    sourceKind,
  };
}
