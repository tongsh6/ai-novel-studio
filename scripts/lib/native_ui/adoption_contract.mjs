const list = (value) => (Array.isArray(value) ? value : []);

function firstPresent(...values) {
  const found = values.find((value) => value != null);
  return found ?? null;
}

export function pendingText(entry) {
  const items = [...list(entry?.payload?.items), ...list(entry?.items)];
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
  const payload = entry?.payload;
  const item = payload?.items?.[0];
  return firstPresent(
    payload?.revision_of,
    item?.revision_of,
    entry?.revision_of_ref,
    payload?.revision_of_ref,
    entry?.revision_of,
  );
}

const OVERWRITE_VALUES = new Set([
  "needs_confirmation",
  "requires_confirmation",
  "require_confirmation",
]);

export function isOverwriteConfirmation(body) {
  const values = [body?.status, body?.adoption_decision?.decision_type, body?.decision_type];
  return (
    values.some((value) => OVERWRITE_VALUES.has(value)) ||
    list(body?.truthfulness?.reason_codes).includes("overwrite_existing_canon")
  );
}

export function actionMatchesArtifact(body, artifactId, actionId = null) {
  if (!body || typeof body !== "object") return false;
  if (actionId && body.action_id === actionId) return true;
  const decision = body.decision;
  return [
    body.artifact_id,
    body.target_ref,
    decision?.candidate_ref,
    decision?.target_ref,
  ].some((value) => value === artifactId || value === `artifact:${artifactId}`);
}

// 作者动作请求与广播回执是两种现有身份：只有 accept:<artifact> → adopt:<artifact>
// 这一条映射；discard 保持 discard:<artifact>。这里不提供别名/前缀猜测。
export function actionResultIdentityFor(action) {
  const artifactId = action?.target_ref;
  if (typeof artifactId !== "string" || artifactId.trim() === "") return null;
  if (action?.action_type === "accept") {
    return { action_id: `adopt:${artifactId}`, action_type: "adopt" };
  }
  if (action?.action_type === "discard") {
    return { action_id: `discard:${artifactId}`, action_type: "discard" };
  }
  return null;
}

export function actionResultBindsArtifact(body, action) {
  const expected = actionResultIdentityFor(action);
  return Boolean(
    expected &&
      body?.action_id === expected.action_id &&
      body?.action_type === expected.action_type &&
      body?.artifact_id !== undefined &&
      body.artifact_id === action.target_ref &&
      actionMatchesArtifact(body, action.target_ref),
  );
}

export function turnMatchesMessage(body, turnId) {
  return body?.turn_id === turnId || body?.agent_run?.parent_turn_ref === turnId;
}
