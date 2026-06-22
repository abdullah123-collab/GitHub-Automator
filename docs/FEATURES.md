# 🚀 GitHub Automator - Enhanced Features

## Overview
The GitHub Automator has been redesigned with a dual-mode interface for managing both remote GitHub repositories and local Git repositories with advanced automation features.

---

## 🎯 Main Features

### **Dual-Mode Interface**
When you launch the application, you have two choices:

1. **🌐 GitHub Remote Manager**
   - Manage repositories on your GitHub account
   - Create, clone, and delete remote repositories
   - User-friendly repository browser

2. **💻 Local Repository Manager**
   - Work with local Git repositories
   - Commit, push, and track changes locally
   - Advanced Git automation tools

---

## **💻 Local Repository Features**

### **1. Local Repository Detection & Opening**
- **Browse & Open**: Select any folder on your computer
- **Auto-Detection**: The app automatically detects if a folder contains a `.git` directory
- **Smart Options**:
  - If it's already a Git repo: Load it directly
  - If not: Choose to initialize a new repo or clone from a remote URL

### **2. Commit & Push Button (↑)**
> **One-Click Workflow**: Stage, commit, and push all in one action

- **Stage All Changes**: Automatically stages all modified files
- **Custom Commit Message**: Write a meaningful message
- **Target Branch**: Specify which branch to push to (defaults to `main`)
- **Automatic Push**: Pushes to remote after committing
- **Success Feedback**: Clear confirmation and status updates

**Usage Flow**:
1. Click **"↑ Commit & Push"** button
2. Enter your commit message
3. Specify target branch (optional)
4. Click **"✓ Commit & Push"** to execute

### **3. AI-Generated Commit Messages (✨)**
> **Powered by Claude API**: Automatically generate professional commit messages based on your code changes

- **Analyze Diff**: Reads your file changes (git diff)
- **Generate Message**: Uses Claude AI to create a conventional commit message
- **Convention Format**: Follows industry-standard Git commit conventions
  - Format: `<type>(<scope>): <description>`
  - Types: feat, fix, refactor, docs, style, test, chore
- **Review & Edit**: Shows the generated message for your review
- **One-Click Apply**: Use the AI message directly or edit it first

**Setup Required**:
```bash
# Set your Anthropic API key (Windows)
set ANTHROPIC_API_KEY=sk-ant-xxxxx

# Or on macOS/Linux:
export ANTHROPIC_API_KEY=sk-ant-xxxxx
```

**Usage Flow**:
1. Click **"✨ AI Generate"** button
2. AI analyzes your changes
3. Review the suggested message
4. Click **"✓ Use This"** to proceed with commit & push
5. Specify target branch and confirm

### **4. Preview Changes (📝)**
> **Before You Commit**: See exactly what you're about to commit

- **Full Diff View**: Shows complete git diff in a dedicated window
- **Color-Coded**: Syntax highlighting for readability
- **Line-by-Line Review**: Examine every change before committing
- **Easy Reference**: Scrollable window for large changesets

**Usage Flow**:
1. Click **"📝 Preview Changes"** button
2. Review the git diff in the popup window
3. Close the window when done

### **5. Real-Time Git Status**
> **Always Know What's Changed**: Live monitoring of your repository state

**Displays**:
- **Current Branch**: Shows the active branch
- **File Changes Summary**:
  - 📝 Modified files (orange)
  - ✚ Added files (green)
  - ✖ Deleted files (red)
  - → Renamed files (blue)
- **Change Counts**: Total staged/unstaged changes

**Status Updates**:
- Click **"📊 Refresh Status"** to manually update
- Status refreshes automatically after commits/pushes

---

## **🌐 GitHub Remote Manager Features**

### **1. Create Repository**
- Create new repositories on GitHub
- Configure repository settings:
  - Name and description
  - Public/Private
  - Initialize with README
  - Add .gitignore
  - Enable Wiki and Issues
  - Add topics/tags

### **2. Clone Repository**
- Clone repositories from your GitHub account
- Select destination folder
- Automatic authentication using your token

### **3. List & Browse Repositories**
- View all your repositories with:
  - Repository name and description
  - Privacy status (Public/Private)
  - Programming language
  - Repository metadata
- Sort by most recently updated

### **4. Delete Repository**
- Remove repositories from GitHub
- Confirmation dialog to prevent accidents
- Permanent deletion warning

---

## **📊 Status Bar & Feedback**

The status bar at the bottom shows:
- Current operation status
- Success confirmations (✅)
- Error messages (❌)
- Progress updates

Examples:
- "✅ Committed and pushed to 'main'!"
- "Loading repositories..."
- "Cloning..."

---

## **🎨 User Interface**

### **Design Principles**
- **Dark Theme**: Easy on the eyes for extended use
- **Clear Icons**: Visual indicators for different operations
- **Color Coding**: Green for success, red for danger, blue for info
- **Responsive Layout**: Proper spacing and alignment
- **Beginner-Friendly**: Clear labels and guidance

### **Navigation**
- **Back Button**: Navigate between local and GitHub modes
- **Status Indicators**: Real-time feedback on all operations
- **Scrollable Lists**: Handle large numbers of files/repos
- **Modal Dialogs**: Focused interaction for specific tasks

---

## **🔧 Technical Setup**

### **Requirements**
- Python 3.7+
- Git (installed and in system PATH)
- GitHub Personal Access Token (for GitHub features)
- Anthropic API Key (for AI features - optional)

### **Installation**
```bash
# Install dependencies
pip install -r requirements.txt

# Set environment variables
set ANTHROPIC_API_KEY=sk-ant-xxxxx  # Windows
export ANTHROPIC_API_KEY=sk-ant-xxxxx  # macOS/Linux
```

### **Running the Application**
```bash
# Launch the GUI
python gui.py

# Or provide token via stdin:
echo {"token": "ghp_xxxxx"} | python gui.py
```

---

## **⚡ Workflow Examples**

### **Example 1: Quick Commit & Push**
```
1. Browse to local repo
2. Click "↑ Commit & Push"
3. Write message
4. Confirm
✅ Done in seconds!
```

### **Example 2: AI-Assisted Commit**
```
1. Make code changes
2. Click "✨ AI Generate"
3. Review suggested message
4. Click "✓ Use This"
5. Confirm branch and push
✅ Professional commit message generated automatically!
```

### **Example 3: Review Before Commit**
```
1. Click "📝 Preview Changes"
2. Review all changes
3. If satisfied, click "↑ Commit & Push"
4. Complete the commit
✅ Confident commits!
```

### **Example 4: Create Remote Repository**
```
1. Choose "Manage GitHub Repositories"
2. Click "Create Repo"
3. Fill in details (name, description, options)
4. Click "✓ Create"
✅ Repository created on GitHub!
```

---

## **🆘 Troubleshooting**

### **"Git is not installed or not in PATH"**
- Install Git from https://git-scm.com/
- Restart your terminal after installation

### **"AI Feature Unavailable"**
- Set ANTHROPIC_API_KEY environment variable
- Get a key from https://console.anthropic.com/

### **"Push Failed"**
- Check your internet connection
- Verify remote URL is correct
- Check that you have push permissions
- Try manually: `git push origin main`

### **"Not a Git Repository"**
- The folder doesn't contain `.git` directory
- Choose to initialize new repo or clone from URL

---

## **📚 Tips & Best Practices**

1. **Always Preview**: Click "📝 Preview Changes" before committing
2. **Use Meaningful Messages**: Clear messages help track project history
3. **Commit Often**: Frequent small commits are better than large ones
4. **Push Regularly**: Don't let changes pile up locally
5. **Use AI Wisely**: Review AI-generated messages for accuracy
6. **Branch Strategy**: Use meaningful branch names

---

## **🎓 Keyboard Shortcuts**

| Action | Shortcut |
|--------|----------|
| Commit & Push | _Button Click_ |
| AI Generate | _Button Click_ |
| Preview Changes | _Button Click_ |
| Refresh Status | _Button Click_ |
| Back to Menu | _Back Button_ |

---

## **📝 Environment Variables**

```bash
# Anthropic API Key (for AI features)
ANTHROPIC_API_KEY=sk-ant-xxxxx

# GitHub Token (passed via stdin)
# {"token": "ghp_xxxxx"}
```

---

## **🔐 Security Notes**

- Never hardcode tokens in scripts
- Use environment variables for sensitive data
- Keep your API keys private
- Use GitHub personal access tokens with minimal scope

---

## **📞 Support & Feedback**

For issues or feature requests:
1. Check this documentation
2. Review troubleshooting section
3. Check terminal/console for error messages
4. Ensure all prerequisites are installed

---

**Version**: 2.0+  
**Last Updated**: 2026-04-07  
**Status**: ✅ Production Ready
