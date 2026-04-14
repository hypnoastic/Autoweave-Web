import type { ChatSourceKind } from "@/lib/chat-links";

export type OrbitSectionKind = "issues" | "prs" | "workflow" | "codespaces" | "demos" | "chat";
export type OrbitDetailKind = ChatSourceKind;

type SearchParamReader = {
  get(name: string): string | null;
};

const ORBIT_SECTIONS = new Set<OrbitSectionKind>(["issues", "prs", "workflow", "codespaces", "demos", "chat"]);
const ORBIT_DETAIL_KINDS = new Set<OrbitDetailKind>(["native_issue", "issue", "pr"]);

export function buildOrbitWorkHref({
  orbitId,
  section,
  detailKind,
  detailId,
}: {
  orbitId: string;
  section?: OrbitSectionKind | null;
  detailKind?: OrbitDetailKind | null;
  detailId?: string | null;
}) {
  const params = new URLSearchParams();
  if (section) {
    params.set("section", section);
  }
  if (detailKind && detailId) {
    params.set("detailKind", detailKind);
    params.set("detailId", detailId);
  }
  const query = params.toString();
  return query ? `/app/orbits/${orbitId}?${query}` : `/app/orbits/${orbitId}`;
}

export function parseOrbitRouteContext(searchParams: SearchParamReader | null | undefined): {
  section: OrbitSectionKind | null;
  detailKind: OrbitDetailKind | null;
  detailId: string | null;
} {
  const rawSection = searchParams?.get("section")?.trim() || null;
  const rawDetailKind = searchParams?.get("detailKind")?.trim() || null;
  const detailId = searchParams?.get("detailId")?.trim() || null;

  return {
    section: rawSection && ORBIT_SECTIONS.has(rawSection as OrbitSectionKind) ? (rawSection as OrbitSectionKind) : null,
    detailKind:
      rawDetailKind && detailId && ORBIT_DETAIL_KINDS.has(rawDetailKind as OrbitDetailKind)
        ? (rawDetailKind as OrbitDetailKind)
        : null,
    detailId: detailId && rawDetailKind ? detailId : null,
  };
}
