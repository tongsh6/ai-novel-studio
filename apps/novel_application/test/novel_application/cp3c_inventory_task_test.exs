defmodule NovelApplication.CP3cInventoryTaskTest do
  @moduledoc "B27 CP3c：盘点 prompt 枚举/材料/artifact_type 单一真源与纠错保任务。"
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.FactInventoryService, as: Inventory
  alias NovelCommon.AuthoringSemantics
  alias NovelFoundation.Enums.NarrativeRole

  defp materials do
    [
      %{seq: 1, title: "底层灵气账单", prose: "沈砚发现灵气被公司暗抽。", kind: :chapter_summary},
      %{
        seq: 3,
        title: "旧服务器里的残诀",
        prose: String.duplicate("残诀《碎影》可将灵气与代码绑定。", 60),
        kind: :chapter_prose
      }
    ]
  end

  test "prompt 渲染共享语义唯一真源（在 task 在场时）" do
    {:ok, task} =
      NovelApplication.AuxTaskBuilder.for_fact_inventory(%{
        work_id: "w",
        materials: materials()
      })

    prompt = Inventory.inventory_prompt("正文", 2, [], [], [], task: task, materials: materials())
    assert prompt =~ AuthoringSemantics.shared_rules()
    assert length(String.split(prompt, AuthoringSemantics.shared_rules())) == 2
  end

  test "narrative_role 枚举由 NovelFoundation.Enums.NarrativeRole 单一真源插值（5 值，无 4/5 漂移）" do
    prompt = Inventory.inventory_prompt("正文", 2)
    role_values = Enum.join(NarrativeRole.values(), " / ")

    assert prompt =~ role_values
    assert prompt =~ "ENSEMBLE_POV"
    # 旧的 4 值行（缺 ENSEMBLE_POV）不得回流
    refute prompt =~ "PROTAGONIST/SUPPORTING/ANTAGONIST/MINOR 之一"
    refute prompt =~ "PROTAGONIST/SUPPORTING/ANTAGONIST/MINOR"
  end

  test "artifact_type 词表来自 service 单一真源，含条件展开类型" do
    prompt =
      Inventory.inventory_prompt("正文", 2, ["target_length"], [], [
        %{ref: "foreshadow_m1", label: "矿区旧账"}
      ])

    for type <-
          Inventory.inventory_artifact_types(
            missing_skeleton_fields: ["target_length"],
            unresolved_foreshadows: [%{ref: "foreshadow_m1", label: "x"}]
          ) do
      assert prompt =~ type
    end

    # 无缺位/无未回收伏笔时不含条件类型
    plain = Inventory.inventory_prompt("正文", 2)
    refute plain =~ "work_skeleton_suggestion"
    refute plain =~ "foreshadowing_resolution"

    # flow/summary 分组键与解析分组同源
    assert Inventory.proposal_buckets()["character_seed"] == :characters
    assert :foreshadowing_resolutions in Inventory.proposal_keys()
  end

  test "材料清单逐章标注来源/截断/版本，升格覆盖说明，不再自称「前 N 章正文摘录」" do
    text = Inventory.build_material_text(materials())

    assert text =~ "第1章 底层灵气账单｜章摘要（非正文全文）"
    assert text =~ "第3章 旧服务器里的残诀｜正文摘录｜摘录已截断"

    prompt = Inventory.inventory_prompt(text, 2, [], [], [], materials: materials())
    assert prompt =~ "## 材料覆盖说明"
    assert prompt =~ "本轮材料覆盖 seq：1, 3"
    assert prompt =~ "缺材料/未列出的章 seq：2"
    refute prompt =~ "前 2 章的正文摘录"
  end

  test "纠错 prompt 保留原任务/材料范围（只修 JSON 协议），并重放完整原 prompt" do
    parent = self()

    provider = %Execution{
      result_fn: fn prompt ->
        send(parent, {:prompt, prompt})

        case Process.get(:seen) do
          nil ->
            Process.put(:seen, true)
            {:ok, %{content: "not json"}}

          _ ->
            {:ok,
             %{
               content:
                 ~s([{"artifact_type":"character_seed","item_id":"c1","title":"沈砚","body":"主视角。","rationale":null,"narrative_role":"PROTAGONIST"}])
             }}
        end
      end
    }

    assert {:ok, _proposal} = Inventory.inventory(materials(), provider, work_id: "w-1")

    prompts =
      for _ <- 1..2 do
        receive do
          {:prompt, prompt} -> prompt
        after
          0 -> flunk("expected two prompts")
        end
      end

    [first, corrected] = prompts
    assert corrected =~ "保持原任务、材料范围"
    assert corrected =~ first
    assert corrected =~ "not json"
  end
end
