defmodule NovelAgent.Provider.HTTPTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.CancellationToken
  alias NovelAgent.Provider.HTTP
  alias NovelAgent.Provider.InferenceParams

  test "cancellation interrupts an actual silent HTTP stream without another byte or timeout" do
    {:ok, listener} = :gen_tcp.listen(0, [:binary, active: false, reuseaddr: true])
    {:ok, {_address, port}} = :inet.sockname(listener)
    {:ok, token} = CancellationToken.start_link()
    owner = self()
    frame = "data: {\"choices\":[{\"delta\":{\"content\":\"原文\"}}]}\n\n"

    server =
      Task.async(fn ->
        {:ok, socket} = :gen_tcp.accept(listener)
        consume_request(socket, "")
        chunk = Integer.to_string(byte_size(frame), 16) <> "\r\n" <> frame <> "\r\n"

        :ok =
          :gen_tcp.send(
            socket,
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n" <>
              chunk
          )

        # No further response byte, EOF or application-driven server close.
        result = :gen_tcp.recv(socket, 0, 5_000)
        send(owner, {:server_observed, result})
      end)

    request =
      Task.async(fn ->
        HTTP.post_event_stream(
          "http://127.0.0.1:#{port}/v1/chat/completions",
          %{stream: true},
          [receive_timeout: 30_000, cancellation_token: token],
          fn bytes ->
            send(owner, {:consumed, bytes})
            :cont
          end
        )
      end)

    try do
      assert_receive {:consumed, ^frame}, 2_000
      :ok = CancellationToken.cancel(token, :author_cancelled)
      assert {:ok, {:error, :cancelled, 0, _}} = Task.yield(request, 500)
      assert_receive {:server_observed, {:error, :closed}}, 500
    after
      Task.shutdown(request, :brutal_kill)
      Task.shutdown(server, :brutal_kill)
      :gen_tcp.close(listener)
      if Process.alive?(token), do: Agent.stop(token)
    end
  end

  test "current Req connect options retain the proven HTTP1 transport capability" do
    assert Req.Finch.pool_options(connect_options: [timeout: 15_000])[:protocols] == [:http1]
  end

  test "cancels before headers without closing another concurrent request" do
    a = silent_server()
    b = silent_server()
    {:ok, token_a} = CancellationToken.start_link()
    {:ok, token_b} = CancellationToken.start_link()
    request_a = stream_task(a, token_a)
    request_b = stream_task(b, token_b)

    try do
      assert_receive {:accepted, id_a}, 2_000
      assert_receive {:accepted, id_b}, 2_000
      assert MapSet.new([id_a, id_b]) == MapSet.new([a.id, b.id])
      CancellationToken.cancel(token_a)
      assert {:ok, {:error, :cancelled, 0, _}} = Task.yield(request_a, 500)
      assert_receive {:closed, aid, {:error, :closed}} when aid == a.id, 500
      b_id = b.id
      refute_receive {:closed, ^b_id, _}, 100
      assert Task.yield(request_b, 0) == nil
      CancellationToken.cancel(token_b)
      assert {:ok, {:error, :cancelled, 0, _}} = Task.yield(request_b, 500)
      assert_receive {:closed, bid, {:error, :closed}} when bid == b.id, 500
      assert :sys.get_state(token_a).subscribers == %{}
      assert :sys.get_state(token_b).subscribers == %{}
    after
      Enum.each([request_a, request_b], &Task.shutdown(&1, :brutal_kill))
      Enum.each([a, b], &stop_server/1)
      Enum.each([token_a, token_b], &GenServer.stop/1)
    end
  end

  test "caller death closes its actual socket and removes its subscription" do
    server = silent_server()
    {:ok, token} = CancellationToken.start_link()
    request = stream_task(server, token)
    Process.unlink(request.pid)

    try do
      assert_receive {:accepted, _}, 2_000
      Process.exit(request.pid, :kill)

      assert_receive {:DOWN, ref, :process, pid, :killed}
                     when ref == request.ref and pid == request.pid

      assert_receive {:closed, _, {:error, :closed}}, 500
      # The same token remains usable; DOWN is ordered before this call from the monitor.
      assert {:ok, ref} = CancellationToken.subscribe(token)
      CancellationToken.unsubscribe(token, ref)
      assert :sys.get_state(token).subscribers == %{}
    after
      stop_server(server)
      GenServer.stop(token)
    end
  end

  test "already cancelled token never dispatches and subscription races lose no notification" do
    {:ok, token} = CancellationToken.start_link()
    CancellationToken.cancel(token)

    assert {:error, :cancelled, 0, _} =
             HTTP.post_event_stream(
               "http://127.0.0.1:1",
               %{},
               [cancellation_token: token],
               fn _ -> flunk("chunk") end
             )

    assert {:error, :cancelled} = CancellationToken.subscribe(token)
    GenServer.stop(token)

    for _ <- 1..50 do
      {:ok, token} = CancellationToken.start_link()
      canceller = Task.async(fn -> CancellationToken.cancel(token) end)

      case CancellationToken.subscribe(token) do
        {:ok, ref} ->
          assert_receive {:provider_cancelled, ^ref}, 500
          CancellationToken.unsubscribe(token, ref)

        {:error, :cancelled} ->
          :ok
      end

      Task.await(canceller)
      assert CancellationToken.cancelled?(token)
      assert :sys.get_state(token).subscribers == %{}
      GenServer.stop(token)
    end
  end

  test "slow synchronous sink is not killed and cancellation closes only after it returns" do
    frame = "data: original\n\n"
    server = silent_server(frame)
    {:ok, token} = CancellationToken.start_link()
    owner = self()

    request =
      stream_task(server, token, fn ^frame ->
        send(owner, {:sink_entered, self()})
        Process.sleep(5_100)
        send(owner, :sink_completed)
        :cont
      end)

    try do
      assert_receive {:accepted, _}, 2_000
      assert_receive {:sink_entered, pid} when pid == request.pid, 2_000
      CancellationToken.cancel(token)
      assert Task.yield(request, 100) == nil
      refute_receive {:closed, _, _}, 100
      assert_receive :sink_completed, 5_500
      assert {:ok, {:error, :cancelled, 0, _}} = Task.yield(request, 500)
      assert_receive {:closed, _, {:error, :closed}}, 500
    after
      Task.shutdown(request, :brutal_kill)
      stop_server(server)
      GenServer.stop(token)
    end
  end

  test "consumer exception cleans the socket and preserves unrelated caller messages" do
    server = silent_server("data: original\n\n")
    {:ok, token} = CancellationToken.start_link()
    send(self(), :unrelated)

    try do
      assert_raise RuntimeError, "consumer failed", fn ->
        HTTP.post_event_stream(server.url, %{}, [cancellation_token: token], fn _ ->
          raise "consumer failed"
        end)
      end

      assert_receive {:closed, _, {:error, :closed}}, 500
      assert_receive :unrelated
      assert :sys.get_state(token).subscribers == %{}
      refute_receive {:provider_cancelled, _}
    after
      stop_server(server)
      GenServer.stop(token)
    end
  end

  test "trap-exit callers converge after transport death without consuming unrelated messages" do
    old_flag = Process.flag(:trap_exit, true)
    server = silent_server("data: original\n\n")
    {:ok, token} = CancellationToken.start_link()
    before_links = elem(Process.info(self(), :links), 1)
    unrelated_ref = make_ref()
    send(self(), {:DOWN, unrelated_ref, :process, self(), :unrelated})

    try do
      assert {:error, :provider_internal, 0, _} =
               HTTP.post_event_stream(server.url, %{}, [cancellation_token: token], fn _ ->
                 [worker] = elem(Process.info(self(), :links), 1) -- before_links
                 Process.exit(worker, :kill)
                 :cont
               end)

      assert_receive {:closed, _, {:error, :closed}}, 500
      assert_receive {:DOWN, ^unrelated_ref, :process, _, :unrelated}
      assert :sys.get_state(token).subscribers == %{}
      server_pid = server.task.pid
      assert_receive {:EXIT, ^server_pid, :normal}
      refute_receive {:EXIT, _, _}
      refute_receive {:provider_cancelled, _}
    after
      stop_server(server)
      GenServer.stop(token)
      Process.flag(:trap_exit, old_flag)
    end
  end

  test "trap-exit caller normal completion preserves only its own caller messages" do
    old_flag = Process.flag(:trap_exit, true)
    server = silent_server("data: original\n\n")

    try do
      assert {:ok, 200, _} =
               HTTP.post_event_stream(server.url, %{}, [], fn _ -> :halt end)

      assert_receive {:closed, _, {:error, :closed}}, 500
      # Exclude the independently owned test server, whose Task result is ours to await.
      Task.await(server.task)
      server_pid = server.task.pid
      assert_receive {:EXIT, ^server_pid, :normal}
      refute_receive {:EXIT, _, _}
      refute_receive {:provider_cancelled, _}
    after
      stop_server(server)
      Process.flag(:trap_exit, old_flag)
    end
  end

  defp silent_server(frame \\ nil) do
    {:ok, listener} = :gen_tcp.listen(0, [:binary, active: false, reuseaddr: true])
    {:ok, {_, port}} = :inet.sockname(listener)
    owner = self()
    id = make_ref()

    task =
      Task.async(fn ->
        {:ok, socket} = :gen_tcp.accept(listener)
        consume_request(socket, "")
        send(owner, {:accepted, id})

        if frame do
          :ok =
            :gen_tcp.send(
              socket,
              "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n" <>
                Integer.to_string(byte_size(frame), 16) <> "\r\n" <> frame <> "\r\n"
            )
        end

        send(owner, {:closed, id, :gen_tcp.recv(socket, 0, 15_000)})
      end)

    %{id: id, listener: listener, task: task, url: "http://127.0.0.1:#{port}/stream"}
  end

  defp stream_task(server, token, on_data \\ fn _ -> :cont end) do
    Task.async(fn ->
      HTTP.post_event_stream(
        server.url,
        %{stream: true},
        [receive_timeout: 30_000, cancellation_token: token],
        on_data
      )
    end)
  end

  defp stop_server(server) do
    Task.shutdown(server.task, :brutal_kill)
    :gen_tcp.close(server.listener)
  end

  defp consume_request(socket, bytes) do
    case String.split(bytes, "\r\n\r\n", parts: 2) do
      [headers, body] ->
        [_, length] = Regex.run(~r/content-length: (\d+)/i, headers)

        if byte_size(body) < String.to_integer(length) do
          {:ok, rest} = :gen_tcp.recv(socket, 0, 2_000)
          consume_request(socket, bytes <> rest)
        end

      _ ->
        {:ok, rest} = :gen_tcp.recv(socket, 0, 2_000)
        consume_request(socket, bytes <> rest)
    end
  end

  describe "apply_params/2" do
    test "adds non-nil fields to body map" do
      params = %InferenceParams{temperature: 0.5, max_tokens: 100}
      body = HTTP.apply_params(%{model: "test"}, params)

      assert body.temperature == 0.5
      assert body.max_tokens == 100
      assert body.model == "test"
    end

    test "skips nil fields" do
      params = %InferenceParams{temperature: nil, max_tokens: nil}
      body = HTTP.apply_params(%{model: "test"}, params)

      refute Map.has_key?(body, :temperature)
      refute Map.has_key?(body, :max_tokens)
      assert body.model == "test"
    end
  end

  describe "get/2 error handling" do
    test "returns connection_refused for unreachable host" do
      assert {:error, :connection_refused, 0, _} =
               HTTP.get("http://127.0.0.1:19999/v1/models", receive_timeout: 100)
    end
  end
end
