defmodule NovelAgent.Provider.CapabilityProfileTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.Anthropic
  alias NovelAgent.Provider.CapabilityProfile
  alias NovelAgent.Provider.Gateway
  alias NovelAgent.Provider.RequestIR
  alias NovelAgent.Provider.RequestIR.Operation
  alias NovelAgent.Provider.RuntimeConfig

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
    def complete(_state, _model, _prompt, _params), do: {:ok, Result.new("text")}

    @impl true
    def health_check(_state), do: :ok

    @impl true
    def name, do: "text_only"

    # 只有真正可证的传输能力：单轮文本 + usage。
    @impl true
    def capabilities(_state), do: %{native_multi_turn: true, usage: true}
  end

  setup do
    old_extra = Application.get_env(:novel_agent, :extra_providers)
    RuntimeConfig.reset()

    Application.put_env(:novel_agent, :extra_providers, %{
      text_only: TextOnlyProvider
    })

    on_exit(fn ->
      RuntimeConfig.reset()

      if old_extra do
        Application.put_env(:novel_agent, :extra_providers, old_extra)
      else
        Application.delete_env(:novel_agent, :extra_providers)
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

  describe "能力事实来源" do
    test "Gateway 按实际 route 暴露完整必备能力，而不是只报 streaming/cancellation" do
      caps = Gateway.provider_capabilities()

      for capability <- RequestIR.required_capabilities() do
        assert Map.fetch!(caps, capability) == true,
               "Gateway.provider_capabilities/0 必须暴露 #{capability}"
      end

      RuntimeConfig.put_current_provider(:text_only)
      caps = Gateway.provider_capabilities()

      assert caps.provider == :text_only
      assert caps[:native_multi_turn] == true
      assert caps[:usage] == true
      assert caps[:tool_calls] == false
      assert caps[:tool_results] == false
      assert caps[:streaming] == false
      assert caps[:structured_output] == false
    end

    test "所有已注册 provider 都声明可证能力，没有漏声明导致设置页/门槛误判" do
      previous = Application.get_env(:novel_agent, :extra_providers)
      Application.delete_env(:novel_agent, :extra_providers)
      RuntimeConfig.reset()

      try do
        providers = Gateway.registered_providers()
        assert length(providers) == 12

        for provider <- providers do
          facts = Gateway.capability_profile_for(provider)

          assert facts.missing == [],
                 "#{provider} 未声明必备能力: #{inspect(facts.missing)}"

          assert facts.profile[:streaming] == true,
                 "#{provider} 默认 chat wire 的流式能力应可证"
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

  describe "执行边界按实际 route 做最终能力门槛" do
    test "投影边界通过的 IR 请求，执行到缺能力 route 时被拒绝且不调用 adapter" do
      assert {:ok, ir} = Operation.prepare(nil, @run, specification())
      assert {:ok, prompt} = RequestIR.to_provider_prompt(ir)
      assert %{} = Map.fetch!(prompt, :capability_profile)

      # 投影时默认 route（stub）能力齐全；执行时实际 route 切到缺能力 provider：
      # 执行边界必须以同一个 route 解析函数派生的能力为准拒绝，而不是信任投影声明。
      RuntimeConfig.put_current_provider(:text_only)

      assert {:error, %{error: error}} =
               Gateway.execute(prompt, nil, %NovelAgent.Provider.InferenceParams{}, [])

      assert error.type == :invalid_request
      assert error.retryable == false
      assert error.message =~ "传输能力"
      assert Enum.sort(error.details.missing_capabilities) ==
               [:streaming, :structured_output, :tool_calls, :tool_results]

      refute_received :text_only_adapter_called
    end

    test "同一 route 身份时执行边界信任投影携带的能力事实，不重复派生判缺失" do
      RuntimeConfig.put_current_provider(:text_only)

      # 人为构造「已经按当前 route 派生并校验过」的 IR 请求形状（真实链路由
      # to_provider_prompt/2 生成）：身份一致时执行边界只信任、不二次派生。
      facts = Gateway.capability_profile()

      prompt = %{
        messages: [%{role: "user", content: "fixture"}],
        tools: [],
        tool_choice: nil,
        ir_version: "authoring-request-ir/v1",
        capability_profile: Map.new(RequestIR.required_capabilities(), &{&1, true}),
        provider_route: %{
          provider: facts.provider,
          model: facts.model,
          projection_target: facts.projection_target
        }
      }

      assert {:ok, %{result: %NovelAgent.Provider.Result{content: "text"}}} =
               Gateway.execute(prompt, nil, %NovelAgent.Provider.InferenceParams{}, [])

      assert_received :text_only_adapter_called
    end

    test "同一条 route 能力齐全时执行边界放行" do
      assert {:ok, ir} = Operation.prepare(nil, @run, specification())
      assert {:ok, prompt} = RequestIR.to_provider_prompt(ir)

      assert {:ok, %{result: %NovelAgent.Provider.Result{}}} =
               Gateway.execute(prompt, nil, %NovelAgent.Provider.InferenceParams{}, [])
    end
  end

  describe "finite_mode 必须覆盖缺失能力" do
    defp projection_with(finite_mode) do
      %{
        target: "chat_completions",
        capability_profile: %{native_multi_turn: true, usage: true},
        finite_mode: finite_mode
      }
    end

    defp ir_with_projection(projection) do
      RequestIR.new(%{
        run: %{run_id: "run-finite-mode", work_id: "work-finite-mode"},
        system: %{identity_ref: "identity:fixture"},
        messages: [RequestIR.message(:user, :author, [RequestIR.text_block("fixture")])],
        projection: projection
      })
    end

    test "未覆盖缺失项的 finite_mode 不能绕过拒绝路由" do
      for finite_mode <- [
            %{name: "no_streaming"},
            %{name: "standalone_operation"},
            %{name: "no_tools", not_supported: [:tool_calls]}
          ] do
        ir = ir_with_projection(projection_with(finite_mode))

        assert {:error, {:unsupported_capability, missing}} =
                 RequestIR.to_provider_prompt(ir)

        assert :tool_results in missing
        assert :structured_output in missing
      end
    end

    test "覆盖全部缺失项的有限模式（按 name 或 not_supported 显式声明）可通过" do
      ir = ir_with_projection(projection_with(%{name: "legacy_prompt"}))
      assert {:ok, prompt} = RequestIR.to_provider_prompt(ir)
      assert prompt.finite_mode == %{name: "legacy_prompt"}

      projection =
        projection_with(%{
          name: "no_streaming",
          not_supported: [:tool_calls, :tool_results, :streaming, :structured_output]
        })

      assert {:ok, prompt} = RequestIR.to_provider_prompt(ir_with_projection(projection))
      assert prompt.finite_mode.not_supported == [
               :tool_calls,
               :tool_results,
               :streaming,
               :structured_output
             ]
    end
  end

  describe "生产者不再写死必备能力" do
    test "Operation 构造的 projection 不携带全 true 能力声明" do
      assert {:ok, ir} = Operation.prepare(nil, @run, specification())
      profile = Map.get(ir.projection, :capability_profile) || %{}
      refute profile[:tool_calls]
      refute profile[:streaming]
    end

    test "缺必备能力的真实 route 在投影时被拒绝路由并给出缺失清单" do
      RuntimeConfig.put_current_provider(:text_only)

      assert {:ok, ir} = Operation.prepare(nil, @run, specification())

      assert {:error, {:unsupported_capability, missing}} = RequestIR.to_provider_prompt(ir)
      assert :tool_calls in missing
      assert :tool_results in missing
      assert :streaming in missing
      assert :structured_output in missing
      refute :native_multi_turn in missing
      refute :usage in missing
    end

    test "能力齐全的真实 route 仍可投影，并携带能力事实供传输边界消费" do
      assert {:ok, ir} = Operation.prepare(nil, @run, specification())
      assert {:ok, prompt} = RequestIR.to_provider_prompt(ir)

      assert %{} = profile = Map.fetch!(prompt, :capability_profile)

      for capability <- RequestIR.required_capabilities() do
        assert profile[capability] == true
      end
    end
  end
end
