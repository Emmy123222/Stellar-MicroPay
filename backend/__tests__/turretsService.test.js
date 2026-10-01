"use strict";

const {
  stopRunner,
  startRunner,
  createScheduledDca,
  setDeploymentStatus,
  cancelDeployment,
  getDeployment,
  listDeployments,
} = require("../src/services/turretsService");

const OWNER = "GBRPYHIL2CI3FNIDTANYQ7BACEGIA63POASRMHWDHMV65QHJTWCTBYOO";
const RECIPIENT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

describe("Turrets Service", () => {
  afterAll(() => {
    stopRunner();
  });

  it("should start and stop runner", () => {
    startRunner();
    expect(true).toBe(true);
  });

  it("creates a scheduled DCA payment for daily frequency", () => {
    const deployment = createScheduledDca({
      ownerPublicKey: OWNER,
      recipient: RECIPIENT,
      amount: 5,
      asset: "XLM",
      frequency: "daily",
    });

    expect(deployment.type).toBe("dca");
    expect(deployment.status).toBe("active");
    expect(deployment.config.recipient).toBe(RECIPIENT);
    expect(deployment.config.frequency).toBe("daily");
    expect(deployment.config.intervalMinutes).toBe(1440);
    expect(deployment.config.paymentType).toBe("scheduled_payment");
    expect(deployment.nextRunAt).toBeTruthy();
  });

  it("pauses and resumes a scheduled payment", () => {
    const deployment = createScheduledDca({
      ownerPublicKey: OWNER,
      recipient: RECIPIENT,
      amount: 1,
      asset: "XLM",
      frequency: "weekly",
    });

    const paused = setDeploymentStatus(deployment.id, "paused");
    expect(paused.status).toBe("paused");
    expect(getDeployment(deployment.id).status).toBe("paused");

    const resumed = setDeploymentStatus(deployment.id, "active");
    expect(resumed.status).toBe("active");
  });

  it("cancels (deletes) a scheduled payment", () => {
    const deployment = createScheduledDca({
      ownerPublicKey: OWNER,
      recipient: RECIPIENT,
      amount: 2,
      asset: "XLM",
      frequency: "monthly",
    });

    const cancelled = cancelDeployment(deployment.id);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.id).toBe(deployment.id);

    expect(() => getDeployment(deployment.id)).toThrow(/not found/i);
  });

  it("lists deployments for an owner", () => {
    createScheduledDca({
      ownerPublicKey: OWNER,
      recipient: RECIPIENT,
      amount: 3,
      asset: "XLM",
      frequency: "daily",
    });

    const listed = listDeployments(OWNER);
    expect(Array.isArray(listed)).toBe(true);
    expect(listed.some((d) => d.ownerPublicKey === OWNER)).toBe(true);
  });

  it("rejects invalid frequency", () => {
    expect(() =>
      createScheduledDca({
        ownerPublicKey: OWNER,
        recipient: RECIPIENT,
        amount: 1,
        asset: "XLM",
        frequency: "hourly",
      })
    ).toThrow(/frequency/i);
  });
});
