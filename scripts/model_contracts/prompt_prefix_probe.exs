defmodule ModelContracts.PromptPrefixProbe do
  @moduledoc """
  VS-00I 在线证据：生产判断协议 + Gateway + 原生 HTTP/SSE。
  首个生产单调用在任何复测之前执行。不注册替身、不写作品、不加载模型。
  配置覆盖仅在当前 BEAM 的 RuntimeConfig 内生效，认证头不进入证据。
  """
  alias NovelAgent.Provider.{Execution, Gateway, HTTP, InferenceParams, RuntimeConfig}
  alias NovelApplication.{DialoguePlanningService, ExplorationService, JudgmentProtocol}
  alias NovelDomain.DialogueContext

  @preference_fields ~w(model endpoint thinking reasoning_effort purpose_models)a
  @cache_fields [
    ["prompt_tokens_details", "cached_tokens"],
    ["prompt_cache_hit_tokens"],
    ["cached_tokens"],
    ["cache_read_input_tokens"]
  ]

  def main(argv) do
    label = System.get_env("PREFIX_PROBE_LABEL", "baseline")
    unless Regex.match?(~r/\A[a-zA-Z0-9_-]+\z/, label), do: raise("非法报告标签")
    dir = Path.join(["artifacts", "model-contracts", "prefix-live", label])
    File.mkdir_p!(dir)
    load_profile(System.get_env("PREFIX_PROBE_PROFILE_DIR"))
    options = Gateway.provider_options().providers

    reports =
      Enum.map(select_providers(List.first(argv) || "all", options), fn option ->
        report = run_provider(option, dir)
        write_report(dir, to_string(option.id), report)
        IO.puts("[prefix-single] #{option.id}: #{report.status}")
        report
      end)

    write_report(dir, "summary", %{generated_at: DateTime.utc_now(), providers: reports})
    if Enum.any?(reports, &(&1.status == "failed")), do: System.halt(1)
    if Enum.all?(reports, &(&1.status == "blocked")), do: System.halt(65)
  end

  def select_providers("all", options), do: Enum.reject(options, &(&1.id == :stub))

  def select_providers(names, options) do
    Enum.map(String.split(names, ",", trim: true), fn name ->
      Enum.find(options, &(to_string(&1.id) == name and &1.id != :stub)) ||
        raise("未知或非真实 Provider：#{name}")
    end)
  end

  def load_profile(nil), do: :ok

  def load_profile(dir) do
    stored =
      get_in(read_json(Path.join(dir, "preferences.json")), ["model_provider", "providers"]) ||
        %{}

    keys = Map.get(read_json(Path.join(dir, "provider-secrets.json")), "api_keys", %{})

    Enum.each(Gateway.registered_providers(), fn provider ->
      name = to_string(provider)
      fields = Map.get(stored, name, %{})

      config =
        Enum.reduce(@preference_fields, [], fn field, acc ->
          case Map.get(fields, to_string(field)) do
            nil -> acc
            value -> Keyword.put(acc, field, value)
          end
        end)

      config =
        if keys[name] in [nil, ""], do: config, else: Keyword.put(config, :api_key, keys[name])

      RuntimeConfig.put_provider_config(provider, config)
    end)
  end

  defp read_json(path) do
    case File.read(path) do
      {:ok, body} ->
        case Jason.decode(body) do
          {:ok, decoded} when is_map(decoded) -> decoded
          _ -> raise("profile JSON 格式不合法；不输出原文或凭据")
        end

      {:error, :enoent} ->
        %{}

      {:error, reason} ->
        raise("无法读取 profile：#{inspect(reason)}")
    end
  end

  defp run_provider(%{requires_api_key: true, api_key_configured: false} = option, _dir),
    do: blocked(option, "凭据缺失，未发起推理")

  defp run_provider(option, dir) do
    IO.puts("[prefix-single] #{option.id}: 只读检查模型列表")

    case Gateway.provider_models(%{provider: option.id}) do
      {:ok, %{models: models}} ->
        if model_available?(option, models) and channel_ready?(option),
          do: maybe_run_available(option, dir),
          else: blocked(option, "配置模型不可用或本地未加载；不自动加载或切换模型")

      {:error, _reason} ->
        blocked(option, "模型列表探测失败，未发起推理")
    end
  end

  defp model_available?(%{model: nil}, models), do: models != []
  defp model_available?(option, models), do: Enum.any?(models, &(&1.id == option.model))

  defp channel_ready?(%{id: :lmstudio} = option),
    do: ModelContracts.PrefixLMStudio.ready?(option)

  defp channel_ready?(_option), do: true

  defp maybe_run_available(option, dir) do
    if System.get_env("PREFIX_PROBE_MODE") == "inventory",
      do: %{provider: option.id, model: option.model, status: "ready", groups: []},
      else: run_available(option, dir)
  end

  defp blocked(option, reason),
    do: %{provider: option.id, model: option.model, status: "blocked", reason: reason, groups: []}

  defp run_available(option, dir) do
    {:ok, collector} = Agent.start_link(fn -> %{requests: [], facts: []} end)
    original = RuntimeConfig.provider_config(option.id)
    install_capture(option.id, collector, original)
    salt = Base.encode16(:crypto.strong_rand_bytes(6), case: :lower)
    input = judgment_input(salt)

    try do
      groups = [run_single("single_call", option.id, input, collector)]

      groups =
        if System.get_env("PREFIX_PROBE_MODE") == "single" do
          groups
        else
          groups ++
            [
              run_single(
                "next_input",
                option.id,
                %{input | author_text: "请给第02章再设计一个不同的结尾悬念。"},
                collector
              ),
              run_single(
                "changed_prefix",
                option.id,
                judgment_input(salt <> "-changed"),
                collector
              ),
              run_control(option.id, judgment_input(salt <> "-control"), collector)
            ]
        end

      write_report(dir, "#{option.id}-wire", Agent.get(collector, & &1))

      %{
        provider: option.id,
        model: option.model,
        generated_at: DateTime.utc_now(),
        status: if(Enum.all?(groups, & &1.protocol_ok), do: "measured", else: "failed"),
        cold_cache_guaranteed: false,
        note: "未清理用户缓存；同请求复测是独立样本；请求与纠错次数均单列。",
        groups: groups
      }
    after
      RuntimeConfig.put_provider_config(option.id, original)
      Agent.stop(collector)
    end
  end

  defp install_capture(provider, collector, original) do
    http = fn url, body, opts ->
      started = System.monotonic_time(:millisecond)
      result = HTTP.post(url, body, opts)
      record_wire(collector, url, body, result, nil, started)
      result
    end

    stream = fn url, body, opts, on_data ->
      {:ok, chunks} = Agent.start_link(fn -> [] end)
      started = System.monotonic_time(:millisecond)

      try do
        result =
          HTTP.post_event_stream(url, body, opts, fn chunk ->
            Agent.update(chunks, &[chunk | &1])
            on_data.(chunk)
          end)

        wire = Agent.get(chunks, &(Enum.reverse(&1) |> IO.iodata_to_binary()))
        record_wire(collector, url, body, result, wire, started)
        result
      after
        Agent.stop(chunks)
      end
    end

    RuntimeConfig.put_provider_config(
      provider,
      Keyword.merge(original, http_fn: http, eventsource_fn: stream)
    )
  end

  defp record_wire(collector, url, body, result, stream, started) do
    {status, response} =
      case result do
        {:ok, status, response} -> {status, response}
        {:ok, status} -> {status, nil}
        {:error, _kind, status, _message} -> {status, nil}
        _ -> {0, nil}
      end

    uri = URI.parse(url)

    row = %{
      started_at:
        DateTime.add(
          DateTime.utc_now(),
          started - System.monotonic_time(:millisecond),
          :millisecond
        ),
      endpoint: URI.to_string(%{uri | userinfo: nil, query: nil, fragment: nil}),
      request: body,
      http_status: status,
      response: response,
      stream: stream,
      wall_ms: System.monotonic_time(:millisecond) - started
    }

    Agent.update(collector, &Map.update!(&1, :requests, fn rows -> rows ++ [row] end))
  end

  defp execution(provider, collector) do
    Execution.dependency(
      provider: provider,
      event_sink: fn
        {_tag, %{provider_run: %{status: status} = run, output: output}}
        when status in [:completed, :failed, :cancelled] ->
          fact = %{
            provider_call_ref: run.provider_call_ref,
            purpose: run.purpose,
            model: run.model,
            status: status,
            usage: output.usage,
            metadata: run.metadata
          }

          Agent.update(
            collector,
            &Map.update!(&1, :facts, fn rows ->
              Enum.reject(rows, fn row -> row.provider_call_ref == fact.provider_call_ref end) ++
                [fact]
            end)
          )

        _ ->
          :ok
      end
    )
  end

  defp run_single(name, provider, input, collector) do
    IO.puts("[prefix-single] #{provider}: #{name} 生产单调用判断")
    before = Agent.get(collector, &length(&1.requests))
    result = JudgmentProtocol.request_judgment(execution(provider, collector), %{}, input)

    group =
      evaluate_single(name, Agent.get(collector, &Enum.drop(&1.requests, before)), result, input)

    IO.puts(
      "[prefix-single] #{provider}: #{name} protocol=#{group.protocol_ok} cache=#{group.cache_status}"
    )

    group
  end

  def evaluate_single(name, rows, result, _input \\ nil) do
    last = List.last(rows)

    {valid, count, action, narrative} =
      case result do
        {:ok, judgment} ->
          {true, judgment.provider_call_count, judgment.action, judgment.narrative}

        _ ->
          {false, 0, nil, nil}
      end

    choices_valid = rows != [] and Enum.all?(rows, &auto_choice?(get(&1.request, :tool_choice)))
    bound = is_binary(narrative) and last != nil and narrative in response_texts(last)
    tools_valid = last != nil and (action != "reply" or not response_has_tool_call?(last))

    %{
      name: name,
      protocol_ok:
        valid and count in 1..2 and count == length(rows) and choices_valid and bound and
          tools_valid,
      tool_choices_valid: choices_valid,
      narrative_bound: bound,
      judgment_parsed: valid,
      action: action,
      request_count: length(rows),
      first_attempt: count == 1,
      correction_count: max(count - 1, 0),
      cache_status: if(last, do: cache_status(native_usage(last)), else: "unobservable"),
      calls: Enum.map(rows, &summarize_call/1)
    }
  end

  defp auto_choice?("auto"), do: true
  defp auto_choice?(choice) when is_map(choice), do: get(choice, :type) == "auto"
  defp auto_choice?(_), do: false

  defp response_texts(row) do
    frames = frames(row)

    fragments =
      Enum.flat_map(frames, fn frame ->
        choice = List.first(frame["choices"] || []) || %{}

        Enum.map(get_in(choice, ["delta", "tool_calls"]) || [], fn call ->
          {call["index"] || 0, get_in(call, ["function", "arguments"]) || ""}
        end) ++
          if(is_binary(get_in(frame, ["delta", "partial_json"])),
            do: [{frame["index"] || 0, frame["delta"]["partial_json"]}],
            else: []
          )
      end)

    decoded =
      fragments
      |> Enum.group_by(&elem(&1, 0), &elem(&1, 1))
      |> Enum.flat_map(fn {_index, parts} -> strings(Enum.join(parts)) end)

    [response_content(row) | Enum.flat_map(frames, &strings/1)] ++ decoded
  end

  defp strings(value) when is_map(value), do: Enum.flat_map(Map.values(value), &strings/1)
  defp strings(value) when is_list(value), do: Enum.flat_map(value, &strings/1)

  defp strings(value) when is_binary(value) do
    case Jason.decode(value) do
      {:ok, decoded} when is_map(decoded) or is_list(decoded) -> [value | strings(decoded)]
      _ -> [value]
    end
  end

  defp strings(_), do: []

  defp run_control(provider, input, collector) do
    IO.puts("[prefix-single] #{provider}: identical_control（同请求控制样本）")
    before = Agent.get(collector, &length(&1.requests))
    prompt = JudgmentProtocol.prompt(input)

    results =
      for _ <- 1..2 do
        Gateway.execute(prompt, nil, InferenceParams.new(temperature: 0.4),
          provider: provider,
          purpose: :planner
        )
      end

    rows = Agent.get(collector, &Enum.drop(&1.requests, before))

    %{
      name: "identical_control",
      protocol_ok:
        Enum.all?(results, &match?({:ok, _}, &1)) and length(rows) == 2 and
          hd(rows).request == List.last(rows).request,
      cache_status:
        if(length(rows) == 2,
          do: cache_status(native_usage(List.last(rows))),
          else: "unobservable"
        ),
      calls: Enum.map(rows, &summarize_call/1)
    }
  end

  def summarize_call(row) do
    usage = native_usage(row)
    stream? = get(row.request, :stream) == true

    %{
      endpoint: row.endpoint,
      model: response_model(row) || get(row.request, :model),
      http_status: row.http_status,
      stream: stream?,
      wall_ms: row.wall_ms,
      server_timings: Enum.find_value(frames(row), & &1["timings"]),
      ttft_ms: nil,
      ttft_note: if(stream?, do: "原始 SSE 已留存；首字节不冒充首内容 token", else: "非流式，全程耗时不作 TTFT"),
      tool_choice: get(row.request, :tool_choice),
      tools_hash: digest(get(row.request, :tools) || []),
      messages_hash: digest(get(row.request, :messages) || []),
      native_usage: usage,
      cache_status: cache_status(usage),
      cache_evidence: Enum.filter(@cache_fields, &is_integer(get_in(usage, &1))),
      response_content_hash: digest(response_content(row))
    }
  end

  def cache_status(usage) do
    values = Enum.map(@cache_fields, &get_in(usage, &1)) |> Enum.filter(&is_integer/1)

    cond do
      Enum.any?(values, &(&1 > 0)) -> "hit"
      values != [] -> "miss"
      true -> "unobservable"
    end
  end

  def native_usage(row) do
    Enum.reduce(frames(row), %{}, fn frame, acc ->
      Map.merge(acc, frame["usage"] || get_in(frame, ["message", "usage"]) || %{})
    end)
  end

  defp frames(%{stream: stream}) when is_binary(stream) do
    stream
    |> String.split(~r/\r?\n/)
    |> Enum.flat_map(fn line ->
      case String.split(line, "data: ", parts: 2) do
        ["", json] ->
          case Jason.decode(json) do
            {:ok, frame} when is_map(frame) -> [frame]
            _ -> []
          end

        _ ->
          []
      end
    end)
  end

  defp frames(%{response: response}) when is_map(response),
    do: [response |> Jason.encode!() |> Jason.decode!()]

  defp frames(_row), do: []

  defp response_content(row) do
    Enum.map_join(frames(row), fn frame ->
      choice = List.first(frame["choices"] || []) || %{}

      get_in(choice, ["delta", "content"]) || get_in(choice, ["message", "content"]) ||
        get_in(frame, ["delta", "text"]) || ""
    end)
  end

  defp response_has_tool_call?(row) do
    Enum.any?(frames(row), fn frame ->
      choice = List.first(frame["choices"] || []) || %{}
      calls = get_in(choice, ["delta", "tool_calls"]) || get_in(choice, ["message", "tool_calls"])
      calls not in [nil, []] or get_in(frame, ["content_block", "type"]) == "tool_use"
    end)
  end

  defp response_model(row),
    do: Enum.find_value(frames(row), &(&1["model"] || get_in(&1, ["message", "model"])))

  def judgment_input(salt) do
    titles = Enum.map(1..12, &"第#{String.pad_leading(to_string(&1), 2, "0")}章：灵气账单线索#{&1}")

    context = %DialogueContext{
      workspace_id: "ws_prefix_live",
      current_work_snapshot: %{
        title: "前缀实测样书-#{salt}",
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

    text = "接着第02章往下写一段正文"

    %{
      author_text: text,
      context_block:
        DialoguePlanningService.judgment_context_block(context, text) <>
          "\n\n" <> ExplorationService.catalog_section(),
      options: [
        explore: true,
        capabilities:
          ~w(character_design character_evolution prose_writing plot_outline world_building work_archive_read),
        explore_tools: ExplorationService.tool_names()
      ]
    }
  end

  defp write_report(dir, name, report) do
    File.write!(Path.join(dir, "#{name}.json"), Jason.encode!(report, pretty: true))

    if Map.has_key?(report, :groups) or Map.has_key?(report, :providers) do
      providers = Map.get(report, :providers, [report])

      rows =
        Enum.flat_map(providers, fn provider ->
          if provider.groups == [] do
            [
              "| #{provider.provider} | — | #{provider.status} | — | — | #{Map.get(provider, :reason, "")} |"
            ]
          else
            Enum.map(provider.groups, fn group ->
              call = List.last(group.calls) || %{native_usage: %{}, model: "unavailable"}
              usage = call.native_usage
              cached = Enum.find_value(@cache_fields, fn path -> get_in(usage, path) end)

              "| #{provider.provider} | #{group.name} | #{group.protocol_ok} | #{group.cache_status} | #{inspect(cached)} | #{call.model} |"
            end)
          end
        end)

      header = [
        "# 真实 Provider 单调用缓存证据",
        "",
        "请求/纠错与同请求控制样本分开；未清理用户缓存；非流式总耗时不作 TTFT。",
        "",
        "| Provider | 样本 | 协议 / 状态 | 缓存 | 原生命中 tokens | 模型 / 原因 |",
        "|---|---|---|---|---:|---|"
      ]

      File.write!(Path.join(dir, "#{name}.md"), Enum.join(header ++ rows, "\n") <> "\n")
    end
  end

  defp get(map, key), do: Map.get(map, key, Map.get(map, to_string(key)))

  defp digest(value),
    do: :crypto.hash(:sha256, Jason.encode!(value)) |> Base.encode16(case: :lower)
end

defmodule ModelContracts.PrefixLMStudio do
  @moduledoc "探针的 LM Studio 通道：OpenAI 模型目录含未加载模型，必须另查 loaded_instances。"

  def ready?(option) do
    uri = URI.parse(option.endpoint)
    url = URI.to_string(%{uri | path: "/api/v1/models", query: nil, fragment: nil})

    case NovelAgent.Provider.HTTP.get(url, receive_timeout: 5_000, connect_timeout: 2_000) do
      {:ok, 200, %{"models" => models}} ->
        Enum.any?(models, fn model ->
          model["type"] == "llm" and model["key"] == option.model and
            model["loaded_instances"] not in [nil, []]
        end)

      _ ->
        false
    end
  end
end
