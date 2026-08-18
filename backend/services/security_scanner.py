import os
import sys
import json
import re
from pathlib import Path

# High confidence patterns
PATTERNS = {
    "Private Key Block": re.compile(r"-----BEGIN [A-Z ]+ PRIVATE KEY-----"),
    "Google API Key": re.compile(r"AIzaSy[A-Za-z0-9-_]{33}"),
    "GitHub Classic PAT": re.compile(r"\bghp_[A-Za-z0-9_]{36}\b"),
    "GitHub Fine-grained PAT": re.compile(r"\bgithub_pat_[A-Za-z0-9_]{82}\b"),
    "AWS Access Key ID": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "Slack Webhook URL": re.compile(r"https://hooks\.slack\.com/services/T[a-zA-Z0-9_]+/B[a-zA-Z0-9_]+/[a-zA-Z0-9_]+")
}

# Suspicious file patterns
SUSPICIOUS_EXTENSIONS = {".pem", ".key", ".pfx", ".bak", ".mdf", ".ldf", ".db", ".sqlite"}
SUSPICIOUS_FILENAMES = {"credentials.json", "secrets.json", "auth.json", "key.json", "keys.json", "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"}

def scan_project(repo_path: str) -> dict:
    if not os.path.isdir(repo_path):
        return {"success": False, "error": f"Not a directory: {repo_path}"}
        
    p = Path(repo_path)
    suspicious_files = []
    found_secrets = []
    
    ignored_dirs = {".git", "node_modules", ".venv", "venv", "env", "dist", "build", "__pycache__", ".vscode", ".idea", "bin", "obj"}
    
    for root, dirs, fnames in os.walk(repo_path):
        dirs[:] = [d for d in dirs if d not in ignored_dirs and not d.startswith('.')]
        
        for fn in fnames:
            rel_path = os.path.relpath(Path(root) / fn, repo_path).replace("\\", "/")
            fn_lower = fn.lower()
            
            is_suspicious_file = False
            reason = ""
            
            if fn_lower == ".env" or fn_lower.startswith(".env."):
                is_suspicious_file = True
                reason = "Environment configuration file containing potential secrets"
            elif fn_lower in SUSPICIOUS_FILENAMES:
                is_suspicious_file = True
                reason = f"Common credential file name: {fn}"
            elif Path(fn).suffix.lower() in SUSPICIOUS_EXTENSIONS:
                is_suspicious_file = True
                reason = f"Sensitive file extension: {Path(fn).suffix}"
                
            if is_suspicious_file:
                suspicious_files.append({"file": rel_path, "reason": reason})
                
            file_path = Path(root) / fn
            try:
                size = os.path.getsize(file_path)
                if size > 1024 * 1024:
                    continue
                    
                with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                    for line_no, line in enumerate(f, 1):
                        if len(line) > 1000:
                            continue
                            
                        for name, regex in PATTERNS.items():
                            matches = regex.findall(line)
                            for match in matches:
                                masked = match[:6] + "..." + match[-4:] if len(match) > 10 else "..."
                                found_secrets.append({
                                    "file": rel_path,
                                    "type": name,
                                    "line": line_no,
                                    "match": f"... {masked} ..."
                                })
            except Exception:
                pass
                
    return {
        "success": True,
        "suspicious_files": suspicious_files,
        "found_secrets": found_secrets,
        "clean": len(suspicious_files) == 0 and len(found_secrets) == 0
    }

if __name__ == "__main__":
    args = json.loads(sys.stdin.read())
    repo_path = args.get("repo_path", "")
    result = scan_project(repo_path)
    print(json.dumps(result))
