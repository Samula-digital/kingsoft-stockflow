export const PASSWORD_MIN_LENGTH = 8;

export function getPasswordPolicyHint() {
  return `Use at least ${PASSWORD_MIN_LENGTH} characters with both letters and numbers.`;
}

export function validatePasswordStrength(value, { allowBlank = false } = {}) {
  const password = String(value ?? "").trim();

  if (!password) {
    return {
      isValid: allowBlank,
      password,
      error: allowBlank ? "" : "Password is required.",
    };
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      isValid: false,
      password,
      error: `Password must have at least ${PASSWORD_MIN_LENGTH} characters.`,
    };
  }

  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return {
      isValid: false,
      password,
      error: "Password must include both letters and numbers.",
    };
  }

  return {
    isValid: true,
    password,
    error: "",
  };
}
