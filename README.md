# GitHub Automator - VS Code Extension
A powerful VS Code extension that automates GitHub workflows with AI-powered commit messages and intelligent repository management.

## Features
- **GitHub Authentication** - Secure OAuth integration for GitHub API access
- **Repository Management** - Clone, switch, and manage multiple local repositories
- **Auto Commit & Push** - Automated commit creation and push with optional merge conflict detection
- **AI-Powered Commit Messages** - Generate intelligent, contextual commit messages using Gemini API
- **Merge Conflict Resolution** - Detect and guide resolution of merge conflicts
- **Local Repository Support** - Full support for local repository workflows without cloud dependency

## Tech Stack
- **Frontend**: JavaScript, VS Code Extension API
- **Backend**: Python, GitHub API
- **AI Integration**: Google Gemini Gemini API
- **Build**: npm (Node.js)

## Installation
1. Clone the repository:
```bash
   git clone https://github.com/yourusername/github-automator.git
   cd github-automator
```
2. Install dependencies:
```bash
   # Backend
   pip install -r backend/requirements.txt
   # Extension
   cd extension
   npm install
```
3. Set up environment variables:
```bash
   cp .env.example .env
   # Add your GitHub and Google Gemini API keys to .env
```
4. Launch the extension:
   - Open the `extension/` folder in VS Code
   - Press `F5` to run the extension in debug mode

## Development Phases

### ✅ Phase 1 — Authentication & Setup
- GitHub OAuth integration
- Secure token storage
- Basic extension scaffold and VS Code command registration

### ✅ Phase 2 — Repository Management
- Clone and switch between repositories
- Local repository detection and initialization
- Multi-repo support

### ✅ Phase 3 — Automation & AI
- Auto commit and push workflow
- AI-generated commit messages via Gemini API
- Auto-pull on push rejection
- Merge conflict detection and abort

### 🔄 Phase 4 — UI & Polish *(In Progress)*
- Improved sidebar UI
- Commit history viewer
- Better error handling and user notifications

### 📋 Phase 5 — Planned
- Support for GitHub Actions triggers
- Team collaboration features
- Settings panel for custom configurations

## Status
**In Development** — Phase 3 Complete

## Documentation
- [Architecture Overview](docs/ARCHITECTURE.md)
- [Features Guide](docs/FEATURES.md)
- [Getting Started](docs/GETTING_STARTED.md)
- [API Reference](docs/API/SMART_REPO_IMPLEMENTATION.md)
- [Changelog](docs/CHANGELOG/CHANGES.md)

## Project Structure

```
github-automator/
├── backend/          # Python backend services
├── extension/        # VS Code extension source
├── docs/            # Documentation
├── tests/           # Test files
└── scripts/         # Utility scripts
```


