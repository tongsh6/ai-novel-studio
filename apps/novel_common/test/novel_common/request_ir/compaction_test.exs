defmodule NovelCommon.RequestIR.CompactionTest do
  use ExUnit.Case, async: true

  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Compaction
  alias NovelCommon.RequestIR.DiscussionSummary
  alias NovelCommon.RequestIR.MessageCoverage
  alias NovelCommon.RequestIR.Projection

  @author "  先保留两种方案。\r\n等我确定视角再比较代价。  "
  @promise "等你确定视角后，我还会把第二方案与第三方案的代价逐项比较。"
  @old_text "这段早期长答的逐字论证不再常驻请求。\n" <> @promise
  @targets ~w(chat_completions anthropic_messages responses_api)

  test "v2 完整行材料保留混合换行与末行；片段选择不能拼造跨行引文" do
    source = %{
      source_index: 0,
      source: %{run_id: "old", run_sequence: 4},
      text: "甲\r\n乙\r丙\n丁",
      author_text: "作者"
    }

    assert {:ok, material} = Compaction.discussion_material([source])
    [input] = Jason.decode!(material)["sources"]
    refute Map.has_key?(input, "text")

    assert input["fragments"] == [
             %{"fragment_index" => 0, "text" => "甲\r\n"},
             %{"fragment_index" => 1, "text" => "乙\r"},
             %{"fragment_index" => 2, "text" => "丙\n"},
             %{"fragment_index" => 3, "text" => "丁"}
           ]

    make = fn indices ->
      text =
        Jason.encode!(%{
          version: "authoring-discussion-summary/v2",
          entries: [%{source_index: 0, summary: "待回答", retained_fragment_indices: indices}]
        })

      %{
        response_text: text,
        response_sha256: :crypto.hash(:sha256, text) |> Base.encode16(case: :lower),
        provider_call_ref: "call",
        provider_run_ref: "run"
      }
    end

    discussion = make.([0, 2])
    assert :ok = Compaction.validate_discussion(discussion, [source])

    assert %{entries: [%{retained_source_fragments: ["甲\r\n", "丙\n"]}]} =
             DiscussionSummary.projection(discussion, [source])

    assert %{entries: [%{retained_source_fragments: ["甲\r\n乙\r丙\n丁"]}]} =
             DiscussionSummary.projection(make.([0, 1, 2, 3]), [source])

    for invalid <- [[-1], [4], [1.0], ["0"], [0, 0], [2, 0]] do
      assert {:error, :checkpoint_invalid_discussion} =
               Compaction.validate_discussion(make.(invalid), [source])
    end
  end

  test "历史四类原文在 v1/v2 三 wire 只作中性片段，不变成义务分类" do
    # 四类性质由字面 fixture 给定；预期只证明来源保真，不判断是否履行。
    fragments = [
      "已给出两种路线的逐项比较。\r\n",
      "也可以考虑先写短篇。",
      "第二视角暂未选择。\r",
      "我会再补充风险表。\n"
    ]

    for text <- fragments,
        {version, retained} <- [
          {"authoring-discussion-summary/v1", %{retained_obligations: [text]}},
          {"authoring-discussion-summary/v2", %{retained_fragment_indices: [0]}}
        ] do
      messages =
        Enum.map(history(), fn
          %{canonical_ref: %{run_id: "old", run_sequence: 4}} = message ->
            %{message | blocks: [RequestIR.text_block(text)]}

          message ->
            message
        end)

      raw =
        Jason.encode!(%{
          version: version,
          entries: [Map.merge(%{source_index: 0, summary: "原讨论材料"}, retained)]
        }) <> "\r\n"

      original = checkpoint()
      [block] = original.blocks
      saved = discussion(raw)
      current = %{original | blocks: [%{block | discussion: saved}]}
      canonical = messages ++ [current]
      assert :ok = RequestIR.validate(ir(canonical))

      expected = %{
        "provenance" => "model_derived_history",
        "authority" => "none",
        "entries" => [
          %{
            "source" => %{"ref" => "session_message:old:4", "version" => 1},
            "locator" => %{"run_id" => "old", "run_sequence" => 4},
            "summary" => "原讨论材料",
            "retained_source_fragments" => [text]
          }
        ]
      }

      for target <- @targets do
        assert {:ok, body} = Projection.project(ir(canonical), target)

        checkpoint_text =
          Enum.find(wire_texts(body), &String.contains?(&1, "模型派生的历史讨论摘要"))

        projected = checkpoint_text |> String.split("\n") |> List.last() |> Jason.decode!()
        assert projected == expected
        refute Map.has_key?(hd(projected["entries"]), "retained_obligations")

        # 重放同一历史原响应只作纯投影，不产生 Provider 调用或改写其原字节。
        assert {:ok, ^body} = Projection.project(ir(canonical), target)
      end

      assert hd(List.last(canonical).blocks).discussion == saved
      assert saved.response_text == raw

      assert saved.response_sha256 ==
               :crypto.hash(:sha256, raw) |> Base.encode16(case: :lower)

      assert Jason.decode!(saved.response_text)["version"] == version
    end
  end

  test "v2 三 wire 从 checkpoint 之前的原历史取片段，不改变 canonical" do
    raw =
      ~s({"version":"authoring-discussion-summary/v2","entries":[{"source_index":0,"summary":"比较未完成","retained_fragment_indices":[1]}]})

    original = checkpoint()
    [block] = original.blocks
    current = %{original | blocks: [%{block | discussion: discussion(raw)}]}
    messages = history() ++ [current]
    assert :ok = RequestIR.validate(ir(messages))

    for target <- @targets do
      assert {:ok, body} = Projection.project(ir(messages), target)
      assert Enum.any?(wire_texts(body), &String.contains?(&1, @promise))
      refute @old_text in wire_texts(body)
    end

    assert hd(List.last(messages).blocks).discussion.response_text == raw
    assert Enum.drop(messages, -1) == history()

    assert {:error, :invalid_checkpoint_message} =
             RequestIR.validate(ir(Compaction.project(messages)))
  end

  test "节选省略已给材料时，三 wire 固定告知非穷尽并保留原文定位，不改写源" do
    original_text = "方案甲：降低延迟，代价是维护复杂。\n方案乙：维护简单，代价是等待更久。\n部署成本尚未比较。"

    messages =
      Enum.map(history(), fn
        %{canonical_ref: %{run_id: "old", run_sequence: 4}} = message ->
          %{message | blocks: [RequestIR.text_block(original_text)]}

        message ->
          message
      end)

    raw =
      ~s({"version":"authoring-discussion-summary/v2","entries":[{"source_index":0,"summary":"早期讨论提供两方案取舍，部署成本仍待比较。","retained_fragment_indices":[2]}]})

    original = checkpoint()
    [block] = original.blocks
    current = %{original | blocks: [%{block | discussion: discussion(raw)}]}

    for target <- @targets do
      assert {:ok, body} = Projection.project(ir(messages ++ [current]), target)
      text = Enum.join(wire_texts(body), "\n")
      assert text =~ "摘要与保留片段不是穷尽清单"
      assert text =~ "未提及不证明原文不存在"
      assert text =~ "session_message_read"
      assert text =~ ~s("locator":{"run_id":"old","run_sequence":4})
      assert text =~ "部署成本尚未比较"
      refute text =~ "方案乙：维护简单"
    end

    assert Enum.at(messages, 3).blocks == [RequestIR.text_block(original_text)]
    assert hd(current.blocks).discussion.response_text == raw
  end

  test "v2 编号保留空行和尾换行且预算包含编号元数据" do
    source = %{
      source_index: 0,
      source: %{run_id: "source", run_sequence: 3},
      author_text: "",
      text: "\r\n\n末\r"
    }

    assert {:ok, material} = Compaction.discussion_material([source])

    assert get_in(Jason.decode!(material), ["sources", Access.at(0), "fragments"]) == [
             %{"fragment_index" => 0, "text" => "\r\n"},
             %{"fragment_index" => 1, "text" => "\n"},
             %{"fragment_index" => 2, "text" => "末\r"}
           ]

    # 原文本小于预算，但完整片段 JSON 超限；不可截断原文迁就预算。
    assert {:error, :discussion_summary_input_budget_exceeded} =
             Compaction.discussion_material([%{source | text: String.duplicate("x\n", 5000)}])
  end

  test "来源身份由真实坐标确定；正文、作者上下文和分组序号不得创造新来源" do
    source = %{
      source_index: 0,
      source: %{run_id: "source-run", run_sequence: 4},
      text: "原始模型原文",
      author_text: "原始作者原文"
    }

    identity = Compaction.discussion_source_key(source, run())
    assert identity == ~s(authoring-session-source/v1:["ws","work","session","source-run",4])
    assert Compaction.valid_discussion_source_key?(identity, run())
    refute Compaction.valid_discussion_source_key?(String.replace(identity, ",", ", "), run())
    refute Compaction.valid_discussion_source_key?(String.duplicate("a", 64), run())
    refute Compaction.valid_discussion_source_key?(identity, %{run() | work_id: "wrong-work"})

    for changed <- [
          Map.put(source, :text, "被篡改的模型原文"),
          Map.put(source, :author_text, "被错绑的作者原文"),
          Map.put(source, :source_index, 9)
        ] do
      assert Compaction.discussion_source_key(changed, run()) == identity
    end

    refute Compaction.discussion_source_key(put_in(source.source.run_sequence, 5), run()) ==
             identity

    refute Compaction.discussion_source_key(source, %{run() | session_id: "other-session"}) ==
             identity
  end

  test "没有 checkpoint 时，全部原文、旧 Scope 与当前范围按原序保留" do
    messages = history()
    assert Compaction.project(messages) == messages
    assert :ok = RequestIR.validate(ir(messages))

    for target <- @targets do
      assert {:ok, body} = Projection.project(ir(messages), target)
      assert @author in wire_texts(body)
      assert @old_text in wire_texts(body)
    end
  end

  test "零工具调用的合法覆盖只替代精确旧源，三 wire 保留作者、当前范围及逐字未履行承诺" do
    originals = history()
    messages = originals ++ [checkpoint()]
    assert :ok = RequestIR.validate(ir(messages))
    assert Enum.take(messages, length(originals)) == originals

    # 预注册的身份集合是独立 oracle；不从 selector/evidence/project 派生预期。
    expected = [
      {"current", 1},
      {"old", 3},
      {"active", 2},
      {"active", 3},
      {"active", 4},
      {"current", 2},
      {"current", 3},
      {"current", 4},
      {"current", 5}
    ]

    actual =
      Compaction.project(messages)
      |> Enum.map(&{&1.canonical_ref.run_id, &1.canonical_ref.run_sequence})

    assert actual == expected

    for target <- @targets do
      assert {:ok, body} = Projection.project(ir(messages), target)
      text = wire_texts(body)
      assert @author in text
      refute @old_text in text
      assert "我还在等作者回答，不能用整理关闭这个问题。" in text
      assert "当前回复保持原文。" in text
      assert Enum.any?(text, &String.contains?(&1, @promise))
      assert Enum.any?(text, &String.contains?(&1, "当前范围事实"))
      assert Enum.any?(text, &String.contains?(&1, "model_derived_history"))
      assert Enum.any?(text, &String.contains?(&1, ~s("authority":"none")))
      refute Enum.any?(text, &String.contains?(&1, "旧范围完整正文"))
    end
  end

  test "相同文字不同身份仍是不同原文；只选一个坐标不会吞掉另一个" do
    twin = text_message("twin", 4, "assistant", "model", @old_text, "completed")
    messages = List.insert_at(history(), 4, twin) ++ [checkpoint()]
    assert :ok = Compaction.validate(messages)
    projected = Compaction.project(messages)

    assert Enum.count(
             projected,
             &(&1.role == "assistant" and Projection.text_of(&1.blocks) == @old_text)
           ) == 1

    assert Enum.any?(projected, &(&1.canonical_ref.run_id == "twin"))
  end

  test "未知、未来、重复、错版本、错角色与错来源坐标拒绝" do
    [scope, discussion] = references()

    invalid = [
      [Map.put(scope, :run_id, "unknown"), discussion],
      [Map.put(scope, :run_sequence, 99), discussion],
      [scope, scope, discussion],
      [Map.put(scope, :versions, %{"scope_revision" => 9}), discussion],
      [Map.put(scope, :role, "assistant"), discussion],
      [Map.put(scope, :source_refs, [%{ref: "scope:another", version: 1}]), discussion]
    ]

    for refs <- invalid do
      assert {:error, _} = Compaction.validate(history() ++ [checkpoint(refs)])
    end
  end

  test "当前 Scope、当前讨论、活动外 run 讨论、作者原文和混合工具消息不是可覆盖旧消息" do
    for {id, sequence, role, refs, versions} <- [
          {"current", 2, "scope_update", [%{ref: "scope:current", version: 1}],
           %{"scope_revision" => 1}},
          {"current", 4, "assistant", [], %{}},
          {"active", 4, "assistant", [], %{}},
          {"old", 3, "user", [%{ref: "turn-old"}], %{}}
        ] do
      selector = %{
        run_id: id,
        run_sequence: sequence,
        role: role,
        source_refs: refs,
        versions: versions
      }

      expected =
        cond do
          role == "user" -> :checkpoint_invalid_message_refs
          id == "current" -> :checkpoint_current_turn_protected
          true -> :checkpoint_protected_or_repeated_message
        end

      assert {:error, ^expected} = Compaction.validate(history() ++ [checkpoint([selector])])
    end

    mixed = RequestIR.tool_call_block("read_character", %{}, "unclosed")

    messages =
      Enum.map(history(), fn
        %{canonical_ref: %{run_id: "old", run_sequence: 4}} = message ->
          %{message | blocks: message.blocks ++ [mixed]}

        message ->
          message
      end)

    assert {:error, :checkpoint_protected_or_repeated_message} =
             Compaction.validate(messages ++ [checkpoint()])
  end

  test "重复实际来源坐标不能被Map覆盖；坏作者来源返回明确拒绝而非异常" do
    duplicate = text_message("old", 4, "assistant", "model", "同坐标不同内容", "completed")

    assert {:error, :checkpoint_ambiguous_message} =
             Compaction.validate(List.insert_at(history(), 4, duplicate) ++ [checkpoint()])

    for bad <- ["turn-old", 42] do
      messages =
        Enum.map(history(), fn
          %{canonical_ref: %{run_id: "old", run_sequence: 3}} = author ->
            %{author | source_refs: [bad]}

          message ->
            message
        end)

      assert {:error, :checkpoint_turn_range_unavailable} =
               Compaction.turn_range(messages, covers(), & &1.canonical_ref.run_id)
    end
  end

  test "同一消息不能由第二条 checkpoint 重复覆盖，范围说明不授予覆盖权限" do
    second = checkpoint() |> put_in([:canonical_ref, :run_sequence], 6)
    assert {:error, _} = Compaction.validate(history() ++ [checkpoint(), second])

    assert {:error, :checkpoint_selection_required} =
             Compaction.require_selection(%{turn_range: "turn-old..turn-current"})

    assert {:error, :checkpoint_selection_required} =
             Compaction.require_selection(%{call_ids: [], message_refs: []})
  end

  test "当前 covers 两类选择键均必填，旧缺键输入不会被构造器或校验补成合法" do
    for missing <- [:call_ids, :message_refs] do
      incomplete = Map.delete(covers(), missing)
      assert {:error, :checkpoint_selection_required} = Compaction.require_selection(incomplete)
      original = checkpoint()
      [block] = original.blocks
      invalid = %{original | blocks: [%{block | covers: incomplete}]}
      assert {:error, :invalid_checkpoint_block} = RequestIR.validate(ir(history() ++ [invalid]))
    end
  end

  test "摘要必须绑定源、精确响应 hash、严格版本及逐字引用；结构正确不代签语义完整" do
    assert {:ok, [source]} = Compaction.discussion_sources(history(), covers())

    assert source == %{
             source_index: 0,
             source: %{run_id: "old", run_sequence: 4},
             text: @old_text,
             author_text: @author
           }

    assert :ok = Compaction.validate_discussion(discussion(), [source])
    assert {:error, _} = Compaction.validate_discussion(nil, [source])
    assert {:error, _} = Compaction.validate_discussion(discussion(), [])

    assert {:error, _} =
             Compaction.validate_discussion(Map.put(discussion(), :response_sha256, "wrong"), [
               source
             ])

    for raw <- [
          ~s({"version":"unknown","entries":[{"source_index":0,"summary":"讨论","retained_obligations":[]}]}),
          ~s({"version":"authoring-discussion-summary/v1","entries":[]}),
          ~s({"version":"authoring-discussion-summary/v1","entries":[{"source_index":1,"summary":"讨论","retained_obligations":[]}]}),
          ~s({"version":"authoring-discussion-summary/v1","entries":[{"source_index":0,"summary":"讨论","retained_obligations":["已经比较完了。"]}]}),
          ~s({"version":"authoring-discussion-summary/v1","entries":[{"source_index":0,"summary":"讨论","retained_obligations":[],"authority":"canon"}]})
        ] do
      assert {:error, _} = Compaction.validate_discussion(discussion(raw), [source])
    end
  end

  test "旧 Scope 每个消息保持自己的版本，不能被最后一个 revision 覆写" do
    extra = scope("old", 5, "completed", 2, "另一份旧范围")
    author = text_message("old", 6, "user", "author", "补充约束", "completed", [%{ref: "turn-old-2"}])
    messages = history() |> List.insert_at(4, extra) |> List.insert_at(5, author)
    [first, last] = references()

    refs = [
      first,
      %{
        run_id: "old",
        run_sequence: 5,
        role: "scope_update",
        source_refs: [%{ref: "scope:old", version: 2}],
        versions: %{"scope_revision" => 2}
      },
      last
    ]

    checkpoint = checkpoint(refs)
    assert :ok = Compaction.validate(messages ++ [checkpoint])

    assert Enum.map(checkpoint.blocks |> hd() |> get_in([:covers, :message_refs]), & &1.versions) ==
             [%{"scope_revision" => 1}, %{"scope_revision" => 2}, %{}]
  end

  test "真实坐标注解保留跨 run 原序号，当前新增尾部递增；持久层可移除派生字段" do
    [base | rest] = history()
    current = Enum.filter(rest, &(&1.canonical_ref.run_id == "current"))
    foreign = Enum.reject(rest, &(&1.canonical_ref.run_id == "current"))
    tail = RequestIR.message(:application_notice, :application, [RequestIR.text_block("新增")])
    annotated = MessageCoverage.annotate([base] ++ foreign ++ current ++ [tail], run())
    assert List.last(annotated).canonical_ref.run_sequence == 5

    assert Enum.filter(annotated, &(&1.canonical_ref.run_id == "old")) ==
             Enum.filter(foreign, &(&1.canonical_ref.run_id == "old"))

    assert Map.has_key?(List.last(annotated), :canonical_ref)
    refute Map.has_key?(MessageCoverage.strip(List.last(annotated)), :canonical_ref)
  end

  test "当前回合完整工具交换无条件保护，完成状态或后来作者不能追溯授权 checkpoint" do
    for status <- ["running", "completed"] do
      prefix =
        [turn_author(1, "turn-1", status)] ++ tool_messages("current", 2, ["call-1"], status)

      checkpoint = turn_checkpoint(["call-1"], [], 4)

      assert {:error, :checkpoint_current_turn_protected} =
               Compaction.validate(prefix ++ [checkpoint])

      assert {:error, :checkpoint_current_turn_protected} =
               Compaction.validate(prefix ++ [checkpoint, turn_author(5, "turn-2", status)])
    end
  end

  test "真实下一作者回合只释放较早交换；已合法的 checkpoint 不受后来作者改变" do
    prefix =
      [turn_author(1, "turn-1")] ++
        tool_messages("current", 2, ["call-1"]) ++
        [turn_author(4, "turn-2")] ++ tool_messages("current", 5, ["call-2"])

    checkpoint = turn_checkpoint(["call-1"], [], 7)
    assert :ok = Compaction.validate(prefix ++ [checkpoint])
    assert :ok = Compaction.validate(prefix ++ [checkpoint, turn_author(8, "turn-3")])

    assert {:error, :checkpoint_current_turn_protected} =
             Compaction.validate(prefix ++ [turn_checkpoint(["call-2"], [], 7)])
  end

  test "初始 Scope 属于首个作者回合；没有完整项或只有待完成调用也不能覆盖" do
    refs = [
      %{
        run_id: "current",
        run_sequence: 1,
        role: "scope_update",
        source_refs: [%{ref: "scope:current", version: 1}],
        versions: %{"scope_revision" => 1}
      }
    ]

    prefix = [
      scope("current", 1, "running", 1, "首次范围"),
      turn_author(2, "turn-1"),
      scope("current", 3, "running", 2, "本回合更新范围")
    ]

    pending = hd(tool_messages("current", 4, ["pending-call"]))

    for tail <- [[], [pending]] do
      assert {:error, :checkpoint_current_turn_protected} =
               Compaction.validate(prefix ++ tail ++ [turn_checkpoint([], refs, 6)])
    end

    assert :ok =
             Compaction.validate(
               prefix ++ [turn_author(4, "turn-2"), turn_checkpoint([], refs, 5)]
             )
  end

  test "当前作者和被覆盖来源的真实作者归属缺失或损坏时失败关闭" do
    prefix =
      [turn_author(1, "turn-1")] ++
        tool_messages("current", 2, ["call-1"]) ++
        [turn_author(4, "turn-2")]

    for index <- [0, 3], refs <- [[], ["turn-bad"], [%{ref: ""}]] do
      broken = List.update_at(prefix, index, &Map.put(&1, :source_refs, refs))

      assert {:error, :checkpoint_turn_range_unavailable} =
               Compaction.validate(broken ++ [turn_checkpoint(["call-1"], [], 5)])
    end

    assert {:error, :checkpoint_turn_range_unavailable} =
             Compaction.validate(tl(prefix) ++ [turn_checkpoint(["call-1"], [], 5)])
  end

  test "交错 run 按各自真实作者归属；只允许已结束外 run 的旧交换" do
    for {status, expected} <- [
          {"completed", :ok},
          {"awaiting_author", {:error, :checkpoint_protected_exchange}}
        ] do
      old_author = text_message("old", 1, "user", "author", @author, status, [%{ref: "turn-old"}])

      messages =
        [old_author, turn_author(1, "turn-current")] ++
          tool_messages("old", 2, ["old-call"], status) ++ [turn_checkpoint(["old-call"], [], 2)]

      assert Compaction.validate(messages) == expected
    end
  end

  test "同一 assistant 的多工具交换不可部分覆盖；较早完整组可进入 IR" do
    prefix =
      [turn_author(1, "turn-1")] ++
        tool_messages("current", 2, ["call-1", "call-2"]) ++
        [turn_author(4, "turn-2")]

    assert {:error, :checkpoint_partial_message} =
             Compaction.validate(prefix ++ [turn_checkpoint(["call-1"], [], 5)])

    messages = prefix ++ [turn_checkpoint(["call-1", "call-2"], [], 5)]
    assert :ok = Compaction.validate(messages)
    assert :ok = RequestIR.validate(ir(messages))
  end

  test "纯 turn_range checkpoint 在 IR 结构入口被拒绝，不能删除较早真实交换" do
    prefix =
      [turn_author(1, "turn-1")] ++
        tool_messages("current", 2, ["call-1"]) ++
        [turn_author(4, "turn-2")]

    block = RequestIR.checkpoint_block(%{turn_range: "turn-1"}, [], %{}, [], "旧版摘要")

    checkpoint =
      RequestIR.message(:checkpoint, :application, [block], %{
        canonical_ref: coordinate("current", 5, "running")
      })

    assert {:error, :invalid_checkpoint_block} = RequestIR.validate(ir(prefix ++ [checkpoint]))
  end

  defp run do
    %{
      run_id: "current",
      workspace_id: "ws",
      work_id: "work",
      session_id: "session",
      parent_turn_ref: "turn-current"
    }
  end

  defp ir(messages) do
    RequestIR.new(%{
      run: run(),
      system: RequestIR.system_envelope(instructions: "基于真实历史继续作者目标。", run_role: "creation_run"),
      messages: messages,
      tools: [],
      refs: %{base_refs: [], observation_refs: [], used_refs: []}
    })
  end

  defp history do
    [
      text_message("current", 1, "application_base", "application", "稳定应用来源", "running"),
      scope("old", 2, "completed", 1, "旧范围完整正文"),
      text_message("old", 3, "user", "author", @author, "completed", [%{ref: "turn-old"}]),
      text_message("old", 4, "assistant", "model", @old_text, "completed"),
      scope("active", 2, "awaiting_author", 1, "另一个活动任务范围"),
      text_message("active", 3, "user", "author", "请先问我视角。", "awaiting_author", [
        %{ref: "turn-active"}
      ]),
      text_message("active", 4, "assistant", "model", "我还在等作者回答，不能用整理关闭这个问题。", "awaiting_author"),
      scope("current", 2, "running", 1, "当前范围事实"),
      text_message("current", 3, "user", "author", "我选第三人称，现在继续未完成的比较。", "running", [
        %{ref: "turn-current"}
      ]),
      text_message("current", 4, "assistant", "model", "当前回复保持原文。", "running")
    ]
  end

  defp text_message(id, sequence, role, provenance, text, status, refs \\ []) do
    RequestIR.message(role, provenance, [RequestIR.text_block(text)], %{
      source_refs: refs,
      canonical_ref: coordinate(id, sequence, status)
    })
  end

  defp scope(id, sequence, status, version, label) do
    RequestIR.message(
      :scope_update,
      :application,
      [RequestIR.scope_block(%{work_id: "work", facts: %{label: label}})],
      %{
        source_refs: [%{ref: "scope:" <> id, version: version}],
        versions: %{"scope_revision" => version},
        canonical_ref: coordinate(id, sequence, status)
      }
    )
  end

  defp coordinate(id, sequence, status) do
    %{
      run_id: id,
      run_sequence: sequence,
      work_id: "work",
      workspace_id: "ws",
      session_id: "session",
      parent_turn_ref: "turn-" <> id,
      run_status: status
    }
  end

  defp references do
    [
      %{
        run_id: "old",
        run_sequence: 2,
        role: "scope_update",
        source_refs: [%{ref: "scope:old", version: 1}],
        versions: %{"scope_revision" => 1}
      },
      %{run_id: "old", run_sequence: 4, role: "assistant", source_refs: [], versions: %{}}
    ]
  end

  defp covers(refs \\ references()),
    do: %{call_ids: [], message_refs: refs, turn_range: "turn-old"}

  defp checkpoint(refs \\ references()) do
    # 字面来源表由预注册 Canonical fixture 指定，不调用被测 evidence/selector。
    source_refs =
      Enum.flat_map(refs, fn ref ->
        ref.source_refs ++
          [%{ref: "session_message:#{ref.run_id}:#{ref.run_sequence}", version: 1}]
      end)

    block =
      RequestIR.checkpoint_block(
        covers(refs),
        source_refs,
        %{},
        ["旧 Scope 与讨论正文可从原文回查，义务不因摘要解除。"],
        "整理了旧资料。",
        discussion()
      )

    RequestIR.message(:checkpoint, :application, [block], %{
      canonical_ref: coordinate("current", 5, "running")
    })
  end

  defp discussion(raw \\ nil) do
    raw =
      raw ||
        Jason.encode!(%{
          version: "authoring-discussion-summary/v1",
          entries: [
            %{source_index: 0, summary: "讨论两种方案；比较尚未履行。", retained_obligations: [@promise]}
          ]
        })

    %{
      response_text: raw,
      response_sha256: :crypto.hash(:sha256, raw) |> Base.encode16(case: :lower),
      provider_call_ref: "pcall-summary",
      provider_run_ref: "prun-summary"
    }
  end

  defp turn_author(sequence, turn, status \\ "running"),
    do: text_message("current", sequence, "user", "author", "继续作者目标。", status, [%{ref: turn}])

  defp tool_messages(id, sequence, ids, status \\ "running") do
    calls = Enum.map(ids, &RequestIR.tool_call_block("read_character", %{}, &1))
    results = Enum.map(ids, &RequestIR.observation_block(&1, %{status: "ok", content: %{}}))

    [
      RequestIR.message(:assistant, :model, calls, %{
        canonical_ref: coordinate(id, sequence, status)
      }),
      RequestIR.message(:tool, :tool_result, results, %{
        canonical_ref: coordinate(id, sequence + 1, status)
      })
    ]
  end

  defp turn_checkpoint(ids, refs, sequence) do
    evidence =
      Enum.flat_map(refs, fn ref ->
        ref.source_refs ++
          [%{ref: "session_message:#{ref.run_id}:#{ref.run_sequence}", version: 1}]
      end)

    block =
      RequestIR.checkpoint_block(
        %{call_ids: ids, message_refs: refs},
        evidence,
        %{},
        ["原文仍保留。"],
        "整理较早回合。"
      )

    RequestIR.message(:checkpoint, :application, [block], %{
      canonical_ref: coordinate("current", sequence, "running")
    })
  end

  defp wire_texts(body) do
    for message <- Map.get(body, :messages, Map.get(body, :input, [])),
        block <- List.wrap(Map.get(message, :content, [])),
        text = if(is_binary(block), do: block, else: Map.get(block, :text)),
        is_binary(text),
        do: text
  end
end
