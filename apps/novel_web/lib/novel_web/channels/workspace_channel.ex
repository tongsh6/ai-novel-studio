defmodule NovelWeb.WorkspaceChannel do
  @moduledoc """
  Workspace Channel — 用户对话主通道。

  Phase 0 Week 4：处理 user_message / adopt 事件，集成 TurnService。
  """

  use Phoenix.Channel

  alias NovelApplication.ReadingService
  alias NovelApplication.TurnService

  @impl true
  @spec join(String.t(), map(), Phoenix.Socket.t()) :: {:ok, map(), Phoenix.Socket.t()}
  def join("workspace:" <> suffix, _payload, socket) do
    socket = assign(socket, :workspace_id, suffix)
    {:ok, %{joined: true}, socket}
  end

  @impl true
  def handle_in("user_message", %{"text" => text} = msg, socket) do
    ws_id = socket.assigns[:workspace_id] || "lobby"
    work_id = Map.get(msg, "work_id")

    # LLM 调用耗时长（10-30s），先回复收到，异步广播结果
    Task.start(fn ->
      turn_result = TurnService.handle_message(text, ws_id, nil, work_id)
      NovelWeb.Endpoint.broadcast!("workspace:#{ws_id}", "turn_result", turn_result)
    end)

    {:reply, {:ok, %{received: true}}, socket}
  end

  def handle_in("adopt", %{"artifact_id" => artifact_id} = msg, socket) do
    ws_id = socket.assigns[:workspace_id] || "lobby"
    base_revision = parse_base_revision(Map.get(msg, "base_revision"))
    artifact_type = Map.get(msg, "artifact_type")

    mutation_attrs = %{
      actor_ref: Map.get(msg, "actor_ref", "user"),
      target_scope: Map.get(msg, "target_scope", "work"),
      target_object_ref: artifact_id
    }

    case TurnService.handle_adopt(artifact_id, base_revision, mutation_attrs, ws_id, nil, artifact_type) do
      {:ok, turn_result} ->
        broadcast!(socket, "turn_result", turn_result)
        {:reply, {:ok, %{received: true}}, socket}

      {:error, reason} ->
        {:reply, {:error, %{reason: inspect(reason)}}, socket}
    end
  end

  def handle_in("confirm", %{"behavior_id" => behavior_id}, socket) do
    ws_id = socket.assigns[:workspace_id] || "lobby"

    case TurnService.handle_confirm(behavior_id, ws_id) do
      {:ok, turn_result} ->
        broadcast!(socket, "turn_result", turn_result)
        {:reply, {:ok, %{received: true}}, socket}

      {:error, reason} ->
        {:reply, {:error, %{reason: inspect(reason)}}, socket}
    end
  end

  def handle_in("discard", %{"artifact_id" => artifact_id} = msg, socket) do
    ws_id = socket.assigns[:workspace_id] || "lobby"
    artifact_type = Map.get(msg, "artifact_type")

    result =
      cond do
        artifact_type == "draft_text" ->
          TurnService.handle_discard_draft(artifact_id, ws_id)

        artifact_type == "character" ->
          TurnService.handle_discard_character(artifact_id, ws_id)

        true ->
          TurnService.handle_discard(artifact_id, ws_id)
      end

    case result do
      {:ok, turn_result} ->
        broadcast!(socket, "turn_result", turn_result)
        {:reply, {:ok, %{received: true}}, socket}

      {:error, reason} ->
        {:reply, {:error, %{reason: inspect(reason)}}, socket}
    end
  end

  def handle_in("modify_draft", %{"draft_id" => draft_id} = msg, socket) do
    ws_id = socket.assigns[:workspace_id] || "lobby"
    base_revision = parse_base_revision(Map.get(msg, "base_revision"))
    content = Map.get(msg, "content", "")
    instruction = Map.get(msg, "instruction", "")

    case TurnService.handle_modify_draft(draft_id, base_revision, content, instruction, ws_id) do
      {:ok, turn_result} ->
        broadcast!(socket, "turn_result", turn_result)
        {:reply, {:ok, %{received: true}}, socket}

      {:error, reason} ->
        {:reply, {:error, %{reason: inspect(reason)}}, socket}
    end
  end

  def handle_in("reject", %{"behavior_id" => behavior_id}, socket) do
    ws_id = socket.assigns[:workspace_id] || "lobby"

    case TurnService.handle_reject(behavior_id, ws_id) do
      {:ok, turn_result} ->
        broadcast!(socket, "turn_result", turn_result)
        {:reply, {:ok, %{received: true}}, socket}

      {:error, reason} ->
        {:reply, {:error, %{reason: inspect(reason)}}, socket}
    end
  end

  def handle_in("revise", %{"behavior_id" => behavior_id} = _msg, socket) do
    ws_id = socket.assigns[:workspace_id] || "lobby"

    case TurnService.handle_revise(behavior_id, ws_id) do
      {:ok, turn_result} ->
        broadcast!(socket, "turn_result", turn_result)
        {:reply, {:ok, %{received: true}}, socket}

      {:error, reason} ->
        {:reply, {:error, %{reason: inspect(reason)}}, socket}
    end
  end

  def handle_in("dismiss", %{"behavior_id" => behavior_id}, socket) do
    ws_id = socket.assigns[:workspace_id] || "lobby"

    case TurnService.handle_dismiss(behavior_id, ws_id) do
      {:ok, turn_result} ->
        broadcast!(socket, "turn_result", turn_result)
        {:reply, {:ok, %{received: true}}, socket}

      {:error, reason} ->
        {:reply, {:error, %{reason: inspect(reason)}}, socket}
    end
  end

  def handle_in("resume", %{"behavior_id" => _behavior_id}, socket) do
    _ws_id = socket.assigns[:workspace_id] || "lobby"
    text = "长跑任务恢复功能将在后续版本中提供。"

    broadcast!(socket, "turn_result", %{
      schema_version: "2.0.0",
      assistant_message: %{text: text},
      ui_cards: [],
      phase: "completed",
      status: "done",
      next_action: "no_further_action"
    })

    {:reply, {:ok, %{received: true, note: "resume not yet available"}}, socket}
  end

  def handle_in("cancel", %{"behavior_id" => _behavior_id}, socket) do
    _ws_id = socket.assigns[:workspace_id] || "lobby"
    text = "长跑任务已取消。"

    broadcast!(socket, "turn_result", %{
      schema_version: "2.0.0",
      assistant_message: %{text: text},
      ui_cards: [],
      phase: "cancelled",
      status: "cancelled",
      next_action: "no_further_action"
    })

    {:reply, {:ok, %{received: true}}, socket}
  end

  def handle_in("branch", %{"behavior_id" => _behavior_id}, socket) do
    _ws_id = socket.assigns[:workspace_id] || "lobby"
    text = "分支功能将在后续版本中提供。"

    broadcast!(socket, "turn_result", %{
      schema_version: "2.0.0",
      assistant_message: %{text: text},
      ui_cards: [],
      phase: "completed",
      status: "done",
      next_action: "no_further_action"
    })

    {:reply, {:ok, %{received: true, note: "branch not yet available"}}, socket}
  end

  def handle_in("retry", %{"behavior_id" => behavior_id}, socket) do
    ws_id = socket.assigns[:workspace_id] || "lobby"
    {:ok, turn_result} = TurnService.handle_retry(behavior_id, ws_id)
    broadcast!(socket, "turn_result", turn_result)
    {:reply, {:ok, %{received: true}}, socket}
  end

  def handle_in("get_toc", %{"work_id" => work_id}, socket) do
    toc = ReadingService.build_toc(work_id)
    {:reply, {:ok, toc}, socket}
  end

  def handle_in("get_chapter_content", %{"chapter_id" => chapter_id}, socket) do
    content = ReadingService.build_chapter_content(chapter_id)
    {:reply, {:ok, content}, socket}
  end

  def handle_in("get_characters", %{"work_id" => work_id}, socket) do
    characters = ReadingService.build_characters(work_id)
    {:reply, {:ok, characters}, socket}
  end

  def handle_in("get_foreshadowing", %{"work_id" => work_id}, socket) do
    items = ReadingService.build_foreshadowing(work_id)
    {:reply, {:ok, items}, socket}
  end

  def handle_in("get_rules", %{"work_id" => work_id}, socket) do
    items = ReadingService.build_rules(work_id)
    {:reply, {:ok, items}, socket}
  end

  def handle_in("ping", payload, socket) do
    {:reply, {:ok, %{event: "pong", echo: payload}}, socket}
  end

  defp parse_base_revision(value) when is_integer(value), do: value

  defp parse_base_revision(value) when is_binary(value) do
    case Integer.parse(value) do
      {revision, ""} -> revision
      _ -> nil
    end
  end

  defp parse_base_revision(_), do: nil
end
