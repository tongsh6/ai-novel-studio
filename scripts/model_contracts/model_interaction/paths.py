"""Repository locations for the imported VS-00M offline review tools; no product I/O."""
from __future__ import annotations
import os
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DESIGN = ROOT / "docs/design/contracts/model-interaction"
SCHEMAS = ROOT / "docs/design/schemas/model-interaction"
CATALOGS = DESIGN / "reference"
FIXTURES = ROOT / "quality/acceptance/fixtures/model-interaction"
TOOLS = Path(__file__).resolve().parent
ARTIFACTS = ROOT / "artifacts/model-contracts/vs00m-design"


def report_dir(value: str | None = None) -> Path:
    """Reject output paths outside the repository's ignored evidence area."""
    configured = value or os.environ.get("ANS_MODEL_PROTOCOL_REPORT_DIR")
    result = Path(configured) if configured else ARTIFACTS / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    if not result.is_absolute():
        result = ROOT / result
    result = result.resolve()
    if not result.is_relative_to(ARTIFACTS.resolve()):
        raise ValueError("Reports must stay under artifacts/model-contracts/vs00m-design/.")
    result.mkdir(parents=True, exist_ok=True)
    os.environ["ANS_MODEL_PROTOCOL_REPORT_DIR"] = str(result)
    return result


def report_file(name: str, value: str | None = None) -> Path:
    if value is None:
        return report_dir() / name
    path = Path(value)
    path = path if path.is_absolute() else ROOT / path
    path = path.resolve()
    if not path.is_relative_to(ARTIFACTS.resolve()):
        raise ValueError("Reports must stay under artifacts/model-contracts/vs00m-design/.")
    path.parent.mkdir(parents=True, exist_ok=True)
    return path
