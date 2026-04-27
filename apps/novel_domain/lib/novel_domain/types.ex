defmodule NovelDomain.Types do
  @moduledoc """
  Domain 层共享类型定义。

  本模块仅包含纯类型/guard，不包含任何运行时副作用。
  """

  @type id :: String.t()

  @type work_status :: :draft | :active | :archived
  @type volume_status :: :planned | :drafting | :completed | :archived

  @type object_type :: :work | :volume | :chapter | :scene | :draft
end
