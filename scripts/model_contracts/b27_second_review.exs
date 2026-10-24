#!/usr/bin/env elixir
# B27 CP4 retest6：门限附近/争议 case 的第二方复核（作者裁决）。
#
# 原则：第二方复核是**旁路证据**，只写 `<review>/second-review/`，不修改主 judgments、
# 不参与 --score、不改变主判决与阈值。实现两种模式：
#   1) human：读取人工/作者复核 JSON（按 blind_id），生成复核记录 + 与主判的一致性汇总；
#   2) judge：把主 review-strata 复制到 second-review/judge-arm/，用**另一个 judge 模型**
#      只对选定争议 case 重判；输出与主判对照 summary，不覆盖主判。
#
# 用法：
#   mix run --no-compile scripts/model_contracts/b27_second_review.exs --mode select --review <review-strata>
#   mix run --no-compile scripts/model_contracts/b27_second_review.exs --mode human --review <review-strata> \
#     --human-input <human_reviews.json> [--cases M08,M14,M16,M20] [--out <dir>]
#   mix run --no-compile scripts/model_contracts/b27_second_review.exs --mode judge --review <review-strata> \
#     --model <second-judge-model> [--cases ...] [--run]
#
# human_reviews.json 形态：{"<blind_id>": {"reviewer":"author","verdict":"pass|fail","notes":"...","evidence_refs":["..."]}}

defmodule B27SecondReview do
  @disputed_default ["M08", "M14", "M16", "M20"]

  def main(argv) do
    opts =
      parse_args(argv, %{
        mode: "select",
        review: nil,
        out: nil,
        cases: @disputed_default,
        human_input: nil,
        model: nil,
        run: false
      })

    case opts.mode do
      "select" -> do_select(opts)
      "human" -> do_human(opts)
      "judge" -> do_judge(opts)
      _ -> usage()
    end
  end

  defp parse_args([], acc), do: acc

  defp parse_args(["--mode", value | rest], acc), do: parse_args(rest, %{acc | mode: value})
  defp parse_args(["--review", value | rest], acc), do: parse_args(rest, %{acc | review: value})
  defp parse_args(["--out", value | rest], acc), do: parse_args(rest, %{acc | out: value})

  defp parse_args(["--human-input", value | rest], acc),
    do: parse_args(rest, %{acc | human_input: value})

  defp parse_args(["--model", value | rest], acc), do: parse_args(rest, %{acc | model: value})
  defp parse_args(["--run" | rest], acc), do: parse_args(rest, %{acc | run: true})

  defp parse_args(["--cases", value | rest], acc),
    do: parse_args(rest, %{acc | cases: String.split(value, ",", trim: true)})

  defp parse_args(["--help" | _], _acc) do
    usage()
    System.halt(0)
  end

  defp parse_args([other | _], _acc) do
    IO.puts("未知参数: #{other}")
    usage()
    System.halt(2)
  end

  defp usage do
    IO.puts("""
    B27 second-party review（旁路；不改主判/阈值/--score）

      --mode select|human|judge   默认 select
      --review <review-strata>    必填（含 blind-index.json/judgments/templates）
      --out <dir>                 默认 <review>/second-review
      --cases M08,M14,M16,M20     争议 case 列表（默认 #{Enum.join(@disputed_default, ",")}）
      --human-input <json>        human 模式必填
      --model <model>             judge 模式必填（第二 judge，须不同于主 judge 模型）
      --run                       judge 模式是否实际调用第二 judge（默认只准备副本并打印命令）
    """)
  end

  # ── select：窗口内争议 episode 选择 ─────────────────────────────────────
  defp do_select(opts) do
    review = require_review!(opts.review)
    entries = load_entries(review, opts.cases)

    IO.puts(
      "[second-review] review=#{review} cases=#{Enum.join(opts.cases, ",")} integrated_episodes=#{length(entries)}"
    )

    for entry <- entries do
      j = load_judgment(review, entry["blind_id"])
      reasons = dispute_reasons(j)

      IO.puts(
        "  #{entry["case_id"]} r#{entry["run_index"]} #{entry["blind_id"]} primary_success=#{j["semantic_success"]} 争议原因=#{inspect(reasons)}"
      )
    end
  end

  # ── human：作者/人工复核记录 ───────────────────────────────────────────
  defp do_human(opts) do
    review = require_review!(opts.review)
    out = opts.out || Path.join(review, "second-review")
    human_input = opts.human_input || abort("human 模式需要 --human-input <json>")
    human = read_json!(human_input)
    entries = load_entries(review, opts.cases)
    File.mkdir_p!(Path.join(out, "records"))

    records =
      Enum.map(entries, fn entry ->
        blind_id = entry["blind_id"]
        record = human[blind_id] || human["#{entry["case_id"]}/run#{entry["run_index"]}"]

        if is_nil(record) do
          %{
            "blind_id" => blind_id,
            "case_id" => entry["case_id"],
            "run_index" => entry["run_index"],
            "mode" => "human",
            "status" => "missing",
            "note" => "未提供该 episode 的人工复核记录"
          }
        else
          primary = load_judgment(review, blind_id)

          rec = %{
            "schema" => "b27-second-review-record-v1",
            "blind_id" => blind_id,
            "case_id" => entry["case_id"],
            "run_index" => entry["run_index"],
            "mode" => "human",
            "reviewer" => record["reviewer"] || "unknown",
            "verdict" => record["verdict"],
            "notes" => record["notes"],
            "evidence_refs" => record["evidence_refs"] || [],
            "primary_judgment" => %{
              "semantic_success" => primary["semantic_success"],
              "allowed_path_ok" => primary["allowed_path_ok"],
              "zero_tolerance_violation" => primary["zero_tolerance_violation"],
              "unnecessary_question" => primary["unnecessary_question"],
              "unavailable_reason" => primary["unavailable_reason"]
            }
          }

          File.write!(
            Path.join([out, "records", "#{blind_id}.json"]),
            Jason.encode!(rec, pretty: true)
          )

          rec
        end
      end)

    summary =
      build_summary(out, review, entries, records, %{
        "mode" => "human",
        "reviewer_file" => human_input
      })

    IO.puts("[second-review] records=#{length(records)} summary=#{summary}")
  end

  # ── judge：第二 judge 臂（复制目录重判，不覆盖主判） ─────────────────────
  defp do_judge(opts) do
    review = require_review!(opts.review)
    out = opts.out || Path.join(review, "second-review")
    model = opts.model || abort("judge 模式需要 --model <second-judge-model>")
    judge_arm = Path.join(out, "judge-arm")
    File.mkdir_p!(out)
    copy_review!(review, judge_arm)

    judge_script = Path.join([File.cwd!(), "scripts/model_contracts/b27_blind_judge.exs"])
    cases = Enum.join(opts.cases, ",")

    cmd =
      "mix run --no-compile #{judge_script} --review #{judge_arm} --model #{model} --cases #{cases}"

    if opts.run do
      {output, status} =
        System.cmd(
          "mix",
          [
            "run",
            "--no-compile",
            judge_script,
            "--review",
            judge_arm,
            "--model",
            model,
            "--cases",
            cases
          ],
          stderr_to_stdout: true,
          env: [{"MIX_ENV", "test"}]
        )

      File.write!(Path.join(out, "judge-arm-run.log"), output)
      if status != 0, do: abort("第二 judge 运行失败，见 #{Path.join(out, "judge-arm-run.log")}")
    else
      File.write!(Path.join(out, "judge-arm-command.txt"), cmd <> "\n")
      IO.puts("[second-review] 已准备第二 judge 副本：#{judge_arm}")
      IO.puts("[second-review] 运行命令（须不同 judge 模型；不覆盖主判）：#{cmd}")
    end

    entries = load_entries(review, opts.cases)

    records =
      Enum.map(entries, fn entry ->
        second_path = Path.join([judge_arm, "judgments", "#{entry["blind_id"]}.json"])

        if File.exists?(second_path) do
          second = read_json!(second_path)["judgment"]
          primary = load_judgment(review, entry["blind_id"])

          rec = %{
            "schema" => "b27-second-review-record-v1",
            "blind_id" => entry["blind_id"],
            "case_id" => entry["case_id"],
            "run_index" => entry["run_index"],
            "mode" => "judge",
            "reviewer" => "second_judge:#{model}",
            "verdict" => if(second["semantic_success"], do: "pass", else: "fail"),
            "notes" => second["notes"],
            "second_judgment" => second,
            "primary_judgment" => %{
              "semantic_success" => primary["semantic_success"],
              "allowed_path_ok" => primary["allowed_path_ok"],
              "zero_tolerance_violation" => primary["zero_tolerance_violation"],
              "unnecessary_question" => primary["unnecessary_question"],
              "unavailable_reason" => primary["unavailable_reason"]
            }
          }

          File.mkdir_p!(Path.join(out, "records"))

          File.write!(
            Path.join([out, "records", "#{entry["blind_id"]}.json"]),
            Jason.encode!(rec, pretty: true)
          )

          rec
        else
          %{
            "blind_id" => entry["blind_id"],
            "case_id" => entry["case_id"],
            "run_index" => entry["run_index"],
            "mode" => "judge",
            "status" => "pending",
            "note" => "第二 judge 尚未产出该 blind_id 的 judgment"
          }
        end
      end)

    summary = build_summary(out, review, entries, records, %{"mode" => "judge", "model" => model})
    IO.puts("[second-review] records=#{length(records)} summary=#{summary}")
  end

  # ── 汇总（旁路，不参与 --score） ────────────────────────────────────────
  defp build_summary(out, _review, entries, records, meta) do
    compared =
      records
      |> Enum.map(fn rec ->
        primary_success = get_in(rec, ["primary_judgment", "semantic_success"])
        second_verdict = rec["verdict"]

        Map.merge(rec, %{
          "agreement" =>
            cond do
              is_nil(second_verdict) -> "missing"
              primary_success == (second_verdict == "pass") -> "agree"
              true -> "disagree"
            end
        })
      end)

    summary = %{
      "schema" => "b27-second-review-summary-v1",
      "mode" => meta["mode"],
      "generated_at" => DateTime.utc_now() |> DateTime.to_iso8601(),
      "does_not_change_main_score" => true,
      "note" => "第二方复核为作者裁决旁路记录；不修改主 judgments/score，不改变阈值/主判决。",
      "cases" => Enum.map(entries, & &1["case_id"]) |> Enum.uniq(),
      "episode_count" => length(entries),
      "compared" => compared,
      "counts" => %{
        "agree" => Enum.count(compared, &(&1["agreement"] == "agree")),
        "disagree" => Enum.count(compared, &(&1["agreement"] == "disagree")),
        "missing" => Enum.count(compared, &(&1["agreement"] == "missing"))
      }
    }

    path = Path.join(out, "second-review-summary.json")
    File.write!(path, Jason.encode!(summary, pretty: true))
    write_summary_md(out, summary)
    path
  end

  defp write_summary_md(out, summary) do
    lines = [
      "# 第二方复核汇总（旁路，不参与 --score）",
      "",
      "- generated_at: #{summary["generated_at"]}",
      "- mode: #{summary["mode"]}",
      "- cases: #{Enum.join(summary["cases"], ", ")}",
      "- counts: #{inspect(summary["counts"])}",
      "- **does_not_change_main_score = true**（不修改主判/阈值/--score）",
      "",
      "| case | run | blind_id | primary | second | agreement |",
      "|---|---|---|---|---|---|"
    ]

    rows =
      Enum.map(summary["compared"], fn rec ->
        "| #{rec["case_id"]} | #{rec["run_index"]} | #{rec["blind_id"]} | #{get_in(rec, ["primary_judgment", "semantic_success"])} | #{rec["verdict"] || rec["status"]} | #{rec["agreement"]} |"
      end)

    File.write!(
      Path.join(out, "second-review-summary.md"),
      Enum.join(lines ++ rows, "\n") <> "\n"
    )
  end

  # ── IO/entry helpers ───────────────────────────────────────────────────
  defp require_review!(nil), do: abort("缺少 --review <review-strata>")

  defp require_review!(review) do
    unless File.exists?(Path.join(review, "blind-index.json")),
      do: abort("review 目录缺少 blind-index.json: #{review}")

    review
  end

  defp load_entries(review, cases) do
    index = read_json!(Path.join(review, "blind-index.json"))

    index["entries"]
    |> Enum.filter(fn e -> e["arm"] == "integrated" and e["case_id"] in cases end)
    |> Enum.sort_by(fn e -> {e["case_id"], e["run_index"]} end)
  end

  defp load_judgment(review, blind_id) do
    read_json!(Path.join([review, "judgments", "#{blind_id}.json"]))["judgment"]
  end

  defp dispute_reasons(j) do
    []
    |> then(fn acc -> if j["semantic_success"], do: acc, else: acc ++ ["semantic_fail"] end)
    |> then(fn acc ->
      if j["zero_tolerance_violation"], do: acc ++ ["zero_tolerance"], else: acc
    end)
    |> then(fn acc -> if j["unavailable_reason"], do: acc ++ ["unavailable"], else: acc end)
    |> then(fn acc ->
      if j["unnecessary_question"], do: acc ++ ["unnecessary_question"], else: acc
    end)
  end

  defp copy_review!(source, dest) do
    File.rm_rf!(dest)
    File.mkdir_p!(dest)

    for entry <- File.ls!(source) do
      if entry != "second-review",
        do: File.cp_r!(Path.join(source, entry), Path.join(dest, entry))
    end
  end

  defp read_json!(path) do
    case File.read(path) do
      {:ok, content} -> Jason.decode!(content)
      {:error, reason} -> abort("读取失败 #{path}: #{inspect(reason)}")
    end
  end

  defp abort(message) do
    IO.puts(:stderr, "[b27-second-review] " <> message)
    System.halt(2)
  end
end

B27SecondReview.main(System.argv())
