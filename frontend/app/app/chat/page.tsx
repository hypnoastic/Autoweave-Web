import { parseChatRouteContext } from "@/lib/chat-links";
import { ChatScreen } from "@/components/chat-screen";

export default async function AppChatPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const searchParamReader = {
    get(name: string) {
      const value = resolvedSearchParams[name];
      return typeof value === "string" ? value : null;
    },
  };
  const context = parseChatRouteContext(searchParamReader);

  return (
    <ChatScreen
      contextOrbitId={context.orbitId ?? undefined}
      contextIssueId={context.issueId ?? undefined}
      contextSourceKind={context.sourceKind ?? undefined}
    />
  );
}
