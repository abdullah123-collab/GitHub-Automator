import re
from services.ai_gateway import generate_text
from services.ai_result import success_result, failure_result, AIErrorCode

def validate_description_content(desc: str) -> tuple[bool, str]:
    if not desc or not desc.strip():
        return False, "AI returned an empty description."
    
    desc_clean = desc.strip()
    if len(desc_clean) < 10:
        return False, "AI returned a description that is too short."
        
    desc_lower = desc_clean.lower()
    placeholders = ["[insert", "todo", "tbd", "placeholder", "lorem ipsum"]
    for ph in placeholders:
        if ph in desc_lower:
            return False, f"AI returned template/placeholder content containing '{ph}'."
            
    if desc_clean.startswith("#"):
        return False, "AI returned a description containing a Markdown heading."
        
    if desc_clean.startswith("-") or desc_clean.startswith("*"):
        return False, "AI returned a description formatted as a list."
        
    return True, ""

def generate_description(repo_name: str, api_key: str, context_str: str = "", model: str = "gemini-3.6-flash", ai_mode: str = "gemini") -> dict:
    """Generate a repository description."""
    if not repo_name.strip():
        return failure_result(AIErrorCode.EMPTY_RESPONSE, "Empty repository name provided.", "Empty repo name")

    if ai_mode == "fallback" or not api_key or api_key.startswith("demo"):
        return success_result(_rule_based_fallback(repo_name))

    try:
        if context_str:
            prompt = (
                f"You are generating a short, professional, 1-sentence description for an existing GitHub repository named '{repo_name}'.\n"
                f"Use the following project context to accurately describe the project's purpose and technologies.\n"
                f"Do not make unsupported claims, and keep it concise (under 120 chars if possible).\n"
                f"CRITICAL: Do NOT use any placeholders like '[Insert ...]', 'TODO', 'TBD', or generic filler text.\n"
                f"If the context is insufficient, generate a conservative description from available evidence (do not invent features).\n"
                f"Return ONLY the final description text, nothing else.\n"
                f"\n--- PROJECT CONTEXT ---\n{context_str}\n-----------------------\n"
            )
        else:
            prompt = (
                f"You are generating a short, professional, 1-sentence description for a brand new GitHub repository named '{repo_name}'.\n"
                f"Analyze the repository name and infer the likely project type and purpose.\n"
                f"Do NOT use generic phrases such as 'A modern repository for...'.\n"
                f"Do NOT mention that the description was inferred or guess overly specific features.\n"
                f"CRITICAL: Do NOT use any placeholders like '[Insert ...]', 'TODO', 'TBD', or generic filler text.\n"
                f"Return ONLY the description text, nothing else. Keep it under 120 chars.\n"
            )

        result = generate_text(prompt, api_key, model=model, max_tokens=100)
        
        if result["success"]:
            desc = result["text"].strip()
            # Clean up any quotes AI might have added
            if desc.startswith('"') and desc.endswith('"'):
                desc = desc[1:-1]
            
            valid, err_msg = validate_description_content(desc)
            if not valid:
                return failure_result(AIErrorCode.EMPTY_RESPONSE, f"AI returned invalid description content: {err_msg}", err_msg, fallback_content=_rule_based_fallback(repo_name))
            
            return success_result(desc)
            
        error_msg = result.get('error', 'Unknown error')
        err_lower = error_msg.lower()
        
        if 'timeouterror' in err_lower or 'timeout' in err_lower:
            code = AIErrorCode.TIMEOUT
            msg = "AI description generation timed out. Please try again."
        elif 'authenticationerror' in err_lower or 'unauthorized' in err_lower or 'api_key_invalid' in err_lower or '401' in err_lower or '403' in err_lower:
            code = AIErrorCode.INVALID_API_KEY
            msg = "Invalid Gemini API Key or authorization error."
        elif 'ratelimiterror' in err_lower or '429' in err_lower or 'quota' in err_lower:
            code = AIErrorCode.RATE_LIMIT_EXCEEDED
            msg = "Gemini API rate limit exceeded or quota exhausted. Please try again later."
        elif 'networkerror' in err_lower or 'connection' in err_lower or 'dns' in err_lower:
            code = AIErrorCode.NETWORK_FAILURE
            msg = "Network connection error. Please verify your internet connection."
        elif '404' in err_lower or 'not_found' in err_lower:
            code = AIErrorCode.MODEL_NOT_FOUND
            msg = f"Invalid Gemini Model '{model}' selected. Please fix settings."
        else:
            code = AIErrorCode.UNKNOWN
            msg = f"AI Generation Failed: {error_msg}"
            
        return failure_result(code, msg, error_msg, fallback_content=_rule_based_fallback(repo_name))

    except Exception as e:
        return failure_result(AIErrorCode.UNKNOWN, str(e), str(e), fallback_content=_rule_based_fallback(repo_name))

def _rule_based_fallback(repo_name: str) -> str:
    """Smart rule-based fallback based on repository name."""
    name_lower = repo_name.lower().replace("_", "-")
    
    # Common patterns
    if name_lower.endswith("-api"):
        base = name_lower[:-4].replace("-", " ")
        return f"A backend API for {base} built with modern web standards."
    elif "-portfolio" in name_lower or name_lower.endswith("-site") or name_lower.endswith("-website"):
        base = name_lower.replace("-portfolio", "").replace("-site", "").replace("-website", "").replace("-", " ")
        if not base.strip(): base = "personal"
        return f"A {base} portfolio website for showcasing projects and experience."
    elif name_lower.endswith("-cli") or "-tool" in name_lower:
        base = name_lower.replace("-cli", "").replace("-tool", "").replace("-", " ")
        return f"A command-line tool and utility for {base}."
    elif "-management-system" in name_lower:
        base = name_lower.replace("-management-system", "").replace("-", " ")
        return f"A system for managing {base} records and operations."
    elif name_lower.endswith("-bot"):
        base = name_lower[:-4].replace("-", " ")
        return f"An automated bot for {base} operations."
    elif "-app" in name_lower:
        base = name_lower.replace("-app", "").replace("-", " ")
        return f"An application for {base}."
    
    # Fallback to a neutral, clean format without 'A modern repository for'
    clean_name = repo_name.replace("-", " ").replace("_", " ").title()
    return f"Source code and documentation for the {clean_name} project."
