defmodule NovelApplication.B28AdoptionContractTest do
  use ExUnit.Case, async: false

  import Ecto.Query

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.AdoptionWorkflow
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.{ReadingProjectionRepo, Repo}
  alias NovelPersistence.Schemas.{Chapter, Draft, Scene, Volume}

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  defp artifact(attrs) do
    Map.merge(
      %{
        artifact_id: "as-b28-#{System.unique_integer([:positive])}",
        artifact_type: "prose_fragment",
        summary: "第01章：开端",
        payload: %{"modification_scope" => "whole_chapter"}
      },
      attrs
    )
  end

  test "replace_scope 缺 target_chapter_ref → target_missing（不回退 title/新建章）" do
    art = artifact(%{payload: %{adoption_effect: %{mode: "replace_scope"}}})

    assert {:error, :target_missing} = AdoptionWorkflow.validate_b28_contract(art)
  end

  test "new_chapter 显式 effect 允许无 ref；format_only 归一化等价通过、差异拒绝、无源拒绝" do
    new_chapter = artifact(%{payload: %{adoption_effect: %{mode: "new_chapter"}}})
    assert :ok = AdoptionWorkflow.validate_b28_contract(new_chapter)

    base = "第一段。\r\n第二段  \r\n\r\n"
    equal = "第一段。\n第二段\n"

    ok_art =
      artifact(%{
        payload: %{
          "content" => equal,
          "modification_scope" => "format_only",
          "base_text" => base
        }
      })

    assert :ok = AdoptionWorkflow.validate_b28_contract(ok_art)

    bad_art =
      artifact(%{
        payload: %{
          "content" => "第一段。\n第二段改字\n",
          "modification_scope" => "format_only",
          "base_text" => base
        }
      })

    assert {:error, {:format_only_violation, %{offset: _, line: _}}} =
             AdoptionWorkflow.validate_b28_contract(bad_art)

    no_source =
      artifact(%{payload: %{"content" => equal, "modification_scope" => "format_only"}})

    assert {:error, :format_only_source_unavailable} =
             AdoptionWorkflow.validate_b28_contract(no_source)
  end

  test "chapter_revision_context：阅读投影顺序 covered refs/versions/覆盖账；标题歧义拒绝" do
    work_id = Ecto.UUID.generate()
    volume = Repo.insert!(%Volume{work_id: work_id, title: "第一卷", seq: 1})

    chapter =
      Repo.insert!(%Chapter{work_id: work_id, volume_id: volume.id, title: "第01章：开端", seq: 1})

    s1 = Repo.insert!(%Scene{work_id: work_id, chapter_id: chapter.id, title: "场景 1", seq: 1})
    s2 = Repo.insert!(%Scene{work_id: work_id, chapter_id: chapter.id, title: "场景 2", seq: 2})

    d1 =
      Repo.insert!(%Draft{
        work_id: work_id,
        scene_id: s1.id,
        content: "初稿",
        status: AdoptionStatus.accepted(),
        revision: 2
      })

    d2 =
      Repo.insert!(%Draft{
        work_id: work_id,
        scene_id: s2.id,
        content: "续写",
        status: AdoptionStatus.accepted(),
        revision: 1
      })

    assert {:ok, ctx} =
             AdoptionWorkflow.chapter_revision_context(work_id, "chapter:#{chapter.id}")

    assert ctx.target_chapter_ref == "chapter:#{chapter.id}"
    assert ctx.covered_refs == ["draft:#{d1.id}", "draft:#{d2.id}"]

    assert ctx.expected_base_versions == [
             %{ref: "draft:#{d1.id}", version: 2},
             %{ref: "draft:#{d2.id}", version: 1}
           ]

    assert ctx.coverage == :complete
    assert Enum.all?(ctx.materials, &(&1.kind == :draft and &1.complete? == true))
    assert Enum.map(ctx.materials, & &1.text) == ["初稿", "续写"]
    assert ctx.base_text == "初稿\n\n续写"
    # 与 ReadingProjectionRepo.accepted_chapter_prose/2 的阅读投影全文一致
    assert ctx.base_text ==
             ReadingProjectionRepo.accepted_chapter_prose(work_id, "chapter:#{chapter.id}")

    # 同标题两章 → 标题寻址歧义拒绝（不再猜）
    _ch2 =
      Repo.insert!(%Chapter{work_id: work_id, volume_id: volume.id, title: "第01章：开端", seq: 2})

    assert {:error, :target_ambiguous} =
             AdoptionWorkflow.chapter_revision_context(work_id, "第01章：开端")
  end

  test "chapter_revision_targets：多章/同名章 ref 唯一、按 seq 排序、只含有 accepted 的章" do
    work_id = Ecto.UUID.generate()
    volume = Repo.insert!(%Volume{work_id: work_id, title: "第一卷", seq: 1})

    setup_chapter = fn seq, title, contents ->
      chapter =
        Repo.insert!(%Chapter{work_id: work_id, volume_id: volume.id, title: title, seq: seq})

      rows =
        contents
        |> Enum.with_index(1)
        |> Enum.map(fn {content, scene_seq} ->
          scene =
            Repo.insert!(%Scene{
              work_id: work_id,
              chapter_id: chapter.id,
              title: "场景 #{scene_seq}",
              seq: scene_seq
            })

          case content do
            nil ->
              scene

            text ->
              Repo.insert!(%Draft{
                work_id: work_id,
                scene_id: scene.id,
                content: text,
                status: AdoptionStatus.accepted(),
                revision: 1
              })
          end
        end)

      _ = rows
      chapter
    end

    ch1 = setup_chapter.(1, "第01章：同名", ["初稿", "续写"])
    ch2 = setup_chapter.(2, "第01章：同名", ["另一章正文"])
    ch3 = setup_chapter.(3, "第03章：部分", ["有稿", nil])
    _ch4 = setup_chapter.(4, "第04章：无稿", [nil, nil])

    assert {:ok, targets} = AdoptionWorkflow.chapter_revision_targets(work_id)
    assert Enum.map(targets, & &1.seq) == [1, 2, 3]

    assert [
             %{
               chapter_ref: ref1,
               chapter_title: "第01章：同名",
               fragment_count: 2,
               char_count: 4,
               coverage: :complete
             },
             %{
               chapter_ref: ref2,
               chapter_title: "第01章：同名",
               fragment_count: 1,
               coverage: :complete
             },
             %{chapter_ref: ref3, coverage: :partial}
           ] = targets

    assert ref1 == "chapter:#{ch1.id}"
    assert ref2 == "chapter:#{ch2.id}"
    assert ref1 != ref2
    assert ref3 == "chapter:#{ch3.id}"
    # 只读：调用前后无新行
    assert Repo.aggregate(from(ch in Chapter, where: ch.work_id == ^work_id), :count) == 4
    assert Repo.aggregate(from(d in Draft, where: d.work_id == ^work_id), :count) == 4
    assert {:ok, _} = AdoptionWorkflow.chapter_revision_context(work_id, ref2)
  end

  test "handle_adopt 透传 replace_scope 结果到 action_result（additive）" do
    source_turn = %{
      turn_id: "turn-source",
      work_id: "work-1",
      adoption_state: %{
        pending: [
          %{
            artifact_id: "as-1",
            artifact_type: :prose_fragment,
            adoption_status: "TENTATIVE",
            requires_adoption: true,
            payload: %{content: "候选正文"}
          }
        ],
        resolved: []
      },
      trace_summary: %{trace_ref: "trace-source"}
    }

    writer = fn _attrs ->
      {:ok,
       %{
         mutation_id: "mutation-1",
         mutation_status: "APPLIED",
         source_revision_ref: "mutation:mutation-1",
         adoption_effect: %{
           mode: "replace_scope",
           covered: ["draft:a"],
           expected_base_versions: [],
           coverage: "complete"
         },
         superseded_draft_refs: ["draft:a:1", "draft:b:1"],
         reading_projection: nil
       }}
    end

    assert {:ok, action_result, _turn_result} =
             AdoptionWorkflow.handle_adopt(
               source_turn,
               %{"artifact_id" => "as-1", "work_id" => "work-1"},
               writer
             )

    assert action_result.adoption_effect.mode == "replace_scope"
    assert action_result.superseded_draft_refs == ["draft:a:1", "draft:b:1"]
    assert action_result.persistence.mutation_id == "mutation-1"
  end

  test "R05 structured prose adoption forwards the original item bindings and body bytes" do
    source = scoped_source()
    [original] = source.adoption_state.pending
    expected_items = original.payload.items

    writer = fn attrs ->
      assert attrs.items == expected_items
      refute Map.has_key?(attrs, :content)
      assert attrs.target_segment_ids == original.payload.scope["target_segment_ids"]
      assert attrs.expected_segment_hashes == original.payload.scope["expected_segment_hashes"]
      assert attrs.adoption_effect == original.payload.adoption_effect
      {:ok, %{mutation_id: "region-mutation", persisted: true}}
    end

    assert {:ok, %{status: "accepted"}, _result} =
             AdoptionWorkflow.handle_adopt(
               source,
               %{"artifact_id" => original.artifact_id, "work_id" => source.work_id},
               writer
             )

    assert source.adoption_state.pending == [original]
  end

  test "R05 edited_items binds by original identity and preserves unchanged metadata and body bytes" do
    original_source = scoped_source()
    first_body = "  作者保留的开篇。\r\n\r\n另一自然段。 \n"
    last_body = "\t作者调整的结尾。🌧️\r\n"

    edits = [
      %{"item_id" => "region-last", "body" => last_body},
      %{"item_id" => "region-first", "body" => first_body}
    ]

    for source <- [original_source, Jason.decode!(Jason.encode!(original_source))] do
      expected = original_source.adoption_state.pending |> hd() |> Map.fetch!(:payload)

      writer = fn attrs ->
        assert Jason.decode!(Jason.encode!(attrs.items)) == [
                 %{
                   "item_id" => "region-first",
                   "title" => "开篇改写",
                   "body" => first_body,
                   "rationale" => "保留线索。",
                   "target_segment_ids" =>
                     expected.items |> hd() |> Map.fetch!(:target_segment_ids)
                 },
                 %{
                   "item_id" => "region-last",
                   "title" => "结尾改写",
                   "body" => last_body,
                   "rationale" => nil,
                   "target_segment_ids" =>
                     expected.items |> List.last() |> Map.fetch!(:target_segment_ids)
                 }
               ]

        assert attrs.adoption_effect == expected.adoption_effect
        assert attrs.base_version == 7
        assert attrs.expected_segment_hashes == expected.scope["expected_segment_hashes"]
        {:ok, %{mutation_id: "edited-region-mutation", persisted: true}}
      end

      assert {:ok, %{status: "accepted"}, result} =
               AdoptionWorkflow.handle_modify_draft(
                 source,
                 %{
                   "artifact_id" => "scoped-proposal",
                   "work_id" => "00000000-0000-0000-0000-000000000002",
                   "edited_items" => edits
                 },
                 writer
               )

      assert [%{adoption_status: "EDITED_ACCEPTED"}] = result.adoption_state.resolved
      assert Jason.decode!(Jason.encode!(source)) == Jason.decode!(Jason.encode!(original_source))
    end
  end

  test "R05 scoped edits reject missing, duplicated, foreign or forged item identities before writing" do
    source = scoped_source()
    first = %{"item_id" => "region-first", "body" => "新的开篇。"}
    last = %{"item_id" => "region-last", "body" => "新的结尾。"}
    writer = fn _ -> flunk("invalid scoped edit must not reach persistence") end

    invalid_edits = [
      [],
      [first],
      [first, first],
      [first, %{last | "item_id" => "another-candidate-item"}],
      [first, %{last | "body" => ""}],
      [first, %{last | "body" => " \r\n\t"}],
      [Map.put(first, "target_segment_ids", ["forged-target"]), last],
      [Map.put(first, "base_version", 99), last]
    ]

    for edits <- invalid_edits do
      assert {:error, _reason} =
               AdoptionWorkflow.handle_modify_draft(
                 source,
                 %{"artifact_id" => "scoped-proposal", "edited_items" => edits},
                 writer
               )
    end

    for fields <- [
          %{"edited_content" => "不能从平串重建原范围。"},
          %{"edited_items" => [first, last], "edited_content" => "第二个正文来源"}
        ] do
      assert {:error, _reason} =
               AdoptionWorkflow.handle_modify_draft(
                 source,
                 Map.put(fields, "artifact_id", "scoped-proposal"),
                 writer
               )
    end
  end

  test "R05 残缺或冲突的章级范围不能降级到普通保存或平串编辑" do
    source = scoped_source()
    [original] = source.adoption_state.pending
    payload = original.payload
    writer = fn _ -> flunk("残缺范围不得到达持久化 writer") end

    for invalid <- [
          Map.drop(payload, [:modification_scope, :adoption_effect]),
          Map.drop(payload, [:modification_scope, :adoption_effect])
          |> Map.put(:adoption_effect, %{"mode" => "append"}),
          put_in(payload, [:scope, "kind"], "whole_chapter"),
          Map.delete(payload, :modification_scope),
          Map.put(payload, :modification_scope, "format_only"),
          Map.drop(payload, [:modification_scope, :adoption_effect, :scope])
        ] do
      candidate = %{original | payload: invalid}
      changed = put_in(source, [:adoption_state, :pending], [candidate])
      assert {:error, _} = AdoptionWorkflow.validate_b28_contract(candidate)

      assert {:ok, %{status: "failed", persistence: %{persisted: false}}, failure} =
               AdoptionWorkflow.handle_adopt(
                 changed,
                 %{"artifact_id" => original.artifact_id},
                 writer
               )

      assert failure.status == "failed_recoverable"
      refute failure.truthfulness.production_write_performed
      refute failure.truthfulness.artifact_adopted

      for fields <- [
            %{"edited_content" => "不得脱离原范围。"},
            %{"edited_items" => Enum.map(payload.items, &Map.take(&1, [:item_id, :body]))}
          ] do
        assert {:error, _} =
                 AdoptionWorkflow.handle_modify_draft(
                   changed,
                   Map.put(fields, "artifact_id", original.artifact_id),
                   writer
                 )
      end
    end
  end

  test "R05 whole prose forwards original items without a second flat content authority" do
    source = scoped_source()
    [candidate] = source.adoption_state.pending

    items = [
      %{item_id: "whole-1", title: "第一部分", body: "  开篇。\r\n"},
      %{item_id: "whole-2", title: "第二部分", body: "\t结尾。 \n"}
    ]

    payload = %{candidate.payload | items: items, modification_scope: "whole_chapter"}
    payload = put_in(payload, [:scope, "kind"], "whole_chapter")

    effect =
      payload.adoption_effect |> Map.drop(["target_segment_ids", "expected_segment_hashes"])

    payload = %{payload | adoption_effect: Map.put(effect, "mode", "replace_scope")}
    source = put_in(source, [:adoption_state, :pending], [%{candidate | payload: payload}])

    writer = fn attrs ->
      assert attrs.items == items
      refute Map.has_key?(attrs, :content)
      {:ok, %{mutation_id: "whole-byte-mutation", persisted: true}}
    end

    assert {:ok, %{status: "accepted"}, _} =
             AdoptionWorkflow.handle_adopt(
               source,
               %{"artifact_id" => "scoped-proposal", "work_id" => source.work_id},
               writer
             )
  end

  test "不存在的 chapter ref / 非法 work 返回 :target_missing（不 crash）" do
    work_id = Ecto.UUID.generate()
    volume = Repo.insert!(%Volume{work_id: work_id, title: "第一卷", seq: 1})

    chapter =
      Repo.insert!(%Chapter{work_id: work_id, volume_id: volume.id, title: "第01章：开端", seq: 1})

    scene = Repo.insert!(%Scene{work_id: work_id, chapter_id: chapter.id, title: "场景 1", seq: 1})

    Repo.insert!(%Draft{
      work_id: work_id,
      scene_id: scene.id,
      content: "正文",
      status: AdoptionStatus.accepted(),
      revision: 1
    })

    assert {:error, :target_missing} =
             AdoptionWorkflow.chapter_revision_context(work_id, "chapter:#{Ecto.UUID.generate()}")

    assert {:error, :target_missing} =
             AdoptionWorkflow.chapter_revision_context("not-a-uuid", "chapter:#{chapter.id}")
  end

  test "chapter_revision_targets：replace_scope 后仅有 superseded 历史的 scene 仍算 complete" do
    work_id = Ecto.UUID.generate()
    volume = Repo.insert!(%Volume{work_id: work_id, title: "第一卷", seq: 1})

    chapter =
      Repo.insert!(%Chapter{
        work_id: work_id,
        volume_id: volume.id,
        title: "第01章：替代后",
        seq: 1
      })

    scene1 =
      Repo.insert!(%Scene{work_id: work_id, chapter_id: chapter.id, title: "场景 1", seq: 1})

    scene2 =
      Repo.insert!(%Scene{work_id: work_id, chapter_id: chapter.id, title: "场景 2", seq: 2})

    Repo.insert!(%Draft{
      work_id: work_id,
      scene_id: scene1.id,
      content: "整章替代稿正文。",
      status: AdoptionStatus.accepted(),
      revision: 1
    })

    # replace_scope 后：旧续写所在 scene 无 accepted，只剩 superseded 历史。
    Repo.insert!(%Draft{
      work_id: work_id,
      scene_id: scene2.id,
      content: "被替代的续写历史正文。",
      status: AdoptionStatus.superseded(),
      revision: 1
    })

    assert {:ok, [target]} = AdoptionWorkflow.chapter_revision_targets(work_id)
    assert target.chapter_ref == "chapter:#{chapter.id}"
    assert target.coverage == :complete
    assert target.fragment_count == 1
  end

  test "单候选 payload 不携带章级修订字段（当前采纳契约）" do
    # 非章级 world_setting 候选只携带自身的采纳语义。
    {:ok, artifact} =
      NovelApplication.ArtifactAssembler.assemble(
        %NovelCommon.Contracts.ToolResult{
          tool_result_id: "tr-single-artifact",
          tool_request_ref: "tq-single-artifact",
          tool_name: "world_building",
          status: :succeeded,
          output: %{
            artifact_type: "world_setting",
            item_count: 1,
            items: [%{item_id: "single-artifact-1", title: "独立设定", body: "书铺。", rationale: nil}]
          },
          artifact_refs: ["single-artifact-1"],
          state_delta: [],
          usage: %{},
          trace_refs: [],
          completed_at: DateTime.utc_now()
        },
        "turn-single-artifact"
      )

    frame = %NovelDomain.DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame-single-artifact",
      turn_id: "turn-single-artifact",
      workspace_id: "work-single-artifact",
      primary: true,
      frame_type: :execution_candidate,
      source_refs: %{author_input_ref: "turn-single-artifact"},
      dialogue_goal: %{summary: "生成候选"},
      tool_need: %{needs_tool: true, reason_code: :tool_needed},
      execution_readiness: :ready,
      author_visible_draft: %{message: "候选"},
      evidence_summary: %{},
      uncertainty: []
    }

    result = NovelApplication.TurnResultBuilder.build(frame, %{}, [], nil, nil, artifact)
    [pending] = result.adoption_state.pending

    refute Map.has_key?(pending.payload, "modification_scope")
    refute Map.has_key?(pending.payload, "adoption_effect")
    refute Map.has_key?(pending.payload, "base_text")
    assert :ok = AdoptionWorkflow.validate_b28_contract(pending)
  end

  defp scoped_source do
    segments = NovelPersistence.LocalizedRevision.segment("开篇。\r\n\r\n中间原文🌧️。\n\n结尾。\r\n")
    targets = [hd(segments), List.last(segments)]
    ids = Enum.map(targets, & &1.segment_id)
    hashes = Enum.map(targets, &%{"segment_id" => &1.segment_id, "sha256" => &1.sha256})
    chapter_ref = "chapter:00000000-0000-0000-0000-000000000001"

    payload = %{
      modification_scope: "target_segments",
      target_chapter_ref: chapter_ref,
      scope: %{
        "kind" => "target_segments",
        "target_segment_ids" => ids,
        "base_draft_ref" => "draft:region-base",
        "base_version" => 7,
        "expected_segment_hashes" => hashes
      },
      adoption_effect: %{
        "mode" => "replace_segments",
        "target_chapter_ref" => chapter_ref,
        "target_segment_ids" => ids,
        "covered" => ["draft:region-base"],
        "expected_base_versions" => [%{"ref" => "draft:region-base", "version" => 7}],
        "coverage" => "complete"
      },
      items: [
        %{
          item_id: "region-first",
          title: "开篇改写",
          body: "原开篇候选。\r\n",
          rationale: "保留线索。",
          target_segment_ids: [hd(ids)]
        },
        %{
          item_id: "region-last",
          title: "结尾改写",
          body: "原结尾候选。",
          rationale: nil,
          target_segment_ids: [List.last(ids)]
        }
      ]
    }

    %{
      turn_id: "turn-region-source",
      work_id: "00000000-0000-0000-0000-000000000002",
      adoption_state: %{
        pending: [
          artifact(%{
            artifact_id: "scoped-proposal",
            adoption_status: "TENTATIVE",
            requires_adoption: true,
            target_chapter_ref: chapter_ref,
            payload: payload
          })
        ],
        resolved: []
      },
      trace_summary: %{trace_ref: "trace-regions"}
    }
  end
end
