defmodule NovelPersistence do
  @moduledoc """
  Persistence 层根模块。

  提供 Ecto Repo、schema 定义、migration；修订留痕以 source_revision_ref + StateTrace 为权威（PaperTrail 已按 ADR-0032 逻辑退役）。
  """
end
