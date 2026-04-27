# This file is responsible for configuring your umbrella
# and **all applications** and their dependencies with the
# help of the Config module.
#
# Note that all applications in your umbrella share the
# same configuration and dependencies, which is why they
# all use the same configuration file. If you want different
# configurations or dependencies per app, it is best to
# move said applications out of the umbrella.
import Config

config :novel_web, NovelWeb.Endpoint,
  url: [host: "localhost"],
  http: [ip: {127, 0, 0, 1}, port: 4000],
  adapter: Bandit.PhoenixAdapter,
  server: true,
  render_errors: [formats: [json: NovelWeb.ErrorJSON], layout: false]

config :phoenix, :json_library, Jason

# Ecto: novel_persistence Repo 注册 + 默认 migrations 路径。
# 数据库连接细节按环境拆到 dev.exs / test.exs / runtime.exs。
config :novel_persistence,
  ecto_repos: [NovelPersistence.Repo]

import_config "#{config_env()}.exs"
