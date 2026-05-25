port =
  (System.get_env("PHOENIX_TEST_PORT") || System.get_env("PHOENIX_PORT") || "4657")
  |> String.to_integer()

endpoint_config =
  :novel_web
  |> Application.get_env(NovelWeb.Endpoint, [])
  |> Keyword.put(:server, true)
  |> Keyword.put(:http, ip: {127, 0, 0, 1}, port: port)
  |> Keyword.put(:check_origin, false)

Application.put_env(:novel_web, NovelWeb.Endpoint, endpoint_config)

provider =
  System.get_env("SLICE_VERIFY_PROVIDER", "slice_verify")
  |> String.to_atom()

Application.put_env(:novel_agent, :extra_providers,
  slice_verify: NovelAgent.Test.Provider.SliceVerify
)

Application.put_env(:novel_agent, :provider, default: provider)
Application.put_env(:novel_web, :persistence, inject_real_persistence: true)

repo_config =
  :novel_persistence
  |> Application.get_env(NovelPersistence.Repo, [])
  |> Keyword.put(:pool, DBConnection.ConnectionPool)
  |> Keyword.put(:pool_size, 1)

Application.put_env(:novel_persistence, NovelPersistence.Repo, repo_config)

if provider == :lmstudio do
  Application.put_env(:novel_agent, NovelAgent.Provider.LMStudio,
    endpoint: System.get_env("NOVEL_LMSTUDIO_ENDPOINT", "http://localhost:1234/v1"),
    model: System.get_env("NOVEL_LMSTUDIO_MODEL", "openai/gpt-oss-120b"),
    timeout:
      System.get_env(
        "NOVEL_LMSTUDIO_TIMEOUT_MS",
        System.get_env("NOVEL_LLM_TIMEOUT_MS", "300000")
      )
      |> String.to_integer(),
    log_fn: &NovelCommon.LLMLog.record/5
  )
end

if app_log_dir = System.get_env("SLICE_VERIFY_APP_LOG_DIR") do
  Application.put_env(:novel_common, :log_jsonl_enabled, true)
  Application.put_env(:novel_common, :log_jsonl_dir, app_log_dir)
end

if llm_log_dir = System.get_env("SLICE_VERIFY_LLM_LOG_DIR") do
  Application.put_env(:novel_common, :llm_log_dir, llm_log_dir)
end

{:ok, _started} = Application.ensure_all_started(:novel_web)

case NovelApplication.WorkService.list() do
  [] ->
    {:ok, work} = NovelApplication.WorkService.create(%{"title" => "Slice Verify Work"})
    IO.puts("[slice-verify-server] seeded work #{work.id}")

  _ ->
    :ok
end

IO.puts("[slice-verify-server] listening on http://127.0.0.1:#{port}")

Process.sleep(:infinity)
