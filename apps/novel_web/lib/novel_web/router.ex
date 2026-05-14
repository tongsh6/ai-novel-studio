defmodule NovelWeb.Router do
  use Phoenix.Router

  pipeline :api do
    plug(:accepts, ["json"])
  end

  scope "/", NovelWeb do
    pipe_through(:api)

    get("/health", HealthController, :index)
  end

  scope "/api", NovelWeb do
    pipe_through(:api)

    get("/provider/health", ProviderController, :health)
    post("/system/shutdown", SystemController, :shutdown)

    get("/works", WorksController, :index)
    post("/works", WorksController, :create)
    get("/works/:work_id/sessions/resume", WorkSessionsController, :resume)
    get("/works/:work_id/sessions", WorkSessionsController, :index)
    post("/works/:work_id/sessions", WorkSessionsController, :create)
    get("/works/:id", WorksController, :show)
  end
end
