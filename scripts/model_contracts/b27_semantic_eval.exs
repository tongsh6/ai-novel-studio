# B27 CP0 语义评估运行器（骨架）
#
# 作用：对预注册案例做**单 episode 单轮请求回放**，落逐例结果 JSON，字段覆盖 B27 §6.1
# rubric 判定所需（输入、snapshot hash、响应工具/文本、材料、允许路径命中、禁行为、
# 耗时、调用计数）。本骨架不实现自动判分；最终语义判定由 CP4 按案例卡 rubric 盲评。
#
# 用法（不污染默认 test DB；快照回放不写 DB，但沿用隔离 DB 环境避免任何意外写）：
#
#   MIX_ENV=test NOVEL_TEST_DB_DIR=artifacts/model-contracts/b27-cp0/db MIX_TEST_PARTITION=b27cp0 \
#     mix run scripts/model_contracts/b27_semantic_eval.exs --case M01 --provider stub
#
#   # 真实 provider（LM Studio 本地；首次 JIT 加载慢，必须给 ≥300s 超时）
#   NOVEL_LMSTUDIO_TIMEOUT_MS=600000 MIX_ENV=test \
#   NOVEL_TEST_DB_DIR=artifacts/model-contracts/b27-cp0/db MIX_TEST_PARTITION=b27cp0 \
#     mix run scripts/model_contracts/b27_semantic_eval.exs --case M01 --provider lmstudio
#
#   # stage 实际 provider/model（Strata 统一推理后台，默认已加载 iq3_s）
#   MIX_ENV=test NOVEL_TEST_DB_DIR=artifacts/model-contracts/b27-cp0/db MIX_TEST_PARTITION=b27cp0 \
#     mix run scripts/model_contracts/b27_semantic_eval.exs --case M01 --provider strata
#
#   # 只看定义/完整性，不调用 provider
#   ... --check-snapshots
#
# 参数：
#   --case ID[,ID]    案例（可多次）；默认 M01；--all 表示全部 20 例
#   --surface judgment|plan  快照请求面（SP01 用 plan，其余默认 judgment）
#   --provider stub|lmstudio|strata|deepseek   默认 stub
#   --arm old_rules|integrated   默认 old_rules；integrated 仅占位（B27 CP3 后填）
#   --runs N          重复次数（默认 1；§6.1 门槛执行时用 2）
#   --out DIR         结果输出目录（默认 artifacts/model-contracts/b27-cp0/runs）
#   --check-snapshots 只校验快照 hash（不调用 provider）
#
# 退出码：
#   0 成功（stub 或真实 provider 有响应并落结果）
#   1 provider 调用失败（有错误、不可用）
#   2 用法错误 / 快照缺失 / 完整性校验失败
#   3 blocked（凭据缺失 / integrated 臂未就绪 / 快照不可用）
#
# 边界：
#   - stub 结果只证明管道/字段/解析，**不是语义证据**（semantic_evidence=false）。
#   - 回放对象是 CP0 冻结的 messages/tools/tool_choice；L0 身份按冻结快照还原，
#     不由 Gateway 重新注入，保证旧规则臂字节不变。
#   - 单轮回放不产生探索/候选/采纳副作用，也不代表整个 episode 完成。

defmodule B27SemanticEval do
  @moduledoc false

  alias NovelAgent.Provider.{Execution, InferenceParams, SystemIdentity}
  alias NovelApplication.JudgmentToolContract

  @root Path.expand("../..", __DIR__)
  @fixtures_rel "quality/acceptance/fixtures/b27-semantic-cases"
  @fixtures Path.join(@root, @fixtures_rel)
  @cases_path Path.join(@fixtures, "cases.yml")
  @snapshots_dir Path.join(@fixtures, "snapshots")
  @default_out Path.join(@root, "artifacts/model-contracts/b27-cp0/runs")

  # 必验模型（与 cases.yml required_models 对齐；runner 用其解析 provider/model）
  @models %{
    "stub" => %{provider: :stub, model: "stub"},
    "lmstudio" => %{provider: :lmstudio, model: "qwen3.8-flash-next@q2_k"},
    "strata" => %{provider: :strata, model: "iq3_s"},
    "deepseek" => %{provider: :deepseek, model: "deepseek-v4-pro"}
  }

  # 首轮允许/条件路径（runner 级辅助判定；最终以案例卡 rubric 盲评为准）
  @paths %{
    "M01" => %{allowed: [:explore], conditional: [:reply]},
    "M02" => %{allowed: [:reply], conditional: []},
    "M03" => %{allowed: [:explore], conditional: []},
    "M04" => %{allowed: [:reply, :execute], conditional: []},
    "M05" => %{allowed: [:explore, :reply], conditional: []},
    "M06" => %{allowed: [:explore, :ask_author], conditional: [:reply]},
    "M07" => %{allowed: [:execute], conditional: [:explore]},
    "M08" => %{allowed: [:execute], conditional: [:explore]},
    "M09" => %{allowed: [:creative_directions, :reply], conditional: []},
    "M10" => %{allowed: [:reply], conditional: []},
    "M11" => %{allowed: [:register_author_content], conditional: [:explore]},
    "M12" => %{allowed: [:register_author_content], conditional: [:explore]},
    "M13" => %{allowed: [:reply], conditional: []},
    "M14" => %{allowed: [:report_capability_gap, :explore], conditional: [:reply]},
    "M15" => %{allowed: [:execute], conditional: [:explore]},
    "M16" => %{allowed: [:explore, :reply, :execute], conditional: []},
    "M17" => %{allowed: [:explore, :ask_author, :reply], conditional: []},
    "M18" => %{allowed: [:explore, :ask_author], conditional: [:reply]},
    "M19" => %{allowed: [:reply, :explore], conditional: []},
    "M20" => %{allowed: [:reply, :explore], conditional: []},
    "SP01" => %{allowed: [:plan_draft], conditional: []}
  }

  def main(argv) do
    opts = parse_args(argv)

    if opts.check_snapshots do
      check_snapshots(opts)
    else
      run(opts)
    end
  end

  # 手写参数解析（OptionParser 的 :keep 语义在数值/多值混用时不直观，显式更可靠）。
  defp parse_args(argv) do
    parsed = parse_flags(argv, %{cases: [], all: false, check_snapshots: false})

    cases =
      cond do
        Map.get(parsed, :all) -> :all
        Map.get(parsed, :cases, []) != [] -> Map.get(parsed, :cases)
        true -> ["M01"]
      end

    %{
      cases: cases,
      provider: Map.get(parsed, :provider) || "stub",
      arm: Map.get(parsed, :arm) || "old_rules",
      runs: max(Map.get(parsed, :runs) || 1, 1),
      out: Map.get(parsed, :out) || @default_out,
      surface: Map.get(parsed, :surface),
      check_snapshots: Map.get(parsed, :check_snapshots) || false
    }
  end

  defp parse_flags([], acc), do: acc

  defp parse_flags([flag | rest], acc) do
    {name, inline_value} =
      case String.split(flag, "=", parts: 2) do
        [name, value] -> {name, value}
        [name] -> {name, nil}
      end

    case name do
      "--all" ->
        parse_flags(rest, Map.put(acc, :all, true))

      "--check-snapshots" ->
        parse_flags(rest, Map.put(acc, :check_snapshots, true))

      "--case" ->
        {value, rest} = value_or_next(inline_value, rest)
        cases = acc.cases ++ String.split(value || "", ",", trim: true)
        parse_flags(rest, Map.put(acc, :cases, cases))

      "--provider" ->
        {value, rest} = value_or_next(inline_value, rest)
        parse_flags(rest, Map.put(acc, :provider, value))

      "--arm" ->
        {value, rest} = value_or_next(inline_value, rest)
        parse_flags(rest, Map.put(acc, :arm, value))

      "--out" ->
        {value, rest} = value_or_next(inline_value, rest)
        parse_flags(rest, Map.put(acc, :out, value))

      "--surface" ->
        {value, rest} = value_or_next(inline_value, rest)
        parse_flags(rest, Map.put(acc, :surface, value))

      "--runs" ->
        {value, rest} = value_or_next(inline_value, rest)
        runs = case Integer.parse(value || "") do
          {n, _} -> n
          :error -> 1
        end
        parse_flags(rest, Map.put(acc, :runs, runs))

      other ->
        IO.puts("[b27-eval] 未知参数: #{other}")
        System.halt(2)
    end
  end

  defp value_or_next(nil, [value | rest]), do: {value, rest}
  defp value_or_next(nil, []), do: {nil, []}
  defp value_or_next(value, rest), do: {value, rest}

  # ── 快照完整性（不调用 provider） ───────────────────────────────────────

  defp check_snapshots(opts) do
    manifest = read_yaml!(@cases_path)
    cases = get(manifest, "cases") || []
    ids = case_ids(opts, cases)

    results =
      Enum.map(ids, fn id ->
        case load_snapshot(id, opts.surface) do
          {:ok, snap} ->
            integrity = integrity(snap)
            %{id: id, ok: get(integrity, "verified") == true, detail: integrity}

          {:error, reason} ->
            %{id: id, ok: false, detail: %{error: inspect(reason)}}
        end
      end)

    bad = Enum.reject(results, & &1.ok)

    Enum.each(results, fn r ->
      IO.puts("[b27-eval] #{r.id}: #{if r.ok, do: "integrity ok", else: "FAIL #{inspect(r.detail)}"}")
    end)

    IO.puts("[b27-eval] integrity: #{length(results) - length(bad)}/#{length(results)} ok")

    if bad != [], do: System.halt(2)
  end

  # ── 主流程 ──────────────────────────────────────────────────────────────

  defp run(opts) do
    if opts.arm == "integrated" do
      IO.puts("""
      [b27-eval] BLOCKED: integrated_arm 尚未就绪。
        integrated_arm 由 B27 CP3 完成专业调用整合后，用 scripts/b27_case_freeze.exs
        重算并登记（见 #{@fixtures_rel}/arms.yml）。本轮 CP0 只允许 old_rules_arm 回放。
      """)

      System.halt(3)
    end

    unless Map.has_key?(@models, opts.provider) do
      IO.puts("[b27-eval] 未知 provider: #{opts.provider}（可用：#{Map.keys(@models) |> Enum.join("|")}）")
      System.halt(2)
    end

    if opts.provider == "lmstudio" and lmstudio_timeout_ms() < 120_000 do
      IO.puts("""
      [b27-eval] 拒绝运行：LM Studio 超时太短（当前 #{lmstudio_timeout_ms()}ms）。
        首次 JIT 加载可能数百秒，必须显式设置 ≥300000：
          NOVEL_LMSTUDIO_TIMEOUT_MS=600000 MIX_ENV=test ... mix run scripts/model_contracts/b27_semantic_eval.exs --provider lmstudio
      """)

      System.halt(2)
    end

    model_cfg = Map.fetch!(@models, opts.provider)

    if opts.provider == "deepseek" and not deepseek_credential?() do
      IO.puts("""
      [b27-eval] BLOCKED: deepseek 需要真实凭据（DEEPSEEK_API_KEY / NOVEL_DEEPSEEK_API_KEY）。
        本机未配置；该候选必验模型记为 blocked（不伪造可用）。
      """)

      System.halt(3)
    end

    configure_model(model_cfg)

    manifest = read_yaml!(@cases_path)
    cases = get(manifest, "cases") || []
    ids = case_ids(opts, cases)
    File.mkdir_p!(opts.out)

    results =
      Enum.flat_map(ids, fn id ->
        Enum.map(1..opts.runs, fn run_index ->
          run_single(id, opts, run_index, model_cfg)
        end)
      end)

    summary = summarize(results, opts)
    File.write!(Path.join(opts.out, "summary-#{stamp()}.json"), Jason.encode!(summary, pretty: true))
    print_summary(summary)

    if Enum.any?(results, &(&1["status"] == "provider_error")), do: System.halt(1)
    if Enum.all?(results, &(&1["status"] == "blocked")), do: System.halt(3)
  end

  defp case_ids(opts, cases) do
    cond do
      opts.cases == :all -> Enum.map(cases, &get(&1, "id"))
      true -> opts.cases
    end
  end

  defp run_single(case_id, opts, run_index, model_cfg) do
    case load_snapshot(case_id, opts.surface) do
      {:ok, snap} ->
        integrity = integrity(snap)
        result = execute_replay(case_id, snap, integrity, opts, run_index, model_cfg)
        path = Path.join(opts.out, "#{case_id}-#{opts.provider}-run#{run_index}.json")
        File.write!(path, Jason.encode!(result, pretty: true) <> "\n")
        Map.put(result, "result_path", path)

      {:error, reason} ->
        %{
          "schema" => "b27-semantic-eval-result-v1",
          "case_id" => case_id,
          "status" => "blocked",
          "blocked_reason" => "snapshot_unavailable: #{inspect(reason)}",
          "arm" => opts.arm,
          "provider" => opts.provider
        }
    end
  end

  defp load_snapshot(case_id, surface) do
    expected = if surface == "plan" or String.starts_with?(case_id, "SP"), do: "SP01-plan", else: case_id
    path = Path.join(@snapshots_dir, "#{expected}.json")

    cond do
      not File.exists?(path) ->
        {:error, {:snapshot_missing, path}}

      true ->
        doc = path |> File.read!() |> Jason.decode!()
        {:ok, Map.put(doc, "_path", path)}
    end
  end

  defp integrity(snap) do
    {request, expected_hash} =
      cond do
        is_map(get(snap, "request")) ->
          {get(snap, "request"), get(get(snap, "hashes") || %{}, "request_sha256")}

        is_map(get(snap, "requests")) ->
          request = get(get(snap, "requests"), "plan_draft") || get(get(snap, "requests"), "judgment")
          {request, get(get(snap, "hashes") || %{}, "plan_request_sha256")}

        true ->
          {nil, nil}
      end

    actual = if request, do: sha256(canonical_json(request)), else: nil

    %{
      "snapshot_path" => get(snap, "_path"),
      "frozen_request_sha256" => expected_hash,
      "actual_request_sha256" => actual,
      "verified" => is_binary(expected_hash) and actual == expected_hash,
      "case_id" => get(snap, "case_id") || get(snap, "probe_id"),
      "arm_slot" => get(get(snap, "arm") || %{}, "slot"),
      "call_surface" => get(snap, "call_surface")
    }
  end

  defp execute_replay(case_id, snap, integrity, opts, run_index, model_cfg) do
    request = get(snap, "request") || get(get(snap, "requests"), "plan_draft")

    if is_nil(request) do
      %{
        "schema" => "b27-semantic-eval-result-v1",
        "case_id" => case_id,
        "status" => "invalid_snapshot",
        "arm" => opts.arm
      }
    else
      prompt = build_prompt(request)
      params = InferenceParams.new(temperature: get(get(request, "inference"), "temperature") || 0.2)
      started = System.monotonic_time(:millisecond)

      outcome =
        try do
          Execution.complete(prompt,
            provider: model_cfg.provider,
            purpose: :planner,
            content_visibility: :author,
            params: params
          )
        rescue
          error -> {:error, %{message: Exception.message(error), reason_code: :runner_exception}}
        catch
          kind, reason -> {:error, %{message: inspect({kind, reason}), reason_code: :runner_exception}}
        end

      duration = System.monotonic_time(:millisecond) - started
      build_result(case_id, snap, integrity, opts, run_index, model_cfg, prompt, outcome, duration)
    end
  end

  # 冻结快照 → 可回放 prompt：
  # - messages[0] 是 CP0 冻结的 L0 身份消息（重建 metadata 让 Gateway 幂等识别、不重复注入）
  # - 其余消息按冻结内容逐字回放；tools/tool_choice 原样
  defp build_prompt(request) do
    messages = get(request, "messages") || []
    identity_meta = get(request, "system_identity") || %{}
    {first, rest} = List.pop_at(messages, 0)

    restored =
      case first do
        %{"role" => "system"} ->
          [
            %{
              role: "system",
              content: get(first, "content"),
              metadata: %{
                system_identity: %{
                  version: get(identity_meta, "version") || SystemIdentity.version(),
                  content_hash: get(identity_meta, "content_hash") || SystemIdentity.content_hash()
                }
              }
            }
            | Enum.map(rest, fn m -> %{role: get(m, "role"), content: get(m, "content")} end)
          ]

        _ ->
          Enum.map(messages, fn m -> %{role: get(m, "role"), content: get(m, "content")} end)
      end

    %{
      messages: restored,
      tools: get(request, "tools") || [],
      tool_choice: get(request, "tool_choice") || "auto"
    }
  end

  defp build_result(case_id, snap, integrity, opts, run_index, model_cfg, _prompt, outcome, duration) do
    base = %{
      "schema" => "b27-semantic-eval-result-v1",
      "generated_at" => DateTime.utc_now() |> DateTime.to_iso8601(),
      "case_id" => case_id,
      "run_index" => run_index,
      "arm" => opts.arm,
      "provider" => to_string(model_cfg.provider),
      "requested_model" => model_cfg.model,
      "call_surface" => integrity["call_surface"] || "judgment",
      "snapshot" => integrity,
      "workspace_arm" => workspace_arm_check(),
      "materials" => material_summary(snap),
      "episode" => %{
        "rounds_planned" => 2,
        "rounds_executed" => 1,
        "episode_complete" => false,
        "note" => "CP0 骨架只回放冻结的首轮请求；必要探索/后续轮由 CP4 episode driver 承接"
      }
    }

    case outcome do
      {:ok, %NovelAgent.Provider.Result{} = result} ->
        decision = classify(result, integrity["call_surface"])
        contract = contract_validation(result)
        paths = Map.get(@paths, case_id, %{allowed: [], conditional: []})
        flags = get(snap, "flags") || %{}

        unnecessary_question =
          decision["decision"] == "ask_author" and truthy(get(flags, "unnecessary_question_counted"))

        zero_tolerance = zero_tolerance_candidates(case_id, decision)

        j = %{
          "decision" => decision["decision"],
          "detail" => decision["detail"],
          "tool_calls" => Enum.map(result.tool_calls, &tool_call_doc/1),
          "contract_validation" => contract,
          "allowed_first_round_hit" => decision["decision"] in Enum.map(paths.allowed, &to_string/1),
          "allowed_first_round" => Enum.map(paths.allowed, &to_string/1),
          "conditional_first_round" => Enum.map(paths.conditional, &to_string/1),
          "unnecessary_question" => unnecessary_question,
          "zero_tolerance_candidates" => zero_tolerance,
          "requires_rubric_review" => true
        }

        method =
          if opts.provider == "stub" do
            %{
              "semantic_evidence" => false,
              "pipeline_only" => true,
              "note" => "生产 Stub adapter 响应；只证明管道/字段/解析，不构成 §6.1 语义证据"
            }
          else
            %{
              "semantic_evidence" => true,
              "pipeline_only" => false,
              "note" => "真实 provider 单轮响应；语义通过与否由 CP4 按案例卡 rubric 盲评判卷"
            }
          end

        base
        |> Map.merge(%{
          "status" => "ok",
          "response" => %{
            "content" => result.content,
            "content_chars" => chars(result.content),
            "finish_reason" => result.provider_output && get(result.provider_output, :output_type),
            "duration_ms" => duration,
            "provider_calls" => 1
          },
          "provider_facts" => %{
            "model" => model_from_output(result),
            "provider_run_ref" => result.provider_run_ref,
            "provider_call_ref" => result.provider_call_ref,
            "provider_latency_ms" => provider_latency_ms(result),
            "usage" => result.usage && (if is_struct(result.usage), do: Map.from_struct(result.usage), else: result.usage)
          },
          "judgment" => j,
          "method" => method
        })

      {:error, error} ->
        base
        |> Map.merge(%{
          "status" => "provider_error",
          "error" => normalize_error(error),
          "duration_ms" => duration,
          "method" => %{
            "semantic_evidence" => false,
            "pipeline_only" => true,
            "note" => "provider 调用失败；按 §6.1 计未成功，不删分母"
          }
        })
    end
  end

  defp material_summary(snap) do
    materials = get(snap, "materials") || %{}
    facts = get(materials, "prompt_facts") || %{}

    %{
      "author_text" => get(materials, "author_text"),
      "chapter_index" => get(materials, "chapter_index") || [],
      "pending_adoptions" => get(materials, "pending_adoptions") || [],
      "adopted_content_targets" => get(materials, "adopted_content_targets") || [],
      "interaction_state" => get(materials, "interaction_state") || %{},
      "supplied_context_refs" => get(materials, "supplied_context_refs") || [],
      "explore_tools" => get(facts, "explore_tools") || [],
      "capabilities" => get(facts, "capabilities") || [],
      "prompt_chars" => get(facts, "prompt_chars")
    }
  end

  # ── 响应判定辅助（非最终判分） ──────────────────────────────────────────

  # 计划面探针（SP01-plan）期望计划起草响应，不是判断决策。
  defp classify(%NovelAgent.Provider.Result{tool_calls: [call]}, "plan") do
    name = get(call, :name) || get(call, "name")

    if name == "agent_plan_draft",
      do: %{"decision" => "plan_draft", "detail" => "agent_plan_draft"},
      else: classify(%NovelAgent.Provider.Result{tool_calls: [call]}, "judgment")
  end

  defp classify(%NovelAgent.Provider.Result{tool_calls: []} = result, _surface) do
    if chars(result.content) > 0,
      do: %{"decision" => "reply", "detail" => "no_tool_plain_text"},
      else: %{"decision" => "empty_response", "detail" => "no_tool_empty_content"}
  end

  defp classify(%NovelAgent.Provider.Result{tool_calls: [call]}, _surface) do
    name = get(call, :name) || get(call, "name")
    args = get(call, :arguments) || get(call, "arguments") || %{}

    case name do
      "judgment_decision" -> %{"decision" => get(args, "action") || get(args, :action), "detail" => name}
      "continuation_decision" -> %{"decision" => "continue", "detail" => name}
      "ask_author" -> %{"decision" => "ask_author", "detail" => name}
      "register_author_content" -> %{"decision" => "register_author_content", "detail" => name}
      "propose_creative_directions" -> %{"decision" => "creative_directions", "detail" => name}
      "report_capability_gap" -> %{"decision" => "capability_gap", "detail" => name}
      "agent_plan_draft" -> %{"decision" => "invalid_combination", "detail" => "agent_plan_draft without judgment_decision.plan"}
      other -> %{"decision" => "other_tool", "detail" => other}
    end
  end

  defp classify(%NovelAgent.Provider.Result{tool_calls: calls}, _surface) do
    names = calls |> Enum.map(&(get(&1, :name) || get(&1, "name"))) |> Enum.sort()

    cond do
      names == ["agent_plan_draft", "judgment_decision"] ->
        decision = Enum.find(calls, &((get(&1, :name) || get(&1, "name")) == "judgment_decision"))
        args = get(decision, :arguments) || get(decision, "arguments") || %{}

        if (get(args, "action") || get(args, :action)) == "plan",
          do: %{"decision" => "plan", "detail" => "judgment_decision.plan + agent_plan_draft"},
          else: %{"decision" => "invalid_combination", "detail" => "two tools with non-plan action"}

      true ->
        %{"decision" => "invalid_combination", "detail" => Enum.join(names, "+")}
    end
  end

  defp contract_validation(%NovelAgent.Provider.Result{tool_calls: calls}) do
    case JudgmentToolContract.validate(calls, :judgment) do
      :ok -> %{"ok" => true, "error" => nil}
      {:error, reason} -> %{"ok" => false, "error" => inspect(reason)}
    end
  end

  defp zero_tolerance_candidates(case_id, decision) do
    registered = decision["decision"] == "register_author_content" and case_id not in ["M11", "M12"]
    directions = decision["decision"] == "creative_directions" and case_id != "M09"

    gap =
      decision["decision"] == "capability_gap" and case_id != "M14"

    execute =
      decision["decision"] == "execute" and case_id not in ["M04", "M07", "M08", "M15", "M16"]

    [
      registered && "author_content_registration_without_request",
      directions && "creative_directions_without_request",
      gap && "capability_gap_without_matching_gap_case",
      execute && "execute_without_matching_case_path"
    ]
    |> Enum.filter(& &1)
  end

  defp tool_call_doc(call) do
    %{
      "name" => get(call, :name) || get(call, "name"),
      "arguments" => canonical(get(call, :arguments) || get(call, "arguments"))
    }
  end

  defp model_from_output(%NovelAgent.Provider.Result{usage: usage}) when is_map(usage) do
    get(usage, :model) || get(usage, "model") || get(usage, :model_id) || get(usage, "model_id")
  end

  defp model_from_output(_), do: nil

  defp provider_latency_ms(%NovelAgent.Provider.Result{usage: usage}) when is_map(usage) do
    get(usage, :latency_ms) || get(usage, "latency_ms")
  end

  defp provider_latency_ms(_), do: nil

  defp normalize_error(error) when is_map(error) do
    %{
      "reason_code" => get(error, :reason_code) || get(error, "reason_code") || "provider_error",
      "message" => get(error, :message) || get(error, "message") || inspect(error)
    }
  end

  defp normalize_error(error), do: %{"reason_code" => "provider_error", "message" => inspect(error)}

  # ── 输出 ────────────────────────────────────────────────────────────────

  defp summarize(results, opts) do
    counts = Enum.frequencies_by(results, & &1["status"])
    decisions = Enum.frequencies_by(results, &get(get(&1, "judgment") || %{}, "decision"))

    %{
      "schema" => "b27-semantic-eval-summary-v1",
      "generated_at" => DateTime.utc_now() |> DateTime.to_iso8601(),
      "arm" => opts.arm,
      "provider" => opts.provider,
      "runs" => opts.runs,
      "case_count" => length(results),
      "status_counts" => counts,
      "decision_counts" => decisions,
      "semantic_evidence" => opts.provider != "stub",
      "note" => "单轮回放骨架；§6.1 门槛需 CP4 完整 episode（20×2×2）与盲评判卷",
      "results" => Enum.map(results, &Map.drop(&1, ["materials", "response", "method"])),
      "result_files" => Enum.map(results, &get(&1, "result_path")) |> Enum.reject(&is_nil/1)
    }
  end

  defp print_summary(summary) do
    IO.puts("[b27-eval] arm=#{summary["arm"]} provider=#{summary["provider"]} runs=#{summary["runs"]}")

    Enum.each(summary["results"], fn r ->
      decision = get(get(r, "judgment") || %{}, "decision")
      status = r["status"]
      IO.puts("[b27-eval] #{r["case_id"]} run#{r["run_index"]}: #{status} decision=#{inspect(decision)}")
    end)

    IO.puts("[b27-eval] decisions: #{inspect(summary["decision_counts"])}")
  end

  # ── 当前工作区规则资产 vs 冻结旧规则臂（漂移声明，不阻断回放） ─────────
  defp workspace_arm_check do
    arms_path = Path.join(@fixtures, "arms.yml")

    with true <- File.exists?(arms_path),
         doc = YamlElixir.read_from_file!(arms_path),
         assets when is_list(assets) <- get(doc, "assets") do
      drift =
        assets
        |> Enum.filter(fn asset ->
          path = get(asset, "path")
          abs = Path.join(@root, path)
          expected = get(asset, "sha256")
          not File.exists?(abs) or sha256(File.read!(abs)) != expected
        end)
        |> Enum.map(&get(&1, "path"))

      %{
        "frozen_arm_content_hash" => get(get(doc, "old_rules_arm") || %{}, "arm_content_hash"),
        "workspace_matches_frozen_arm" => drift == [],
        "drift_asset_paths" => drift,
        "note" =>
          "旧规则臂回放使用冻结快照字节；若 drift 非空，说明当前工作区规则已前进（新臂），" <>
            "不影响 old_rules_arm 回放，但 integrated_arm 必须用新 hash 重冻"
      }
    else
      _ -> %{"workspace_matches_frozen_arm" => nil, "note" => "arms.yml 缺失或不可解析"}
    end
  end

  # ── 配置/工具 ───────────────────────────────────────────────────────────

  defp configure_model(%{provider: :stub}), do: :ok

  defp configure_model(%{provider: :strata, model: model}) do
    if is_nil(System.get_env("NOVEL_STRATA_MODEL")) do
      Application.put_env(
        :novel_agent,
        NovelAgent.Provider.Strata,
        (Application.get_env(:novel_agent, NovelAgent.Provider.Strata) || [])
        |> Keyword.put(:model, model)
      )
    end

    :ok
  end

  defp configure_model(%{provider: :lmstudio, model: model}) do
    if is_nil(System.get_env("NOVEL_LMSTUDIO_MODEL")) do
      Application.put_env(
        :novel_agent,
        NovelAgent.Provider.LMStudio,
        (Application.get_env(:novel_agent, NovelAgent.Provider.LMStudio) || [])
        |> Keyword.put(:model, model)
      )
    end

    :ok
  end

  defp configure_model(_), do: :ok

  defp lmstudio_timeout_ms do
    case Integer.parse(System.get_env("NOVEL_LMSTUDIO_TIMEOUT_MS") || "") do
      {value, _} -> value
      :error -> Application.get_env(:novel_agent, NovelAgent.Provider.LMStudio, [])[:timeout] || 5000
    end
  end

  defp deepseek_credential? do
    key =
      System.get_env("DEEPSEEK_API_KEY") || System.get_env("NOVEL_DEEPSEEK_API_KEY") ||
        Application.get_env(:novel_agent, NovelAgent.Provider.DeepSeek, [])[:api_key]

    is_binary(key) and String.trim(key) != ""
  end

  defp read_yaml!(path) do
    YamlElixir.read_from_file!(path)
  rescue
    error ->
      IO.puts("[b27-eval] 无法读取 #{path}: #{Exception.message(error)}")
      System.halt(2)
  end

  defp get(map, key) when is_map(map) do
    cond do
      Map.has_key?(map, key) -> Map.get(map, key)
      Map.has_key?(map, to_string(key)) -> Map.get(map, to_string(key))
      true -> nil
    end
  end

  defp get(_, _), do: nil

  defp truthy(value) when value in [true, "true", 1], do: true
  defp truthy(_), do: false

  defp chars(nil), do: 0
  defp chars(value) when is_binary(value), do: String.length(value)
  defp chars(_), do: 0

  defp sha256(binary), do: :crypto.hash(:sha256, binary) |> Base.encode16(case: :lower)

  defp canonical_json(value), do: value |> canonical() |> Jason.encode!()

  defp canonical(map) when is_map(map) do
    Map.new(map, fn {key, value} -> {to_string(key), canonical(value)} end)
  end

  defp canonical(list) when is_list(list), do: Enum.map(list, &canonical/1)
  defp canonical(value) when is_atom(value) and value not in [true, false, nil], do: Atom.to_string(value)
  defp canonical(value), do: value

  defp stamp do
    DateTime.utc_now() |> Calendar.strftime("%Y%m%d-%H%M%S")
  end
end

B27SemanticEval.main(System.argv())
