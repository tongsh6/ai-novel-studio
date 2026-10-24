# B26 CP0 隔离对照探针（统一脚本，两臂共用同一份源码）。
#
# 同一份脚本分别运行在两个隔离环境：
#   - 旧协议臂：/tmp/b26-old-cp0（git worktree --detach 60f7c553）内的生产
#     JudgmentProtocol.request_judgment/3（call1 叙事 + call2 forced tool 两段式）
#   - 新协议臂：当前工作区未提交实现的生产 JudgmentProtocol.request_judgment/3
#     （单调用 tool_choice: auto）
#
# 只做协议事实采集：真实 LM Studio HTTP 请求/响应、工具集合、tool_choice、
# profile、合法组合、实际调用次数、耗时/TTFT、超时/失败分类、输出形态、来源字段。
# 不写作品数据、不写库、不替换模型结论；两臂读取同一份冻结 cases.json。
#
# 用法（在对应仓库/工作区根目录）：
#   PHX_SERVER=false MIX_ENV=test MIX_BUILD_PATH=<隔离构建目录> \
#   NOVEL_TEST_DB_DIR=<隔离 db 目录> \
#   NOVEL_LMSTUDIO_MODEL=qwen/qwen3.8-27b NOVEL_LMSTUDIO_MAX_TOKENS=32000 \
#   NOVEL_LOCAL_RESPONSE_TIMEOUT_MS=300000 NOVEL_LOCAL_NON_STREAM_TIMEOUT_MS=300000 \
#   B26_CP0_CASES=<绝对路径>/cases.json B26_CP0_OUT=<输出 json> \
#   mix run scripts/model_contracts/b26_cp0_arm_probe.exs
#
# 环境变量：
#   B26_CP0_CASES             固定案例集 JSON 路径（缺省 artifacts/model-contracts/b26-cp0/cases.json）
#   B26_CP0_OUT               输出 JSON 路径（缺省 artifacts/model-contracts/b26-cp0/<arm>-arm.json）
#   B26_CP0_CASE_TIMEOUT_MS   单例挂钟超时（缺省 600000）
#   B26_CP0_FILTER            只跑逗号分隔的 case id（冒烟用；正式批次不设）
# 退出码：0 正常完成（不设通过阈值）；65 全部案例为连接/可用性阻塞。

alias NovelAgent.Provider.{Execution, Result}
alias NovelApplication.JudgmentProtocol

defmodule ModelContracts.B26Cp0ArmProbe do
  @case_timeout_default 600_000
  @pause_between_cases_ms 2_000
  @pause_after_timeout_ms 10_000
  @old_placeholder_narrative "（探针占位判断说明，仅用于构造 call2 prompt 记录）"

  @blocked_markers [
    "econnrefused",
    "connection refused",
    "connrefused",
    "无法连接",
    "未启动",
    "未配置",
    "unauthorized",
    "401",
    "403",
    "404",
    "model not found",
    "no models loaded"
  ]

  @implementation_files [
    "apps/novel_application/lib/novel_application/judgment_protocol.ex",
    "apps/novel_application/lib/novel_application/judgment_tool_contract.ex",
    "apps/novel_application/lib/novel_application/authoring_task_policy.ex",
    "apps/novel_application/lib/novel_application/agent_narrative_source.ex",
    "apps/novel_application/lib/novel_application/pending_artifact_workflow.ex",
    "apps/novel_application/lib/novel_application/turn_interaction_service.ex",
    "apps/novel_agent/lib/novel_agent/provider/lm_studio.ex",
    "apps/novel_agent/lib/novel_agent/provider/openai_compatible_stream.ex",
    "apps/novel_agent/lib/novel_agent/provider/gateway.ex",
    "apps/novel_agent/lib/novel_agent/provider/execution.ex",
    "apps/novel_agent/lib/novel_agent/provider/timeout_policy.ex"
  ]

  # ── entrypoint ───────────────────────────────

  def main(_argv) do
    Process.flag(:trap_exit, true)
    arm = detect_arm()
    cases_path = env("B26_CP0_CASES") || "artifacts/model-contracts/b26-cp0/cases.json"
    out_path = env("B26_CP0_OUT") || "artifacts/model-contracts/b26-cp0/#{arm}-arm.json"

    cases_doc = load_json!(cases_path)
    cases = filter_cases(cases_doc["cases"])
    shared = shared_options(cases_doc["shared_options"])
    context_blocks = cases_doc["context_blocks"] || %{}
    capture = start_capture()
    install_capture(capture)

    IO.puts(
      "[b26-cp0] arm=#{arm} cases=#{length(cases)} cases_file=#{cases_path} out=#{out_path} " <>
        "case_timeout_ms=#{case_timeout_ms()}"
    )

    results =
      Enum.map(cases, fn case_map -> run_case(arm, case_map, shared, context_blocks, capture) end)

    summary = %{
      "probe" => "b26-cp0-arm-probe",
      "arm" => arm,
      "arm_label" => arm_label(arm),
      "generated_at" => DateTime.utc_now() |> DateTime.to_iso8601(),
      "probe_script_sha256" => sha256(File.read!(__ENV__.file)),
      "cases_file" => Path.expand(cases_path),
      "cases_file_sha256" => sha256(File.read!(cases_path)),
      "cases_version" => cases_doc["version"],
      "environment" => environment(arm),
      "timeout_policy" => %{
        "provider_request_timeout_ms" => provider_timeout_ms_effective(),
        "case_wall_clock_ms" => case_timeout_ms(),
        "runs_per_case" => 1,
        "note" =>
          "两臂同口径：local provider response/non-stream 超时 300s（覆盖 B22 local profile 默认 900s/1800s），" <>
            "案例挂钟 600s；超时与失败计入 12 例分母并单列，不剔除。"
      },
      "model_params_effective" => model_params_effective(),
      "cases" => results,
      "denominator" => denominator(results),
      "notes" => [
        "真实 LM Studio provider（OpenAI 兼容端点），未使用 stub 结果冒充模型结论。",
        "两臂读取同一份冻结 cases.json：author_text/context_block/options 完全一致。",
        "请求快照为 provider adapter 实际发出的 wire body（经 log_fn 捕获），不含任何密钥或认证头。",
        "temperature 由各协议实现自定（旧 call1=0.4 / call2=0.2；新单调用=0.2），逐请求记录实际值，不由探针改写。"
      ]
    }

    File.mkdir_p!(Path.dirname(out_path))
    File.write!(out_path, Jason.encode!(summary, pretty: true))
    report(summary, out_path)

    if summary["denominator"]["ok"] == 0 and summary["denominator"]["blocked"] > 0 do
      IO.puts(:stderr, "[b26-cp0] 全部案例为连接/可用性阻塞，登记 BLOCKED")
      System.halt(65)
    end
  end

  # ── arm detection ────────────────────────────

  defp detect_arm do
    Code.ensure_loaded(judgment_protocol_module())

    cond do
      function_exported?(judgment_protocol_module(), :prompt, 2) -> "new"
      function_exported?(judgment_protocol_module(), :narrative_prompt, 1) -> "old"
      true -> "unknown"
    end
  end

  defp judgment_protocol_module, do: NovelApplication.JudgmentProtocol

  defp arm_label("old"), do: "two-stage call1 narrative + call2 forced judgment_decision (HEAD 60f7c553)"
  defp arm_label("new"), do: "single call tool_choice=auto, content+tool_calls same response (working tree)"
  defp arm_label(_), do: "unknown"

  # ── capture via provider log_fn ──────────────

  defp start_capture do
    {:ok, pid} = Agent.start_link(fn -> %{current_case: nil, calls: []} end)
    pid
  end

  defp install_capture(capture) do
    existing = Application.get_env(:novel_agent, NovelAgent.Provider.LMStudio, [])

    log_fn = fn provider, url, body, result, started_at ->
      try do
        call = %{
          "provider" => provider,
          "url" => sanitize_url(url),
          "started_at_monotonic_ms" => started_at,
          "finished_at_monotonic_ms" => System.monotonic_time(:millisecond),
          "wire_request" => jsonable(body),
          "wire_result" => result_fact(result)
        }

        Agent.update(capture, fn state ->
          %{state | calls: state.calls ++ [Map.put(call, "case_id", state.current_case)]}
        end)

        :ok
      rescue
        _ -> :ok
      end
    end

    Application.put_env(
      :novel_agent,
      NovelAgent.Provider.LMStudio,
      Keyword.put(existing, :log_fn, log_fn)
    )
  end

  defp sanitize_url(url) do
    url
    |> to_string()
    |> String.replace(~r/([?&](?:api_?key|key|token)=)[^&]*/i, "\\1<redacted>")
  end

  defp result_fact({:ok, %Result{} = result, attrs}) do
    content = result.content || ""
    resp_body = attrs[:resp_body]

    %{
      "kind" => "success",
      "http_status" => attrs[:status],
      "content" => content,
      "content_chars" => String.length(content),
      "content_sha256" => sha256(content),
      "tool_calls" => jsonable(result.tool_calls || []),
      "tool_call_count" => length(result.tool_calls || []),
      "usage" => usage_fact(result.usage),
      "adapter_duration_ms" => attrs[:duration],
      "resp_body" => truncate(resp_body),
      "resp_body_sha256" => sha256(to_string(resp_body || ""))
    }
  end

  defp result_fact({:ok, other, attrs}) do
    %{
      "kind" => "success_other",
      "http_status" => attrs[:status],
      "result" => jsonable(other),
      "adapter_duration_ms" => attrs[:duration],
      "resp_body" => truncate(attrs[:resp_body])
    }
  end

  defp result_fact({:error, error, attrs}) do
    %{
      "kind" => "error",
      "http_status" => attrs[:status],
      "error" => jsonable(error),
      "adapter_duration_ms" => attrs[:duration],
      "resp_body" => truncate(attrs[:resp_body])
    }
  end

  defp result_fact(other), do: %{"kind" => "unknown", "raw" => truncate(inspect(other))}

  defp usage_fact(nil), do: nil

  defp usage_fact(usage) when is_map(usage) do
    %{
      "input_tokens" => Map.get(usage, :input_tokens),
      "output_tokens" => Map.get(usage, :output_tokens),
      "model" => Map.get(usage, :model),
      "latency_ms" => Map.get(usage, :latency_ms),
      "cached_tokens" => Map.get(usage, :cached_tokens),
      "ttft_ms" => Map.get(usage, :ttft_ms),
      "ttft_observable" => not is_nil(Map.get(usage, :ttft_ms))
    }
  end

  defp usage_fact(_usage), do: nil

  # ── case execution ───────────────────────────

  defp run_case(arm, case_map, shared, context_blocks, capture) do
    id = case_map["id"]
    input = build_input(case_map, shared, context_blocks)
    metadata = protocol_metadata(arm, input)

    Agent.update(capture, fn state -> %{state | current_case: id, calls: []} end)

    started = System.monotonic_time(:millisecond)

    task =
      Task.async(fn ->
        provider = Execution.dependency(provider: :lmstudio)
        JudgmentProtocol.request_judgment(provider, %{}, input)
      end)

    outcome =
      case Task.yield(task, case_timeout_ms()) do
        {:ok, result} ->
          %{kind: :returned, result: result}

        {:exit, reason} ->
          %{kind: :crash, detail: truncate(inspect(reason), 1_200)}

        nil ->
          Task.shutdown(task, :brutal_kill)
          %{kind: :case_wall_clock_timeout}
      end

    elapsed = System.monotonic_time(:millisecond) - started
    calls = Agent.get(capture, & &1.calls)
    record = build_record(arm, case_map, input, metadata, outcome, calls, elapsed)

    IO.puts(
      "[b26-cp0] arm=#{arm} case=#{id} outcome=#{record["outcome"]} form=#{inspect(record["form"])} " <>
        "expected=#{inspect(record["expected_forms"])} calls=#{record["provider_calls_actual"]} " <>
        "elapsed_ms=#{record["case_elapsed_ms"]}"
    )

    pause(outcome)
    record
  end

  defp build_record(arm, case_map, input, metadata, outcome, calls, elapsed) do
    base = %{
      "id" => case_map["id"],
      "source" => case_map["source"],
      "context_shape" => case_map["context_shape"],
      "author_text" => case_map["author_text"],
      "context_block_sha256" => sha256(input.context_block),
      "expected_forms" => case_map["expected_forms"],
      "expected_capability" => case_map["expected_capability"],
      "protocol_metadata" => metadata,
      "provider_calls_actual" => length(calls),
      "calls" => calls,
      "call_sequence" => Enum.map(calls, &wire_call_sequence/1),
      "case_elapsed_ms" => elapsed
    }

    case outcome do
      %{kind: :returned, result: {:ok, judgment}} ->
        facts = judgment_facts(arm, judgment)
        checks = protocol_checks(arm, case_map, facts, calls, metadata)
        form_match = facts["canonical_form"] in (case_map["expected_forms"] || [])

        capability_match =
          case case_map["expected_capability"] do
            nil -> nil
            expected -> facts["capability"] == expected
          end

        Map.merge(base, %{
          "outcome" => "ok",
          "form" => facts["canonical_form"],
          "form_expected" => form_match,
          "capability_expected" => capability_match,
          "judgment_facts" => facts,
          "protocol_checks" => checks,
          "forbidden_forms_observed" => if(form_match, do: [], else: [facts["canonical_form"]]),
          "failure" => nil
        })

      %{kind: :returned, result: {:error, reason}} ->
        {class, detail} = classify_error(reason)

        Map.merge(base, %{
          "outcome" => class,
          "form" => nil,
          "form_expected" => false,
          "capability_expected" => nil,
          "judgment_facts" => nil,
          "protocol_checks" => protocol_checks(arm, case_map, nil, calls, metadata),
          "forbidden_forms_observed" => [],
          "failure" => %{"class" => class, "detail" => detail}
        })

      %{kind: :crash} ->
        Map.merge(base, %{
          "outcome" => "crash",
          "form" => nil,
          "form_expected" => false,
          "capability_expected" => nil,
          "judgment_facts" => nil,
          "protocol_checks" => protocol_checks(arm, case_map, nil, calls, metadata),
          "forbidden_forms_observed" => [],
          "failure" => %{"class" => "crash", "detail" => outcome.detail}
        })

      %{kind: :case_wall_clock_timeout} ->
        Map.merge(base, %{
          "outcome" => "case_wall_clock_timeout",
          "form" => nil,
          "form_expected" => false,
          "capability_expected" => nil,
          "judgment_facts" => nil,
          "protocol_checks" => protocol_checks(arm, case_map, nil, calls, metadata),
          "forbidden_forms_observed" => [],
          "failure" => %{
            "class" => "case_wall_clock_timeout",
            "detail" => "案例挂钟 #{case_timeout_ms()}ms 到点，Task brutal_kill"
          }
        })
    end
  end

  defp pause(%{kind: :case_wall_clock_timeout}), do: Process.sleep(@pause_after_timeout_ms)
  defp pause(_), do: Process.sleep(@pause_between_cases_ms)

  # ── judgment facts (normalized across both protocols) ──

  defp judgment_facts(arm, judgment) do
    get = fn key -> map_get(judgment, key) end
    narrative = get.(:narrative) || ""

    canonical_form =
      if arm == "old" and get.(:author_content_registration) == true do
        "author_content_registration"
      else
        get.(:action)
      end

    options = get.(:options) || []

    %{
      "canonical_form" => canonical_form,
      "action" => get.(:action),
      "capability" => get.(:capability),
      "reason" => get.(:reason),
      "frame_type" => get.(:frame_type),
      "dialogue_goal" => get.(:dialogue_goal),
      "reply_included" => get.(:reply_included),
      "record_only" => get.(:record_only),
      "author_content_registration" => get.(:author_content_registration),
      "author_content_source_ref" => get.(:author_content_source_ref),
      "options" => jsonable(options),
      "options_count" => length(options),
      "option_field_supported" => arm == "new",
      "explore_request" => jsonable(get.(:explore_request)),
      "candidate_directions" => jsonable(get.(:candidate_directions) || []),
      "candidate_directions_count" => length(get.(:candidate_directions) || []),
      "narrative" => narrative,
      "narrative_chars" => String.length(narrative),
      "narrative_sha256" => sha256(narrative),
      "content_has_blank_line_separator" => Regex.match?(~r/\n[ \t]*\n/, narrative),
      "content_paragraph_count" => length(String.split(narrative, ~r/\n[ \t]*\n/, trim: true)),
      "narrative_source" => jsonable(get.(:narrative_source)),
      "provider_call_count_reported" => get.(:provider_call_count),
      "reply_record" => jsonable(get.(:reply_record)),
      "provider_result_tool_calls" => jsonable(tool_calls_of(get.(:provider_result)))
    }
  end

  defp tool_calls_of(result) when is_map(result), do: Map.get(result, :tool_calls) || []
  defp tool_calls_of(_), do: []

  # ── protocol-level (pure) prompt metadata ────

  defp protocol_metadata("new", input) do
    prompt = JudgmentProtocol.prompt(input, :judgment)
    tools = Enum.map(prompt.tools, &tool_spec_name/1)
    user = prompt_user_content(prompt)

    %{
      "builder" => "JudgmentProtocol.prompt/2 (production)",
      "profile" => "judgment",
      "tool_choice" => prompt.tool_choice,
      "tools" => tools,
      "tool_count" => length(tools),
      "rules_version" => safe_call(fn -> NovelApplication.AuthoringTaskPolicy.version() end),
      "tool_contract_version" => safe_call(fn -> NovelApplication.JudgmentToolContract.version() end),
      "prompt_sha256" => sha256(user),
      "prompt_chars" => String.length(user),
      "prompt_messages" => message_facts(prompt.messages)
    }
  end

  defp protocol_metadata("old", input) do
    narrative_prompt = JudgmentProtocol.narrative_prompt(input)
    decision_prompt = JudgmentProtocol.decision_prompt(input, @old_placeholder_narrative)
    np = prompt_user_content(narrative_prompt)
    dp = prompt_user_content(decision_prompt)
    dp_prefix = dp |> String.split("## 你已输出的判断说明", parts: 2) |> List.first()

    %{
      "builder" => "JudgmentProtocol.narrative_prompt/1 + decision_prompt/2 (production)",
      "profile" => "judgment",
      "rules_version" => nil,
      "tool_contract_version" => nil,
      "call1" => %{
        "purpose" => "author_reasoning",
        "tool_choice" => narrative_prompt.tool_choice,
        "tools" => Enum.map(narrative_prompt.tools, &tool_spec_name/1),
        "prompt_sha256" => sha256(np),
        "prompt_chars" => String.length(np),
        "prompt_messages" => message_facts(narrative_prompt.messages)
      },
      "call2" => %{
        "purpose" => "planner",
        "tool_choice" => decision_prompt.tool_choice,
        "tools" => Enum.map(decision_prompt.tools, &tool_spec_name/1),
        "prompt_sha256_with_placeholder_narrative" => sha256(dp),
        "prompt_prefix_sha256" => sha256(dp_prefix),
        "prompt_chars" => String.length(dp),
        "prompt_messages" => message_facts(decision_prompt.messages)
      }
    }
  end

  defp protocol_metadata(arm, _input), do: %{"builder" => "unknown_arm:#{arm}"}

  defp prompt_user_content(%{messages: messages}) do
    messages
    |> Enum.map(fn m -> Map.get(m, :content) || Map.get(m, "content") || "" end)
    |> Enum.join("\n---\n")
  end

  defp prompt_user_content(_), do: ""

  defp message_facts(messages) when is_list(messages) do
    Enum.map(messages, fn message ->
      content = Map.get(message, :content) || Map.get(message, "content") || ""

      %{
        "role" => Map.get(message, :role) || Map.get(message, "role"),
        "chars" => String.length(to_string(content)),
        "sha256" => sha256(to_string(content))
      }
    end)
  end

  defp message_facts(_), do: []

  # ── protocol checks (facts, not pass thresholds) ──

  defp protocol_checks(arm, case_map, facts, calls, metadata) do
    wire_tool_names =
      calls
      |> Enum.flat_map(fn call -> get_in(call, ["wire_result", "tool_calls"]) || [] end)
      |> Enum.map(&tool_call_name/1)

    last_call = List.last(calls)
    explore_tools = metadata_explore_tools(metadata)

    base = %{
      "wire_tool_calls_all_calls" => wire_tool_names,
      "wire_tool_call_count" => length(wire_tool_names),
      "last_wire_tool_choice" => last_call && get_in(last_call, ["wire_request", "tool_choice"]),
      "last_wire_stream" => last_call && get_in(last_call, ["wire_request", "stream"]),
      "last_wire_temperature" => last_call && get_in(last_call, ["wire_request", "temperature"]),
      "last_wire_max_tokens" => last_call && get_in(last_call, ["wire_request", "max_tokens"]),
      "legal_combination" => legal_combination(arm, wire_tool_names),
      "protocol_validated_by_entrypoint" => facts != nil
    }

    expected = case_map["expected_forms"] || []

    extra =
      cond do
        "reply" in expected ->
          %{
            "reply_zero_tool_calls" => wire_tool_names == [],
            "reply_content_from_same_call" => true,
            "blank_line_separator_present" => facts && facts["content_has_blank_line_separator"],
            "paragraph_count" => facts && facts["content_paragraph_count"]
          }

        "explore" in expected ->
          request = facts && facts["explore_request"]

          %{
            "explore_tool" => request && (request["tool"] || request[:tool]),
            "explore_tool_in_catalog" =>
              request != nil and (request["tool"] || request[:tool]) in explore_tools,
            "explore_native_tool_exposed" =>
              Enum.any?(wire_tool_names, &(&1 in explore_tools))
          }

        case_map["id"] == "J2_author_content_registration" ->
          %{
            "author_content_source_ref" => facts && facts["author_content_source_ref"],
            "registration_tool_called" => "register_author_content" in wire_tool_names,
            "registration_flag_true" => facts && facts["author_content_registration"] == true
          }

        case_map["id"] == "J3_await_author_no_options" ->
          %{
            "ask_author_called" => "ask_author" in wire_tool_names,
            "options_count" => facts && facts["options_count"]
          }

        case_map["id"] == "author_decision_with_options" ->
          %{
            "options_count" => facts && facts["options_count"],
            "ask_author_called" => "ask_author" in wire_tool_names
          }

        true ->
          %{}
      end

    Map.merge(base, extra)
  end

  defp legal_combination("new", wire_tool_names) do
    cond do
      wire_tool_names == [] -> true
      length(wire_tool_names) == 1 -> true
      Enum.sort(wire_tool_names) == ["agent_plan_draft", "judgment_decision"] -> true
      true -> false
    end
  end

  defp legal_combination("old", wire_tool_names) do
    # 旧 call2 forced 只能且必须一个 judgment_decision；call1 tool_choice=none 不应出现工具调用。
    wire_tool_names == [] or wire_tool_names == ["judgment_decision"]
  end

  defp legal_combination(_arm, _names), do: false

  defp metadata_explore_tools(metadata) do
    case metadata do
      %{"explore_tools" => tools} when is_list(tools) -> tools
      _ -> []
    end
  end

  defp wire_call_sequence(call) do
    request = call["wire_request"] || %{}
    result = call["wire_result"] || %{}

    %{
      "purpose_guess" => purpose_guess(request),
      "stream" => request["stream"],
      "tool_choice" => request["tool_choice"],
      "tool_names" => Enum.map(request["tools"] || [], &wire_tool_spec_name/1),
      "temperature" => request["temperature"],
      "max_tokens" => request["max_tokens"],
      "model" => request["model"],
      "request_messages" => message_facts(request["messages"]),
      "response_kind" => result["kind"],
      "response_content_chars" => result["content_chars"],
      "response_tool_calls" => Enum.map(result["tool_calls"] || [], &tool_call_name/1),
      "http_status" => result["http_status"],
      "ttft_ms" => get_in(result, ["usage", "ttft_ms"]),
      "adapter_duration_ms" => result["adapter_duration_ms"]
    }
  end

  defp purpose_guess(%{"stream" => true}), do: "author_visible_narrative_stream"
  defp purpose_guess(%{"tool_choice" => "auto"}), do: "judgment_tool_call_auto_non_stream"
  defp purpose_guess(%{"tool_choice" => _}), do: "forced_tool_call_non_stream"
  defp purpose_guess(_), do: "unknown"

  # ── error classification ─────────────────────

  defp classify_error(reason) do
    detail = truncate(inspect(reason), 1_500)
    lowered = String.downcase(detail)

    cond do
      Enum.any?(@blocked_markers, &String.contains?(lowered, &1)) -> {"blocked", detail}
      String.contains?(lowered, "timeout") -> {"provider_timeout", detail}
      String.contains?(lowered, "violation") -> {"protocol_reject", detail}
      String.contains?(lowered, "invalid") -> {"protocol_reject", detail}
      String.contains?(lowered, "unparseable") -> {"protocol_reject", detail}
      String.contains?(lowered, "narrative_required") -> {"protocol_reject", detail}
      true -> {"failure", detail}
    end
  end

  # ── environment / config facts ───────────────

  defp environment(arm) do
    config = Application.get_env(:novel_agent, NovelAgent.Provider.LMStudio, [])

    %{
      "arm" => arm,
      "worktree" => File.cwd!(),
      "git_head" => git(["rev-parse", "HEAD"]),
      "git_describe" => git(["describe", "--always", "--dirty"]),
      "git_status_porcelain_entries" =>
        case git(["status", "--porcelain"]) do
          "" -> 0
          output -> length(String.split(output, "\n", trim: true))
        end,
      "elixir" => System.version(),
      "otp" => System.otp_release(),
      "mix_env" => to_string(Mix.env()),
      "utc_now" => DateTime.utc_now() |> DateTime.to_iso8601(),
      "provider" => "lmstudio",
      "provider_config" => %{
        "endpoint" => Keyword.get(config, :endpoint),
        "model" => Keyword.get(config, :model),
        "max_tokens" => Keyword.get(config, :max_tokens),
        "timeout_legacy" => Keyword.get(config, :timeout),
        "reasoning_effort" => Keyword.get(config, :reasoning_effort),
        "json_mode" => Keyword.get(config, :json_mode)
      },
      "env_overrides" => %{
        "NOVEL_LMSTUDIO_MODEL" => env("NOVEL_LMSTUDIO_MODEL"),
        "NOVEL_LMSTUDIO_ENDPOINT" => env("NOVEL_LMSTUDIO_ENDPOINT"),
        "NOVEL_LMSTUDIO_MAX_TOKENS" => env("NOVEL_LMSTUDIO_MAX_TOKENS"),
        "NOVEL_LOCAL_RESPONSE_TIMEOUT_MS" => env("NOVEL_LOCAL_RESPONSE_TIMEOUT_MS"),
        "NOVEL_LOCAL_NON_STREAM_TIMEOUT_MS" => env("NOVEL_LOCAL_NON_STREAM_TIMEOUT_MS"),
        "NOVEL_LOCAL_DEADLINE_TIMEOUT_MS" => env("NOVEL_LOCAL_DEADLINE_TIMEOUT_MS")
      },
      "implementations" => implementation_hashes(),
      "lmstudio_models" => lmstudio_models()
    }
  end

  defp implementation_hashes do
    Map.new(@implementation_files, fn path ->
      case File.read(path) do
        {:ok, content} -> {path, sha256(content)}
        {:error, reason} -> {path, "missing:#{inspect(reason)}"}
      end
    end)
  end

  defp lmstudio_models do
    url = "http://localhost:1234/v1/models"

    try do
      case NovelAgent.Provider.HTTP.get(url, receive_timeout: 10_000) do
        {:ok, _status, body} -> jsonable(body)
        other -> %{"error" => truncate(inspect(other))}
      end
    rescue
      error -> %{"error" => truncate(inspect(error))}
    end
  end

  defp model_params_effective do
    %{
      "provider" => "lmstudio",
      "model" => env("NOVEL_LMSTUDIO_MODEL") || "qwen/qwen3.8-27b",
      "max_tokens" => env_int("NOVEL_LMSTUDIO_MAX_TOKENS", 32_000),
      "reasoning_effort" => env("NOVEL_LMSTUDIO_REASONING_EFFORT"),
      "note" => "temperature 由协议实现决定，见每例 protocol_metadata 与 calls[].wire_request.temperature。"
    }
  end

  defp provider_timeout_ms_effective do
    %{
      "response_ms_env" => env_int("NOVEL_LOCAL_RESPONSE_TIMEOUT_MS", nil),
      "non_stream_ms_env" => env_int("NOVEL_LOCAL_NON_STREAM_TIMEOUT_MS", nil)
    }
  end

  # ── report / denominator ─────────────────────

  defp denominator(results) do
    counts = Enum.frequencies(Enum.map(results, & &1["outcome"]))

    %{
      "total" => length(results),
      "ok" => Map.get(counts, "ok", 0),
      "provider_timeout" => Map.get(counts, "provider_timeout", 0),
      "blocked" => Map.get(counts, "blocked", 0),
      "protocol_reject" => Map.get(counts, "protocol_reject", 0),
      "failure" => Map.get(counts, "failure", 0),
      "crash" => Map.get(counts, "crash", 0),
      "case_wall_clock_timeout" => Map.get(counts, "case_wall_clock_timeout", 0),
      "form_expected" => Enum.count(results, &(&1["form_expected"] == true)),
      "note" => "分母固定 12 例/臂；超时/失败/崩溃计入分母并单列，不剔除、不换分母。"
    }
  end

  defp report(summary, out_path) do
    Enum.each(summary["cases"], fn c ->
      IO.puts(
        "[b26-cp0] #{summary["arm"]} #{c["id"]} outcome=#{c["outcome"]} " <>
          "form=#{inspect(c["form"])} calls=#{c["provider_calls_actual"]} " <>
          "elapsed_ms=#{c["case_elapsed_ms"]}"
      )
    end)

    IO.puts("[b26-cp0] denominator=#{inspect(summary["denominator"])}")
    IO.puts("[b26-cp0] 输出：#{out_path}")
  end

  # ── cases / input ────────────────────────────

  defp load_json!(path) do
    case Jason.decode(File.read!(path)) do
      {:ok, decoded} -> decoded
      {:error, error} -> raise "cases JSON 解析失败 #{path}: #{inspect(error)}"
    end
  end

  defp filter_cases(cases) do
    case env("B26_CP0_FILTER") do
      nil ->
        cases

      filter ->
        ids = filter |> String.split(",", trim: true) |> Enum.map(&String.trim/1)
        Enum.filter(cases, &(&1["id"] in ids))
    end
  end

  defp shared_options(shared) do
    [
      explore: Map.get(shared, "explore", true),
      capabilities: Map.get(shared, "capabilities", []),
      explore_tools: Map.get(shared, "explore_tools", []),
      author_content_sources: Map.get(shared, "author_content_sources", []),
      registered_sources: Map.get(shared, "registered_sources", []),
      pending_artifact_targets: %{},
      adopted_content_targets: %{}
    ]
  end

  defp build_input(case_map, shared, context_blocks) do
    %{
      author_text: case_map["author_text"],
      context_block: Map.get(context_blocks, case_map["context_shape"], ""),
      options: shared
    }
  end

  # ── generic helpers ──────────────────────────

  defp case_timeout_ms, do: env_int("B26_CP0_CASE_TIMEOUT_MS", @case_timeout_default)

  defp env(name), do: System.get_env(name)

  defp env_int(name, default) do
    case System.get_env(name) do
      nil ->
        default

      value ->
        case Integer.parse(String.trim(value)) do
          {int, ""} -> int
          _ -> default
        end
    end
  end

  defp tool_spec_name(spec) when is_map(spec) do
    Map.get(spec, :name) || Map.get(spec, "name") || get_in(spec, [:function, :name]) ||
      get_in(spec, ["function", "name"])
  end

  defp tool_spec_name(_), do: nil

  defp wire_tool_spec_name(spec) when is_map(spec),
    do: get_in(spec, ["function", "name"]) || Map.get(spec, "name")

  defp wire_tool_spec_name(_), do: nil

  defp tool_call_name(%{"name" => name}) when is_binary(name), do: name
  defp tool_call_name(%{"function" => %{"name" => name}}) when is_binary(name), do: name
  defp tool_call_name(call) when is_map(call), do: map_get(call, :name)
  defp tool_call_name(_), do: nil

  defp map_get(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp map_get(_map, _key), do: nil

  defp safe_call(fun) do
    fun.()
  rescue
    _ -> nil
  catch
    _, _ -> nil
  end

  defp jsonable(term) do
    case Jason.encode(term) do
      {:ok, encoded} -> Jason.decode!(encoded)
      {:error, _} -> truncate(inspect(term))
    end
  rescue
    _ -> truncate(inspect(term))
  end

  defp truncate(value), do: truncate(value, 20_000)

  defp truncate(nil, _max), do: nil

  defp truncate(value, max) when is_binary(value) do
    if String.length(value) > max do
      String.slice(value, 0, max) <> "…[truncated]"
    else
      value
    end
  end

  defp truncate(value, max), do: truncate(inspect(value), max)

  defp sha256(content) when is_binary(content) do
    :crypto.hash(:sha256, content) |> Base.encode16(case: :lower)
  end

  defp sha256(content), do: sha256(to_string(content))

  defp git(args) do
    case System.cmd("git", args, stderr_to_stdout: true) do
      {output, 0} -> String.trim(output)
      {output, code} -> "git_error(#{code}):#{truncate(output)}"
    end
  rescue
    error -> "git_unavailable:#{inspect(error)}"
  end
end

ModelContracts.B26Cp0ArmProbe.main(System.argv())
