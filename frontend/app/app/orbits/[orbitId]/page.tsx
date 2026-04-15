import { parseOrbitRouteContext } from "@/lib/orbit-links";
import { OrbitWorkspace } from "@/components/orbit-workspace";

export default async function OrbitPage({
  params,
  searchParams,
}: {
  params: Promise<{ orbitId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { orbitId } = await params;
  const resolvedSearchParams = await searchParams;
  const routeContext = parseOrbitRouteContext({
    get(name: string) {
      const value = resolvedSearchParams[name];
      return typeof value === "string" ? value : null;
    },
  });

  return (
    <OrbitWorkspace
      orbitId={orbitId}
      initialSection={routeContext.section ?? undefined}
      initialDetailKind={routeContext.detailKind ?? undefined}
      initialDetailId={routeContext.detailId ?? undefined}
      initialWorkflowRunId={routeContext.workflowRunId ?? undefined}
    />
  );
}
