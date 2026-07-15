# Smart Repository Management - Quick Reference

## For Extension Users

### The "+  Button Now Works Smarter!

**Before:**
- Click "+" → Pick folder → Clone (even if already cloned) → Duplicates! ❌

**After:**
- Click "+" → Already cloned? → Open it! ✅
- Click "+" → Not cloned? → Pick folder → Clone → Open! ✅

### Quick Actions

| Action | Result |
|--------|--------|
| Click "+" on new repo | Clone it, register it, open it |
| Click "+" on existing repo | Open it instantly (no re-clone) |
| Move a cloned repo | Registry auto-detects and cleans up |
| Delete a cloned repo | Registry auto-removes the entry |

---

## For Developers

### Python Backend Quick Reference

**Main Module: `repo_registry.py`**

```python
from repo_registry import (
    repo_exists_locally,      # bool - quick check
    find_repo_by_name,        # str|None - get path
    register_repo,            # dict - register after clone
    unregister_repo,          # dict - remove from registry
    cleanup_registry,         # dict - clean invalid entries
    get_registry_path,        # str - get registry file location
    load_registry,            # dict - load from disk
    save_registry,            # None - save to disk
)
```

**Usage Example:**
```python
# Check if repo exists
if repo_exists_locally("my-repo"):
    path = find_repo_by_name("my-repo")
    print(f"Found at: {path}")

# Register a new clone
result = register_repo("my-repo", "/path/to/repo", "https://github.com/user/my-repo.git")
if result["success"]:
    print("Registered successfully")
```

### JS/Extension Quick Reference

**Main Command: `github-automator.initializeRepo`**

Called when user clicks "+" button on a repository item.

```javascript
// Input (element parameter):
{
    name: "my-repo",
    clone_url: "https://github.com/user/my-repo.git",
    private: false,
    description: "..."
}

// Workflow:
1. Check if exists locally (Python call)
2. If exists: Open in VS Code
3. If not exists: Show folder picker
4. Clone with registration (Python call)
5. Open in VS Code
```

**Python Actions Available:**

| Action | Input Parameters | Output |
|--------|------------------|--------|
| `check_repo_exists` | `repo_name` | `{ exists: bool, path: str, ... }` |
| `smart_clone` | `repo_name`, `clone_url`, `dest_path`, `token` | `{ path: str, ... }` |
| `cleanup_registry` | (none) | `{ removed_count: int, ... }` |

### Registry Format

**File Location:**
- Windows: `%APPDATA%\GitHub-Automator\repo_registry.json`
- Linux/macOS: `~/.config/github-automator/repo_registry.json`

**JSON Structure:**
```json
{
  "repo-name": {
    "path": "/absolute/path",
    "clone_url": "https://github.com/user/repo.git",
    "registered_at": "2024-05-14T10:30:00.123456"
  }
}
```

### Workflow Diagram

```
┌─────────────────┐
│ User clicks "+" │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────┐
│ Check if repo exists        │
│ (Python: check_repo_exists) │
└────────┬────────────────────┘
         │
    ┌────┴─── ─┐
    │          │
   YES       NO
    │          │
    ▼          ▼
┌─────────┐  ┌──────────────────┐
│ Open    │  │ Show folder      │
│ existing│  │ picker dialog    │
│ in VS   │  └─────┬────────────┘
│ Code    │        │
└─────────┘        ▼
              ┌──────────────────┐
              │ Clone repo       │
              │ (smart_clone)    │
              └─────┬────────────┘
                    │
                    ▼
              ┌──────────────────┐
              │ Register in      │
              │ local registry   │
              └─────┬────────────┘
                    │
                    ▼
              ┌──────────────────┐
              │ Open in VS Code  │
              └──────────────────┘
```

### Integration Points

**1. Extension → Python Bridge**
```javascript
const result = await spawnPython('repo_manager.py', {
    action: 'smart_clone',
    token: currentToken,
    repo_name: 'my-repo',
    clone_url: 'https://github.com/user/my-repo.git',
    dest_path: '/path/to/clone'
});
```

**2. Python → Registry**
```python
from repo_registry import repo_exists_locally, find_repo_by_name

if repo_exists_locally('my-repo'):
    path = find_repo_by_name('my-repo')
    # Open in VS Code
```

**3. Registry → Disk**
```python
from repo_registry import load_registry, save_registry

registry = load_registry()  # Load from JSON file
# Modify registry...
save_registry(registry)     # Save to JSON file
```

---

## Common Tasks

### Add a New Repository Management Action

**Step 1:** Create function in `repo_manager.py`
```python
def my_new_action(param1: str) -> dict:
    """Do something smart."""
    return {"success": True, "result": "..."}
```

**Step 2:** Add action handler
```python
elif action == "my_new_action":
    result = my_new_action(args.get("param1", ""))
```

**Step 3:** Call from extension
```javascript
const result = await spawnPython('repo_manager.py', {
    action: 'my_new_action',
    param1: 'value'
});
```

### Debug Registry Issues

**Check Registry File:**
```bash
# Windows
type %APPDATA%\GitHub-Automator\repo_registry.json

# Linux/macOS
cat ~/.config/github-automator/repo_registry.json
```

**Clear Registry (if corrupted):**
- Simply delete the JSON file
- It will be recreated on next operation

**Validate Registry:**
```python
from repo_registry import cleanup_registry

result = cleanup_registry()
print(f"Removed {result['removed_count']} invalid entries")
```

---

## Performance Tips

✅ **Fast Operations:**
- Registry lookups: <100ms
- Path validation: <200ms
- Existing repo open: <1s

⚠️ **Watch Out:**
- First clone: 5-30s (network dependent)
- Large repos: May take longer to clone
- Registry with 1000+ entries: Still fast (<1s)

---

## Error Messages

**Registry not found:**
```python
registry = load_registry()  # Returns {} if missing
# Will be created on first save
```

**Invalid repository path:**
```python
# Auto-removed during validation
# Next registry save will be clean
```

**Repository already exists:**
```json
{
    "success": false,
    "error": "Repository 'my-repo' already exists locally at /path/to/repo",
    "already_exists": true,
    "existing_path": "/path/to/repo"
}
```

---

## Testing Checklist

- [ ] Clone new repository (first time)
- [ ] Click "+" on same repo (should open existing)
- [ ] Clone second repository (no interference with first)
- [ ] Move cloned repository to new location
- [ ] Click "+" on moved repository (should detect invalid path)
- [ ] Delete registry file and use extension (should recreate)
- [ ] Check registry file exists in correct location
- [ ] Verify no duplicate folders created
- [ ] Test with multiple rapid clicks
- [ ] Test with repositories in different locations

---

## Resources

- 📖 User Guide: `SMART_REPO_MANAGEMENT.md`
- 🏗️ Implementation Details: `SMART_REPO_IMPLEMENTATION.md`
- 📋 Main README: `README.md`
- ✨ Features: `FEATURES.md`

---

## Support

**For Users:** See `SMART_REPO_MANAGEMENT.md` troubleshooting section

**For Developers:** Check implementation details in `SMART_REPO_IMPLEMENTATION.md`
