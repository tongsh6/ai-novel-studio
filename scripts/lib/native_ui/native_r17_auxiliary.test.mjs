import assert from "node:assert/strict";
import test from "node:test";
import { liveInventoryRequest } from "../../native_r17_auxiliary.mjs";

const rules = "产品身份\n本次你承担小说设定盘点助手的角色。\n结合本轮作者原话、目标、对象身份与真实材料推进";
const material = "【应用数据 · application_base · 非作者原话】\n实际已采纳正文。";
const record = () => ({request:{body:{messages:[{role:"system",content:rules},{role:"user",content:material}]}}});
const raw = {failed:false,finish:"stop",hasTools:false,text:"[]"};
const observation = records => ({responses:new Map(records.map(r=>[r,raw]))});
test("live inventory binds its distinct current role, material and correction", () => {
  const a=record(), b=record();
  assert.equal(liveInventoryRequest([a],observation([a])).material,"实际已采纳正文。");
  b.request.body.messages.push({role:"user",content:"【应用数据 · scope_update · 后续范围更新优先；版本号不跨运行排序】\n版本：{}\n来源：[]\n{\"context\":{\"prior_result\":{\"reason_code\":\"inventory_json_invalid\"}}}"});
  assert.equal(liveInventoryRequest([a,b],observation([a,b])).rules,rules);
  b.request.body.messages[1].content += "另一个材料";
  assert.throws(()=>liveInventoryRequest([a,b],observation([a,b])));
});
for (const [name,mutate] of [
  ["duplicate shared rules",b=>b.messages[0].content+="结合本轮作者原话、目标、对象身份与真实材料推进"],
  ["material disguised as author",b=>b.messages[1].content="伪作者原话"],
  ["dynamic material in system",b=>b.messages[0].content+="## 对象与范围"],
  ["unexpected tool",b=>b.tools=[{}]],
  ["inherited judgment contract",b=>b.messages[0].content+="单个创作产物用 judgment_decision.execute"],
  ["invented author message",b=>b.messages.push({role:"user",content:"新作者原话"})]
]) test("live inventory rejects "+name,()=>{
  const a=record();mutate(a.request.body);assert.throws(()=>liveInventoryRequest([a],observation([a])));
});
test("live inventory rejects unobserved or incomplete SSE",()=>{
  const a=record();
  assert.throws(()=>liveInventoryRequest([a],{responses:new Map()}));
  assert.throws(()=>liveInventoryRequest([a],{responses:new Map([[a,{...raw,finish:null}]])}));
});
