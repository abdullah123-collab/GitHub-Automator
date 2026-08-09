import os
import urllib.request
import urllib.error
import json
from pathlib import Path

try:
    from dotenv import load_dotenv
    project_root = Path(__file__).resolve().parent
    env_path = project_root / ".env"
    if env_path.exists():
        print(f"Found .env at {env_path}")
        load_dotenv(dotenv_path=env_path)
    else:
        print(f"Could not find .env at {env_path}")
except ImportError:
    print("python-dotenv not installed")

api_key = os.getenv("GEMINI_API_KEY", "")
if not api_key:
    print("GEMINI_API_KEY is empty in environment")
else:
    print(f"GEMINI_API_KEY loaded (starts with {api_key[:5]}...)")

prompt = "Hello, respond with a short greeting."
payload = json.dumps({
    "contents": [{
        "parts": [{"text": prompt}]
    }]
}).encode()

model = "gemini-3.6-flash"
url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})

print("Sending request to Gemini...")
try:
    with urllib.request.urlopen(req, timeout=15) as response:
        res_body = response.read()
        print("Success!")
        print(res_body.decode()[:100])
except urllib.error.HTTPError as e:
    print(f"HTTP Error {e.code}: {e.reason}")
    print(e.read().decode())
except Exception as e:
    print(f"Other Error: {e}")
