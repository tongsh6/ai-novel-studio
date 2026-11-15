defmodule NovelCommon.RequestIR.Operation do
  @moduledoc """
  B71 专业阶段与独立文本操作的纯请求构造边界。

  首阶段建立规则 Base 与独立作者消息；后续阶段只追加完整角色规则和当前范围，
  不改写既有历史，不把应用目标冒充新作者消息。权限、预算、执行和业务结果仍由应用负责。
  source_refs 只声明 Scope 来源；base_refs 由实际材料 owner 显式提供，不由来源推定。
  """

  alias NovelCommon.RequestIR

  @identity_fields ~w(run_id work_id workspace_id session_id)a

  @type specification :: %{
          required(:role) => String.t(),
          required(:instructions) => String.t(),
          required(:scope) => map(),
          required(:tool) => map(),
          optional(:source_refs) => [map()],
          optional(:base_refs) => [map()],
          optional(:versions) => map(),
          optional(:author_text) => String.t() | nil,
          optional(:source_input_ref) => String.t() | nil,
          optional(:projection) => map(),
          optional(:system_versions) => map(),
          optional(:system_role) => String.t() | nil
        }

  @doc """
  非 AgentRun 的独立文本操作请求（章摘要、设定盘点、工具结果叙述等）。

  这些操作没有 AgentRun 的 run 事实：只携带真实操作 profile 与来源 refs，不伪造
  run_id/session_id，也不伪造作者消息。材料由应用作为 `application_base` 提供，
  显式 author_text/source_input_ref 必须成对提供，以独立 `author` provenance 保留原字节；
  作者来源不加入 Base/Observation，也不从 run、目标或工具来源推导。请求仍走同一 IR 投影边界
  （VS-00L §19.1），不再经 giant prompt 形态转译。
  """
  @spec text_operation(map()) :: RequestIR.t()
  def text_operation(attrs) when is_map(attrs) do
    text = Map.fetch!(attrs, :text)
    profile_ref = Map.fetch!(attrs, :profile_ref)
    refs = Map.get(attrs, :source_refs, [])

    author_messages =
      case RequestIR.author_input_messages(
             Map.get(attrs, :author_text),
             Map.get(attrs, :source_input_ref)
           ) do
        {:ok, messages} -> messages
        {:error, _reason} -> raise ArgumentError, "invalid text operation author input"
      end

    request =
      RequestIR.new(%{
        run: Map.get(attrs, :run) || %{profile_ref: profile_ref},
        system: RequestIR.system_envelope(Map.get(attrs, :system, [])),
        messages: [
          RequestIR.message(:application_base, :application, [RequestIR.text_block(text)], %{
            source_refs: refs
          })
          | author_messages
        ],
        tools: [],
        projection: %{},
        refs: %{base_refs: refs, observation_refs: [], used_refs: []}
      })

    case RequestIR.validate(request) do
      :ok ->
        request

      {:error, reason} ->
        raise ArgumentError, "invalid text operation request: #{inspect(reason)}"
    end
  end

  @spec prepare(RequestIR.t() | nil, map() | nil, specification()) ::
          {:ok, RequestIR.t()} | {:error, term()}
  def prepare(previous, run, %{role: role, instructions: rules, scope: scope, tool: tool} = spec)
      when is_binary(role) and is_binary(rules) and is_map(scope) and is_map(tool) do
    with :ok <- validate_spec(spec),
         {:ok, author_messages} <-
           RequestIR.author_input_messages(
             Map.get(spec, :author_text),
             Map.get(spec, :source_input_ref)
           ),
         {:ok, ir} <- initial_ir(previous, run, spec, author_messages) do
      ir = append_operation(ir, spec, not is_nil(previous))
      with :ok <- RequestIR.validate(ir), do: {:ok, ir}
    end
  end

  def prepare(_previous, _run, _spec), do: {:error, :invalid_authoring_operation}

  defp validate_spec(spec) do
    if valid_spec_texts?(spec) and valid_spec_optionals?(spec) do
      :ok
    else
      {:error, :invalid_authoring_operation}
    end
  end

  defp valid_spec_texts?(spec) do
    Enum.all?([spec.role, spec.instructions], &(String.trim(&1) != ""))
  end

  defp valid_spec_optionals?(spec) do
    system_role = Map.get(spec, :system_role)

    Enum.all?([:source_refs, :base_refs], &is_list(Map.get(spec, &1, []))) and
      Enum.all?([:versions, :projection, :system_versions], &is_map(Map.get(spec, &1, %{}))) and
      optional_text?(system_role)
  end

  defp optional_text?(value), do: is_nil(value) or is_binary(value)

  defp initial_ir(nil, run, spec, author_messages) do
    run = RequestIR.run_envelope(run)
    base_refs = Map.get(spec, :base_refs, [])
    versions = Map.get(spec, :system_versions, %{})

    # VS-00L §3.2/§19.1（2026-11-06 裁决 A）：角色规则与输出协议进入稳定 system 前缀；
    # application_base 只声明应用数据职责与来源边界。
    system =
      RequestIR.system_envelope(
        instructions: spec.instructions,
        run_role: Map.get(spec, :system_role) || spec.role,
        constitution_version: system_version(versions, :constitution_version),
        output_protocol_version: system_version(versions, :output_protocol_version),
        output_schema_ref: system_version(versions, :output_schema_ref)
      )

    base =
      RequestIR.message(
        :application_base,
        :application,
        [RequestIR.text_block(RequestIR.application_base_text())],
        %{source_refs: base_refs}
      )

    ir =
      RequestIR.new(%{
        run: run,
        system: system,
        messages: [base | author_messages],
        tools: [],
        projection: Map.merge(default_projection(), Map.get(spec, :projection, %{})),
        refs: %{base_refs: base_refs, observation_refs: [], used_refs: []}
      })

    with :ok <- RequestIR.validate(ir), do: {:ok, ir}
  end

  defp initial_ir(%RequestIR{} = previous, run, spec, _author_messages) do
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

  defp initial_ir(_previous, _run, _spec, _author_messages), do: {:error, :invalid_ir}

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

  defp append_operation(ir, spec, continued?) do
    refs = Map.get(spec, :source_refs, [])
    base_refs = Map.get(spec, :base_refs, [])

    versions =
      spec |> Map.get(:versions, %{}) |> Map.new(fn {key, value} -> {to_string(key), value} end)

    versions =
      Map.merge(versions, %{
        "scope_revision" => RequestIR.next_scope_revision(ir),
        "change_reason" => spec.role
      })

    ir = if continued?, do: RequestIR.append_application_notice(ir, spec.instructions), else: ir
    scope = RequestIR.json_value(spec.scope)

    scope =
      case Map.fetch(ir.run, :work_id) do
        {:ok, work_id} -> Map.put_new(scope, "work_id", work_id)
        :error -> scope
      end

    ir =
      ir
      |> RequestIR.add_tools([spec.tool])
      |> RequestIR.append_scope_update(scope, versions, refs)

    %{ir | refs: Map.update(ir.refs, :base_refs, base_refs, &Enum.uniq(&1 ++ base_refs))}
  end

  defp system_version(versions, key) when is_map(versions) do
    case Map.get(versions, key) || Map.get(versions, to_string(key)) do
      value when is_binary(value) and value != "" -> value
      _ -> nil
    end
  end

  # canonical projection 只承载调用政策；wire 目标与能力事实由实际 adapter/route 决定。
  defp default_projection do
    %{}
  end
end
