# 🚀 GitHub Automator - Quick Start Guide

## What's New? ✨

Your GitHub Automator has been completely redesigned with professional Git automation features:

### 🎯 Two Main Workflows

#### 1️⃣ GitHub Remote Manager
```
Manage repositories on GitHub account
├─ Create new repositories
├─ Clone to local
└─ Delete remote repos
```

#### 2️⃣ Local Repository Manager
```
Automate git workflows on your computer
├─ Commit & Push (↑) - Stage, commit, push in one click
├─ AI Generate (✨) - Auto-create professional commit messages
├─ Preview Changes (📝) - See diffs before committing
└─ Git Status (📊) - Real-time branch and file tracking
```

---

## 📋 Setup (2 minutes)

### 1. For AI Features (Optional but Recommended)
```bash
# Get API key from: https://console.anthropic.com/

# Windows PowerShell:
set ANTHROPIC_API_KEY=sk-ant-your-key-here

# macOS/Linux:
export ANTHROPIC_API_KEY=sk-ant-your-key-here
```

### 2. Ensure Git is Installed
```bash
git --version
```
If not found, download from https://git-scm.com/

### 3. Run the Application
```bash
# From python-backend folder:
python gui.py
```

---

## ⚡ 5-Minute Usage Tutorial

### Scenario: You just made code changes and want to push them

**Old Way** (5 steps):
```
1. Open terminal
2. git add .
3. git commit -m "Fix bug"
4. git push origin main
5. Wait and check for errors
```

**New Way** (2 steps):
```
1. Click "↑ Commit & Push" button in GUI
2. Done! Status bar shows success
```

---

## 🎮 Button Guide

### Main Screen
| Button | Action | What it Does |
|--------|--------|--------------|
| 🌐 Open GitHub Manager | Switch to GitHub mode | Manage remote repos |
| 💻 Open Local Repository | Switch to local mode | Pick a folder to work with |

### Local Repository Screen
| Button | Action | Result |
|--------|--------|--------|
| ↑ Commit & Push | Stage + commit + push | One-click deployment |
| ✨ AI Generate | AI analyzes changes | Creates pro commit message |
| 📝 Preview Changes | Shows git diff | Review before committing |
| 📊 Refresh Status | Updates file list | See latest changes |
| ← Back | Return to menu | Switch modes |

---

## 🎨 What Each Screen Shows

### Starting Screen
```
┌─────────────────────────────────┐
│  ⚡ GitHub Automator            │
│  What would you like to do?    │
├─────────────────────────────────┤
│ 🌐 Manage GitHub Repositories   │
│ (Create, clone, delete remote)  │
├─────────────────────────────────┤
│ 💻 Work with Local Repository   │
│ (Commit, push, track changes)   │
└─────────────────────────────────┘
```

### Local Repository Screen
```
┌─────────────────────────────────────────┐
│ 💻 Local Repository        ← Back       │
│ Branch: main | Staged: 2 | Changes: 5  │
├─────────────────────────────────────────┤
│ [↑ Commit & Push] [✨ AI Generate]     │
│ [📝 Preview] [📊 Refresh]              │
├─────────────────────────────────────────┤
│ Changed Files:                          │
│ 📝 src/main.py (modified)              │
│ ✚ tests/test.py (added)                │
│ ✖ old_file.txt (deleted)               │
├─────────────────────────────────────────┤
│ ✅ Ready                                │
└─────────────────────────────────────────┘
```

---

## 🌟 Feature Highlights

### ↑ Commit & Push
**Before**: Manual git commands
```bash
git add .
git commit -m "Fix login bug"
git push origin main
```

**After**: Click once
```
1. Click "↑ Commit & Push"
2. Type message
3. Click confirm
✅ Done!
```

### ✨ AI Generate
**Example**: You modified a file

**What AI creates**:
```
feat(auth): add two-factor authentication

- Add TOTP token support
- Update login flow
- Store encrypted keys
```

You can edit it, then push with one click!

### 📝 Preview Changes
See exactly what changed:
```
@@ -45,3 +45,5 @@
 def login():
-  password = input()
+  display_login_dialog()
+  password = mask_input()
```

### 📊 Real-Time Status
Always know:
- Current branch
- How many files changed
- What type of changes (added/modified/deleted)

---

## 🆘 Common Issues & Solutions

### "Git is not installed"
→ Download from https://git-scm.com/

### "AI Feature Unavailable"
→ Set `ANTHROPIC_API_KEY` environment variable (see Setup section)

### "Push Failed"
→ Check: Git remote URL, internet connection, branch exists

### "Not a Git Repository"
→ Choose to initialize new repo or clone from URL

---

## 💡 Pro Tips

✅ **Always preview** changes before committing  
✅ **Use AI** for better commit messages  
✅ **Commit often** (small commits are better)  
✅ **Push daily** to backup your work  
✅ **Use meaningful** branch names  

---

## 🎯 Workflow Examples

### Example 1: Quick Commit
```
1. Make code changes
2. Click "↑ Commit & Push"
3. Enter message (or click ✨ AI Generate)
4. Click confirm
✅ Changes pushed!
```

### Example 2: Review Before Commit
```
1. Make changes
2. Click "📝 Preview Changes"
3. Review the diff
4. If good, click "↑ Commit & Push"
✅ Confident commit!
```

### Example 3: AI-Assisted Workflow
```
1. Make changes
2. Click "✨ AI Generate"
3. AI suggests: "docs: update README"
4. Click "✓ Use This"
5. Specify branch and confirm
✅ Professional commit message!
```

---

## 📚 Learn More

See **FEATURES.md** for:
- Detailed feature documentation
- Advanced usage
- Troubleshooting guide
- Best practices
- Security notes

---

## 🔄 Keyboard Shortcuts

| Action | Key |
|--------|-----|
| Focus text input | Auto-focused |
| Submit dialog | Click button |
| Cancel dialog | Click cancel or close |

---

## ✅ Ready to Start?

1. ✅ Installed Git? (`git --version`)
2. ✅ Set ANTHROPIC_API_KEY? (optional but recommended)
3. ✅ Run `python gui.py`
4. ✅ Choose your workflow!

**Happy automating! 🚀**

---

**Questions?** Check FEATURES.md or see the status bar for error details.
