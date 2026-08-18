import os
import sys
import json
from pathlib import Path

def analyze_project(repo_path: str) -> dict:
    if not os.path.isdir(repo_path):
        return {"success": False, "error": f"Not a directory: {repo_path}"}
        
    p = Path(repo_path)
    proj_name = p.name
    
    # List top level folders & files
    try:
        items = os.listdir(repo_path)
    except Exception as e:
        return {"success": False, "error": f"Failed to list directory: {str(e)}"}
        
    folders = [f for f in items if os.path.isdir(p / f) and not f.startswith('.')]
    files = [f for f in items if os.path.isfile(p / f)]
    
    # Project Type & Tech Detection
    proj_type = "Generic/Other"
    tech = []
    config_files = []
    
    # Check for signatures
    # 1. Node / React
    if "package.json" in files:
        config_files.append("package.json")
        tech.append("Node.js")
        try:
            with open(p / "package.json", "r", encoding="utf-8") as f:
                data = json.load(f)
                deps = data.get("dependencies", {})
                dev_deps = data.get("devDependencies", {})
                if "react" in deps or "react" in dev_deps:
                    proj_type = "React Application"
                    tech.append("React")
                else:
                    proj_type = "Node.js Project"
                
                # Extract more technologies/libraries
                for key in ["express", "typescript", "vue", "angular", "next", "gatsby"]:
                    if key in deps or key in dev_deps:
                        tech.append(key.capitalize())
        except Exception:
            proj_type = "Node.js Project"

    # 2. Python
    elif "requirements.txt" in files or "pyproject.toml" in files or "setup.py" in files or "Pipfile" in files:
        proj_type = "Python Project"
        tech.append("Python")
        if "requirements.txt" in files: config_files.append("requirements.txt")
        if "pyproject.toml" in files: config_files.append("pyproject.toml")
        if "setup.py" in files: config_files.append("setup.py")
        
        # Analyze pyproject.toml
        if "pyproject.toml" in files:
            try:
                with open(p / "pyproject.toml", "r", encoding="utf-8") as f:
                    content = f.read()
                    if "poetry" in content.lower():
                        tech.append("Poetry")
                    if "django" in content.lower():
                        tech.append("Django")
                    elif "flask" in content.lower():
                        tech.append("Flask")
                    elif "fastapi" in content.lower():
                        tech.append("FastAPI")
            except Exception:
                pass
        
        # Analyze requirements.txt
        if "requirements.txt" in files:
            try:
                with open(p / "requirements.txt", "r", encoding="utf-8") as f:
                    content = f.read().lower()
                    if "django" in content: tech.append("Django")
                    elif "flask" in content: tech.append("Flask")
                    elif "fastapi" in content: tech.append("FastAPI")
            except Exception:
                pass

    # 3. Java Maven/Gradle
    elif "pom.xml" in files:
        proj_type = "Java Project (Maven)"
        tech.extend(["Java", "Maven"])
        config_files.append("pom.xml")
    elif "build.gradle" in files or "build.gradle.kts" in files:
        proj_type = "Java Project (Gradle)"
        tech.extend(["Java", "Gradle"])
        config_files.append("build.gradle" if "build.gradle" in files else "build.gradle.kts")

    # 4. .NET / C#
    elif any(f.endswith(".sln") for f in files) or any(f.endswith(".csproj") for f in files):
        proj_type = "C#/.NET Project"
        tech.extend(["C#", ".NET"])
        sln_files = [f for f in files if f.endswith(".sln")]
        csproj_files = [f for f in files if f.endswith(".csproj")]
        config_files.extend(sln_files + csproj_files)

    # 5. Rust
    elif "Cargo.toml" in files:
        proj_type = "Rust Project"
        tech.append("Rust")
        config_files.append("Cargo.toml")

    # 6. C/C++
    elif "CMakeLists.txt" in files or "Makefile" in files:
        proj_type = "C/C++ Project"
        tech.append("C/C++")
        config_files.append("CMakeLists.txt" if "CMakeLists.txt" in files else "Makefile")

    # 7. Docker
    elif "Dockerfile" in files or "docker-compose.yml" in files:
        proj_type = "Docker Project"
        tech.append("Docker")
        config_files.append("Dockerfile" if "Dockerfile" in files else "docker-compose.yml")

    # 8. SQL/Database Project (check for .sql files recursively or in root)
    else:
        sql_files_root = [f for f in files if f.endswith(".sql")]
        if sql_files_root:
            proj_type = "SQL/Database Project"
            tech.extend(["SQL", "Database"])
        else:
            # Let's do a quick recursive search (depth=2) for sql files or other patterns
            sql_found = False
            for root, dirs, fnames in os.walk(repo_path):
                depth = len(Path(root).relative_to(repo_path).parts)
                if depth > 2:
                    continue
                dirs[:] = [d for d in dirs if not d.startswith('.')]
                for fn in fnames:
                    if fn.endswith(".sql"):
                        sql_found = True
                        break
                if sql_found:
                    break
            if sql_found:
                proj_type = "SQL/Database Project"
                tech.extend(["SQL", "Database"])

    # Collect important source files for context
    important_files = []
    # Add files from folders (e.g. src, lib, app, database)
    src_dirs = [d for d in folders if d.lower() in ("src", "lib", "app", "database", "db", "components", "routes")]
    
    for sd in src_dirs:
        for root, dirs, fnames in os.walk(p / sd):
            dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ("node_modules", "venv", "__pycache__")]
            for fn in fnames:
                if len(important_files) >= 15:
                    break
                ext = Path(fn).suffix.lower()
                if ext in (".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".cs", ".rs", ".cpp", ".c", ".h", ".sql", ".json", ".yml", ".yaml", ".toml"):
                    rel_path = os.path.relpath(Path(root) / fn, repo_path)
                    important_files.append(rel_path.replace("\\", "/"))
            if len(important_files) >= 15:
                break
                
    # If no important files from src dirs, just add top level source files
    if not important_files:
        for fn in files:
            ext = Path(fn).suffix.lower()
            if ext in (".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".cs", ".rs", ".cpp", ".c", ".h", ".sql"):
                important_files.append(fn)
                if len(important_files) >= 10:
                    break
                    
    # Documentation files
    existing_docs = []
    for fn in files:
        if fn.lower() in ("readme.md", "readme.txt", "readme", "changelog.md", "contributing.md", "license", "license.md", "license.txt"):
            existing_docs.append(fn)

    return {
        "success": True,
        "name": proj_name,
        "type": proj_type,
        "technologies": list(set(tech)) if tech else ["General"],
        "directories": folders[:10],
        "importantFiles": important_files[:15],
        "configurationFiles": config_files,
        "existingDocumentation": existing_docs,
        "entryPoints": [f for f in files if f.lower() in ("main.py", "app.py", "index.js", "server.js", "main.rs", "program.cs")]
    }

if __name__ == "__main__":
    args = json.loads(sys.stdin.read())
    repo_path = args.get("repo_path", "")
    result = analyze_project(repo_path)
    print(json.dumps(result))
