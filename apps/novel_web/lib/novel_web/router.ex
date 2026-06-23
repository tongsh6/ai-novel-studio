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
    get("/provider/options", ProviderController, :options)
    post("/provider/models", ProviderController, :models)
    put("/provider/config", ProviderController, :configure)
    post("/provider/test", ProviderController, :test)
    post("/system/shutdown", SystemController, :shutdown)

    get("/works", WorksController, :index)
    post("/works", WorksController, :create)
    post("/works/ensure-initial", WorksController, :ensure_initial)
    patch("/works/:id", WorksController, :update)
    post("/works/:id/discard", WorksController, :discard)
    get("/works/:work_id/memories", MemoriesController, :index)
    post("/works/:work_id/memories", MemoriesController, :create)
    post("/works/:work_id/memories/recall", MemoriesController, :recall)
    get("/works/:work_id/memories/:id", MemoriesController, :show)
    post("/works/:work_id/memories/:id/confirm", MemoriesController, :confirm)
    post("/works/:work_id/memories/:id/lock", MemoriesController, :lock)
    post("/works/:work_id/memories/:id/unlock", MemoriesController, :unlock)
    post("/works/:work_id/memories/:id/deprecate", MemoriesController, :deprecate)
    post("/works/:work_id/memories/:id/archive", MemoriesController, :archive)
    patch("/works/:work_id/memories/:id/weight", MemoriesController, :update_weight)
    patch("/works/:work_id/memories/:id/validity", MemoriesController, :update_validity)
    get("/works/:work_id/memories/:id/references", MemoriesController, :references)
    get("/works/:work_id/sessions/resume", WorkSessionsController, :resume)
    get("/works/:work_id/sessions", WorkSessionsController, :index)
    post("/works/:work_id/sessions", WorkSessionsController, :create)
    post("/works/:work_id/sessions/:id/archive", WorkSessionsController, :archive)

    get(
      "/works/:work_id/sessions/:session_id/turns/:turn_id/replay",
      TraceReplayController,
      :show
    )

    get("/works/:work_id/sessions/:id", WorkSessionsController, :show)
    get("/works/:id", WorksController, :show)
  end
end
