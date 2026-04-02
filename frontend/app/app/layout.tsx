import { AuthenticatedAppShell } from "@/components/authenticated-shell";

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return <AuthenticatedAppShell>{children}</AuthenticatedAppShell>;
}
