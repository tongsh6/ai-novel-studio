defmodule ModelContracts.RequestCostConstruct do
  @moduledoc """
  B87 R05：同一冻结 recipe 经当前 checkout 的生产 run 构造请求。
  只在脚本内替换 Splash transport；原生固定响应不是模型推理证据。
  判断路由只依据实际工具 schema 选择唯一必填作者说明字段；固定响应随请求保留。
  DB/源码副本由外部 root 准备；不迁移、seed、恢复数据库或操作 Git。
  """
  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.{Execution, RuntimeConfig}
  alias NovelApplication.{AgentRunService, AuthoringCheckpoint, DialoguePlanningService}
  alias NovelApplication.AgentRunFlows.AuthoringSession
  alias NovelCommon.RequestIR
  alias NovelPersistence.Repo

  @recipe_schema "b87-r05-constructed-request-recipe/v1"
  @capture_schema "b87-r05-constructed-request-capture/v1"

  def main(argv) do
    {opts, []} =
      OptionParser.parse!(argv,
        strict: [recipe: :string, case: :string, request: :string, arm: :string, out: :string]
      )

    true = Mix.env() == :test
    recipe_path = opts |> Keyword.fetch!(:recipe) |> Path.expand()
    arm = Keyword.fetch!(opts, :arm)
    true = arm in ["before", "after"]
    recipe = read_json!(recipe_path)
    @recipe_schema = recipe["schema"]
    base = Path.dirname(recipe_path)

    pair =
      Enum.filter(recipe["pairs"], fn pair ->
        pair["case_id"] == Keyword.fetch!(opts, :case) and
          pair["request"] == Keyword.fetch!(opts, :request)
      end)
      |> then(fn [pair] -> pair end)

    output = opts |> Keyword.fetch!(:out) |> Path.expand()

    unless String.contains?(output, "/artifacts/slice-verify/b87-r05-20261118/") do
      raise "R05 evidence must be under artifacts/slice-verify/b87-r05-20261118"
    end

    File.mkdir_p!(Path.dirname(output))
    File.mkdir!(output)

    try do
      capture!(recipe, recipe_path, base, pair, arm, output)
    rescue
      error ->
        write_json!(output, "failure.json", %{
          schema: @capture_schema,
          pair_id: pair["id"],
          arm: arm,
          status: "failed",
          error: Exception.message(error)
        })

        reraise error, __STACKTRACE__
    end
  end

  defp capture!(recipe, recipe_path, base, pair, arm, output) do
    driver = asset!(base, recipe["driver"])
    true = sha_file!(__ENV__.file) == driver.sha256
    identity = asset!(base, recipe["source_identities"][arm])
    seed = asset!(base, pair["seed"])
    author = asset!(base, pair["author"])
    db = Repo.config() |> Keyword.fetch!(:database) |> Path.expand()
    database_sha = sha_file!(db)
    true = database_sha == pair["database_sha256"]

    case File.stat(db <> "-wal") do
      {:ok, %{size: size}} when size > 0 ->
        raise "initial DB has nonempty WAL; use a consistent snapshot"

      _ ->
        :ok
    end

    runtime = Map.fetch!(recipe, "runtime")
    "splash" = runtime["provider"]

    true =
      NovelApplication.ContextPressure.window(runtime["context_window_key"]) ==
        runtime["maintenance_window"]

    maintenance = Application.fetch_env!(:novel_application, :auto_maintenance)
    true = Keyword.fetch!(maintenance, :enabled) == runtime["auto_maintenance"]["enabled"]

    true =
      Keyword.fetch!(maintenance, :keep_recent_items) ==
        runtime["auto_maintenance"]["keep_recent_items"]

    responses = response_queue!(base, pair)
    {:ok, collector} = Agent.start_link(fn -> [] end)
    original_provider = RuntimeConfig.current_provider()
    original_config = RuntimeConfig.provider_config(:splash)
    original_persistence = Application.get_env(:novel_web, :persistence)
    original_log_dir = Application.get_env(:novel_telemetry, :llm_log_dir)

    original_sync_summary =
      Application.get_env(:novel_application, :sync_chapter_summary_maintenance)

    metadata = %{
      schema: @capture_schema,
      pair_id: pair["id"],
      arm: arm,
      recipe_sha256: sha_file!(recipe_path),
      driver_sha256: driver.sha256,
      source_identity_sha256: identity.sha256,
      database_sha256: database_sha,
      seed_sha256: seed.sha256,
      author_sha256: author.sha256,
      turn_id: pair["author"]["turn_id"],
      transport: "scripted_native_response"
    }

    try do
      Sandbox.mode(Repo, :auto)
      Application.put_env(:novel_web, :persistence, inject_real_persistence: true)
      Application.put_env(:novel_telemetry, :llm_log_dir, Path.join(output, "llm-calls"))

      Application.put_env(
        :novel_application,
        :sync_chapter_summary_maintenance,
        Map.fetch!(runtime, "sync_summary_maintenance")
      )

      install_transport(runtime, responses, collector)

      input = %{
        text: author.bytes,
        workspace_id: pair["workspace_id"],
        work_id: pair["work_id"],
        session_id: pair["session_id"],
        turn_id: pair["author"]["turn_id"],
        trace_persister: NovelApplication.persistence_tracer(),
        memory_recorder: NovelApplication.persistence_interaction_recorder()
      }

      {:ok, spec} =
        DialoguePlanningService.plan_agent_run(
          input,
          NovelApplication.persistence_fetcher(),
          Execution.dependency(provider: :splash, purpose: :conversation)
        )

      {:ok, run_id} =
        AgentRunService.start_bounded(spec.run_attrs,
          interaction_input: spec.interaction_input,
          next_step_planner: spec.next_step_planner,
          provider_execution: spec.provider_execution
        )

      state = await_terminal!(run_id, System.monotonic_time(:millisecond) + 30_000)
      records = Agent.get(collector, & &1)
      :completed = state.run.status
      true = length(records) == length(responses)
      view = AuthoringSession.with_request_view(state, &AuthoringSession.request_ir/1)
      %RequestIR{} = view
      transcript = AuthoringSession.transcript(state)
      write_json!(output, "session-view.json", RequestIR.json_value(Map.from_struct(view)))
      write_json!(output, "checkpoint.json", AuthoringCheckpoint.checkpoint(transcript))
      [llm_file] = Path.wildcard(Path.join(output, "llm-calls/*.jsonl"))
      selected = List.last(records)
      true = is_binary(selected.provider_call_ref) and is_binary(selected.provider_run_ref)

      write_json!(
        output,
        "capture.json",
        Map.merge(metadata, %{
          status: "completed",
          run_id: run_id,
          runtime: runtime,
          selected: Map.take(selected, [:provider_call_ref, :provider_run_ref]),
          llm_log: Path.relative_to(llm_file, output),
          transport_file: "transport.json",
          session_view_file: "session-view.json",
          checkpoint_file: "checkpoint.json"
        })
      )

      IO.puts("constructed #{pair["id"]} #{arm}: #{length(records)} scripted transport calls")
    after
      write_json!(output, "transport.json", Agent.get(collector, & &1))
      RuntimeConfig.put_provider_config(:splash, original_config)
      RuntimeConfig.put_current_provider(original_provider)
      restore_env(:novel_web, :persistence, original_persistence)
      restore_env(:novel_telemetry, :llm_log_dir, original_log_dir)
      restore_env(:novel_application, :sync_chapter_summary_maintenance, original_sync_summary)
      Agent.stop(collector)
    end
  end

  defp install_transport(runtime, responses, collector) do
    stream = fn _url, body, _opts, on_data ->
      refs =
        Logger.metadata()
        |> Keyword.take([
          :workspace_id,
          :work_id,
          :session_id,
          :turn_id,
          :provider_call_ref,
          :provider_run_ref
        ])
        |> Map.new()

      record = Map.put(refs, :request, %{body: body})

      index =
        Agent.get_and_update(collector, fn records ->
          {length(records), records ++ [record]}
        end)

      response = Enum.at(responses, index) || raise "unexpected additional provider request"
      response = response_for_request!(response, body)

      Agent.update(collector, fn records ->
        List.update_at(records, index, &Map.put(&1, :scripted_response, response))
      end)

      on_data.("data: " <> Jason.encode!(%{choices: [%{delta: response}]}) <> "\n\n")
      on_data.("data: [DONE]\n\n")
      {:ok, 200, ""}
    end

    RuntimeConfig.put_current_provider(:splash)

    RuntimeConfig.put_provider_config(:splash,
      endpoint: "http://127.0.0.1:1/v1",
      model: Map.fetch!(runtime, "model"),
      thinking: Map.fetch!(runtime, "thinking"),
      reasoning_effort: Map.fetch!(runtime, "reasoning_effort"),
      max_tokens: Map.fetch!(runtime, "max_tokens"),
      timeout: Map.fetch!(runtime, "timeout_ms"),
      eventsource_fn: stream,
      http_fn: fn _, _, _ -> raise "unexpected non-streaming transport" end
    )
  end

  # B87 §16.24：同一冻结 driver 只适配真实 schema 的作者说明字段，不按 arm/源码猜测。
  defp response_for_request!(%{content: "", tool_calls: [call]} = response, body) do
    schema = request_tool_schema!(body, call.function.name)

    case call.function.name do
      "judgment_decision" ->
        field = judgment_narrative_field!(schema)
        %{"author_reasoning" => narrative} = arguments = Jason.decode!(call.function.arguments)

        arguments =
          arguments
          |> Map.delete("author_reasoning")
          |> Map.put(field, narrative)

        function = %{call.function | arguments: Jason.encode!(arguments)}
        %{response | tool_calls: [%{call | function: function}]}

      "submit_tentative_artifact" ->
        response

      _ ->
        raise "unexpected scripted response tool"
    end
  end

  defp response_for_request!(%{content: text} = response, body)
       when map_size(response) == 1 and is_binary(text) do
    body |> request_tool_schema!("judgment_decision") |> judgment_narrative_field!()
    response
  end

  defp response_for_request!(_response, _body), do: raise("invalid scripted response shape")

  defp request_tool_schema!(body, name) do
    tools = body |> Map.fetch!(:tools) |> RequestIR.json_value()

    matches =
      Enum.filter(tools, fn
        %{"function" => %{"name" => ^name}} -> true
        _ -> false
      end)

    case matches do
      [%{"type" => "function", "function" => %{"parameters" => schema}}] when is_map(schema) ->
        schema

      _ ->
        raise "expected one actual #{name} tool schema"
    end
  end

  defp judgment_narrative_field!(schema) do
    with %{"type" => "object", "properties" => properties, "required" => required} <- schema,
         true <- is_map(properties) and is_list(required),
         [field] <- Enum.filter(~w(reason author_reasoning), &Map.has_key?(properties, &1)),
         %{"type" => "string"} <- Map.fetch!(properties, field),
         true <- field in required do
      field
    else
      _ ->
        raise "judgment_decision must declare exactly one required string reason/author_reasoning"
    end
  end

  defp response_queue!(_base, %{"request" => "initial"}),
    do: [%{content: "已记录本次请求。"}]

  defp response_queue!(base, %{"request" => "writer", "source" => source}) do
    prose = asset!(base, source["prose"])
    true = String.length(prose.bytes) == source["expected_graphemes"]
    true = source["expected_graphemes"] == 7000

    [
      %{
        content: "",
        tool_calls: [
          native_call("constructed-route", "judgment_decision", %{
            action: "execute",
            capability: "revise_adopted_content",
            adopted_content_ref: source["chapter_ref"],
            dialogue_goal: "整章修订，减少重复描写并保留两端线索。",
            author_reasoning: "按作者要求处理整章修订。"
          })
        ]
      },
      %{
        content: "",
        tool_calls: [
          native_call("constructed-writer", "submit_tentative_artifact", %{
            items: [
              %{
                item_id: "constructed-whole-chapter",
                title: "整章修订候选",
                body: prose.bytes,
                rationale: "固定响应只结束请求构造，不作为创作质量证据。"
              }
            ]
          })
        ]
      }
    ]
  end

  defp native_call(id, name, arguments) do
    %{
      index: 0,
      id: id,
      type: "function",
      function: %{name: name, arguments: Jason.encode!(arguments)}
    }
  end

  defp await_terminal!(run_id, deadline) do
    {:ok, state} = AgentRunService.state(run_id)

    cond do
      state.run.status in [:completed, :failed, :cancelled, :awaiting_author] ->
        state

      System.monotonic_time(:millisecond) >= deadline ->
        AgentRunService.cancel(run_id)
        raise "constructed run did not complete within 30 seconds"

      true ->
        Process.sleep(20)
        await_terminal!(run_id, deadline)
    end
  end

  defp asset!(base, %{"path" => path, "sha256" => expected}) do
    path = Path.expand(path, base)
    bytes = File.read!(path)
    actual = sha(bytes)
    if actual != expected, do: raise("sha256 mismatch: #{path}")
    %{path: path, bytes: bytes, sha256: actual}
  end

  defp sha_file!(path), do: path |> File.read!() |> sha()
  defp sha(bytes), do: :crypto.hash(:sha256, bytes) |> Base.encode16(case: :lower)
  defp read_json!(path), do: path |> File.read!() |> Jason.decode!()

  defp write_json!(output, name, value),
    do: File.write!(Path.join(output, name), Jason.encode!(value, pretty: true) <> "\n")

  defp restore_env(app, key, nil), do: Application.delete_env(app, key)
  defp restore_env(app, key, value), do: Application.put_env(app, key, value)
end

ModelContracts.RequestCostConstruct.main(System.argv())
