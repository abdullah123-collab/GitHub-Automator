# GitHub Automator — VS Code Extension + GUI

A VS Code extension to automate GitHub workflows using a **JS/TS + Python hybrid** architecture, plus a **standalone Tkinter GUI** for advanced Git automation.

## 🆕 New: Standalone GUI Application

The application now includes a powerful GUI for both GitHub and local Git management:

### **Dual-Mode Interface**
- **🌐 GitHub Manager**: Remote repository operations (create, clone, delete)
- **💻 Local Repository Manager**: Advanced local Git automation

### **Key Features (Local Mode)**
- ✅ **Commit & Push**: One-click workflow (stage → commit → push)
- ✨ **AI Generate Commits**: Auto-create professional commit messages using Claude AI
- 📝 **Preview Changes**: Review diffs before committing
- 📊 **Real-Time Status**: Monitor branch and file changes
- 🔍 **Auto-Detect Repos**: Automatically detect existing .git directories

### **Quick Start**
```bash
cd python-backend
python gui.py
```

See **QUICKSTART.md** and **FEATURES.md** for detailed usage.

---

## Original Architecture

## Architecture

```
github-automator/
├── extension/               ← VS Code Extension (JavaScript)
│   ├── src/
│   │   ├── extension.js     ← Main entry point, commands, webview
│   │   └── pythonBridge.js  ← Spawns Python scripts, handles I/O
│   └── package.json
│
└── python-backend/          ← Python Logic Layer
    ├── auth.py              ← Token validation
    ├── github_api.py        ← Reusable GitHub API class
    └── requirements.txt
```

## How the Bridge Works

1. VS Code extension receives a user action
2. `pythonBridge.js` spawns a Python script via `child_process.spawn`
3. Args are passed as JSON via **stdin**
4. Python processes and returns JSON via **stdout**
5. Extension reads the result and updates the UI

## Phase 1 Features
- GitHub Personal Access Token authentication
- Token stored securely in VS Code Secrets
- Session auto-restored on startup
- Webview panel: view profile + list repos
- Python bridge ready for all future phases

## Setup

### Extension
```bash
cd extension
npm install
# Press F5 in VS Code to launch Extension Development Host
```

### Python Backend
```bash
cd python-backend
pip install -r requirements.txt   # nothing needed for Phase 1
python3 auth.py                    # test: paste JSON via stdin
```

## Phases Roadmap
| Phase | Feature |
|-------|---------|
| ✅ 1 | Foundation, Auth, Python Bridge |
| 2 | Repo Management (create/delete/clone) |
| 3 | Auto Commit & Push |
| 4 | AI Commit Message Generator |
| 5 | AI README Generator |
| 6 | GitHub Actions / CI-CD Triggers |
| 7 | Issues & PR Automation |
| 8 | Polish & Packaging |
