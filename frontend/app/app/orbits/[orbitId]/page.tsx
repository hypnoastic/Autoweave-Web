import { OrbitWorkspace } from "@/components/orbit-workspace";

export default async function OrbitPage({
  params,
}: {
  params: Promise<{ orbitId: string }>;
}) {
  const { orbitId } = await params;
  return <OrbitWorkspace orbitId={orbitId} />;
}
