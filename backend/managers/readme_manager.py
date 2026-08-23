import os
import sys
import json
import subprocess
from pathlib import Path
import urllib.error

# Resolve paths
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.append(backend_dir)

from services.ai_gateway import generate_text

def load_env_safely(env_path: Path):
    if not env_path.exists():
        return
    try:
        with open(env_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, val = line.split('=', 1)
                    os.environ[key.strip()] = val.strip()
    except Exception:
        pass

# Load environment variables
load_env_safely(Path(backend_dir) / ".env")

CREATION_FLAGS = 0x08000000 if sys.platform == 'win32' else 0

def git_ls_files(repo_path: str) -> list:
    """Run git ls-files to query non-ignored repository files."""
    try:
        cmd = ["git", "ls-files", "--cached", "--others", "--exclude-standard"]
        res = subprocess.run(
            cmd,
            cwd=repo_path,
            capture_output=True,
            text=True,
            timeout=10,
            creationflags=CREATION_FLAGS
        )
        if res.returncode == 0:
            return [line.strip().replace("\\", "/") for line in res.stdout.splitlines() if line.strip()]
    except Exception:
        pass
    return None

def walk_fallback(repo_path: str) -> list:
    """Fallback standard walking when Git is not available."""
    files = []
    p = Path(repo_path)
    ignore_dirs = {
        ".git", "node_modules", ".venv", "venv", "env", "__pycache__",
        "dist", "build", "coverage", ".next", ".cache", "target", "bin", "obj"
    }
    for root, dirs, fnames in os.walk(repo_path):
        # Prune ignored directories in-place
        dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ignore_dirs]
        
        # Limit depth
        rel_root = os.path.relpath(root, repo_path)
        depth = 0 if rel_root == "." else len(Path(rel_root).parts)
        if depth > 4:
            dirs[:] = []
            continue

        for fn in fnames:
            if fn.startswith('.'):
                continue
            abs_p = os.path.join(root, fn)
            rel_p = os.path.relpath(abs_p, repo_path).replace("\\", "/")
            files.append(rel_p)
    return files

def get_priority_score(rel_path: str, fn: str, ext: str) -> int:
    fn_lower = fn.lower()
    if fn in ("package.json", "requirements.txt", "pyproject.toml", "pom.xml", "build.gradle", "Cargo.toml", "composer.json", "go.mod", "Gemfile", "docker-compose.yml", "Dockerfile") or fn_lower.endswith(".csproj"):
        return 10
    if ext == ".sql" or fn == "schema.prisma":
        return 8
    if fn_lower in ("main.py", "app.py", "index.js", "server.js", "main.rs", "program.cs", "index.html", "app.js"):
        return 7
    parts = rel_path.lower().split('/')
    if any(p in parts for p in ("src", "app", "lib", "components", "routes")):
        if ext in (".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".cs", ".rs", ".go", ".cpp", ".c", ".h", ".sh", ".php", ".rb"):
            return 6
    if ext in (".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".cs", ".rs", ".go", ".cpp", ".c", ".h", ".sh", ".php", ".rb"):
        return 4
    return 1

def analyze_repo_for_readme(repo_path: str) -> dict:
    if not os.path.isdir(repo_path):
        return {"success": False, "error": f"Not a directory: {repo_path}"}

    p = Path(repo_path)
    proj_name = p.name

    files_list = git_ls_files(repo_path)
    if files_list is None:
        files_list = walk_fallback(repo_path)

    binary_exts = {
        ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".zip", ".tar", ".gz", 
        ".pdf", ".exe", ".bin", ".dll", ".so", ".dylib", ".woff", ".woff2", 
        ".eot", ".ttf", ".mp3", ".mp4", ".wav", ".db", ".sqlite"
    }
    sensitive_names = {
        ".env", "credentials.json", "secrets.json", "secrets", "credentials", 
        "token", "password", "key", "config.json"
    }
    sensitive_exts = {".pem", ".key", ".token"}

    all_files = []
    folders = set()

    for rel_path in files_list:
        parts = rel_path.split("/")
        
        # Track directories
        for i in range(1, len(parts)):
            folders.add("/".join(parts[:i]))

        fn = parts[-1]
        if fn.startswith('.'):
            continue

        fn_lower = fn.lower()
        if fn_lower in sensitive_names or any(s in fn_lower for s in ("secret", "credential", "password", "token")):
            continue

        ext = Path(fn).suffix.lower()
        if ext in sensitive_exts or ext in binary_exts:
            continue

        abs_file_path = p / rel_path
        try:
            size = os.path.getsize(abs_file_path)
        except Exception:
            size = 0
        if size > 50 * 1024 or size == 0:
            continue

        depth = len(parts) - 1
        all_files.append((rel_path, fn, ext, depth))

    sorted_files = sorted(all_files, key=lambda x: get_priority_score(x[0], x[1], x[2]), reverse=True)
    selected_files = sorted_files[:20]

    techs = set()
    dependencies = []
    db_info = []
    config_vars = []
    config_files = []
    entry_points = []
    important_files = []

    tech_map = {
        ".py": "Python",
        ".js": "JavaScript",
        ".jsx": "React (JSX)",
        ".ts": "TypeScript",
        ".tsx": "React (TSX)",
        ".html": "HTML",
        ".css": "CSS",
        ".java": "Java",
        ".cs": "C#",
        ".rs": "Rust",
        ".go": "Go",
        ".cpp": "C++",
        ".c": "C",
        ".h": "C/C++ Header",
        ".sh": "Shell",
        ".php": "PHP",
        ".sql": "SQL",
        ".rb": "Ruby"
    }

    for rel_path, fn, ext, depth in selected_files:
        important_files.append(rel_path)
        if ext in tech_map:
            techs.add(tech_map[ext])

        abs_path = p / rel_path
        fn_lower = fn.lower()

        if fn == "package.json":
            config_files.append(rel_path)
            techs.add("Node.js")
            try:
                with open(abs_path, "r", encoding="utf-8", errors="ignore") as f:
                    data = json.load(f)
                    deps = list(data.get("dependencies", {}).keys())
                    dev_deps = list(data.get("devDependencies", {}).keys())
                    dependencies.extend(deps + dev_deps)
                    if "react" in deps or "react" in dev_deps:
                        techs.add("React")
            except Exception:
                pass
        elif fn == "requirements.txt":
            config_files.append(rel_path)
            techs.add("Python")
            try:
                with open(abs_path, "r", encoding="utf-8", errors="ignore") as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith('#'):
                            pkg = line.split('==')[0].split('>=')[0].split('<')[0].split('~')[0].strip()
                            if pkg:
                                dependencies.append(pkg)
            except Exception:
                pass
        elif fn == "pyproject.toml":
            config_files.append(rel_path)
            techs.add("Python")
            try:
                with open(abs_path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
                    if "poetry" in content.lower():
                        techs.add("Poetry")
            except Exception:
                pass
        elif fn == "Cargo.toml":
            config_files.append(rel_path)
            techs.add("Rust")
        elif fn == "pom.xml":
            config_files.append(rel_path)
            techs.add("Java")
            techs.add("Maven")
        elif fn in ("build.gradle", "build.gradle.kts"):
            config_files.append(rel_path)
            techs.add("Java")
            techs.add("Gradle")
        elif ext == ".csproj":
            config_files.append(rel_path)
            techs.add("C#")
            techs.add(".NET")
        elif fn in ("CMakeLists.txt", "Makefile", "makefile"):
            config_files.append(rel_path)
            techs.add("C/C++")
        elif fn in ("Dockerfile", "docker-compose.yml"):
            config_files.append(rel_path)
            techs.add("Docker")

        if fn_lower in ("main.py", "app.py", "index.js", "server.js", "main.rs", "program.cs", "app.js"):
            entry_points.append(rel_path)

        if fn_lower in (".env.example", ".env.sample", "config.example.json"):
            try:
                with open(abs_path, "r", encoding="utf-8", errors="ignore") as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith('#') and '=' in line:
                            key = line.split('=', 1)[0].strip()
                            if key and not any(s in key.lower() for s in ("secret", "key", "password", "token", "auth")):
                                config_vars.append(key)
            except Exception:
                pass

    db_keywords = {"postgresql", "postgres", "mysql", "sqlite", "mongodb", "mongoose", "redis", "mariadb", "oracle", "mssql", "sqlserver", "cassandra", "sqlalchemy", "psycopg2"}
    for dep in dependencies:
        dep_lower = dep.lower()
        for kw in db_keywords:
            if kw in dep_lower:
                db_info.append(dep)

    if any(rel_p.endswith(".sql") for rel_p in important_files):
        techs.add("SQL")
        techs.add("Database")
        db_info.append("SQL Files")

    techs_list = list(techs)
    if not techs_list:
        techs_list = ["General"]

    proj_type = "Generic/Other"
    if "React (JSX)" in techs_list or "React (TSX)" in techs_list:
        proj_type = "React Application"
    elif "Node.js" in techs_list:
        proj_type = "Node.js Project"
    elif "Python" in techs_list:
        proj_type = "Python Project"
    elif "Java" in techs_list:
        proj_type = "Java Project"
    elif "C#" in techs_list:
        proj_type = "C#/.NET Project"
    elif "Rust" in techs_list:
        proj_type = "Rust Project"
    elif "C++" in techs_list or "C" in techs_list:
        proj_type = "C/C++ Project"
    elif "Go" in techs_list:
        proj_type = "Go Project"
    elif "SQL" in techs_list:
        proj_type = "SQL/Database Project"
    elif "HTML" in techs_list or "CSS" in techs_list or "JavaScript" in techs_list:
        proj_type = "Web Project"

    return {
        "success": True,
        "name": proj_name,
        "type": proj_type,
        "technologies": techs_list,
        "directories": sorted(list(folders))[:15],
        "importantFiles": important_files,
        "configurationFiles": config_files,
        "entryPoints": entry_points,
        "dependencies": list(set(dependencies))[:30],
        "database_info": list(set(db_info)),
        "configuration_info": list(set(config_vars))[:20]
    }

def load_source_contents_for_prompt(repo_path: str, important_files: list) -> str:
    p = Path(repo_path)
    snippets = []
    count = 0
    total_chars = 0

    meta_files = {"package.json", "requirements.txt", "pyproject.toml", "cargo.toml", "pom.xml", "build.gradle", "composer.json", "go.mod", "gemfile"}

    for rel_path in important_files:
        if count >= 10:
            break
        if total_chars > 30000:
            break

        file_path = p / rel_path
        if not file_path.exists() or not file_path.is_file():
            continue

        fn = file_path.name.lower()
        if fn in meta_files or fn.endswith(".md") or fn.endswith(".txt"):
            continue

        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read(1500)
                if content.strip():
                    snippets.append(f"--- FILE: {rel_path} ---\n{content.strip()}\n")
                    count += 1
                    total_chars += len(content)
        except Exception:
            pass

    return "\n".join(snippets)

def generate_readme(repo_path: str, existing_content: str = None, model: str = "gemini-3.6-flash") -> dict:
    api_key = os.getenv("GEMINI_API_KEY", "")
    if not api_key:
        return {
            "success": False,
            "content": None,
            "error_type": "auth",
            "error": "AI Generation Failed: No valid GEMINI_API_KEY found in .env file."
        }

    analysis = analyze_repo_for_readme(repo_path)
    if not analysis.get("success"):
        return {
            "success": False,
            "content": None,
            "error_type": "unknown",
            "error": analysis.get("error", "Repository analysis failed.")
        }

    source_snippets = load_source_contents_for_prompt(repo_path, analysis.get("importantFiles", []))

    prompt = (
        f"You are an expert AI README generator. Generate/Update a professional README.md for a repository named '{analysis.get('name')}'.\n"
        f"Analyze the project type, directories, and source snippets carefully to describe actual functionality.\n"
        f"CRITICAL RULES:\n"
        f"1. Only describe features, technologies, commands, and structures that are verified to exist in the repository evidence. Do NOT invent features, database setups, installation commands, dependency names, URLs, credentials, or screenshots.\n"
        f"2. Do NOT use any template placeholders like '[Insert ...]', '[Add ...]', '[Your ...]', 'TODO', 'TBD', or 'Lorem ipsum' in the generated README.md.\n"
        f"3. Return ONLY the valid Markdown text of the README, nothing else (no wrapper markdown blocks like ```markdown)."
    )

    if existing_content and existing_content.strip():
        prompt += (
            f"\n\n--- EXISTING README.md ---\n"
            f"{existing_content}\n"
            f"---------------------------\n"
            f"\nINSTRUCTION FOR EXISTING README:\n"
            f"You are performing an UPDATE. Carefully improve/update the existing README content with new findings from the project context.\n"
            f"Preserve useful existing project-specific information, explanations, context, and details. Do NOT blindly rewrite everything or delete details that cannot be scanned (such as project overview prose or custom guides).\n"
        )
    else:
        prompt += (
            f"\n\nFormat the new README logically. Sections may include: Project Title, Description (overview), Features (actual features), Tech Stack (detected technologies), Installation (only if known), Database (only if database info exists), Configuration (only if configuration parameters exist), Directory Structure (actual directories).\n"
        )

    prompt += (
        f"\n--- PROJECT CONTEXT ---\n"
        f"Project Name: {analysis.get('name')}\n"
        f"Detected Project Type: {analysis.get('type')}\n"
        f"Technologies Used: {', '.join(analysis.get('technologies', []))}\n"
        f"Dependencies: {', '.join(analysis.get('dependencies', []))}\n"
        f"Database Info: {', '.join(analysis.get('database_info', []))}\n"
        f"Configuration Parameters: {', '.join(analysis.get('configuration_info', []))}\n"
        f"Directory Structure: {', '.join(analysis.get('directories', []))}\n"
        f"Configuration Files: {', '.join(analysis.get('configurationFiles', []))}\n"
        f"Entry Points: {', '.join(analysis.get('entryPoints', []))}\n"
        f"\n--- SOURCE CODE SNIPPETS ---\n"
        f"{source_snippets}\n"
        f"-----------------------------\n"
    )

    result = generate_text(prompt, api_key, model=model, max_tokens=2500)

    if not result.get("success"):
        error_msg = result.get("error", "Unknown error")
        
        if "authenticationerror" in error_msg.lower() or "unauthorized" in error_msg.lower():
            return {
                "success": False,
                "content": None,
                "error_type": "auth",
                "error": "GitHub authentication/session error."
            }
        elif "ratelimiterror" in error_msg.lower():
            return {
                "success": False,
                "content": None,
                "error_type": "api",
                "error": "Gemini API rate limit exceeded. Please try again later."
            }
        elif "timeouterror" in error_msg.lower() or "timeout" in error_msg.lower() or "networkerror" in error_msg.lower() or "connection" in error_msg.lower() or "dns" in error_msg.lower():
            return {
                "success": False,
                "content": None,
                "error_type": "network",
                "error": "No internet connection. Please check your connection and try again."
            }
        else:
            return {
                "success": False,
                "content": None,
                "error_type": "api",
                "error": f"Unable to generate README using AI. Detail: {error_msg}"
            }

    content = result.get("text", "")

    if not content or not content.strip():
        return {
            "success": False,
            "content": None,
            "error_type": "api",
            "error": "AI returned an invalid/empty README."
        }

    if len(content) > 15000:
        content = content[:15000]

    return {
        "success": True,
        "content": content,
        "error_type": None,
        "error": None
    }

if __name__ == "__main__":
    try:
        args = json.loads(sys.stdin.read())
        repo_path = args.get("repo_path", "")
        existing_content = args.get("existing_content", None)
        model = args.get("model", "gemini-3.6-flash")

        res = generate_readme(repo_path, existing_content, model)
        print(json.dumps(res))
    except Exception as e:
        print(json.dumps({
            "success": False,
            "content": None,
            "error_type": "unknown",
            "error": str(e)
        }))
