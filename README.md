# GitHub Automator - VS Code Extension

A powerful VS Code extension that automates GitHub workflows with AI-powered commit messages and intelligent repository management.

## Features

- **GitHub Authentication** - Secure OAuth integration for GitHub API access
- **Repository Management** - Clone, switch, and manage multiple local repositories
- **Auto Commit & Push** - Automated commit creation and push with optional merge conflict detection
- **AI-Powered Commit Messages** - Generate intelligent, contextual commit messages using Claude API
- **Merge Conflict Resolution** - Detect and guide resolution of merge conflicts
- **Local Repository Support** - Full support for local repository workflows without cloud dependency

## Tech Stack

- **Frontend**: JavaScript, VS Code Extension API
- **Backend**: Python, GitHub API
- **AI Integration**: Anthropic Claude API
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
   # Add your GitHub and Anthropic API keys to .env
   ```

4. Launch the extension:
   - Open the `extension/` folder in VS Code
   - Press `F5` to run the extension in debug mode

## Status

**In Development** - Phase 3 Complete

Current capabilities include core GitHub integration, AI-powered commit messages, and local repository support. Additional features and enhancements are in active development.

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

## License

[Add your license here]

## Contributing

[Add contribution guidelines here]
