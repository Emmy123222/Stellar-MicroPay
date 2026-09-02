"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";

interface TourStep {
  id: string;
  title: string;
  description: string;
  target: string; // CSS selector
  position: "top" | "bottom" | "left" | "right";
}

const tourSteps: TourStep[] = [
  {
    id: "balance",
    title: "Your Balance",
    description: "Here you can see your XLM balance and wallet address. This is your main account overview.",
    target: ".balance-card",
    position: "bottom",
  },
  {
    id: "send-form",
    title: "Send Payments",
    description: "Use this form to send XLM payments to other Stellar addresses. Enter the recipient and amount.",
    target: ".send-payment-form",
    position: "right",
  },
  {
    id: "transactions",
    title: "View Transactions",
    description: "Click here to see all your past transactions and payment history.",
    target: "a[href='/transactions']",
    position: "bottom",
  },
];

interface OnboardingTourProps {
  isVisible: boolean;
  onComplete: () => void;
  onSkip: () => void;
}

export default function OnboardingTour({ isVisible, onComplete, onSkip }: OnboardingTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const handleNext = useCallback(() => {
    if (currentStep < tourSteps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      onComplete();
    }
  }, [currentStep, onComplete]);

  const handleSkip = useCallback(() => {
    onSkip();
  }, [onSkip]);

  useEffect(() => {
    if (!isVisible) return;

    // Remember the launch point (a nearby control that opened the tour) so we
    // can hand focus back to it once the tour is finished or skipped. Captured
    // here — before any focus is moved into the tour below.
    if (!returnFocusRef.current) {
      const active = document.activeElement;
      returnFocusRef.current = active instanceof HTMLElement ? active : null;
    }

    const step = tourSteps[currentStep];
    const targetElement = document.querySelector(step.target);
    if (targetElement) {
      targetElement.scrollIntoView({ behavior: "smooth", block: "center" });
      targetElement.classList.add("tour-highlight");
    }

    panelRef.current?.focus();

    return () => {
      if (targetElement) {
        targetElement.classList.remove("tour-highlight");
      }
    };
  }, [currentStep, isVisible]);

  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleSkip();
      } else if (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "Enter") {
        event.preventDefault();
        handleNext();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        setCurrentStep((stepIndex) => Math.max(0, stepIndex - 1));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isVisible, handleNext, handleSkip]);

  // Focus management: make everything outside the tour inert, keep Tab cycling
  // within the tour controls, and hand focus back to the launch point when the
  // tour is finished or skipped.
  useEffect(() => {
    if (!isVisible) return;

    const previouslyInert: { element: HTMLElement }[] = [];
    const restoreInert = () => {
      previouslyInert.forEach(({ element }) => element.removeAttribute("inert"));
      previouslyInert.length = 0;
    };

    const portal = document.getElementById("onboarding-tour-portal");
    Array.from(document.body.children).forEach((child) => {
      if (portal && portal.contains(child)) return;
      const element = child as HTMLElement;
      if (!element.hasAttribute("inert")) {
        element.setAttribute("inert", "");
        previouslyInert.push({ element });
      }
    });

    const handleTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;

      const focusable = getFocusableElements(panelRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;

      if (event.shiftKey) {
        if (!current || !panelRef.current?.contains(current) || current === first) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (!current || !panelRef.current?.contains(current) || current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleTab);

    return () => {
      document.removeEventListener("keydown", handleTab);
      restoreInert();

      const target = returnFocusRef.current;
      if (target) {
        window.setTimeout(() => target.focus(), 0);
      }
    };
  }, [isVisible]);

  if (!isVisible) return null;

  const step = tourSteps[currentStep];
  const targetElement = document.querySelector(step.target);
  if (!targetElement) return null;

  const rect = targetElement.getBoundingClientRect();

  const getTooltipPosition = () => {
    const offset = 10;
    switch (step.position) {
      case "top":
        return {
          top: rect.top - offset,
          left: rect.left + rect.width / 2,
          transform: "translateX(-50%) translateY(-100%)",
        };
      case "bottom":
        return {
          top: rect.bottom + offset,
          left: rect.left + rect.width / 2,
          transform: "translateX(-50%)",
        };
      case "left":
        return {
          top: rect.top + rect.height / 2,
          left: rect.left - offset,
          transform: "translateX(-100%) translateY(-50%)",
        };
      case "right":
        return {
          top: rect.top + rect.height / 2,
          left: rect.right + offset,
          transform: "translateY(-50%)",
        };
    }
  };

  return createPortal(
    <div id="onboarding-tour-portal" className="fixed inset-0 z-40 pointer-events-none">
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/50 z-40 pointer-events-none" />

      {/* Tooltip */}
      <div
        ref={panelRef}
        className="fixed z-50 bg-white dark:bg-gray-800 text-gray-900 dark:text-white p-4 rounded-lg shadow-lg max-w-xs focus:outline-none focus:ring-2 focus:ring-blue-400 pointer-events-auto"
        style={getTooltipPosition()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-tour-title"
        tabIndex={-1}
      >
        <h3 id="onboarding-tour-title" className="font-semibold text-lg mb-2">{step.title}</h3>
        <p className="text-sm mb-4">{step.description}</p>
        <div className="flex justify-between items-center">
          <button
            onClick={handleSkip}
            className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">
              {currentStep + 1} of {tourSteps.length}
            </span>
            <button
              onClick={handleNext}
              className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded text-sm"
            >
              {currentStep === tourSteps.length - 1 ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * Visible, focusable descendants of `root`, in document order.
 */
function getFocusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];

  const selector = [
    "button:not([disabled])",
    "[href]",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
  ].join(",");

  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((element) => {
    const style = window.getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none";
  });
}