defmodule NovelAgent.Provider.RequestIR.Operation do
  @moduledoc """
  B71 专业阶段的纯请求构造边界。

  首阶段建立规则 Base 与独立作者消息；后续阶段只追加完整角色规则和当前范围，
  不改写既有历史，不把应用目标冒充新作者消息。权限、预算、执行和业务结果仍由应用负责。
  """

  alias NovelAgent.Provider.RequestIR

  @identity_fields ~w(run_id work_id workspace_id session_id)a

  @type specification :: %{
          required(:role) => String.t(),
          required(:instructions) => String.t(),
          required(:scope) => String.t(),
          required(:tool) => map(),
          optional(:source_refs) => [map()],
          optional(:versions) => map(),
          optional(:author_text) => String.t() | nil,
          optional(:projection) => map()
        }

  @spec prepare(RequestIR.t() | nil, map() | nil, specification()) ::
          {:ok, RequestIR.t()} | {:error, term()}
  def prepare(previous, run, %{role: role, instructions: rules, scope: scope, tool: tool} = spec)
      when is_binary(role) and is_binary(rules) and is_binary(scope) and is_map(tool) do
    with :ok <- validate_spec(spec),
         {:ok, ir} <- initial_ir(previous, run, spec) do
      ir = append_operation(ir, spec, not is_nil(previous))
      with :ok <- RequestIR.validate(ir), do: {:ok, ir}
    end
  end

  def prepare(_previous, _run, _spec), do: {:error, :invalid_authoring_operation}

  defp validate_spec(spec) do
    text_valid? = Enum.all?([spec.role, spec.instructions, spec.scope], &(String.trim(&1) != ""))
    author = Map.get(spec, :author_text)

    if text_valid? and is_list(Map.get(spec, :source_refs, [])) and
         is_map(Map.get(spec, :versions, %{})) and is_map(Map.get(spec, :projection, %{})) and
         (is_nil(author) or is_binary(author)),
       do: :ok,
       else: {:error, :invalid_authoring_operation}
  end

  defp initial_ir(nil, run, spec) do
    run = RequestIR.run_envelope(run)
    refs = Map.get(spec, :source_refs, [])

    base =
      RequestIR.message(
        :application_base,
        :application,
        [RequestIR.text_block(spec.instructions)],
        %{source_refs: refs}
      )

    ir =
      RequestIR.new(%{
        run: run,
        system: %{identity_ref: "identity:authoring/v1"},
        messages: [base | author_messages(Map.get(spec, :author_text), run)],
        tools: [],
        projection: Map.merge(default_projection(), Map.get(spec, :projection, %{})),
        refs: %{base_refs: refs, observation_refs: [], used_refs: []}
      })

    with :ok <- RequestIR.validate(ir), do: {:ok, ir}
  end

  defp initial_ir(%RequestIR{} = previous, run, spec) do
    with :ok <- RequestIR.validate(previous),
         {:ok, envelope} <- continued_run(previous.run, run) do
      {:ok,
       %{
         previous
         | run: envelope,
           projection: Map.merge(previous.projection, Map.get(spec, :projection, %{}))
       }}
    end
  end

  defp initial_ir(_previous, _run, _spec), do: {:error, :invalid_ir}

  defp continued_run(previous, nil), do: {:ok, previous}

  defp continued_run(previous, run) do
    envelope =
      run |> RequestIR.run_envelope() |> Map.reject(fn {_key, value} -> is_nil(value) end)

    cond do
      envelope == %{} ->
        {:error, :missing_run_envelope}

      Enum.any?(@identity_fields, &identity_changed?(previous, envelope, &1)) ->
        {:error, :authoring_run_mismatch}

      true ->
        {:ok, Map.merge(previous, envelope)}
    end
  end

  defp identity_changed?(previous, current, key) do
    old = Map.get(previous, key)
    new = Map.get(current, key)
    not is_nil(old) and not is_nil(new) and old != new
  end

  defp author_messages(text, _run) when text in [nil, ""], do: []

  defp author_messages(text, run) do
    refs =
      case Map.get(run, :parent_turn_ref) do
        ref when is_binary(ref) and ref != "" -> [%{ref: ref}]
        _ -> []
      end

    [RequestIR.message(:user, :author, [RequestIR.text_block(text)], %{source_refs: refs})]
  end

  defp append_operation(ir, spec, continued?) do
    refs = Map.get(spec, :source_refs, [])

    versions =
      spec |> Map.get(:versions, %{}) |> Map.new(fn {key, value} -> {to_string(key), value} end)

    versions =
      Map.merge(versions, %{
        "scope_revision" => RequestIR.next_scope_revision(ir),
        "change_reason" => spec.role
      })

    scope = if continued?, do: spec.instructions <> "\n\n" <> spec.scope, else: spec.scope

    ir =
      ir
      |> RequestIR.add_tools([spec.tool])
      |> RequestIR.append_scope_update(scope, versions, refs)

    %{ir | refs: Map.update(ir.refs, :base_refs, refs, &Enum.uniq(&1 ++ refs))}
  end

  # 只声明 wire 目标；能力事实由传输边界按实际 route 派生（VS-00L §6.4）。
  # 这里不得写死必备能力，否则缺能力的 provider 会被伪装成完整 AgentRun provider。
  defp default_projection do
    %{target: "chat_completions"}
  end
end
