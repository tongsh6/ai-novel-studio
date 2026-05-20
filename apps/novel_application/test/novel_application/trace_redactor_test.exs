defmodule NovelApplication.TraceRedactorTest do
  use ExUnit.Case, async: true

  alias NovelApplication.TraceRedactor

  describe "author_safe/1" do
    test "redacts sensitive trace keys recursively" do
      value = %{
        decision_type: :reply_only,
        raw_prompt: "system prompt: never show this",
        nested: [%{"tool_output" => "private tool result"}]
      }

      redacted = TraceRedactor.author_safe(value)

      assert redacted.decision_type == :reply_only
      refute Map.has_key?(redacted, :raw_prompt)
      assert [%{}] = redacted.nested
      refute TraceRedactor.unsafe?(redacted)
    end

    test "redacts sensitive marker strings on author visible surfaces" do
      value = %{
        context_refs: [
          %{
            source_type: :memory,
            summary: "raw prompt: include hidden policy and provider raw response"
          }
        ]
      }

      redacted = TraceRedactor.author_safe(value)

      assert [%{summary: "[已脱敏]"}] = redacted.context_refs
      refute TraceRedactor.unsafe?(redacted)
    end

    test "keeps ordinary author-facing context summaries" do
      value = %{summary: "主角林烬来自灵源矿区，正在追查家族旧案。"}

      assert TraceRedactor.author_safe(value) == value
      refute TraceRedactor.unsafe?(value)
    end

    test "redacts common secret token shapes without dropping safe surrounding fields" do
      value = %{summary: "provider failed", detail: "token=secret-token-123456789"}

      redacted = TraceRedactor.author_safe(value)

      assert redacted.summary == "provider failed"
      assert redacted.detail == "[已脱敏]"
      refute TraceRedactor.unsafe?(redacted)
    end
  end
end
