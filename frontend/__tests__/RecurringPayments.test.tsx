import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import RecurringPayments from "@/components/RecurringPayments";

const RECIPIENT = "GDEST234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567";

function renderRP(onPayNow = jest.fn()) {
  return render(<RecurringPayments onPayNow={onPayNow} />);
}

beforeEach(() => {
  localStorage.clear();
});

describe("RecurringPayments — schedule creation (#513)", () => {
  it("shows an empty state message when no schedules exist", () => {
    renderRP();
    expect(screen.getByText(/No recurring schedules yet/i)).toBeInTheDocument();
  });

  it("opens the new-schedule form when '+ New schedule' is clicked", async () => {
    const user = userEvent.setup();
    renderRP();

    await user.click(screen.getByText(/\+ New schedule/i));

    expect(screen.getByText(/New recurring payment/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create/i })).toBeInTheDocument();
  });

  it("creates a new schedule with a valid recipient and amount", async () => {
    const user = userEvent.setup();
    renderRP();

    await user.click(screen.getByText(/\+ New schedule/i));

    await user.type(screen.getByPlaceholderText("G..."), RECIPIENT);
    await user.clear(screen.getByPlaceholderText("0.0000000"));
    await user.type(screen.getByPlaceholderText("0.0000000"), "5");

    await user.click(screen.getByRole("button", { name: /Create/i }));

    expect(screen.getByText(/5 XLM/i)).toBeInTheDocument();
    expect(screen.queryByText(/No recurring schedules yet/i)).not.toBeInTheDocument();
  });

  it("creates a weekly schedule and shows the frequency label", async () => {
    const user = userEvent.setup();
    renderRP();

    await user.click(screen.getByText(/\+ New schedule/i));

    await user.type(screen.getByPlaceholderText("G..."), RECIPIENT);
    await user.clear(screen.getByPlaceholderText("0.0000000"));
    await user.type(screen.getByPlaceholderText("0.0000000"), "2");
    await user.selectOptions(screen.getByRole("combobox"), "weekly");

    await user.click(screen.getByRole("button", { name: /Create/i }));

    expect(screen.getByText(/weekly/i)).toBeInTheDocument();
  });

  it("rejects submission when recipient is missing and shows an error", async () => {
    const user = userEvent.setup();
    renderRP();

    await user.click(screen.getByText(/\+ New schedule/i));

    await user.clear(screen.getByPlaceholderText("0.0000000"));
    await user.type(screen.getByPlaceholderText("0.0000000"), "3");
    await user.click(screen.getByRole("button", { name: /Create/i }));

    expect(screen.getByText(/Recipient is required/i)).toBeInTheDocument();
  });

  it("rejects submission when amount is zero or invalid and shows an error", async () => {
    const user = userEvent.setup();
    renderRP();

    await user.click(screen.getByText(/\+ New schedule/i));

    await user.type(screen.getByPlaceholderText("G..."), RECIPIENT);
    // Leave amount empty
    await user.click(screen.getByRole("button", { name: /Create/i }));

    expect(screen.getByText(/Enter a valid amount/i)).toBeInTheDocument();
  });

  it("dismisses the form when Cancel is clicked", async () => {
    const user = userEvent.setup();
    renderRP();

    await user.click(screen.getByText(/\+ New schedule/i));
    expect(screen.getByText(/New recurring payment/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(screen.queryByText(/New recurring payment/i)).not.toBeInTheDocument();
  });
});

describe("RecurringPayments — listing existing schedules (#513)", () => {
  it("lists multiple schedules after creation", async () => {
    const user = userEvent.setup();
    renderRP();

    for (const amount of ["1", "2"]) {
      await user.click(screen.getByText(/\+ New schedule/i));
      await user.type(screen.getByPlaceholderText("G..."), RECIPIENT);
      await user.clear(screen.getByPlaceholderText("0.0000000"));
      await user.type(screen.getByPlaceholderText("0.0000000"), amount);
      await user.click(screen.getByRole("button", { name: /Create/i }));
    }

    expect(screen.getByText(/1 XLM/i)).toBeInTheDocument();
    expect(screen.getByText(/2 XLM/i)).toBeInTheDocument();
  });

  it("persists schedules to localStorage so they survive a re-render", async () => {
    const user = userEvent.setup();
    const { unmount } = renderRP();

    await user.click(screen.getByText(/\+ New schedule/i));
    await user.type(screen.getByPlaceholderText("G..."), RECIPIENT);
    await user.clear(screen.getByPlaceholderText("0.0000000"));
    await user.type(screen.getByPlaceholderText("0.0000000"), "9");
    await user.click(screen.getByRole("button", { name: /Create/i }));
    unmount();

    renderRP();
    expect(screen.getByText(/9 XLM/i)).toBeInTheDocument();
  });
});

describe("RecurringPayments — pause / delete actions (#513)", () => {
  async function createSchedule(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByText(/\+ New schedule/i));
    await user.type(screen.getByPlaceholderText("G..."), RECIPIENT);
    await user.clear(screen.getByPlaceholderText("0.0000000"));
    await user.type(screen.getByPlaceholderText("0.0000000"), "3");
    await user.click(screen.getByRole("button", { name: /Create/i }));
  }

  it("pauses a schedule when the Pause button is clicked", async () => {
    const user = userEvent.setup();
    renderRP();
    await createSchedule(user);

    await user.click(screen.getByRole("button", { name: /Pause schedule/i }));

    expect(screen.getByText(/Paused/i)).toBeInTheDocument();
  });

  it("resumes a paused schedule when the Play button is clicked", async () => {
    const user = userEvent.setup();
    renderRP();
    await createSchedule(user);

    await user.click(screen.getByRole("button", { name: /Pause schedule/i }));
    expect(screen.getByText(/Paused/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Resume schedule/i }));
    expect(screen.queryByText(/Paused/i)).not.toBeInTheDocument();
  });

  it("removes a schedule when the Delete button is clicked", async () => {
    const user = userEvent.setup();
    renderRP();
    await createSchedule(user);

    expect(screen.getByText(/3 XLM/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Delete schedule/i }));

    expect(screen.queryByText(/3 XLM/i)).not.toBeInTheDocument();
    expect(screen.getByText(/No recurring schedules yet/i)).toBeInTheDocument();
  });

  it("opens the edit form pre-filled with the schedule values", async () => {
    const user = userEvent.setup();
    renderRP();
    await createSchedule(user);

    await user.click(screen.getByRole("button", { name: /Edit schedule/i }));

    expect(screen.getByText(/Edit schedule/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("0.0000000")).toHaveValue(3);
  });
});

describe("RecurringPayments — Accessibility enhancements (#513)", () => {
  async function createSchedule(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByText(/\+ New schedule/i));
    await user.type(screen.getByPlaceholderText("G..."), RECIPIENT);
    await user.clear(screen.getByPlaceholderText("0.0000000"));
    await user.type(screen.getByPlaceholderText("0.0000000"), "3");
    await user.click(screen.getByRole("button", { name: /Create/i }));
  }

  it("announces successful state changes to screen readers", async () => {
    const user = userEvent.setup();
    renderRP();
    await createSchedule(user);
    
    // Announcement container should be in DOM
    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion).toHaveTextContent("Schedule created.");

    await user.click(screen.getByRole("button", { name: /Pause schedule/i }));
    expect(liveRegion).toHaveTextContent("Schedule paused.");

    await user.click(screen.getByRole("button", { name: /Resume schedule/i }));
    expect(liveRegion).toHaveTextContent("Schedule resumed.");

    await user.click(screen.getByRole("button", { name: /Delete schedule/i }));
    expect(liveRegion).toHaveTextContent("Schedule deleted.");
  });

  it("returns focus to the main heading after deletion", async () => {
    const user = userEvent.setup();
    renderRP();
    await createSchedule(user);

    await user.click(screen.getByRole("button", { name: /Delete schedule/i }));

    // We used a setTimeout for focusing to allow react to render
    await waitFor(() => {
      const heading = screen.getByRole("heading", { name: /Recurring Payments/i });
      expect(document.activeElement).toBe(heading);
    });
  });
});
