defmodule NovelWeb.WorkspaceChannelLoggingTest do
  use NovelPersistence.DataCase, async: false

  import Phoenix.ChannelTest

  alias NovelWeb.UserSocket
  alias NovelWeb.WorkspaceChannel

  @endpoint NovelWeb.Endpoint

  setup do
    old_enabled = Application.fetch_env(:novel_telemetry, :log_jsonl_enabled)
    old_dir = Application.fetch_env(:novel_telemetry, :log_jsonl_dir)

    log_dir = Path.join(System.tmp_dir!(), "novel-channel-log-#{Ecto.UUID.generate()}")

    Application.put_env(:novel_telemetry, :log_jsonl_enabled, true)
    Application.put_env(:novel_telemetry, :log_jsonl_dir, log_dir)

    # 恢复/清理登记早于 Channel 与 run；其 on_exit 晚执行，先由 run/caller 资源
    # 收口，再恢复原 telemetry app/key 并删除本 case 独立目录。
    on_exit(fn ->
      restore_env(:log_jsonl_enabled, old_enabled)
      restore_env(:log_jsonl_dir, old_dir)
      File.rm_rf!(log_dir)
    end)

    {:ok, log_dir: log_dir}
  end

  test "user_message start log preserves generate_micro_plan contract", %{log_dir: log_dir} do
    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

    NovelApplication.TestAgentRunCleanup.register_task_caller(socket.channel_pid)

    ref =
      push(socket, "user_message", %{
        "text" => "我想调整或新增伏笔",
        "generate_micro_plan" => true
      })

    assert_receive %Phoenix.Socket.Reply{
                     ref: ^ref,
                     status: :ok,
                     payload: %{run_id: run_id}
                   },
                   2_000

    NovelApplication.TestAgentRunCleanup.register_run(run_id)
    assert_push("turn_result", %{turn_id: _}, 2_000)

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
    path = Path.join(log_dir, "#{NovelTelemetry.LogFileDate.today_iso8601()}.jsonl")

    if File.exists?(path) do
      path
      |> File.read!()
      |> String.split("\n", trim: true)
      |> Enum.map(&Jason.decode!/1)
    else
      []
    end
  end

  defp restore_env(key, :error), do: Application.delete_env(:novel_telemetry, key)

  defp restore_env(key, {:ok, value}),
    do: Application.put_env(:novel_telemetry, key, value)
end
