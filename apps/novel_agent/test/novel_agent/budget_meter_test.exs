defmodule NovelAgent.BudgetMeterTest do
  use ExUnit.Case, async: false

  alias NovelAgent.BudgetMeter

  describe "record/2 + usage/0" do
    test "tracks recorded action in usage map" do
      usage_before = BudgetMeter.usage()

      BudgetMeter.record(:test_metric_a, 2)

      usage_after = BudgetMeter.usage()
      assert usage_after.total == usage_before.total + 2

      assert usage_after.actions.test_metric_a ==
               (usage_before.actions[:test_metric_a] || 0) + 2
    end
  end

  describe "telemetry" do
    setup do
      handler_id = {:bmt_handler, make_ref()}
      self_pid = self()

      :telemetry.attach(
        handler_id,
        [:novel_agent, :budget, :record],
        fn _event, measurements, metadata, _config ->
          send(self_pid, {:bmt_fired, measurements.cost, metadata.action})
        end,
        :ok
      )

      on_exit(fn ->
        :telemetry.detach(handler_id)
      end)

      :ok
    end

    test "emits telemetry event on record" do
      BudgetMeter.record(:bmt_action, 3)
      assert_receive {:bmt_fired, 3, :bmt_action}, 200
    end
  end
end
