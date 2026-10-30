defmodule NovelWeb.CorsEndpointTest do
  use NovelWeb.ConnCase, async: true

  describe "B65 HTTP CORS boundary through real endpoint pipeline" do
    test "allowed Tauri/dev origins receive CORS headers on actual GET" do
      for origin <- ["tauri://localhost", "http://127.0.0.1:5768"] do
        conn =
          build_conn()
          |> put_req_header("origin", origin)
          |> get("/health")

        assert response(conn, 200)
        assert get_resp_header(conn, "access-control-allow-origin") == [origin], origin
        assert ["origin"] = get_resp_header(conn, "vary")
      end
    end

    test "spoofed/null/unknown origins receive no CORS headers" do
      for origin <- ["https://localhost.example.invalid", "http://127.0.0.1:6000", "null"] do
        conn =
          build_conn()
          |> put_req_header("origin", origin)
          |> get("/health")

        assert response(conn, 200)
        assert get_resp_header(conn, "access-control-allow-origin") == [], origin
      end
    end

    test "allowed OPTIONS preflight short-circuits 204 with headers" do
      conn =
        Plug.Test.conn(:options, "/health")
        |> put_req_header("origin", "http://tauri.localhost")
        |> NovelWeb.Endpoint.call([])

      assert conn.status == 204
      assert get_resp_header(conn, "access-control-allow-origin") == ["http://tauri.localhost"]
    end
  end

  test "endpoint check_origin points at OriginPolicy in dev/prod/runtime configs" do
    project_root = Path.expand("../../../..", __DIR__)

    for config_file <- ["config/dev.exs", "config/prod.exs", "config/runtime.exs"] do
      text = File.read!(Path.join(project_root, config_file))
      assert text =~ "check_origin: {NovelWeb.OriginPolicy, :allowed_uri?, []}", config_file
      refute text =~ "check_origin: false", config_file
    end
  end
end
