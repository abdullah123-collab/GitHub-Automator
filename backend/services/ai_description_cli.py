import sys
import json
import os

# Add backend directory to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.ai_description import generate_description

if __name__ == "__main__":
    args = json.loads(sys.stdin.buffer.read().decode('utf-8'))
    repo_name = args.get("repo_name", "")
    api_key = args.get("api_key", "")
    
    result = generate_description(repo_name, api_key)
    print(json.dumps(result))
