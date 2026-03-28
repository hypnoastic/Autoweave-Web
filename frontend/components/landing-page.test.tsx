import { fireEvent, render, screen } from "@testing-library/react";

import { LandingPage } from "@/components/landing-page";

vi.mock("@/lib/api", () => ({
  getGitHubLoginUrl: vi.fn().mockResolvedValue({ configured: false, url: null }),
  loginWithToken: vi.fn(),
  writeSession: vi.fn(),
}));

describe("LandingPage", () => {
  it("renders the GitHub token login shell", () => {
    render(<LandingPage />);

    expect(screen.getByText("ERGO-powered collaborative engineering")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("ghp_...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start with GitHub" })).toBeDisabled();
  });

  it("enables the token action when a token is entered", () => {
    render(<LandingPage />);

    fireEvent.change(screen.getByPlaceholderText("ghp_..."), { target: { value: "ghp_example_token" } });

    expect(screen.getByRole("button", { name: "Start with GitHub" })).toBeEnabled();
  });
});
