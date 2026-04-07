"use client";

import {
  Bell,
  ChevronLeft,
  ChevronRight,
  Moon,
  PanelLeft,
  Search,
  Settings2,
  Sun,
  User2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useTheme } from "@/components/theme-provider";
import {
  AvatarMark,
  CenteredModal,
  GhostButton,
  IconButton,
  MenuItem,
  PageLoader,
  PopoverMenu,
  SelectionChip,
  SectionTitle,
  cx,
} from "@/components/ui";
import { AuthSessionError, readSession, updatePreferences, writeSession } from "@/lib/api";
import type { Session, ThemeMode } from "@/lib/types";

const SIDEBAR_STATE_KEY = "autoweave-shell-sidebar-collapsed";
const TOPBAR_HEIGHT = 48;
const COLLAPSED_SIDEBAR_WIDTH = 48;
const EXPANDED_SIDEBAR_WIDTH = 184;

type ShellPanelConfig = {
  title: string;
  description?: string;
  content: ReactNode;
  panelClassName?: string;
  bodyClassName?: string;
};

export type AppShellNavItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  active?: boolean;
  onSelect: () => void;
};

export type AppShellConfig = {
  mode: "dashboard" | "orbit";
  breadcrumb: string[];
  backAction?: () => void;
  forwardAction?: () => void;
  orbitIdentity?: {
    label: string;
    logo?: string | null;
    detail?: string;
  };
  items: AppShellNavItem[];
  secondaryContent?: ReactNode;
  search?: ShellPanelConfig;
  notifications?: ShellPanelConfig;
};

type AppShellContextValue = {
  config: AppShellConfig;
  setConfig: (config: AppShellConfig) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  searchOpen: boolean;
  openSearch: () => void;
  closeSearch: () => void;
  notificationsOpen: boolean;
  openNotifications: () => void;
  closeNotifications: () => void;
};

const DEFAULT_CONFIG: AppShellConfig = {
  mode: "dashboard",
  breadcrumb: ["Dashboard"],
  items: [],
};

const AppShellContext = createContext<AppShellContextValue | null>(null);

function useOutsideClose<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function handlePointer(event: MouseEvent) {
      if (!ref.current || ref.current.contains(event.target as Node)) {
        return;
      }
      onClose();
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, onClose]);

  return ref;
}

function usePersistentSidebarState() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (typeof window.localStorage?.getItem !== "function") {
      return;
    }
    const raw = window.localStorage.getItem(SIDEBAR_STATE_KEY);
    setCollapsed(raw === "true");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (typeof window.localStorage?.setItem !== "function") {
      return;
    }
    window.localStorage.setItem(SIDEBAR_STATE_KEY, collapsed ? "true" : "false");
  }, [collapsed]);

  return [collapsed, setCollapsed] as const;
}

export function useAuthenticatedShell() {
  const context = useContext(AppShellContext);
  if (!context) {
    throw new Error("useAuthenticatedShell must be used within AuthenticatedAppShell");
  }
  return context;
}

export function useAuthenticatedShellConfig(config: AppShellConfig) {
  const { setConfig } = useAuthenticatedShell();

  useLayoutEffect(() => {
    setConfig(config);
  }, [config, setConfig]);
}

function ShellSidebarItem({
  item,
  collapsed,
}: {
  item: AppShellNavItem;
  collapsed: boolean;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      aria-label={item.label}
      title={item.label}
      onClick={item.onSelect}
      className={cx(
        "group flex min-h-[36px] w-full items-center gap-2 overflow-hidden rounded-[10px] py-1.5 text-left transition-[background-color,color,transform] duration-200 ease-productive hover:bg-shellMuted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focusRing focus-visible:ring-offset-0 active:scale-[0.99] motion-reduce:transform-none motion-reduce:transition-none",
        collapsed ? "justify-center px-0" : "justify-start px-2.5",
        item.active ? "bg-shellMuted text-ink" : "bg-transparent text-[#a6a9b0]",
      )}
    >
      <span className="flex h-[17px] w-[17px] shrink-0 items-center justify-center">
        <Icon className="h-[17px] w-[17px]" />
      </span>
      <span
        className={cx(
          "min-w-0 overflow-hidden whitespace-nowrap text-[13px] font-medium transition-[max-width,opacity] duration-200 ease-productive motion-reduce:transition-none",
          collapsed ? "max-w-0 opacity-0 lg:max-w-0" : "max-w-[138px] opacity-100",
        )}
      >
        {item.label}
      </span>
    </button>
  );
}

function AppShellFrame({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { mode, setMode } = useTheme();
  const [config, setConfig] = useState<AppShellConfig>(DEFAULT_CONFIG);
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistentSidebarState();
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const profileRef = useOutsideClose<HTMLDivElement>(profileMenuOpen, () => setProfileMenuOpen(false));

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((current) => !current);
  }, [setSidebarCollapsed]);

  const openSearch = useCallback(() => {
    setNotificationsOpen(false);
    setSearchOpen(true);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
  }, []);

  const openNotifications = useCallback(() => {
    setSearchOpen(false);
    setNotificationsOpen(true);
  }, []);

  const closeNotifications = useCallback(() => {
    setNotificationsOpen(false);
  }, []);

  useEffect(() => {
    setSession(readSession());
  }, [pathname]);

  useEffect(() => {
    setSearchOpen(false);
    setNotificationsOpen(false);
    setProfileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") {
        return;
      }
      if (!config.search) {
        return;
      }
      event.preventDefault();
      setNotificationsOpen(false);
      setSearchOpen(true);
    }

    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, [config.search]);

  const contextValue = useMemo<AppShellContextValue>(
    () => ({
      config,
      setConfig,
      sidebarCollapsed,
      toggleSidebar,
      searchOpen,
      openSearch,
      closeSearch,
      notificationsOpen,
      openNotifications,
      closeNotifications,
    }),
    [closeNotifications, closeSearch, config, notificationsOpen, openNotifications, openSearch, searchOpen, sidebarCollapsed, toggleSidebar],
  );

  const breadcrumb = config.breadcrumb.length ? config.breadcrumb : [config.mode === "orbit" ? "Orbit" : "Dashboard"];
  const orbitSettingsItem = config.mode === "orbit" ? config.items.find((item) => item.key === "settings") ?? null : null;
  const sidebarItems = orbitSettingsItem ? config.items.filter((item) => item.key !== orbitSettingsItem.key) : config.items;

  async function onChangeTheme(nextMode: ThemeMode) {
    setMode(nextMode);
    const nextSession = readSession();
    setSession(nextSession);
    if (!nextSession) {
      return;
    }
    try {
      await updatePreferences(nextSession.token, { theme_preference: nextMode });
    } catch (error) {
      if (error instanceof AuthSessionError) {
        writeSession(null);
        setSession(null);
        router.replace("/");
      }
    }
  }

  function signOut() {
    writeSession(null);
    setSession(null);
    router.replace("/");
  }

  return (
    <AppShellContext.Provider value={contextValue}>
      <div className="flex min-h-dvh flex-col overflow-hidden bg-shell text-ink" data-shell-root="true" data-shell-collapsed={sidebarCollapsed ? "true" : "false"}>
        <header
          className="z-30 flex shrink-0 items-center bg-shell px-1.5"
          style={{ height: TOPBAR_HEIGHT }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-0.5">
            <IconButton
              className="h-8 w-8 shrink-0 rounded-[10px] text-[#bcc0c6] hover:bg-shellMuted hover:text-ink"
              onClick={toggleSidebar}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <PanelLeft className="h-4 w-4" />
            </IconButton>
            <IconButton
              className="h-8 w-8 shrink-0 rounded-[10px] text-[#bcc0c6] hover:bg-shellMuted hover:text-ink"
              onClick={() => (config.backAction ? config.backAction() : router.back())}
              aria-label="Go back"
            >
              <ChevronLeft className="h-4 w-4" />
            </IconButton>
            <IconButton
              className="h-8 w-8 shrink-0 rounded-[10px] text-[#bcc0c6] hover:bg-shellMuted hover:text-ink"
              onClick={() => (config.forwardAction ? config.forwardAction() : router.forward())}
              aria-label="Go forward"
            >
              <ChevronRight className="h-4 w-4" />
            </IconButton>
            <nav aria-label="Page context" className="min-w-0 pl-1">
              <ol className="flex min-w-0 items-center gap-1.5 text-sm">
                {breadcrumb.map((segment, index) => (
                  <li key={`${segment}-${index}`} className="flex min-w-0 items-center gap-1.5">
                    {index > 0 ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-faint" /> : null}
                    <span className={cx("truncate", index === breadcrumb.length - 1 ? "font-medium text-ink" : "text-quiet")}>
                      {segment}
                    </span>
                  </li>
                ))}
              </ol>
            </nav>
          </div>
          {config.search ? (
            <div className="mx-3 hidden min-w-0 flex-1 justify-center md:flex">
              <button
                type="button"
                onClick={openSearch}
                aria-label="Search"
                className="flex h-8 w-full max-w-[360px] items-center gap-2 rounded-[10px] border border-shellLine bg-shellElevated px-3 text-left text-sm text-[#a8adb4] transition-[background-color,border-color,color] duration-200 ease-productive hover:border-shellLineStrong hover:bg-shellMuted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focusRing focus-visible:ring-offset-0"
              >
                <Search className="h-4 w-4 shrink-0" />
                <span className="truncate">{config.search.title}</span>
                <span className="ml-auto text-[11px] uppercase tracking-[0.14em] text-faint">⌘K</span>
              </button>
            </div>
          ) : (
            <div className="hidden flex-1 md:block" />
          )}
          <div className="flex shrink-0 items-center gap-0.5" ref={profileRef}>
            {config.notifications ? (
              <IconButton
                className="h-8 w-8 shrink-0 rounded-[10px] text-[#bcc0c6] hover:bg-shellMuted hover:text-ink"
                onClick={openNotifications}
                aria-label="Open notifications"
              >
                <Bell className="h-4 w-4" />
              </IconButton>
            ) : null}
            <IconButton
              className="h-8 w-8 shrink-0 rounded-[10px] text-[#bcc0c6] hover:bg-shellMuted hover:text-ink"
              onClick={() => setSettingsOpen(true)}
              aria-label="Open global settings"
            >
              <Settings2 className="h-4 w-4" />
            </IconButton>
            <button
              type="button"
              aria-label="Open profile menu"
              title="Open profile menu"
              onClick={() => setProfileMenuOpen((current) => !current)}
              className={cx(
                "flex h-8 min-w-0 shrink-0 items-center gap-2 rounded-[10px] px-1 text-left transition-[background-color,color,transform] duration-200 ease-productive hover:bg-shellMuted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focusRing focus-visible:ring-offset-0 active:scale-[0.99] motion-reduce:transform-none motion-reduce:transition-none",
                profileMenuOpen ? "bg-shellMuted text-ink" : "text-[#aeb2b8]",
              )}
            >
              {session ? (
                <AvatarMark
                  label={session.user.display_name || session.user.github_login}
                  src={session.user.avatar_url}
                  className="h-6 w-6 rounded-[9px] brightness-90 saturate-[0.72]"
                />
              ) : (
                <span className="flex h-6 w-6 items-center justify-center rounded-[9px] bg-shellMuted text-[#b4b8be]">
                  <User2 className="h-[14px] w-[14px]" />
                </span>
              )}
            </button>

            <PopoverMenu open={profileMenuOpen} className="right-0 top-full mt-2 min-w-[220px]">
              {session ? (
                <div className="px-3 py-2">
                  <p className="text-sm font-semibold text-ink">{session.user.display_name}</p>
                  <p className="text-xs text-quiet">{session.user.github_login}</p>
                </div>
              ) : null}
              <MenuItem
                onClick={() => {
                  setProfileMenuOpen(false);
                  setSettingsOpen(true);
                }}
              >
                <Settings2 className="h-4 w-4" />
                Global settings
              </MenuItem>
              <MenuItem onClick={signOut}>
                <User2 className="h-4 w-4" />
                Sign out
              </MenuItem>
            </PopoverMenu>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside
            className={cx(
              "relative flex min-h-0 shrink-0 flex-col overflow-visible bg-shell transition-[width] duration-200 ease-productive motion-reduce:transition-none",
              sidebarCollapsed ? "w-12 lg:w-12" : "w-12 lg:w-[184px]",
            )}
          >
            <div className="flex min-h-0 flex-1 flex-col px-1 pb-2 pt-2">
              <div className="min-h-0 flex-1 overflow-auto">
                <div className="flex flex-col gap-1.5">
                  {sidebarItems.map((item) => (
                    <ShellSidebarItem key={item.key} item={item} collapsed={sidebarCollapsed} />
                  ))}
                </div>

                {config.secondaryContent ? (
                  <div className="min-h-0 pt-4">
                    {config.secondaryContent}
                  </div>
                ) : null}
              </div>

              {orbitSettingsItem ? (
                <div className="mt-2.5 flex shrink-0 flex-col gap-1.5 pt-2.5">
                  <ShellSidebarItem item={orbitSettingsItem} collapsed={sidebarCollapsed} />
                </div>
              ) : null}
            </div>
          </aside>

        <div className="min-w-0 flex-1 overflow-hidden rounded-tl-[24px] bg-canvas shadow-[-1px_0_0_var(--aw-shell-seam),0_-1px_0_var(--aw-shell-seam)]">
          <div key={pathname} className="aw-motion-fade flex h-full min-h-0 flex-1 flex-col overflow-hidden">
            {children}
          </div>
        </div>
      </div>

        <CenteredModal
          open={searchOpen && Boolean(config.search)}
          onClose={() => setSearchOpen(false)}
          title={config.search?.title || "Search"}
          description={config.search?.description}
          panelClassName="max-w-[760px] border-shellLine bg-shellElevated"
          bodyClassName="pt-4"
          footer={
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-quiet">Cmd/Ctrl+K opens this search surface.</p>
              <GhostButton onClick={() => setSearchOpen(false)}>Close</GhostButton>
            </div>
          }
        >
          {config.search?.content || <PageLoader label="Loading search…" fullscreen={false} />}
        </CenteredModal>

        <CenteredModal
          open={notificationsOpen && Boolean(config.notifications)}
          onClose={() => setNotificationsOpen(false)}
          title={config.notifications?.title || "Notifications"}
          description={config.notifications?.description}
          panelClassName="max-w-[720px] border-shellLine bg-shellElevated"
          bodyClassName="pt-4"
          footer={
            <div className="flex items-center justify-end gap-3">
              <GhostButton onClick={() => setNotificationsOpen(false)}>Close</GhostButton>
            </div>
          }
        >
          {config.notifications?.content || <PageLoader label="Loading notifications…" fullscreen={false} />}
        </CenteredModal>

        <CenteredModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          title="Global settings"
          description="Quiet preferences that shape the product chrome without clutter."
          footer={
            <div className="flex items-center justify-end gap-3">
              <GhostButton onClick={() => setSettingsOpen(false)}>Close</GhostButton>
            </div>
          }
        >
          <div className="space-y-5">
            <div className="rounded-pane border border-line bg-panelStrong p-4">
              <SectionTitle eyebrow="Appearance" title="Theme" detail="Keep the shell and product surfaces consistent across routes." dense />
              <div className="mt-4 flex flex-wrap gap-2">
                {[
                  { value: "system", label: "System", icon: Settings2 },
                  { value: "light", label: "Light", icon: Sun },
                  { value: "dark", label: "Dark", icon: Moon },
                ].map(({ value, label, icon: Icon }) => (
                  <SelectionChip
                    key={value}
                    active={mode === value}
                    className="px-3 py-2 text-sm"
                    onClick={() => void onChangeTheme(value as ThemeMode)}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </SelectionChip>
                ))}
              </div>
            </div>

            {session ? (
              <div className="rounded-pane border border-line bg-panelStrong p-4">
                <SectionTitle eyebrow="Identity" title={session.user.display_name} detail={session.user.github_login} dense />
                <p className="mt-3 text-sm text-quiet">GitHub remains the source of truth for identity in this product.</p>
              </div>
            ) : null}
          </div>
        </CenteredModal>
      </div>
    </AppShellContext.Provider>
  );
}

export function AuthenticatedAppShell({ children }: { children: ReactNode }) {
  return <AppShellFrame>{children}</AppShellFrame>;
}
