const SEVERITIES = ["info", "low", "moderate", "high", "critical"];

export function validateNpmAuditReport(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { errors: ["npm audit report is not an object"], vulnerabilityCounts: {} };
  }
  if (!Number.isSafeInteger(value.auditReportVersion) || value.auditReportVersion < 1) {
    errors.push("npm audit report has no supported auditReportVersion");
  }
  const counts = value.metadata?.vulnerabilities;
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) {
    return {
      errors: [...errors, "npm audit report has no vulnerability-count schema"],
      vulnerabilityCounts: {},
    };
  }
  for (const severity of [...SEVERITIES, "total"]) {
    const count = counts[severity];
    if (!Number.isSafeInteger(count) || count < 0) {
      errors.push(`npm audit ${severity} vulnerability count is not a non-negative finite integer`);
    }
  }
  if (
    errors.length === 0 &&
    counts.total !== SEVERITIES.reduce((sum, severity) => sum + counts[severity], 0)
  ) {
    errors.push("npm audit total vulnerability count does not match severity counts");
  }
  return { errors, vulnerabilityCounts: counts };
}
