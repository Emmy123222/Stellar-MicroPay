/**
 * __tests__/i18n-fallback.test.ts
 * Isolated so the partial Spanish dictionary below can be injected without
 * affecting the rest of the i18n suite.
 */

describe("i18n English fallback", () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock("@/locales/es.json");
  });

  it("uses English for keys missing from the active locale", () => {
    jest.isolateModules(() => {
      jest.doMock("@/locales/es.json", () => ({
        __esModule: true,
        default: { dashboard: { title: "Panel" }, common: { cancel: "Cancelar" } },
      }));

      const { translate } = jest.requireActual("@/lib/i18n") as typeof import("@/lib/i18n");

      // Present in Spanish.
      expect(translate("es", "dashboard.title")).toBe("Panel");
      expect(translate("es", "common.cancel")).toBe("Cancelar");

      // Missing from Spanish — falls back to English, not to the key.
      expect(translate("es", "dashboard.totalSent")).toBe("Total Sent");
      expect(translate("es", "sendPayment.confirmAndSend")).toBe("Confirm & Send");

      // Missing everywhere — falls back to the key itself.
      expect(translate("es", "totally.unknown")).toBe("totally.unknown");
    });
  });
});
