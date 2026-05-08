import React, { useMemo, useState } from "react";

const defaultSteps = [
  {
    title: "Control Room",
    description:
      "See daily stock alerts, transaction counts, and the practical next actions for stores and finance.",
    image: "/assets/onboarding/tour-welcome.svg",
    imageAlt: "Control room overview illustration",
  },
  {
    title: "Store Desk",
    description:
      "Use Store Desk to record receipts, issues, or adjustments with item search, quantity, department, and reference fields.",
    image: "/assets/onboarding/tour-record-movement.svg",
    imageAlt: "Stock movement form illustration",
  },
  {
    title: "Select item and quantity",
    description:
      "Choose the correct item, verify its UOM and stock details, then enter the quantity before saving the movement.",
    image: "/assets/onboarding/tour-choose-item.svg",
    imageAlt: "Item selection and quantity illustration",
  },
  {
    title: "Item Ledger",
    description:
      "Review current on-hand quantities, low-stock warnings, costs, and item health in the ledger.",
    image: "/assets/onboarding/tour-stock-balances.svg",
    imageAlt: "Stock balance table illustration",
  },
  {
    title: "AI assistant help",
    description:
      "Open the assistant panel to get contextual guidance, suggested actions, and module shortcuts while you work.",
    image: "/assets/onboarding/tour-help.svg",
    imageAlt: "Help and guidance panel illustration",
  },
];

export default function GettingStartedTour({ isOpen = false, onClose, steps = defaultSteps }) {
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const stepCount = steps.length;
  const step = steps[activeStepIndex] ?? steps[0];

  const progressLabel = useMemo(
    () => `Step ${activeStepIndex + 1} of ${stepCount}`,
    [activeStepIndex, stepCount]
  );

  if (!isOpen) return null;

  function handleNext() {
    if (activeStepIndex < stepCount - 1) {
      setActiveStepIndex((current) => current + 1);
      return;
    }

    handleClose();
  }

  function handleSkip() {
    handleClose();
  }

  function handleClose() {
    setActiveStepIndex(0);
    onClose?.();
  }

  return (
    <div className="onboarding-overlay" role="dialog" aria-modal="true">
      <div className="onboarding-panel">
        <div className="onboarding-header">
          <div>
            <div className="section-kicker">Getting Started</div>
            <h2>{step.title}</h2>
            <p>{step.description}</p>
          </div>
          <button className="button button-secondary button-small" type="button" onClick={handleSkip}>
            Skip Tour
          </button>
        </div>

        <div className="onboarding-media">
          {step.image ? (
            <figure>
              <img src={step.image} alt={step.imageAlt ?? step.title} />
              <figcaption>{step.imageAlt}</figcaption>
            </figure>
          ) : null}
        </div>

        <div className="onboarding-step-status">
          <span>{progressLabel}</span>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${((activeStepIndex + 1) / stepCount) * 100}%` }}
            />
          </div>
        </div>

        <div className="onboarding-actions">
          <button className="button button-secondary" type="button" onClick={handleSkip}>
            Skip
          </button>
          <button className="button button-primary" type="button" onClick={handleNext}>
            {activeStepIndex < stepCount - 1 ? "Next" : "Finish"}
          </button>
        </div>
      </div>
    </div>
  );
}
