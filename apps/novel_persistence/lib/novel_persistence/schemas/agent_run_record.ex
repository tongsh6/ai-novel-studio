defmodule NovelPersistence.Schemas.AgentRunRecord do
  @moduledoc """
  Persisted AgentRun state for bounded/durable run audit and recovery evidence.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :string, autogenerate: false}
  @foreign_key_type :string

  schema "agent_runs" do
    field(:workspace_id, :string)
    field(:work_id, :string)
    field(:session_id, :string)
    field(:parent_turn_ref, :string)
    field(:origin_frame_ref, :string)
    field(:run_mode, :string)
    field(:profile_ref, :string)
    field(:authoring_transcript, :map)
    field(:trigger, :map)
    field(:status, :string)
    field(:phase, :string)
    field(:goal, :map)
    field(:goal_version, :integer, default: 1)
    field(:plan, :map)
    field(:plan_ref, :string)
    field(:plan_version, :integer, default: 1)
    field(:run_policy, :map)
    field(:authority_scope, :map)
    field(:budget, :map)
    field(:consumed_budget, :map)
    field(:current_step_ref, :string)
    field(:completed_step_refs, {:array, :string}, default: [])
    field(:pending_artifact_refs, {:array, :string}, default: [])
    field(:active_behavior_ref, :string)
    field(:interrupt_state, :map)
    field(:long_run_task_ref, :string)
    field(:failure_ref, :string)
    field(:completed_at, :utc_datetime_usec)

    timestamps(type: :utc_datetime_usec)
  end

  @type t :: %__MODULE__{}

  @required_fields [
    :id,
    :workspace_id,
    :work_id,
    :session_id,
    :parent_turn_ref,
    :origin_frame_ref,
    :run_mode,
    :profile_ref,
    :status,
    :phase
  ]
  @optional_fields [
    :goal,
    :trigger,
    :goal_version,
    :plan,
    :plan_ref,
    :plan_version,
    :run_policy,
    :authority_scope,
    :budget,
    :consumed_budget,
    :current_step_ref,
    :completed_step_refs,
    :pending_artifact_refs,
    :active_behavior_ref,
    :interrupt_state,
    :authoring_transcript,
    :long_run_task_ref,
    :failure_ref,
    :completed_at
  ]

  @authoring_format_version "authoring-transcript/v1"

  # checkpoint run 字段 → agent_runs 不可变 row 字段。id 就是 run_id。
  @authoring_identity_fields [
    {"run_id", :id},
    {"workspace_id", :workspace_id},
    {"work_id", :work_id},
    {"session_id", :session_id},
    {"parent_turn_ref", :parent_turn_ref}
  ]

  def changeset(record, attrs) do
    record
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
    |> validate_inclusion(:run_mode, ["bounded", "durable"])
    |> validate_inclusion(:status, [
      "created",
      "running",
      "pausing",
      "cancelling",
      "paused",
      "awaiting_author",
      "completed",
      "cancelled",
      "failed"
    ])
    |> validate_inclusion(:phase, ["planning", "executing", "finalizing", "stopped"])
    |> reject_authoring_transcript_clear(record, attrs)
    |> validate_immutable_history_identity(record)
    |> validate_authoring_transcript()
  end

  # 私有 canonical 一旦存在，只能同值幂等或追加；显式 nil 不能清空历史。
  defp reject_authoring_transcript_clear(changeset, record, attrs) do
    if not is_nil(record.authoring_transcript) and explicitly_cleared?(attrs) do
      add_error(changeset, :authoring_transcript, "cannot clear existing private history")
    else
      changeset
    end
  end

  defp explicitly_cleared?(attrs) do
    (Map.has_key?(attrs, :authoring_transcript) and is_nil(Map.get(attrs, :authoring_transcript))) or
      (Map.has_key?(attrs, "authoring_transcript") and
         is_nil(Map.get(attrs, "authoring_transcript")))
  end

  # 已有历史时，row 身份不可随普通状态更新或新 checkpoint 一起重绑。
  defp validate_immutable_history_identity(changeset, record) do
    if is_nil(record.authoring_transcript) do
      changeset
    else
      Enum.reduce(@authoring_identity_fields, changeset, fn field, acc ->
        validate_immutable_field(acc, record, field)
      end)
    end
  end

  defp validate_immutable_field(changeset, record, {_checkpoint_field, row_field}) do
    if get_field(changeset, row_field) == Map.get(record, row_field) do
      changeset
    else
      add_error(
        changeset,
        row_field,
        "cannot change immutable run identity with existing private history"
      )
    end
  end

  defp validate_authoring_transcript(changeset) do
    case get_change(changeset, :authoring_transcript) do
      nil ->
        changeset

      new when is_map(new) ->
        validate_new_private_checkpoint(changeset, normalize(new))

      _other ->
        add_error(changeset, :authoring_transcript, "must be a map")
    end
  end

  defp validate_new_private_checkpoint(changeset, checkpoint) do
    with :ok <- validate_private_envelope(checkpoint),
         :ok <- validate_authoring_transcript_identity(changeset, checkpoint),
         :ok <-
           validate_authoring_transcript_prefix(changeset.data.authoring_transcript, checkpoint) do
      changeset
    else
      {:error, message} -> add_error(changeset, :authoring_transcript, message)
    end
  end

  # persistence 只校验自己拥有的存储壳：版本、必需层级与 messages 列表形状。
  defp validate_private_envelope(checkpoint) do
    transcript = value(checkpoint, "transcript")
    run = value(transcript, "run")
    messages = value(transcript, "messages")

    cond do
      value(checkpoint, "version") != @authoring_format_version ->
        {:error, "unsupported authoring transcript version"}

      not is_map(transcript) or not is_map(run) or not is_list(messages) ->
        {:error, "invalid authoring transcript shape"}

      Enum.any?(messages, &(not is_map(&1))) ->
        {:error, "invalid authoring transcript shape"}

      true ->
        :ok
    end
  end

  defp validate_authoring_transcript_identity(changeset, checkpoint) do
    run = checkpoint |> value("transcript") |> value("run")

    missing =
      Enum.filter(@authoring_identity_fields, fn {field, _row_field} ->
        blank?(value(run, field))
      end)

    mismatched =
      Enum.filter(@authoring_identity_fields, fn {field, row_field} ->
        value(run, field) != get_field(changeset, row_field)
      end)

    cond do
      missing != [] -> {:error, "run identity missing"}
      mismatched != [] -> {:error, "run identity mismatch"}
      true -> :ok
    end
  end

  defp validate_authoring_transcript_prefix(nil, _new), do: :ok

  defp validate_authoring_transcript_prefix(old, new) do
    old_messages = old |> normalize() |> value("transcript") |> value("messages")
    new_messages = new |> value("transcript") |> value("messages")

    valid? =
      is_list(old_messages) and is_list(new_messages) and
        length(new_messages) >= length(old_messages) and
        Enum.take(new_messages, length(old_messages)) == old_messages

    if valid? do
      :ok
    else
      {:error, "must preserve existing private history"}
    end
  end

  defp blank?(nil), do: true
  defp blank?(value) when is_binary(value), do: String.trim(value) == ""
  defp blank?(_value), do: false

  # 调用方先 normalize 一次；这里只读固定字符串键，不在递归中动态造 atom。
  defp value(map, key) when is_map(map), do: Map.get(map, key)
  defp value(_value, _key), do: nil

  defp normalize(value) when is_struct(value) do
    value
    |> Map.from_struct()
    |> normalize()
  end

  defp normalize(value) when is_map(value) do
    Map.new(value, fn {key, item} -> {normalize_key(key), normalize(item)} end)
  end

  defp normalize(value) when is_list(value), do: Enum.map(value, &normalize/1)
  defp normalize(value), do: value

  defp normalize_key(key) when is_binary(key), do: key
  defp normalize_key(key) when is_atom(key), do: Atom.to_string(key)
  defp normalize_key(key), do: key
end
