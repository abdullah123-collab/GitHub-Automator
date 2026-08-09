<<<<<<< HEAD
import re
from services.ai_gateway import generate_text

def generate_description(repo_name: str, api_key: str, context_str: str = "", model: str = "gemini-3.6-flash") -> dict:
=======
import urllib.request
import json

def generate_description(repo_name: str, api_key: str) -> dict:
>>>>>>> dcd6c22624dbf173ff929c5f133afb5303974d15
    """Generate a repository description."""
    if not repo_name.strip():
        return {"success": False, "error": "Empty repo name"}

    try:
<<<<<<< HEAD
        # Try AI API if key is provided
        if api_key and api_key != "" and not api_key.startswith("demo"):
            
            if context_str:
                prompt = (
                    f"You are generating a short, professional, 1-sentence description for an existing GitHub repository named '{repo_name}'.\n"
                    f"Use the following project context to accurately describe the project's purpose and technologies.\n"
                    f"Do not make unsupported claims, and keep it concise (under 120 chars if possible).\n"
                    f"Return ONLY the final description text, nothing else.\n"
                    f"\n--- PROJECT CONTEXT ---\n{context_str}\n-----------------------\n"
                )
            else:
                prompt = (
                    f"You are generating a short, professional, 1-sentence description for a brand new GitHub repository named '{repo_name}'.\n"
                    f"Analyze the repository name and infer the likely project type and purpose.\n"
                    f"Do NOT use generic phrases such as 'A modern repository for...'.\n"
                    f"Do NOT mention that the description was inferred or guess overly specific features.\n"
                    f"Return ONLY the description text, nothing else. Keep it under 120 chars.\n"
                )

            result = generate_text(prompt, api_key, model=model, max_tokens=100)
            
            if result["success"]:
                desc = result["text"].strip()
                # Clean up any quotes AI might have added
                if desc.startswith('"') and desc.endswith('"'):
                    desc = desc[1:-1]
                return {"success": True, "description": desc}
                
            error_msg = result.get('error', 'Unknown error')
            if '403' in error_msg or 'PERMISSION_DENIED' in error_msg:
                return {"success": False, "error": "Invalid API Key or missing permissions. Please check your .env file."}
            elif '404' in error_msg or 'NOT_FOUND' in error_msg:
                return {"success": False, "error": "Invalid Gemini Model selected. Please fix 'github-automator.geminiModel' in your VS Code settings."}
            return {"success": False, "error": f"AI Generation Failed ({error_msg}). Please verify your connection and API key."}

        return {"success": False, "error": "AI Generation Failed: No valid GEMINI_API_KEY found in .env file."}
=======
        if api_key and api_key != "" and not api_key.startswith("demo"):
            result = _try_anthropic(repo_name, api_key)
            if result["success"]:
                return result
            
        # Rule-based fallback
        return {"success": True, "description": f"A modern repository for {repo_name}."}
>>>>>>> dcd6c22624dbf173ff929c5f133afb5303974d15

    except Exception as e:
        return {"success": False, "error": str(e)}

<<<<<<< HEAD
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
=======
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
>>>>>>> dcd6c22624dbf173ff929c5f133afb5303974d15
