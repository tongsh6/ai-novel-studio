defmodule NovelWeb.ProviderControllerTest do
  use NovelWeb.ConnCase, async: true

  describe "GET /api/provider/health" do
    test "returns connected status when stub provider is available" do
      conn = get(build_conn(), "/api/provider/health")
      assert response(conn, 200)

      body = json_response(conn, 200)
      assert body["connected"] == true
      assert body["provider"] != "unknown"
      assert body["message"] =~ "连接"
    end
  end
end
