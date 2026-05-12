# Handoff: Scenario Acceptance Reconciliation

> Date: 2026-05-13
> Branch: `idea/dialogue-based-novel-workbench/v3`
> Baseline commit before standalone handoff doc: `c96a8b7 docs: update project ledger handoff`

## 1. Current Task State

We are walking through acceptance cases one by one with the user.

The user explicitly clarified that acceptance scenarios must be designed from complete real user workflows, including frontend and backend, not API-only cases. The goal is to expose incomplete or under-covered implementation against the full product blueprint.

Current progress:

| Area | Status |
|---|---|
| SU-01 | Reconciled |
| SU-02 | Reconciled |
| SU-03 | Reconciled |
| AU-01 | Reconciled |
| AU-02 | Reconciled |
| AU-03 | Reconciled |
| AU-04 | Reconciled |
| AU-05 | Reconciled |
| AU-06 | Reconciled |
| AU-07 | Reconciled |
| AU-08 | Reconciled |
| AU-09 | Next |
| AU-10 | Pending |

## 2. Required Reading For New Session

Read these first, in order:

1. `docs/project-ledger.md`
2. `docs/design-v3/acceptance/SCENARIO-BLUEPRINT.md`
3. `docs/design-v3/acceptance/README.md`
4. `docs/design-v3/acceptance/author/AU-09-story-memory.md`

Do not rely on older "coverage percent" assumptions. The current evidence-based rule is:

- Complete frontend + backend user scenario = can count as complete acceptance.
- Code exists = local evidence only.
- API/helper test exists = local evidence only.
- Mock handler exists = not acceptance.
- Document says implemented = not acceptance.
- If uncertain, mark uncertain and state what to inspect.

## 3. Most Important Findings So Far

| Finding | Evidence |
|---|---|
| README old 67%-100% acceptance numbers were misleading | Rewritten in `docs/design-v3/acceptance/README.md` |
| Scenario blueprint is now the acceptance entry point | `docs/design-v3/acceptance/SCENARIO-BLUEPRINT.md` |
| AU-03 needs work-internal session model | `docs/design-v3/acceptance/author/AU-03-context.md` |
| AU-04 real frontend still calls old confirm/reject path while backend has `author_action` | `docs/design-v3/acceptance/author/AU-04-execute-and-confirm.md` |
| AU-05 adoption frontend helpers have no matching Channel handlers | `docs/design-v3/acceptance/author/AU-05-artifact-adoption.md` |
| AU-06 behavior_state frontend/backend shape mismatch remains | `docs/design-v3/acceptance/author/AU-06-behavior-lifecycle.md` |
| AU-07 has backend replay/trace pieces but no author-facing why UI/redaction closure | `docs/design-v3/acceptance/author/AU-07-trace-and-replay.md` |
| AU-08 ReadingMode is only a partial UI shell; `get_toc` is mock and `get_chapter_content` Channel handler is missing | `docs/design-v3/acceptance/author/AU-08-reading-mode.md` |

## 4. Next Step

Continue with AU-09.

Suggested flow:

1. Read `docs/design-v3/acceptance/author/AU-09-story-memory.md`.
2. Search evidence for story memory, settings, memory recall, context assembly, and frontend management UI.
3. Rebuild AU-09 as full user scenarios:
   - author creates or confirms story facts/settings;
   - facts are persisted and visible/manageable;
   - AI recalls the right facts in later work sessions;
   - stale or conflicting facts are handled;
   - memory sources are traceable;
   - cross-work and historical-session isolation are respected.
4. Update `docs/design-v3/acceptance/README.md`.
5. Update `docs/design-v3/acceptance/SCENARIO-BLUEPRINT.md` if AU-09 changes the blueprint findings.

## 5. Commit History From This Work Batch

Pushed commits:

| Commit | Purpose |
|---|---|
| `0d79061 docs: reconcile scenario acceptance coverage` | Rewrote scenario acceptance coverage for SU-01~03 and AU-01~08; added blueprint |
| `c96a8b7 docs: update project ledger handoff` | Updated project ledger with scenario reconciliation baseline and next-session notes |

## 6. Working Tree Notes

At the time of handoff, the only unrelated untracked file was:

```text
frontend/src-tauri/tauri.conf.json.stage.bak
```

Do not stage or delete it unless the user explicitly asks.

## 7. Verification Already Run

For the documentation changes:

```bash
git diff --check
```

Passed before the previous push.

No backend/frontend test suite was run for this documentation-only acceptance reconciliation batch.
