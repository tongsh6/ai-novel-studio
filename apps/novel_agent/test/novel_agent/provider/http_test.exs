defmodule NovelAgent.Provider.HTTPTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.CancellationToken
  alias NovelAgent.Provider.HTTP
  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.SSEStream
  alias NovelAgent.Provider.SSEStream.AnthropicDecoder
  alias NovelAgent.Provider.SSEStream.ChatDecoder
  alias NovelAgent.Provider.SSEStream.ResponsesDecoder
  alias NovelTelemetry.LLMLog
  alias NovelTelemetry.LogContext

  test "real cancelled SSE retains one original request audit with caller execution bindings" do
    log_dir = Path.join(System.tmp_dir!(), "cancel-audit-#{System.unique_integer([:positive])}")
    old_dir = Application.get_env(:novel_telemetry, :llm_log_dir)
    Application.put_env(:novel_telemetry, :llm_log_dir, log_dir)
    frame = "data: {\"choices\":[{\"delta\":{\"content\":\"原文\"}}]}\n\n"
    server = silent_server(frame)
    {:ok, token} = CancellationToken.start_link()
    parent = self()
    body = %{"messages" => [%{"role" => "user", "content" => "原请求\r\n不可替换"}], "stream" => true}

    ctx = %{
      provider_name: :openai,
      model_name: "fixture",
      provider_call_ref: "pcall_cancel_audit",
      provider_run_id: "prun_cancel_audit",
      purpose: :conversation,
      owner_refs: %{},
      cancellation_token: token,
      event_sink: fn {_, facts} ->
        if Enum.any?(facts.events, &(&1.event_type == :chunk)), do: send(parent, :audit_chunk)
      end
    }

    request =
      Task.async(fn ->
        LogContext.with_provider_call(
          ctx.provider_call_ref,
          ctx.provider_run_id,
          %{source: "original"},
          fn ->
            SSEStream.execute(
              %{
                state: %{model: "fixture", log_fn: &LLMLog.record/5},
                ctx: ctx,
                body: body,
                url: server.url,
                request_opts: [receive_timeout: 30_000],
                provider: "openai",
                label: "fixture",
                log_vendor: "openai"
              },
              ChatDecoder
            )
          end
        )
      end)

    try do
      assert_receive :audit_chunk, 2_000
      CancellationToken.cancel(token)
      assert {:ok, {:error, %{provider_run: %{status: :cancelled}}}} = Task.yield(request, 500)
      assert_receive {:closed, _, {:error, :closed}}, 500

      records =
        Path.wildcard(Path.join(log_dir, "*.jsonl"))
        |> Enum.flat_map(fn path -> File.read!(path) |> String.split("\n", trim: true) end)

      assert length(records) == 1

      [record] =
        Enum.map(records, fn line ->
          {pos, _} = :binary.match(line, "{")
          Jason.decode!(binary_part(line, pos, byte_size(line) - pos))
        end)

      assert record["request"]["body"] == body
      assert record["request"]["refs"] == %{"source" => "original"}
      assert record["provider_call_ref"] == ctx.provider_call_ref
      assert record["provider_run_ref"] == ctx.provider_run_id
      refute record["response"]["status"] == 200
      refute record["response"]["usage"]["input_tokens"] == 0
    after
      Task.shutdown(request, :brutal_kill)
      stop_server(server)
      GenServer.stop(token)

      if old_dir,
        do: Application.put_env(:novel_telemetry, :llm_log_dir, old_dir),
        else: Application.delete_env(:novel_telemetry, :llm_log_dir)

      File.rm_rf!(log_dir)
    end
  end

  for {wire, decoder, frames} <- [
        {:chat, ChatDecoder,
         "data: {\"usage\":{\"prompt_tokens\":17,\"prompt_tokens_details\":{\"cached_tokens\":0}},\"choices\":[{\"delta\":{\"content\":\"原\"}}]}\n\n"},
        {:anthropic, AnthropicDecoder,
         "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":17,\"cache_read_input_tokens\":0}}}\n\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"原\"}}\n\n"},
        {:responses, ResponsesDecoder,
         "data: {\"type\":\"response.output_text.delta\",\"delta\":\"原\"}\n\ndata: {\"type\":\"response.incomplete\",\"response\":{\"usage\":{\"input_tokens\":17,\"input_tokens_details\":{\"cached_tokens\":0}}}}\n\n"}
      ] do
    test "#{wire} real cancelled stream keeps observed partial usage without invented zeros" do
      server = silent_server(unquote(frames))
      {:ok, token} = CancellationToken.start_link()
      parent = self()

      request =
        Task.async(fn ->
          run_sse(
            server.url,
            unquote(decoder),
            token,
            nil,
            fn _, _, _, result, _ ->
              send(parent, {:audit_result, result})
            end,
            fn {_, facts} ->
              if Enum.any?(facts.events, &(&1.event_type == :chunk)),
                do: send(parent, :usage_chunk)
            end
          )
        end)

      try do
        assert_receive :usage_chunk, 2_000
        CancellationToken.cancel(token)
        assert {:ok, {:error, facts}} = Task.yield(request, 500)
        assert facts.provider_run.status == :cancelled
        assert facts.output.status == :cancelled
        assert facts.output.output_type == :empty
        assert facts.output.usage.input_tokens == 17
        assert facts.output.usage.output_tokens == nil
        assert facts.output.usage.cached_tokens == 0

        assert [%{payload: %{usage: usage}}] =
                 Enum.filter(facts.events, &(&1.event_type == :usage_recorded))

        assert usage == facts.output.usage
        assert Enum.map(facts.events, & &1.sequence) == Enum.to_list(1..length(facts.events))
        assert_receive {:audit_result, {:error, :cancelled, %{usage: ^usage, status: 0}}}
        assert_receive {:closed, _, {:error, :closed}}, 500
      after
        Task.shutdown(request, :brutal_kill)
        stop_server(server)
        GenServer.stop(token)
      end
    end
  end

  test "replaceable transport reports late and duplicate attempts exactly once before cancelled terminal" do
    {:ok, token} = CancellationToken.start_link()
    parent = self()

    source = fn _, _, opts, _ ->
      CancellationToken.cancel(token)
      opts[:on_request_attempt].()
      opts[:on_request_attempt].()
      {:error, :cancelled, 0, "no response"}
    end

    log = fn _, _, _, result, _ -> send(parent, {:attempt_log, result}) end

    try do
      assert {:error, facts} =
               run_sse(
                 "http://unused",
                 ChatDecoder,
                 token,
                 source,
                 log
               )

      attempts = Enum.filter(facts.events, &(Map.get(&1.payload, :phase) == :request_dispatched))
      assert [%{sequence: 3}] = attempts
      assert List.last(facts.events).event_type == :cancelled
      assert facts.output.usage == %{}
      refute Enum.any?(facts.events, &(&1.event_type == :usage_recorded))
      assert_receive {:attempt_log, {:error, :cancelled, %{usage: %{}}}}
      refute_receive {:attempt_log, _}
    after
      GenServer.stop(token)
    end
  end

  test "pre-gate and unattempted replaceable transport cancellation do not invent audit or budget" do
    for pre_cancel <- [true, false] do
      {:ok, token} = CancellationToken.start_link()
      if pre_cancel, do: CancellationToken.cancel(token)

      source = fn _, _, _, _ ->
        CancellationToken.cancel(token)
        {:error, :cancelled, 0, "not attempted"}
      end

      try do
        assert {:error, facts} =
                 run_sse(
                   "http://unused",
                   ChatDecoder,
                   token,
                   source,
                   fn _, _, _, _, _ -> flunk("no attempt audit") end
                 )

        refute Enum.any?(facts.events, &(Map.get(&1.payload, :phase) == :request_dispatched))
        assert facts.output.usage == %{}
      after
        GenServer.stop(token)
      end
    end
  end

  test "worker attempt already sent survives caller observing cancellation before its mailbox" do
    parent = self()
    # A test-only token protocol fixture holds the caller's post-start snapshot.
    # The real HTTP worker must reach the actual TCP peer before cancellation wins.
    token = spawn_link(fn -> held_snapshot_token(parent, nil, 0, nil) end)
    server = silent_server()

    request =
      Task.async(fn ->
        HTTP.post_event_stream(
          server.url,
          %{},
          [
            cancellation_token: token,
            receive_timeout: 30_000,
            on_request_attempt: fn -> send(parent, :drained_attempt) end
          ],
          fn _ -> flunk("server is silent") end
        )
      end)

    try do
      assert_receive :caller_snapshot_held, 2_000
      assert_receive {:accepted, _}, 2_000
      send(token, :release_cancelled)
      assert {:ok, {:error, :cancelled, 0, _}} = Task.yield(request, 500)
      assert_receive :drained_attempt
      refute_receive :drained_attempt
      assert_receive {:closed, _, {:error, :closed}}, 500
    after
      Task.shutdown(request, :brutal_kill)
      stop_server(server)
      Process.unlink(token)
      Process.exit(token, :kill)
    end
  end

  defp held_snapshot_token(parent, owner, reads, held) do
    receive do
      {:"$gen_call", from, {:subscribe, pid}} ->
        GenServer.reply(from, {:ok, make_ref()})
        held_snapshot_token(parent, pid, reads, held)

      {:"$gen_call", {pid, _} = from, :snapshot} when pid == owner and reads == 1 ->
        send(parent, :caller_snapshot_held)
        held_snapshot_token(parent, owner, reads + 1, from)

      {:"$gen_call", {pid, _} = from, :snapshot} ->
        GenServer.reply(from, %{cancelled?: false})
        held_snapshot_token(parent, owner, reads + if(pid == owner, do: 1, else: 0), held)

      :release_cancelled ->
        GenServer.reply(held, %{cancelled?: true})
        held_snapshot_token(parent, owner, reads, nil)

      {:"$gen_call", from, {:unsubscribe, _}} ->
        GenServer.reply(from, :ok)
        held_snapshot_token(parent, owner, reads, held)
    end
  end

  defp run_sse(url, decoder, token, source, log, sink \\ fn _ -> :ok end) do
    ctx = %{
      provider_name: :openai,
      model_name: "fixture",
      provider_call_ref: "pcall_usage",
      provider_run_id: "prun_usage",
      purpose: :conversation,
      owner_refs: %{},
      cancellation_token: token,
      event_sink: sink
    }

    SSEStream.execute(
      %{
        state: %{model: "fixture", log_fn: log, eventsource_fn: source},
        ctx: ctx,
        body: %{"messages" => [%{"role" => "user", "content" => "原请求"}], "stream" => true},
        url: url,
        request_opts: [receive_timeout: 30_000],
        provider: "openai",
        label: "fixture",
        log_vendor: "openai"
      },
      decoder
    )
  end

  test "HTTP200 empty completed response fails but retains actual partial usage" do
    frame =
      "data: {\"usage\":{\"prompt_tokens\":17,\"prompt_tokens_details\":{\"cached_tokens\":0}},\"choices\":[]}\n\ndata: [DONE]\n\n"

    server = silent_server(frame, true)
    parent = self()

    try do
      assert {:error, facts} =
               run_sse(server.url, ChatDecoder, nil, nil, fn _, _, _, result, _ ->
                 send(parent, {:empty_log, result})
               end)

      assert facts.provider_run.status == :failed
      assert facts.error.type == :invalid_response
      assert facts.output.usage.input_tokens == 17
      assert facts.output.usage.output_tokens == nil
      assert facts.output.usage.cached_tokens == 0
      assert_receive {:empty_log, {:error, _, %{status: 200, usage: usage}}}
      assert usage == facts.output.usage
    after
      stop_server(server)
    end
  end

  test "failed transport retains observed usage while timeout diagnostics stay separate" do
    for observed? <- [true, false], reason <- [:timeout, :connection_refused] do
      owner = self()

      source = fn _, _, opts, on_data ->
        opts[:on_request_attempt].()

        if observed? do
          :cont =
            on_data.(
              ~s(data: {"usage":{"prompt_tokens":17,"prompt_tokens_details":{"cached_tokens":0}},"choices":[]}\n\n)
            )
        end

        {:error, reason, 0, "transport failed"}
      end

      assert {:error, facts} =
               run_sse("http://fixture", ChatDecoder, nil, source, fn _, _, _, result, _ ->
                 send(owner, {:transport_log, result})
               end)

      assert facts.provider_run.status == :failed
      assert facts.output.status == :error
      assert_receive {:transport_log, {:error, _, attrs}}
      assert attrs.usage == facts.output.usage

      if observed? do
        assert attrs.usage.input_tokens == 17
        assert attrs.usage.output_tokens == nil
        assert attrs.usage.cached_tokens == 0
      else
        assert attrs.usage == %{}
        refute Enum.any?(facts.events, &(&1.event_type == :usage_recorded))
      end

      if reason == :timeout do
        assert facts.error.details.timeout_kind == :connection_stall
        assert attrs.resp_body.diagnostics.timeout_kind == :connection_stall
        refute Map.has_key?(attrs.usage, :timeout_kind)
      end
    end
  end

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

  defp silent_server(frame \\ nil, complete? \\ false) do
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

        if complete? do
          :gen_tcp.send(socket, "0\r\n\r\n")
          :gen_tcp.shutdown(socket, :write)
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
