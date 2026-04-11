import { render, screen } from "@testing-library/react";

import { LandingPage } from "@/components/landing-page";

vi.mock("@/components/ui/webcam-pixel-grid", () => ({
  WebcamPixelGrid: ({ className }: { className?: string }) => <div data-testid="pixel-grid" className={className} />,
}));

describe("LandingPage", () => {
  it("renders the orchestration-first hero and public sections", () => {
    render(<LandingPage />);

    expect(screen.getByRole("heading", { name: "Operate software delivery with a real control plane." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Built for delivery systems that need visible governance." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "The product is organized around governed execution, not assistant theater." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Structured around rollout shape/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Bring your repos, environments, and rollout constraints/i })).toBeInTheDocument();
    expect(screen.getByTestId("pixel-grid")).toBeInTheDocument();
  });

  it("keeps public auth routes and configurable outbound links visible", () => {
    render(<LandingPage />);

    expect(screen.getAllByRole("link", { name: "Login" }).every((link) => link.getAttribute("href") === "/login")).toBe(true);
    expect(screen.getAllByRole("link", { name: "Sign up" }).every((link) => link.getAttribute("href") === "/signup")).toBe(true);
    expect(screen.getByRole("link", { name: /Create your orbit/i })).toHaveAttribute("href", "/signup");
    expect(screen.getByRole("link", { name: /founders@autoweave\.dev/i })).toHaveAttribute("href", "mailto:founders@autoweave.dev");
    expect(screen.getByRole("link", { name: /Open GitHub/i })).toHaveAttribute("href", "https://github.com");
    expect(screen.getAllByRole("link", { name: /View docs/i }).every((link) => link.getAttribute("href") === "#features")).toBe(true);
  });
});
