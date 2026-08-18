import urllib.request
import urllib.error
import socket
import json
import time
import os

def generate_text(prompt: str, api_key: str, model: str = "gemini-3.6-flash", max_tokens: int = 150) -> dict:
    """
    Central AI Gateway to abstract AI provider logic.
    Currently uses Gemini API. Designed to support OpenRouter/OpenAI later.
    """
    if not api_key or api_key.startswith("demo"):
        return {"success": False, "error": "AuthenticationError: Invalid or demo API key"}

    return _call_gemini(prompt, api_key, model, max_tokens)

def _call_gemini(prompt: str, api_key: str, model: str, max_tokens: int) -> dict:
    """Internal Gemini API call with timeout, retries, and error categorization."""
    timeout_str = os.getenv("GEMINI_TIMEOUT", "30")
    try:
        timeout = int(timeout_str)
    except ValueError:
        timeout = 30

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

    max_attempts = 3
    backoff_seconds = 2

    for attempt in range(1, max_attempts + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                res_body = response.read()
                data = json.loads(res_body)
                
                try:
                    text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
                except (KeyError, IndexError):
                    return {"success": False, "error": "Gemini API error: Invalid response format from Gemini API"}
                
                if not text:
                    return {"success": False, "error": "Gemini API error: Empty response from provider"}
                    
                return {"success": True, "text": text}

        except urllib.error.HTTPError as e:
            # HTTPError is raised for non-200 responses.
            # Differentiate HTTP errors:
            status_code = e.code
            try:
                err_content = e.read().decode('utf-8')
                err_json = json.loads(err_content)
                err_msg = err_json.get("error", {}).get("message", str(e))
                err_status = err_json.get("error", {}).get("status", "")
            except Exception:
                err_msg = str(e)
                err_status = ""
            
            # If it's a 5xx server error, treat it as a transient error and retry.
            if status_code >= 500:
                if attempt < max_attempts:
                    time.sleep(backoff_seconds)
                    continue
                return {"success": False, "error": f"NetworkError: HTTP {status_code} Server Error: {err_msg}"}
            
            # Handle rate limits (429)
            if status_code == 429:
                return {"success": False, "error": f"RateLimitError: HTTP 429 Too Many Requests: {err_msg}"}
            
            # Handle authentication errors (401, 403, or invalid API key message)
            if status_code in (401, 403) or "API_KEY_INVALID" in err_status or "invalid api key" in err_msg.lower():
                return {"success": False, "error": f"AuthenticationError: HTTP {status_code} Unauthorized: {err_msg}"}
            
            # Other client errors
            return {"success": False, "error": f"Gemini API error: HTTP {status_code} Error: {err_msg}"}

        except (urllib.error.URLError, socket.timeout, TimeoutError) as e:
            # Check if it is a timeout
            is_timeout = False
            if isinstance(e, (socket.timeout, TimeoutError)):
                is_timeout = True
            elif isinstance(e, urllib.error.URLError):
                if isinstance(e.reason, (socket.timeout, TimeoutError)):
                    is_timeout = True
                elif "timed out" in str(e.reason).lower():
                    is_timeout = True

            # Retry transient timeout or network/connection issues
            if attempt < max_attempts:
                time.sleep(backoff_seconds)
                continue

            if is_timeout:
                return {"success": False, "error": "TimeoutError: The read operation timed out"}
            else:
                reason_str = str(e.reason) if hasattr(e, 'reason') else str(e)
                return {"success": False, "error": f"NetworkError: {reason_str}"}

        except Exception as e:
            # For other unexpected errors, return immediately
            return {"success": False, "error": f"Gemini API error: {str(e)}"}

