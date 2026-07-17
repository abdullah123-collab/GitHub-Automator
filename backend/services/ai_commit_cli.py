import json
import sys
from pathlib import Path

BACKEND_ROOT = str(Path(__file__).resolve().parents[1])
if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)

from services.ai_commit import generate_commit_message


if __name__ == "__main__":
    data = json.loads(sys.stdin.buffer.read().decode('utf-8'))
    diff = data.get("diff", "")
    api_key = data.get("api_key", "")
    model = data.get("model", "claude-3-5-haiku-latest")
    result = generate_commit_message(diff, api_key, model)
    print(json.dumps(result))
