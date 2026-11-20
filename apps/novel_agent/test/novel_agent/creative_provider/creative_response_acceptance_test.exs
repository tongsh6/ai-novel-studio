defmodule NovelAgent.CreativeProvider.CreativeResponseAcceptanceTest do
  use ExUnit.Case, async: true

  alias NovelAgent.CreativeProvider.Real
  alias NovelAgent.Provider.Execution
  alias NovelAgent.TestSupport.AuthoringTaskFixtures
  alias NovelCommon.Contracts.CreativeRequest
  alias NovelCommon.RequestIR

  @tool "submit_tentative_artifact"
  @base_ref "chapter:reception-baseline"
  @author_ref "turn:reception-author"
  @body "接收正文 Ω\n雨滴落在桌沿，沈砚没有开口。"
  @rationale "让沈砚的迟疑落在动作上。\n保留原来的停顿。"

  test "只接受同次实际 Base 声明；作者来源失败后原 call 回流，纠正结果才交付" do
    request = request()

    {provider, calls} =
      provider([
        response("unbound", "rejected", [@author_ref]),
        response("accepted", "accepted", [@base_ref])
      ])

    assert {%{status: :ok, items: [%{item_id: "accepted", body: @body, rationale: @rationale}]},
            session} = Real.generate_with_session(request, provider)

    assert session.provider_call_count == 2
    assert [first, second] = calls.()
    assert first.refs.base_refs == [%{ref: @base_ref, version: 7}]
    assert first.refs.observation_refs == []

    assert Enum.any?(
             first.messages,
             &(@author_ref in Enum.map(&1.source_refs, fn r -> r.ref end))
           )

    assert second.refs.base_refs == first.refs.base_refs
    assert second.refs.observation_refs == []
    assert rejected_calls(second) == [{"unbound", "used_context_refs_invalid"}]

    assert get_in(native_arguments(second, "unbound"), ["self_report", "used_context_refs"]) == [
             @author_ref
           ]

    assert {:ok, ["accepted"]} = RequestIR.pending_call_ids(session.request_ir)
  end

  test "未读、未来观察、其它调用材料和来源引用不能经重试转为授信" do
    for ref <- ["chapter:not-read", "observation:future", "memory:other-call", @author_ref] do
      {provider, calls} =
        provider([response("first", "first", [ref]), response("second", "second", [ref])])

      assert {%{status: :error, items: [], errors: [%{code: "used_context_refs_invalid"}]},
              session} = Real.generate_with_session(request(), provider)

      assert length(calls.()) == 2
      assert session.provider_call_count == 2
      assert {:ok, []} = RequestIR.pending_call_ids(session.request_ir)

      assert rejected_calls(session.request_ir) ==
               [{"first", "used_context_refs_invalid"}, {"second", "used_context_refs_invalid"}]

      assert get_in(native_arguments(session.request_ir, "second"), [
               "self_report",
               "used_context_refs"
             ]) == [ref]
    end
  end

  test "合法的真实观察随下一专业请求进入接收边界，来源身份仍独立" do
    previous =
      RequestIR.new(%{
        run: %{run_id: "reception-run", work_id: "reception-work"},
        system: RequestIR.system_envelope(),
        tools: [%{name: "chapter_read", input_schema: %{type: "object"}}],
        refs: %{base_refs: [], observation_refs: ["observation:actual-read"], used_refs: []},
        messages: [
          RequestIR.message(:user, :author, [RequestIR.text_block("参考已读章节写一段。")], %{
            source_refs: [%{ref: @author_ref}]
          }),
          RequestIR.message(:assistant, :model, [
            RequestIR.tool_call_block("chapter_read", %{chapter_ref: @base_ref}, "read-call")
          ]),
          RequestIR.message(:tool, :tool_result, [
            RequestIR.observation_block("read-call", %{
              status: "ok",
              source_refs: [%{ref: "observation:actual-read"}],
              content: %{observation_ref: "observation:actual-read", summary: "真实已读正文。"}
            })
          ])
        ]
      })

    request = %{request() | request_ir: previous}

    {provider, calls} =
      provider([response("read-used", "candidate", ["observation:actual-read"])])

    assert {%{status: :ok, self_report: %{used_context_refs: ["observation:actual-read"]}}, _} =
             Real.generate_with_session(request, provider)

    assert [actual] = calls.()
    assert actual.refs.base_refs == [%{ref: @base_ref, version: 7}]
    assert actual.refs.observation_refs == ["observation:actual-read"]

    assert Enum.any?(
             RequestIR.visible_observations(actual),
             &(&1.content["summary"] == "真实已读正文。")
           )
  end

  test "观察引用表只有关联元数据时不能替代实际供应材料" do
    ref = "observation:metadata-only"
    previous = previous_ir([], [ref])
    assert :ok = RequestIR.validate(previous)
    assert :ok = RequestIR.validate(%{previous | refs: Map.put(previous.refs, :used_refs, [ref])})

    calls = assert_rejected_declaration(%{request() | request_ir: previous}, ref)
    assert Enum.all?(calls, &(RequestIR.visible_observations(&1) == []))
  end

  @tag :r05_observation_origin
  test "应用计划读取保持 Base 身份，错误登记到观察目录不能改变其实际来源" do
    source = "memory:application-only"
    identity = "observation:application-only"

    material = application_read_message(source, identity, "应用计划实际读取到的设定材料。")

    previous = previous_ir([material], [source, identity])
    assert :ok = RequestIR.validate(previous)
    assert [%{provenance: "application"}] = RequestIR.usable_observations(previous)

    for claim <- [source, identity] do
      assert_rejected_declaration(%{request() | request_ir: previous}, claim)
    end

    supplied_base =
      previous_ir([Map.put(material, :base_refs, [%{ref: source}])], [source, identity])

    supplied_base = %{
      supplied_base
      | refs: Map.put(supplied_base.refs, :base_refs, [%{ref: source}])
    }

    assert :ok = RequestIR.validate(supplied_base)
    {provider, calls} = provider([response("application-base", "candidate", [source])])

    assert {%{status: :ok, self_report: %{used_context_refs: [^source]}}, _} =
             Real.generate_with_session(%{request() | request_ir: supplied_base}, provider)

    assert [actual] = calls.()
    assert %{ref: source} in actual.refs.base_refs
    assert RequestIR.usable_observation_refs(actual) == []
    assert [%{provenance: "application"}] = RequestIR.usable_observations(actual)
  end

  @tag :r05_application_base_visibility
  test "已覆盖的应用读取不能借累计 Base 或新 Scope 的关联来源继续授信" do
    source = "memory:hidden-application"
    previous = hidden_application_base(source)

    assert :ok = RequestIR.validate(previous)
    assert previous.refs.base_refs == [%{ref: source}]
    assert RequestIR.usable_observations(previous) == []

    assert :ok =
             RequestIR.validate(%{previous | refs: Map.put(previous.refs, :used_refs, [source])})

    calls = assert_rejected_declaration(%{request() | request_ir: previous}, source)
    assert Enum.all?(calls, &(RequestIR.usable_observations(&1) == []))
  end

  @tag :r05_application_base_visibility
  test "旧应用读取隐藏后同一 ref 的本次完整 Base 重新供应仍然合法" do
    previous = hidden_application_base(@base_ref)
    assert :ok = RequestIR.validate(previous)
    assert RequestIR.usable_observations(previous) == []

    request = %{
      request()
      | request_ir: previous,
        context_text: "本次重新供应的章节结构：雨夜来访改变了沈砚的决定。"
    }

    {provider, calls} = provider([response("fresh-base", "candidate", [@base_ref])])

    assert {%{status: :ok, self_report: %{used_context_refs: [@base_ref]}}, _} =
             Real.generate_with_session(request, provider)

    assert [actual] = calls.()
    assert RequestIR.usable_observations(actual) == []
    assert %{ref: @base_ref, version: 7} in actual.refs.base_refs

    assert Enum.any?(actual.messages, fn message ->
             Enum.any?(message.blocks, fn
               %{type: "scope", content: %{"operation" => operation}} ->
                 operation["context_text"] == request.context_text

               _ ->
                 false
             end)
           end)
  end

  @tag :r05_application_base_visibility
  test "只覆盖一个应用读取不能撤销同 ref 另一份仍实际可见的读取" do
    source = "memory:read-again"

    visible =
      application_read_message(source, "observation:still-visible", "另一份仍实际供应的设定正文。")
      |> Map.put(:base_refs, [%{ref: source}])

    previous = hidden_application_base(source, [visible])
    assert :ok = RequestIR.validate(previous)

    assert [
             %{
               provenance: "application",
               content: %{"observation_ref" => "observation:still-visible"}
             }
           ] =
             RequestIR.usable_observations(previous)

    {provider, calls} = provider([response("visible-base", "candidate", [source])])

    assert {%{status: :ok, self_report: %{used_context_refs: [^source]}}, _} =
             Real.generate_with_session(%{request() | request_ir: previous}, provider)

    assert [_actual] = calls.()
  end

  @tag :r05_application_base_visibility
  test "旧应用读取隐藏时同 ref 的可见专业材料仍能使用，不依赖业务 payload 形状" do
    source = "memory:historical-professional"
    professional = professional_material_message(source)
    previous = hidden_application_base(source, [professional])

    assert :ok = RequestIR.validate(previous)
    assert RequestIR.usable_observations(previous) == []
    assert RequestIR.usable_base_refs(previous) == [%{ref: source, version: 7}]
    refute Enum.any?(request().task.materials, &(&1.ref == source))

    {provider, calls} = provider([response("history-supplied", "candidate", [source])])

    assert {%{status: :ok, self_report: %{used_context_refs: [^source]}}, _} =
             Real.generate_with_session(%{request() | request_ir: previous}, provider)

    assert [actual] = calls.()
    assert %{ref: source, version: 7} in RequestIR.usable_base_refs(actual)
  end

  @tag :r05_application_base_visibility
  test "再次覆盖专业重供后历史声明仍合法，但新声明只能引用当前供应" do
    source = "memory:covered-professional"
    previous = hidden_application_base(source, [], [professional_material_message(source)])
    previous = %{previous | refs: Map.put(previous.refs, :used_refs, [source])}

    assert :ok = RequestIR.validate(previous)
    assert RequestIR.usable_base_refs(previous) == []

    assert {:error, _reason} = RequestIR.validate_used_refs(previous, [source])
    assert_rejected_declaration(%{request() | request_ir: previous}, source)

    {provider, calls} = provider([response("fresh-current", "candidate", [@base_ref])])

    assert {%{status: :ok, self_report: %{used_context_refs: [@base_ref]}}, _} =
             Real.generate_with_session(%{request() | request_ir: previous}, provider)

    assert [actual] = calls.()
    assert actual.refs.used_refs == [source]
    assert :ok = RequestIR.validate(actual)
    assert RequestIR.usable_base_refs(actual) == [%{ref: @base_ref, version: 7}]
  end

  @tag :r05_observation_content
  test "成功观察只有工具关联元数据时不能把来源或观察身份升格为材料" do
    source = "chapter:reference-only"
    identity = "observation:reference-only"

    previous =
      previous_ir(
        observation_history(source, "ok", %{
          tool: "chapter_read",
          query: "仅索引",
          observation_ref: identity,
          facts: %{}
        }),
        [source, identity]
      )

    assert :ok = RequestIR.validate(previous)
    assert [%{status: "ok"}] = RequestIR.visible_observations(previous)

    for claim <- [source, identity] do
      assert_rejected_declaration(%{request() | request_ir: previous}, claim)
    end
  end

  @tag :r05_observation_content
  test "真实空读取仍可用摘要或事实计数提供否定事实，不要求已有正文" do
    for content <- [
          %{tool: "chapter_read", summary: "当前章节还没有已采纳正文。", facts: %{}},
          %{tool: "chapter_read", facts: %{prose_characters: 0, returned_items: 0}}
        ] do
      ref = "chapter:actual-empty"
      previous = previous_ir(observation_history(ref, "ok", content), [ref])
      {provider, calls} = provider([response("empty-read", "candidate", [ref])])

      assert {%{status: :ok, self_report: %{used_context_refs: [^ref]}}, _} =
               Real.generate_with_session(%{request() | request_ir: previous}, provider)

      assert [actual] = calls.()
      assert [%{content: visible}] = RequestIR.visible_observations(actual)
      assert visible == RequestIR.json_value(content)
    end
  end

  test "失效或不可用观察即使已登记并带正文也不能为声明授信" do
    for status <- ["stale", "unavailable"] do
      ref = "observation:#{status}"
      previous = previous_ir(observation_history(ref, status), [ref])
      assert :ok = RequestIR.validate(previous)

      calls = assert_rejected_declaration(%{request() | request_ir: previous}, ref)

      assert Enum.all?(calls, fn actual ->
               [%{status: ^status}] = RequestIR.visible_observations(actual)
             end)
    end
  end

  test "计划聚合父观察失败时不能用成功叶绕过接收资格" do
    for status <- ["stale", "unavailable"] do
      ref = "observation:failed-parent-#{status}"

      content = %{
        tool: "planned_exploration",
        observations: [
          %{status: "ok", source_refs: [%{ref: ref}], content: %{summary: "父读取已失效的叶。"}}
        ]
      }

      previous = previous_ir(observation_history(ref, status, content), [ref])
      assert :ok = RequestIR.validate(previous)
      assert [%{status: "ok"}] = RequestIR.visible_observations(previous)
      assert_rejected_declaration(%{request() | request_ir: previous}, ref)
    end
  end

  test "压缩覆盖的旧正文和 checkpoint 引用只保留历史身份，不恢复当前材料资格" do
    ref = "observation:compacted-body"
    history = observation_history(ref, "ok")

    checkpoint =
      RequestIR.message(:checkpoint, :application, [
        RequestIR.checkpoint_block(
          %{call_ids: ["read-call"], message_refs: []},
          [%{ref: ref}],
          %{},
          ["完整正文未包含在本次摘要中"],
          "之前完成过章节读取，本次只保留摘要。"
        )
      ])

    previous = previous_ir(history ++ [checkpoint], [ref])
    assert :ok = RequestIR.validate(previous)
    assert :ok = RequestIR.validate(%{previous | refs: Map.put(previous.refs, :used_refs, [ref])})
    assert RequestIR.visible_observations(previous) == []

    calls = assert_rejected_declaration(%{request() | request_ir: previous}, ref)
    assert Enum.all?(calls, &(RequestIR.visible_observations(&1) == []))
    assert native_arguments(previous, "read-call") == %{"chapter_ref" => @base_ref}
  end

  @tag :r05_observation_identity
  test "真实正文不能把伪造的领域引用变成观察身份，已供应来源仍独立有效" do
    source = "chapter:actual-source"
    false_identity = "chapter:identity-only"

    previous =
      previous_ir(
        observation_history(source, "ok", %{
          observation_ref: false_identity,
          summary: "实际读到的正文，只属于已供应来源。"
        }),
        [source, false_identity]
      )

    assert :ok = RequestIR.validate(previous)

    assert [%{content: %{"observation_ref" => ^false_identity}}] =
             RequestIR.usable_observations(previous)

    assert_rejected_declaration(%{request() | request_ir: previous}, false_identity)

    {provider, calls} = provider([response("source-only", "candidate", [source])])

    assert {%{status: :ok, self_report: %{used_context_refs: [^source]}}, _} =
             Real.generate_with_session(%{request() | request_ir: previous}, provider)

    assert [actual] = calls.()
    assert RequestIR.usable_observation_refs(actual) == [source]
  end

  test "实际叶里的自由引用未登记到本次 IR 时仍不能授信" do
    ref = "observation:unregistered"
    previous = previous_ir(observation_history(ref, "ok"), [])
    assert :ok = RequestIR.validate(previous)
    assert [%{status: "ok"}] = RequestIR.visible_observations(previous)
    assert_rejected_declaration(%{request() | request_ir: previous}, ref)
  end

  test "部分或截断读取可以使用已供应来源，实际状态不提升为完整读取" do
    for status <- ["partial", "truncated"] do
      source = "chapter:partially-read"
      identity = "observation:partial-read"

      previous =
        previous_ir(
          observation_history(source, status, %{
            observation_ref: identity,
            summary: "本次实际读到的前三句。"
          }),
          [%{ref: source}, identity]
        )

      {provider, calls} = provider([response("partial", "partial", [source, identity])])

      assert {%{status: :ok, self_report: %{used_context_refs: [^source, ^identity]}}, _} =
               Real.generate_with_session(%{request() | request_ir: previous}, provider)

      assert [actual] = calls.()
      assert [%{status: ^status}] = RequestIR.visible_observations(actual)
    end
  end

  test "合法 Base 声明不依赖历史观察仍可用，引用表和压缩不影响独立 Base" do
    ref = "observation:unusable"
    history = observation_history(ref, "ok")

    checkpoint =
      RequestIR.message(:checkpoint, :application, [
        RequestIR.checkpoint_block(
          %{call_ids: ["read-call"], message_refs: []},
          [%{ref: ref}],
          %{},
          ["正文已从本次请求省略"],
          "此前已读取正文，本次只保留记录。"
        )
      ])

    for previous <- [
          previous_ir([], [ref]),
          previous_ir(observation_history(ref, "stale"), [ref]),
          previous_ir(observation_history(ref, "unavailable"), [ref]),
          previous_ir(history ++ [checkpoint], [ref])
        ] do
      {provider, calls} = provider([response("base-only", "base-only", [@base_ref])])

      assert {%{status: :ok, self_report: %{used_context_refs: [@base_ref]}}, _} =
               Real.generate_with_session(%{request() | request_ir: previous}, provider)

      assert [_actual] = calls.()
    end
  end

  test "坏形状引用声明不能被当作缺省或部分过滤，原失败参数留存" do
    for refs <- [
          nil,
          false,
          7,
          @base_ref,
          %{"ref" => @base_ref},
          ["", @base_ref],
          [@base_ref, nil],
          [@base_ref, %{"ref" => @base_ref}]
        ] do
      {provider, calls} =
        provider([response("invalid", "bad", refs), response("corrected", "good", [])])

      assert {%{status: :ok, items: [%{item_id: "good"}]}, session} =
               Real.generate_with_session(request(), provider)

      assert length(calls.()) == 2
      assert rejected_calls(session.request_ir) == [{"invalid", "invalid_used_context_refs"}]

      assert get_in(native_arguments(session.request_ir, "invalid"), [
               "self_report",
               "used_context_refs"
             ]) == refs
    end
  end

  test "违规 rationale 原调用拒绝，小说正文保持原字节且不套用说明词规则" do
    bad = response("bad-rationale", "bad", [@base_ref], "采用 chapter:internal-object 的材料。")
    good = response("good-rationale", "good", [@base_ref])
    story = "他说：chapter:internal-object 是铭牌上原有的字样。\n" <> @body

    good =
      put_in(good, [:tool_calls, Access.at(0), :arguments, :items, Access.at(0), :body], story)

    {provider, calls} = provider([bad, good])

    assert {%{status: :ok, items: [%{item_id: "good", body: ^story, rationale: @rationale}]},
            session} = Real.generate_with_session(request(), provider)

    assert length(calls.()) == 2

    assert rejected_calls(session.request_ir) ==
             [{"bad-rationale", "author_visible_narrative_invalid"}]

    assert get_in(native_arguments(session.request_ir, "bad-rationale"), [
             "items",
             Access.at(0),
             "rationale"
           ]) ==
             "采用 chapter:internal-object 的材料。"
  end

  test "省略声明仍合法，已接受引用必须继续经过应用现有 validator" do
    result = response("app-invalid", "candidate", [])

    result =
      update_in(result, [:tool_calls, Access.at(0), :arguments], &Map.delete(&1, :self_report))

    {provider, calls} = provider([result])
    parent = self()

    validator = fn parsed ->
      send(parent, {:validated, parsed.items})
      {:error, %{reason_code: "application_rejected", detail: %{}, message: "保留原任务并修正范围。"}}
    end

    assert {%{status: :error, errors: [%{code: "application_rejected"}]}, session} =
             Real.generate_with_session(request(), provider,
               validate_result: validator,
               max_provider_calls: 1
             )

    assert_receive {:validated, [%{item_id: "candidate"}]}
    assert length(calls.()) == 1
    assert rejected_calls(session.request_ir) == [{"app-invalid", "application_rejected"}]
  end

  defp assert_rejected_declaration(request, ref) do
    {provider, calls} =
      provider([response("first", "first", [ref]), response("second", "second", [ref])])

    assert {%{status: :error, items: [], errors: [%{code: "used_context_refs_invalid"}]}, session} =
             Real.generate_with_session(request, provider)

    actual_calls = calls.()
    assert length(actual_calls) == 2

    assert rejected_calls(session.request_ir) ==
             [{"first", "used_context_refs_invalid"}, {"second", "used_context_refs_invalid"}]

    assert get_in(native_arguments(session.request_ir, "first"), [
             "self_report",
             "used_context_refs"
           ]) == [ref]

    assert get_in(native_arguments(session.request_ir, "second"), [
             "self_report",
             "used_context_refs"
           ]) == [ref]

    assert {:ok, []} = RequestIR.pending_call_ids(session.request_ir)
    actual_calls
  end

  defp application_read_message(source, identity, summary) do
    RequestIR.message(
      :scope_update,
      :application,
      [
        RequestIR.scope_block(%{
          work_id: "reception-work",
          operation: %{
            role: "planned_exploration",
            plan_ref: "plan:actual",
            plan_version: 1,
            step_ref: "step:actual-read",
            observation_ref: identity
          },
          facts: %{
            exploration_result: %{
              status: "ok",
              source_refs: [%{ref: source}],
              content: %{tool: "memory_recall", observation_ref: identity, summary: summary}
            }
          }
        })
      ],
      %{source_refs: [%{ref: source}]}
    )
  end

  defp professional_material_message(source) do
    assert {:ok, ir} =
             RequestIR.Operation.prepare(nil, request().run, %{
               role: "chapter_mission",
               instructions: "根据实际供应材料推演章节使命。",
               scope: %{
                 operation: %{
                   mission_inputs: %{
                     items: [%{ref: source, text: "仍可见的真实使命输入：雨夜来访改变了沈砚的决定。"}]
                   }
                 }
               },
               tool: %{name: "chapter_mission", input_schema: %{type: "object"}},
               source_refs: [%{ref: source, version: 7}],
               base_refs: [%{ref: source, version: 7}],
               author_text: "先读取章节材料。",
               source_input_ref: "turn:read-origin"
             })

    List.last(ir.messages)
  end

  defp hidden_application_base(source, visible_materials \\ [], hidden_materials \\ []) do
    old_read =
      application_read_message(source, "observation:old-application", "只存在于旧读取中的设定正文。")
      |> Map.put(:base_refs, [%{ref: source}])

    current_scope =
      RequestIR.message(
        :scope_update,
        :application,
        [
          RequestIR.scope_block(%{
            work_id: "reception-work",
            operation: %{role: "creative_execution"},
            facts: %{}
          })
        ],
        %{source_refs: [%{ref: source}]}
      )

    history = [old_read] ++ hidden_materials ++ [current_scope] ++ visible_materials
    uncompressed = previous_ir(history, [])

    selected =
      uncompressed.messages
      |> Enum.slice(1, 1 + length(hidden_materials))
      |> Enum.map(&RequestIR.MessageCoverage.selector/1)

    checkpoint_sources =
      Enum.flat_map(selected, &(&1.source_refs ++ [RequestIR.MessageCoverage.source_ref(&1)]))

    checkpoint =
      RequestIR.message(:checkpoint, :application, [
        RequestIR.checkpoint_block(
          %{call_ids: [], message_refs: selected},
          checkpoint_sources,
          %{},
          ["旧应用读取的正文已省略；本条只保留读取事件记录"],
          "此前发生过一次应用读取，本次没有保留其原始正文。"
        )
      ])

    previous = previous_ir(history ++ [checkpoint], [])
    registered = history |> Enum.flat_map(& &1.base_refs) |> Enum.uniq()
    %{previous | refs: Map.put(previous.refs, :base_refs, registered)}
  end

  defp previous_ir(history, observation_refs) do
    old_author =
      RequestIR.message(:user, :author, [RequestIR.text_block("先读取章节材料。")], %{
        source_refs: [%{ref: "turn:read-origin"}]
      })

    current_author =
      RequestIR.message(:user, :author, [RequestIR.text_block(request().task.author_words)], %{
        source_refs: [%{ref: @author_ref}]
      })

    messages =
      [
        old_author
        | Enum.flat_map(history, fn
            %{role: "checkpoint"} = checkpoint -> [current_author, checkpoint]
            message -> [message]
          end)
      ]
      |> Enum.with_index(1)
      |> Enum.map(fn {message, sequence} ->
        Map.put(message, :canonical_ref, %{
          run_id: "reception-run",
          run_sequence: sequence,
          run_status: "running"
        })
      end)

    RequestIR.new(%{
      run: %{run_id: "reception-run", work_id: "reception-work"},
      system: RequestIR.system_envelope(),
      tools: [%{name: "chapter_read", input_schema: %{type: "object"}}],
      refs: %{base_refs: [], observation_refs: observation_refs, used_refs: []},
      messages: messages
    })
  end

  defp observation_history(ref, status, content \\ %{summary: "实际读取的正文。"}) do
    [
      RequestIR.message(:assistant, :model, [
        RequestIR.tool_call_block("chapter_read", %{chapter_ref: @base_ref}, "read-call")
      ]),
      RequestIR.message(:tool, :tool_result, [
        RequestIR.observation_block("read-call", %{
          status: status,
          source_refs: [%{ref: ref}],
          content: content
        })
      ])
    ]
  end

  defp request do
    %CreativeRequest{
      request_id: "reception-request",
      run: %{run_id: "reception-run", work_id: "reception-work"},
      tool_name: "prose_writing",
      artifact_type: :prose_fragment,
      creative_brief: "让沈砚的迟疑落在动作上",
      source_turn_ref: "turn:reception-source",
      source_input_ref: @author_ref,
      task:
        AuthoringTaskFixtures.prose_task(%{
          source: %{kind: :author_action, ref: @author_ref},
          source_refs: [@author_ref, "memory:other-call"],
          materials: [%{kind: :target_structure, ref: @base_ref, version: 7, complete?: true}]
        })
    }
  end

  defp response(call_id, item_id, refs, rationale \\ @rationale) do
    %{
      content: "",
      tool_calls: [
        %{
          id: call_id,
          name: @tool,
          arguments: %{
            items: [%{item_id: item_id, title: "雨夜", body: @body, rationale: rationale}],
            self_report: %{used_context_refs: refs}
          }
        }
      ]
    }
  end

  defp native_arguments(ir, id) do
    [arguments] =
      for %{role: "assistant", blocks: blocks} <- ir.messages,
          %{type: "tool_call", call_id: ^id, arguments: arguments} <- blocks,
          do: arguments

    arguments
  end

  defp rejected_calls(ir) do
    for %{role: "tool", blocks: blocks} <- ir.messages,
        %{type: "validation_result", call_id: id, reason_code: reason, status: "failed"} <- blocks,
        do: {id, reason}
  end

  defp provider(results) do
    agent = start_supervised!({Agent, fn -> {results, []} end}, id: make_ref())

    execution = %Execution{
      result_fn: fn ir ->
        Agent.get_and_update(agent, fn
          {[result | remaining], calls} -> {{:ok, result}, {remaining, calls ++ [ir]}}
          {[], calls} -> {{:error, :unexpected_extra_call}, {[], calls ++ [ir]}}
        end)
      end
    }

    {execution, fn -> Agent.get(agent, fn {_results, calls} -> calls end) end}
  end
end
