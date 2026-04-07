# GitHub Automator - Complete Architecture

## 📊 System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    GitHub Automator System                      │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────┐                ┌──────────────────────┐
│   VS Code Extension  │                │   Standalone GUI     │
│    (Phase 1-2)       │                │    (Phase 3 - NEW!)  │
├──────────────────────┤                ├──────────────────────┤
│ • Token Auth         │                │ • Local Git Mgmt     │
│ • Remote Repos       │                │ • Commit & Push      │
│ • Webview UI         │                │ • AI Commits         │
│ • Python Bridge      │                │ • Preview Changes    │
└──────────────────────┘                └──────────────────────┘
        ↓                                        ↓
┌──────────────────────────────────────────────────────────────────┐
│              Python Backend Layer (gui.py)                        │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐   │
│  │  GitHub API    │  │  Git Commands  │  │  AI Integration│   │
│  │  - auth.py     │  │  - subprocess  │  │  - ai_commit.py│   │
│  │  - github_api  │  │  - git status  │  │  - Claude API  │   │
│  │  - api calls   │  │  - git diff    │  │  - formatting  │   │
│  └────────────────┘  └────────────────┘  └────────────────┘   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
        ↓                        ↓                      ↓
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  GitHub Remote   │  │  Local Git Repo  │  │  Claude AI API   │
│  • Repositories  │  │  • .git folder   │  │  • Anthropic API │
│  • Secrets       │  │  • Branches      │  │  • Message Gen   │
│  • User Profile  │  │  • Status        │  │  • Formatting    │
└──────────────────┘  └──────────────────┘  └──────────────────┘
```

---

## 🎯 Feature Flow Diagram

### Mode Selection
```
┌──────────────────────────┐
│  Start Application       │
└──────────────┬───────────┘
               │
        ┌──────┴──────┐
        ▼              ▼
    ┌──────┐      ┌──────────────┐
    │Manage│      │Local Repo    │
    │GitHub│      │Manager       │
    └──────┘      └──────────────┘
        │              │
        ▼              ▼
  [Remote Mode]  [Local Mode]
```

### Local Repository Workflow
```
┌─────────────────────────────┐
│  Open Local Repository      │
└─────────────┬───────────────┘
              │
         ┌────┴────┐
         ▼         ▼
    ┌────────┐  ┌──────────────┐
    │.git?   │  │Not a repo    │
    │YES     │  │─ Init new    │
    │   │    │  │─ Clone URL   │
    └────┴──┄┐  └──────────────┘
         │   │  (converge)
         ▼   ▼
    ┌──────────────────────────┐
    │  Load Repository Status  │
    │  - Branch               │
    │  - Files changed        │
    │  - Staged/Unstaged      │
    └──────────┬───────────────┘
               │
        ┌──────┴──────┬──────────┐
        ▼             ▼          ▼
    ┌──────────┐ ┌──────────┐ ┌──────────┐
    │ Commit & │ │ AI Gen   │ │ Preview  │
    │  Push ↑  │ │ Commits ✨│ │ Changes📝│
    └──────────┘ └──────────┘ └──────────┘
        │             │           │
        ▼             ▼           ▼
    ┌──────────────────────────────────┐
    │ User Takes Action (see below)     │
    └──────────────────────────────────┘
```

### Commit & Push Workflow
```
┌─────────────────────┐
│  Click "↑ Commit & Push"
└──────────┬──────────┘
           │
           ▼
    ┌─────────────────────────┐
    │  Enter Commit Message   │
    │  or Use Template        │
    └──────────┬──────────────┘
               │
               ▼
    ┌─────────────────────────┐
    │  git add -A            │
    │  (Stage all changes)   │
    └──────────┬──────────────┘
               │
               ▼
    ┌─────────────────────────┐
    │  git commit -m "msg"   │
    │  (Create commit)       │
    └──────────┬──────────────┘
               │
               ▼
    ┌─────────────────────────┐
    │  git push origin BRANCH │
    │  (Upload to remote)     │
    └──────────┬──────────────┘
               │
               ▼
    ┌─────────────────────────┐
    │  ✅ Success Feedback    │
    │  Refresh Status Display │
    └─────────────────────────┘
```

### AI Generation Workflow
```
┌──────────────────────────┐
│  Click "✨ AI Generate"  │
└──────────┬───────────────┘
           │
           ▼
    ┌──────────────────────┐
    │  git diff            │
    │  (Get file changes)  │
    └──────────┬───────────┘
               │
               ▼
    ┌──────────────────────┐
    │  Send to Claude API  │
    │  (Anthropic)         │
    └──────────┬───────────┘
               │
               ▼
    ┌──────────────────────┐
    │  Generate Message    │
    │  (Conventional Commit)
    └──────────┬───────────┘
               │
               ▼
    ┌──────────────────────┐
    │  Show Dialog         │
    │  (Review & Edit)     │
    └──┬──────────────┬────┘
       │              │
       ▼              ▼
    ┌──────┐     ┌──────────┐
    │ Edit │     │ Use This │
    └──────┘     └────┬─────┘
       │              │
       └──────┬───────┘
              │
              ▼
    ┌──────────────────────────┐
    │ Commit with AI Message   │
    │ (Proceed to Push Dialog) │
    └──────────────────────────┘
```

---

## 📁 File Structure

```
github-automator/
│
├── README.md                    ← Updated with new GUI info
├── QUICKSTART.md               ← Quick start guide (NEW!)
├── FEATURES.md                 ← Comprehensive features (NEW!)
├── ARCHITECTURE.md             ← This file (NEW!)
│
├── extension/                   ← VS Code Extension
│   ├── src/
│   │   ├── extension.js
│   │   ├── pythonBridge.js
│   │   └── ...
│   └── package.json
│
└── python-backend/
    ├── gui.py                  ← ENHANCED: ~1100 lines
    │                           │  + Local mode
    │                           │  + Commit & Push
    │                           │  + AI Generation
    │                           │  + Status tracking
    │                           └  + Preview changes
    ├── github_api.py           ← GitHub API wrapper
    ├── ai_commit.py            ← Claude API integration
    ├── auth.py                 ← Token validation
    ├── repo_manager.py         ← Repo operations
    ├── commit_manager.py       ← Commit handling
    ├── requirements.txt        ← Dependencies
    └── ...
```

---

## 🔄 Data Flow Diagram

### Local Repository Data Flow
```
Change File → index → Working Dir
    ↓
Status Check ← .git folder
    ↓
Display Files (Modified, Added, Deleted)
    ↓
    ├─→ Preview Diff ← git diff command
    │       ↓
    │   User Reviews
    │       ↓
    ├─→ Commit & Push
    │       ↓
    │   git add -A
    │       ↓
    │   git commit
    │       ↓
    │   git push
    │       ↓
    └─→ AI Generate
            ↓
        git diff → Claude API
            ↓
        Generate Message
            ↓
        User Reviews
            ↓
        Use → Commit & Push
```

### AI Commit Message Generation
```
Developer Makes Changes
         ↓
    git diff
         ↓
   File Diff Output
         ↓
   Claude API Request
   ├─ Model: claude-sonnet-4
   ├─ System: Commit format rules
   └─ User Prompt: Diff text
         ↓
   Claude Analyzes Changes
   ├─ Detect type (feat/fix/etc)
   ├─ Extract scope
   ├─ Generate description
   └─ Format message
         ↓
   Return: "feat(auth): add 2FA support"
         ↓
   Display in Dialog
         ↓
   User Reviews & Edits
         ↓
   Proceed to Commit
```

---

## ⚙️ Technical Stack

### Frontend
- **GUI Framework**: Tkinter (Python built-in)
- **UI Components**: Frames, Buttons, Labels, Text widgets
- **Threading**: Background operations (no UI blocking)
- **Windows**: Modal dialogs for input/output

### Backend
- **Python Version**: 3.7+
- **Git Integration**: `subprocess.run()` → git commands
- **GitHub API**: `urllib` (no external HTTP library)
- **AI Integration**: Claude API via `urllib`
- **Local Execution**: ssh-based git operations

### External APIs
- **GitHub API**: `api.github.com`
  - Authentication: Personal Access Token
  - Endpoints: `/user`, `/user/repos`, etc.

- **Claude API**: `api.anthropic.com`
  - Model: `claude-sonnet-4-20250514`
  - Rate: Unlimited (per your plan)
  - Authentication: API Key via header

### System Requirements
- **OS**: Windows, macOS, Linux
- **Git**: Command-line `git` installed
- **Python**: 3.7+
- **Environment Vars**:
  - `ANTHROPIC_API_KEY` (for AI features)

---

## 🔐 Security Architecture

```
┌─────────────────────────────────┐
│  User Provides Token/Credentials │
└────────────┬────────────────────┘
             │
    ┌────────┴────────┐
    ▼                 ▼
┌─────────────┐  ┌──────────────────┐
│GitHub Token │  │Anthropic API Key │
│  (VS Code   │  │  (Environment)   │
│  Secrets)   │  └──────────────────┘
└────────┬────┘            │
         │                 │
    ┌────┴────┐           │
    ▼         ▼           │
┌─────────────┐    │      │
│API Requests │    │      │
│with Header  │─────┤      │
└─────────────┘    │      │
    │              │      │
    ▼              │      │
 Response          │      │
 Processing        │      │
    │              │      │
    └──────────┬───┘      ▼
               │       Claude API
               │       ├─ Requests
               │       ├─ Processing
               │       └─ Response
               ▼
         Display Result
```

---

## 📊 State Management

### UI State
- Current mode (GitHub vs Local)
- Current repository path
- Loaded repositories list
- Git status info
- User profile info

### Modal States
- Create Repo Dialog
- Clone Dialog
- Commit Dialog
- AI Message Dialog
- Preview Window

### Threading
- Main UI thread (responsive)
- Background worker threads (API calls, git commands)
- Thread-safe UI updates (`root.after()`)

---

## 🎯 Future Enhancement Roadmap

```
Phase 3 (Current - ✅ Complete)
├─ Local repo detection ✅
├─ Commit & Push ✅
├─ AI commit messages ✅
├─ Preview changes ✅
└─ Status display ✅

Phase 4 (Proposed)
├─ Branch management
├─ Commit history viewer
├─ Merge/Rebase UI
├─ Pull request creation
└─ GitHub Actions integration

Phase 5 (Advanced)
├─ Collaborative features
├─ Conflict resolution UI
├─ Code review tools
├─ Performance analytics
└─ Team collaboration
```

---

## 📞 Support & Debugging

### Enable Debug Mode
```python
# In gui.py, set DEBUG = True
# Prints detailed logs to console
```

### Common Issues
| Issue | Cause | Solution |
|-------|-------|----------|
| "Git not found" | Git not installed | Install from git-scm.com |
| "AI unavailable" | Missing API key | Set ANTHROPIC_API_KEY |
| "Push failed" | Network/permission | Check git remote & branch |
| "Repository not found" | Wrong path | Verify .git exists |

---

## 🏆 Best Practices Implemented

✅ **Separation of Concerns**
- UI layer (gui.py)
- Business logic (separate functions)
- External APIs (github_api.py, ai_commit.py)

✅ **Error Handling**
- Try/except blocks
- User-friendly error messages
- Status bar feedback

✅ **Threading**
- Non-blocking UI
- Progress feedback
- Cancellation support

✅ **Security**
- Environment variables for secrets
- No hardcoded credentials
- Secure subprocess execution

✅ **User Experience**
- Beginner-friendly
- Clear visual feedback
- Comprehensive documentation
- Intuitive workflows

---

**Last Updated**: 2026-04-07  
**Status**: ✅ Production Ready  
**Version**: 2.0+
