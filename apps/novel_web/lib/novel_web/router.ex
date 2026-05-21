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
    get("/works/:work_id/sessions/:id", WorkSessionsController, :show)
    get("/works/:id", WorksController, :show)
  end
end
