defmodule NovelApplication.B47CanonFreshnessAdoptionTest do
  use ExUnit.Case, async: false

  import Ecto.Query

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.AdoptionWorkflow
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.{AdoptionRepository, Repo}
  alias NovelPersistence.Schemas.{Chapter, Character, Draft, Scene, Volume, Work}

  @chapter_text "第一段：灯影里的人在等。\n\n第二段：旧钱摊在桌上。"

  # replace_scope 确定性分段校验要求候选段数不增加：以段内改写作为合法整章修订。
  @revised_chapter_text "第一段：灯影里的人在等。\n\n第二段：旧钱摊在桌上，账册有刮痕。"

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  # ── O1 章正文修订候选 ──────────────────────────────────────────

  describe "chapter prose freshness (O1)" do
    test "stale base：候选基线版本落后于持久 canon → fail_with_recovery、零写入、前后版本可解释" do
      ctx = seed_chapter()

      candidate =
        chapter_candidate(ctx,
          covered_versions: [{"draft:#{ctx.draft.id}", ctx.draft.revision - 1}],
          content: @chapter_text <> "\n\n第三段：新增的一句。"
        )

      before = chapter_rows(ctx)

      assert {:ok, action_result, turn_result} = adopt(ctx, candidate, real_canon_reader())

      assert action_result.status == "failed"
      assert action_result.decision.decision_type == :fail_with_recovery
      assert "stale_base_version" in action_result.decision.reason_codes
      assert "conflict_recovery_required" in action_result.decision.reason_codes

      # 前后版本回执（拒绝原因来自系统读取的持久 canon，不是候选自报）
      assert action_result.canon_freshness.status == :stale

      assert action_result.canon_freshness.expected.versions ==
               %{"draft:#{ctx.draft.id}" => ctx.draft.revision - 1}

      assert action_result.canon_freshness.current.versions ==
               %{"draft:#{ctx.draft.id}" => ctx.draft.revision}

      assert turn_result.status == "failed_recoverable"
      assert turn_result.trace_summary.canon_freshness.status == :stale
      assert turn_result.truthfulness.artifact_adopted == false
      assert turn_result.truthfulness.production_write_performed == false
      assert turn_result.assistant_message.text =~ "版本"
      assert chapter_rows(ctx) == before
    end

    test "conflict：持久 canon 多出候选未覆盖的 accepted 片段 → fail_with_recovery、零写入" do
      ctx = seed_chapter()
      extra = add_accepted_fragment(ctx, "第三段：并行写入的片段。")

      candidate =
        chapter_candidate(ctx,
          covered_versions: [{"draft:#{ctx.draft.id}", ctx.draft.revision}],
          content: @chapter_text <> "\n\n第三段：新增的一句。"
        )

      before = chapter_rows(ctx)

      assert {:ok, action_result, _turn_result} = adopt(ctx, candidate, real_canon_reader())

      assert action_result.status == "failed"
      assert action_result.decision.decision_type == :fail_with_recovery
      assert "canon_conflict_detected" in action_result.decision.reason_codes
      assert "incomplete_scope" in action_result.decision.reason_codes
      assert action_result.canon_freshness.status == :conflict

      assert Repo.get!(Draft, extra.id).status == AdoptionStatus.accepted()
      assert chapter_rows(ctx) == before
    end

    test "fresh：基线一致的 replace_scope 采纳成功，receipt 记录前/后版本" do
      ctx = seed_chapter()

      candidate =
        chapter_candidate(ctx,
          covered_versions: [{"draft:#{ctx.draft.id}", ctx.draft.revision}],
          content: @revised_chapter_text
        )

      assert {:ok, action_result, turn_result} =
               adopt(ctx, candidate, real_canon_reader(), &AdoptionRepository.persist/1)

      assert action_result.status == "accepted"
      assert action_result.decision.decision_type == :adopt_tentative
      assert action_result.canon_freshness.status == :fresh
      assert action_result.persistence.persisted == true

      # 前：被覆盖的旧 accepted draft 版本；后：新 accepted draft 版本。
      assert action_result.persistence.superseded_draft_refs ==
               ["draft:#{ctx.draft.id}:#{ctx.draft.revision}"]

      assert action_result.persistence.reading_projection.source_revision_ref =~ "draft:"

      assert Repo.get!(Draft, ctx.draft.id).status == AdoptionStatus.superseded()

      assert turn_result.status == "conversational"
      assert turn_result.truthfulness.artifact_adopted == true
      assert turn_result.truthfulness.production_write_performed == true

      assert Enum.count(accepted_drafts(ctx)) == 1
      assert Enum.any?(accepted_drafts(ctx), &String.contains?(&1.content, "账册有刮痕"))
    end

    test "重放同一候选/版本：当前 canon 已变 → stale 拒绝且不重复写入/不重复报 accepted" do
      ctx = seed_chapter()

      candidate =
        chapter_candidate(ctx,
          covered_versions: [{"draft:#{ctx.draft.id}", ctx.draft.revision}],
          content: @revised_chapter_text
        )

      assert {:ok, first_action, _first_turn} =
               adopt(ctx, candidate, real_canon_reader(), &AdoptionRepository.persist/1)

      assert first_action.status == "accepted"
      written = chapter_rows(ctx)
      accepted_after_first = accepted_drafts(ctx)

      assert {:ok, replay_action, replay_turn} =
               adopt(ctx, candidate, real_canon_reader(), &AdoptionRepository.persist/1)

      assert replay_action.status == "failed"
      assert replay_action.decision.decision_type == :fail_with_recovery
      assert "stale_base_version" in replay_action.decision.reason_codes
      assert replay_turn.status == "failed_recoverable"
      assert replay_turn.truthfulness.artifact_adopted == false

      # 零重复写：草稿行/状态与首次采纳后完全一致。
      assert chapter_rows(ctx) == written
      assert accepted_drafts(ctx) == accepted_after_first
    end

    test "TOCTOU：边界 gate 通过后事务内版本已变 → 持久层重 gate 拒绝、回滚零写入、拒绝原因可解释" do
      ctx = seed_chapter()
      draft = Repo.get!(Draft, ctx.draft.id)

      candidate =
        chapter_candidate(ctx,
          covered_versions: [{"draft:#{ctx.draft.id}", draft.revision}],
          content: @chapter_text <> "\n\n第三段：边界之后被并发改写。"
        )

      # 模拟「边界读取 canon 后、持久化事务开始前」的并行写入：读取快照后把 draft 版本推进。
      racing_reader = fn work_id, target ->
        {:ok, snapshot} = AdoptionRepository.canon_snapshot(work_id, target)

        draft
        |> Ecto.Changeset.change(%{content: "并发写入的新正文。", revision: draft.revision + 1})
        |> Repo.update!()

        {:ok, snapshot}
      end

      assert {:ok, action_result, turn_result} =
               adopt(ctx, candidate, racing_reader, &AdoptionRepository.persist/1)

      assert action_result.status == "failed"
      assert action_result.persistence.reason_code == "stale_base_version"
      assert action_result.persistence.persisted == false
      assert turn_result.status == "failed_recoverable"
      assert "stale_base_version" in turn_result.trace_summary.reason_codes
      assert turn_result.assistant_message.text =~ "版本"

      # 事务零写入：并发写入内容保留，没有被候选覆盖成新稿。
      assert Repo.get!(Draft, draft.id).content == "并发写入的新正文。"
      assert Enum.all?(accepted_drafts(ctx), &(&1.content != String.trim(candidate.content)))
    end

    test "无基线元数据的 legacy 候选不误判 stale（保持既有确认/采纳路径）" do
      ctx = seed_chapter()

      legacy =
        pending_artifact(%{
          artifact_id: "as-b47-legacy",
          artifact_type: :prose_fragment,
          target_chapter: ctx.chapter.title,
          target_chapter_ref: "chapter:#{ctx.chapter.id}",
          payload: %{
            title: "续写草稿",
            items: [%{item_id: "i1", title: "续写", body: "新的一段续写正文。"}]
          },
          authoring_intent: :continuation
        })

      assert {:ok, action_result, _turn_result} =
               adopt(ctx, legacy, real_canon_reader(), &AdoptionRepository.persist/1)

      assert action_result.status == "accepted"
      assert action_result.decision.decision_type == :adopt_tentative
    end
  end

  # ── O2 角色叙事身份修订候选 ────────────────────────────────────

  describe "character profile freshness (O2)" do
    test "conflict：持久 narrative_role 与候选 old 值矛盾 → fail_with_recovery、零写入" do
      ctx = seed_character("ENSEMBLE_POV")
      {:ok, fact} = character_fact(ctx)

      candidate =
        character_candidate(ctx, fact, old_role: "ENSEMBLE_POV", new_role: "PROTAGONIST")

      # 候选生成后，canon 被另一个采纳改成 ANTAGONIST。
      ctx.shen
      |> Character.changeset(%{narrative_role: "ANTAGONIST"})
      |> Repo.update!()

      assert {:ok, action_result, turn_result} =
               adopt(ctx, candidate, real_canon_reader(), flunk_writer())

      assert action_result.status == "failed"
      assert action_result.decision.decision_type == :fail_with_recovery
      assert "canon_conflict_detected" in action_result.decision.reason_codes
      assert "persisted_canon_differs" in action_result.decision.reason_codes
      assert action_result.canon_freshness.status == :conflict
      assert action_result.canon_freshness.current.value == "ANTAGONIST"
      assert turn_result.truthfulness.production_write_performed == false
      assert Repo.get!(Character, ctx.shen.id).narrative_role == "ANTAGONIST"
    end

    test "stale fingerprint：目标字段旧值未变但对象 fingerprint 已变化 → fail_with_recovery、零写入" do
      ctx = seed_character("ENSEMBLE_POV")
      {:ok, fact} = character_fact(ctx)

      candidate =
        character_candidate(ctx, fact, old_role: "ENSEMBLE_POV", new_role: "PROTAGONIST")

      # 对象在别处被更新（例如 summary 修订）：fingerprint 变化，narrative_role 仍为旧值。
      ctx.shen
      |> Character.changeset(%{summary: "更新后的档案摘要"})
      |> Repo.update!()

      assert {:ok, action_result, _turn_result} =
               adopt(ctx, candidate, real_canon_reader(), flunk_writer())

      assert action_result.status == "failed"
      assert action_result.decision.decision_type == :fail_with_recovery
      assert "stale_base" in action_result.decision.reason_codes
      assert action_result.canon_freshness.expected.fingerprint == fact.base_fingerprint

      refute action_result.canon_freshness.expected.fingerprint ==
               action_result.canon_freshness.current.fingerprint

      assert Repo.get!(Character, ctx.shen.id).narrative_role == "ENSEMBLE_POV"
    end

    test "fresh：fingerprint/旧值一致时采纳成功，receipt 记录前后 fingerprint 与 old→new" do
      ctx = seed_character("ENSEMBLE_POV")
      {:ok, fact} = character_fact(ctx)

      candidate =
        character_candidate(ctx, fact, old_role: "ENSEMBLE_POV", new_role: "PROTAGONIST")

      assert {:ok, action_result, turn_result} =
               adopt(ctx, candidate, real_canon_reader(), flunk_writer())

      assert action_result.status == "accepted"
      assert action_result.decision.decision_type == :adopt_tentative
      assert action_result.canon_freshness.status == :fresh
      assert action_result.base_fingerprint == fact.base_fingerprint
      assert action_result.current_fingerprint != fact.base_fingerprint

      assert [%{field: "narrative_role", old: "ENSEMBLE_POV", new: "PROTAGONIST"}] =
               action_result.committed_changes

      assert Repo.get!(Character, ctx.shen.id).narrative_role == "PROTAGONIST"
      assert turn_result.truthfulness.production_write_performed == true
    end

    test "未授权字段变更：决策前契约拒绝、零写入" do
      ctx = seed_character("ENSEMBLE_POV")
      {:ok, fact} = character_fact(ctx)

      candidate =
        character_candidate(ctx, fact,
          old_role: "ENSEMBLE_POV",
          new_role: "PROTAGONIST",
          change_field: "role"
        )

      assert {:ok, action_result, _turn_result} =
               adopt(ctx, candidate, real_canon_reader(), flunk_writer())

      assert action_result.status == "failed"
      assert action_result.decision.decision_type == :fail_with_recovery
      assert "unsupported_field" in action_result.decision.reason_codes
      assert Repo.get!(Character, ctx.shen.id).narrative_role == "ENSEMBLE_POV"
      assert Repo.get!(Character, ctx.shen.id).role == "灯楼查账人"
    end

    test "目标角色不存在：读端口 stale/missing 零写入，不猜测" do
      ctx = seed_character("ENSEMBLE_POV")
      {:ok, fact} = character_fact(ctx)

      candidate =
        character_candidate(ctx, fact,
          old_role: "ENSEMBLE_POV",
          new_role: "PROTAGONIST",
          character_ref: "character:#{Ecto.UUID.generate()}"
        )

      assert {:ok, action_result, _turn_result} =
               adopt(ctx, candidate, real_canon_reader(), flunk_writer())

      assert action_result.status == "failed"
      assert action_result.decision.decision_type == :fail_with_recovery
      assert "target_missing" in action_result.decision.reason_codes
    end
  end

  describe "canon read unavailable (fail closed)" do
    test "读端口不可用 → fail_with_recovery、零写入，不假装 fresh" do
      ctx = seed_character("ENSEMBLE_POV")
      {:ok, fact} = character_fact(ctx)

      candidate =
        character_candidate(ctx, fact, old_role: "ENSEMBLE_POV", new_role: "PROTAGONIST")

      unavailable = fn _work_id, _target -> {:error, :db_unavailable} end

      assert {:ok, action_result, _turn_result} =
               adopt(ctx, candidate, unavailable, flunk_writer())

      assert action_result.status == "failed"
      assert action_result.decision.decision_type == :fail_with_recovery
      assert "canon_freshness_unavailable" in action_result.decision.reason_codes
      assert Repo.get!(Character, ctx.shen.id).narrative_role == "ENSEMBLE_POV"
    end
  end

  # ── CP2：覆盖确认后重新 gate / 确认拒绝幂等 ─────────────────────

  describe "overwrite confirmation re-gate (CP2)" do
    test "确认前持久 canon 已变：确认时重新 gate 检测 stale → fail_with_recovery、零写入" do
      ctx = seed_chapter()

      candidate =
        chapter_candidate(ctx,
          covered_versions: [{"draft:#{ctx.draft.id}", ctx.draft.revision}],
          content: @revised_chapter_text
        )
        |> Map.put(:authoring_intent, :rewrite)

      overwrite_reader = fn _work_id, _identity -> true end

      assert {:ok, first_action, first_turn} =
               adopt(ctx, candidate, real_canon_reader(), nil, overwrite_reader: overwrite_reader)

      assert first_action.status == "needs_confirmation"
      assert first_action.decision.decision_type == :require_confirmation
      assert first_turn.status == "needs_confirmation"
      assert first_turn.truthfulness.production_write_performed == false

      # 确认期间 canon 被并发推进：候选基线过期。
      draft = Repo.get!(Draft, ctx.draft.id)

      draft
      |> Ecto.Changeset.change(%{revision: draft.revision + 1})
      |> Repo.update!()

      before = chapter_rows(ctx)

      assert {:ok, confirm_action, confirm_turn} =
               adopt(ctx, candidate, real_canon_reader(), &AdoptionRepository.persist/1,
                 overwrite_reader: overwrite_reader,
                 params: %{"confirmation_satisfied" => true}
               )

      assert confirm_action.status == "failed"
      assert confirm_action.decision.decision_type == :fail_with_recovery
      assert "stale_base_version" in confirm_action.decision.reason_codes
      assert confirm_action.canon_freshness.status == :stale
      assert confirm_turn.status == "failed_recoverable"
      assert confirm_turn.truthfulness.production_write_performed == false
      assert chapter_rows(ctx) == before
    end

    test "确认时 canon 未变：确认后仍重新 gate 并通过，旧稿退场、行为落定" do
      ctx = seed_chapter()

      candidate =
        chapter_candidate(ctx,
          covered_versions: [{"draft:#{ctx.draft.id}", ctx.draft.revision}],
          content: @revised_chapter_text
        )
        |> Map.put(:authoring_intent, :rewrite)

      overwrite_reader = fn _work_id, _identity -> true end

      assert {:ok, first_action, _first_turn} =
               adopt(ctx, candidate, real_canon_reader(), nil, overwrite_reader: overwrite_reader)

      assert first_action.status == "needs_confirmation"

      assert {:ok, confirm_action, confirm_turn} =
               adopt(ctx, candidate, real_canon_reader(), &AdoptionRepository.persist/1,
                 overwrite_reader: overwrite_reader,
                 params: %{"confirmation_satisfied" => true}
               )

      assert confirm_action.status == "accepted"
      assert confirm_action.decision.decision_type == :adopt_tentative
      assert confirm_action.canon_freshness.status == :fresh
      assert Repo.get!(Draft, ctx.draft.id).status == AdoptionStatus.superseded()
      assert confirm_turn.status == "conversational"
      assert confirm_turn.truthfulness.production_write_performed == true
    end

    test "拒绝确认幂等：重复 reject 都只关闭确认，不写作品事实" do
      ctx = seed_chapter()
      before = chapter_rows(ctx)

      candidate =
        chapter_candidate(ctx,
          covered_versions: [{"draft:#{ctx.draft.id}", ctx.draft.revision}],
          content: @revised_chapter_text
        )

      source_turn = chapter_source_turn(ctx, [candidate])

      params = %{
        "artifact_id" => "as-b47-chapter",
        "action_id" => "reject:as-b47-chapter",
        "action_type" => "reject_or_cancel_confirmation"
      }

      assert {:ok, first, _turn} =
               AdoptionWorkflow.handle_confirmation_reject(source_turn, params)

      assert {:ok, replay, _replay_turn} =
               AdoptionWorkflow.handle_confirmation_reject(source_turn, params)

      assert first.status == "cancelled"
      assert replay.status == "cancelled"
      assert chapter_rows(ctx) == before
    end
  end

  # ── helpers ────────────────────────────────────────────────────

  defp adopt(ctx, artifact, canon_reader, writer \\ nil, opts \\ []) do
    source_turn = %{
      turn_id: "turn-b47",
      work_id: ctx.work.id,
      adoption_state: %{pending: [artifact], resolved: []},
      trace_summary: %{trace_ref: "trace-b47"}
    }

    params =
      %{"artifact_id" => artifact.artifact_id}
      |> Map.merge(Keyword.get(opts, :params, %{}))

    AdoptionWorkflow.handle_adopt(
      source_turn,
      params,
      writer,
      Keyword.get(opts, :overwrite_reader),
      Keyword.get(opts, :summary_maintainer),
      nil,
      canon_reader
    )
  end

  defp real_canon_reader, do: &AdoptionRepository.canon_snapshot/2

  defp flunk_writer,
    do: fn _attrs -> raise "writer must not be called for freshness rejection" end

  defp seed_chapter do
    work = Repo.insert!(%Work{title: "B47 章正文"})
    volume = Repo.insert!(%Volume{work_id: work.id, title: "第一卷", seq: 1})

    chapter =
      Repo.insert!(%Chapter{work_id: work.id, volume_id: volume.id, title: "第01章", seq: 1})

    scene = Repo.insert!(%Scene{work_id: work.id, chapter_id: chapter.id, title: "场景 1", seq: 1})

    draft =
      Repo.insert!(%Draft{
        work_id: work.id,
        scene_id: scene.id,
        content: @chapter_text,
        status: AdoptionStatus.accepted(),
        revision: 5
      })

    %{work: work, volume: volume, chapter: chapter, scene: scene, draft: draft}
  end

  defp add_accepted_fragment(ctx, text) do
    scene =
      Repo.insert!(%Scene{
        work_id: ctx.work.id,
        chapter_id: ctx.chapter.id,
        title: "场景 2",
        seq: 2
      })

    Repo.insert!(%Draft{
      work_id: ctx.work.id,
      scene_id: scene.id,
      content: text,
      status: AdoptionStatus.accepted(),
      revision: 3
    })
  end

  defp chapter_candidate(ctx, opts) do
    content = Keyword.fetch!(opts, :content)
    covered = Keyword.fetch!(opts, :covered_versions)
    refs = Enum.map(covered, fn {ref, _version} -> ref end)

    payload = %{
      title: "第01章正文修订稿",
      target_chapter_ref: "chapter:#{ctx.chapter.id}",
      modification_scope: "whole_chapter",
      scope: %{
        "kind" => "whole_chapter",
        "target_chapter_ref" => "chapter:#{ctx.chapter.id}",
        "covered_refs" => refs
      },
      adoption_effect: %{
        "mode" => "replace_scope",
        "covered" => Enum.map(covered, fn {ref, version} -> "#{ref}:#{version}" end),
        "expected_base_versions" =>
          Enum.map(covered, fn {ref, version} -> %{"ref" => ref, "version" => version} end),
        "coverage" => "complete"
      }
    }

    pending_artifact(%{
      artifact_id: "as-b47-chapter",
      artifact_type: :prose_fragment,
      target_chapter: ctx.chapter.title,
      target_chapter_ref: "chapter:#{ctx.chapter.id}",
      payload: Map.put(payload, :items, [%{item_id: "i1", title: "修订", body: content}]),
      content: content
    })
  end

  defp seed_character(role) do
    work = Repo.insert!(%Work{title: "B47 角色"})

    shen =
      Repo.insert!(%Character{
        work_id: work.id,
        name: "沈砚",
        aliases: ["老沈"],
        role: "灯楼查账人",
        narrative_role: role,
        status: AdoptionStatus.accepted()
      })

    %{work: work, shen: shen}
  end

  defp character_fact(ctx) do
    AdoptionRepository.character_profile_context(ctx.work.id, "character:#{ctx.shen.id}")
  end

  defp character_candidate(ctx, fact, opts) do
    character_ref = Keyword.get(opts, :character_ref, "character:#{ctx.shen.id}")

    payload = %{
      object_kind: "character_profile_revision",
      character_ref: character_ref,
      character_name: "沈砚",
      base_fingerprint: fact.base_fingerprint,
      changes: [
        %{
          field: Keyword.get(opts, :change_field, "narrative_role"),
          old: Keyword.fetch!(opts, :old_role),
          new: Keyword.fetch!(opts, :new_role)
        }
      ],
      effects: ["character_field_update"],
      other_character_changes: [],
      adoption_effect: %{mode: "character_field_update", character_ref: character_ref}
    }

    pending_artifact(%{
      artifact_id: "as-b47-character",
      artifact_type: :character_profile_revision,
      payload: payload
    })
  end

  defp chapter_source_turn(ctx, pending) do
    %{
      turn_id: "turn-b47",
      work_id: ctx.work.id,
      adoption_state: %{pending: pending, resolved: []},
      trace_summary: %{trace_ref: "trace-b47"}
    }
  end

  defp pending_artifact(attrs) do
    Map.merge(
      %{
        artifact_id: "as-b47",
        requires_adoption: true,
        adoption_status: "TENTATIVE",
        source_tool_result_ref: "tr-b47"
      },
      attrs
    )
  end

  defp chapter_rows(ctx) do
    Draft
    |> where([d], d.work_id == ^ctx.work.id)
    |> order_by([d], asc: d.inserted_at, asc: d.id)
    |> Repo.all()
    |> Enum.map(&{&1.id, &1.status, &1.revision, &1.content})
  end

  defp accepted_drafts(ctx) do
    Draft
    |> where(
      [d],
      d.work_id == ^ctx.work.id and
        d.status in ^[AdoptionStatus.accepted(), AdoptionStatus.edited_accepted()]
    )
    |> order_by([d], asc: d.inserted_at, asc: d.id)
    |> Repo.all()
  end
end
