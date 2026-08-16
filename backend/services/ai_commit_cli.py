import json
import sys
import os
from pathlib import Path

# Load .env
def load_env_safely(env_path: Path):
    if not env_path.exists(): return
    try:
        with open(env_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, val = line.split('=', 1)
                    os.environ[key.strip()] = val.strip()
    except Exception:
        pass

project_root = Path(__file__).resolve().parents[2]
env_path = project_root / ".env"
load_env_safely(env_path)

BACKEND_ROOT = str(Path(__file__).resolve().parents[1])
if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)

from services.ai_commit import generate_commit_message


if __name__ == "__main__":
    data = json.loads(sys.stdin.buffer.read().decode('utf-8'))
    diff = data.get("diff", "")
    api_key = os.getenv("GEMINI_API_KEY", "")
    
    model = data.get("model", "gemini-3.6-flash")
    result = generate_commit_message(diff, api_key, model)
    print(json.dumps(result))
