defmodule NovelApplication.AuthoringTaskBuilder do
  @moduledoc """
  B27 CP3：把已验证的业务事实机械组装为 `AuthoringTask`。

  边界（B27 §3.1 / CP3 设计冻结）：
  - 本模块只做**事实组装**与机械校验，不写规则文本、不推断作者意图、不虚构对象/范围/版本。
  - 域模块（prose/aux）各自从真实端口取事实，调用本模块的 helper 构造 task；
    task 必须通过 `AuthoringSemantics.validate/1` 才可进入 provider 请求。
  - 放入 `ToolRequest.input` 时用 `to_input/1`（JSON-safe map），出站时 `from_input/1` 恢复并校验。
  """

  alias NovelCommon.AuthoringSemantics
  alias NovelCommon.Contracts.AuthoringTask

  @doc """
  构造并校验 task；失败返回 `{:error, {code, detail}}`，调用方不得降级猜意图。

  attrs 覆盖 AuthoringTask 字段（author_goal/author_words/source/scope/materials/
  preserve/operation_effect/prior_result/output_contract/source_refs）。
  """
  def new(kind, attrs \\ %{}) when is_atom(kind) and is_map(attrs) do
    task =
      struct!(
        %AuthoringTask{
          kind: kind,
          operation_effect: default_effect(kind),
          output_contract: output_contract(:json),
          semantic_version: AuthoringSemantics.version()
        },
        attrs
      )

    AuthoringSemantics.validate(task)
  end

  @doc "任务类型默认操作效果（首项白名单）；显式传入 operation_effect 时以 attrs 为准。"
  def default_effect(kind), do: kind |> AuthoringSemantics.allowed_effects() |> hd()

  @doc "材料条目：kind/ref 必填；version/complete?/omission_note 只在有真实来源时传入。"
  def material(kind, ref, opts \\ []) do
    %{kind: kind, ref: ref}
    |> put_opt(:version, opts[:version])
    |> put_opt(:complete?, opts[:complete?])
    |> put_opt(:omission_note, opts[:omission_note])
  end

  @doc "范围：refs + coverage；base_ref/base_hash/target_chapter_ref 只传真实来源。"
  def scope(refs, opts \\ []) do
    %{refs: List.wrap(refs), coverage: Keyword.get(opts, :coverage, :single)}
    |> put_opt(:object_kind, opts[:object_kind])
    |> put_opt(:base_ref, opts[:base_ref])
    |> put_opt(:base_hash, opts[:base_hash])
    |> put_opt(:target_chapter_ref, opts[:target_chapter_ref])
    |> Enum.reject(fn {_k, value} -> is_nil(value) end)
    |> Map.new()
  end

  @doc "输出契约：kind（json/text/tool）+ 角色 schema 必要字段；与运行时校验同源。"
  def output_contract(kind, opts \\ []) do
    %{
      kind: kind,
      required_keys: List.wrap(Keyword.get(opts, :required_keys, [])),
      allow_companions: Keyword.get(opts, :allow_companions, false)
    }
    |> put_opt(:schema_ref, opts[:schema_ref])
    |> put_opt(:artifact_type, opts[:artifact_type])
  end

  @doc "上一轮真实结果摘要（仅已发生事实）。"
  def prior_result(attrs) when is_map(attrs) do
    %{}
    |> put_opt(:run_ref, attrs[:run_ref] || attrs["run_ref"])
    |> put_opt(:turn_ref, attrs[:turn_ref] || attrs["turn_ref"])
    |> put_opt(:status, attrs[:status] || attrs["status"])
    |> put_opt(:summary, attrs[:summary] || attrs["summary"])
    |> put_opt(:pending_refs, attrs[:pending_refs] || attrs["pending_refs"])
  end

  @doc "把 task 放进 ToolRequest.input（JSON-safe），供 CreativeToolAdapter 出站恢复。"
  def to_input(task) when is_struct(task, AuthoringTask) do
    %{"authoring_task" => AuthoringTask.to_map(task)}
  end

  @doc "从 ToolRequest.input 恢复并校验；无字段返回 `{:ok, nil}`（迁移期兼容）。"
  def from_input(input) when is_map(input) do
    case input["authoring_task"] || input[:authoring_task] do
      nil ->
        {:ok, nil}

      map when is_map(map) ->
        case AuthoringTask.from_map(map) do
          nil -> {:error, {:authoring_task_invalid, :not_a_task}}
          task -> AuthoringSemantics.validate(task)
        end

      _other ->
        {:error, {:authoring_task_invalid, :not_a_task}}
    end
  end

  def from_input(_input), do: {:ok, nil}

  defp put_opt(map, _key, nil), do: map
  defp put_opt(map, key, value), do: Map.put(map, key, value)
end
