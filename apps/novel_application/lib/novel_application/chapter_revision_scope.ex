defmodule NovelApplication.ChapterRevisionScope do
  @moduledoc """
  章级修订的作者授权与目标绑定编排（纯函数，不读 DB/不调模型）。

  范围表达“作者授权修改什么”，不是“给模型读多少材料”：
  - 读取/通读/检查/全文等词只说明材料覆盖，不单独授予整章修改；
  - 否定、局部限制、条件不得被词面命中扩大为整章授权；
  - `:whole_chapter` 仅用于明确、无条件、无局部限制的整章修改授权；
  - 其余保守为 `:target_segments`（目标解析不到由既有 target_segments 解析给出
    `:incomplete_scope`/`:target_missing`/`:target_ambiguous`，禁止回退整章）；
  - 明确“只读/不改”且无修改授权时返回 `{:error, :author_scope_not_authorized}`，
    由调用方零写入拒绝，不生成候选。

  writer 与再次修订复用同一候选范围复核；纯区间应用由 LocalizedRevision 负责，事务边界再核验。

  B82 G2：成功 `chapter_read` 观察可派生页内既有 B36 段坐标；判断层只把模型提议绑定到
  本轮当前作者输入之后真实成功读取页，作者显式段号/字面目标优先。绑定失败走有界协议纠错，
  不回退整章，也不把内部段编号变成向作者追问的问题。

  章读页证据统一由 ChapterReadEvidence 核验；本模块先判作者授权，再消费本轮选段绑定。
  完整基线的已供应资格由 PendingArtifactWorkflow 独立消费，不改变修改授权。
  """

  @type scope :: :format_only | :whole_chapter | :target_segments

  alias NovelApplication.ChapterReadEvidence
  alias NovelCommon.RequestIR

  @format_only ~r/(只|仅).{0,10}(调整|调|改|做|整理).{0,10}(标点|分段|排版)|(标点|分段|排版).{0,10}(不改|不变|别改)|别改字句|字句.{0,6}(不变|别动)/u
  @format_only_negated ~r/(不是|并非|不要|别|无需).{0,8}(只|仅)?.{0,6}(标点|分段|排版)/u

  # 引用式目标：作者把“本轮读后发现的对象”指给修订，而不是直接给段号/字面。
  # 只认既有替换源 operand 内的发现/查找对象，不把泛读词或模型声明当授权。
  @replacement_verb ~r/改成|改为|替换为|替换成/u
  @quoted_replacement ~r/[「“"『](.+?)[」”"』]\s*(?:改成|改为|替换为|替换成)/su

  @discovery_source Regex.compile!(
                      "(?:发现|找出|找到|读到|看到|查到|检索出|检索到|核对出|核对到|注意到)" <>
                        "(?:到的|出的|来的|的|了|到|出|来|着)?[^，。；;]{0,16}" <>
                        "(?:写法|段落?|句子?|文字|内容|地方|部分|处|问题)",
                      "u"
                    )

  # 段号词法：授权判定（局部限制）与目标定位共用同一入口，避免两套表。
  @segment_ordinal_source "第\\s*([0-9]+|[一二三四五六七八九十]+)\\s*段"
  @segment_ordinal Regex.compile!(@segment_ordinal_source, "u")
  @explicit_target Regex.compile!("开头|结尾|" <> @segment_ordinal_source, "u")

  # 局部限制词：只改第N段/开头/结尾/最后一段/指定段；其余/其他段落别动/逐字保留。
  @local_limit Regex.compile!(
                 "(只|仅).{0,8}(改|修|调整|修改|处理|整理).{0,8}(" <>
                   @segment_ordinal_source <>
                   "|开头|结尾|最后一段|指定段|这句|这处)|(其他|其它|其余|剩下|剩余).{0,10}(别|不要|不动|逐字|保持|不变)|除.{0,12}(外|之外).{0,12}(都|全).{0,8}(别|不要|不动)|其余(.{0,4})逐字",
                 "u"
               )

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

  @doc "识别原 payload 的章级范围声明，只选择严格接收分支，不证明授权或补齐缺项。"
  @spec declares_revision_scope?(term()) :: boolean()
  def declares_revision_scope?(payload) when is_map(payload) do
    value(payload, :modification_scope) in ["target_segments", "whole_chapter"] or
      value(value(payload, :scope), :kind) in ["target_segments", "whole_chapter"] or
      value(value(payload, :adoption_effect), :mode) in ["replace_segments", "replace_scope"] or
      Enum.any?(List.wrap(value(payload, :items)), fn item ->
        is_map(item) and
          (Map.has_key?(item, :target_segment_ids) or Map.has_key?(item, "target_segment_ids"))
      end)
  end

  def declares_revision_scope?(_payload), do: false

  @doc "复核既有章级候选的授权及 accepted 基线；不重判作者意图，不扩大原范围。"
  def revalidate_payload(payload, facts) when is_map(payload) and is_map(facts) do
    scope = value(payload, :scope)
    effect = value(payload, :adoption_effect)
    kind = value(payload, :modification_scope)
    base = value(facts, :base_text)
    items = value(payload, :items)
    segments = if is_binary(base), do: NovelPersistence.LocalizedRevision.segment(base), else: []

    with true <- kind in ["target_segments", "whole_chapter"],
         true <- value(scope, :kind) == kind,
         true <-
           value(effect, :mode) ==
             if(kind == "target_segments", do: "replace_segments", else: "replace_scope"),
         true <- value(facts, :coverage) in [:complete, "complete"] and segments != [],
         true <- value(payload, :target_chapter_ref) == value(facts, :target_chapter_ref),
         true <- value(scope, :target_chapter_ref) == value(facts, :target_chapter_ref),
         false <- Map.has_key?(payload, :content) or Map.has_key?(payload, "content"),
         :ok <- revalidate_baseline(scope, effect, kind, facts, segments),
         {:ok, _text, _receipt} <-
           apply_candidate(kind, segments, value(scope, :target_segment_ids), items) do
      {:ok, payload}
    else
      {:error, _reason} = error -> error
      _ -> {:error, :incomplete_scope}
    end
  end

  def revalidate_payload(_payload, _facts), do: {:error, :incomplete_scope}

  defp revalidate_baseline(scope, effect, kind, facts, segments) do
    versions = version_pairs(value(facts, :expected_base_versions))
    covered = Enum.map(versions, fn {ref, version} -> "#{ref}:#{version}" end)
    ids = value(scope, :target_segment_ids)
    targets = Enum.filter(segments, &(&1.segment_id in List.wrap(ids)))
    hashes = Enum.map(targets, &{&1.segment_id, &1.sha256})
    first = List.first(value(facts, :materials) || []) || %{}

    common? = common_baseline_matches?(scope, effect, versions, covered, first, hashes)

    exact? =
      if kind == "target_segments" do
        target_baseline_matches?(scope, effect, versions, ids, hashes)
      else
        whole_baseline_matches?(effect, versions, ids, segments)
      end

    if common? and exact?, do: :ok, else: {:error, :stale_base_version}
  end

  defp common_baseline_matches?(scope, effect, versions, covered, first, hashes) do
    versions != [] and value(scope, :covered) == covered and
      value(scope, :covered_refs) == covered and value(effect, :covered) == covered and
      value(scope, :base_draft_ref) == value(first, :ref) and
      value(scope, :base_version) == value(first, :version) and
      hash_pairs(value(scope, :expected_segment_hashes)) == hashes
  end

  defp target_baseline_matches?(scope, effect, versions, ids, hashes) do
    version_pairs(value(scope, :base_versions)) == versions and
      version_pairs(value(effect, :base_versions)) == versions and
      value(effect, :target_segment_ids) == ids and
      value(effect, :base_draft_ref) == value(scope, :base_draft_ref) and
      value(effect, :base_version) == value(scope, :base_version) and
      hash_pairs(value(effect, :expected_segment_hashes)) == hashes
  end

  defp whole_baseline_matches?(effect, versions, ids, segments) do
    value(effect, :coverage) == "complete" and
      version_pairs(value(effect, :expected_base_versions)) == versions and
      ids == Enum.map(segments, & &1.segment_id)
  end

  defp apply_candidate("target_segments", segments, ids, items),
    do: NovelPersistence.LocalizedRevision.replace_segments(segments, ids, items)

  defp apply_candidate("whole_chapter", segments, _ids, items),
    do: NovelPersistence.LocalizedRevision.replace_scope(segments, items)

  defp version_pairs(items) when is_list(items),
    do: Enum.map(items, &{value(&1, :ref), value(&1, :version)})

  defp version_pairs(_items), do: []

  defp hash_pairs(items) when is_list(items),
    do: Enum.map(items, &{value(&1, :segment_id), value(&1, :sha256)})

  defp hash_pairs(_items), do: []

  defp value(map, key) when is_map(map), do: Map.get(map, key, Map.get(map, Atom.to_string(key)))
  defp value(_map, _key), do: nil

  @doc """
  按作者原话定位章级修订的目标段 id（纯函数，段由既有 B36 分段给出）。

  明确序号/开头/结尾/最后一段优先；精确字词替换只认唯一命中，重复或与明确序号
  不一致时拒绝。未知或越界的明确序号返回 `:target_missing`，绝不回退首段。
  """
  @spec target_segment_ids([map()], String.t()) ::
          {:ok, [String.t()]}
          | {:error, :target_missing | :target_ambiguous | :incomplete_scope}
  def target_segment_ids(segments, text) when is_binary(text) do
    ordinal =
      cond do
        Regex.match?(~r/开头|第一段/u, text) -> first_id(segments)
        Regex.match?(~r/最后一段|结尾/u, text) -> last_id(segments)
        true -> ordinal_target_ids(segments, text)
      end

    if ordinal == [] and Regex.match?(@explicit_target, text) do
      {:error, :target_missing}
    else
      reconcile_revision_target(ordinal, literal_revision_target(segments, text))
    end
  end

  def target_segment_ids(_segments, _text), do: {:error, :incomplete_scope}

  @doc "章级已采纳正文的规范 ref；判断/候选/绑定共用同一身份口径。"
  @spec chapter_ref?(term()) :: boolean()
  def chapter_ref?(ref) when is_binary(ref), do: String.starts_with?(ref, "chapter:")
  def chapter_ref?(_ref), do: false

  @doc """
  作者是否给出了显式目标（段号/开头/结尾/明确字面替换）。

  显式目标优先走既有 B28 定位；模型提议的段 id 不得覆盖作者写出的对象。
  """
  @spec explicit_target?(String.t() | nil) :: boolean()
  def explicit_target?(text) when is_binary(text) do
    Regex.match?(@explicit_target, text) or explicit_literal_target?(text)
  end

  def explicit_target?(_text), do: false

  @doc """
  作者是否把本轮读取后发现的对象指给修订（引用式目标）。

  例如“把发现的重复写法改成一段候选”“把你找出的重复段落替换为……”。
  显式段号/开头/结尾、引号字面或普通字面替换都不是引用式目标；仅在既有
  替换源 operand 内识别明确发现/查找对象，泛读词或模型声明不授权。
  """
  @spec reference_discovery_target?(String.t() | nil) :: boolean()
  def reference_discovery_target?(text) when is_binary(text) do
    Regex.match?(@replacement_verb, text) and
      not Regex.match?(@quoted_replacement, text) and
      Regex.match?(@discovery_source, revision_literal(text))
  end

  def reference_discovery_target?(_text), do: false

  @doc """
  decode 成功后、accepted 回执前，把模型提议的目标段绑定到本轮真实观察。

  `target_segment_ids` 只接受 execute + revise_adopted_content + 章级 ref；
  作者显式段号/字面目标优先，模型提议不覆盖。引用式目标必须按同一正文的
  chapter_read 页逐段证明完整覆盖；结果只含 target_segment_ids/source_hash/
  versions，writer 前再由 Pending 与当前章事实复核。
  """
  @spec bind_observed_targets(map(), RequestIR.t()) ::
          {:ok, map()} | {:error, {:target_segments, atom()}}
  def bind_observed_targets(
        %{
          action: "execute",
          capability: "revise_adopted_content",
          adopted_content_ref: "chapter:" <> _
        } = judgment,
        %RequestIR{} = request
      ) do
    ids = normalize_bound_ids(Map.get(judgment, :target_segment_ids))
    author_text = Map.get(judgment, :author_input) || ""

    cond do
      ids == :invalid ->
        {:error, {:target_segments, :invalid_selection}}

      # 作者显式段号/字面目标，以及整章/仅排版/只读等既有范围判定优先于模型选段。
      explicit_target?(author_text) or authorize(author_text) != {:ok, :target_segments} ->
        {:ok, clear_bound_targets(judgment)}

      reference_discovery_target?(author_text) or local_target_authorized?(author_text) ->
        bind_observed_selection(judgment, request, ids)

      ids == [] ->
        {:ok, clear_bound_targets(judgment)}

      true ->
        {:error, {:target_segments, :selection_not_authorized}}
    end
  end

  def bind_observed_targets(judgment, %RequestIR{}) when is_map(judgment) do
    if normalize_bound_ids(Map.get(judgment, :target_segment_ids)) == [],
      do: {:ok, judgment},
      else: {:error, {:target_segments, :not_allowed}}
  end

  defp explicit_literal_target?(text) do
    Regex.match?(@replacement_verb, text) and
      not reference_discovery_target?(text) and
      revision_literal(text) != ""
  end

  # 既有局部限制（如“只改有问题的部分，其余别动”）也是实际局部授权。
  defp local_target_authorized?(text),
    do: text |> split_clauses() |> Enum.any?(&local_limit?/1)

  defp normalize_bound_ids(ids) when is_list(ids) do
    if Enum.all?(ids, &(is_binary(&1) and String.trim(&1) != "")) and ids == Enum.uniq(ids),
      do: ids,
      else: :invalid
  end

  defp normalize_bound_ids(nil), do: []
  defp normalize_bound_ids(_ids), do: :invalid

  defp clear_bound_targets(judgment) do
    judgment
    |> Map.put(:target_segment_ids, [])
    |> Map.delete(:observed_targets)
  end

  defp bind_observed_selection(judgment, request, ids) do
    case ChapterReadEvidence.bind_target_segments(request, judgment.adopted_content_ref, ids) do
      {:ok, binding} ->
        {:ok,
         judgment
         |> Map.put(:target_segment_ids, ids)
         |> Map.put(:observed_targets, binding)}

      {:error, reason} ->
        {:error, {:target_segments, reason}}
    end
  end

  defp reconcile_revision_target(ordinal, literal_target) do
    case literal_target do
      :none when ordinal != [] -> {:ok, ordinal}
      :none -> {:error, :incomplete_scope}
      {:ok, ids} when ordinal == [] or ordinal == ids -> {:ok, ids}
      {:ok, _ids} -> {:error, :target_ambiguous}
      {:error, _} = error -> error
    end
  end

  # 精确字词替换只认一个明确源文本；不截取近似后缀、不在重复命中里猜第一处。
  defp literal_revision_target(segments, text) do
    case Regex.scan(~r/改成|改为|替换为|替换成/u, text) do
      [] -> :none
      [_] -> locate_revision_literal(segments, revision_literal(text))
      _ -> {:error, :target_ambiguous}
    end
  end

  defp revision_literal(text) do
    case Regex.run(~r/[「“"『](.+?)[」”"』]\s*(?:改成|改为|替换为|替换成)/su, text) do
      [_, literal] ->
        literal

      _ ->
        text
        |> String.split(~r/改成|改为|替换为|替换成/u, parts: 2)
        |> hd()
        |> String.split(~r/[，,；;。！？!?\n]/u)
        |> List.last()
        |> String.trim()
        |> String.replace(~r/^(?:(?:把|将)\s*)?.*?(?:正文|文本)(?:里|中)的?/u, "")
        |> String.replace(~r/^(?:把|将)\s*/u, "")
        |> String.trim()
    end
  end

  defp locate_revision_literal(_segments, ""), do: {:error, :target_missing}

  defp locate_revision_literal(segments, literal) do
    base = Enum.map_join(segments, & &1.raw)

    case :binary.match(base, literal) do
      :nomatch ->
        {:error, :target_missing}

      {offset, _length} ->
        remaining = {offset + 1, byte_size(base) - offset - 1}

        case :binary.match(base, literal, scope: remaining) do
          :nomatch -> unique_literal_segment(segments, literal)
          _ -> {:error, :target_ambiguous}
        end
    end
  end

  defp unique_literal_segment(segments, literal) do
    case Enum.filter(segments, &String.contains?(&1.raw, literal)) do
      [segment] -> {:ok, [segment.segment_id]}
      [] -> {:error, :target_missing}
      _ -> {:error, :target_ambiguous}
    end
  end

  defp first_id([%{segment_id: id} | _]), do: [id]
  defp first_id(_segments), do: []

  defp last_id(segments) do
    case List.last(segments) do
      nil -> []
      %{segment_id: id} -> [id]
    end
  end

  defp ordinal_target_ids(segments, text) do
    case Regex.run(@segment_ordinal, text) do
      [_, raw] ->
        case NovelFoundation.parse_ordinal(raw) do
          nil -> []
          number -> ordinal_id_at(segments, number - 1)
        end

      _ ->
        []
    end
  end

  defp ordinal_id_at(segments, index) when index >= 0 do
    case Enum.at(segments, index) do
      nil -> []
      segment -> [segment.segment_id]
    end
  end

  defp ordinal_id_at(_segments, _index), do: []

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
