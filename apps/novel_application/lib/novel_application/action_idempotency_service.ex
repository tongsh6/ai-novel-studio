defmodule NovelApplication.ActionIdempotencyService do
  @moduledoc """
  Application boundary for author action idempotency.

  It combines the pure key rules with the persistence receipt repository when
  real persistence is enabled. Callers still keep an in-process ledger for fast
  duplicate suppression inside the same Channel process.
  """

  alias NovelApplication.ActionIdempotencyLedger
  alias NovelDomain.AuthorActionInput

  @type scope :: ActionIdempotencyLedger.scope()

  @spec lookup(AuthorActionInput.t(), scope()) :: {:duplicate, map()} | :miss
  def lookup(%AuthorActionInput{} = input, scope) do
    with true <- inject_persistence?(),
         {:ok, attrs} <- ActionIdempotencyLedger.key_attrs(input, scope),
         receipt when not is_nil(receipt) <- NovelPersistence.AuthorActionReceiptRepo.get(attrs) do
      {:duplicate, NovelPersistence.AuthorActionReceiptRepo.entry_from_record(receipt)}
    else
      _ -> :miss
    end
  end

  @spec record(AuthorActionInput.t(), scope(), map()) :: :ok | {:error, term()}
  def record(%AuthorActionInput{} = input, scope, result) when is_map(result) do
    with true <- inject_persistence?(),
         {:ok, attrs} <- ActionIdempotencyLedger.key_attrs(input, scope),
         {:ok, _receipt} <- NovelPersistence.AuthorActionReceiptRepo.record(attrs, result) do
      :ok
    else
      false -> :ok
      :skip -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp inject_persistence? do
    Application.get_env(:novel_web, :persistence, [])
    |> Keyword.get(:inject_real_persistence, false)
  end
end
