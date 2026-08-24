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

from services.ai_description import generate_description

def extract_repo_context(repo_path: str) -> str:
    """Extract lightweight context from an existing repository."""
    if not repo_path or not os.path.exists(repo_path):
        return ""
    
    context = []
    
    # 1. Directory Structure (top-level only)
    try:
        items = os.listdir(repo_path)
        folders = [f for f in items if os.path.isdir(os.path.join(repo_path, f)) and not f.startswith('.')]
        files = [f for f in items if os.path.isfile(os.path.join(repo_path, f))]
        
        context.append(f"Top-level Folders: {', '.join(folders[:10])}")
        context.append(f"Top-level Files: {', '.join(files[:15])}")
    except Exception:
        pass

    # 2. README Snippet
    for rm_name in ["README.md", "README.txt", "readme.md"]:
        rm_path = os.path.join(repo_path, rm_name)
        if os.path.exists(rm_path):
            try:
                with open(rm_path, "r", encoding="utf-8") as f:
                    snippet = f.read(400).strip()
                    if snippet:
                        context.append(f"README Snippet:\n{snippet}...")
                break
            except Exception:
                pass
                
    # 3. Metadata (package.json, pyproject.toml)
    try:
        pkg_json = os.path.join(repo_path, "package.json")
        if os.path.exists(pkg_json):
            with open(pkg_json, "r", encoding="utf-8") as f:
                data = json.load(f)
                deps = list(data.get("dependencies", {}).keys())[:5]
                dev_deps = list(data.get("devDependencies", {}).keys())[:5]
                if deps or dev_deps:
                    context.append(f"Node Dependencies: {', '.join(deps + dev_deps)}")
                    
        py_toml = os.path.join(repo_path, "pyproject.toml")
        if os.path.exists(py_toml):
            with open(py_toml, "r", encoding="utf-8") as f:
                content = f.read()
                if "tool.poetry.dependencies" in content or "project.dependencies" in content:
                    context.append("Python Project (uses pyproject.toml)")
    except Exception:
        pass

    return "\n\n".join(context)

if __name__ == "__main__":
    args = json.loads(sys.stdin.buffer.read().decode('utf-8'))
    repo_name = args.get("repo_name", "")
    api_key = args.get("api_key") or os.getenv("GEMINI_API_KEY", "")
    ai_mode = args.get("ai_mode", "gemini")
    model = args.get("model", "gemini-3.6-flash")
    
    repo_path = args.get("repo_path", "")
    project_context = args.get("project_context", {})
    
    context_str = ""
    if project_context:
        context_parts = []
        if project_context.get('name'):
            context_parts.append(f"Project Name: {project_context.get('name')}")
        if project_context.get('type'):
            context_parts.append(f"Detected Project Type: {project_context.get('type')}")
        if project_context.get('technologies'):
            context_parts.append(f"Technologies Used: {', '.join(project_context.get('technologies', []))}")
        if project_context.get('dependencies'):
            context_parts.append(f"Dependencies: {', '.join(project_context.get('dependencies', []))}")
        if project_context.get('database_info'):
            context_parts.append(f"Database Info: {', '.join(project_context.get('database_info', []))}")
        if project_context.get('configuration_info'):
            context_parts.append(f"Configuration Parameters: {', '.join(project_context.get('configuration_info', []))}")
        if project_context.get('directories'):
            context_parts.append(f"Directory Structure: {', '.join(project_context.get('directories', []))}")
        context_str = "\n".join(context_parts)
    else:
        context_str = extract_repo_context(repo_path)
        
    result = generate_description(repo_name, api_key=api_key, context_str=context_str, model=model, ai_mode=ai_mode)
    print(json.dumps(result))
