# B47 CP3 场景种子：对象级 canon freshness（stale / conflict / fresh 对照）
#
# 事实布置（三作品，均为**真实持久 canon**，不靠候选自报）：
#   - stale   「B47 Canon Freshness · 过期基线」：第 01 章先接纳旧基线正文（draft:<d1>:1），
#     再原位重写为当前 canon（draft:<d2>:2）；恢复一条**旧基线修订候选**（declared
#     covered 指向已 superseded 的 draft:<d1>:1）。真实 UI 点击采纳 → 产品应从当前
#     持久 canon 检出 stale，返回 fail_with_recovery 且零写入。
#   - conflict「B47 Canon Freshness · 片段冲突」：第 01 章有**两段** accepted 正文
#     （scene1/scene2），恢复的候选只覆盖 scene1 的基线（covered_refs 只含 scene1 draft）。
#     真实 UI 点击采纳 → 产品应检出「当前 canon 多出未覆盖片段」冲突（canon_conflict +
#     incomplete_scope），零写入。
#   - fresh   「B47 Canon Freshness · 新鲜基线」：第 01 章两段 accepted 正文，恢复的候选
#     covered/expected_base_versions 与当前 canon 完全一致。真实 UI 点击采纳 → 正常写入：
#     旧两稿 SUPERSEDED、新整章稿 ACCEPTED，receipt 记录前后版本。
#
# 候选/待办使用产品同形数据：TurnResult.adoption_state.pending（可采纳 artifact，
# payload 带 B28 replace_scope 的 covered/expected_base_versions/target_chapter_ref）
# + available_actions accept/discard + ui_cards candidate_set；由 MemoryLog 持久化后
# 真实工作台恢复会话时出现「待采纳候选卡 + 采纳按钮」。前端对 prose_fragment 的可见
# 采纳按钮文案为 copy.ts `acceptProseLabel`「保存为章节正文」（与「保存到作品」同属
# 采纳入口；driver 应按 artifact 类型匹配，参考既有 p1 driver 的正则）。
#
# 用法：
#   MIX_ENV=test mix run scripts/seed_b47_canon_freshness.exs
#   MIX_ENV=test mix run scripts/seed_b47_canon_freshness.exs -- --check
#
# 输出：ARTIFACT_DIR/seed.log 可解析行：
#   [b47-canon-freshness-seed] work=<json>     # 每作品一行，字段见 §11 交接清单
#   [b47-canon-freshness-seed] db=<json>       # 数据库路径/全局 baseline 计数
#   [b47-canon-freshness-seed] seed=<json>     # 汇总（works 数组 + self_check）
# 全部由外部验收 driver/verifier 消费，不进入产品代码路径。

defmodule B47CanonFreshnessSeed do
  @moduledoc false

  import Ecto.Query

  alias NovelApplication.{WorkService, WorkSessionService}
  alias NovelDomain.{CanonFreshness, ProseWordCount}
  alias NovelPersistence.{AdoptionRepository, MemoryLog, ReadingProjectionRepo, Repo}
  alias NovelPersistence.Schemas.{Draft, Mutation}

  @tag "[b47-canon-freshness-seed]"
  @chapter_title "第01章：旧账与灯焰"

  @work_titles %{
    stale: "B47 Canon Freshness · 过期基线",
    conflict: "B47 Canon Freshness · 片段冲突",
    fresh: "B47 Canon Freshness · 新鲜基线"
  }

  @chapter_plan """
  第01章：旧账与灯焰: 沈砚在雨港旧书铺打烊前听见井底传来第七次灯焰爆响，决定当夜核对旧账。
  章功能定位：推进章
  情节推进：沈砚沿旧账查到井底灯焰与失踪账页的关联
  人物变化：从旁观者转为主动核对旧账的人
  信息释放：灯焰按夜计数，旧账缺页与点灯人有关
  伏笔动作：埋下第七盏灯与点灯人禁忌
  情绪定位：潮湿、压抑
  章首拉力：灯焰爆响的倒计时
  章尾断章：井口浮起一枚不属于任何人的灯芯
  字数与场次：约1200字，两场（对账/下井）
  """

  # stale：旧基线正文（draft:<d1>:1，之后被原位重写为 draft:<d2>:2）
  @stale_old_text "旧基线：沈砚在灯楼对账，听见井底传来第七次灯焰爆响。"
  # stale：当前 canon 正文
  @stale_current_text "当前基线：沈砚在灯楼对账，听见井底传来第八次灯焰爆响，决定当夜下井。"
  # stale：旧基线候选正文（基于 draft:<d1>:1 生成时的整章候选）
  @stale_candidate_text "候选修订：沈砚在灯楼对账，听见井底传来第七次灯焰爆响，决定先合上账页。"

  @fragment_one "片段一：沈砚在灯楼对账，账页缺了三页。"
  @fragment_two "片段二：井底灯焰转蓝，点灯人没有回头。"
  @conflict_candidate_text "片段一修订：沈砚在灯楼对账，账页缺了四页。"
  @fresh_candidate_text "片段一修订：沈砚在灯楼对账，账页缺了四页。\n\n片段二修订：井底灯焰转蓝，点灯人仍未回头。"

  def run(argv \\ []) do
    if "--check" in argv do
      check()
    else
      seed()
    end
  end

  # ── seed ─────────────────────────────────────────────────────

  defp seed() do
    results = [
      seed_stale(),
      seed_conflict(),
      seed_fresh()
    ]

    Enum.each(results, fn result ->
      IO.puts("#{@tag} work=#{Jason.encode!(result)}")
    end)

    db = db_baseline()

    IO.puts(
      "#{@tag} db=#{Jason.encode!(db)}"
    )

    summary = %{
      seed_version: "b47-canon-freshness/v1",
      seeded_at: DateTime.utc_now() |> DateTime.to_iso8601(),
      works: results,
      db: db,
      self_check: Enum.all?(results, &(&1.self_check_ok == true))
    }

    IO.puts("#{@tag} seed=#{Jason.encode!(summary)}")

    if summary.self_check do
      IO.puts(
        "#{@tag} ok works=#{length(results)} stale=#{Enum.at(results, 0).work_id} " <>
          "conflict=#{Enum.at(results, 1).work_id} fresh=#{Enum.at(results, 2).work_id}"
      )
    else
      raise "B47 seed self-check failed; see emitted work lines for expected/current versions"
    end
  end

  defp seed_stale() do
    context = create_work(:stale)

    # 旧基线正文 → 产品 B28 replace_scope 原位重写为当前 canon（draft:<d1>:1 → draft:<d2>:2）。
    first = append_prose(context, @stale_old_text)
    second = replace_scope_prose(context, [first], @stale_current_text)

    declared_versions = %{draft_id_ref(first.draft_id) => first.revision}
    context = Map.merge(context, %{chapter: first.chapter, drafts: [first, second]})

    seed_candidate(context, :stale,
      declared_versions: declared_versions,
      declared_order: [{draft_id_ref(first.draft_id), first.revision}],
      candidate_text: @stale_candidate_text,
      expected_status: :stale,
      expected_reason_codes: ["stale_base_version", "candidate_base_outdated"],
      expected_decision: "fail_with_recovery",
      note:
        "declared baseline is the superseded draft ref (old canon); current canon is the " <>
          "rewritten #{draft_id_ref(second.draft_id)}:#{second.revision}"
    )
  end

  defp seed_conflict() do
    context = create_work(:conflict)

    first = append_prose(context, @fragment_one)
    second = append_prose(context, @fragment_two)

    declared_versions = %{draft_id_ref(first.draft_id) => first.revision}
    context = Map.merge(context, %{chapter: first.chapter, drafts: [first, second]})

    seed_candidate(context, :conflict,
      declared_versions: declared_versions,
      declared_order: [{draft_id_ref(first.draft_id), first.revision}],
      candidate_text: @conflict_candidate_text,
      expected_status: :conflict,
      expected_reason_codes: ["canon_conflict_detected", "incomplete_scope"],
      expected_decision: "fail_with_recovery",
      note:
        "declared baseline covers only scene1 draft; current canon also has scene2 accepted draft " <>
          "#{draft_id_ref(second.draft_id)}:#{second.revision}"
    )
  end

  defp seed_fresh() do
    context = create_work(:fresh)

    first = append_prose(context, @fragment_one)
    second = append_prose(context, @fragment_two)

    declared_versions = %{
      draft_id_ref(first.draft_id) => first.revision,
      draft_id_ref(second.draft_id) => second.revision
    }

    context = Map.merge(context, %{chapter: first.chapter, drafts: [first, second]})

    seed_candidate(context, :fresh,
      declared_versions: declared_versions,
      declared_order: [
        {draft_id_ref(first.draft_id), first.revision},
        {draft_id_ref(second.draft_id), second.revision}
      ],
      candidate_text: @fresh_candidate_text,
      expected_status: :fresh,
      expected_reason_codes: [],
      expected_decision: "adopt_tentative",
      note: "declared baseline equals current canon; adoption should replace both fragments"
    )
  end

  # ── work / canon 构造（公开 application/persistence 写入口）────

  defp create_work(scenario) do
    title = Map.fetch!(@work_titles, scenario)

    {:ok, work} =
      WorkService.create(%{
        "title" => title,
        "genre" => "雨港悬疑",
        "core_selling_point" => "持久 canon 版本变化后旧候选不得静默覆盖",
        "premise" => "沈砚沿井底灯焰旧账追查失踪账页",
        "theme" => "旧账与无法回头的选择",
        "main_goal" => "核对井底灯焰旧账",
        "target_reader" => "关注悬疑与制度压迫的读者",
        "tone_preference" => "潮湿、克制"
      })

    {:ok, snapshot} = WorkSessionService.resume(work.id)

    {:ok, _plan} =
      AdoptionRepository.persist(%{
        actor_ref: "author",
        work_id: work.id,
        source_turn_ref: "turn_b47_seed_plan_#{scenario}",
        artifact_id: "as_b47_seed_plan_#{scenario}",
        artifact_type: :outline_draft,
        base_revision: 1,
        content: @chapter_plan,
        summary: "B47 单章计划"
      })

    chapter =
      Repo.one!(
        from(c in NovelPersistence.Schemas.Chapter,
          where: c.work_id == ^work.id,
          order_by: [asc: c.seq],
          limit: 1
        )
      )

    %{
      scenario: scenario,
      work: work,
      work_id: work.id,
      work_title: title,
      session_id: snapshot.active_session.id,
      chapter: chapter
    }
  end

  # 第一段 accepted 正文：append（产品首次采纳路径），返回当前该章唯一的 accepted 片段。
  defp append_prose(context, text) do
    {:ok, persisted} =
      AdoptionRepository.persist(%{
        actor_ref: "author",
        work_id: context.work_id,
        source_turn_ref: "turn_b47_seed_prose_#{context.scenario}_#{System.unique_integer([:positive])}",
        artifact_id: "as_b47_seed_prose_#{context.scenario}_#{System.unique_integer([:positive])}",
        artifact_type: :prose_fragment,
        content: text,
        summary: @chapter_title,
        target_chapter_ref: "chapter:#{context.chapter.id}",
        mode: :append
      })

    draft = fetch_draft!(persisted.reading_projection.draft_id)

    %{
      chapter: context.chapter,
      draft_id: draft.id,
      revision: draft.revision,
      content: draft.content,
      status: draft.status
    }
  end

  # 原位重写：产品 B28 replace_scope 采纳路径（旧 covered 稿 SUPERSEDED，
  # 新整章稿 accepted revision+1）。用于构造「旧基线仍被候选声明、当前 canon 已前进」。
  defp replace_scope_prose(context, covered_rows, text) do
    covered =
      Enum.map(covered_rows, fn row -> "#{draft_id_ref(row.draft_id)}:#{row.revision}" end)

    expected =
      Enum.map(covered_rows, fn row ->
        %{"ref" => draft_id_ref(row.draft_id), "version" => row.revision}
      end)

    {:ok, persisted} =
      AdoptionRepository.persist(%{
        actor_ref: "author",
        work_id: context.work_id,
        source_turn_ref: "turn_b47_seed_rewrite_#{context.scenario}",
        artifact_id: "as_b47_seed_rewrite_#{context.scenario}",
        artifact_type: :prose_fragment,
        content: text,
        summary: @chapter_title,
        target_chapter_ref: "chapter:#{context.chapter.id}",
        modification_scope: "whole_chapter",
        adoption_effect: %{
          "mode" => "replace_scope",
          "covered" => covered,
          "expected_base_versions" => expected,
          "coverage" => "complete"
        }
      })

    draft = fetch_draft!(persisted.reading_projection.draft_id)

    %{
      chapter: context.chapter,
      draft_id: draft.id,
      revision: draft.revision,
      content: draft.content,
      status: draft.status
    }
  end

  defp fetch_draft!(draft_id), do: Repo.get!(Draft, draft_id)

  # ── 恢复的待采纳候选（产品同形 TurnResult）────────────────────

  defp seed_candidate(context, scenario, opts) do
    chapter = context.chapter
    chapter_ref = "chapter:#{chapter.id}"
    declared_versions = Keyword.fetch!(opts, :declared_versions)
    declared_order = Keyword.get(opts, :declared_order, Enum.to_list(declared_versions))
    candidate_text = Keyword.fetch!(opts, :candidate_text)

    {:ok, canon} = AdoptionRepository.canon_snapshot(context.work_id, {:chapter_prose, chapter_ref})

    declared = %{ref: chapter_ref, versions: declared_versions, digest: nil}
    verdict = CanonFreshness.assess(:chapter_prose, declared, canon)

    expected_status = Keyword.fetch!(opts, :expected_status)
    expected_reason_codes = Keyword.fetch!(opts, :expected_reason_codes)

    unless verdict.status == expected_status do
      raise "B47 seed #{scenario} canonical status mismatch: " <>
              "expected=#{expected_status} got=#{verdict.status} " <>
              "declared=#{inspect(declared_versions)} current=#{inspect(canon.versions)}"
    end

    unless Enum.all?(expected_reason_codes, &(&1 in verdict.reason_codes)) do
      raise "B47 seed #{scenario} reason codes mismatch: " <>
              "expected=#{inspect(expected_reason_codes)} got=#{inspect(verdict.reason_codes)}"
    end

    turn_id = "turn_b47_candidate_#{scenario}"
    artifact_id = "as_b47_candidate_#{scenario}"
    card_title = "#{chapter.title}（正文修订稿）"
    accepted_before = accepted_draft_rows(context.work_id)
    reading_text = ReadingProjectionRepo.accepted_chapter_prose(context.work_id, chapter_ref)

    item = %{
      item_id: "item_b47_#{scenario}",
      title: card_title,
      body: candidate_text,
      rationale: Keyword.fetch!(opts, :note)
    }

    covered_refs = Enum.map(declared_order, fn {ref, version} -> "#{ref}:#{version}" end)

    effect = %{
      "mode" => "replace_scope",
      "covered" => covered_refs,
      "expected_base_versions" =>
        Enum.map(declared_order, fn {ref, version} -> %{"ref" => ref, "version" => version} end),
      "coverage" => "complete"
    }

    payload = %{
      title: card_title,
      target_chapter_ref: chapter_ref,
      modification_scope: "whole_chapter",
      scope: %{
        "kind" => "whole_chapter",
        "target_chapter_ref" => chapter_ref,
        "covered_refs" => effect["covered"],
        "preserve_unmentioned_verbatim" => true
      },
      adoption_effect: effect,
      items: [item]
    }

    turn_result = build_turn_result(%{
      scenario: scenario,
      work_id: context.work_id,
      session_id: context.session_id,
      turn_id: turn_id,
      artifact_id: artifact_id,
      chapter: chapter,
      chapter_ref: chapter_ref,
      payload: payload,
      card_title: card_title,
      candidate_text: candidate_text,
      note: Keyword.fetch!(opts, :note)
    })

    record_turn!(context, turn_id, turn_result)

    # UI 可达性自检：恢复快照里必须出现该 pending artifact + 对应 turn_result。
    {:ok, snapshot} = WorkSessionService.resume(context.work_id)
    pending_ids = Enum.map(snapshot.pending_adoptions, &artifact_field(&1, :artifact_id))
    pending_turns = Enum.map(snapshot.pending_adoption_turn_results, &artifact_field(&1, :turn_id))

    unless artifact_id in pending_ids do
      raise "B47 seed #{scenario}: pending artifact #{artifact_id} not restored by session snapshot"
    end

    unless turn_id in pending_turns do
      raise "B47 seed #{scenario}: pending adoption turn_result #{turn_id} not restored"
    end

    work_mutation_count = work_mutation_count(context.work_id)

    base = %{
      scenario: Atom.to_string(scenario),
      work_id: context.work_id,
      work_title: context.work_title,
      session_id: context.session_id,
      turn_id: turn_id,
      artifact_id: artifact_id,
      chapter_id: chapter.id,
      chapter_ref: chapter_ref,
      chapter_title: chapter.title,
      chapter_count: chapter_count(context.work_id),
      card_title: card_title,
      candidate_content: candidate_text,
      candidate_content_sha256: sha256(candidate_text),
      candidate_word_count: ProseWordCount.count(candidate_text),
      declared_versions: declared_versions,
      declared_refs: covered_refs,
      current_versions: canon.versions,
      current_prose_sha256: canon.digest,
      current_reading_text_sha256: sha256(reading_text),
      current_reading_word_count: ProseWordCount.count(reading_text),
      current_reading_char_count: String.length(reading_text),
      accepted_draft_refs: Enum.map(accepted_before, & &1.draft_ref),
      drafts: accepted_before,
      work_mutation_count: work_mutation_count,
      expected_freshness_status: Atom.to_string(expected_status),
      expected_reason_codes: expected_reason_codes,
      expected_decision: Keyword.fetch!(opts, :expected_decision),
      expected_after_adoption:
        expected_after_adoption(scenario, context.work_id, covered_refs, candidate_text),
      visible_approve_label: "保存为章节正文",
      pending_artifact_visible: true,
      pending_adoption_turn_visible: true,
      self_check_ok: true
    }

    Map.put(base, :note, Keyword.fetch!(opts, :note))
  end

  defp expected_after_adoption(:fresh, _work_id, covered_refs, candidate_text) do
    %{
      outcome: "accepted",
      superseded_refs: covered_refs,
      new_accepted_content_sha256: sha256(candidate_text),
      new_accepted_word_count: ProseWordCount.count(candidate_text),
      mutation_delta: 1,
      reason_codes: ["candidate_adopted_as_tentative", "provenance_verified"]
    }
  end

  defp expected_after_adoption(_scenario, _work_id, _covered_refs, _candidate_text) do
    %{outcome: "zero_write", new_accepted_count: 0, mutation_delta: 0}
  end

  defp build_turn_result(attrs) do
    %{
      schema_version: "3.0-draft",
      turn_id: attrs.turn_id,
      work_id: attrs.work_id,
      session_id: attrs.session_id,
      frame_ref: "frame_b47_#{attrs.scenario}",
      phase: "completed",
      status: "conversational",
      assistant_message: %{
        text:
          "已恢复第 01 章《#{attrs.chapter.title}》的一条待采纳正文修订候选；" <>
            "保存后会按当前作品事实校验版本，未保存前不会写入作品事实。"
      },
      frame_summary: %{
        frame_type: "revision",
        dialogue_goal: "B47 canon freshness #{attrs.scenario}"
      },
      ui_cards: [
        %{
          card_type: "candidate_set",
          priority: "high",
          visibility: "always",
          title: attrs.card_title,
          body: attrs.candidate_text,
          artifact_refs: [attrs.artifact_id],
          candidate_set_ref: attrs.artifact_id,
          artifact_type: "prose_fragment",
          items: [
            %{
              item_id: "item_b47_#{attrs.scenario}",
              title: attrs.card_title,
              body: attrs.candidate_text,
              rationale: attrs.note
            }
          ],
          tentative: true
        }
      ],
      adoption_state: %{
        pending: [
          %{
            artifact_id: attrs.artifact_id,
            artifact_type: "prose_fragment",
            adoption_status: "TENTATIVE",
            requires_adoption: true,
            source_tool_result_ref: "tr_b47_#{attrs.scenario}",
            target_chapter: attrs.chapter.title,
            target_chapter_ref: attrs.chapter_ref,
            payload: attrs.payload
          }
        ],
        resolved: []
      },
      available_actions: [
        %{
          action_id: "accept:#{attrs.artifact_id}",
          action_type: "accept",
          label_key: "artifact.accept",
          source_turn_ref: attrs.turn_id,
          target_ref: attrs.artifact_id,
          enabled: true,
          idempotency_key: "idem:#{attrs.turn_id}:accept:#{attrs.artifact_id}",
          trace_ref: "tr_b47_#{attrs.scenario}"
        },
        %{
          action_id: "discard:#{attrs.artifact_id}",
          action_type: "discard",
          label_key: "artifact.discard",
          source_turn_ref: attrs.turn_id,
          target_ref: attrs.artifact_id,
          enabled: true,
          idempotency_key: "idem:#{attrs.turn_id}:discard:#{attrs.artifact_id}",
          trace_ref: "tr_b47_#{attrs.scenario}"
        }
      ],
      truthfulness: %{
        tool_called: false,
        artifact_adopted: false,
        production_write_performed: false,
        durable_behavior_opened: false
      },
      trace_summary: %{
        trace_ref: "trace_b47_#{attrs.scenario}",
        decision_type: "revision",
        reason_codes: ["restored_candidate_for_b47_canon_freshness"]
      },
      produced_at: DateTime.utc_now() |> DateTime.to_iso8601()
    }
  end

  defp record_turn!(context, turn_id, turn_result) do
    entries = [
      %{
        workspace_id: context.work_id,
        session_id: context.session_id,
        turn_id: turn_id,
        role: "user",
        content: %{text: "把第 01 章正文修订一下；先给候选，我确认后再保存。"},
        source_ref: turn_id,
        scope_ref: context.work_id,
        freshness_score: 0.6,
        importance_score: 0.6,
        replayable: true,
        retrievable: true
      },
      %{
        workspace_id: context.work_id,
        session_id: context.session_id,
        turn_id: turn_id,
        role: "assistant",
        content: %{text: turn_result.assistant_message.text, turn_result: turn_result},
        source_ref: turn_id,
        scope_ref: context.work_id,
        freshness_score: 0.6,
        importance_score: 0.6,
        replayable: true,
        retrievable: true
      }
    ]

    Enum.each(entries, fn entry ->
      {:ok, _interaction} = MemoryLog.record(entry)
    end)

    :ok
  end

  # ── 外部证据辅助 ─────────────────────────────────────────────

  defp accepted_draft_rows(work_id) do
    Draft
    |> where(
      [d],
      d.work_id == ^work_id and
        d.status in ^[
        NovelFoundation.Enums.AdoptionStatus.accepted(),
        NovelFoundation.Enums.AdoptionStatus.edited_accepted()
      ]
    )
    |> order_by([d], asc: d.inserted_at, asc: d.id)
    |> Repo.all()
    |> Enum.map(fn draft ->
      %{
        draft_id: draft.id,
        draft_ref: draft_ref(draft),
        revision: draft.revision,
        status: draft.status,
        content_sha256: sha256(draft.content),
        char_count: String.length(draft.content)
      }
    end)
  end

  defp chapter_count(work_id) do
    Repo.aggregate(
      from(c in NovelPersistence.Schemas.Chapter, where: c.work_id == ^work_id),
      :count
    )
  end

  defp work_mutation_count(work_id) do
    scope = "work:#{work_id}"

    Repo.aggregate(from(m in Mutation, where: m.target_scope == ^scope), :count)
  end

  defp db_baseline() do
    repo_config = Application.get_env(:novel_persistence, NovelPersistence.Repo, [])

    %{
      database: Keyword.get(repo_config, :database),
      works_total: Repo.aggregate(NovelPersistence.Schemas.Work, :count),
      drafts_total: Repo.aggregate(Draft, :count),
      mutations_total: Repo.aggregate(Mutation, :count)
    }
  end

  # ── check 模式（seed 后、UI 采纳前复验；fresh 采纳后预期会转为 stale）──

  defp check() do
    checks =
      Enum.map(@work_titles, fn {scenario, title} ->
        case latest_work_by_title(title) do
          nil ->
            %{scenario: scenario, ok: false, reason: "work_not_found", title: title}

          work ->
            check_work(scenario, work)
        end
      end)

    Enum.each(checks, fn check ->
      IO.puts("#{@tag} check=#{Jason.encode!(check)}")
    end)

    ok = Enum.all?(checks, &(&1.ok == true))
    IO.puts("#{@tag} check_ok=#{ok}")

    unless ok do
      System.halt(1)
    end
  end

  defp check_work(scenario, work) do
    {:ok, snapshot} = WorkSessionService.resume(work.id)
    pending = List.wrap(snapshot.pending_adoptions)

    with %{} = pending_entry <- List.first(pending),
         %{} = payload <- artifact_field(pending_entry, :payload),
         payload_effect = payload["adoption_effect"] || %{},
         declared_versions when is_map(declared_versions) <-
           declared_versions_from_effect(payload_effect),
         chapter_ref when is_binary(chapter_ref) <- payload["target_chapter_ref"],
         {:ok, canon} <- AdoptionRepository.canon_snapshot(work.id, {:chapter_prose, chapter_ref}) do
      verdict =
        CanonFreshness.assess(:chapter_prose, %{
          ref: chapter_ref,
          versions: declared_versions,
          digest: nil
        }, canon)

      expected = expected_check_status(scenario)
      reading = ReadingProjectionRepo.accepted_chapter_prose(work.id, chapter_ref)

      %{
        scenario: scenario,
        ok: verdict.status == expected,
        expected_status: Atom.to_string(expected),
        actual_status: Atom.to_string(verdict.status),
        work_id: work.id,
        work_title: work.title,
        pending_artifact_visible: true,
        reading_word_count: ProseWordCount.count(reading),
        current_versions: canon.versions,
        declared_versions: declared_versions
      }
    else
      _ ->
        %{
          scenario: scenario,
          ok: false,
          reason: "pending_candidate_or_chapter_not_restored",
          work_id: work.id,
          work_title: work.title
        }
    end
  end

  defp expected_check_status(:stale), do: :stale
  defp expected_check_status(:conflict), do: :conflict
  defp expected_check_status(:fresh), do: :fresh

  defp latest_work_by_title(title) do
    WorkService.list()
    |> Enum.filter(&(&1.title == title))
    |> List.first()
  end

  defp declared_versions_from_effect(effect) do
    expected = effect["expected_base_versions"] || effect[:expected_base_versions] || []

    Map.new(expected, fn item ->
      ref = item["ref"] || item[:ref]
      version = item["version"] || item[:version]
      {ref, version}
    end)
  end

  # ── 小工具 ───────────────────────────────────────────────────

  defp draft_id_ref(id), do: "draft:#{id}"

  defp draft_ref(draft), do: "#{draft_id_ref(draft.id)}:#{draft.revision}"

  defp sha256(text), do: :crypto.hash(:sha256, text) |> Base.encode16(case: :lower)

  defp artifact_field(map, key) when is_map(map) do
    Map.get(map, key) || Map.get(map, Atom.to_string(key))
  end

  defp artifact_field(_map, _key), do: nil
end

B47CanonFreshnessSeed.run(System.argv())
