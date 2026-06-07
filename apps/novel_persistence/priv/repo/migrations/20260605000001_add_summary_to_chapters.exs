defmodule NovelPersistence.Repo.Migrations.AddSummaryToChapters do
  use Ecto.Migration

  # 章的大纲摘要（采纳章节计划时落到结构上）。让 chapter 结构自足承载「这章写什么」，
  # 阅读目录/结构面板单一数据源读 chapter，不再依赖独立的 chapter_plans 视图。
  def change do
    alter table(:chapters) do
      add :summary, :string
    end
  end
end
