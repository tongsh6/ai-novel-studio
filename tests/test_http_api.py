from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from novel_workbench.http_api import create_server


class HttpApiTest(unittest.TestCase):
    def test_server_factory(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            db = Path(tmpdir) / "api.sqlite3"
            web = Path(tmpdir)
            (web / "index.html").write_text("<html></html>", encoding="utf-8")
            fake_server = object()
            with patch("novel_workbench.http_api.ThreadingHTTPServer", return_value=fake_server) as factory:
                server = create_server(host="127.0.0.1", port=0, db_path=db, static_dir=web)
            self.assertIs(server, fake_server)
            factory.assert_called_once()


if __name__ == "__main__":
    unittest.main()
