defmodule NovelApplication.AuthorActionConfirmation do
  @moduledoc """
  非采纳工具确认/拒绝的统一受理编排（VS-00L §16.14）。

  所有真实入口都从持久 source Interaction 读取动作来源、最后明确行为快照与真实
  作者原字节，再走 `AuthorActionAdmission.admit_handoff/3` 的同一事务。源运行在线
  时由该 AgentRunServer 串行交接；离线时由本次受理事务读取并收束非终态 source，
  不重建旧模型执行、不自动重放。
  """

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentRunFlows.ToolConfirmation
  alias NovelApplication.AgentRunServer
  alias NovelApplication.AgentRunService
  alias NovelApplication.AuthorActionAdmission
  alias NovelDomain.{AgentRun, AuthorActionInput}
  alias NovelPersistence.WorkSessionRepo

  @type result :: %{
          receipt: struct(),
          run: AgentRun.t(),
          duplicate?: boolean(),
          source_turn_ref: String.t()
        }

  @doc """
  受理当前 WorkspaceChannel 的非采纳确认/拒绝。

  `opts` 支持真实运行依赖注入（`provider_execution`/`context_fetcher`/
  `event_sink`/`interaction_store`），但 source 一律来自持久事实。
  """
  @spec handle(String.t(), String.t(), AuthorActionInput.t(), keyword()) ::
          {:ok, result()}
          | {:duplicate, map()}
          | {:conflict, map()}
          | {:behavior_consumed, map()}
          | {:error, term()}
  def handle(work_id, session_id, action_input, opts \\ [])

  def handle(work_id, session_id, %AuthorActionInput{} = action_input, opts)
      when is_binary(work_id) and is_binary(session_id) do
    with {:ok, source_ctx} <- load_source(work_id, session_id, action_input),
         {:ok, plan} <- build_plan(work_id, session_id, action_input, source_ctx, opts) do
      dispatch(work_id, session_id, action_input, source_ctx, plan, opts)
    end
  end

  def handle(_work_id, _session_id, _action_input, _opts),
    do: {:error, :author_action_scope_unavailable}

  defp load_source(work_id, session_id, action_input) do
    case WorkSessionRepo.assistant_entry(work_id, session_id, action_input.source_turn_ref) do
      nil ->
        {:error, :source_turn_result_missing}

      entry ->
        content = Map.get(entry, :content) || %{}
        source = field(content, :turn_result)

        if is_map(source) do
          {:ok,
           %{
             source: source,
             source_run_id: field(content, :agent_run_id),
             agent_run_id: field(content, :agent_run_id)
           }}
        else
          {:error, :source_turn_result_missing}
        end
    end
  end

  defp build_plan(work_id, session_id, action_input, source_ctx, opts) do
    author = source_author_message(work_id, session_id, source_ctx.source)

    with {:ok, author} <- author do
      input = %{
        text: operation_goal(action_input),
        workspace_id: source_ctx.source["workspace_id"] || work_id,
        work_id: work_id,
        session_id: session_id,
        turn_id: action_input.source_turn_ref,
        origin_frame_ref: "frame_#{action_input.source_turn_ref}_author_action",
        source_turn_result: source_ctx.source,
        action_input: action_input,
        author_message: author,
        trigger: %{
          kind: "author_action",
          action_id: action_input.action_id,
          action_type: action_input.action_type,
          source_turn_ref: action_input.source_turn_ref,
          source_surface_ref: source_surface_ref(source_ctx.source, action_input),
          target_artifact_ref: action_input.target_ref
        },
        provider_execution:
          Keyword.get(opts, :provider_execution) ||
            Execution.dependency(purpose: :tool),
        context_fetcher: Keyword.get(opts, :context_fetcher)
      }

      admission = %{
        action_input: action_input,
        work_id: work_id,
        session_id: session_id,
        source_turn_ref: action_input.source_turn_ref,
        source_turn_result: source_ctx.source
      }

      with {:ok, run} <- AgentRun.new(ToolConfirmation.run_attrs(input)) do
        AuthorActionAdmission.prepare(run, admission)
      end
    end
  end

  defp source_author_message(work_id, session_id, source) do
    author_turn_ref =
      source
      |> field(:trace_summary)
      |> field(:source_turn_ref)

    with true <- is_binary(author_turn_ref) and String.trim(author_turn_ref) != "",
         entry when not is_nil(entry) <-
           WorkSessionRepo.user_entry(work_id, session_id, author_turn_ref),
         text when is_binary(text) <- field(Map.get(entry, :content) || %{}, :text),
         true <- String.trim(text) != "" do
      {:ok, %{turn_ref: author_turn_ref, text: text}}
    else
      _ -> {:error, :source_author_message_missing}
    end
  end

  defp dispatch(_work_id, _session_id, action_input, source_ctx, plan, opts) do
    case live_source_owner(source_ctx.source_run_id) do
      {:ok, pid, %{status: :awaiting_author}} ->
        case AgentRunServer.handoff_author_action(pid, plan, opts) do
          {:ok, result} -> confirm_result(result, action_input, source_ctx)
          {:duplicate, receipt} -> {:duplicate, receipt}
          {:conflict, receipt} -> {:conflict, receipt}
          {:behavior_consumed, receipt} -> {:behavior_consumed, receipt}
          {:error, reason} -> {:error, reason}
        end

      {:ok, _pid, _run} ->
        {:error, :source_run_not_awaiting_author}

      :offline ->
        offline_dispatch(action_input, source_ctx, plan, opts)
    end
  end

  defp offline_dispatch(action_input, _source_ctx, plan, opts) do
    store =
      Keyword.get(opts, :interaction_store) || NovelApplication.TurnInteractionService.store()

    case AuthorActionAdmission.admit_handoff(plan, nil, interaction_store: store) do
      {:ok, result} ->
        maybe_start_child(result, action_input, opts)

      {:duplicate, receipt} ->
        {:duplicate, receipt}

      {:conflict, receipt} ->
        {:conflict, receipt}

      {:behavior_consumed, receipt} ->
        {:behavior_consumed, receipt}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp maybe_start_child(result, action_input, opts) do
    if action_input.action_type == "confirm_before_execute" do
      case AgentRunService.start_committed_author_action(
             result.child_startup,
             child_runtime_opts(result, plan_action(result), opts),
             result.receipt
           ) do
        {:ok, _pid} -> {:ok, result}
        {:error, reason} -> {:error, {:child_run_start_failed, reason}}
      end
    else
      {:ok, result}
    end
  end

  @doc """
  从受理事务返回的同一份 source/author/behavior 事实构造 child planner。

  源在线交接与离线受理共用该入口，避免把事务外读取的旧 author 文本带进新 IR。
  """
  @spec child_runtime_opts(map(), AuthorActionInput.t(), keyword()) :: keyword()
  def child_runtime_opts(result, action_input, opts) do
    planner =
      ToolConfirmation.next_step_planner(%{
        source_turn_result: result.source_turn_result,
        action_input: action_input,
        author_message: %{turn_ref: result.author_turn_ref, text: result.author_text},
        behavior_ref: result.behavior_ref,
        receipt_id: result.receipt.id,
        context_fetcher: Keyword.get(opts, :context_fetcher),
        provider_execution:
          Keyword.get(opts, :provider_execution) ||
            Execution.dependency(purpose: :tool)
      })

    opts
    |> Keyword.put(:next_step_planner, planner)
    |> Keyword.put_new(:interaction_store, NovelApplication.TurnInteractionService.store())
  end

  defp plan_action(result), do: action_input_from_receipt(result.receipt.action_type, result)

  defp action_input_from_receipt(action_type, result) do
    %AuthorActionInput{
      input_id: result.receipt.id,
      source_turn_ref: result.receipt.source_turn_ref,
      action_id: result.receipt.action_id,
      action_type: action_type,
      target_ref: result.behavior.target_ref,
      behavior_ref: result.behavior_ref,
      idempotency_key: result.receipt.idempotency_key
    }
  end

  defp confirm_result(result, _action_input, _source_ctx), do: {:ok, result}

  defp live_source_owner(nil), do: :offline

  defp live_source_owner(run_id) do
    case AgentRunService.state(run_id) do
      {:ok, %{run: run}} -> {:ok, state_pid(run_id), run}
      _ -> :offline
    end
  end

  defp state_pid(run_id) do
    case Registry.lookup(NovelApplication.AgentRunRegistry, run_id) do
      [{pid, _}] -> pid
      _ -> nil
    end
  end

  defp source_surface_ref(source, action_input) do
    source
    |> field(:available_actions)
    |> List.wrap()
    |> Enum.find(%{}, &(field(&1, :action_id) == action_input.action_id))
    |> field(:trace_ref)
    |> case do
      nil -> "author_action:#{action_input.source_turn_ref}"
      trace_ref -> trace_ref
    end
  end

  defp operation_goal(%AuthorActionInput{action_type: "confirm_before_execute"} = input) do
    "应用层操作：执行作者已确认的#{input.target_ref || "待处理"}动作"
  end

  defp operation_goal(%AuthorActionInput{} = input) do
    "应用层操作：处理作者已取消的#{input.target_ref || "待处理"}动作"
  end

  defp field(map, key) when is_map(map) do
    Map.get(map, key) || Map.get(map, Atom.to_string(key))
  end

  defp field(_map, _key), do: nil
end
