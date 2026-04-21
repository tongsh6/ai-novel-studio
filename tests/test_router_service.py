from __future__ import annotations

import json
import unittest
from pathlib import Path
from unittest.mock import patch

from novel_workbench.router.service import RouterService


FIXTURES = Path(__file__).parent / "fixtures" / "router_cases.json"


class RouterServiceTest(unittest.TestCase):
    def test_route_normalizes_fixture_result(self) -> None:
        fixture = json.loads(FIXTURES.read_text(encoding="utf-8"))[0]
        service = RouterService()
        with patch("novel_workbench.router.service.llm_client.chat_json", return_value=fixture["result"]):
            result = service.route(
                fixture["request"],
                router_context={"minimal_context": {"work_name": "天龙"}},
            )
        self.assertEqual(result["intent"], "CREATE_CHARACTER_CANDIDATES")
        self.assertIn("missing_fields", result)
        self.assertEqual(result["parameters"]["work_name"], "天龙")

    def test_route_falls_back_to_normalized_other_on_llm_error(self) -> None:
        service = RouterService()
        with patch("novel_workbench.router.service.llm_client.chat_json", side_effect=RuntimeError("boom")):
            result = service.route("随便聊聊", router_context={"minimal_context": {"work_name": ""}})
        self.assertEqual(result["intent"], "OTHER")
        self.assertEqual(result["confidence"], 0.0)


if __name__ == "__main__":
    unittest.main()
