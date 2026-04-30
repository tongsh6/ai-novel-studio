defmodule NovelAgent.Router do
  @moduledoc """
  Router — 识别 intent + 抽取 slots。

  两步都走 LLM（Provider Gateway）：
  1. classify_intent — LLM 分类用户意图到已注册 intent
  2. extract_slots  — LLM 根据 slot schema 从用户消息中抽取 slot 值

  LLM 不可用时返回 :unknown（触发 clarification），不假装理解用户输入。
  """

  require Logger

  alias NovelAgent.IntentRegistry
  alias NovelAgent.IntentRegistry.SlotSchema
  alias NovelAgent.Provider.Gateway
  alias NovelAgent.Router.Result

  @doc "对用户输入文本做路由。返回 Router.Result struct。"
  @spec route(String.t()) :: Result.t()
  def route(text) when is_binary(text) do
    do_route(text, Gateway)
  end

  @doc false
  @spec route(String.t(), module()) :: Result.t()
  def route(text, gateway_mod) when is_binary(text) do
    do_route(text, gateway_mod)
  end

  defp do_route(text, gateway_mod) do
    intent_name = classify_intent(text, gateway_mod)

    case IntentRegistry.get(intent_name) do
      nil ->
        %Result{
          intent_name: :unknown,
          schema_id: nil,
          extracted_slots: %{},
          missing_required_slots: [],
          needs_clarification: true,
          deferred_to_runtime: []
        }

      schema ->
        extracted = extract_slots(text, schema, gateway_mod)
        missing = missing_blocking(schema, extracted)
        meta = IntentRegistry.meta(intent_name) || %{risk_class: "low", requires_confirmation: false}

        %Result{
          intent_name: schema.intent_name,
          schema_id: schema.schema_id,
          extracted_slots: extracted,
          missing_required_slots: missing,
          needs_clarification: missing != [],
          deferred_to_runtime: schema.deferred_to_runtime,
          requires_confirmation: meta.requires_confirmation,
          risk_class: meta.risk_class
        }
    end
  end

  # ---- Step 1: Intent classification ----

  defp classify_intent(text, gateway_mod) do
    prompt = IntentRegistry.classification_prompt() <> "\n\n用户消息：#{text}"

    case gateway_mod.complete(prompt) do
      {:ok, result} ->
        parsed = String.trim(result) |> String.replace(~r/["'`]/, "")

        if String.starts_with?(parsed, "intent.") and IntentRegistry.get(parsed) != nil do
          Logger.debug("[路由] LLM 分类为 #{parsed}")
          parsed
        else
          Logger.debug("[路由] LLM 分类结果不可识别：#{inspect(parsed)}")
          :unknown
        end

      {:error, error} ->
        Logger.warning("[路由] LLM 不可用，无法分类意图：#{inspect(error)}")
        :unknown
    end
  end

  # ---- Step 2: Slot extraction ----

  defp extract_slots(text, %SlotSchema{} = schema, gateway_mod) do
    prompt = IntentRegistry.slot_extraction_prompt(schema.intent_name)
    full_prompt = "#{prompt}\n\n用户消息：#{text}"

    case gateway_mod.complete(full_prompt) do
      {:ok, result} ->
        case Jason.decode(String.trim(result)) do
          {:ok, slots} when is_map(slots) ->
            Logger.debug("[路由] LLM 抽取到 #{map_size(slots)} 个 slot")
            stringify_keys(slots)

          {:error, _} ->
            Logger.warning("[路由] LLM slot 抽取返回了无效 JSON")
            %{}
        end

      {:error, error} ->
        Logger.warning("[路由] LLM 不可用，无法抽取 slot：#{inspect(error)}")
        %{}
    end
  end

  defp stringify_keys(map) do
    Map.new(map, fn {k, v} -> {to_string(k), to_string(v)} end)
  end

  defp missing_blocking(%SlotSchema{} = schema, extracted) do
    schema
    |> SlotSchema.blocking_slots()
    |> Enum.reject(&Map.has_key?(extracted, &1))
  end
end
