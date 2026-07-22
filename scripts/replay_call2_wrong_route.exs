# call2"登记"误判修复重放 A/B（M3 跑后取证，T4 方法论）
#
# 语料：本跑 19 例 prose 请求被 call2 判 reply 的原始 author_text
# （scratchpad/call2-wrong-corpus.json）；基线=旧模板历史结果 0/19 execute。
# 重放：同输入 × 生产 request_judgment（新 call2 模板）× 重负载 context
# （真实百章标题列表），测 action 命中与首调可用率。
#
# 用法：PHX_SERVER=false MIX_ENV=test mix run scripts/replay_call2_wrong_route.exs <corpus.json> <titles.txt>

alias NovelAgent.Provider.Execution
alias NovelApplication.ExplorationService
alias NovelApplication.JudgmentProtocol

[corpus_path, titles_path] = System.argv()

corpus = corpus_path |> File.read!() |> Jason.decode!()
titles = titles_path |> File.read!() |> String.split("\n", trim: true)

context_block = """
## 当前作品上下文
- title: P1 单章正文草稿验证作品
- revision: 1
- core_selling_point: 从已采纳章节计划生成待采纳正文草稿
- genre: 赛博修仙
- main_goal: 主角从欠费停灵的底层散修成长为打破灵气垄断的关键人物
- premise: 底层散修在灵气被公司垄断计费的都市里，靠旧网络残诀撕开垄断链条
- target_reader: 关注长篇主链闭环的作者
- tone_preference: 克制、紧张、具象

## 章节列表（共 #{length(titles)} 章）
#{Enum.map_join(titles, "\n", &("- " <> &1))}
（回答进度类问题时依据这里的章节顺序和数量；各章正文细节不在本段内。）
"""

execution = Execution.dependency(provider: :lmstudio)

results =
  corpus
  |> Enum.with_index(1)
  |> Enum.map(fn {case_data, index} ->
    input = %{
      author_text: case_data["author_text"],
      context_block: context_block,
      options: [
        explore: true,
        capabilities:
          ~w(character_design character_evolution prose_writing plot_outline world_building work_archive_read),
        explore_tools: ExplorationService.tool_names()
      ]
    }

    case JudgmentProtocol.request_judgment(execution, %{}, input) do
      {:ok, judgment} ->
        first_try = Map.get(judgment, :provider_call_count) == 2

        IO.puts(
          "[#{index}/#{length(corpus)}] action=#{judgment.action} capability=#{judgment.capability} " <>
            "first_try=#{first_try} | #{String.slice(case_data["author_text"], 0, 30)}"
        )

        %{action: judgment.action, capability: judgment.capability, first_try: first_try}

      {:error, reason} ->
        IO.puts("[#{index}/#{length(corpus)}] ERROR #{inspect(reason)}")
        %{action: :error, capability: nil, first_try: false}
    end
  end)

execute_hits = Enum.count(results, &(&1.action == "execute"))
prose_hits = Enum.count(results, &(&1.action == "execute" and &1.capability == "prose_writing"))
first_try_hits = Enum.count(results, & &1.first_try)
errors = Enum.count(results, &(&1.action == :error))

IO.puts("""

[replay-ab] 基线（旧模板历史）：0/#{length(corpus)} execute
[replay-ab] 新模板：execute=#{execute_hits}/#{length(corpus)} prose_writing=#{prose_hits}/#{length(corpus)} \
call2_first_try=#{first_try_hits}/#{length(corpus)} errors=#{errors}
""")
