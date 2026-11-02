defmodule NovelDomain.BehaviorStateTest do
  use ExUnit.Case, async: true

  alias NovelDomain.BehaviorState
  alias NovelFoundation.TurnResultValidator

  defp open_behavior(lifecycle \\ :awaiting_author) do
    %BehaviorState{
      behavior_id: "bh_1",
      behavior_type: :confirmation,
      lifecycle_status: lifecycle,
      blocking_actor: :author,
      opened_at_turn_ref: "turn_1",
      opened_by_decision_ref: "dec_1",
      frame_ref: "frame_1",
      target_ref: "as-1",
      required_next_action: "confirm_before_execute",
      available_actions: [%{action_type: "confirm_before_execute", behavior_ref: "bh_1"}],
      prompt_contract: %{summary: "确认覆盖"}
    }
  end

  defp behavior_at(lifecycle, opts \\ []) do
    %{
      open_behavior(lifecycle)
      | constraints: Keyword.get(opts, :constraints, %{"authority" => "author"}),
        resolution: Keyword.get(opts, :resolution)
    }
  end

  defp json_roundtrip(map), do: map |> Jason.encode!() |> Jason.decode!()

  describe "8-2 显式 supersede（VS-03 §4 规则 1/3）" do
    test "supersede/3 marks old behavior :superseded and references replacement" do
      old = open_behavior()
      new = %{open_behavior() | behavior_id: "bh_2", opened_at_turn_ref: "turn_2"}

      superseded = BehaviorState.supersede(old, new)

      assert superseded.lifecycle_status == :superseded
      assert BehaviorState.open?(superseded) == false
      assert superseded.closed_at_turn_ref == "turn_2"
      assert superseded.resolution.ref == "behavior_superseded:bh_1:bh_2"
      assert superseded.resolution.superseded_by == "bh_2"
      assert superseded.resolution.superseded_by_ref == "behavior:bh_2"
      assert superseded.resolution.reason_code == "new_author_blocking_behavior_opened"
    end

    test "snapshot/2 keeps replacement active while superseded behavior goes to history" do
      old = open_behavior()
      new = %{open_behavior() | behavior_id: "bh_2"}

      snapshot = BehaviorState.snapshot(new, [BehaviorState.supersede(old, new)])

      assert snapshot.active.behavior_id == "bh_2"
      assert snapshot.active.status == "WAITING_USER"

      assert [
               %{
                 behavior_id: "bh_1",
                 status: "CANCELLED",
                 resolution_ref: "behavior_superseded:bh_1:bh_2"
               }
             ] = snapshot.history
    end

    test "from_map/1 restores summary maps with atom and string keys (JSON round-trip)" do
      behavior = open_behavior()
      summary = BehaviorState.summary(behavior)

      restored = BehaviorState.from_map(summary)
      assert restored.behavior_id == "bh_1"
      assert restored.behavior_type == :confirmation
      assert restored.lifecycle_status == :awaiting_author
      assert restored.target_ref == "as-1"

      json_restored = summary |> Jason.encode!() |> Jason.decode!() |> BehaviorState.from_map()
      assert json_restored.behavior_id == "bh_1"
      assert json_restored.lifecycle_status == :awaiting_author
    end

    test "from_map/1 rejects maps without behavior_id" do
      assert BehaviorState.from_map(%{status: "WAITING_USER"}) == nil
    end
  end

  describe "VS-00L §16.11 精确生命周期 / constraints / resolution 保真" do
    test "superseded → JSON → from_map 保留精确生命周期、resolution 与 constraints" do
      old = behavior_at(:awaiting_author)
      new = %{old | behavior_id: "bh_2", opened_at_turn_ref: "turn_2"}
      superseded = BehaviorState.supersede(old, new)
      summary = superseded |> BehaviorState.summary() |> json_roundtrip()

      assert summary["lifecycle_status"] == "superseded"
      assert summary["status"] == "CANCELLED"

      restored = BehaviorState.from_map(summary)

      assert restored.lifecycle_status == :superseded
      assert restored.constraints == %{"authority" => "author"}
      assert restored.resolution == summary["resolution"]
      assert restored.resolution["ref"] == "behavior_superseded:bh_1:bh_2"
      assert restored.resolution["type"] == "superseded"
      assert restored.resolution["superseded_by"] == "bh_2"
      assert restored.resolution["superseded_by_ref"] == "behavior:bh_2"
      assert restored.resolution["reason_code"] == "new_author_blocking_behavior_opened"
      assert restored.resolution["closed_at_turn_ref"] == "turn_2"

      # 再次输出仍是原域事实，不折叠成 CANCELLED/awaiting。
      assert BehaviorState.summary(restored)[:lifecycle_status] == "superseded"
      assert BehaviorState.summary(restored)[:status] == "CANCELLED"
    end

    test "七类 lifecycle_status 经 JSON 往返均保持精确值" do
      for {lifecycle, compatible_status} <- [
            {:open, "OPEN"},
            {:awaiting_author, "WAITING_USER"},
            {:resolving, "OPEN"},
            {:resolved, "RESOLVED"},
            {:cancelled, "CANCELLED"},
            {:failed, "EXPIRED"},
            {:superseded, "CANCELLED"}
          ] do
        resolution =
          if lifecycle in [:resolved, :cancelled, :failed, :superseded],
            do: %{"ref" => "resolution:#{lifecycle}", "status" => to_string(lifecycle)},
            else: nil

        behavior = behavior_at(lifecycle, resolution: resolution)
        summary = behavior |> BehaviorState.summary() |> json_roundtrip()
        restored = BehaviorState.from_map(summary)

        assert summary["lifecycle_status"] == Atom.to_string(lifecycle)
        assert summary["status"] == compatible_status
        assert restored.lifecycle_status == lifecycle
        assert restored.constraints == %{"authority" => "author"}
        assert restored.resolution == resolution
      end
    end

    test "resolution nil 与空对象是不同事实，constraints 空对象不被吞" do
      nil_resolution =
        behavior_at(:resolved, constraints: %{}, resolution: nil)
        |> BehaviorState.summary()
        |> json_roundtrip()
        |> BehaviorState.from_map()

      assert nil_resolution.constraints == %{}
      assert nil_resolution.resolution == nil

      empty_resolution =
        behavior_at(:resolved, constraints: %{}, resolution: %{})
        |> BehaviorState.summary()
        |> json_roundtrip()
        |> BehaviorState.from_map()

      assert empty_resolution.constraints == %{}
      assert empty_resolution.resolution == %{}
      refute empty_resolution.resolution == nil
    end

    test "显式 lifecycle_status=nil 不得回退 status，也不得默认 awaiting_author" do
      for status <- [nil, "WAITING_USER", "SUPERSEDED"] do
        map = %{
          "behavior_id" => "bh_null",
          "behavior_type" => "confirmation",
          "lifecycle_status" => nil,
          "status" => status
        }

        assert BehaviorState.from_map(map) == nil
      end
    end

    test "非法 lifecycle_status 不得回退合法 status" do
      for invalid <- ["OPEN", "WAITING_USER", "resolving!", 42, true, []] do
        map = %{
          "behavior_id" => "bh_invalid",
          "behavior_type" => "confirmation",
          "lifecycle_status" => invalid,
          "status" => "WAITING_USER"
        }

        assert BehaviorState.from_map(map) == nil
      end
    end

    test "精确 lifecycle_status 与兼容 status 冲突时拒绝，不任选一个" do
      for {lifecycle, status} <- [
            {"superseded", "WAITING_USER"},
            {"failed", "RESOLVED"},
            {"resolving", "CANCELLED"},
            {"awaiting_author", "OPEN"}
          ] do
        map = %{
          "behavior_id" => "bh_conflict",
          "behavior_type" => "confirmation",
          "lifecycle_status" => lifecycle,
          "status" => status
        }

        assert BehaviorState.from_map(map) == nil
      end
    end

    test "精确 lifecycle_status 配显式 nil 或非法 status 同样拒绝" do
      for status <- [nil, "NOT_A_STATUS", 7] do
        map = %{
          "behavior_id" => "bh_status_invalid",
          "behavior_type" => "confirmation",
          "lifecycle_status" => "superseded",
          "status" => status
        }

        assert BehaviorState.from_map(map) == nil
      end
    end

    test "旧快照没有精确字段时按可识别 status 恢复，未识别值不变成开放行为" do
      for {status, lifecycle} <- [
            {"OPEN", :open},
            {"WAITING_USER", :awaiting_author},
            {"RESOLVING", :resolving},
            {"RESOLVED", :resolved},
            {"CANCELLED", :cancelled},
            {"EXPIRED", :failed}
          ] do
        restored =
          BehaviorState.from_map(%{
            "behavior_id" => "bh_old",
            "behavior_type" => "confirmation",
            "status" => status
          })

        assert restored.lifecycle_status == lifecycle
      end

      for status <- [nil, "UNKNOWN_STATUS", "superseded", 12] do
        assert BehaviorState.from_map(%{
                 "behavior_id" => "bh_old",
                 "behavior_type" => "confirmation",
                 "status" => status
               }) == nil
      end
    end

    test "新 resolution 与兼容 resolution_ref 冲突时拒绝，一致时保留原字节" do
      base = %{
        "behavior_id" => "bh_resolution_ref",
        "behavior_type" => "confirmation",
        "status" => "RESOLVED",
        "resolution" => %{"ref" => "resolution:original", "reason" => "原文"}
      }

      # 兼容 ref 缺席时，只有新 resolution 的 ref，合法。
      assert BehaviorState.from_map(base).resolution["ref"] == "resolution:original"

      # 外层显式 nil 是“声明为空”，与内层非空 ref 矛盾，不能静默接受。
      assert BehaviorState.from_map(Map.put(base, "resolution_ref", nil)) == nil

      # 同时声明且不一致时不能任选一个，也不能悄悄改写成一边。
      for foreign <- ["resolution:foreign", " resolution:original", "resolution:original "] do
        assert BehaviorState.from_map(Map.put(base, "resolution_ref", foreign)) == nil
      end

      # 完全一致的 ref 接受，且字节（含前后空白/中文）原样保留。
      ref = "  resolution:章节/确认-1\t"
      resolution = %{"ref" => ref, "reason" => "原文　不改"}
      map = Map.put(base, "resolution", resolution) |> Map.put("resolution_ref", ref)
      restored = BehaviorState.from_map(map)
      assert restored.resolution["ref"] == ref
      assert BehaviorState.summary(restored)[:resolution_ref] == ref
    end

    test "resolution 引用存在性矩阵经真实 JSON 往返区分 absent / 显式 nil / 值" do
      base = %{
        "behavior_id" => "bh_presence",
        "behavior_type" => "confirmation",
        "status" => "RESOLVED"
      }

      cases = [
        {%{}, :absent, true},
        {%{}, nil, true},
        {%{}, "r", false},
        {%{"ref" => nil}, :absent, true},
        {%{"ref" => nil}, nil, true},
        {%{"ref" => nil}, "r", false},
        {%{"ref" => "r"}, :absent, true},
        {%{"ref" => "r"}, nil, false},
        {%{"ref" => "r"}, "r", true},
        {%{"ref" => "r"}, "other", false}
      ]

      for {resolution, compat, accepted?} <- cases do
        data = Map.put(base, "resolution", resolution)
        data = if compat == :absent, do: data, else: Map.put(data, "resolution_ref", compat)
        encoded = data |> Jason.encode!() |> Jason.decode!()
        restored = BehaviorState.from_map(encoded)
        label = "resolution=#{inspect(resolution)} resolution_ref=#{inspect(compat)}"

        if accepted? do
          assert restored != nil, label
          assert restored.resolution == resolution
        else
          assert restored == nil, label
        end
      end
    end

    test "显式 nil resolution 不能同时声称非空兼容 resolution_ref" do
      base = %{
        "behavior_id" => "bh_nil_resolution",
        "behavior_type" => "confirmation",
        "status" => "RESOLVED",
        "resolution" => nil
      }

      assert BehaviorState.from_map(Map.put(base, "resolution_ref", nil)).resolution == nil
      assert BehaviorState.from_map(Map.put(base, "resolution_ref", "")) == nil
      assert BehaviorState.from_map(Map.put(base, "resolution_ref", "resolution:ghost")) == nil
    end

    test "新 resolution 无 ref 时兼容 ref 不得补造，nil 兼容 ref 合法" do
      base = %{
        "behavior_id" => "bh_resolution_without_ref",
        "behavior_type" => "confirmation",
        "status" => "RESOLVED",
        "resolution" => %{"reason" => "只有原因"}
      }

      restored = BehaviorState.from_map(Map.put(base, "resolution_ref", nil))
      assert restored.resolution == %{"reason" => "只有原因"}
      assert BehaviorState.summary(restored)[:resolution_ref] == nil

      assert BehaviorState.from_map(Map.put(base, "resolution_ref", "resolution:ghost")) == nil
    end

    test "resolution 内 ref 的 atom/string 双键冲突不任选，同值接受" do
      base = %{
        "behavior_id" => "bh_nested_ref",
        "behavior_type" => "confirmation",
        "status" => "RESOLVED",
        "resolution" => %{:ref => "resolution:same", "ref" => "resolution:same"}
      }

      assert BehaviorState.from_map(base).resolution[:ref] == "resolution:same"

      conflict = %{
        base
        | "resolution" => %{:ref => "resolution:atom", "ref" => "resolution:string"}
      }

      assert BehaviorState.from_map(conflict) == nil
    end

    test "behavior_id 仅全空白非法，合法空白字节原样保留" do
      for blank <- ["", " ", "  \t", "\n", "\u3000", " \u3000\t "] do
        assert BehaviorState.from_map(%{
                 "behavior_id" => blank,
                 "behavior_type" => "confirmation",
                 "status" => "OPEN"
               }) == nil
      end

      id = "  bh_identity\t"

      restored =
        BehaviorState.from_map(%{
          "behavior_id" => id,
          "behavior_type" => "confirmation",
          "status" => "OPEN"
        })

      assert restored.behavior_id == id
      assert BehaviorState.summary(restored)[:behavior_id] == id
    end

    test "旧快照的 resolution_ref 只保留原引用本身，不编造 resolution 细节" do
      restored =
        BehaviorState.from_map(%{
          "behavior_id" => "bh_old",
          "behavior_type" => "confirmation",
          "status" => "RESOLVED",
          "resolution_ref" => "behavior_resolution:turn-old"
        })

      assert restored.resolution == %{ref: "behavior_resolution:turn-old"}
      assert BehaviorState.summary(restored)[:resolution_ref] == "behavior_resolution:turn-old"
      assert Map.keys(restored.resolution) == [:ref]
    end

    test "constraints / resolution 显式非法时拒绝，不吞成空 map" do
      base = %{
        "behavior_id" => "bh_invalid_payload",
        "behavior_type" => "confirmation",
        "status" => "RESOLVED"
      }

      for invalid <- [nil, "authority", [], 1] do
        assert BehaviorState.from_map(Map.put(base, "constraints", invalid)) == nil
      end

      # resolution 类型允许 nil；显式 nil 是真实事实，不是非法值。
      for invalid <- ["authority", [], 1] do
        assert BehaviorState.from_map(Map.put(base, "resolution", invalid)) == nil
      end

      assert BehaviorState.from_map(Map.put(base, "resolution", nil)).resolution == nil
    end

    test "atom/string 键都能恢复；同类键同值接受，异值不任选字段" do
      base = %{
        behavior_id: "bh_mixed",
        behavior_type: "confirmation",
        lifecycle_status: "superseded",
        status: "CANCELLED",
        constraints: %{"authority" => "author"},
        resolution: %{"ref" => "resolution:mixed"}
      }

      restored = BehaviorState.from_map(base)
      assert restored.lifecycle_status == :superseded
      assert restored.constraints == %{"authority" => "author"}
      assert restored.resolution == %{"ref" => "resolution:mixed"}

      same_value =
        base
        |> Map.put("behavior_id", "bh_mixed")
        |> Map.put("behavior_type", "confirmation")
        |> Map.put("lifecycle_status", "superseded")
        |> Map.put("status", "CANCELLED")
        |> Map.put("constraints", %{"authority" => "author"})
        |> Map.put("resolution", %{"ref" => "resolution:mixed"})

      assert BehaviorState.from_map(same_value).lifecycle_status == :superseded

      for {key, conflict} <- [
            {:behavior_id, "bh_other"},
            {:lifecycle_status, "failed"},
            {:status, "RESOLVED"},
            {:constraints, %{"authority" => "system"}},
            {:resolution, %{"ref" => "resolution:other"}}
          ] do
        assert BehaviorState.from_map(Map.put(same_value, key, conflict)) == nil
      end

      # 精确字段与兼容 status 是不同字段；混合键冲突不能借另一字段绕过。
      assert BehaviorState.from_map(
               Map.put(same_value, "lifecycle_status", "failed")
               |> Map.put(:lifecycle_status, "superseded")
             ) == nil
    end

    test "合法 scope/target/frame/plan 引用字节经双键边界原样保留" do
      summary =
        %{open_behavior() | frame_ref: " frame\t", plan_ref: "plan/章节 ", target_ref: " target/1 "}
        |> BehaviorState.summary()

      string_keys = Map.new(summary, fn {key, value} -> {Atom.to_string(key), value} end)
      restored = BehaviorState.from_map(Map.merge(summary, string_keys))

      assert restored.frame_ref == " frame\t"
      assert restored.plan_ref == "plan/章节 "
      assert restored.target_ref == " target/1 "
    end

    test "中文与 ref 原字节经 JSON 往返不变" do
      resolution = %{
        "ref" => "behavior_resolution:章节/确认-1",
        "reason" => "作者要求保留「原文」"
      }

      summary =
        behavior_at(:resolved, constraints: %{"说明" => "不写入正文"}, resolution: resolution)
        |> BehaviorState.summary()
        |> json_roundtrip()

      restored = BehaviorState.from_map(summary)

      assert restored.constraints["说明"] == "不写入正文"
      assert restored.resolution["ref"] == "behavior_resolution:章节/确认-1"
      assert restored.resolution["reason"] == "作者要求保留「原文」"
    end

    test "未知边界形状返回 nil，不伪造开放行为" do
      assert BehaviorState.from_map(%{}) == nil
      assert BehaviorState.from_map(%{"behavior_id" => "bh_no_status"}) == nil
      assert BehaviorState.from_map(%{"behavior_id" => ""}) == nil
      assert BehaviorState.from_map(%{"behavior_id" => 123, "status" => "OPEN"}) == nil
    end
  end

  describe "snapshot/1 形状（唯一 behavior_state 序列化入口）" do
    test "nil → %{active: nil, history: []}" do
      assert BehaviorState.snapshot(nil) == %{active: nil, history: []}
    end

    test "open behavior → 进 active，history 空，status 为 WAITING_USER 枚举" do
      snapshot = BehaviorState.snapshot(open_behavior(:awaiting_author))

      assert snapshot.history == []
      assert snapshot.active.behavior_id == "bh_1"
      assert snapshot.active.behavior_type == "confirmation"
      assert snapshot.active.status == "WAITING_USER"
    end

    test ":open lifecycle → status OPEN" do
      assert BehaviorState.snapshot(open_behavior(:open)).active.status == "OPEN"
    end

    test "closed behavior → 进 history，active 为 nil（终态不许留在 active）" do
      snapshot =
        BehaviorState.snapshot(%{
          open_behavior()
          | lifecycle_status: :resolved,
            resolution: %{ref: "resolution_1"},
            closed_at_turn_ref: "turn_2",
            trace_ref: "trace_1"
        })

      assert snapshot.active == nil

      assert [
               %{
                 status: "RESOLVED",
                 resolution_ref: "resolution_1",
                 closed_at_turn_ref: "turn_2",
                 trace_ref: "trace_1"
               }
             ] = snapshot.history
    end
  end

  describe "与 TurnResultValidator 契约对齐（防形状漂移）" do
    test "open / closed / nil 三种快照都通过 validate_behavior_state/1" do
      for behavior <- [
            open_behavior(:open),
            open_behavior(:awaiting_author),
            %{open_behavior() | lifecycle_status: :resolved},
            %{open_behavior() | lifecycle_status: :cancelled},
            nil
          ] do
        assert :ok = TurnResultValidator.validate_behavior_state(BehaviorState.snapshot(behavior))
      end
    end

    test "扁平形状（无 active/history）被 validator 拒绝——回归守卫" do
      flat = %{
        behavior_id: "bh_1",
        behavior_type: "confirmation",
        lifecycle_status: "awaiting_author"
      }

      assert {:error, violations} = TurnResultValidator.validate_behavior_state(flat)
      assert Enum.any?(violations, &(&1 =~ "behavior_state.active missing"))
    end
  end

  describe "VS-00L §16.13 当前行为统一读取" do
    test "字段缺席不是清空，最后一处明确快照决定当前行为" do
      open = BehaviorState.snapshot(open_behavior())

      assert :absent =
               BehaviorState.latest_snapshot([
                 %{turn_id: "turn-ordinary-1", assistant_message: %{text: "普通回复"}}
               ])

      assert {:ok, %BehaviorState{} = active} =
               BehaviorState.latest_snapshot([
                 %{turn_id: "turn-open", behavior_state: open},
                 %{turn_id: "turn-ordinary-2", assistant_message: %{text: "后续普通回复"}}
               ])

      assert active.behavior_id == "bh_1"
      assert BehaviorState.open?(active)
    end

    test "明确 active nil 清空当前行为，且不向更早 turn 回退" do
      open = BehaviorState.snapshot(open_behavior())
      cleared = %{active: nil, history: []}

      assert {:ok, nil} =
               BehaviorState.latest_snapshot([
                 %{behavior_state: open},
                 %{behavior_state: cleared},
                 %{assistant_message: %{text: "清空后的普通回复"}}
               ])
    end

    test "活动快照经 §16.11 codec 恢复，保留原身份字节与生命周期" do
      open = BehaviorState.snapshot(%{open_behavior() | behavior_id: "  bh_bytes\t"})

      assert {:ok, %BehaviorState{} = active} =
               BehaviorState.read_snapshot(%{behavior_state: open})

      assert active.behavior_id == "  bh_bytes\t"
      assert active.lifecycle_status == :awaiting_author
    end
  end
end
