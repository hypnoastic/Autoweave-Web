"use client";

import {
  Bell,
  ChevronLeft,
  ChevronRight,
  Home,
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
  Divider,
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
const TOPBAR_HEIGHT = 64;

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
        "group flex w-full items-center gap-3 rounded-[16px] px-3 py-3 text-left transition-[background-color,color,transform] duration-200 ease-productive hover:bg-shellMuted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focusRing focus-visible:ring-offset-0 active:scale-[0.99] motion-reduce:transform-none motion-reduce:transition-none",
        item.active ? "bg-shellMuted text-ink" : "bg-transparent text-[#a6a9b0]",
        collapsed ? "justify-center px-0" : "justify-start",
      )}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" />
      <span className={cx("truncate text-sm font-medium", collapsed ? "hidden" : "hidden lg:inline")}>{item.label}</span>
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
  const [session, setSession] = useState<Session | null>(readSession());
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
      <div className="flex min-h-dvh flex-col overflow-hidden bg-shellElevated text-ink" data-shell-root="true" data-shell-collapsed={sidebarCollapsed ? "true" : "false"}>
        <header
          className="z-30 flex h-16 shrink-0 items-center border-b border-shellLine bg-shellElevated px-3 sm:px-4"
          style={{ height: TOPBAR_HEIGHT }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-1.5 px-1 sm:gap-2">
            <IconButton
              className="h-11 w-11 shrink-0 rounded-[14px] text-[#c3c7cd] hover:bg-shellMuted hover:text-ink"
              onClick={toggleSidebar}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <PanelLeft className="h-4 w-4" />
            </IconButton>
            <IconButton className="h-11 w-11 shrink-0 rounded-[14px] text-[#c3c7cd] hover:bg-shellMuted hover:text-ink" onClick={() => window.history.back()} aria-label="Go back">
              <ChevronLeft className="h-[18px] w-[18px]" />
            </IconButton>
            <IconButton className="h-11 w-11 shrink-0 rounded-[14px] text-[#c3c7cd] hover:bg-shellMuted hover:text-ink" onClick={() => window.history.forward()} aria-label="Go forward">
              <ChevronRight className="h-[18px] w-[18px]" />
            </IconButton>
            <Divider className="mx-1 hidden h-6 w-px bg-shellLine sm:block" />
            <nav aria-label="Page context" className="min-w-0">
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
        </header>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside
            className={cx(
              "relative flex min-h-0 shrink-0 flex-col overflow-visible border-r border-shellLine bg-shellElevated transition-[width] duration-200 ease-productive motion-reduce:transition-none",
              "w-[82px]",
              sidebarCollapsed ? "lg:w-[92px]" : "lg:w-[252px]",
            )}
          >
            <div className="flex items-center justify-center px-3 py-3 lg:justify-start">
              <button
                type="button"
                onClick={() => router.push("/app")}
                aria-label="AutoWeave home"
                className={cx(
                  "flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] text-[#eef0f3] transition-[transform,background-color,color] duration-200 ease-productive hover:bg-shellMuted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focusRing focus-visible:ring-offset-0 active:scale-[0.98] motion-reduce:transform-none",
                )}
              >
                <Home className="h-5 w-5" />
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
              <div className="min-h-0 flex-1 overflow-auto">
                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    aria-label="Search"
                    title="Search"
                    onClick={openSearch}
                    className={cx(
                      "flex w-full items-center gap-3 rounded-[16px] px-3 py-3 text-left transition-[background-color,color,transform] duration-200 ease-productive hover:bg-shellMuted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focusRing focus-visible:ring-offset-0 active:scale-[0.99] motion-reduce:transform-none motion-reduce:transition-none",
                      searchOpen ? "bg-shellMuted text-ink" : "text-[#a6a9b0]",
                      sidebarCollapsed ? "justify-center px-0" : "justify-start",
                    )}
                  >
                    <Search className="h-[18px] w-[18px] shrink-0" />
                    <span className={cx("text-sm font-medium", sidebarCollapsed ? "hidden" : "hidden lg:inline")}>Search</span>
                  </button>

                  {config.items.map((item) => (
                    <ShellSidebarItem key={item.key} item={item} collapsed={sidebarCollapsed} />
                  ))}
                </div>

                {config.mode === "orbit" && config.orbitIdentity ? (
                  <div className={cx("hidden pt-4 lg:block", sidebarCollapsed && "lg:hidden")}>
                    <div className="flex items-center gap-3 rounded-[18px] bg-shellMuted px-3 py-3">
                      <AvatarMark label={config.orbitIdentity.label} src={config.orbitIdentity.logo} className="h-9 w-9 rounded-[12px]" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">{config.orbitIdentity.label}</p>
                        {config.orbitIdentity.detail ? <p className="truncate text-xs text-quiet">{config.orbitIdentity.detail}</p> : null}
                      </div>
                    </div>
                  </div>
                ) : null}

                {config.secondaryContent ? (
                  <div className={cx("hidden min-h-0 pt-4 lg:block", sidebarCollapsed && "lg:hidden")}>
                    {config.secondaryContent}
                  </div>
                ) : null}
              </div>

              <div className="relative mt-3 flex shrink-0 flex-col gap-1.5 border-t border-shellLine pt-3" ref={profileRef}>
                {config.notifications ? (
                  <button
                    type="button"
                    aria-label="Open notifications"
                    title="Open notifications"
                    onClick={openNotifications}
                    className={cx(
                      "flex w-full items-center gap-3 rounded-[16px] px-3 py-3 text-left transition-[background-color,color,transform] duration-200 ease-productive hover:bg-shellMuted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focusRing focus-visible:ring-offset-0 active:scale-[0.99] motion-reduce:transform-none motion-reduce:transition-none",
                      notificationsOpen ? "bg-shellMuted text-ink" : "text-[#a6a9b0]",
                      sidebarCollapsed ? "justify-center px-0" : "justify-start",
                    )}
                  >
                    <Bell className="h-[18px] w-[18px] shrink-0" />
                    <span className={cx("text-sm font-medium", sidebarCollapsed ? "hidden" : "hidden lg:inline")}>Notifications</span>
                  </button>
                ) : null}

                <button
                  type="button"
                  aria-label={mode === "dark" ? "Switch to light theme" : "Switch to dark theme"}
                  title={mode === "dark" ? "Switch to light theme" : "Switch to dark theme"}
                  onClick={() => void onChangeTheme(mode === "dark" ? "light" : "dark")}
                  className={cx(
                    "flex w-full items-center gap-3 rounded-[16px] px-3 py-3 text-left text-[#a6a9b0] transition-[background-color,color,transform] duration-200 ease-productive hover:bg-shellMuted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focusRing focus-visible:ring-offset-0 active:scale-[0.99] motion-reduce:transform-none motion-reduce:transition-none",
                    sidebarCollapsed ? "justify-center px-0" : "justify-start",
                  )}
                >
                  {mode === "dark" ? <Sun className="h-[18px] w-[18px] shrink-0" /> : <Moon className="h-[18px] w-[18px] shrink-0" />}
                  <span className={cx("text-sm font-medium", sidebarCollapsed ? "hidden" : "hidden lg:inline")}>Theme</span>
                </button>

                <button
                  type="button"
                  aria-label="Open profile menu"
                  title="Open profile menu"
                  onClick={() => setProfileMenuOpen((current) => !current)}
                  className={cx(
                    "flex w-full items-center gap-3 rounded-[16px] px-3 py-3 text-left transition-[background-color,color,transform] duration-200 ease-productive hover:bg-shellMuted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focusRing focus-visible:ring-offset-0 active:scale-[0.99] motion-reduce:transform-none motion-reduce:transition-none",
                    profileMenuOpen ? "bg-shellMuted text-ink" : "text-[#d5d8dc]",
                    sidebarCollapsed ? "justify-center px-0" : "justify-start",
                  )}
                >
                  {session ? (
                    <AvatarMark
                      label={session.user.display_name || session.user.github_login}
                      src={session.user.avatar_url}
                      className="h-9 w-9 rounded-[12px]"
                    />
                  ) : (
                    <User2 className="h-[18px] w-[18px] shrink-0" />
                  )}
                  <span className={cx("min-w-0 flex-1 text-sm font-medium", sidebarCollapsed ? "hidden" : "hidden lg:block")}>
                    <span className="block truncate text-ink">{session?.user.display_name || session?.user.github_login || "Profile"}</span>
                    {session ? <span className="block truncate text-xs text-quiet">{session.user.github_login}</span> : null}
                  </span>
                </button>

                <PopoverMenu
                  open={profileMenuOpen}
                  className={cx(
                    "min-w-[220px]",
                    sidebarCollapsed ? "bottom-0 left-full ml-3" : "bottom-full left-0 mb-3 w-[232px]",
                  )}
                >
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
            </div>
          </aside>

        <div className="min-w-0 flex-1 overflow-hidden bg-canvas">
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
