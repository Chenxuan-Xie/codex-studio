# -*- coding: utf-8 -*-
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import server  # noqa: E402


class ProtocolTests(unittest.TestCase):
    def test_extract_fenced_plan(self):
        text = "计划：\n```json\n" + json.dumps(
            {"status": "dispatch", "reason": "x", "tasks": [
                {"worker": "api-1", "prompt": "do", "task_id": "R1-api-1"}
            ]}
        ) + "\n```\n"
        obj = server.extract_json_payload(text)
        self.assertEqual(obj["status"], "dispatch")

    def test_normalize_plan(self):
        workers = [
            {"name": "api-1", "kind": "api", "provider": "workbuddy", "model": "m"},
            {"name": "codex-01", "kind": "codex", "thread_id": "t", "model": "gpt"},
        ]
        p = server.normalize_plan(
            {"status": "dispatch", "reason": "r", "tasks": [
                {"worker": "API-1", "prompt": "x", "difficulty": "high"}
            ]},
            workers,
            2,
        )
        self.assertEqual(p["tasks"][0]["worker"], "api-1")
        self.assertEqual(p["tasks"][0]["kind"], "api")
        self.assertEqual(p["tasks"][0]["difficulty"], "high")

    def test_normalize_dsh_worker(self):
        workers = [
            {
                "name": "dsh-1",
                "kind": "dsh",
                "session_id": "session-abc",
                "cwd": r"D:\project",
                "provider": "workbuddy",
                "model": "cn:deepseek-v4.1-flash",
            }
        ]
        p = server.normalize_plan(
            {"status": "dispatch", "reason": "r", "tasks": [
                {"worker": "dsh-1", "prompt": "x"}
            ]},
            workers,
            1,
        )
        self.assertEqual(p["tasks"][0]["session_id"], "session-abc")
        self.assertEqual(p["tasks"][0]["cwd"], r"D:\project")

    def test_result_filename_is_task_scoped(self):
        self.assertEqual(
            server.result_filename("R1-api-1"), ".codex-studio-result-R1-api-1.json"
        )

    def test_dsh_model_patch(self):
        text = server.dsh_model_patch("workbuddy", "cn:deepseek-v4.1-flash")
        self.assertIn("provider: workbuddy", text)
        self.assertIn("model: cn:deepseek-v4.1-flash", text)


class CredentialTests(unittest.TestCase):
    def test_read_refs_without_exposing_values(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            (home / ".credentials.yaml").write_text(
                "version: 1\nrefs:\n  WORKBUDDY_API_KEY: abc\n  SILICONFLOW_API_KEY: def\n",
                encoding="utf-8",
            )
            refs = server.load_dsh_refs(home)
            self.assertEqual(refs["WORKBUDDY_API_KEY"], "abc")
            self.assertEqual(set(refs), {"WORKBUDDY_API_KEY", "SILICONFLOW_API_KEY"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
