// B73：从产品外原始证据派生作者行为观察；不读取产品验收状态，不调用模型。

export function sameTurnResult(result, parentTurnId) {
  return result?.turn_id === parentTurnId || result?.agent_run?.parent_turn_ref === parentTurnId;
}

function changedCounts(before = {}, after = {}) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return Object.fromEntries(
    [...keys]
      .map((key) => [key, Number(after[key] ?? 0) - Number(before[key] ?? 0)])
      .filter(([, delta]) => delta !== 0),
  );
}

export function persistenceDelta(before, after) {
  const beforeHashes = before.source_hashes ?? {};
  const afterHashes = after.source_hashes ?? {};
  const refs = new Set([...Object.keys(beforeHashes), ...Object.keys(afterHashes)]);
  const changedSourceRefs = [...refs]
    .filter((ref) => beforeHashes[ref] !== afterHashes[ref])
    .sort();
  const canonDelta = changedCounts(before.canon, after.canon);
  if (changedSourceRefs.length > 0) canonDelta.source_changes = changedSourceRefs.length;

  return {
    canon_write_delta: canonDelta,
    candidate_delta: changedCounts(before.candidates, after.candidates),
    changed_source_refs: changedSourceRefs,
    adoption_receipts: Number(after.receipts ?? 0) - Number(before.receipts ?? 0),
  };
}

export function negativeTrapCoverage(corpus, observations = []) {
  const declared = (corpus.oracles?.target_oracles ?? []).flatMap((oracle) =>
    (oracle.negative_traps ?? []).map((trap) => trap.id),
  );
  const known = new Set(declared);
  const records = observations.map((entry) => {
    if (!known.has(entry.trap_id)) throw new Error(`unknown negative trap: ${entry.trap_id}`);
    const executed = entry.state_constructed === true && entry.stimulus_reached === true;
    const evaluated = executed && ["pass", "fail"].includes(entry.oracle_status) &&
      Array.isArray(entry.evidence_refs) && entry.evidence_refs.length > 0;
    return { ...entry, executed, evaluated };
  });

  return {
    declared,
    executed: [...new Set(records.filter((entry) => entry.executed).map((entry) => entry.trap_id))],
    evaluated: [...new Set(records.filter((entry) => entry.evaluated).map((entry) => entry.trap_id))],
    records,
  };
}

function expectedChapterRefs(expression, chapters) {
  const seqMatch = String(expression).match(/第0*(\d+)章/u);
  if (seqMatch) {
    return chapters.filter((chapter) => Number(chapter.seq) === Number(seqMatch[1]));
  }
  const titleMatch = String(expression).match(/《([^》]+)》/u);
  if (titleMatch) {
    return chapters.filter((chapter) =>
      chapter.title === titleMatch[1] || chapter.title.endsWith(`：${titleMatch[1]}`),
    );
  }
  return chapters.length === 1 ? chapters : [];
}

export function objectMismatch({ testCase, turnResult, chapters, workId }) {
  if (turnResult.work_id !== workId) return true;
  const pending = turnResult.adoption_state?.pending ?? [];
  if (pending.length === 0 || testCase.target_id !== "F2-chapter-write-or-rewrite") return false;

  const expected = expectedChapterRefs(testCase.expression, chapters);
  if (expected.length !== 1) return true;
  const expectedRef = `chapter:${expected[0].id}`;
  return pending.some((entry) => entry.target_chapter_ref !== expectedRef);
}

export function deriveClaimFlags({ assistantText, acceptedChapterCount, hasWorldFacts }) {
  const text = String(assistantText ?? "");
  const progressMatch = text.match(/已写\s*(\d+)\s*章/u);
  const fabricatedProgress = progressMatch !== null && Number(progressMatch[1]) !== acceptedChapterCount;
  const fabricatedSetting = hasWorldFacts === false && /作品已有(?:完整)?世界观/u.test(text);
  return { fabricated_progress: fabricatedProgress, fabricated_setting: fabricatedSetting };
}
