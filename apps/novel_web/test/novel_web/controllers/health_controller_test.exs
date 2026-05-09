defmodule NovelWeb.HealthControllerTest do
  use NovelWeb.ConnCase, async: true

  describe "GET /health" do
    test "returns ok when server is running" do
      conn = get(build_conn(), "/health")
      assert response(conn, 200)
      assert json_response(conn, 200)["status"] == "ok"
    end
  end
end
