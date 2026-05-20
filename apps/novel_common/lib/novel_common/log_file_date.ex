defmodule NovelCommon.LogFileDate do
  @moduledoc """
  Local calendar date used for daily log file names.

  Log timestamps stay UTC for cross-source ordering, but desktop/stage log
  files roll over by the machine's local day so operators can find today's
  logs under the expected local date.
  """

  @spec today_iso8601() :: String.t()
  def today_iso8601 do
    {{year, month, day}, _time} = :calendar.local_time()

    year
    |> Date.new!(month, day)
    |> Date.to_iso8601()
  end
end
