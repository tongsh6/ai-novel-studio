import test from "node:test";
import assert from "node:assert/strict";
import { turnMatchesMessage } from "./lib/native_ui/adoption_contract.mjs";

test("AU08 agent step turn_result 通过 parent_turn_ref 关联源消息", () => {
  const turnId = "message_source";
  assert(turnMatchesMessage({ turn_id: `${turnId}:agent:5`, agent_run: { parent_turn_ref: turnId } }, turnId));
  assert(turnMatchesMessage({ turn_id: turnId }, turnId));
  assert(!turnMatchesMessage({ turn_id: "message_other:agent:5", agent_run: { parent_turn_ref: "message_other" } }, turnId));
  assert(!turnMatchesMessage(null, turnId));
});
