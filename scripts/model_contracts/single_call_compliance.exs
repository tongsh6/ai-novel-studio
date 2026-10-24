# B26：生产唯一协议与整组响应守卫。历史两段式基线仅保留在 artifacts 的版本快照。
# stub：仅确定性协议检查；真实 provider：通过后继续既有生产判断 MBC，不写作品数据。
alias NovelAgent.Provider.Execution
alias NovelApplication.JudgmentProtocol
alias NovelCommon.Contracts.ProviderOutput

checks = [
  {"plain", "自然回复，不生成候选。", [], "reply"},
  {"question-empty", "请补充结尾方向。",
   [%{name: "ask_author", arguments: %{question: "请补充结尾方向。", options: []}}], "await_author"},
  {"question-options", "结尾如何取舍？",
   [
     %{
       name: "ask_author",
       arguments: %{question: "结尾如何取舍？", options: [%{value: "keep", label: "保留悬念"}]}
     }
   ], "await_author"},
  {"author-source", "按原文生成候选。",
   [
     %{
       name: "register_author_content",
       arguments: %{
         author_content_source_ref: "current",
         dialogue_goal: "登记资料",
         author_reasoning: "按原文生成候选。"
       }
     }
   ], "author_content_registration"},
  {"directions", "提供内容方向。",
   [
     %{
       name: "propose_creative_directions",
       arguments: %{
         author_reasoning: "提供内容方向。",
         candidate_directions: [%{title: "误会", pitch: "从误会引出冲突"}]
       }
     }
   ], "creative_directions"},
  {"gap", "当前没有角色主档案修改能力。",
   [
     %{
       name: "report_capability_gap",
       arguments: %{
         dialogue_goal: "改角色身份",
         missing_effect: "主档案修改",
         author_reasoning: "当前没有角色主档案修改能力。"
       }
     }
   ], "capability_gap"}
]

rows =
  Enum.map(checks, fn {id, content, calls, expected} ->
    {:ok, captured} = Agent.start_link(fn -> [] end)

    execution = %Execution{
      result_fn: fn prompt ->
        Agent.update(captured, &[prompt | &1])

        {:ok,
         %{
           content: content,
           tool_calls: calls,
           provider_output: %ProviderOutput{
             provider_run_ref: "run-#{id}",
             provider_call_ref: "call-#{id}",
             status: :ok,
             content: %{text: content, tool_calls: calls}
           }
         }}
      end
    }

    result =
      JudgmentProtocol.request_judgment(execution, %{}, %{
        author_text: "合成协议样本",
        context_block: "无真实作品数据",
        options: []
      })

    requests = Agent.get(captured, & &1)
    Agent.stop(captured)

    passed =
      case result do
        {:ok, judgment} ->
          judgment.action == expected and judgment.narrative == content and
            judgment.provider_call_count == 1 and length(requests) == 1 and
            hd(requests).tool_choice == "auto"

        _ ->
          false
      end

    %{case: id, passed: passed, request_count: length(requests)}
  end)

paths =
  ~w(apps/novel_application/lib/novel_application/judgment_protocol.ex apps/novel_application/lib/novel_application/agentic_plan_draft_planner.ex)

for path <- paths do
  source = File.read!(path)

  if Regex.match?(
       ~r/request_narrative\(|draft_reasoning_prompt\(|revision_reasoning_prompt\(|tool_choice:\s*"none"/,
       source
     ),
     do: raise("生产旧协议残留：#{path}")
end

File.mkdir_p!("artifacts/model-contracts/single-call")

File.write!(
  "artifacts/model-contracts/single-call/mechanism.json",
  Jason.encode!(%{evidence: "deterministic_protocol_only", checks: rows}, pretty: true)
)

unless Enum.all?(rows, & &1.passed), do: raise("单调用协议守卫失败")
IO.puts("B26 单调用机制守卫：#{length(rows)} 项通过；不是模型语义质量证明。")

case System.argv() do
  [provider | _] when provider != "stub" -> Code.require_file("judgment_protocol.exs", __DIR__)
  _ -> :ok
end
