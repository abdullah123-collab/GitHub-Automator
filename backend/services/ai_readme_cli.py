import sys
import json
import os
from pathlib import Path

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

# Add backend directory to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.ai_gateway import generate_text
from services.ai_result import success_result, failure_result, AIErrorCode

def load_source_contents(repo_path: str, important_files: list) -> str:
    """Load safe, small snippets of code for AI README generation."""
    if not repo_path or not os.path.exists(repo_path):
        return ""
        
    p = Path(repo_path)
    snippets = []
    
    count = 0
    sensitive_names = {".env", "secrets", "credentials", "token", "password", "key", "config.json"}
    
    for rel_path in important_files:
        if count >= 8:
            break
            
        file_path = p / rel_path
        if not file_path.exists() or not file_path.is_file():
            continue
            
        if any(s in rel_path.lower() for s in sensitive_names):
            continue
            
        try:
            size = os.path.getsize(file_path)
            if size > 50 * 1024:
                continue
                
            ext = file_path.suffix.lower()
            if ext not in (".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".cs", ".rs", ".cpp", ".c", ".h", ".sql", ".json", ".yml", ".yaml", ".toml", ".html", ".css", ".go", ".sh", ".php"):
                continue
                
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read(1500)
                if content.strip():
                    snippets.append(f"--- FILE: {rel_path} ---\n{content.strip()}\n")
                    count += 1
        except Exception:
            pass
            
    return "\n".join(snippets)

def validate_readme_content(content: str, repo_name: str, project_context: dict) -> tuple[str, str]:
    """
    Validate generated README text.
    Returns a tuple (error_type, error_details). If valid, returns ("", "").
    Error types:
      - "AI returned an invalid README"
      - "AI returned template/placeholder content"
    """
    if not content or not content.strip():
        return "AI returned an invalid README", "Response content is empty."

    content_lower = content.lower()

    # 1. Reject obvious template placeholders
    placeholders = ["[insert", "[add", "[your", "todo", "tbd", "lorem ipsum"]
    for ph in placeholders:
        if ph in content_lower:
            return "AI returned template/placeholder content", f"Template placeholder '{ph}' detected in generated content."

    # 2. Verify Markdown starts with a heading
    if not content.strip().startswith("#"):
        return "AI returned an invalid README", "README does not start with a Markdown header (#)."

    # 3. Verify project name exists
    if repo_name.lower() not in content_lower:
        return "AI returned an invalid README", f"Project name '{repo_name}' is not mentioned in the README."

    # 4. Verify at least one detected technology exists
    techs = project_context.get('technologies', [])
    if techs and not any(t.lower() == 'general' for t in techs):
        found_tech = False
        for t in techs:
            t_clean = t.lower().replace(".js", "").replace("react (jsx)", "react").replace("react (tsx)", "react")
            if t_clean in content_lower:
                found_tech = True
                break
        if not found_tech:
            return "AI returned an invalid README", f"README does not mention any of the project's detected technologies: {techs}"

    # 5. Verify README contains meaningful prose (is not just headings)
    lines = content.split('\n')
    non_heading_lines = [l.strip() for l in lines if l.strip() and not l.strip().startswith('#') and not l.strip().startswith('-') and not l.strip().startswith('*')]
    prose_length = sum(len(l) for l in non_heading_lines)
    if prose_length < 40:
        return "AI returned an invalid README", "README does not contain meaningful descriptive prose (too short or only lists/headings)."

    # 6. Verify no raw secrets are included
    secret_patterns = [
        r"(?i)api_key\s*=\s*['\"][a-zA-Z0-9]{20,}['\"]",
        r"(?i)password\s*=\s*['\"][a-zA-Z0-9_@#]{8,}['\"]",
        r"(?i)client_secret\s*=\s*['\"][a-zA-Z0-9]{20,}['\"]"
    ]
    import re
    for pat in secret_patterns:
        if re.search(pat, content):
            return "AI returned an invalid README", "README contains potential raw secrets or credentials."

    return "", ""

def main():
    args = json.loads(sys.stdin.read())
    repo_name = args.get("repo_name", "")
    repo_path = args.get("repo_path", "")
    model = args.get("model", "gemini-3.6-flash")
    project_context = args.get("project_context", {})
    api_key = args.get("api_key") or os.getenv("GEMINI_API_KEY", "")
    ai_mode = args.get("ai_mode", "gemini")
    
    sys.stderr.write("[DIAGNOSTIC] README generation started\n")
    sys.stderr.write("[DIAGNOSTIC] Project context generated\n")
    sys.stderr.write(f"[DIAGNOSTIC] Project context size: {len(json.dumps(project_context))}\n")

    if ai_mode == "fallback" or not api_key:
        print(json.dumps(failure_result(
            AIErrorCode.INVALID_API_KEY,
            "No Gemini API key configured.",
            "Gemini API key is missing or fallback requested, but no local fallback is available for README generation."
        )))
        return
        
    source_snippets = load_source_contents(repo_path, project_context.get("importantFiles", []))
    
    prompt = (
        f"You are an expert AI README generator. Generate a professional, complete README.md for a repository named '{repo_name}'.\n"
        f"Analyze the project type, directories, and source snippets carefully to describe actual functionality.\n"
        f"Do NOT invent features, installation commands, dependency names, or database structures that are not supported by the context.\n"
        f"CRITICAL: Do NOT use any template placeholders like '[Insert ...]', '[Add ...]', '[Your ...]', 'TODO', 'TBD', or 'Lorem ipsum' in the generated README.md.\n"
        f"If a section (like Setup, Database, or Configuration) does not have concrete information in the project context, OMIT it entirely rather than using placeholders.\n"
        f"\n--- PROJECT CONTEXT ---\n"
        f"Project Name: {project_context.get('name')}\n"
        f"Detected Project Type: {project_context.get('type')}\n"
        f"Technologies Used: {', '.join(project_context.get('technologies', []))}\n"
        f"Dependencies: {', '.join(project_context.get('dependencies', []))}\n"
        f"Database Info: {', '.join(project_context.get('database_info', []))}\n"
        f"Configuration Parameters: {', '.join(project_context.get('configuration_info', []))}\n"
        f"Directory Structure: {', '.join(project_context.get('directories', []))}\n"
        f"Configuration Files: {', '.join(project_context.get('configurationFiles', []))}\n"
        f"Entry Points: {', '.join(project_context.get('entryPoints', []))}\n"
        f"\n--- RELEVANT SOURCE CODE SNIPPETS ---\n"
        f"{source_snippets}\n"
        f"--------------------------------------\n"
        f"\nGenerate a complete, specific, and professional markdown README.md. Describe only what is actually confirmed to exist in the context.\n"
        f"Format structure logically: Overview/Title, Features (list actual features), Technologies (list detected technologies), Project Structure (explain actual directories/files), Installation/Setup (only if known), Database (only if database info exists), Configuration (only if configuration parameters exist).\n"
        f"\nReturn ONLY the generated Markdown text, nothing else (no wrapper markdown blocks like ```markdown)."
    )
    
    sys.stderr.write("[DIAGNOSTIC] Gemini request started\n")
    result = generate_text(prompt, api_key, model=model, max_tokens=1500)
    
    if result["success"]:
        text = result["text"]
        sys.stderr.write(f"[DIAGNOSTIC] Gemini response received\n")
        sys.stderr.write(f"[DIAGNOSTIC] Gemini response length: {len(text)}\n")
        sys.stderr.write("[DIAGNOSTIC] README validation started\n")
        
        err_type, err_details = validate_readme_content(text, repo_name, project_context)
        if err_type:
            sys.stderr.write(f"[DIAGNOSTIC] README validation result: FAIL\n")
            sys.stderr.write(f"[DIAGNOSTIC] README validation failed: {err_type} - {err_details}\n")
            print(json.dumps(failure_result(
                AIErrorCode.EMPTY_RESPONSE,
                f"Generated README validation failed: {err_type}",
                err_details
            )))
        else:
            sys.stderr.write(f"[DIAGNOSTIC] README validation result: PASS\n")
            sys.stderr.write("[DIAGNOSTIC] README saved\n")
            print(json.dumps(success_result(text)))
    else:
        sys.stderr.write("[DIAGNOSTIC] Gemini response received\n")
        sys.stderr.write("[DIAGNOSTIC] README validation result: FAIL\n")
        error_msg = result.get('error', 'Unknown error')
        sys.stderr.write(f"[DIAGNOSTIC] README validation failed: AI request failure - {error_msg}\n")
        
        err_lower = error_msg.lower()
        if 'timeouterror' in err_lower or 'timeout' in err_lower:
            code = AIErrorCode.TIMEOUT
            msg = "AI README generation timed out. Please try again."
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
            msg = f"AI README generation failed: {error_msg}"
            
        print(json.dumps(failure_result(code, msg, error_msg)))

if __name__ == "__main__":
    main()
