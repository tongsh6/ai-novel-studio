defmodule V2Verification.Spike.StructuredOutput do
  @moduledoc """
  Spike runner for `verification/structured-output-library-choice.md`.

  Compares four structured-output paths against the local Ollama provider:

    * `:a` — `langchain` (ChatOpenAI pointed at the Ollama OpenAI-compat endpoint)
    * `:b` — `instructor` 0.1 (response_model = Ecto embedded schema, mode :json_schema)
    * `:c` — direct `Req` POST with `response_format: {type: "json_schema", ...}`
    * `:d` — `instructor_lite` 1.2 (ChatCompletionsCompatible adapter pointed at Ollama)

  All paths feed the same prompt and validate the result against the same
  resolved JSON Schema (`Schemas.CreateWorkSeed` / `JsonSchema.get/0`).
  """

  alias V2Verification.Spike.StructuredOutput.JsonSchema
  alias V2Verification.Spike.StructuredOutput.Schemas.CreateWorkSeed

  @model "devstral-small-2:24b"
  @ollama_base "http://localhost:11434"
  @system_prompt """
  你是中文网文资深策划。根据用户描述，输出一份初始设定 JSON。
  必须严格按照给定 JSON Schema：title、genre（必须从枚举中选）、core_hook（一句话）、initial_characters（数组，每项有 name 与 role）。
  不要输出 schema 外的字段，不要输出额外解释。
  """

  @inputs %{
    normal: """
    帮我创建一本玄幻小说的初始设定，主角是失去灵根的少年，但体内封着一把远古剑魂。
    """,
    free_form: """
    帮我创建一本玄幻小说的初始设定，主角是失去灵根的少年，但体内封着一把远古剑魂。
    请用你最有创意的方式自由发挥。
    """,
    lure_extra: """
    帮我创建一本玄幻小说的初始设定，主角是失去灵根的少年，但体内封着一把远古剑魂。
    同时再附上 5 章详细大纲、20 个配角小传，以及一段开篇正文。
    """
  }

  @default_iters %{normal: 20, free_form: 3, lure_extra: 3, provider_error: 1}

  def run(opts \\ []) do
    iters = Keyword.get(opts, :iters, @default_iters)
    paths = Keyword.get(opts, :paths, [:a, :b, :c, :d])

    started_at = System.monotonic_time(:millisecond)

    rows =
      for path <- paths,
          {input_kind, prompt} <- inputs_for_run(),
          n_iters = Map.fetch!(iters, input_kind),
          n_iters > 0,
          n <- 1..n_iters//1 do
        {result, latency_ms} =
          measure(fn ->
            case input_kind do
              :provider_error -> run_with_bad_endpoint(path)
              _ -> dispatch(path, prompt)
            end
          end)

        outcome = classify(result, input_kind)
        IO.puts("  [#{path}/#{input_kind}/#{n}] #{outcome} latency=#{latency_ms}ms")

        %{
          path: path,
          input: input_kind,
          iter: n,
          outcome: outcome,
          latency_ms: latency_ms,
          error_kind: error_kind(result)
        }
      end

    elapsed = System.monotonic_time(:millisecond) - started_at
    print_summary(rows, elapsed)
    rows
  end

  defp inputs_for_run do
    Enum.concat(
      Enum.map(@inputs, fn {k, v} -> {k, v} end),
      [{:provider_error, ""}]
    )
  end

  defp dispatch(:a, prompt), do: run_path_a(prompt)
  defp dispatch(:b, prompt), do: run_path_b(prompt)
  defp dispatch(:c, prompt), do: run_path_c(prompt)
  defp dispatch(:d, prompt), do: run_path_d(prompt)

  # -- Path A: langchain ChatOpenAI -----------------------------------------

  defp run_path_a(prompt) do
    alias LangChain.ChatModels.ChatOpenAI
    alias LangChain.Chains.LLMChain
    alias LangChain.Message

    with {:ok, model} <-
           ChatOpenAI.new(%{
             endpoint: "#{@ollama_base}/v1/chat/completions",
             api_key: "ollama",
             model: @model,
             json_response: true,
             json_schema: %{
               "name" => "create_work_seed",
               "schema" => JsonSchema.get(),
               "strict" => true
             }
           }),
         {:ok, %{last_message: msg}} <-
           %{llm: model}
           |> LLMChain.new!()
           |> LLMChain.add_messages([
             Message.new_system!(@system_prompt),
             Message.new_user!(prompt)
           ])
           |> LLMChain.run() do
      decode_and_validate(extract_text(msg.content))
    else
      {:error, %LangChain.LangChainError{} = err} ->
        {:error, normalize_langchain_error(err)}

      {:error, _chain, %LangChain.LangChainError{} = err} ->
        {:error, normalize_langchain_error(err)}

      {:error, other} ->
        {:error, {:unknown, inspect(other)}}
    end
  rescue
    e -> {:error, {:exception, Exception.message(e)}}
  end

  defp normalize_langchain_error(%{type: type, message: msg}) when not is_nil(type),
    do: {String.to_atom(to_string(type)), msg}

  defp normalize_langchain_error(%{message: msg}), do: {:provider_error, msg}

  # -- Path B: instructor ---------------------------------------------------

  defp run_path_b(prompt) do
    case Instructor.chat_completion(
           model: @model,
           response_model: CreateWorkSeed,
           mode: :json_schema,
           max_retries: 0,
           messages: [
             %{role: "system", content: @system_prompt},
             %{role: "user", content: prompt}
           ]
         ) do
      {:ok, %CreateWorkSeed{} = seed} ->
        payload = seed_to_map(seed)

        case JsonSchema.validate(payload) do
          :ok -> {:ok, payload}
          err -> err
        end

      {:error, %Ecto.Changeset{} = cs} ->
        {:error, {:schema_mismatch, inspect(cs.errors)}}

      {:error, reason} ->
        {:error, normalize_provider_error(reason)}
    end
  rescue
    e -> {:error, {:exception, Exception.message(e)}}
  end

  defp seed_to_map(%CreateWorkSeed{} = seed) do
    %{
      "title" => seed.title,
      "genre" => stringify(seed.genre),
      "core_hook" => seed.core_hook,
      "initial_characters" =>
        Enum.map(seed.initial_characters || [], fn c ->
          %{"name" => c.name, "role" => c.role}
        end)
    }
  end

  # Ecto.Enum casts the wire string back to its declared atom value. The wire-
  # protocol shape (and hence the JSON Schema validator) expects a string, so
  # we re-stringify before handing the payload back to ex_json_schema. nil is
  # left as-is so a missing field reports as a "required" violation, not as a
  # type mismatch.
  defp stringify(nil), do: nil
  defp stringify(value) when is_atom(value), do: Atom.to_string(value)
  defp stringify(value), do: value

  # -- Path D: instructor_lite 1.2 ------------------------------------------

  defp run_path_d(prompt) do
    run_path_d_with_url(prompt, "#{@ollama_base}/v1/chat/completions")
  end

  defp run_path_d_with_url(prompt, url) do
    params = %{
      model: @model,
      messages: [
        %{role: "system", content: @system_prompt},
        %{role: "user", content: prompt}
      ]
    }

    case InstructorLite.instruct(params,
           response_model: CreateWorkSeed,
           adapter: InstructorLite.Adapters.ChatCompletionsCompatible,
           adapter_context: [
             api_key: "ollama",
             url: url,
             http_options: [receive_timeout: 120_000, retry: false]
           ],
           max_retries: 0
         ) do
      {:ok, %CreateWorkSeed{} = seed} ->
        payload = seed_to_map(seed)

        case JsonSchema.validate(payload) do
          :ok -> {:ok, payload}
          err -> err
        end

      {:error, %Ecto.Changeset{} = cs} ->
        {:error, {:schema_mismatch, inspect(cs.errors)}}

      {:error, %Req.TransportError{} = exc} ->
        {:error, normalize_provider_error(exc)}

      {:error, %Req.Response{status: status, body: body}} ->
        {:error, {:provider_http, "status=#{status} body=#{inspect(body)}"}}

      {:error, reason} ->
        {:error, normalize_provider_error(reason)}

      {:error, kind, detail} ->
        {:error, {kind, inspect(detail)}}
    end
  rescue
    e -> {:error, {:exception, Exception.message(e)}}
  end

  # -- Path C: direct Req with json_schema response_format ------------------

  defp run_path_c(prompt) do
    body = %{
      model: @model,
      messages: [
        %{role: "system", content: @system_prompt},
        %{role: "user", content: prompt}
      ],
      response_format: %{
        type: "json_schema",
        json_schema: %{
          name: "create_work_seed",
          schema: JsonSchema.get(),
          strict: true
        }
      }
    }

    case Req.post(
           "#{@ollama_base}/v1/chat/completions",
           json: body,
           receive_timeout: 120_000,
           retry: false
         ) do
      {:ok, %Req.Response{status: 200, body: body}} ->
        body
        |> get_in(["choices", Access.at(0), "message", "content"])
        |> decode_and_validate()

      {:ok, %Req.Response{status: status, body: body}} ->
        {:error, {:provider_http, "status=#{status} body=#{inspect(body)}"}}

      {:error, exc} ->
        {:error, normalize_provider_error(exc)}
    end
  rescue
    e -> {:error, {:exception, Exception.message(e)}}
  end

  # -- Provider error scenario ---------------------------------------------

  defp run_with_bad_endpoint(path) do
    # Point at unused port to force a connection-level failure.
    base_orig = @ollama_base
    bad = "http://127.0.0.1:1"

    case path do
      :a ->
        run_path_a_with_endpoint(bad)

      :b ->
        Application.put_env(:instructor, :openai,
          api_url: bad,
          api_path: "/v1/chat/completions",
          api_key: "ollama",
          auth_mode: :bearer,
          http_options: [receive_timeout: 5_000]
        )

        try do
          run_path_b("ping")
        after
          Application.put_env(:instructor, :openai,
            api_url: base_orig,
            api_path: "/v1/chat/completions",
            api_key: "ollama",
            auth_mode: :bearer,
            http_options: [receive_timeout: 120_000]
          )
        end

      :c ->
        case Req.post(
               "#{bad}/v1/chat/completions",
               json: %{model: @model, messages: [%{role: "user", content: "ping"}]},
               receive_timeout: 5_000,
               retry: false
             ) do
          {:ok, _} -> {:error, {:unexpected_success, ""}}
          {:error, exc} -> {:error, normalize_provider_error(exc)}
        end

      :d ->
        run_path_d_with_url("ping", "#{bad}/v1/chat/completions")
    end
  end

  defp run_path_a_with_endpoint(endpoint) do
    alias LangChain.ChatModels.ChatOpenAI
    alias LangChain.Chains.LLMChain
    alias LangChain.Message

    with {:ok, model} <-
           ChatOpenAI.new(%{
             endpoint: "#{endpoint}/v1/chat/completions",
             api_key: "ollama",
             model: @model,
             receive_timeout: 5_000,
             json_response: true,
             json_schema: %{"name" => "x", "schema" => JsonSchema.get(), "strict" => true}
           }),
         {:ok, _} <-
           %{llm: model}
           |> LLMChain.new!()
           |> LLMChain.add_messages([Message.new_user!("ping")])
           |> LLMChain.run() do
      {:error, {:unexpected_success, ""}}
    else
      {:error, %LangChain.LangChainError{} = err} -> {:error, normalize_langchain_error(err)}
      {:error, _chain, %LangChain.LangChainError{} = err} -> {:error, normalize_langchain_error(err)}
      {:error, other} -> {:error, normalize_provider_error(other)}
    end
  rescue
    e -> {:error, {:exception, Exception.message(e)}}
  end

  # -- Helpers --------------------------------------------------------------

  defp extract_text(content) when is_binary(content), do: content

  defp extract_text(parts) when is_list(parts) do
    parts
    |> Enum.map(fn
      %LangChain.Message.ContentPart{type: :text, content: text} when is_binary(text) -> text
      %{content: text} when is_binary(text) -> text
      _ -> ""
    end)
    |> Enum.join("")
  end

  defp extract_text(_), do: ""

  defp decode_and_validate(content) when is_binary(content) and content != "" do
    cleaned = content |> strip_code_fence() |> String.trim()

    case Jason.decode(cleaned) do
      {:ok, payload} ->
        case JsonSchema.validate(payload) do
          :ok -> {:ok, payload}
          err -> err
        end

      {:error, decode_err} ->
        {:error, {:invalid_json, Exception.message(decode_err)}}
    end
  end

  defp decode_and_validate(other), do: {:error, {:no_content, inspect(other)}}

  defp strip_code_fence(content) do
    content
    |> String.replace(~r/^```(?:json)?\s*/i, "")
    |> String.replace(~r/```\s*$/i, "")
  end

  defp measure(fun) do
    started = System.monotonic_time(:millisecond)
    result = fun.()
    elapsed = System.monotonic_time(:millisecond) - started
    {result, elapsed}
  end

  defp classify({:ok, _}, :provider_error), do: :unexpected_success
  defp classify({:ok, _}, _), do: :ok
  defp classify({:error, {:schema_mismatch, _}}, _), do: :schema_mismatch
  defp classify({:error, {:invalid_json, _}}, _), do: :invalid_json
  defp classify({:error, {kind, _}}, :provider_error), do: kind
  defp classify({:error, {kind, _}}, _), do: kind
  defp classify({:error, _}, _), do: :unknown

  defp error_kind({:ok, _}), do: nil
  defp error_kind({:error, {kind, _}}), do: kind
  defp error_kind({:error, _}), do: :unknown

  defp normalize_provider_error(%Mint.TransportError{reason: reason}),
    do: {:transport_error, "Mint.TransportError #{inspect(reason)}"}

  defp normalize_provider_error(%{__exception__: true} = exc),
    do: {:transport_error, Exception.message(exc)}

  defp normalize_provider_error(other), do: {:provider_error, inspect(other)}

  defp print_summary(rows, total_elapsed_ms) do
    IO.puts("\n=== structured_output spike summary (#{total_elapsed_ms}ms total) ===")

    by_path_input =
      Enum.group_by(rows, &{&1.path, &1.input})

    Enum.each([:a, :b, :c, :d], fn path ->
      IO.puts("\nPath #{path}:")

      Enum.each([:normal, :free_form, :lure_extra, :provider_error], fn input ->
        bucket = Map.get(by_path_input, {path, input}, [])
        n = length(bucket)
        ok = Enum.count(bucket, &(&1.outcome == :ok))
        avg = if n > 0, do: Enum.sum(Enum.map(bucket, & &1.latency_ms)) |> div(n), else: 0

        outcomes =
          bucket
          |> Enum.map(& &1.outcome)
          |> Enum.frequencies()

        IO.puts("  [#{input}] n=#{n} ok=#{ok}/#{n} avg=#{avg}ms outcomes=#{inspect(outcomes)}")
      end)
    end)
  end
end
