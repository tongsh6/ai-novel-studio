defmodule NovelWeb.SystemControllerTest do
  use NovelWeb.ConnCase, async: true

  describe "POST /api/system/shutdown" do
    test "returns a shutdown acknowledgement conn" do
      conn = post(build_conn(), "/api/system/shutdown")

      assert response(conn, 200)
      assert json_response(conn, 200)["status"] == "shutting_down"
    end
  end
end
