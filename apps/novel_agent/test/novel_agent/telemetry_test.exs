defmodule NovelAgent.TelemetryTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Telemetry

  describe "handle_event/4" do
    setup do
      tmp_dir = Path.join(System.tmp_dir!(), "tel_test_#{System.unique_integer()}")
      File.mkdir_p!(tmp_dir)
      Application.put_env(:novel_agent, :audit_log_dir, tmp_dir)

      on_exit(fn ->
        File.rm_rf!(tmp_dir)
        Application.delete_env(:novel_agent, :audit_log_dir)
      end)

      {:ok, tmp_dir: tmp_dir}
    end

    test "writes event to audit log", %{tmp_dir: tmp_dir} do
      Telemetry.handle_event(
        [:novel_agent, :test],
        %{count: 1},
        %{action: :test_action},
        :ok
      )

      path = Path.join(tmp_dir, "audit.jsonl")
      assert File.exists?(path)

      content = File.read!(path)
      entry = Jason.decode!(String.trim(content))
      assert entry["event"] == ["novel_agent", "test"]
      assert entry["measurements"]["count"] == 1
      assert entry["metadata"]["action"] == "test_action"
    end
  end
end
