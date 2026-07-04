import json
import sys

from services.ai_commit import generate_commit_message


if __name__ == "__main__":
    data = json.loads(sys.stdin.read())
    diff = data.get("diff", "")
    api_key = data.get("api_key", "")
    result = generate_commit_message(diff, api_key)
    print(json.dumps(result))
