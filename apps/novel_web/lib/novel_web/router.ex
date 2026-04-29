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

    scope "/works/:work_id" do
      post("/memories", MemoryController, :create)
      get("/memories", MemoryController, :index)
      post("/memories/recall", MemoryController, :recall)
      get("/memories/:memory_id", MemoryController, :show)
      post("/memories/:memory_id/confirm", MemoryController, :confirm)
      post("/memories/:memory_id/lock", MemoryController, :lock)
      post("/memories/:memory_id/unlock", MemoryController, :unlock)
      post("/memories/:memory_id/deprecate", MemoryController, :deprecate)
      post("/memories/:memory_id/archive", MemoryController, :archive)
      patch("/memories/:memory_id/weight", MemoryController, :update_weight)
      patch("/memories/:memory_id/validity", MemoryController, :update_validity)
      get("/memories/:memory_id/references", MemoryController, :references)
    end
  end
end
