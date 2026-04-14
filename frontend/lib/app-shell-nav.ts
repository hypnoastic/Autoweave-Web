import {
  CalendarRange,
  FolderOpen,
  Inbox,
  LayoutGrid,
  ListFilter,
  MessageSquare,
  Plus,
  type LucideIcon,
} from "lucide-react";

import type { AppShellNavItem } from "@/components/authenticated-shell";

type RouterLike = {
  push: (href: string) => void;
};

type WorkspaceNavKey = "my-work" | "inbox" | "orbits" | "cycles" | "views" | "chat";

const WORKSPACE_NAV: Array<{
  key: WorkspaceNavKey;
  label: string;
  href: string;
  icon: LucideIcon;
}> = [
  { key: "my-work", label: "My Work", href: "/app/my-work", icon: LayoutGrid },
  { key: "inbox", label: "Inbox", href: "/app/inbox", icon: Inbox },
  { key: "orbits", label: "Orbits", href: "/app/orbits", icon: FolderOpen },
  { key: "cycles", label: "Cycles", href: "/app/cycles", icon: CalendarRange },
  { key: "views", label: "Views", href: "/app/views", icon: ListFilter },
  { key: "chat", label: "Chat", href: "/app/chat", icon: MessageSquare },
];

export function buildPrimaryShellItems(
  router: RouterLike,
  activeKey: WorkspaceNavKey,
  options?: {
    onCreateOrbit?: () => void;
    extras?: AppShellNavItem[];
    excludeKeys?: WorkspaceNavKey[];
  },
): AppShellNavItem[] {
  const excluded = new Set(options?.excludeKeys ?? []);
  const items: AppShellNavItem[] = WORKSPACE_NAV.filter((item) => !excluded.has(item.key)).map((item) => ({
    key: item.key,
    label: item.label,
    icon: item.icon,
    active: item.key === activeKey,
    onSelect: () => router.push(item.href),
  }));

  if (options?.onCreateOrbit) {
    items.push({
      key: "new-orbit",
      label: "New orbit",
      icon: Plus,
      active: false,
      onSelect: options.onCreateOrbit,
    });
  }

  if (options?.extras?.length) {
    items.push(...options.extras);
  }

  return items;
}
