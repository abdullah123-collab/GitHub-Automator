# GitHub Automator

> An AI-powered VS Code extension for managing GitHub repositories and automating Git workflows directly from VS Code.

GitHub Automator brings repository management, Git operations, branch workflows, and AI-assisted development into a single VS Code extension.

Instead of switching between VS Code, Git commands, GitHub, and AI tools, developers can manage their repositories and generate useful Git content directly from the extension.

---

## 🚀 Features

### 🔐 GitHub Authentication

* GitHub authentication and account integration
* Secure token handling
* Access and manage repositories from within VS Code

### 📁 Repository Management

* View GitHub repositories
* Clone repositories locally
* Detect and manage local repositories
* Switch between repositories
* Refresh repository information
* Repository creation and management workflows
* Local repository support without requiring cloud-based development

### 🌿 Branch Management

* Display the currently active branch
* View available local branches
* Switch between local branches
* Create new branches
* Show the current branch directly in the extension UI

### 💾 Git Automation

* Stage and commit changes
* Push changes to remote repositories
* Pull updates when required
* Automated commit workflows
* Push-rejection handling
* Merge-conflict detection
* Abort/handle conflicting Git operations

### 🤖 AI-Powered Git Workflows

GitHub Automator integrates Google Gemini to assist with Git-related development tasks.

#### AI Commit Messages

Generate contextual commit messages based on the changes in your repository.

#### AI Descriptions

Generate repository/project descriptions using AI instead of manually writing repetitive descriptions.

#### AI README Generation

Generate README content for repositories using AI-assisted project analysis.

The AI integration is designed around a backend gateway so AI providers can be managed without tightly coupling the extension UI to a specific provider.

### 🎨 VS Code Interface

* Integrated sidebar interface
* Repository-focused workflow
* Branch information in the UI
* Repository sorting
* Improved repository cards and controls
* Commit and push actions
* AI actions directly from the extension
* Improved error handling and user notifications

---

## 🏗️ Architecture

GitHub Automator uses a hybrid **JavaScript + Python** architecture.

```text
┌──────────────────────────────┐
│        VS Code Extension     │
│                              │
│ JavaScript / VS Code API     │
│ Webview UI                   │
│ GitHub workflow controls     │
└──────────────┬───────────────┘
               │
               │ Process / IPC
               ▼
┌──────────────────────────────┐
│       Python Backend         │
│                              │
│ Git operations               │
│ Repository management        │
│ AI services                  │
│ Local repository workflows   │
└──────────────┬───────────────┘
               │
        ┌──────┴───────┐
        ▼              ▼
   Git / GitHub     Google Gemini
```

### Main Components

```text
github-automator/
│
├── extension/
│   └── src/
│       ├── extension.js
│       └── pythonBridge.js
│
├── backend/
│   ├── services/
│   │   ├── ai_gateway.py
│   │   ├── ai_commit.py
│   │   └── ai_description.py
│   │
│   └── ...
│
├── docs/
├── tests/
└── README.md
```

The VS Code extension is responsible for the user interface and VS Code integration, while the Python backend handles Git operations, repository workflows, and AI-related services.

---

## 🧠 AI Architecture

AI functionality is routed through a dedicated AI gateway instead of placing provider-specific logic throughout the application.

```text
VS Code Extension
       │
       ▼
Python Backend
       │
       ▼
   AI Gateway
       │
       ▼
 Google Gemini
```

This separation makes the AI integration easier to maintain and extend.

Current AI-powered workflows include:

* Commit message generation
* Repository description generation
* README generation

---

## 🛠️ Tech Stack

### Extension

* JavaScript
* VS Code Extension API
* VS Code Webview
* Node.js

### Backend

* Python
* Git
* GitHub API

### AI

* Google Gemini API

### Development Tools

* Git
* GitHub
* npm
* VS Code
* PyInstaller

---

## ⚙️ Installation

### Prerequisites

Make sure you have:

* VS Code
* Node.js
* Python
* Git
* A GitHub account
* Google Gemini API access for AI features

### 1. Clone the repository

```bash
git clone https://github.com/abdullah123-collab/GitHub-Automator.git
cd GitHub-Automator
```

### 2. Install extension dependencies

```bash
cd extension
npm install
```

### 3. Install Python dependencies

From the project/backend environment, install the required Python packages:

```bash
pip install -r backend/requirements.txt
```

### 4. Configure Gemini

Configure the Gemini API key through the environment configuration expected by the backend.

Do not commit API keys or other secrets to Git.

### 5. Run the extension

Open the project in VS Code and start the extension in development mode using the VS Code extension debugger.

```text
Run → Start Debugging
```

or press:

```text
F5
```

---

## 🖥️ Development

The extension consists of three major areas:

### Extension Layer

Handles:

* VS Code activation
* Commands
* UI
* Repository interactions
* Communication with the Python backend

### Python Bridge

The Python bridge manages communication between the VS Code extension and the Python backend.

It supports the persistent Python process used by the extension.

### Backend

The backend handles:

* Git commands
* Local repository operations
* Repository management
* AI services
* GitHub-related workflows

---

## 🔄 Git Workflow

A typical automated workflow looks like this:

```text
Developer makes changes
          │
          ▼
GitHub Automator detects repository
          │
          ▼
Review changes
          │
          ▼
Generate AI commit message
          │
          ▼
Commit changes
          │
          ▼
Push to remote
          │
          ├── Success ───────► Done
          │
          ▼
Push rejected
          │
          ▼
Pull / conflict detection
          │
          ▼
Guide or abort conflicting operation
```

---

## 🌿 Branch Workflow

GitHub Automator also provides local branch management directly inside the extension.

```text
Current Branch
      │
      ├── View branches
      │
      ├── Switch branch
      │
      └── Create branch
```

The active branch is displayed in the extension interface so the developer can see the current Git context while working.

---

## 🧩 Project Structure

```text
GitHub-Automator/
│
├── backend/
│   ├── services/
│   │   ├── ai_gateway.py
│   │   ├── ai_commit.py
│   │   ├── ai_description.py
│   │   └── ...
│   │
│   └── ...
│
├── extension/
│   ├── src/
│   │   ├── extension.js
│   │   ├── pythonBridge.js
│   │   └── ...
│   │
│   ├── package.json
│   └── ...
│
├── docs/
├── tests/
├── scripts/
└── README.md
```

---

## 🪟 Windows Process Handling

GitHub Automator communicates with Python and Git processes from the VS Code extension.

On Windows, the project uses hidden process execution for background subprocesses so Git and Python operations do not unnecessarily open visible console windows.

The Python daemon communicates with the extension through standard input/output, while Windows-specific process configuration is handled by the process-spawning layer.

This allows background Git operations to run without interrupting the developer's VS Code workflow.

---

## 🧪 Testing

The project includes tests for backend and AI-related functionality.

Example:

```bash
python test_daemon.py
python test_gemini.py
```

The extension can also be tested through the VS Code Extension Development Host.

---

## 📌 Current Development Status

**Active development**

Current implemented areas include:

* GitHub authentication
* Repository management
* Local repository support
* Repository cloning
* Repository switching
* Branch management
* Branch creation
* Git commit and push workflows
* Auto commit functionality
* AI commit message generation
* AI repository description generation
* Gemini API integration
* Merge-conflict detection
* Repository sorting
* Improved extension UI
* Python backend integration

Additional UI, automation, AI, and architecture improvements are still being developed.

---

## 🗺️ Roadmap

### Completed / Implemented

* [x] GitHub authentication
* [x] Repository management
* [x] Local repository workflows
* [x] Clone repositories
* [x] Branch management
* [x] Branch switching
* [x] Branch creation
* [x] Git commit/push workflow
* [x] AI commit message generation
* [x] AI description generation
* [x] Gemini integration
* [x] Merge-conflict detection
* [x] Repository sorting
* [x] Extension UI improvements

### In Development

* [ ] Further AI README generation improvements
* [ ] Auto-commit workflow improvements
* [ ] Auto-description improvements
* [ ] UI refinements
* [ ] Backend/extension architecture refactoring
* [ ] Additional repository management improvements

### Future Ideas

* [ ] GitHub Actions integration
* [ ] Advanced repository analytics
* [ ] More AI-assisted Git workflows
* [ ] Additional GitHub automation features

---

## 🔒 Security

GitHub Automator is designed to keep sensitive credentials out of the source code.

**Never commit:**

```text
.env
API keys
GitHub tokens
Personal access tokens
Private credentials
```

Use environment variables or secure credential storage for sensitive configuration.

---

## 🎯 Why GitHub Automator?

Git workflows often require developers to repeatedly switch between:

* VS Code
* Git commands
* GitHub
* Repository management interfaces
* AI tools

GitHub Automator brings these workflows together inside VS Code.

The goal is not to replace Git. Instead, it provides a higher-level interface for common GitHub and Git workflows while adding AI assistance where it can reduce repetitive work.

---

## 👨‍💻 Author

**Muhammad Abdullah**

BSCS Student | Python | AI/ML | Software Development

GitHub: [@abdullah123-collab](https://github.com/abdullah123-collab)

---

## 📄 License

See the repository license for the applicable terms.

---

## ⭐ Project

If you find GitHub Automator useful, consider giving the repository a ⭐.

Built as an independent project to explore **VS Code extension development, Git automation, Python backends, GitHub APIs, and AI-assisted developer tooling**.
