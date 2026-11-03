defmodule NovelApplication.AgentRunEventQuery do
  @moduledoc """
  AgentRun 历史事件补拉的只读应用用例。

  按持久 run 记录校验 work/session 归属后，返回 `since_sequence` 之后的作者可见事件。
  允许 dead run（runtime 不在场）：本模块只读持久事实，不启动 runtime、不更新 run、
  不调用 Provider。Web 只负责 wire 解析与序列化，不直接接触持久层。

  `scope` 由已建立的 Socket 上下文提供，`since_sequence` 由 Web 按既有 wire 规则
  归一为非负整数；应用内信任这两个已解析输入，不重复校验。外部 `run_id` 仍在此
  校验，并按持久 run 记录做 work/session 归属判定。

  归属语义与既有 Channel 补拉一致：work 必须匹配；socket 未绑定 session 时允许读取
  该 work 下的 run，绑定 session 时 run 的 session 必须一致。缺失 run 与越界 run
  都 fail closed，不返回空历史冒充成功。
  """

  alias NovelPersistence.AgentRunLog

  defmodule Event do
    @moduledoc "作者可见 run 事件的语义 DTO；不携带持久 schema 类型。"

    @enforce_keys [:event_id, :run_id, :sequence, :event_type, :visibility, :summary]
    defstruct [
      :event_id,
      :run_id,
      :step_ref,
      :sequence,
      :event_type,
      :visibility,
      :summary,
      :inserted_at,
      reason_codes: [],
      refs: [],
      payload: %{}
    ]

    @type t :: %__MODULE__{
            event_id: String.t(),
            run_id: String.t(),
            step_ref: String.t() | nil,
            sequence: pos_integer(),
            event_type: String.t(),
            visibility: String.t(),
            summary: String.t(),
            reason_codes: [String.t()],
            refs: [String.t()],
            payload: map(),
            inserted_at: DateTime.t() | nil
          }
  end

  @type scope :: %{required(:work_id) => String.t(), required(:session_id) => String.t() | nil}

  @type error :: :invalid_run_id | :not_found | :run_scope_mismatch

  @doc """
  返回 run 在 `since_sequence` 之后的作者可见事件，按 sequence 升序。

  `scope` 与 `since_sequence` 是 Web 边界已归一的可信输入；本函数不重复校验。
  `run_id` 非法、run 不存在或越界时返回错误。
  """
  @spec since(scope(), String.t() | nil, non_neg_integer()) ::
          {:ok, [Event.t()]} | {:error, error()}
  def since(scope, run_id, since_sequence) do
    with {:ok, run_id} <- normalize_run_id(run_id),
         :ok <- ensure_owned(scope, run_id) do
      events =
        run_id
        |> AgentRunLog.list_author_events()
        |> Enum.filter(&(&1.sequence > since_sequence))
        |> Enum.map(&to_event/1)

      {:ok, events}
    end
  end

  defp normalize_run_id(run_id) when is_binary(run_id) and run_id != "", do: {:ok, run_id}
  defp normalize_run_id(_run_id), do: {:error, :invalid_run_id}

  defp ensure_owned(%{work_id: work_id, session_id: session_id}, run_id) do
    case AgentRunLog.get_run(run_id) do
      %{work_id: ^work_id, session_id: run_session_id} ->
        if is_nil(session_id) or run_session_id == session_id do
          :ok
        else
          {:error, :run_scope_mismatch}
        end

      %{work_id: _other_work_id} ->
        {:error, :run_scope_mismatch}

      nil ->
        {:error, :not_found}
    end
  end

  defp to_event(record) do
    %Event{
      event_id: record.id,
      run_id: record.run_id,
      step_ref: record.step_id,
      sequence: record.sequence,
      event_type: record.event_type,
      visibility: record.visibility,
      summary: record.summary,
      reason_codes: record.reason_codes,
      refs: record.refs,
      payload: record.payload,
      inserted_at: record.inserted_at
    }
  end
end
