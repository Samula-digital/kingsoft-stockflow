import { describe, expect, it } from "vitest";
import { shouldUseSecureCookies } from "./requestSecurity.js";

describe("shouldUseSecureCookies", () => {
  it("does not force secure cookies in dev mode", () => {
    expect(
      shouldUseSecureCookies(
        {
          headers: {
            "x-forwarded-proto": "https",
          },
        },
        { isDevMode: true }
      )
    ).toBe(false);
  });

  it("does not force secure cookies in desktop mode", () => {
    expect(
      shouldUseSecureCookies(
        {
          headers: {
            "x-forwarded-proto": "https",
          },
        },
        { isDesktopApp: true }
      )
    ).toBe(false);
  });

  it("does not use secure cookies for plain http production traffic by default", () => {
    expect(shouldUseSecureCookies({ headers: {}, socket: {} })).toBe(false);
  });

  it("uses secure cookies behind an https proxy", () => {
    expect(
      shouldUseSecureCookies({
        headers: {
          "x-forwarded-proto": "https",
        },
        socket: {},
      })
    ).toBe(true);
  });

  it("honors an explicit secure override", () => {
    expect(
      shouldUseSecureCookies(
        {
          headers: {},
          socket: {},
        },
        { override: "true" }
      )
    ).toBe(true);
  });

  it("honors an explicit insecure override", () => {
    expect(
      shouldUseSecureCookies(
        {
          headers: {
            "x-forwarded-proto": "https",
          },
          socket: {
            encrypted: true,
          },
        },
        { override: "false" }
      )
    ).toBe(false);
  });
});
