from enum import Enum

class AIErrorCode(str, Enum):
    INVALID_API_KEY = "INVALID_API_KEY"
    RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED"
    NETWORK_FAILURE = "NETWORK_FAILURE"
    MODEL_NOT_FOUND = "MODEL_NOT_FOUND"
    TIMEOUT = "TIMEOUT"
    EMPTY_RESPONSE = "EMPTY_RESPONSE"
    UNKNOWN = "UNKNOWN"

def success_result(content: str) -> dict:
    return {
        "success": True,
        "content": content
    }

def failure_result(code: AIErrorCode, message: str, details: str, fallback_content: str = None) -> dict:
    return {
        "success": False,
        "error": {
            "code": code.value if isinstance(code, AIErrorCode) else code,
            "message": message,
            "details": details,
            "fallback": {
                "available": fallback_content is not None,
                "content": fallback_content
            }
        }
    }
