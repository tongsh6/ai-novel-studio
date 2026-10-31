export function pendingText(entry) {
  const items = [...(entry?.payload?.items ?? []), ...(entry?.items ?? [])];
  return [
    entry?.payload?.content,
    entry?.content,
    ...items.flatMap((item) => [item?.body, item?.content]),
  ]
    .filter((value) => value != null)
    .map(String)
    .join("\n");
}

export function revisionOf(entry) {
  return (
    entry?.payload?.revision_of ??
    entry?.payload?.items?.[0]?.revision_of ??
    entry?.revision_of_ref ??
    entry?.payload?.revision_of_ref ??
    entry?.revision_of ??
    null
  );
}

export function isOverwriteConfirmation(body) {
  return (
    body?.status === "needs_confirmation" ||
    body?.status === "requires_confirmation" ||
    body?.adoption_decision?.decision_type === "require_confirmation" ||
    body?.decision_type === "require_confirmation" ||
    (body?.truthfulness?.reason_codes ?? []).includes("overwrite_existing_canon")
  );
}

export function actionMatchesArtifact(body, artifactId, actionId = null) {
  if (!body || typeof body !== "object") return false;
  if (actionId && body.action_id === actionId) return true;
  return (
    body.artifact_id === artifactId ||
    body.target_ref === artifactId ||
    body.decision?.candidate_ref === artifactId ||
    body.decision?.target_ref === `artifact:${artifactId}` ||
    body.decision?.target_ref === artifactId
  );
}

export function turnMatchesMessage(body, turnId) {
  return body?.turn_id === turnId || body?.agent_run?.parent_turn_ref === turnId;
}
