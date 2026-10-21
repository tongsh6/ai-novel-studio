defmodule NovelWeb.ProviderControllerTest do
  use NovelWeb.ConnCase, async: false

  alias NovelAgent.Provider.RuntimeConfig

  setup do
    RuntimeConfig.reset()
    on_exit(fn -> RuntimeConfig.reset() end)
  end

  describe "GET /api/provider/health" do
    test "returns provider and model metadata when the provider is available" do
      old_provider = Application.get_env(:novel_agent, :provider)
      old_lmstudio = Application.get_env(:novel_agent, NovelAgent.Provider.LMStudio)

      Application.put_env(:novel_agent, :provider, default: :stub)

      try do
        conn = get(build_conn(), "/api/provider/health")
        assert response(conn, 200)

        body = json_response(conn, 200)
        assert body["connected"] == true
        assert body["provider"] == "stub"
        assert body["model"] == nil
        assert body["message"] =~ "连接"
      after
        Application.put_env(:novel_agent, :provider, old_provider)
        Application.put_env(:novel_agent, NovelAgent.Provider.LMStudio, old_lmstudio)
      end
    end

    test "returns configured model metadata for model-backed providers" do
      old_provider = Application.get_env(:novel_agent, :provider)
      old_lmstudio = Application.get_env(:novel_agent, NovelAgent.Provider.LMStudio)

      Application.put_env(:novel_agent, :provider, default: :lmstudio)

      Application.put_env(:novel_agent, NovelAgent.Provider.LMStudio,
        endpoint: nil,
        model: "local-health-model"
      )

      try do
        conn = get(build_conn(), "/api/provider/health")
        body = json_response(conn, 200)

        assert body["connected"] == false
        assert body["provider"] == "lmstudio"
        assert body["model"] == "local-health-model"
        assert body["message"] =~ "未连接"
      after
        Application.put_env(:novel_agent, :provider, old_provider)
        Application.put_env(:novel_agent, NovelAgent.Provider.LMStudio, old_lmstudio)
      end
    end

    test "does not collapse disconnected providers to unknown" do
      old_provider = Application.get_env(:novel_agent, :provider)
      Application.put_env(:novel_agent, :provider, default: :nonexistent)

      try do
        conn = get(build_conn(), "/api/provider/health")
        body = json_response(conn, 200)

        assert body["connected"] == false
        assert body["provider"] == "nonexistent"
        assert body["model"] == nil
        assert body["message"] =~ "unknown provider"
      after
        Application.put_env(:novel_agent, :provider, old_provider)
      end
    end
  end

  describe "GET /api/provider/options" do
    test "returns provider registry without secrets" do
      old_deepseek = Application.get_env(:novel_agent, NovelAgent.Provider.DeepSeek)

      Application.put_env(:novel_agent, NovelAgent.Provider.DeepSeek,
        api_key: "secret",
        model: "deepseek-v4-flash"
      )

      try do
        conn = get(build_conn(), "/api/provider/options")
        body = json_response(conn, 200)
        deepseek = Enum.find(body["providers"], &(&1["id"] == "deepseek"))

        assert body["current_provider"] == "stub"
        assert deepseek["api_key_configured"] == true
        refute Map.has_key?(deepseek, "api_key")
      after
        Application.put_env(:novel_agent, NovelAgent.Provider.DeepSeek, old_deepseek)
      end
    end
  end

  describe "PUT /api/provider/config" do
    test "switches current runtime provider" do
      conn =
        build_conn()
        |> put_req_header("content-type", "application/json")
        |> put("/api/provider/config", %{provider: "stub"})

      body = json_response(conn, 200)
      assert body["ok"] == true
      assert body["provider"] == "stub"
    end

    test "rejects invalid provider endpoint" do
      conn =
        build_conn()
        |> put_req_header("content-type", "application/json")
        |> put("/api/provider/config", %{
          provider: "lmstudio",
          endpoint: "localhost:1234/v1",
          model: "local-model"
        })

      body = json_response(conn, 422)
      assert body["ok"] == false
      assert body["message"] == "端点必须是完整的 http(s) URL。"
    end
  end

  describe "POST /api/provider/models" do
    test "returns live provider model options without secrets" do
      old_deepseek = Application.get_env(:novel_agent, NovelAgent.Provider.DeepSeek)

      mock = fn _url, _opts ->
        {:ok, 200, %{"data" => [%{"id" => "deepseek-chat", "owned_by" => "deepseek"}]}}
      end

      Application.put_env(:novel_agent, NovelAgent.Provider.DeepSeek,
        get_fn: mock,
        log_fn: nil
      )

      try do
        conn =
          build_conn()
          |> put_req_header("content-type", "application/json")
          |> post("/api/provider/models", %{provider: "deepseek", api_key: "secret"})

        body = json_response(conn, 200)
        assert body["ok"] == true
        assert body["provider"] == "deepseek"

        assert body["models"] == [
                 %{"id" => "deepseek-chat", "label" => "deepseek-chat", "owned_by" => "deepseek"}
               ]

        refute inspect(body) =~ "secret"
      after
        Application.put_env(:novel_agent, NovelAgent.Provider.DeepSeek, old_deepseek)
      end
    end

    test "rejects invalid provider endpoint" do
      conn =
        build_conn()
        |> put_req_header("content-type", "application/json")
        |> post("/api/provider/models", %{
          provider: "lmstudio",
          endpoint: "localhost:1234/v1"
        })

      body = json_response(conn, 422)
      assert body["ok"] == false
      assert body["models"] == []
      assert body["message"] == "端点必须是完整的 http(s) URL。"
    end
  end

  describe "POST /api/provider/test" do
    test "tests provider config without saving it" do
      conn =
        build_conn()
        |> put_req_header("content-type", "application/json")
        |> post("/api/provider/test", %{provider: "stub"})

      body = json_response(conn, 200)
      assert body["connected"] == true
      assert body["provider"] == "stub"
    end

    test "rejects invalid provider endpoint" do
      conn =
        build_conn()
        |> put_req_header("content-type", "application/json")
        |> post("/api/provider/test", %{
          provider: "lmstudio",
          endpoint: "localhost:1234/v1",
          model: "local-model"
        })

      body = json_response(conn, 422)
      assert body["ok"] == false
      assert body["connected"] == false
      assert body["message"] == "端点必须是完整的 http(s) URL。"
    end
  end
end
