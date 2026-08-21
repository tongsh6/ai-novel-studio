defmodule NovelDomain.ChapterMission do
  @moduledoc """
  本章使命（WR01，`ChapterMissionV1`）：写前推理步的输出值对象。

  - `statement`：一句话使命（模型原话）
  - `must_advance`：本章必须推进的条目，每条带 `basis_ref`（依据）
  - `must_avoid`：本章不得做的条目，每条带 `basis_ref`
  - `dropped`：依据不在携带材料 ref 集合内、被机械丢弃的条目（I-M1）

  设计态、随 run 消失（用户拍板本期不持久化）；进 `ProseExecutionBrief.chapter_context`
  与 trace ref，不进任何权威层（I-M2）。纯函数（domain 纪律）。
  """

  @type item :: %{
          required(String.t()) => String.t() | nil
        }

  @type t :: %__MODULE__{
          mission_id: String.t() | nil,
          statement: String.t() | nil,
          must_advance: [item()],
          must_avoid: [item()],
          dropped: [item()],
          confidence: float() | nil,
          provider_call_ref: String.t() | nil,
          degraded: boolean(),
          degraded_reason: String.t() | nil
        }

  defstruct mission_id: nil,
            statement: nil,
            must_advance: [],
            must_avoid: [],
            dropped: [],
            confidence: nil,
            provider_call_ref: nil,
            degraded: false,
            degraded_reason: nil

  @max_items 6

  @doc "从模型结构化输出（tool-call arguments）归一化；不做依据校验，见 `bind/2`。"
  @spec new(map()) :: t()
  def new(attrs) when is_map(attrs) do
    %__MODULE__{
      mission_id: clean(get(attrs, :mission_id)),
      statement: clean(get(attrs, :statement)),
      must_advance: attrs |> get(:must_advance) |> normalize_items(),
      must_avoid: attrs |> get(:must_avoid) |> normalize_items(),
      confidence: normalize_confidence(get(attrs, :confidence)),
      provider_call_ref: clean(get(attrs, :provider_call_ref))
    }
  end

  @doc "降级占位：推理失败/缺席时仍让下游拿到「有标记的缺席」而非真空。"
  @spec degraded(String.t(), String.t() | nil) :: t()
  def degraded(reason, mission_id \\ nil) when is_binary(reason) do
    %__MODULE__{mission_id: mission_id, degraded: true, degraded_reason: reason}
  end

  @doc """
  依据绑定（I-M1）：只保留 `basis_ref` 在 `known_refs` 内的条目，其余进 `dropped`。
  `label_fun` 用于回填 `basis_label`（材料文本），让 writer prompt 不必反查 ref。
  过滤后两列表都为空且无 statement → 标记 degraded（`mission_unbound`）。
  """
  @spec bind(t(), Enumerable.t(), (String.t() -> String.t() | nil)) :: t()
  def bind(%__MODULE__{} = mission, known_refs, label_fun \\ fn _ -> nil end) do
    known = MapSet.new(known_refs)

    {advance, dropped_a} = split_bound(mission.must_advance, known, label_fun)
    {avoid, dropped_b} = split_bound(mission.must_avoid, known, label_fun)

    mission = %{
      mission
      | must_advance: Enum.take(advance, @max_items),
        must_avoid: Enum.take(avoid, @max_items),
        dropped: dropped_a ++ dropped_b
    }

    if advance == [] and avoid == [] and is_nil(mission.statement) do
      %{mission | degraded: true, degraded_reason: "mission_unbound"}
    else
      mission
    end
  end

  @doc "是否有可用内容（非降级且至少一句使命或一条条目）。"
  @spec present?(t() | map() | nil) :: boolean()
  def present?(%__MODULE__{degraded: true}), do: false

  def present?(%__MODULE__{} = mission),
    do: not is_nil(mission.statement) or mission.must_advance != [] or mission.must_avoid != []

  def present?(%{} = map), do: map |> from_map() |> present?()
  def present?(_), do: false

  @doc "稳定引用 `mission:<id>`。"
  @spec ref(t() | map() | nil) :: String.t() | nil
  def ref(%__MODULE__{mission_id: id}) when is_binary(id) and id != "", do: "mission:#{id}"
  def ref(%{} = map), do: map |> from_map() |> ref()
  def ref(_), do: nil

  @doc "全部被引用的依据 ref（去重、保序）。"
  @spec basis_refs(t()) :: [String.t()]
  def basis_refs(%__MODULE__{} = mission) do
    (mission.must_advance ++ mission.must_avoid)
    |> Enum.map(& &1["basis_ref"])
    |> Enum.reject(&is_nil/1)
    |> Enum.uniq()
  end

  @doc "序列化为 string-keyed plain map（stage_state / packet / brief 传输用）。"
  @spec to_map(t() | nil) :: map() | nil
  def to_map(nil), do: nil

  def to_map(%__MODULE__{} = mission) do
    %{
      "mission_id" => mission.mission_id,
      "statement" => mission.statement,
      "must_advance" => mission.must_advance,
      "must_avoid" => mission.must_avoid,
      "dropped" => mission.dropped,
      "confidence" => mission.confidence,
      "provider_call_ref" => mission.provider_call_ref,
      "degraded" => mission.degraded,
      "degraded_reason" => mission.degraded_reason
    }
  end

  @spec from_map(map() | t() | nil) :: t() | nil
  def from_map(nil), do: nil
  def from_map(%__MODULE__{} = mission), do: mission

  def from_map(%{} = map) do
    %__MODULE__{
      mission_id: clean(get(map, :mission_id)),
      statement: clean(get(map, :statement)),
      must_advance: map |> get(:must_advance) |> normalize_items(),
      must_avoid: map |> get(:must_avoid) |> normalize_items(),
      dropped: map |> get(:dropped) |> normalize_items(),
      confidence: normalize_confidence(get(map, :confidence)),
      provider_call_ref: clean(get(map, :provider_call_ref)),
      degraded: get(map, :degraded) == true,
      degraded_reason: clean(get(map, :degraded_reason))
    }
  end

  @doc """
  渲染进 writer prompt 的行（随执行简报进入 provider message，VS-00E §5 结构化段落）。
  降级/空使命返回 []。不输出 ref 内部 id，只输出依据的材料文本。
  """
  @spec to_prompt_lines(t() | map() | nil) :: [String.t()]
  def to_prompt_lines(%__MODULE__{degraded: true}), do: []

  def to_prompt_lines(%__MODULE__{} = mission) do
    statement = if mission.statement, do: ["本章使命：#{mission.statement}"], else: []

    advance =
      Enum.map(mission.must_advance, fn item ->
        "· 必须推进：#{item["text"]}#{basis_suffix(item)}"
      end)

    avoid =
      Enum.map(mission.must_avoid, fn item ->
        "· 不得：#{item["text"]}#{basis_suffix(item)}"
      end)

    statement ++ advance ++ avoid
  end

  def to_prompt_lines(%{} = map), do: map |> from_map() |> to_prompt_lines()
  def to_prompt_lines(_), do: []

  # ── helpers ─────────────────────────────────────────

  defp split_bound(items, known, label_fun) do
    Enum.reduce(items, {[], []}, fn item, {kept, dropped} ->
      case bind_item(item, known, label_fun) do
        {:ok, bound} -> {kept ++ [bound], dropped}
        :unbound -> {kept, dropped ++ [item]}
      end
    end)
  end

  defp bind_item(%{"basis_ref" => ref} = item, known, label_fun) when is_binary(ref) do
    if MapSet.member?(known, ref) do
      {:ok, put_basis_label(item, item["basis_label"] || label_fun.(ref))}
    else
      :unbound
    end
  end

  defp bind_item(_item, _known, _label_fun), do: :unbound

  defp put_basis_label(item, nil), do: item
  defp put_basis_label(item, label), do: Map.put(item, "basis_label", label)

  defp basis_suffix(%{"basis_label" => label}) when is_binary(label) and label != "",
    do: "（依据：#{short(label)}）"

  defp basis_suffix(_item), do: ""

  defp short(text) when byte_size(text) > 80, do: String.slice(text, 0, 80) <> "…"
  defp short(text), do: text

  defp normalize_items(items) when is_list(items) do
    items
    |> Enum.map(&normalize_item/1)
    |> Enum.reject(&is_nil/1)
  end

  defp normalize_items(_), do: []

  defp normalize_item(%{} = item) do
    text = clean(get(item, :text))

    if text do
      %{
        "text" => text,
        "basis_ref" => clean(get(item, :basis_ref)),
        "basis_label" => clean(get(item, :basis_label))
      }
      |> Enum.reject(fn {_k, v} -> is_nil(v) end)
      |> Map.new()
    end
  end

  defp normalize_item(text) when is_binary(text) do
    case clean(text) do
      nil -> nil
      value -> %{"text" => value}
    end
  end

  defp normalize_item(_), do: nil

  defp normalize_confidence(value) when is_float(value) and value >= 0.0 and value <= 1.0,
    do: value

  defp normalize_confidence(value) when is_integer(value) and value in 0..1, do: value * 1.0
  defp normalize_confidence(_), do: nil

  defp get(map, key) when is_map(map), do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp clean(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp clean(_), do: nil
end
