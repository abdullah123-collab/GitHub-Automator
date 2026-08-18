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
            if ext not in (".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".cs", ".rs", ".cpp", ".c", ".h", ".sql", ".json", ".yml", ".yaml", ".toml"):
                continue
                
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read(1500)
                if content.strip():
                    snippets.append(f"--- FILE: {rel_path} ---\n{content.strip()}\n")
                    count += 1
        except Exception:
            pass
            
    return "\n".join(snippets)

def main():
    args = json.loads(sys.stdin.read())
    repo_name = args.get("repo_name", "")
    repo_path = args.get("repo_path", "")
    model = args.get("model", "gemini-3.6-flash")
    project_context = args.get("project_context", {})
    
    api_key = os.getenv("GEMINI_API_KEY", "")
    if not api_key:
        print(json.dumps({"success": False, "error": "No GEMINI_API_KEY found in .env"}))
        return
        
    source_snippets = load_source_contents(repo_path, project_context.get("importantFiles", []))
    
    prompt = (
        f"You are an expert AI README generator. Generate a professional, complete README.md for a repository named '{repo_name}'.\n"
        f"Analyze the project type, directories, and source snippets carefully.\n"
        f"Do NOT invent features, installation commands, dependency names, or database structures that are not supported by the context.\n"
        f"If any details (like installation or database config) are not known, omit them or write a clean placeholder requiring user input (e.g., [Insert Setup details]).\n"
        f"\n--- PROJECT CONTEXT ---\n"
        f"Project Name: {project_context.get('name')}\n"
        f"Detected Project Type: {project_context.get('type')}\n"
        f"Technologies Used: {', '.join(project_context.get('technologies', []))}\n"
        f"Directory Structure: {', '.join(project_context.get('directories', []))}\n"
        f"Configuration Files: {', '.join(project_context.get('configurationFiles', []))}\n"
        f"Entry Points: {', '.join(project_context.get('entryPoints', []))}\n"
        f"\n--- RELEVANT SOURCE CODE SNIPPETS ---\n"
        f"{source_snippets}\n"
        f"--------------------------------------\n"
        f"\nFollow this exact markdown structure (omitting sections only if no information exists):\n"
        f"# {repo_name}\n"
        f"Overview of the project.\n"
        f"## Features\n"
        f"List actual features.\n"
        f"## Technologies\n"
        f"List technologies.\n"
        f"## Project Structure\n"
        f"Explain key directories/files.\n"
        f"## Usage\n"
        f"How to run or use it.\n"
        f"## Installation / Setup\n"
        f"Step-by-step setup commands based on the tech stack (e.g. npm install, pip install).\n"
        f"## Database\n"
        f"Database configuration (only if it is a database project).\n"
        f"## Configuration\n"
        f"Safe config environment variables or settings (omit secrets).\n"
        f"## Contributing\n"
        f"## License\n"
        f"\nReturn ONLY the generated Markdown text, nothing else (no wrapper markdown blocks like ```markdown)."
    )
    
    result = generate_text(prompt, api_key, model=model, max_tokens=1500)
    
    if not result["success"]:
        error_msg = result.get('error', 'Unknown error')
        if 'timeouterror' in error_msg.lower():
            result["error"] = "AI README generation timed out. Please try again."
        elif 'authenticationerror' in error_msg.lower():
            result["error"] = "Invalid Gemini API Key or authorization error. Please check your .env file."
        elif 'ratelimiterror' in error_msg.lower():
            result["error"] = "Gemini API rate limit exceeded. Please try again later."
        elif 'networkerror' in error_msg.lower():
            result["error"] = "Network connection error. Please verify your internet connection."
            
    print(json.dumps(result))

if __name__ == "__main__":
    main()
