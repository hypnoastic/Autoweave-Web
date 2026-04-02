import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CenteredModal, LeftSlidePanel, ListRow, PopoverMenu, SelectionChip } from "@/components/ui";

describe("shared ui overlays", () => {
  it("unmounts closed overlays", () => {
    const { rerender } = render(
      <>
        <CenteredModal open={false} onClose={() => {}} title="Test modal">
          <button type="button">Primary action</button>
        </CenteredModal>
        <LeftSlidePanel open={false} onClose={() => {}} title="Search">
          panel content
        </LeftSlidePanel>
        <PopoverMenu open={false}>menu content</PopoverMenu>
      </>,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    rerender(
      <>
        <CenteredModal open onClose={() => {}} title="Test modal">
          <button type="button">Primary action</button>
        </CenteredModal>
        <LeftSlidePanel open onClose={() => {}} title="Search">
          panel content
        </LeftSlidePanel>
        <PopoverMenu open>menu content</PopoverMenu>
      </>,
    );

    expect(screen.getAllByRole("dialog")).toHaveLength(2);
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("closes the modal on escape and backdrop click", async () => {
    const onClose = vi.fn();

    render(
      <CenteredModal open onClose={onClose} title="Create orbit">
        <button type="button">Confirm</button>
      </CenteredModal>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Close" })).toHaveFocus());

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText("Close overlay"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("keeps the rail exposed when a left panel uses an offset", () => {
    render(
      <LeftSlidePanel open onClose={() => {}} offset={88} title="Search">
        panel content
      </LeftSlidePanel>,
    );

    expect(screen.getByLabelText("Close overlay")).toHaveStyle({ left: "88px" });
  });
});

describe("shared ui rows", () => {
  it("renders active list rows and selection chips with supporting content", () => {
    const onClick = vi.fn();

    render(
      <>
        <ListRow
          title="Orbit Alpha"
          eyebrow="Connected repository"
          detail="octocat/orbit-alpha"
          active
          onClick={onClick}
          supporting={<span>Primary binding</span>}
        />
        <SelectionChip active>Needs approval</SelectionChip>
      </>,
    );

    const row = screen.getByRole("button", { name: /orbit alpha/i });
    expect(row).toHaveClass("bg-panel");
    expect(screen.getByText("Connected repository")).toBeInTheDocument();
    expect(screen.getByText("Primary binding")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Needs approval" })).toHaveClass("bg-accent");

    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
