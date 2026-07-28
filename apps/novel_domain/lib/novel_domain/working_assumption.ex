defmodule NovelDomain.WorkingAssumption do
  @moduledoc """
  工作假定策略（VS-00G §2.3 / §3.4，用户可见名「暂定设定」）。

  零新实体：不定义 struct，纯函数操作携带 `status` / `provisional_source` /
  `provisional_active` 的既有对象（Character 等）。生命周期复用既有 AdoptionStatus
  状态机：tentative(provisional_active) → 作者确认=accepted 就地转正 ｜ 否决=discarded。

  三防护（契约硬性）：①注入文本【暂定】前缀+依据；②作者一键确认/否决；
  ③寿命追踪（provisional_active 超 N 章未决出负债催办，N=10，OQ3）。
  """

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelFoundation.Enums.ProvisionalSource

  # OQ3：假定寿命阈值（章），milestones §4.4 节拍推导，策略化可调。
  @default_lifespan_chapters 10

  # OQ7：注入标注（模型与作者双侧可见）。
  @marker "【暂定】"

  @spec marker() :: String.t()
  def marker, do: @marker

  @spec default_lifespan_chapters() :: pos_integer()
  def default_lifespan_chapters, do: @default_lifespan_chapters

  @doc "该对象是否是 AI 工作假定（tentative + AI 来源）。作者候选（source 为空）不算。"
  @spec assumption?(map()) :: boolean()
  def assumption?(object) when is_map(object) do
    field(object, :status) == AdoptionStatus.tentative() and
      field(object, :provisional_source) == ProvisionalSource.ai_assumption()
  end

  def assumption?(_object), do: false

  @doc "该假定是否处于激活注入态（写作/规划 prompt 应带【暂定】纳入）。"
  @spec active?(map()) :: boolean()
  def active?(object) when is_map(object) do
    assumption?(object) and field(object, :provisional_active) == true
  end

  def active?(_object), do: false

  @doc """
  OQ2 分级放行：required 事实的假定自动激活（+即时通知作者）；recommended 等作者放行。
  tier 取 CapabilityFactManifest 的 :required / :recommended。
  """
  @spec auto_activate?(atom()) :: boolean()
  def auto_activate?(:required), do: true
  def auto_activate?(_tier), do: false

  @doc """
  激活门禁：只有「tentative + AI 来源 + 不与既有 canon 冲突」的对象可置
  provisional_active（canon 优先，契约一致性硬性）。`canon_conflict?` 由调用方
  按对象类型判定（如同名 accepted 角色已存在）。
  """
  @spec can_activate?(map(), boolean()) :: boolean()
  def can_activate?(object, canon_conflict?) when is_map(object) do
    assumption?(object) and canon_conflict? == false
  end

  def can_activate?(_object, _canon_conflict?), do: false

  @doc """
  同批一致性机械校验（盘点产出时）：同名（去空白后精确相等）候选互相矛盾，
  返回冲突名列表；空列表=互不矛盾。语义类矛盾归模型判断，此处只做机械维。
  """
  @spec batch_name_conflicts([map()]) :: [String.t()]
  def batch_name_conflicts(candidates) when is_list(candidates) do
    candidates
    |> Enum.map(&(&1 |> field(:name) |> to_string() |> String.trim()))
    |> Enum.reject(&(&1 == ""))
    |> Enum.frequencies()
    |> Enum.filter(fn {_name, count} -> count > 1 end)
    |> Enum.map(fn {name, _count} -> name end)
  end

  @doc """
  寿命追踪（防护③）：激活至今已推进章数达到阈值仍未决 → 应出负债 finding 催办。
  """
  @spec expired?(non_neg_integer(), pos_integer()) :: boolean()
  def expired?(chapters_since_activation, threshold \\ @default_lifespan_chapters)
      when is_integer(chapters_since_activation) and is_integer(threshold) do
    chapters_since_activation >= threshold
  end

  @doc """
  注入标注文本（防护①）：【暂定】前缀 + 内容 + 依据。随注入产生、随 turn 消失，
  不落持久层（记忆类假定同形态，AU-09 红线内）。
  """
  @spec annotate(String.t(), String.t() | nil) :: String.t()
  def annotate(content, rationale \\ nil)

  def annotate(content, rationale) when is_binary(content) do
    base = "#{@marker}#{content}"

    case rationale do
      r when is_binary(r) and r != "" -> "#{base}（依据：#{r}）"
      _ -> base
    end
  end

  defp field(object, key) do
    Map.get(object, key) || Map.get(object, Atom.to_string(key))
  end
end
