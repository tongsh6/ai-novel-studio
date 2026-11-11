defmodule NovelCommon.CapabilityProfileTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.Anthropic

  alias NovelAgent.Provider.{
    DeepSeek,
    Gemini,
    Kimi,
    LMStudio,
    Minimax,
    MinimaxCN,
    OpenAI,
    OpenAISubscription,
    Splash,
    Strata,
    Zhipu
  }

  alias NovelAgent.Provider.Gateway
  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.Result
  alias NovelAgent.Provider.RuntimeConfig
  alias NovelCommon.CapabilityProfile
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Operation

  @run %{run_id: "run-capability", work_id: "work-capability"}

  # 真实的 route 能力事实来源是 adapter 自身：这个测试 provider 只做文本传输，
  # 没有原生工具、结构化输出与流式解析能力。任何把必备能力默认置 true 的声明
  # 都会把它伪装成完整 AgentRun provider（VS-00L §6.4 / §10）。
  defmodule TextOnlyProvider do
    @behaviour NovelAgent.Provider

    alias NovelAgent.Provider.AdapterExecution
    alias NovelAgent.Provider.Result

    defstruct []

    @impl true
    def execute(_state, _model, _prompt, _params, ctx) do
      send(self(), :text_only_adapter_called)
      AdapterExecution.materialize_result({:ok, Result.new("text")}, ctx)
    end

    @impl true
    def health_check(_state), do: :ok

    @impl true
    def name, do: "text_only"

    # 只有真正可证的传输能力：单轮文本 + usage。
    @impl true
    def capabilities(_state), do: %{native_multi_turn: true, usage: true}

    @impl true
    def projection_target(_state), do: "chat_completions"
  end

  defmodule CompleteProvider do
    @behaviour NovelAgent.Provider

    alias NovelAgent.Provider.AdapterExecution
    alias NovelAgent.Provider.Result
    alias NovelCommon.RequestIR

    defstruct []

    @impl true
    def execute(_state, _model, %RequestIR{}, _params, ctx) do
      send(self(), :complete_adapter_called)
      AdapterExecution.materialize_result({:ok, Result.new("text")}, ctx)
    end

    def complete(_state, _model, _prompt, _params), do: {:ok, Result.new("text")}

    @impl true
    def health_check(_state), do: :ok

    @impl true
    def name, do: "complete"

    @impl true
    def capabilities(_state) do
      Map.new(RequestIR.required_capabilities(), &{&1, true})
    end

    @impl true
    def projection_target(_state), do: "chat_completions"
  end

  setup do
    old_extra = Application.get_env(:novel_agent, :extra_providers)
    old_provider = Application.get_env(:novel_agent, :provider)
    RuntimeConfig.reset()

    Application.put_env(
      :novel_agent,
      :extra_providers,
      Map.merge(Map.new(old_extra || []), %{
        text_only: TextOnlyProvider,
        complete: CompleteProvider
      })
    )

    Application.put_env(:novel_agent, :provider, default: :complete)

    on_exit(fn ->
      RuntimeConfig.reset()

      if old_extra do
        Application.put_env(:novel_agent, :extra_providers, old_extra)
      else
        Application.delete_env(:novel_agent, :extra_providers)
      end

      if old_provider do
        Application.put_env(:novel_agent, :provider, old_provider)
      else
        Application.delete_env(:novel_agent, :provider)
      end
    end)

    :ok
  end

  defp specification do
    %{
      role: "planner",
      instructions: "计划规则",
      scope: "计划范围",
      tool: %{
        name: "agent_plan_draft",
        description: "计划",
        input_schema: %{type: "object"}
      }
    }
  end

  defp prepared_ir(opts \\ []) do
    assert {:ok, ir} = Operation.prepare(nil, @run, specification())
    ir = maybe_put_finite_mode(ir, Keyword.get(opts, :finite_mode))
    assert {:ok, prepared} = RequestIR.prepare_request(ir)
    prepared
  end

  defp maybe_put_finite_mode(ir, nil), do: ir

  defp maybe_put_finite_mode(ir, mode),
    do: %{ir | projection: Map.put(ir.projection, :finite_mode, mode)}

  describe "能力事实来源" do
    test "真实生产 registry 为 12 个 provider，全部 adapter 声明完整必备能力" do
      previous = Application.get_env(:novel_agent, :extra_providers)
      Application.delete_env(:novel_agent, :extra_providers)
      RuntimeConfig.reset()

      try do
        providers = Gateway.registered_providers()
        assert length(providers) == 12
        refute :stub in providers

        # 能力事实来源是 adapter 自身（VS-00L §6.4）；按生产注册表逐一核对，
        # 不依赖任何 Gateway 聚合查询或 descriptor 第二事实源。
        adapter_modules = [
          Anthropic,
          DeepSeek,
          Gemini,
          Kimi,
          LMStudio,
          Minimax,
          MinimaxCN,
          OpenAI,
          OpenAISubscription,
          Splash,
          Strata,
          Zhipu
        ]

        assert length(adapter_modules) == length(providers)

        for module <- adapter_modules do
          profile = CapabilityProfile.from_adapter(module, struct(module))
          missing = CapabilityProfile.missing(profile)

          assert missing == [],
                 "#{inspect(module)} 未声明必备能力: #{inspect(missing)}"

          assert profile[:streaming] == true,
                 "#{inspect(module)} 默认 chat wire 的流式能力应可证"
        end
      after
        RuntimeConfig.reset()

        if previous do
          Application.put_env(:novel_agent, :extra_providers, previous)
        end
      end
    end

    test "adapter 自身声明可证能力，descriptor 不代替传输事实" do
      profile = CapabilityProfile.from_adapter(Anthropic, %Anthropic{api_key: "test"})

      for capability <- RequestIR.required_capabilities() do
        assert Map.fetch!(profile, capability) == true
      end

      profile = CapabilityProfile.from_adapter(TextOnlyProvider, %TextOnlyProvider{})
      assert profile[:native_multi_turn] == true
      assert profile[:tool_calls] == false

      assert CapabilityProfile.missing(profile) == [
               :tool_calls,
               :tool_results,
               :streaming,
               :structured_output
             ]
    end
  end

  describe "执行边界按实际 route 做能力门槛" do
    test "请求构造不查默认 route；执行到缺能力 route 时拒绝且不调用 adapter" do
      RuntimeConfig.put_current_provider(:text_only)
      prepared = prepared_ir()

      assert {:error, %{error: error}} =
               Gateway.execute(prepared, nil, %InferenceParams{}, [])

      assert error.type == :invalid_request
      assert error.retryable == false
      assert error.message =~ "传输能力"

      assert Enum.sort(error.details.missing_capabilities) ==
               [:streaming, :structured_output, :tool_calls, :tool_results]

      refute_received :text_only_adapter_called
    end

    test "同一 route 能力齐全时执行边界放行" do
      prepared = prepared_ir()

      assert {:ok, %{result: %Result{content: "text"}}} =
               Gateway.execute(prepared, nil, %InferenceParams{}, provider: :complete)

      assert_received :complete_adapter_called
    end

    test "请求自带的 projection 任意字段都不参与实际 route 的能力门" do
      RuntimeConfig.put_current_provider(:text_only)

      prepared = prepared_ir()

      forged = %{
        prepared
        | projection:
            Map.merge(prepared.projection, %{
              capability_profile: Map.new(RequestIR.required_capabilities(), &{&1, true}),
              target: "chat_completions",
              fake_profile: Map.new(RequestIR.required_capabilities(), &{&1, true})
            })
      }

      assert {:error, %{error: %{details: %{missing_capabilities: missing}}}} =
               Gateway.execute(forged, nil, %InferenceParams{}, [])

      assert :tool_calls in missing
      refute_received :text_only_adapter_called
    end
  end

  describe "finite_mode 必须覆盖实际缺失能力" do
    test "未覆盖缺失项的 finite_mode 不能绕过拒绝路由" do
      RuntimeConfig.put_current_provider(:text_only)

      for finite_mode <- [
            %{name: "no_streaming"},
            %{name: "standalone_operation"},
            %{name: "no_tools", not_supported: [:tool_calls]}
          ] do
        prepared = prepared_ir(finite_mode: finite_mode)

        assert {:error, %{error: error}} =
                 Gateway.execute(prepared, nil, %InferenceParams{}, [])

        assert :tool_results in error.details.missing_capabilities
        assert :structured_output in error.details.missing_capabilities
        refute_received :text_only_adapter_called
      end
    end

    test "覆盖全部缺失项的有限模式按真实 route 放行" do
      RuntimeConfig.put_current_provider(:text_only)

      finite_mode = %{
        name: "no_tools",
        not_supported: [:streaming, :structured_output]
      }

      prepared = prepared_ir(finite_mode: finite_mode)

      assert {:ok, %{result: %Result{content: "text"}}} =
               Gateway.execute(prepared, nil, %InferenceParams{}, [])

      assert_received :text_only_adapter_called
    end
  end

  describe "生产者不再写死能力事实" do
    test "Operation 构造的 projection 不携带 target 或能力声明" do
      assert {:ok, ir} = Operation.prepare(nil, @run, specification())
      assert ir.projection == %{}
      refute Map.has_key?(ir.projection, :capability_profile)
      refute Map.has_key?(ir.projection, :target)
    end

    test "缺能力的真实 route 仍可完成请求构造，拒绝只发生在执行边界" do
      RuntimeConfig.put_current_provider(:text_only)

      prepared = prepared_ir()

      assert %RequestIR{} = prepared
      assert Enum.map(prepared.tools, & &1.name) == ["agent_plan_draft"]

      assert {:error, %{error: %{details: %{missing_capabilities: missing}}}} =
               Gateway.execute(prepared, nil, %InferenceParams{}, [])

      assert :tool_calls in missing
      refute_received :text_only_adapter_called
    end
  end
end
