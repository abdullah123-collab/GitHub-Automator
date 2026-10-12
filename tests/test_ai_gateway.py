import io
import json
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from services.ai_gateway import generate_text


class FakeResponse:
    def __init__(self, body):
        self.body = json.dumps(body).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def read(self):
        return self.body


class AiGatewayTests(unittest.TestCase):
    API_KEY = "synthetic-gemini-key-not-real"

    def test_api_key_is_sent_in_header_not_url(self):
        captured = {}

        def fake_urlopen(request, timeout):
            captured["request"] = request
            captured["timeout"] = timeout
            return FakeResponse({
                "candidates": [{
                    "content": {"parts": [{"text": "generated text"}]}
                }]
            })

        with patch("services.ai_gateway.urllib.request.urlopen", side_effect=fake_urlopen):
            result = generate_text("prompt", self.API_KEY)

        request = captured["request"]
        self.assertTrue(result["success"])
        self.assertEqual(request.get_header("X-goog-api-key"), self.API_KEY)
        self.assertNotIn(self.API_KEY, request.full_url)
        self.assertNotIn("?key=", request.full_url)

    def test_missing_key_is_rejected_without_http_request(self):
        with patch("services.ai_gateway.urllib.request.urlopen") as urlopen:
            result = generate_text("prompt", "")

        self.assertFalse(result["success"])
        self.assertIn("Invalid or demo API key", result["error"])
        urlopen.assert_not_called()

    def test_http_error_redacts_key_from_error_and_logs(self):
        error_body = json.dumps({
            "error": {
                "message": f"invalid key {self.API_KEY}",
                "status": "UNAUTHENTICATED",
            }
        }).encode("utf-8")

        def fake_urlopen(request, timeout):
            raise urllib.error.HTTPError(
                request.full_url,
                403,
                "Forbidden",
                {},
                io.BytesIO(error_body),
            )

        with patch("services.ai_gateway.urllib.request.urlopen", side_effect=fake_urlopen), \
             patch("services.ai_gateway.log_ai") as log:
            result = generate_text("prompt", self.API_KEY)

        self.assertFalse(result["success"])
        self.assertNotIn(self.API_KEY, result["error"])
        self.assertNotIn(self.API_KEY, "\n".join(call.args[0] for call in log.call_args_list))

    def test_timeout_and_rate_limit_behavior_remains_safe(self):
        with patch(
            "services.ai_gateway.urllib.request.urlopen",
            side_effect=TimeoutError(self.API_KEY),
        ):
            result = generate_text("prompt", self.API_KEY)

        self.assertFalse(result["success"])
        self.assertIn("TimeoutError", result["error"])
        self.assertNotIn(self.API_KEY, result["error"])

        error = urllib.error.HTTPError(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
            429,
            "Too Many Requests",
            {},
            io.BytesIO(b'{"error":{"message":"quota exceeded"}}'),
        )
        with patch("services.ai_gateway.urllib.request.urlopen", side_effect=error):
            result = generate_text("prompt", self.API_KEY)

        self.assertFalse(result["success"])
        self.assertIn("RateLimitError", result["error"])
        self.assertNotIn(self.API_KEY, result["error"])


if __name__ == "__main__":
    unittest.main()
