"use strict";
/**
 * Defensive checker for the existing CarTune admin account.
 * Do not edit PERMS in web/shared/cartune-core.js.
 * owner and admin: help, discounts, emergencies.
 * support: help and emergencies only. Support cannot mint discount codes.
 * Help is read-only. The member accepts any suggestion on their own device.
 * This file does not write to an ECU and does not authorise anything from a plate.
 */

const ACTION_PERM = {
  help: "help.join",
  discount: "codes.manage",
  emergency: "help.join",
};

function roleAllows(role, action) {
  if (role === "owner") return true;
  if (action === "discount") return role === "admin";
  return role === "admin" || role === "support";
}

function reviewDeskAction(input) {
  const action = input.action;
  const reason = String(input.reason || "").trim();
  const roleOk = roleAllows(input.role, action);
  const reasonOk = action === "help" || reason.length >= 8;
  const pct = Number(input.discountPct);
  const discountOk = action !== "discount" || (pct >= 1 && pct <= 100);
  const plateOk = !input.plateUsedAsPermission;
  const allowed = roleOk && reasonOk && discountOk && plateOk;
  return {
    allowed,
    perm: ACTION_PERM[action] || "",
    checks: [
      { label: "Existing staff role", pass: roleOk },
      { label: "Reason on discount and emergency", pass: reasonOk },
      { label: "Discount is 1 to 100 percent", pass: discountOk },
      { label: "Plate is not permission", pass: plateOk },
      { label: "No ECU write", pass: true },
      { label: "Member accepts suggestions on their device", pass: true },
    ],
  };
}

const SECRET_PATTERNS = [
  { label: "Hardcoded password", pattern: /(?:password|passwd|pwd)\s*[:=]\s*["'][^"']{4,}["']/i },
  { label: "API key in source", pattern: /(?:api[_-]?key|client_secret|x-api-key)\s*[:=]\s*["'][^"']{6,}["']/i },
  { label: "Password grant", pattern: /grant_type\s*=\s*password/i },
  { label: "Identity-admin credential", pattern: /X-OpenIDM-Password|idmadmin/i },
];

function scanBundle(source) {
  const text = String(source || "");
  return SECRET_PATTERNS.map((item) => ({
    label: item.label,
    pass: !item.pattern.test(text),
  }));
}

module.exports = { reviewDeskAction, scanBundle, ACTION_PERM };
