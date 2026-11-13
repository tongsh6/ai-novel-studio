// B84 A2：AU-15 准备检查的纯判定测试。
// 运行：node --test scripts/lib/quality/au15_preregistration_check.test.mjs
//
// 只调用内存输入 → 纯判定；不初始化 scope、不创建 bin/子进程、不读真实
// artifacts/预注册/场景。期望值均为本文件独立字面值，不从 SUT 导出常量。

import test from "node:test";
import assert from "node:assert/strict";
import { evaluateReadiness } from "../../au15_preregistration_check.mjs";
import { inputFixture } from "./au15_preregistration_fixture.mjs";

function checkOf(report, id) {
  return report.checks.find((check) => check.id === id);
}

function reportOf(mutate) {
  const inputs = inputFixture();
  if (mutate) mutate(inputs);
  return evaluateReadiness(inputs);
}

test("默认 v1 合成材料：预算/单槽/身份/准备态 ready，D6-A blocked，资源窗口/作者裁决 unknown", () => {
  const report = reportOf();

  assert.equal(report.schema, "au15-prep-readiness/v1");
  assert.equal(report.mode, "preparation_only_no_model_no_provider_no_product_write");
  assert.equal(report.overall, "not_ready");
  assert.equal(checkOf(report, "preregistration_schema").status, "ready");
  assert.equal(checkOf(report, "single_slot_unload").status, "ready");
  assert.equal(checkOf(report, "budget_matches_v1").status, "ready");
  assert.equal(checkOf(report, "no_run_until_declared").status, "ready");
  assert.equal(checkOf(report, "evidence_matrix_declared").status, "ready");
  assert.equal(checkOf(report, "harness_files_exist").status, "ready");
  assert.equal(checkOf(report, "prereg_model_matches_scenario").status, "ready");
  assert.equal(checkOf(report, "scenario_preparation_declared").status, "ready");
  assert.equal(checkOf(report, "d6a_precondition").status, "blocked");
  assert.equal(checkOf(report, "b39_d6a_setup").status, "blocked");
  assert.equal(checkOf(report, "author_semantic_review").status, "unknown");
  assert.equal(checkOf(report, "resource_window").status, "unknown");
  assert.ok(report.blockers.includes("d6a_precondition"));
  assert.ok(report.blockers.includes("author_semantic_review"));
  assert.ok(report.blockers.includes("resource_window"));
  assert.ok(report.blockers.includes("b39_d6a_setup"));
  assert.equal(checkOf(report, "budget_frozen"), undefined, "旧标签不能冒充已冻结");
  assert.equal(
    checkOf(report, "scenario_blocked_and_strata"),
    undefined,
    "旧名字不得保留兼容别名",
  );
});

test("资源窗口：无论是否出现声明词都只是 unknown，不借词的有无编造授权/占用状态", () => {
  const declared = reportOf();
  assert.equal(checkOf(declared, "resource_window").status, "unknown");
  assert.ok(declared.blockers.includes("resource_window"));
  assert.match(
    checkOf(declared, "resource_window").evidence,
    /声明了作者授权资源窗口/u,
    "有声明词时只记录要求存在",
  );
  assert.doesNotMatch(
    checkOf(declared, "resource_window").evidence,
    /尚未满足/u,
    "条件声明不能推出未满足",
  );

  const absent = reportOf((inputs) => {
    inputs.prereg.no_run_until = ["窗口待定", "D6-A 前置完成", "预注册复核"];
  });
  assert.equal(checkOf(absent, "resource_window").status, "unknown");
  assert.ok(absent.blockers.includes("resource_window"));
  assert.match(
    checkOf(absent, "resource_window").evidence,
    /未声明作者授权资源窗口/u,
    "无声明词时只记录要求缺失",
  );
  assert.equal(absent.overall, "not_ready");
});

test("四项 unknown（D6-A 未见声明、无作者裁决、无资源窗口完成事实、setup 未完成）不得 ready", () => {
  const report = reportOf((inputs) => {
    delete inputs.scenario.setup.d6a_precondition;
    inputs.prereg.no_run_until = ["资源窗口待定", "D6-A 前置完成", "预注册复核"];
  });

  for (const id of [
    "d6a_precondition",
    "author_semantic_review",
    "resource_window",
    "b39_d6a_setup",
  ]) {
    assert.equal(checkOf(report, id)?.status, "unknown", `${id} 必须保留 unknown 真实状态`);
    assert.ok(report.blockers.includes(id), `${id} 必须是阻止 ready 的检查`);
  }
  assert.equal(report.overall, "not_ready");
  assert.ok(report.checks.every((check) => ["ready", "blocked", "unknown"].includes(check.status)));
});

test("显式缺 D6-A 前置声明：d6a_precondition 为 unknown 且整体不能 ready", () => {
  const report = reportOf((inputs) => {
    delete inputs.scenario.setup.d6a_precondition;
  });

  assert.equal(checkOf(report, "d6a_precondition").status, "unknown");
  assert.equal(checkOf(report, "b39_d6a_setup").status, "unknown");
  assert.ok(report.blockers.includes("d6a_precondition"));
  assert.equal(report.overall, "not_ready");
});

test("身份声明：核对 default_provider、已声明的 setup.provider 与 model，不固定 strata/iq3_s", () => {
  const inputs = inputFixture();
  inputs.prereg.model = { ...inputs.prereg.model, provider: "local-x", model: "m1" };
  inputs.scenario.default_provider = "local-x";
  inputs.scenario.setup.provider = "local-x";
  inputs.scenario.setup.model = "m1";
  const matched = evaluateReadiness(inputs);
  assert.equal(checkOf(matched, "prereg_model_matches_scenario").status, "ready");

  const absentSetupProvider = reportOf((value) => {
    delete value.scenario.setup.provider;
  });
  assert.equal(
    checkOf(absentSetupProvider, "prereg_model_matches_scenario").status,
    "ready",
    "未声明 setup.provider 时不发明新的必填字段",
  );

  const conflict = reportOf((value) => {
    value.scenario.setup.provider = "different-provider";
  });
  const conflictCheck = checkOf(conflict, "prereg_model_matches_scenario");
  assert.equal(conflictCheck.status, "blocked", "已声明的 setup.provider 与预注册/default 不一致必须 blocked");
  assert.match(conflictCheck.evidence, /setup_provider/u);
  assert.ok(conflict.blockers.includes("prereg_model_matches_scenario"));

  const emptySetupProvider = reportOf((value) => {
    value.scenario.setup.provider = "";
  });
  assert.equal(checkOf(emptySetupProvider, "prereg_model_matches_scenario").status, "blocked");

  const mismatch = reportOf((value) => {
    value.prereg.model = { ...value.prereg.model, provider: "other-provider" };
  });
  assert.equal(checkOf(mismatch, "prereg_model_matches_scenario").status, "blocked");

  for (const [provider, model] of [
    ["", "iq3_s"],
    ["strata", ""],
    [undefined, "iq3_s"],
  ]) {
    const blank = reportOf((value) => {
      value.prereg.model = { ...value.prereg.model, provider, model };
    });
    assert.equal(checkOf(blank, "prereg_model_matches_scenario").status, "blocked");
  }
});

test("预算不符：只声称声明值与 v1 约定不符，不放过预算检查", () => {
  const report = reportOf((inputs) => {
    inputs.prereg.budget = { ...inputs.prereg.budget, turn_timeout_ms: 1 };
  });

  assert.equal(checkOf(report, "budget_matches_v1").status, "blocked");
  assert.ok(report.blockers.includes("budget_matches_v1"));
  assert.equal(report.overall, "not_ready");
});

test("schema/所需证据/no_run_until/harness 缺项均 blocked", () => {
  const report = reportOf((inputs) => {
    inputs.prereg.schema = "au15-cp1-preregistration/v2";
    inputs.prereg.model = { ...inputs.prereg.model, single_slot: false };
    inputs.prereg.evidence = { required: [] };
    inputs.prereg.no_run_until = ["只有一项"];
    inputs.harnessFiles[0].exists = false;
  });

  assert.equal(checkOf(report, "preregistration_schema").status, "blocked");
  assert.equal(checkOf(report, "single_slot_unload").status, "blocked");
  assert.equal(checkOf(report, "evidence_matrix_declared").status, "blocked");
  assert.equal(checkOf(report, "no_run_until_declared").status, "blocked");
  assert.equal(checkOf(report, "harness_files_exist").status, "blocked");
  assert.equal(report.overall, "not_ready");
});

test("缺失 setup/evidence/model 的合法 mapping：判 unknown/blocked，不以 TypeError 替代准备报告", () => {
  const noSetup = reportOf((inputs) => {
    delete inputs.scenario.setup;
  });
  assert.equal(noSetup.overall, "not_ready");
  assert.equal(checkOf(noSetup, "scenario_preparation_declared").status, "ready");
  assert.equal(checkOf(noSetup, "d6a_precondition").status, "unknown");
  assert.equal(checkOf(noSetup, "b39_d6a_setup").status, "unknown");
  assert.equal(checkOf(noSetup, "prereg_model_matches_scenario").status, "blocked");

  const noEvidence = reportOf((inputs) => {
    delete inputs.prereg.evidence;
  });
  assert.equal(checkOf(noEvidence, "evidence_matrix_declared").status, "blocked");

  const noModel = reportOf((inputs) => {
    delete inputs.prereg.model;
  });
  assert.equal(checkOf(noModel, "single_slot_unload").status, "blocked");
  assert.equal(checkOf(noModel, "prereg_model_matches_scenario").status, "blocked");
  assert.equal(noModel.overall, "not_ready");
});

test("准备态声明与身份判定分离：身份空/缺失只由模型声明检查负责", () => {
  const active = reportOf((inputs) => {
    inputs.scenario.status = "active";
  });
  assert.equal(checkOf(active, "scenario_preparation_declared").status, "blocked");

  for (const mutate of [
    (inputs) => {
      inputs.scenario.default_provider = "";
    },
    (inputs) => {
      inputs.scenario.setup.model = "";
    },
  ]) {
    const report = reportOf(mutate);
    assert.equal(
      checkOf(report, "scenario_preparation_declared").status,
      "ready",
      "身份非空/一致性不得在准备态检查里重复判定",
    );
    assert.equal(checkOf(report, "prereg_model_matches_scenario").status, "blocked");
    assert.equal(report.overall, "not_ready");
  }
});

test("D6-A 未满足时报告只描述输入声明，不推断实现能力分账", () => {
  const report = reportOf();
  assert.match(checkOf(report, "d6a_precondition").evidence, /未满足/u);
  assert.match(checkOf(report, "b39_d6a_setup").evidence, /缺少完成证据/u);
  assert.doesNotMatch(
    checkOf(report, "b39_d6a_setup").evidence,
    /分账/u,
    "不得从输入推出实现是否支持 setup/测量分账",
  );
});

test("报告原样转录 prereg.status 作为声明，不据此产生完成/授权证据", () => {
  const report = reportOf();
  assert.equal(report.preregistration.status, "blocked_pending_author_resource_and_setup");
  assert.equal(Object.hasOwn(report, "frozen"), false);
  assert.equal(Object.hasOwn(report, "authorization"), false);
  assert.equal(Object.hasOwn(report, "run_authorized"), false);

  const missing = reportOf((inputs) => {
    delete inputs.prereg.status;
  });
  assert.equal(missing.preregistration.status, undefined);
  assert.equal(JSON.stringify(missing.preregistration).includes('"status"'), false);
  assert.equal(checkOf(missing, "resource_window").status, "unknown");
  assert.equal(missing.overall, "not_ready");
});
