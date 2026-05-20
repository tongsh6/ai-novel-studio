defmodule NovelWeb.WorkspaceChannelLoggingTest do
  use ExUnit.Case, async: false

  import Phoenix.ChannelTest

  alias NovelWeb.UserSocket
  alias NovelWeb.WorkspaceChannel

  @endpoint NovelWeb.Endpoint

  setup do
    old_enabled = Application.get_env(:novel_common, :log_jsonl_enabled)
    old_dir = Application.get_env(:novel_common, :log_jsonl_dir)

    log_dir =
      Path.join(System.tmp_dir!(), "novel-channel-log-#{System.unique_integer([:positive])}")

    Application.put_env(:novel_common, :log_jsonl_enabled, true)
    Application.put_env(:novel_common, :log_jsonl_dir, log_dir)

    on_exit(fn ->
      restore_env(:log_jsonl_enabled, old_enabled)
      restore_env(:log_jsonl_dir, old_dir)
      File.rm_rf(log_dir)
    end)

    {:ok, log_dir: log_dir}
  end

  test "user_message start log preserves generate_micro_plan contract", %{log_dir: log_dir} do
    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

    push(socket, "user_message", %{
      "text" => "我想调整或新增伏笔",
      "generate_micro_plan" => true
    })

    assert_broadcast("turn_result", %{turn_id: _})

    records = eventually_read_records(log_dir)
    record = Enum.find(records, &(&1["event"] == "channel.user_message.start"))

    assert record["generate_micro_plan"] == true
  end

  defp eventually_read_records(log_dir, attempts \\ 40)

  defp eventually_read_records(log_dir, 0) do
    records = read_records_if_present(log_dir)

    flunk(
      "timed out waiting for channel JSONL events; got #{inspect(Enum.map(records, & &1["event"]))}"
    )
  end

  defp eventually_read_records(log_dir, attempts) do
    records = read_records_if_present(log_dir)

    if Enum.any?(records, &(&1["event"] == "channel.user_message.start")) do
      records
    else
      Process.sleep(25)
      eventually_read_records(log_dir, attempts - 1)
    end
  end

  defp read_records_if_present(log_dir) do
    path = Path.join(log_dir, "#{NovelCommon.LogFileDate.today_iso8601()}.jsonl")

    if File.exists?(path) do
      path
      |> File.read!()
      |> String.split("\n", trim: true)
      |> Enum.map(&Jason.decode!/1)
    else
      []
    end
  end

  defp restore_env(key, nil), do: Application.delete_env(:novel_common, key)
  defp restore_env(key, value), do: Application.put_env(:novel_common, key, value)
end
