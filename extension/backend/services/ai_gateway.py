import urllib.request
import urllib.error
import socket
import json
import time
import os
import sys
import uuid

def log_ai(msg: str):
    print(msg, file=sys.stderr, flush=True)

def generate_text(prompt: str, api_key: str, model: str = "gemini-3.6-flash", max_tokens: int = 150) -> dict:
    """
    Central AI Gateway to abstract AI provider logic.
    """
    req_id = str(uuid.uuid4())[:8]
    log_ai(f"[AI GENERATION START] request_id={req_id} timestamp={time.time()}")
    
    start_time = time.time()
    if not api_key or api_key.startswith("demo"):
        log_ai(f"[AI ERROR] request_id={req_id} status=auth_error error=invalid_or_demo_key attempt=0")
        return {"success": False, "error": "AuthenticationError: Invalid or demo API key"}

    res = _call_gemini(prompt, api_key, model, max_tokens, req_id)
    
    total_latency_ms = int((time.time() - start_time) * 1000)
    log_ai(f"[AI GENERATION END] request_id={req_id} total_latency_ms={total_latency_ms} success={res.get('success', False)}")
    return res

def _call_gemini(prompt: str, api_key: str, model: str, max_tokens: int, req_id: str) -> dict:
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
        log_ai(f"[AI REQUEST] request_id={req_id} provider=gemini model={model} attempt={attempt} prompt_chars={len(prompt)}")
        attempt_start = time.time()
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                res_body = response.read()
                data = json.loads(res_body)
                
                try:
                    text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
                except (KeyError, IndexError):
                    log_ai(f"[AI ERROR] request_id={req_id} status=invalid_format attempt={attempt} error='Invalid response format'")
                    return {"success": False, "error": "Gemini API error: Invalid response format from Gemini API"}
                
                if not text:
                    log_ai(f"[AI ERROR] request_id={req_id} status=empty_response attempt={attempt} error='Empty response from provider'")
                    return {"success": False, "error": "Gemini API error: Empty response from provider"}
                    
                latency_ms = int((time.time() - attempt_start) * 1000)
                log_ai(f"[AI RESPONSE] request_id={req_id} status=200 latency_ms={latency_ms} response_chars={len(text)}")
                return {"success": True, "text": text}

        except urllib.error.HTTPError as e:
            latency_ms = int((time.time() - attempt_start) * 1000)
            status_code = e.code
            try:
                err_content = e.read().decode('utf-8')
                err_json = json.loads(err_content)
                err_msg = err_json.get("error", {}).get("message", str(e))
                err_status = err_json.get("error", {}).get("status", "")
            except Exception:
                err_msg = str(e)
                err_status = ""
            
            log_ai(f"[AI ERROR] request_id={req_id} status={status_code} latency_ms={latency_ms} attempt={attempt} error='{err_msg}'")
            
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
            
            return {"success": False, "error": f"Gemini API error: HTTP {status_code} Error: {err_msg}"}

        except (urllib.error.URLError, socket.timeout, TimeoutError) as e:
            latency_ms = int((time.time() - attempt_start) * 1000)
            is_timeout = False
            if isinstance(e, (socket.timeout, TimeoutError)):
                is_timeout = True
            elif isinstance(e, urllib.error.URLError):
                if isinstance(e.reason, (socket.timeout, TimeoutError)):
                    is_timeout = True
                elif "timed out" in str(e.reason).lower():
                    is_timeout = True

            log_ai(f"[AI ERROR] request_id={req_id} status={'timeout' if is_timeout else 'network_error'} latency_ms={latency_ms} attempt={attempt} error='{str(e)}'")

            if attempt < max_attempts:
                time.sleep(backoff_seconds)
                continue

            if is_timeout:
                return {"success": False, "error": "TimeoutError: The read operation timed out"}
            else:
                reason_str = str(e.reason) if hasattr(e, 'reason') else str(e)
                return {"success": False, "error": f"NetworkError: {reason_str}"}

        except Exception as e:
            latency_ms = int((time.time() - attempt_start) * 1000)
            log_ai(f"[AI ERROR] request_id={req_id} status=unknown latency_ms={latency_ms} attempt={attempt} error='{str(e)}'")
            return {"success": False, "error": f"Gemini API error: {str(e)}"}

