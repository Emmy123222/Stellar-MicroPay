import React, { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import Modal from "@/components/Modal";

function ModalHarness(props: Partial<React.ComponentProps<typeof Modal>> = {}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div>
      <button type="button" onClick={() => setIsOpen(true)}>
        Open modal
      </button>
      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} ariaLabel="Test dialog" {...props}>
        <button type="button">First</button>
        <button type="button">Second</button>
      </Modal>
    </div>
  );
}

describe("Modal — shared modal shell (#627)", () => {
  it("renders nothing while closed", () => {
    render(
      <Modal isOpen={false} onClose={jest.fn()} ariaLabel="Test dialog">
        body
      </Modal>
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("exposes dialog semantics and the supplied labelling", () => {
    render(
      <Modal isOpen onClose={jest.fn()} labelledBy="title" describedBy="description">
        <h2 id="title">Title</h2>
        <p id="description">Description</p>
      </Modal>
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "title");
    expect(dialog).toHaveAttribute("aria-describedby", "description");
  });

  it("applies the overlay and panel class names it is given", () => {
    render(
      <Modal
        isOpen
        onClose={jest.fn()}
        ariaLabel="Test dialog"
        overlayClassName="overlay-custom"
        panelClassName="panel-custom"
      >
        body
      </Modal>
    );

    expect(screen.getByTestId("modal-backdrop")).toHaveClass("overlay-custom");
    expect(screen.getByRole("dialog")).toHaveClass("panel-custom");
  });

  it("closes on Escape, backdrop click, and keeps clicks inside the panel", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(
      <Modal isOpen onClose={onClose} ariaLabel="Test dialog">
        <button type="button">Inside</button>
      </Modal>
    );

    await user.click(screen.getByRole("button", { name: "Inside" }));
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("modal-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("can opt out of backdrop and Escape closing", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(
      <Modal
        isOpen
        onClose={onClose}
        ariaLabel="Test dialog"
        closeOnBackdropClick={false}
        closeOnEscape={false}
      >
        body
      </Modal>
    );

    await user.click(screen.getByTestId("modal-backdrop"));
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("moves focus inside, traps Tab, and returns focus to the opener", async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);

    const opener = screen.getByRole("button", { name: "Open modal" });
    await user.click(opener);

    const first = screen.getByRole("button", { name: "First" });
    const second = screen.getByRole("button", { name: "Second" });
    expect(first).toHaveFocus();

    await user.tab();
    expect(second).toHaveFocus();

    await user.tab();
    expect(first).toHaveFocus();

    await user.tab({ shift: true });
    expect(second).toHaveFocus();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("locks body scroll only when asked to", () => {
    const { unmount } = render(
      <Modal isOpen onClose={jest.fn()} ariaLabel="Test dialog">
        body
      </Modal>
    );
    expect(document.body.style.overflow).toBe("");
    unmount();

    const locked = render(
      <Modal isOpen onClose={jest.fn()} ariaLabel="Test dialog" lockBodyScroll>
        body
      </Modal>
    );
    expect(document.body.style.overflow).toBe("hidden");

    locked.unmount();
    expect(document.body.style.overflow).toBe("");
  });
});
