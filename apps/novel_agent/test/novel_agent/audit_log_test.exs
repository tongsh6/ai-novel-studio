defmodule NovelAgent.AuditLogTest do
  use ExUnit.Case, async: false

  alias NovelAgent.AuditLog

  setup do
    tmp_dir = Path.join(System.tmp_dir!(), "audit_test_#{System.unique_integer()}")
    File.mkdir_p!(tmp_dir)
    Application.put_env(:novel_agent, :audit_log_dir, tmp_dir)

    on_exit(fn ->
      File.rm_rf!(tmp_dir)
      Application.delete_env(:novel_agent, :audit_log_dir)
    end)

    {:ok, tmp_dir: tmp_dir}
  end

  describe "append/1" do
    test "writes valid JSONL entries", %{tmp_dir: tmp_dir} do
      AuditLog.append(%{event: "test", data: 1})
      AuditLog.append(%{event: "test", data: 2})

      path = Path.join(tmp_dir, "audit.jsonl")
      assert File.exists?(path)

      content = File.read!(path)
      lines = String.split(String.trim(content), "\n")
      assert length(lines) == 2

      [line1, line2] = lines
      assert %{"event" => "test", "data" => 1} = Jason.decode!(line1)
      assert %{"event" => "test", "data" => 2} = Jason.decode!(line2)
    end
  end

  describe "log_path/0" do
    test "uses configured dir" do
      path = AuditLog.log_path()
      assert String.contains?(path, "audit.jsonl")
    end
  end
end
