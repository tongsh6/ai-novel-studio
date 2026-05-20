defmodule NovelApplication.TraceRedactor do
  @moduledoc """
  Author-safe redaction for trace summaries and replay explanations.

  Raw trace facts can still exist below persistence/audit boundaries. Anything
  emitted as author-visible explanation must pass through this module first.
  """

  @redacted "[已脱敏]"

  @sensitive_keys MapSet.new([
                    "api_key",
                    "authorization",
                    "credential",
                    "hidden_policy",
                    "password",
                    "provider_raw_log",
                    "provider_raw_response",
                    "raw_prompt",
                    "raw_provider_log",
                    "raw_provider_response",
                    "secret",
                    "sensitive_memory",
                    "system_prompt",
                    "tool_input",
                    "tool_output",
                    "unredacted_memory"
                  ])

  @sensitive_markers [
    ~r/raw\s+prompt/i,
    ~r/hidden\s+policy/i,
    ~r/provider\s+raw/i,
    ~r/raw\s+provider/i,
    ~r/sensitive\s+memory/i,
    ~r/unredacted\s+memory/i,
    ~r/tool\s+(input|output|io|i\/o)/i,
    ~r/system\s+prompt/i,
    ~r/api[_\s-]*key/i,
    ~r/authorization\s*:/i,
    ~r/bearer\s+[a-z0-9._~+\/=-]{12,}/i
  ]

  @secret_patterns [
    ~r/sk-[a-zA-Z0-9_-]{12,}/,
    ~r/AKIA[0-9A-Z]{12,}/,
    ~r/(?i)(api[_\s-]*key|token|secret|password)\s*[:=]\s*["']?[^"'\s,;]+/
  ]

  @doc "Redact a value for author-visible trace/replay surfaces."
  @spec author_safe(term()) :: term()
  def author_safe(value), do: redact(value)

  @doc "Return true when the value still contains disallowed trace material."
  @spec unsafe?(term()) :: boolean()
  def unsafe?(value), do: contains_sensitive?(value)

  defp redact(value) when is_map(value) do
    value
    |> Enum.reject(fn {key, _field_value} -> sensitive_key?(key) end)
    |> Map.new(fn {key, field_value} ->
      {key, redact(field_value)}
    end)
  end

  defp redact(value) when is_list(value), do: Enum.map(value, &redact/1)

  defp redact(value) when is_binary(value) do
    if sensitive_marker?(value) do
      @redacted
    else
      Enum.reduce(@secret_patterns, value, &Regex.replace(&1, &2, @redacted))
    end
  end

  defp redact(value), do: value

  defp contains_sensitive?(value) when is_map(value) do
    Enum.any?(value, fn {key, field_value} ->
      sensitive_key?(key) or contains_sensitive?(field_value)
    end)
  end

  defp contains_sensitive?(value) when is_list(value),
    do: Enum.any?(value, &contains_sensitive?/1)

  defp contains_sensitive?(value) when is_binary(value) do
    sensitive_marker?(value) or Enum.any?(@secret_patterns, &Regex.match?(&1, value))
  end

  defp contains_sensitive?(_value), do: false

  defp sensitive_key?(key) do
    key
    |> to_string()
    |> String.downcase()
    |> then(&MapSet.member?(@sensitive_keys, &1))
  end

  defp sensitive_marker?(value), do: Enum.any?(@sensitive_markers, &Regex.match?(&1, value))
end
