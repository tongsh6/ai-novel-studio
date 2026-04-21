from __future__ import annotations

import unittest

from novel_workbench.validators import validate_router_result


class RouterValidatorTest(unittest.TestCase):
    def test_auto_repairs_reply_overreach(self) -> None:
        payload = {
            "intent": "ADVANCE_PLOT",
            "parameters": {
                "work_name": "天龙",
                "current_plot_scope": "current_plot",
                "advance_goal": "reasonable_next_progression",
                "target_position": "",
                "constraints": [],
            },
            "missing_fields": ["target_position"],
            "confidence": 0.9,
            "reply": "好的，我会帮你推进剧情。",
        }
        result = validate_router_result(payload)
        self.assertTrue(result["is_valid"])
        self.assertIn("AUTO_REPAIRED_REPLY_OVERREACH", result["warnings"])
        self.assertEqual(result["validated_result"]["reply"], "已识别为推进当前剧情的请求。")

    def test_detects_empty_parameters_false_positive(self) -> None:
        payload = {
            "intent": "REFINE_EXISTING_CHARACTER",
            "parameters": {},
            "missing_fields": [],
            "confidence": 0.88,
            "reply": "已识别为角色细化请求。",
        }
        result = validate_router_result(payload)
        self.assertFalse(result["is_valid"])
        self.assertIn("FAIL_PARAMETERS_EMPTY", result["error_codes"])


if __name__ == "__main__":
    unittest.main()
