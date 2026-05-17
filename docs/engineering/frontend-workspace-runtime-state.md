# Workspace Runtime State

## Raw Sources

| Source | Current Usage | Risk |
|---|---|---|
| resume snapshot | Restores active work/session, transcript, pending and resolved adoptions. | Components can race against restored transcript and insert a welcome message before resume is reflected. |
| channel join response | Confirms the socket joined the requested work/session. | Socket connection can be mistaken for work readiness, or a mismatched join can look connected. |
| transcript | Drives message rendering and historical `turn_result` adoption state. | Pending and resolved artifacts can be counted multiple times when transcript and resume snapshot overlap. |
| `turn_result.adoption_state` | Renders adoption cards and decision records. | Old cards can keep pending actions after the same artifact is resolved later. |
| reading projection TOC | Drives Reading Mode chapter list and active chapter. | Empty projections can be confused with fake or internal projection titles. |
| task state | Updates long-run summary in the workbench header. | Long-run state is UI runtime state, not work/session readiness. |
| Zustand work/session context | Supplies work title, active ids, channel reference, and socket flag. | Title fallback and connection labels were previously computed separately by components. |

## Runtime State Model

`frontend/src/lib/workspaceRuntimeState.ts` is the frontend normalization boundary for the current workbench runtime. It accepts raw, loosely typed inputs from API responses, socket state, transcript messages, adoption snapshots, and reading projection data, then derives one `WorkspaceRuntimeState`.

The model separates:

- `connection`: socket/API connectivity only.
- `work`: active work id/title/readiness only.
- `session`: active session/resume/welcome eligibility only.
- `adoption`: deduplicated pending/resolved artifact ids and preserved artifact payloads.
- `readingProjection`: projection availability and active chapter only.
- `task`: long-run task runtime status.
- `ui`: author-facing labels derived from the normalized state.

## Invariants

1. `work.status = ready` must not render author-facing "未连接".
2. Restored transcript or non-empty transcript must suppress the workspace welcome message.
3. Resolved artifacts take precedence over pending artifacts.
4. Pending adoption count is derived from unresolved unique artifact ids.
5. Resolved adoption cards render as decision records, not pending operation cards.
6. Empty reading projection renders an empty state, not fake chapters.
7. Work and Reading Mode title fallback is always "当前作品" when raw title is empty, placeholder, failed, or internal.
8. Connection, work, and session state remain separate and are never inferred from each other.

## Unified Derivation Points

| Derived Value | Selector |
|---|---|
| Visible work title | `getVisibleWorkTitle(state)` |
| Welcome eligibility | `shouldShowWelcomeMessage(state)` |
| Pending adoption count | `getPendingAdoptionCount(state)` |
| Artifact resolved state | `isArtifactResolved(state, artifactId)` |
| Disconnected badge visibility | `shouldShowDisconnectedBadge(state)` |
| Reading projection status | `getReadingProjectionStatus(state)` |

## Current Consumers

- `WorkspaceChat`: top work title, welcome injection, pending count, resolved-card gating, slice verifier UI probe.
- `AdoptionCard`: receives resolved decision data derived from runtime adoption state.
- `StructurePanel`: receives the runtime-filtered unresolved pending artifacts.
- `ReadingMode`: derives title, projection empty/ready/failed state, and active chapter from runtime state.
