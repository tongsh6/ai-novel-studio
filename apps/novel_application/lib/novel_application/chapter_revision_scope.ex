defmodule NovelApplication.ChapterRevisionScope do
  @moduledoc """
  B28 §元原则整改 CP1：章级修订的**作者授权范围**判定（纯函数，不读 DB/不调模型）。

  范围表达“作者授权修改什么”，不是“给模型读多少材料”：
  - 读取/通读/检查/全文等词只说明材料覆盖，不单独授予整章修改；
  - 否定、局部限制、条件不得被词面命中扩大为整章授权；
  - `:whole_chapter` 仅用于明确、无条件、无局部限制的整章修改授权；
  - 其余保守为 `:target_segments`（目标解析不到由既有 target_segments 解析给出
    `:incomplete_scope`/`:target_missing`/`:target_ambiguous`，禁止回退整章）；
  - 明确“只读/不改”且无修改授权时返回 `{:error, :author_scope_not_authorized}`，
    由调用方零写入拒绝，不生成候选。

  不新增 schema/字段/阈值；writer 内容与 writer/adoption 数据完整性守卫仍由既有链路负责。
  """

  @type scope :: :format_only | :whole_chapter | :target_segments

  @format_only ~r/(只|仅).{0,10}(调整|调|改|做|整理).{0,10}(标点|分段|排版)|(标点|分段|排版).{0,10}(不改|不变|别改)|别改字句|字句.{0,6}(不变|别动)/u
  @format_only_negated ~r/(不是|并非|不要|别|无需).{0,8}(只|仅)?.{0,6}(标点|分段|排版)/u

  # 局部限制词：只改第N段/开头/结尾/最后一段/指定段；其余/其他段落别动/逐字保留。
  @local_limit ~r/(只|仅).{0,8}(改|修|调整|修改|处理|整理).{0,8}(第\s*([0-9]+|[一二三四五六七八九十]+)\s*段|开头|结尾|最后一段|指定段|这句|这处)|(其他|其它|其余|剩下|剩余).{0,10}(别|不要|不动|逐字|保持|不变)|除.{0,12}(外|之外).{0,12}(都|全).{0,8}(别|不要|不动)|其余(.{0,4})逐字/u

  @whole_range "(?:整章|全章|整篇|全文)"
  @modify_verb "(?:重写|改写|润色|修订|修改|整理|优化|调整|改)"
  @negated_whole_modify ~r/(不要|别|先别|先不要|无需|不用|勿)(要|用|再)?[^，,。；;]{0,6}(整章|全章|整篇|全文)[^，,。；;]{0,10}(重写|改写|润色|修订|修改|整理|优化|调整|改)|(不要|别|先别|先不要|无需|不用|勿)(要|用|再)?[^，,。；;]{0,6}(重写|改写|润色|修订|修改|整理|优化|调整|改)[^，,。；;]{0,10}(整章|全章|整篇|全文)/u

  # 读取/检查类语境：与“别改/不要改”同时出现时，说明作者只要结果不要写。
  @read_only ~r/(只读|读一遍|读一下|通读|检查|看一遍|核对|告诉我|回我|说明)/u
  # 修改否定：不要改/别改/先别动笔/无需修改…
  @deny_modify ~r/(不要|别|先别|先不要|无需|不用|勿|不)(要|用|再)?\s*(改|修改|重写|修订|润色|整理|动笔|动)/u
  # 条件句：条件未判定前不得把整章词当无条件授权。
  @conditional ~r/(如果|若|假如|要是|万一|一旦|如有).{0,30}(就|则|再|便|才)/u

  @doc """
  判定作者原话的修改授权范围。

  返回 `{:ok, scope}` 或 `{:error, :author_scope_not_authorized}`（明确只读/不改且无修改授权）。
  """
  @spec authorize(String.t() | nil) :: {:ok, scope()} | {:error, :author_scope_not_authorized}
  def authorize(text) when is_binary(text) do
    if String.trim(text) == "", do: {:ok, :target_segments}, else: decide(text)
  end

  def authorize(_text), do: {:ok, :target_segments}

  defp decide(text) do
    clauses = split_clauses(text)

    flags = %{
      format_only: Enum.any?(clauses, &Regex.match?(@format_only, &1)),
      format_negated: Enum.any?(clauses, &Regex.match?(@format_only_negated, &1)),
      local_limit: Enum.any?(clauses, &local_limit?/1),
      deny_modify: Enum.any?(clauses, &Regex.match?(@deny_modify, &1)),
      whole_modify: Enum.any?(clauses, &whole_modify?/1),
      read_only: Regex.match?(@read_only, text),
      conditional: Regex.match?(@conditional, text)
    }

    decision(flags)
  end

  defp decision(%{format_only: true, format_negated: false}), do: {:ok, :format_only}
  defp decision(%{local_limit: true}), do: {:ok, :target_segments}

  defp decision(%{deny_modify: true, read_only: true, whole_modify: false}),
    do: {:error, :author_scope_not_authorized}

  defp decision(%{deny_modify: true, whole_modify: false}), do: {:ok, :target_segments}
  defp decision(%{whole_modify: true, conditional: false}), do: {:ok, :whole_chapter}
  defp decision(_flags), do: {:ok, :target_segments}

  defp split_clauses(text) do
    text
    |> String.split(~r/[，,。；;！!？?\n]+/u, trim: true)
    |> Enum.map(&String.trim/1)
  end

  # 局部限制：只改第N段/开头/结尾…，或“其他段落别动/其余逐字不变”。
  defp local_limit?(clause) do
    Regex.match?(@local_limit, clause) and not format_only_only?(clause)
  end

  # “别改字句”属于仅排版限制，不是局部内容限制（format_only 优先，避免互相误判）。
  defp format_only_only?(clause), do: Regex.match?(@format_only, clause)

  # 整章修改授权：整章词与修改动词在同一子句内靠近，且同一子句没有否定整章修改。
  defp whole_modify?(clause) do
    Regex.match?(whole_modify_regex(), clause) and not Regex.match?(@negated_whole_modify, clause)
  end

  defp whole_modify_regex do
    range = @whole_range
    verb = @modify_verb
    ~r/#{range}[^，,。；;]{0,12}#{verb}|#{verb}[^，,。；;]{0,12}#{range}/u
  end
end
