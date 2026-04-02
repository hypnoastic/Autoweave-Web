import { fireEvent, render, screen } from "@testing-library/react";

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

vi.mock("@/lib/api", () => api);
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

describe("DashboardScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    render(
      <ThemeProvider>
        <DashboardScreen />
      </ThemeProvider>,
    );

    expect(await screen.findByText("Workspace OS")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Profile" })).toBeInTheDocument();
    expect(screen.getByText("Orbit Alpha")).toBeInTheDocument();
    expect(screen.getByText("octocat/orbit-alpha")).toBeInTheDocument();
  });

  it("closes search before opening notifications from the rail", async () => {
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

    render(
      <ThemeProvider>
        <DashboardScreen />
      </ThemeProvider>,
    );

    expect(await screen.findByText("Workspace OS")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByRole("dialog", { name: "Search orbits" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(await screen.findByRole("dialog", { name: "Notifications" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Search orbits" })).not.toBeInTheDocument();
  });
});
