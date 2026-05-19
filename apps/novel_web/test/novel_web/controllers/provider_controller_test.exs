defmodule NovelWeb.ProviderControllerTest do
  use NovelWeb.ConnCase, async: false

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
end
