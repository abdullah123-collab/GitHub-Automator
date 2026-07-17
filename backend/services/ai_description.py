import urllib.request
import json

def generate_description(repo_name: str, api_key: str) -> dict:
    """Generate a repository description."""
    if not repo_name.strip():
        return {"success": False, "error": "Empty repo name"}

    try:
        if api_key and api_key != "" and not api_key.startswith("demo"):
            result = _try_anthropic(repo_name, api_key)
            if result["success"]:
                return result
            
        # Rule-based fallback
        return {"success": True, "description": f"A modern repository for {repo_name}."}

    except Exception as e:
        return {"success": False, "error": str(e)}

def _try_anthropic(repo_name: str, api_key: str) -> dict:
    """Try to use Anthropic API for description generation."""
    try:
        payload = json.dumps({
            "model": "claude-3-haiku-20240307",
            "max_tokens": 100,
            "messages": [{
                "role": "user",
                "content": f"Generate a short, professional, 1-sentence description for a GitHub repository named '{repo_name}'. Only output the description text, nothing else."
            }]
        }).encode()

        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=payload,
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json"
            }
        )

        with urllib.request.urlopen(req, timeout=10) as response:
            res_body = response.read()
            data = json.loads(res_body)
            desc = data["content"][0]["text"].strip()
            return {"success": True, "description": desc}
    except Exception as e:
        return {"success": False, "error": str(e)}
