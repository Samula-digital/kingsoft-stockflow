import { describe, expect, it } from "vitest";
import {
  PASSWORD_MIN_LENGTH,
  getPasswordPolicyHint,
  validatePasswordStrength,
} from "./passwordPolicy.js";

describe("password policy", () => {
  it("rejects blank passwords by default", () => {
    expect(validatePasswordStrength("")).toEqual({
      isValid: false,
      password: "",
      error: "Password is required.",
    });
  });

  it("rejects short passwords", () => {
    const result = validatePasswordStrength("abc123");

    expect(result.isValid).toBe(false);
    expect(result.error).toContain(String(PASSWORD_MIN_LENGTH));
  });

  it("rejects passwords without a number", () => {
    const result = validatePasswordStrength("password");

    expect(result.isValid).toBe(false);
    expect(result.error).toBe("Password must include both letters and numbers.");
  });

  it("accepts strong passwords", () => {
    expect(validatePasswordStrength("Password123")).toEqual({
      isValid: true,
      password: "Password123",
      error: "",
    });
  });

  it("returns a user-facing hint", () => {
    expect(getPasswordPolicyHint()).toContain(String(PASSWORD_MIN_LENGTH));
  });
});
