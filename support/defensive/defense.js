"use strict";
/**
 * Signup acceptance is the grant.
 * Plate lookup returns vehicle details only. It is not a password.
 * Start is allowed for owner, admin, or support when the member calls
 * because their own start button is not working.
 */

function reviewDeskAction(input) {
  const role = input.role;
  const staff = role === "owner" || role === "admin" || role === "support";
  const signupAccepted = input.signupAccepted !== false;
  const memberCalled = input.memberCalled !== false;
  if (input.plateUsedAsPermission) return { allowed: false, passwordTaken: false };
  if (input.action === "start") {
    return { allowed: staff && signupAccepted && memberCalled, passwordTaken: false };
  }
  if (input.action === "discount") {
    const pct = Number(input.discountPct);
    const reason = String(input.reason || "").trim();
    return {
      allowed: (role === "owner" || role === "admin") && pct >= 1 && pct <= 100 && reason.length >= 8,
      passwordTaken: false,
    };
  }
  return { allowed: staff && signupAccepted, passwordTaken: false };
}

const SECRET_PATTERNS = [
  { label: "Hardcoded password", pattern: /(?:password|passwd|pwd)\s*[:=]\s*["'][^"']{4,}["']/i },
  { label: "API key in source", pattern: /(?:api[_-]?key|client_secret|x-api-key)\s*[:=]\s*["'][^"']{6,}["']/i },
  { label: "Password grant", pattern: /grant_type\s*=\s*password/i },
];

function scanBundle(source) {
  const text = String(source || "");
  return SECRET_PATTERNS.map((item) => ({ label: item.label, pass: !item.pattern.test(text) }));
}

module.exports = { reviewDeskAction, scanBundle };
