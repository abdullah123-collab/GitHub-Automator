import urllib.request
import json

def generate_text(prompt: str, api_key: str, model: str = "gemini-3.6-flash", max_tokens: int = 150) -> dict:
    """
    Central AI Gateway to abstract AI provider logic.
    Currently uses Gemini API. Designed to support OpenRouter/OpenAI later.
    """
    if not api_key or api_key.startswith("demo"):
        return {"success": False, "error": "Invalid or demo API key"}

    return _call_gemini(prompt, api_key, model, max_tokens)

def _call_gemini(prompt: str, api_key: str, model: str, max_tokens: int) -> dict:
    """Internal Gemini API call."""
    try:
        payload = json.dumps({
            "contents": [{
                "parts": [{"text": prompt}]
            }]
        }).encode()

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
        req = urllib.request.Request(
            url,
            data=payload,
            headers={
                "Content-Type": "application/json"
            }
        )

        with urllib.request.urlopen(req, timeout=15) as response:
            res_body = response.read()
            data = json.loads(res_body)
            
            try:
                text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
            except (KeyError, IndexError):
                return {"success": False, "error": "Invalid response format from Gemini API"}
            
            if not text:
                return {"success": False, "error": "Empty response from provider"}
                
            return {"success": True, "text": text}

    except Exception as e:
        return {"success": False, "error": f"Gemini API error: {str(e)}"}
