import { fireEvent, render, screen } from "@testing-library/react";

import { AuthenticatedAppShell } from "@/components/authenticated-shell";
import { DashboardScreen } from "@/components/dashboard";
import { ThemeProvider } from "@/components/theme-provider";

const api = vi.hoisted(() => ({
  createOrbit: vi.fn(),
  fetchDashboard: vi.fn(),
  fetchOrbits: vi.fn(),
  fetchPreferences: vi.fn(),
  readSession: vi.fn(),
  updatePreferences: vi.fn(),
  writeSession: vi.fn(),
}));
const mockRouter = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));

let mockPathname = "/app";

vi.mock("@/lib/api", () => api);
vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  usePathname: () => mockPathname,
}));

function renderDashboard() {
  mockPathname = "/app";
  return render(
    <ThemeProvider>
      <AuthenticatedAppShell>
        <DashboardScreen />
      </AuthenticatedAppShell>
    </ThemeProvider>,
  );
}

describe("DashboardScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.removeItem?.("autoweave-shell-sidebar-collapsed");
    mockPathname = "/app";
  });

  it("renders the unified dashboard rail and context sidebar", async () => {
    api.readSession.mockReturnValue({
      token: "session-token",
      user: {
        id: "user_1",
        github_login: "octocat",
        display_name: "Octo Cat",
      },
    });
    api.fetchPreferences.mockResolvedValue({ theme_preference: "system" });
    api.fetchDashboard.mockResolvedValue({
      me: { display_name: "Octo Cat", github_login: "octocat" },
      recent_orbits: [
        {
          id: "orbit_1",
          name: "Orbit Alpha",
          description: "Alpha orbit",
          logo: null,
          repo_full_name: "octocat/orbit-alpha",
        },
      ],
      priority_items: [],
      notifications: [],
      codespaces: [],
    });
    api.fetchOrbits.mockResolvedValue([
      {
        id: "orbit_1",
        name: "Orbit Alpha",
        description: "Alpha orbit",
        logo: null,
        repo_full_name: "octocat/orbit-alpha",
      },
    ]);

    renderDashboard();

    expect(await screen.findByText("Everything important, nothing noisy.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open notifications" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open profile menu" })).toBeInTheDocument();
    expect(screen.getByText("Orbit Alpha")).toBeInTheDocument();
    expect(screen.getByText("octocat/orbit-alpha")).toBeInTheDocument();
  });

  it("closes search before opening notifications from the persistent shell", async () => {
    api.readSession.mockReturnValue({
      token: "session-token",
      user: {
        id: "user_1",
        github_login: "octocat",
        display_name: "Octo Cat",
      },
    });
    api.fetchPreferences.mockResolvedValue({ theme_preference: "system" });
    api.fetchDashboard.mockResolvedValue({
      me: { display_name: "Octo Cat", github_login: "octocat" },
      recent_orbits: [
        {
          id: "orbit_1",
          name: "Orbit Alpha",
          description: "Alpha orbit",
          logo: null,
          repo_full_name: "octocat/orbit-alpha",
        },
      ],
      priority_items: [],
      notifications: [{ kind: "mention", label: "Mentioned in #general", detail: "mention" }],
      codespaces: [],
    });
    api.fetchOrbits.mockResolvedValue([
      {
        id: "orbit_1",
        name: "Orbit Alpha",
        description: "Alpha orbit",
        logo: null,
        repo_full_name: "octocat/orbit-alpha",
      },
    ]);

    renderDashboard();

    expect(await screen.findByText("Everything important, nothing noisy.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByRole("dialog", { name: "Search orbits" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open notifications" }));
    expect(await screen.findByRole("dialog", { name: "Notifications" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Search orbits" })).not.toBeInTheDocument();
  });
});
