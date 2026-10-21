# Prompt prefix live cache probe (VS-00I §6.2，CP-E 厂商基线)
#
# 目标：在真实 provider 上验证「同一份生产 prompt 连续两次」的缓存相关事实：
#   - 有命中字段的厂商（DeepSeek）：读 `prompt_cache_hit_tokens` / miss tokens，
#     第二次调用应出现可解释的命中（同一前缀、TTL 内）。
#   - 无命中字段的厂商（LM Studio / llama.cpp）：读 `ttft_ms` 作为代理，第二次
#     调用应出现断崖式下降（同 slot KV 前缀复用；单会话前提见 VS-00I §5）。
#
# 用法：
#   PHX_SERVER=false mix run scripts/model_contracts/prompt_prefix_live.exs [lmstudio|strata|deepseek]
#
# 环境变量：
#   PREFIX_PROBE_RUNS                 连续请求次数（默认 2）
#   NOVEL_DEEPSEEK_API_KEY             deepseek 凭据（缺失 → exit 65）
#   NOVEL_DEEPSEEK_MODEL / NOVEL_LMSTUDIO_MODEL  模型覆盖（同生产配置）
#
# 报告：artifacts/model-contracts/prefix-live/<provider>.{md,json}
# 说明：本探针只读 usage/provider 事实，不写作品数据，不改变生产行为。

alias NovelAgent.Provider.{DeepSeek, Gateway, InferenceParams}
alias NovelApplication.{DialoguePlanningService, JudgmentProtocol}
alias NovelDomain.DialogueContext

defmodule ModelContracts.PromptPrefixLive do
  @moduledoc false

  @chapter_titles [
    "第01章：底层灵气账单",
    "第02章：旧服务器里的残诀",
    "第03章：黑市调频师",
    "第04章：巡检队的诱捕",
    "第05章：霓虹地牢试炼",
    "第06章：中层执行者的裂缝",
    "第07章：断网之城",
    "第08章：核心模块的代价",
    "第09章：伪仙直播夜",
    "第10章：反向筑基协议",
    "第11章：天台上的背叛",
    "第12章：第一卷终局：灵气回流"
  ]

  @capabilities ~w(character_design character_evolution prose_writing plot_outline world_building work_archive_read)

  def main(argv) do
    provider = List.first(argv) || "lmstudio"
    runs = env_int("PREFIX_PROBE_RUNS", 2)

    case prepare(provider) do
      {:error, message} ->
        IO.puts(:stderr, "[prompt-prefix-live] #{message}")
        System.halt(65)

      :ok ->
        prompt = judgment_prompt()

        rows =
          for index <- 1..runs do
            run_once(provider, prompt, index)
          end

        summary = %{
          probe: "prompt-prefix-live",
          provider: provider,
          model: configured_model(provider),
          generated_at: DateTime.utc_now() |> DateTime.to_iso8601(),
          prompt_bytes: byte_size(serialized(prompt)),
          runs: rows
        }

        write_report(summary)
        print_report(summary)
    end
  end

  # ── provider 准备（与 MBC 探针同范式：只覆盖本进程运行时配置） ──

  defp prepare("deepseek") do
    key = System.get_env("NOVEL_DEEPSEEK_API_KEY") || System.get_env("DEEPSEEK_API_KEY")

    if is_binary(key) and key != "" do
      existing = Application.get_env(:novel_agent, DeepSeek, [])

      Application.put_env(
        :novel_agent,
        DeepSeek,
        Keyword.merge(existing,
          api_key: key,
          thinking: :disabled,
          timeout: env_int("NOVEL_DEEPSEEK_TIMEOUT_MS", 300_000)
        )
      )

      :ok
    else
      {:error, "deepseek 凭据缺失（NOVEL_DEEPSEEK_API_KEY / DEEPSEEK_API_KEY），登记为阻塞"}
    end
  end

  defp prepare("lmstudio"), do: :ok
  defp prepare("strata"), do: :ok
  defp prepare(other), do: {:error, "未知 provider: #{other}（支持 lmstudio|strata|deepseek）"}

  # Gateway/Provider 层用 atom 选 adapter；argv 是字符串，显式映射避免 to_atom 扩散。
  defp provider_atom("deepseek"), do: :deepseek
  defp provider_atom("lmstudio"), do: :lmstudio
  defp provider_atom("strata"), do: :strata

  defp configured_model("deepseek"),
    do: Application.get_env(:novel_agent, DeepSeek, [])[:model]

  defp configured_model("lmstudio"),
    do: Application.get_env(:novel_agent, NovelAgent.Provider.LMStudio, [])[:model]

  defp configured_model("strata"),
    do: Application.get_env(:novel_agent, NovelAgent.Provider.Strata, [])[:model]

  # ── 生产 prompt（判断 call1；L0 由 Gateway 身份注入） ──

  defp judgment_prompt do
    titles = @chapter_titles
    author_text = "接着第02章往下写一段正文"

    context = %DialogueContext{
      workspace_id: "ws_prefix_live",
      current_work_snapshot: %{
        title: "前缀实测样书",
        revision: 1,
        genre: "赛博修仙",
        tone_preference: "克制、紧张、具象"
      },
      conversation_summary: "上一轮采纳了第01章草稿，作者准备继续推进正文。",
      interaction_state: %{},
      current_chapters: titles,
      structured_chapters: Enum.map(titles, &%{title: &1, has_prose: true}),
      assembled_at: DateTime.utc_now() |> DateTime.to_iso8601()
    }

    %{
      author_text: author_text,
      context_block: DialoguePlanningService.judgment_context_block(context, author_text),
      options: [explore: true, capabilities: @capabilities, explore_tools: []]
    }
    |> JudgmentProtocol.narrative_prompt()
  end

  defp run_once(provider, prompt, index) do
    started = System.monotonic_time(:millisecond)

    case Gateway.execute(prompt, nil, InferenceParams.new(), provider: provider_atom(provider)) do
      {:ok, %{result: %{usage: usage}}} ->
        %{
          run: index,
          wall_ms: System.monotonic_time(:millisecond) - started,
          usage: usage_map(usage)
        }

      {:error, %{error: error}} ->
        IO.puts(:stderr, "[prompt-prefix-live] #{provider} run #{index} 失败: #{inspect(error)}")
        System.halt(1)
    end
  end

  defp usage_map(nil), do: %{}

  defp usage_map(%NovelAgent.Provider.Usage{} = usage),
    do: NovelAgent.Provider.Usage.to_map(usage)

  defp usage_map(map) when is_map(map), do: map

  # ── 报告 ──

  defp write_report(summary) do
    dir = Path.join(["artifacts", "model-contracts", "prefix-live"])
    File.mkdir_p!(dir)

    File.write!(Path.join(dir, "#{summary.provider}.json"), Jason.encode!(summary, pretty: true))
    File.write!(Path.join(dir, "#{summary.provider}.md"), render_markdown(summary))
  end

  defp render_markdown(summary) do
    lines = [
      "# Prompt prefix live baseline (VS-00I §6.2)",
      "",
      "- provider: `#{summary.provider}`",
      "- model: `#{summary.model}`",
      "- generated: #{summary.generated_at}",
      "- prompt bytes: #{summary.prompt_bytes}",
      "",
      "| run | wall_ms | ttft_ms | latency_ms | input_tokens | output_tokens | cached_tokens |",
      "|---:|---:|---:|---:|---:|---:|---:|"
    ]

    rows =
      Enum.map(summary.runs, fn row ->
        usage = row.usage

        "| #{row.run} | #{row.wall_ms} | #{value(usage[:ttft_ms])} | #{value(usage[:latency_ms])} | " <>
          "#{value(usage[:input_tokens])} | #{value(usage[:output_tokens])} | " <>
          "#{value(usage[:cached_tokens])} |"
      end)

    Enum.join(lines ++ rows, "\n") <> "\n"
  end

  defp print_report(summary) do
    IO.puts("\n[prompt-prefix-live] provider=#{summary.provider} model=#{summary.model}")

    Enum.each(summary.runs, fn row ->
      IO.puts(
        "  run #{row.run}: wall=#{row.wall_ms}ms ttft=#{value(row.usage[:ttft_ms])}ms " <>
          "cached=#{value(row.usage[:cached_tokens])} input=#{value(row.usage[:input_tokens])} " <>
          "output=#{value(row.usage[:output_tokens])}"
      )
    end)
  end

  defp value(nil), do: "-"
  defp value(value), do: to_string(value)

  defp serialized(%{messages: messages} = prompt) do
    Enum.map_join(messages, "", fn message -> "#{message.role}\n#{message.content}" end) <>
      Jason.encode!(Map.get(prompt, :tools, []))
  end

  defp env_int(name, default) do
    case System.get_env(name) do
      nil -> default
      value -> String.to_integer(value)
    end
  end
end

ModelContracts.PromptPrefixLive.main(System.argv())
