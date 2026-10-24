# B27 CP4 盲评 judge 驱动：用与被评臂不同的模型逐 episode 判卷（隐藏 arm）。
#
# 归属：B27 CP4 执行批（§6.1 #6「隐藏新旧臂标签后判卷」）。
# 输入：`b27_semantic_score.exs --gen-templates` 生成的盲评模板（`<review>/templates/*.json`
#       与 `<review>/blind-index.json`）。模板**不含 arm 标签**；本驱动也不读取 blind-index 的 arm 字段
#       参与判卷（仅用于文件名/回执关联）。
# 输出：
#   `<review>/judge/<blind_id>.json`     判卷原始证据（完整 prompt、每次尝试的响应原文/usage/耗时/模型）
#   `<review>/judgments/<blind_id>.json` 聚合器可读的判定（模板 + judgment 填写 + judge_meta）
#   `<review>/judge-summary-<stamp>.json` 覆盖统计、judge 模型、warmup、失败清单
#
# 约束（不得绕过）：
#   - judge 模型必须**不同于被评臂模型**（被评臂 = strata/iq3_s）；本驱动拒绝 strata 与
#     iq3_s/qwen3.8-flash-next-iq3_s 模型名，只允许 LM Studio / DeepSeek 等外部 judge 通道。
#   - judge 不可用（探活/warmup 失败）→ BLOCKED（exit 3）并落证据；不得编写任何 judgment。
#   - 每 episode 独立判定与 JSON 回执；解析/字段校验失败最多重试 1 次，仍失败则该 episode 留缺
#     （聚合器计 invalid=未成功），本驱动 exit 1，不伪造判定。
#   - 不修改模板/cases/snapshot/阈值；只写 judgments/judge/summary。
#
# ── 用法 ────────────────────────────────────────────────────────────────
#
#   # 先臂矩阵 + 模板（review-strata）
#   MIX_ENV=test NOVEL_LMSTUDIO_TIMEOUT_MS=300000 mix run scripts/model_contracts/b27_blind_judge.exs \
#     --review artifacts/model-contracts/b27-cp4/execution-batch-<ts>/review-strata \
#     --model qwen/qwen3.6-27b --fallback-models openai/gpt-oss-120b,qwen/qwen3.8-27b
#
#   # 冒烟（前 N 条，验证 judge 通道与 JSON 回执）
#   ... --limit 2
#
#   # 强制重判已存在判定
#   ... --force
#
# ── 退出码 ──────────────────────────────────────────────────────────────
#   0 全部模板已判卷并写出合法判定
#   1 部分 episode 判卷失败/未判（已判部分保留，缺项由聚合器计 invalid）
#   2 用法/输入错误
#   3 BLOCKED（judge 通道不可用/无可用模型，未写任何判定）
#
# 边界：judge 是外部模型，存在主观性；本驱动只如实记录 judge 模型/请求/响应，不声称其等价人工盲评。
# 结论必须由 §6.1 聚合器在 80 条判定全覆盖后给出。

defmodule B27BlindJudge do
  @moduledoc false

  @root Path.expand("../..", __DIR__)
  @default_review Path.join(@root, "artifacts/model-contracts/b27-cp4/review-strata")
  @forbidden_models ["iq3_s", "qwen3.8-flash-next-iq3_s"]
  @preferred_models ["qwen/qwen3.6-27b", "openai/gpt-oss-120b"]
  @required_judgment_fields [
    "semantic_success",
    "allowed_path_ok",
    "forbidden_behavior_violations",
    "unnecessary_question",
    "unavailable_reason",
    "zero_tolerance_violation"
  ]
  @unavailable_reason_codes [
    "timeout",
    "connection",
    "provider_model_unavailable",
    "provider_auth",
    "format_terminal_failure",
    "provider_error",
    "blocked"
  ]

  # ── 入口 ────────────────────────────────────────────────────────────────

  def main(argv) do
    opts = parse_args(argv)

    cond do
      opts.help -> IO.puts(usage())
      opts.review == nil -> usage_error("必须指定 --review <dir>（先运行 --gen-templates）")
      not File.dir?(opts.review) -> usage_error("review 目录不存在: #{opts.review}")
      true -> judge_all(opts)
    end
  end

  defp usage do
    """
    用法:
      mix run scripts/model_contracts/b27_blind_judge.exs --review <review-dir> [--model MODEL] \\
        [--fallback-models m1,m2] [--timeout-ms 300000] [--limit N] [--force]

    只允许外部 judge 通道（默认 LM Studio）。被评臂 = strata/iq3_s，judge 模型必须不同。
    """
  end

  defp parse_args(argv) do
    parsed =
      parse_flags(argv, %{
        review: nil,
        model: nil,
        fallbacks: @preferred_models,
        timeout_ms: 300_000,
        limit: nil,
        force: false,
        help: false
      })

    review =
      case parsed.review do
        nil -> if File.dir?(@default_review), do: @default_review, else: nil
        path -> Path.expand(path, @root)
      end

    models =
      cond do
        is_binary(parsed.model) ->
          [parsed.model | Enum.reject(parsed.fallbacks, &(&1 == parsed.model))]

        true ->
          parsed.fallbacks
      end

    parsed
    |> Map.put(:review, review)
    |> Map.put(:models, models)
  end

  defp parse_flags([], acc), do: acc

  defp parse_flags([flag | rest], acc) do
    {name, inline_value} =
      case String.split(flag, "=", parts: 2) do
        [name, value] -> {name, value}
        [name] -> {name, nil}
      end

    case name do
      "--review" ->
        {value, rest} = value_or_next(inline_value, rest)
        parse_flags(rest, %{acc | review: value})

      "--model" ->
        {value, rest} = value_or_next(inline_value, rest)
        parse_flags(rest, %{acc | model: value})

      "--fallback-models" ->
        {value, rest} = value_or_next(inline_value, rest)
        parse_flags(rest, %{acc | fallbacks: String.split(value || "", ",", trim: true)})

      "--timeout-ms" ->
        {value, rest} = value_or_next(inline_value, rest)
        parse_flags(rest, %{acc | timeout_ms: parse_int(value, acc.timeout_ms)})

      "--limit" ->
        {value, rest} = value_or_next(inline_value, rest)
        parse_flags(rest, %{acc | limit: parse_int(value, nil)})

      "--force" ->
        parse_flags(rest, %{acc | force: true})

      "--help" ->
        parse_flags(rest, %{acc | help: true})

      other ->
        usage_error("未知参数: #{other}")
    end
  end

  defp value_or_next(nil, [value | rest]), do: {value, rest}
  defp value_or_next(nil, []), do: {nil, []}
  defp value_or_next(value, rest), do: {value, rest}

  defp parse_int(nil, default), do: default

  defp parse_int(value, default) do
    case Integer.parse(value) do
      {n, _} -> n
      :error -> default
    end
  end

  defp usage_error(message) do
    IO.puts("[b27-judge] 用法错误: #{message}")
    System.halt(2)
  end

  # ── 主流程 ──────────────────────────────────────────────────────────────

  defp judge_all(opts) do
    index = read_json!(Path.join(opts.review, "blind-index.json"))
    entries = get(index, "entries") || []

    if entries == [] do
      usage_error("blind-index.json 没有 entries；先运行 b27_semantic_score.exs --gen-templates")
    end

    entries =
      cond do
        opts.limit -> Enum.take(entries, opts.limit)
        true -> entries
      end

    File.mkdir_p!(Path.join(opts.review, "judge"))
    File.mkdir_p!(Path.join(opts.review, "judgments"))

    candidates = Enum.reject(opts.models, &forbidden_model?/1)

    if candidates == [] do
      IO.puts("[b27-judge] BLOCKED: 没有可用的非被评臂 judge 模型（禁止 #{inspect(@forbidden_models)}）")

      write_blocked(opts, entries, %{
        "reason" => "no_allowed_judge_model",
        "models" => opts.models
      })

      System.halt(3)
    end

    case probe_and_warmup(candidates, opts) do
      {:ok, judge} ->
        IO.puts(
          "[b27-judge] judge channel ok: provider=#{judge["provider"]} model=#{judge["model"]} warmup_ms=#{judge["warmup_ms"]}"
        )

        results =
          entries
          |> Enum.with_index()
          |> Enum.map(fn {entry, idx} ->
            blind_id = entry["blind_id"]
            judgment_path = Path.join([opts.review, "judgments", "#{blind_id}.json"])

            cond do
              not opts.force and File.exists?(judgment_path) ->
                IO.puts(
                  "[b27-judge] (#{idx + 1}/#{length(entries)}) #{blind_id} skip: judgment exists"
                )

                :skipped

              true ->
                IO.puts("[b27-judge] (#{idx + 1}/#{length(entries)}) #{blind_id} judging…")
                judge_one(entry, judge, opts)
            end
          end)

        summarize(opts, judge, entries, results)
        count_failed = Enum.count(results, &match?({:error, _}, &1))
        count_skipped = Enum.count(results, &(&1 == :skipped))
        count_ok = Enum.count(results, &match?({:ok, _}, &1)) + count_skipped

        IO.puts("[b27-judge] done: ok/skip=#{count_ok}/#{length(entries)} failed=#{count_failed}")

        cond do
          count_ok == length(entries) -> :ok
          count_ok == 0 -> System.halt(3)
          true -> System.halt(1)
        end

      {:blocked, reason} ->
        IO.puts("[b27-judge] BLOCKED: judge 通道不可用（#{inspect(reason)}）")
        write_blocked(opts, entries, %{"reason" => inspect(reason), "models" => opts.models})
        System.halt(3)
    end
  end

  # ── judge 通道探活 + warmup（确保模型可用；不写判定）────────────────────

  defp probe_and_warmup(models, opts) do
    Enum.reduce_while(models, {:blocked, :no_model}, fn model, _acc ->
      IO.puts("[b27-judge] try judge model: #{model}")

      with true <- not forbidden_model?(model),
           {:ok, available} <- list_models(),
           true <- model in available,
           {:ok, warmup} <- warmup(model, opts) do
        {:halt, {:ok, %{"provider" => "lmstudio", "model" => model, "warmup_ms" => warmup}}}
      else
        false -> {:cont, {:blocked, {:forbidden_model, model}}}
        {:error, reason} -> {:cont, {:blocked, reason}}
      end
    end)
  end

  defp forbidden_model?(model) do
    model = to_string(model)
    Enum.any?(@forbidden_models, fn forbidden -> String.contains?(model, forbidden) end)
  end

  defp list_models do
    case Req.get("http://localhost:1234/v1/models", receive_timeout: 10_000, retry: false) do
      {:ok, %Req.Response{status: 200, body: body}} when is_map(body) ->
        ids =
          (get(body, "data") || [])
          |> Enum.map(&get(&1, "id"))
          |> Enum.reject(&is_nil/1)

        {:ok, ids}

      {:ok, %Req.Response{status: status}} ->
        {:error, {:http_status, status}}

      {:error, reason} ->
        {:error, reason}
    end
  rescue
    error -> {:error, Exception.message(error)}
  end

  defp warmup(model, opts) do
    configure_lmstudio(model, opts)

    prompt = %{
      messages: [
        %{"role" => "system", "content" => "你是判卷器通道健康检查。只回复 OK。"},
        %{"role" => "user", "content" => "回复 OK"}
      ]
    }

    started = System.monotonic_time(:millisecond)
    outcome = call_provider(prompt.messages, opts.timeout_ms * 2)
    elapsed = System.monotonic_time(:millisecond) - started

    case outcome do
      {:ok, %{content: content}} when is_binary(content) ->
        IO.puts("[b27-judge] warmup ok (#{elapsed}ms)")
        {:ok, elapsed}

      {:ok, other} ->
        {:error, {:unexpected_warmup, inspect(other)}}

      {:error, error} ->
        {:error, error}
    end
  end

  defp configure_lmstudio(model, opts) do
    existing = Application.get_env(:novel_agent, NovelAgent.Provider.LMStudio, [])

    Application.put_env(
      :novel_agent,
      NovelAgent.Provider.LMStudio,
      existing
      |> Keyword.put(:model, model)
      |> Keyword.put(
        :endpoint,
        System.get_env("NOVEL_LMSTUDIO_ENDPOINT", "http://localhost:1234/v1")
      )
      |> Keyword.put(:timeout, max(opts.timeout_ms, 300_000))
      |> Keyword.put_new(:max_tokens, 32_000)
      # judge 只需短 JSON：关闭思考输出、限制输出预算，避免 reasoning tokens 拉长每例时延。
      |> Keyword.put(:reasoning_effort, System.get_env("NOVEL_LMSTUDIO_REASONING_EFFORT", "none"))
      |> Keyword.put(:thinking, :disabled)
    )

    provider = Application.get_env(:novel_agent, :provider, [])
    Application.put_env(:novel_agent, :provider, Keyword.put(provider || [], :default, :lmstudio))
    :ok
  end

  # ── 单 episode 判卷 ─────────────────────────────────────────────────────

  defp judge_one(entry, judge, opts) do
    blind_id = entry["blind_id"]

    try do
      template_path = Path.join([opts.review, "templates", "#{blind_id}.json"])

      if not File.exists?(template_path) do
        IO.puts("[b27-judge] FAIL #{blind_id}: template missing")
        {:error, :template_missing}
      else
        template = read_json!(template_path)
        prompt = judge_prompt(template)

        case judge_episode(prompt, judge, opts) do
          {:ok, judgment, attempts} ->
            write_judgment!(opts, template, judgment, prompt, attempts, judge)
            {:ok, blind_id}

          {:error, reason, attempts} ->
            IO.puts("[b27-judge] FAIL #{blind_id}: #{inspect(reason)}")
            write_failure_artifact!(opts, template, prompt, attempts, judge, reason)
            {:error, blind_id}
        end
      end
    rescue
      error ->
        IO.puts("[b27-judge] FAIL #{blind_id}: #{Exception.message(error)}")
        {:error, blind_id}
    end
  end

  defp judge_episode(prompt, _judge, opts) do
    max_attempts = 2

    Enum.reduce_while(1..max_attempts, {:error, :not_attempted, []}, fn attempt,
                                                                        {_status, _reason, raws} ->
      attempt_prompt =
        if attempt == 1 do
          prompt
        else
          [
            prompt,
            %{
              "role" => "user",
              "content" => "上一次输出不是合法 JSON 或字段不完整。请只输出一个 JSON 对象，不要任何解释或 markdown。"
            }
          ]
          |> Enum.concat()
        end

      started = System.monotonic_time(:millisecond)
      outcome = call_provider(attempt_prompt, opts.timeout_ms)
      latency = System.monotonic_time(:millisecond) - started

      raw =
        case outcome do
          {:ok, result} ->
            %{
              "attempt" => attempt,
              "latency_ms" => latency,
              "content" => result.content,
              "usage" => jsonable(result.usage),
              "provider_run_ref" => result.provider_run_ref,
              "provider_call_ref" => result.provider_call_ref
            }

          {:error, error} ->
            %{
              "attempt" => attempt,
              "latency_ms" => latency,
              "error" => jsonable(error)
            }
        end

      case parse_judgment(outcome) do
        {:ok, judgment} ->
          {:halt, {:ok, judgment, raws ++ [raw]}}

        {:error, reason} ->
          if attempt == max_attempts do
            {:halt, {:error, reason, raws ++ [raw]}}
          else
            {:cont, {:error, reason, raws ++ [raw]}}
          end
      end
    end)
  end

  defp parse_judgment({:ok, %{content: content}}) do
    with text when is_binary(text) <- content,
         json_text <- extract_json(text),
         {:ok, doc} when is_map(doc) <- Jason.decode(json_text),
         {:ok, judgment} <- validate_judgment(doc) do
      {:ok, judgment}
    else
      {:error, reason} -> {:error, reason}
      other -> {:error, {:invalid_json_output, inspect(other) |> String.slice(0, 200)}}
    end
  end

  defp parse_judgment({:error, error}), do: {:error, {:provider_error, error}}

  defp extract_json(text) do
    cleaned =
      text
      |> String.replace(~r/```(?:json)?/i, "")
      |> String.replace("```", "")

    case Regex.run(~r/\{.*\}/s, cleaned) do
      [json] -> json
      _ -> cleaned
    end
  end

  defp validate_judgment(doc) do
    missing =
      @required_judgment_fields
      |> Enum.reject(&Map.has_key?(doc, &1))

    cond do
      missing != [] ->
        {:error, {:missing_fields, missing}}

      not is_boolean(get(doc, "semantic_success")) ->
        {:error, {:invalid_type, "semantic_success"}}

      not is_boolean(get(doc, "allowed_path_ok")) ->
        {:error, {:invalid_type, "allowed_path_ok"}}

      not is_boolean(get(doc, "unnecessary_question")) ->
        {:error, {:invalid_type, "unnecessary_question"}}

      not is_boolean(get(doc, "zero_tolerance_violation")) ->
        {:error, {:invalid_type, "zero_tolerance_violation"}}

      not is_list(get(doc, "forbidden_behavior_violations")) ->
        {:error, {:invalid_type, "forbidden_behavior_violations"}}

      not is_nil(get(doc, "unavailable_reason")) and
          get(doc, "unavailable_reason") not in @unavailable_reason_codes ->
        {:error, {:invalid_unavailable_reason, get(doc, "unavailable_reason")}}

      get(doc, "allowed_path_ok") == false and get(doc, "semantic_success") == true ->
        {:error, :inconsistent_allowed_path}

      get(doc, "forbidden_behavior_violations") != [] and get(doc, "semantic_success") == true ->
        {:error, :inconsistent_forbidden_vs_success}

      true ->
        {:ok,
         %{
           "semantic_success" => get(doc, "semantic_success"),
           "allowed_path_ok" => get(doc, "allowed_path_ok"),
           "forbidden_behavior_violations" => get(doc, "forbidden_behavior_violations"),
           "unnecessary_question" => get(doc, "unnecessary_question"),
           "unavailable_reason" => get(doc, "unavailable_reason"),
           "zero_tolerance_violation" => get(doc, "zero_tolerance_violation"),
           "notes" => to_string_safe(get(doc, "notes") || "")
         }}
    end
  end

  # ── judge prompt（盲：只含案例卡 + episode 事实，不含 arm）────────────────

  # judge prompt 只保留判据需要的事实，避免把整段 wire 请求塞给 judge（减少 GPU 争用/时延）。
  defp compact_episode_facts(nil), do: %{}

  defp compact_episode_facts(facts) do
    calls = get(facts, "provider_calls") || []

    %{
      "status" => get(facts, "status"),
      "availability" => get(facts, "availability"),
      "error_class" => get(facts, "error_class"),
      "elapsed_ms" => get(facts, "elapsed_ms"),
      "provider_call_count" => get(facts, "provider_call_count"),
      "usage" => get(facts, "usage"),
      "judgment_action" => get(facts, "judgment_action"),
      "tool_names" => get(facts, "tool_names") || [],
      "allowed_path" => get(facts, "allowed_path"),
      "forbidden_candidates" => get(facts, "forbidden_candidates") || [],
      "zero_tolerance_candidates" => get(facts, "zero_tolerance_candidates") || [],
      "unnecessary_question_candidate" => get(facts, "unnecessary_question_candidate"),
      "rounds_executed" => get(facts, "rounds_executed"),
      "final_text" => truncate(get(facts, "final_text"), 2_500),
      "calls" =>
        calls
        |> Enum.with_index(1)
        |> Enum.map(fn {call, index} ->
          %{
            "index" => index,
            "tool_names" => get(call, "tool_names") || [],
            "content_excerpt" => truncate(get(call, "content"), 700),
            "tool_calls" =>
              (get(call, "tool_calls") || [])
              |> Enum.take(4)
              |> Enum.map(fn tool_call ->
                %{
                  "name" => get(tool_call, "name"),
                  "arguments_excerpt" =>
                    tool_call
                    |> get("arguments")
                    |> Jason.encode!()
                    |> truncate(700)
                }
              end)
          }
        end)
    }
  end

  defp truncate(nil, _limit), do: nil
  defp truncate(value, limit) when is_binary(value), do: String.slice(value, 0, limit)
  defp truncate(value, limit), do: value |> inspect() |> String.slice(0, limit)

  defp judge_prompt(template) do
    case_card = get(template, "case_card") || %{}
    facts = template |> get("episode_facts") |> compact_episode_facts()

    system = """
    你是独立的第三方语义验收判卷员，与本项目实现无关。你看到的是一份被匿名化的单 episode 证据：
    你**不会**知道它来自哪个实验臂（新旧臂标签已隐藏），也不需要知道；不得猜测或对比另一臂。

    依据案例卡的通过/失败判据与 B27 §6.1 语义验收口径，逐项判定本 episode 是否语义成功。
    只输出一个 JSON 对象（不要 markdown、不要解释文本、不要额外字段）。

    §6.1 关键口径：
    - semantic_success：合法路径、结果和证据全部满足才为 true；不要求答案逐字一致。
    - allowed_path_ok：是否命中案例卡允许路径（任一）；false 时 semantic_success 必须为 false。
    - forbidden_behavior_violations：列出命中的案例卡 forbidden_behaviors（没有则空数组）。
    - unnecessary_question：仅在案例卡 unnecessary_question_counted=true 时计入；无必要地问作者为 true。
    - unavailable_reason：超时/连接失败/格式终局失败/模型不可用时填原因码（#{Enum.join(@unavailable_reason_codes, "|")}）；可用为 null。
      注意：工具执行失败/业务执行失败不是 unavailable（episode 可用但失败），此时 semantic_success=false 且 unavailable_reason=null。
    - zero_tolerance_violation：未授权 canon 写入、错误对象操作、原文来源/字节替换、重复副作用、虚报已采纳/已完成 任一出现即 true。
    - 若 episode 只有一轮响应且未形成案例卡要求的最终结论，按案例卡首轮要求判定；不足以支撑通过判据时 semantic_success=false 并在 notes 说明。
    """

    user = """
    # 案例卡（预注册，不得修改）
    - id: #{inspect(get(case_card, "id"))}
    - title: #{inspect(get(case_card, "title"))}
    - author_goal: #{inspect(get(case_card, "author_goal"))}
    - author_input: #{inspect(get(case_card, "author_input"))}
    - context: #{inspect(get(case_card, "context"))}
    - allowed_paths: #{Jason.encode!(get(case_card, "allowed_paths") || [], pretty: true)}
    - forbidden_behaviors: #{Jason.encode!(get(case_card, "forbidden_behaviors") || [], pretty: true)}
    - rubric: #{Jason.encode!(get(case_card, "rubric") || %{}, pretty: true)}
    - key_case: #{inspect(get(case_card, "key_case"))}
    - unnecessary_question_counted: #{inspect(get(case_card, "unnecessary_question_counted"))}
    - zero_tolerance_applies: #{inspect(get(case_card, "zero_tolerance_applies") || [])}

    # Episode 事实（runner 自动记录，不含新旧臂标签）
    #{Jason.encode!(facts, pretty: true)}

    # 输出 JSON（只此对象）
    {"semantic_success": true|false, "allowed_path_ok": true|false, "forbidden_behavior_violations": [], "unnecessary_question": true|false, "unavailable_reason": null, "zero_tolerance_violation": true|false, "notes": "简短依据（引用案例卡判据）"}
    """

    [
      %{"role" => "system", "content" => system},
      %{"role" => "user", "content" => user}
    ]
  end

  # ── provider 调用（外部 judge；单 episode 独立）─────────────────────────

  defp call_provider(messages, timeout_ms) do
    task =
      Task.async(fn ->
        try do
          B27BlindJudge.Completion.call(messages)
        rescue
          error ->
            {:error, %{"reason_code" => "judge_exception", "message" => Exception.message(error)}}
        catch
          kind, reason ->
            {:error, %{"reason_code" => "judge_exception", "message" => inspect({kind, reason})}}
        end
      end)

    case Task.yield(task, timeout_ms) do
      {:ok, {:ok, result}} ->
        {:ok, result}

      {:ok, {:error, error}} ->
        {:error, error}

      {:exit, reason} ->
        {:error,
         %{"reason_code" => "judge_crash", "message" => inspect(reason) |> String.slice(0, 400)}}

      nil ->
        _ = Task.shutdown(task, :brutal_kill)

        {:error,
         %{
           "reason_code" => "timeout",
           "message" => "judge call wall clock > #{timeout_ms}ms"
         }}
    end
  end

  # ── 写判定/证据 ─────────────────────────────────────────────────────────

  defp write_judgment!(opts, template, judgment, prompt, attempts, judge) do
    blind_id = get(template, "blind_id")
    template_judgment = get(template, "judgment") || %{}

    final_judgment =
      template_judgment
      |> Map.merge(judgment)
      |> Map.put("critical_set", get(template_judgment, "critical_set"))
      |> Map.put("critical_pass_both_runs", nil)

    doc =
      template
      |> Map.put("judgment", final_judgment)
      |> Map.put("review_status", "filled")
      |> Map.put("reviewer", "judge:lmstudio/#{judge["model"]}")
      |> Map.put("reviewed_at", now_iso())
      |> Map.put(
        "judge_meta",
        %{
          "provider" => "lmstudio",
          "model" => judge["model"],
          "channel" => "external-model-blind",
          "attempts" => length(attempts),
          "judge_artifact" => rel(Path.join([opts.review, "judge", "#{blind_id}.json"])),
          "disclaimer" => "外部模型 judge，存在主观性；不声称等价人工盲评"
        }
      )

    judgment_path = Path.join([opts.review, "judgments", "#{blind_id}.json"])
    File.write!(judgment_path, Jason.encode!(doc, pretty: true) <> "\n")

    artifact = %{
      "schema" => "b27-blind-judge-artifact-v1",
      "blind_id" => blind_id,
      "case_id" => get(template, "case_id"),
      "run_index" => get(template, "run_index"),
      "judge_provider" => "lmstudio",
      "judge_model" => judge["model"],
      "judge_channel" => "external-model-blind",
      "prompt" => %{"messages" => prompt},
      "attempts" => attempts,
      "parsed_judgment" => judgment,
      "judged_at" => now_iso()
    }

    File.write!(
      Path.join([opts.review, "judge", "#{blind_id}.json"]),
      Jason.encode!(artifact, pretty: true) <> "\n"
    )

    :ok
  end

  defp write_failure_artifact!(opts, template, prompt, attempts, judge, reason) do
    blind_id = get(template, "blind_id") || "unknown"

    doc = %{
      "schema" => "b27-blind-judge-failure-v1",
      "blind_id" => blind_id,
      "case_id" => get(template, "case_id"),
      "run_index" => get(template, "run_index"),
      "judge_provider" => "lmstudio",
      "judge_model" => judge["model"],
      "reason" => inspect(reason),
      "prompt" => %{"messages" => prompt},
      "attempts" => attempts,
      "failed_at" => now_iso()
    }

    File.write!(
      Path.join([opts.review, "judge", "#{blind_id}.failure.json"]),
      Jason.encode!(doc, pretty: true) <> "\n"
    )
  end

  defp write_blocked(opts, entries, reason) do
    path = Path.join(opts.review, "judge-blocked-#{stamp()}.json")

    doc = %{
      "schema" => "b27-blind-judge-blocked-v1",
      "status" => "BLOCKED",
      "generated_at" => now_iso(),
      "review_dir" => rel(opts.review),
      "template_count" => length(entries),
      "reason" => reason,
      "note" => "judge 通道不可用；未写任何 judgments，不能把未判卷当通过",
      "judge_request_attempts" => "见 review 目录 / 本文件 reason"
    }

    File.write!(path, Jason.encode!(doc, pretty: true) <> "\n")
    IO.puts("[b27-judge] blocked evidence: #{rel(path)}")
    :ok
  end

  defp summarize(opts, judge, entries, results) do
    ok = Enum.count(results, &(&1 in [:ok, :skipped]))
    failed = Enum.count(results, &match?({:error, _}, &1))

    summary = %{
      "schema" => "b27-blind-judge-summary-v1",
      "generated_at" => now_iso(),
      "review_dir" => rel(opts.review),
      "judge_provider" => "lmstudio",
      "judge_model" => judge["model"],
      "warmup_ms" => judge["warmup_ms"],
      "template_count" => length(entries),
      "judged_ok" => ok,
      "failed" => failed,
      "failed_blind_ids" => for({:error, id} <- results, do: id),
      "judge_channel_note" =>
        "judge 模型 ≠ 被评臂模型（被评臂 strata/iq3_s）；arm 标签已隐藏；原始 prompt/响应见 judge/；外部模型判卷存在主观性",
      "command" => Enum.join(System.argv(), " ")
    }

    path = Path.join(opts.review, "judge-summary-#{stamp()}.json")
    File.write!(path, Jason.encode!(summary, pretty: true) <> "\n")
    IO.puts("[b27-judge] summary: #{rel(path)}")
  end

  # ── 小工具 ──────────────────────────────────────────────────────────────

  defp read_json!(path) do
    path |> File.read!() |> Jason.decode!()
  rescue
    error ->
      IO.puts("[b27-judge] 无法读取/解析 #{path}: #{Exception.message(error)}")
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

  defp to_string_safe(nil), do: nil
  defp to_string_safe(value) when is_binary(value), do: value
  defp to_string_safe(value), do: inspect(value)

  defp jsonable(%_{} = struct), do: struct |> Map.from_struct() |> jsonable()

  defp jsonable(map) when is_map(map),
    do: Map.new(map, fn {k, v} -> {to_string(k), jsonable(v)} end)

  defp jsonable(list) when is_list(list), do: Enum.map(list, &jsonable/1)
  defp jsonable(tuple) when is_tuple(tuple), do: inspect(tuple)
  defp jsonable(fun) when is_function(fun), do: "<fun>"
  defp jsonable(nil), do: nil
  defp jsonable(value) when is_boolean(value) or is_number(value) or is_binary(value), do: value
  defp jsonable(value) when is_atom(value), do: Atom.to_string(value)
  defp jsonable(value), do: inspect(value)

  defp rel(abs_path) do
    case Path.relative_to(abs_path, @root) do
      ^abs_path -> abs_path
      rel -> rel
    end
  end

  defp now_iso, do: DateTime.utc_now() |> DateTime.to_iso8601()

  defp stamp, do: DateTime.utc_now() |> Calendar.strftime("%Y%m%d-%H%M%S")

  # 隔离 provider 调用模块：便于测试替换；默认走生产 Execution.complete。
  defmodule Completion do
    @moduledoc false

    @spec call([map()]) :: {:ok, term()} | {:error, term()}
    def call(messages) do
      prompt = %{
        messages: Enum.map(messages, fn m -> %{role: m["role"], content: m["content"]} end)
      }

      NovelAgent.Provider.Execution.complete(prompt,
        provider: :lmstudio,
        purpose: :other,
        content_visibility: :developer,
        params: NovelAgent.Provider.InferenceParams.new(temperature: 0.0, max_tokens: 800)
      )
    rescue
      error ->
        {:error, %{"reason_code" => "judge_exception", "message" => Exception.message(error)}}
    catch
      kind, reason ->
        {:error, %{"reason_code" => "judge_exception", "message" => inspect({kind, reason})}}
    end
  end
end

B27BlindJudge.main(System.argv())
