import os
import sys
import json
from pathlib import Path

def analyze_project(repo_path: str) -> dict:
    if not os.path.isdir(repo_path):
        return {"success": False, "error": f"Not a directory: {repo_path}"}
        
    p = Path(repo_path)
    proj_name = p.name
    
    ignore_dirs = {".git", "node_modules", "venv", ".venv", "__pycache__", "dist", "build", "coverage", ".idea", ".vscode"}
    sensitive_names = {".env", "credentials.json", "secrets.json"}
    sensitive_exts = {".pem", ".key", ".token"}
    binary_exts = {
        ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".zip", ".tar", ".gz", 
        ".pdf", ".exe", ".bin", ".dll", ".so", ".dylib", ".woff", ".woff2", 
        ".eot", ".ttf", ".mp3", ".mp4", ".wav", ".db", ".sqlite"
    }

    all_files = []
    folders = set()

    for root, dirs, fnames in os.walk(repo_path):
        # Prune ignored directories in-place
        dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ignore_dirs]
        
        # Calculate depth
        rel_root = os.path.relpath(root, repo_path)
        if rel_root == ".":
            depth = 0
        else:
            depth = len(Path(rel_root).parts)
            
        if depth > 5:
            # Do not traverse deeper
            dirs[:] = []
            continue
            
        for d in dirs:
            if rel_root == ".":
                folders.add(d)
            else:
                folders.add(f"{rel_root}/{d}".replace("\\", "/"))

        for fn in fnames:
            if fn.startswith('.'):
                continue
            
            # Check sensitivity
            if fn.lower() in sensitive_names or any(s in fn.lower() for s in ("secret", "credential", "password", "token")):
                continue
            
            ext = Path(fn).suffix.lower()
            if ext in sensitive_exts or ext in binary_exts:
                continue
                
            rel_file_path = os.path.relpath(os.path.join(root, fn), repo_path).replace("\\", "/")
            if any(part in ignore_dirs for part in Path(rel_file_path).parts):
                continue
                
            all_files.append((rel_file_path, fn, ext, depth))

    def get_priority_score(rel_path, fn, ext):
        fn_lower = fn.lower()
        # High priority configs & docs
        if fn in ("package.json", "requirements.txt", "pyproject.toml", "pom.xml", "build.gradle", "Cargo.toml", "CMakeLists.txt", "makefile", "Makefile", "Dockerfile", "docker-compose.yml") or fn_lower in ("readme.md", "readme.txt", "readme", "contributing.md"):
            return 10
        # Database schema
        if ext == ".sql" or fn == "schema.prisma":
            return 8
        # Common entry points
        if fn_lower in ("main.py", "app.py", "index.js", "server.js", "main.rs", "program.cs", "index.html", "app.js"):
            return 7
        # Subdirectories for source code
        parts = rel_path.lower().split('/')
        if any(p in parts for p in ("src", "app", "lib", "components", "routes")):
            if ext in (".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".cs", ".rs", ".go", ".cpp", ".c", ".h", ".sh", ".php", ".rb", ".html", ".css", ".yml", ".yaml", ".json", ".toml"):
                return 6
        # General source/configs
        if ext in (".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".cs", ".rs", ".go", ".cpp", ".c", ".h", ".sh", ".php", ".rb", ".html", ".css", ".yml", ".yaml", ".json", ".toml"):
            return 4
        return 1

    # Sort files
    sorted_files = sorted(all_files, key=lambda x: get_priority_score(x[0], x[1], x[2]), reverse=True)
    selected_files = sorted_files[:50]

    techs = set()
    dependencies = []
    db_info = []
    config_vars = []
    config_files = []
    entry_points = []
    existing_docs = []
    important_files = []

    # Map extensions to technologies
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
        ".rb": "Ruby",
        ".kt": "Kotlin",
        ".swift": "Swift"
    }

    for rel_path, fn, ext, depth in selected_files:
        important_files.append(rel_path)
        
        # Tech from extension
        if ext in tech_map:
            techs.add(tech_map[ext])
            
        # Analyze config / package files
        abs_path = p / rel_path
        
        # Check size of file to be safe
        try:
            size = os.path.getsize(abs_path)
        except Exception:
            size = 0
            
        if size > 100 * 1024: # Skip if larger than 100KB to avoid reading large files
            continue
            
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
            
        # Entry points
        if fn_lower in ("main.py", "app.py", "index.js", "server.js", "main.rs", "program.cs", "app.js"):
            entry_points.append(rel_path)
            
        # Existing documentation
        if fn_lower in ("readme.md", "readme.txt", "readme", "changelog.md", "contributing.md", "license", "license.md"):
            existing_docs.append(rel_path)

        # Config templates (like .env.example) to gather env var parameters safely
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

    # Database info from dependencies/sql files
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

    # Determine Project Type
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
        "existingDocumentation": existing_docs,
        "entryPoints": entry_points,
        "dependencies": list(set(dependencies))[:30],
        "database_info": list(set(db_info)),
        "configuration_info": list(set(config_vars))[:20]
    }

if __name__ == "__main__":
    args = json.loads(sys.stdin.read())
    repo_path = args.get("repo_path", "")
    result = analyze_project(repo_path)
    print(json.dumps(result))
