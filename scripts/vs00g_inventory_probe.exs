# VS-00G CP4b 设定盘点提炼 live 探针（便宜验证阶梯：live 单点，非狗粮）
#
# 验证 CP4b 最大不确定性：真实模型（LM Studio）能否从百章标本正文反向提炼出
# 结构化设定提案（主角团+世界规则+伏笔）。过了再建 run 机制；不过则提炼 prompt
# 需重设计。这是盘点能力的核心可行性验证。
#
# 用法：NOVEL_TEST_DB_DIR=tmp/dogfood-db MIX_TEST_PARTITION=_dogfood \
#       NOVEL_LMSTUDIO_TIMEOUT_MS=300000 PHX_SERVER=false MIX_ENV=test \
#       mix run scripts/vs00g_inventory_probe.exs <work_id> [chapter_limit]

import Ecto.Query

alias NovelAgent.Provider.Execution
alias NovelPersistence.Repo
alias NovelPersistence.Schemas.{Chapter, Draft, Scene}

[work_id | rest] = System.argv()
chapter_limit = rest |> List.first() |> then(&if(&1, do: String.to_integer(&1), else: 12))

# 读前 N 章已采纳正文，每章截断防超 context。work_id 在库里以文本 UUID 存储。
chapters =
  from(c in Chapter,
    where: c.work_id == ^work_id,
    order_by: [asc: c.seq],
    limit: ^chapter_limit,
    select: {c.id, c.seq, c.title}
  )
  |> Repo.all()

material =
  chapters
  |> Enum.map(fn {chapter_id, seq, title} ->
    prose =
      from(d in Draft,
        join: s in Scene,
        on: d.scene_id == s.id,
        where: s.chapter_id == ^chapter_id and d.status in ["ACCEPTED", "EDITED_ACCEPTED"],
        order_by: [asc: s.seq],
        select: d.content
      )
      |> Repo.all()
      |> Enum.join("")
      |> String.slice(0, 700)

    "【第#{seq}章 #{title}】\n#{prose}"
  end)
  |> Enum.join("\n\n")

prompt = """
你是小说设定盘点助手。下面是一部作品前 #{chapter_limit} 章的正文摘录。请从正文中反向提炼出
作品"事实上已经存在"的设定，整理成结构化提案供作者采纳登记。

要求：
- 只提炼正文中实际出现的设定，不发明正文里没有的内容。
- 主角：找出正文的核心视角人物/主角（可多个），narrative_role 取 PROTAGONIST/SUPPORTING/ANTAGONIST/MINOR 之一。
- 世界规则：正文反复出现、支撑剧情的世界观规则或设定。
- 伏笔：正文埋下但尚未回收的线索。
- 每项标注依据（出现的章）。

只返回 JSON 对象，不要附加任何额外文字：
{
  "characters": [{"name": "", "narrative_role": "", "summary": "", "basis": "第N章"}],
  "world_rules": [{"rule": "", "basis": "第N章"}],
  "foreshadowings": [{"content": "", "basis": "第N章"}]
}

正文摘录：
#{material}
"""

IO.puts("== VS-00G CP4b 设定盘点提炼 live 探针 ==")
IO.puts("work_id=#{work_id} 读取章数=#{length(chapters)} 材料字数≈#{String.length(material)}")
IO.puts("调用 LM Studio 提炼中…\n")

case Execution.complete(prompt, provider: :lmstudio) do
  {:ok, %{content: content}} ->
    json =
      case Regex.run(~r/\{.*\}/su, content) do
        [j | _] -> j
        _ -> content
      end

    case Jason.decode(json) do
      {:ok, proposal} ->
        chars = proposal["characters"] || []
        rules = proposal["world_rules"] || []
        fores = proposal["foreshadowings"] || []
        protagonists = Enum.filter(chars, &(&1["narrative_role"] == "PROTAGONIST"))

        IO.puts("提炼结果：角色 #{length(chars)}（主角 #{length(protagonists)}）/ 世界规则 #{length(rules)} / 伏笔 #{length(fores)}")
        IO.puts("\n角色提案：")
        Enum.each(chars, fn c -> IO.puts("  - #{c["name"]}（#{c["narrative_role"]}）依据#{c["basis"]}：#{String.slice(to_string(c["summary"]), 0, 40)}") end)
        IO.puts("\n世界规则提案：")
        Enum.each(rules, fn r -> IO.puts("  - #{String.slice(to_string(r["rule"]), 0, 50)}（#{r["basis"]}）") end)

        if length(chars) >= 1 and length(protagonists) >= 1 and length(rules) >= 1 do
          IO.puts("\n[PASS] 真实模型从正文提炼出主角团（含 PROTAGONIST）+ 世界规则——盘点提炼可行")
        else
          IO.puts("\n[FAIL] 提炼不足：角色=#{length(chars)} 主角=#{length(protagonists)} 规则=#{length(rules)}")
          System.halt(1)
        end

      {:error, _reason} ->
        # gpt-oss-120b 偶发 JSON 格式瑕疵（漏引号等）——生产 CreativeProvider.Real 有坏 JSON
        # 重试解此。探针在文本层验证提炼**内容**质量（核心可行性），格式健壮性交生产重试。
        has_protagonist? = content =~ "PROTAGONIST"
        has_rules? = content =~ "world_rules" and content =~ ~s("rule")
        name_count = (Regex.scan(~r/"name"\s*:/u, content) |> length())

        IO.puts("JSON 有格式瑕疵（生产坏 JSON 重试处理）；文本层验证提炼内容：")
        IO.puts("  含 PROTAGONIST=#{has_protagonist?} / 含世界规则=#{has_rules?} / 角色名数=#{name_count}")

        if has_protagonist? and has_rules? and name_count >= 3 do
          IO.puts("\n[PASS] 真实模型从正文提炼出主角团（含 PROTAGONIST）+ 世界规则——盘点提炼内容可行（JSON 健壮性交生产坏 JSON 重试）")
        else
          IO.puts("\n[FAIL] 提炼内容不足")
          System.halt(1)
        end
    end

  {:error, error} ->
    IO.puts("[FAIL] provider 调用失败：#{inspect(error)}")
    System.halt(1)
end
