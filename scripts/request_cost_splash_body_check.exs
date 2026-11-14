# B87 R01 无模型请求体核对：用现役 Splash adapter 从**实际 Application 配置**构造
# Chat Completions 流式请求体，经 test-only eventsource 边界截获；不连接网络、不生成。
# 输出只含 model/reasoning_effort/has_thinking 三个白名单字段。
alias NovelAgent.Provider.InferenceParams
alias NovelAgent.Provider.Splash
alias NovelTest.TestRequestIR

parent = self()

eventsource = fn _url, body, _opts, on_data ->
  send(parent, {:captured_body, body})
  payload = Jason.encode!(%{"choices" => [%{"delta" => %{"content" => "ok"}}], "model" => "local/Q4-PLE4"})
  on_data.("data: #{payload}\n\n")
  on_data.("data: [DONE]\n\n")
  {:ok, 200, ""}
end

state = %{Splash.from_config() | eventsource_fn: eventsource}

ir = TestRequestIR.ir([TestRequestIR.author("runtime request body check")])

ctx = %{
  provider_name: :splash,
  model_name: "local/Q4-PLE4",
  provider_call_ref: "pcall_runtime_body_check",
  provider_run_id: "prun_runtime_body_check",
  purpose: :conversation,
  owner_refs: %{}
}

{:ok, _result} = Splash.execute(state, nil, ir, %InferenceParams{}, ctx)

body =
  receive do
    {:captured_body, body} -> body
  after
    5_000 -> raise "未截获 Splash 请求体"
  end

facts = %{
  "model" => Map.get(body, :model),
  "reasoning_effort" => Map.get(body, :reasoning_effort),
  "has_thinking_object" => Map.has_key?(body, :thinking),
  "stream" => Map.get(body, :stream)
}

case System.argv() do
  [out] ->
    out |> Path.dirname() |> File.mkdir_p!()
    File.write!(out, Jason.encode!(facts, pretty: true) <> "\n")

  _ ->
    IO.puts(Jason.encode!(facts, pretty: true))
end
