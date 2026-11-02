defmodule NovelAgent.Provider.SliceVerifyLogTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.Result
  alias NovelAgent.Test.Provider.SliceVerify

  @author_behavior_env "AUTHOR_BEHAVIOR_CORPUS_JSON"

  setup do
    old_dir = Application.get_env(:novel_common, :llm_log_dir)
    dir = Path.join(System.tmp_dir!(), "slice-verify-log-#{System.unique_integer([:positive])}")
    Application.put_env(:novel_common, :llm_log_dir, dir)
    Logger.reset_metadata([])

    on_exit(fn ->
      Logger.reset_metadata([])
      restore_env(:llm_log_dir, old_dir)
      File.rm_rf!(dir)
    end)

    %{dir: dir}
  end

  test "complete writes one request/response pair with the fixture formats", %{dir: dir} do
    prompt = [%{role: "user", content: "请回一句收到"}]
    params = %InferenceParams{temperature: 0.2}

    Logger.metadata(
      work_id: "work-log",
      session_id: "session-log",
      turn_id: "turn-log",
      provider_call_ref: "pcall-stale",
      provider_run_ref: "prun-stale"
    )

    assert {:ok, %Result{} = result} =
             SliceVerify.complete(%SliceVerify{}, "fixture-model", prompt, params)

    [record] = read_records(dir)

    assert record["provider"] == "slice_verify"
    assert record["request_format"] == "provider_prompt/v1"
    assert record["response_format"] == "fixture_provider_result/v1"
    assert record["prompt"] == NovelAgent.Provider.prompt_text(prompt)

    assert record["request_body"]["messages"] ==
             prompt
             |> NovelAgent.Provider.normalize_messages()
             |> Jason.encode!()
             |> Jason.decode!()

    assert record["request_body"]["tools"] == []
    assert record["tools"] == []
    assert record["tool_choice"] == nil
    assert record["work_id"] == "work-log"
    assert record["session_id"] == "session-log"
    assert record["turn_id"] == "turn-log"
    assert record["model"] == "fixture-model"
    assert record["inference_params"]["temperature"] == 0.2

    assert record["provider_call_ref"] == nil
    assert record["provider_run_ref"] == nil

    assert record["response"]["status"] == "ok"
    assert record["response"]["body"]["content"] == result.content
    assert record["response"]["body"]["tool_calls"] == []
    assert record["response"]["body"]["usage"]["model"] == "slice-verify-model"
  end

  test "complete writes one error pair without a fake assistant or HTTP 200", %{dir: dir} do
    prompt = "请回一句收到 UA01PROVIDERFAIL"

    assert {:error, %{type: :provider_error}} =
             SliceVerify.complete(%SliceVerify{}, nil, prompt, %InferenceParams{})

    [record] = read_records(dir)

    assert record["response"]["status"] == "error"
    assert record["response"]["body"]["error"]["message"] =~ "UA01PROVIDERFAIL"
    refute Map.has_key?(record["response"]["body"], "content")
    refute Map.has_key?(record["response"]["body"], "tool_calls")
    refute Map.has_key?(record["response"], "http_status")
  end

  test "author behavior branch still writes exactly one pair", %{dir: dir} do
    corpus = Path.join(dir, "corpus.json")
    File.mkdir_p!(dir)

    File.write!(
      corpus,
      Jason.encode!(%{
        "fixtures" => [
          %{
            "case_id" => "C-LOG-001",
            "expression" => "把第02章补完，接上现在的结尾。",
            "action" => "reply",
            "reply_text" => "日志配对的确定性回复。"
          }
        ]
      })
    )

    previous = System.get_env(@author_behavior_env)
    System.put_env(@author_behavior_env, corpus)

    on_exit(fn ->
      if previous,
        do: System.put_env(@author_behavior_env, previous),
        else: System.delete_env(@author_behavior_env)
    end)

    prompt = "创作判断器\n## 作者输入\n把第02章补完，接上现在的结尾。"

    assert {:ok, %Result{} = result} =
             SliceVerify.complete(%SliceVerify{}, nil, prompt, %InferenceParams{})

    [record] = read_records(dir)

    assert record["response"]["status"] == "ok"
    assert record["response"]["body"]["content"] == result.content
    assert record["response"]["body"]["content"] == "日志配对的确定性回复。"
  end

  test "duplicate native tool ids and raw arguments are recorded as returned", %{dir: dir} do
    prompt = "创作判断器\n## 作者输入\n仅记录纠正样例"

    assert {:ok, %Result{} = result} =
             SliceVerify.complete(%SliceVerify{}, nil, prompt, %InferenceParams{})

    assert [first, second] = result.tool_calls
    assert first["id"] == second["id"]
    assert first["name"] == second["name"]

    [record] = read_records(dir)

    assert record["response"]["status"] == "ok"
    assert [logged_first, logged_second] = record["response"]["body"]["tool_calls"]
    assert logged_first["id"] == first["id"]
    assert logged_second["id"] == second["id"]
    assert logged_first["name"] == first["name"]
    assert logged_second["name"] == second["name"]

    assert argument(logged_first["arguments"], "author_reasoning") ==
             argument(first["arguments"], :author_reasoning)

    assert length(argument(logged_first["arguments"], "candidate_directions")) ==
             length(argument(first["arguments"], :candidate_directions))

    assert logged_first["arguments"] == logged_second["arguments"]
  end

  test "execute records the refs supplied by ctx, not a lingering logger ref", %{dir: dir} do
    prompt = [%{role: "user", content: "请回一句收到"}]

    Logger.metadata(provider_call_ref: "pcall-stale", provider_run_ref: "prun-stale")

    ctx = %{
      provider_name: :slice_verify,
      model_name: "fixture-model",
      provider_call_ref: "pcall-exec",
      provider_run_id: "prun-exec",
      purpose: :conversation,
      owner_refs: %{},
      content_visibility: :developer
    }

    assert {:ok, %{result: %Result{}}} =
             SliceVerify.execute(
               %SliceVerify{},
               "fixture-model",
               prompt,
               %InferenceParams{},
               ctx
             )

    [record] = read_records(dir)

    assert record["provider_call_ref"] == "pcall-exec"
    assert record["provider_run_ref"] == "prun-exec"
    refute record["provider_call_ref"] == "pcall-stale"
    assert record["response"]["status"] == "ok"
  end

  test "a log write failure leaves the fixture result unchanged", %{dir: dir} do
    broken_dir = Path.join(dir, "not-a-directory")
    File.mkdir_p!(dir)
    File.write!(broken_dir, "blocked")
    Application.put_env(:novel_common, :llm_log_dir, broken_dir)

    prompt = [%{role: "user", content: "请回一句收到"}]

    assert {:ok, %Result{content: content}} =
             SliceVerify.complete(%SliceVerify{}, nil, prompt, %InferenceParams{})

    assert is_binary(content)
    assert content != ""
  end

  defp read_records(dir) do
    path = Path.join(dir, "#{NovelCommon.LogFileDate.today_iso8601()}.jsonl")

    path
    |> File.read!()
    |> String.split("\n", trim: true)
    |> Enum.map(&Jason.decode!/1)
  end

  defp argument(arguments, key) when is_map(arguments) do
    Map.get(arguments, key) || Map.get(arguments, to_string(key))
  end

  defp restore_env(key, nil), do: Application.delete_env(:novel_common, key)
  defp restore_env(key, value), do: Application.put_env(:novel_common, key, value)
end
