# I-CACHE prefix-sharing driver (VS-00I §6.1)
#
# Run:
#   MIX_ENV=test mix run scripts/scenario_invariants/run_icache_prefix.exs
#
# This is the CP-AB "before" measurement: production JudgmentProtocol call1/call2
# prompt builders are sent through the real Gateway boundary (identity injection
# included), captured by a test-only provider, and compared byte-for-byte.
# No threshold assertion yet (I-CACHE-1 becomes blocking after CP-C).

defmodule ICachePrefixDriver do
  @moduledoc false

  alias NovelAgent.Provider.Gateway
  alias NovelApplication.JudgmentProtocol

  defmodule CaptureProvider do
    @behaviour NovelAgent.Provider

    alias NovelAgent.Provider.{AdapterExecution, Result}

    defstruct []

    @impl true
    def execute(_state, _model, prompt, params, ctx) do
      send(self(), {:icache_prompt, prompt, params})
      AdapterExecution.materialize_result({:ok, Result.new("captured")}, ctx)
    end

    @impl true
    def complete(_state, _model, _prompt, _params), do: raise("use execute/5")

    @impl true
    def health_check(_state), do: :ok

    @impl true
    def name, do: "icache_capture"
  end

  def run do
    File.mkdir_p!("artifacts/scenario-invariants")
    restore = install_capture_provider()

    try do
      continuation_input = %{
        goal_text: "写第01章正文草稿",
        deviation_summary: "工具 prose_writing 执行失败（timeout）",
        observation_block: "正文写作调用超时，计划步骤已走完但尚未生成草稿。"
      }

      conversation_input = %{
        context_block: "## 当前作品\n- title: 前缀度量样书",
        author_text: "把第01章写得更紧凑",
        options: []
      }

      rows = [
        pair(
          "continuation",
          JudgmentProtocol.continuation_narrative_prompt(continuation_input),
          JudgmentProtocol.continuation_decision_prompt(
            continuation_input,
            "我看到了超时；先缩小单次产出范围，再决定是否停等作者。"
          )
        ),
        pair(
          "conversation",
          JudgmentProtocol.narrative_prompt(conversation_input),
          JudgmentProtocol.decision_prompt(
            conversation_input,
            "你要的是一个明确的创作动作，我准备直接执行。"
          )
        )
      ]

      markdown = render_markdown(rows)
      File.write!("artifacts/scenario-invariants/icache.md", markdown)
      unless File.exists?("artifacts/scenario-invariants/icache-before.md") do
        File.write!("artifacts/scenario-invariants/icache-before.md", markdown)
      end

      File.write!(
        "artifacts/scenario-invariants/icache.json",
        Jason.encode!(rows, pretty: true)
      )

      IO.puts("\nI-CACHE prefix sharing (CP-AB before):")
      Enum.each(rows, fn row -> IO.puts(format_row(row)) end)
    after
      restore.()
    end
  end

  defp pair(call_site, call1, call2) do
    first = capture(call1, call_site <> "-call1")
    second = capture(call2, call_site <> "-call2")
    shared = shared_prefix_bytes(first, second)
    total = min(byte_size(first), byte_size(second))

    %{
      call_site: call_site,
      pair_kind: "call_pair",
      shared_prefix_bytes: shared,
      total_bytes: total,
      ratio: if(total == 0, do: 0.0, else: Float.round(shared / total, 4))
    }
  end

  defp capture(prompt, label) do
    assert_ok(Gateway.execute(prompt, "capture-model", purpose: :planner), label)

    receive do
      {:icache_prompt, captured, _params} -> serialize(captured)
    after
      5_000 -> raise "capture provider did not receive #{label}"
    end
  end

  defp assert_ok({:ok, _}, _label), do: :ok
  defp assert_ok(other, label), do: raise("gateway failed for #{label}: #{inspect(other)}")

  # Fixed serialization from VS-00I §6.1: role + "\n" + content in order, then
  # canonical JSON tools at the end (map keys sorted).
  defp serialize(%{messages: messages} = prompt) do
    Enum.map_join(messages, "", fn message ->
      "#{message.role}\n#{message.content}"
    end) <> canonical(Map.get(prompt, :tools, []))
  end

  defp serialize(messages) when is_list(messages) do
    Enum.map_join(messages, "", fn message -> "#{message.role}\n#{message.content}" end)
  end

  defp canonical(map) when is_map(map) do
    keys = map |> Map.keys() |> Enum.sort_by(&to_string/1)

    "{" <>
      Enum.map_join(keys, ",", fn key ->
        Jason.encode!(to_string(key)) <> ":" <> canonical(Map.get(map, key))
      end) <> "}"
  end

  defp canonical(list) when is_list(list), do: "[" <> Enum.map_join(list, ",", &canonical/1) <> "]"
  defp canonical(value), do: Jason.encode!(value)

  defp shared_prefix_bytes(left, right) do
    left
    |> :binary.bin_to_list()
    |> Enum.zip(:binary.bin_to_list(right))
    |> Enum.take_while(fn {a, b} -> a == b end)
    |> length()
  end

  defp render_markdown(rows) do
    lines = [
      "# I-CACHE prefix sharing (VS-00I §6.1)",
      "",
      "Generated: #{DateTime.utc_now() |> DateTime.to_iso8601()}",
      "Provider: test-only capture at Gateway boundary (identity injected)",
      "",
      "| call_site | pair_kind | shared_prefix_bytes | total_bytes | ratio |",
      "|---|---|---:|---:|---:|"
    ]

    rows_md =
      Enum.map(rows, fn row ->
        "| #{row.call_site} | #{row.pair_kind} | #{row.shared_prefix_bytes} | #{row.total_bytes} | #{row.ratio} |"
      end)

    Enum.join(lines ++ rows_md, "\n") <> "\n"
  end

  defp format_row(row) do
    "#{row.call_site} #{row.pair_kind}: #{row.shared_prefix_bytes}/#{row.total_bytes} (#{row.ratio})"
  end

  defp install_capture_provider do
    old_extra = Application.get_env(:novel_agent, :extra_providers)
    old_provider = Application.get_env(:novel_agent, :provider)

    extra =
      (old_extra || %{})
      |> Map.put(:icache_capture, CaptureProvider)

    Application.put_env(:novel_agent, :extra_providers, extra)
    Application.put_env(:novel_agent, :provider, default: :icache_capture)
    NovelAgent.Provider.RuntimeConfig.reset()

    fn ->
      NovelAgent.Provider.RuntimeConfig.reset()

      if old_extra,
        do: Application.put_env(:novel_agent, :extra_providers, old_extra),
        else: Application.delete_env(:novel_agent, :extra_providers)

      if old_provider,
        do: Application.put_env(:novel_agent, :provider, old_provider),
        else: Application.delete_env(:novel_agent, :provider)
    end
  end
end

ICachePrefixDriver.run()
