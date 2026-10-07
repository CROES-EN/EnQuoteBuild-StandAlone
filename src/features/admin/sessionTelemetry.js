export function sessionTelemetry(session) {
  const missing = !session.appVersion || !session.resolvedRole;
  return {
    app: session.appVersion || "Not reported",
    ui: session.uiVersion || "Bundled or not reported",
    resolvedRole: session.resolvedRole || "Not reported",
    effectiveRole: session.effectiveRole || "Unknown",
    missing,
    mismatch: Boolean(session.resolvedRole && session.effectiveRole && session.resolvedRole !== session.effectiveRole)
  };
}
