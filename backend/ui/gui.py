"""
gui.py — Enhanced Tkinter GUI for GitHub Automator
Called by pythonBridge.js via repo_manager.py

Features:
- Remote GitHub repository management (create, clone, delete)
- Local repository detection and management
- Commit & Push with staged changes
- AI-generated commit messages
- Branch status display
- File change preview
- Smart Open: auto-detects existing clones, opens in VS Code

Input  (stdin): JSON { "token": "ghp_xxx" }
Output: Opens a tkinter window with GitHub and Git automation tools
"""

import sys
import json
import threading
import subprocess
import tkinter as tk
import os
from tkinter import ttk, messagebox, simpledialog, filedialog, scrolledtext
from services.github_api import GitHubAPI
from services.ai_commit import generate_commit_message


# ─── Theme Colors ─────────────────────────────────────────────────
BG        = "#1e1e1e"
BG2       = "#252526"
BG3       = "#2d2d2d"
FG        = "#d4d4d4"
ACCENT    = "#0078d4"
ACCENT_H  = "#1a8fe0"
DANGER    = "#c0392b"
DANGER_H  = "#e74c3c"
SUCCESS   = "#4caf50"
BORDER    = "#3c3c3c"
FONT      = ("Segoe UI", 10)
FONT_B    = ("Segoe UI", 10, "bold")
FONT_H    = ("Segoe UI", 13, "bold")
FONT_S    = ("Segoe UI", 8)


# ─── Git Helper Functions ─────────────────────────────────────────
def is_git_repo(path: str) -> bool:
    """Check if a directory is a Git repository."""
    return os.path.isdir(os.path.join(path, ".git"))


def get_git_status(repo_path: str) -> dict:
    """Get current Git status (branch, changes count, etc.)."""
    try:
        result = subprocess.run(
            ["git", "branch", "--show-current"],
            cwd=repo_path, capture_output=True, text=True, timeout=5
        )
        branch = result.stdout.strip() or "detached"

        result = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=repo_path, capture_output=True, text=True, timeout=5
        )
        changes = result.stdout.strip().split("\n") if result.stdout.strip() else []
        staged_count = sum(1 for line in changes if line.startswith(("M ", "A ", "D ", "R ")))
        unstaged_count = len(changes) - staged_count

        return {
            "branch": branch,
            "staged": staged_count,
            "unstaged": unstaged_count,
            "total_changes": len(changes),
            "changes": changes
        }
    except Exception as e:
        return {"error": str(e), "branch": "unknown"}


def get_git_diff(repo_path: str, staged: bool = False) -> str:
    """Get git diff output."""
    try:
        args = ["git", "diff"]
        if staged:
            args.append("--staged")
        result = subprocess.run(
            args, cwd=repo_path, capture_output=True, text=True, timeout=5
        )
        return result.stdout
    except Exception as e:
        return f"Error: {e}"


class GitHubAutomatorApp:
    def __init__(self, root: tk.Tk, token: str):
        self.root = root
        self.token = token
        self.api = GitHubAPI(token)
        self.repos = []
        self.local_repo_path = None
        self.repo_search_var = tk.StringVar(value="")
        self.anthropic_key = os.getenv("ANTHROPIC_API_KEY", "")
        self.status_var = tk.StringVar(value="Ready")
        self.scroll_frame = None
        self.canvas = None

        self._setup_window()
        self.root.update_idletasks()
        self._show_initial_choice()

    # ─── Initial Choice Screen ────────────────────────────────────
    def _show_initial_choice(self):
        """Show user a choice: Manage remote repos or open local repo."""
        try:
            self.root.geometry("600x300")

            for widget in self.root.winfo_children():
                widget.destroy()

            main = tk.Frame(self.root, bg=BG)
            main.pack(fill="both", expand=True, padx=20, pady=20)

            tk.Label(main, text="⚡ GitHub Automator", font=FONT_H,
                     bg=BG, fg=ACCENT).pack(pady=20)

            tk.Label(main, text="What would you like to do?",
                     font=FONT, bg=BG, fg=FG).pack(pady=10)

            btn1 = tk.Button(main, text="🌐 Manage GitHub Repositories",
                             command=self._show_github_mode,
                             bg=ACCENT, fg="white", font=FONT_B,
                             relief="flat", padx=20, pady=15, cursor="hand2",
                             activebackground=ACCENT_H, activeforeground="white")
            btn1.pack(fill="x", pady=10)

            btn2 = tk.Button(main, text="💻 Work with Local Repository",
                             command=self._show_local_mode,
                             bg=SUCCESS, fg="white", font=FONT_B,
                             relief="flat", padx=20, pady=15, cursor="hand2",
                             activebackground="#5ac05a", activeforeground="white")
            btn2.pack(fill="x", pady=10)

        except Exception as e:
            print(f"Error in _show_initial_choice: {e}")
            import traceback
            traceback.print_exc()

    def _show_github_mode(self):
        """Switch to GitHub remote repository manager."""
        self._build_ui()
        self._load_user()
        self._load_repos()

    def _show_local_mode(self):
        """Switch to local repository manager."""
        folder = filedialog.askdirectory(title="Select folder to work with")
        if not folder:
            return

        if is_git_repo(folder):
            self.local_repo_path = folder
            self._build_local_ui()
        else:
            choice = messagebox.askyesnocancel(
                "Not a Git Repository",
                "This folder is not a Git repository.\n\n"
                "Yes: Initialize a new Git repository\n"
                "No: Clone from remote URL\n"
                "Cancel: Go back",
                icon="question"
            )

            if choice is None:
                self._show_initial_choice()
            elif choice:
                self._init_git_repo(folder)
            else:
                self._clone_to_folder(folder)

    def _init_git_repo(self, folder):
        """Initialize a new Git repository."""
        def task():
            try:
                subprocess.run(["git", "init"], cwd=folder, capture_output=True, timeout=5)
                subprocess.run(["git", "config", "user.name", "Automator"],
                               cwd=folder, capture_output=True, timeout=5)
                subprocess.run(["git", "config", "user.email", "automator@github.local"],
                               cwd=folder, capture_output=True, timeout=5)
                self.root.after(0, lambda: (
                    setattr(self, "local_repo_path", folder),
                    self._build_local_ui()
                ))
                self.root.after(100, lambda: self._set_status("✅ Repository initialized!"))
            except Exception as e:
                self.root.after(0, lambda: messagebox.showerror("Error", str(e)))
                self.root.after(0, self._show_initial_choice)
        threading.Thread(target=task, daemon=True).start()

    def _clone_to_folder(self, folder):
        """Clone repository to folder."""
        url = simpledialog.askstring("Clone Repository", "Enter repository URL:")
        if not url:
            self._show_initial_choice()
            return

        def task():
            try:
                subprocess.run(["git", "clone", url, folder],
                               capture_output=True, timeout=60)
                self.root.after(0, lambda: (
                    setattr(self, "local_repo_path", folder),
                    self._build_local_ui()
                ))
                self.root.after(100, lambda: self._set_status("✅ Clone complete!"))
            except Exception as e:
                self.root.after(0, lambda: messagebox.showerror("Error", str(e)))
                self.root.after(0, self._show_initial_choice)
        threading.Thread(target=task, daemon=True).start()

    # ─── Local Repository UI ──────────────────────────────────────
    def _build_local_ui(self):
        """Build UI for local repository management."""
        self.root.geometry("800x700")

        for widget in self.root.winfo_children():
            widget.destroy()

        # ── Header ──
        header = tk.Frame(self.root, bg=BG2, pady=12)
        header.pack(fill="x")

        left_header = tk.Frame(header, bg=BG2)
        left_header.pack(side="left", padx=16)

        tk.Label(left_header, text="💻 Local Repository", font=FONT_H,
                 bg=BG2, fg=SUCCESS).pack(side="left")

        self.lbl_repo_status = tk.Label(left_header, text="Loading...",
                                        font=FONT_S, bg=BG2, fg=FG)
        self.lbl_repo_status.pack(side="left", padx=10)

        back_btn_frame = tk.Frame(header, bg=BG2)
        back_btn_frame.pack(side="right", padx=16)
        self._btn(back_btn_frame, "← Back", self._show_initial_choice,
                  BG3, "#3c3c3c").pack()

        # ── Status Section ──
        status_frame = tk.Frame(self.root, bg=BG2, padx=14, pady=10)
        status_frame.pack(fill="x")

        tk.Label(status_frame, text=f"📁 {self.local_repo_path}",
                 font=FONT_S, bg=BG2, fg="#888888").pack(anchor="w")

        # ── Git Status Display ──
        self.git_status_frame = tk.Frame(self.root, bg=BG2, padx=14, pady=10)
        self.git_status_frame.pack(fill="x")

        # ── Action Buttons ──
        action_buttons = tk.Frame(self.root, bg=BG, padx=14, pady=10)
        action_buttons.pack(fill="x")

        btn1 = tk.Frame(action_buttons, bg=BG)
        btn1.pack(fill="x", pady=4)
        # Single primary action per UX guidelines
        self._btn(btn1, "⚡ Commit & Push", self._commit_and_push,
              ACCENT, ACCENT_H).pack(side="left", padx=2, fill="x", expand=True)

        btn2 = tk.Frame(action_buttons, bg=BG)
        btn2.pack(fill="x", pady=4)
        self._btn(btn2, "📝 Preview Changes", self._preview_changes,
                  "#5a8aff", "#6a9aff").pack(side="left", padx=2, fill="x", expand=True)
        self._btn(btn2, "📊 Refresh Status", self._refresh_local_status,
                  BG3, "#3c3c3c").pack(side="left", padx=2, fill="x", expand=True)

        # ── Changes List ──
        tk.Label(self.root, text="  Changed Files", font=FONT_B,
                 bg=BG, fg=FG, anchor="w").pack(fill="x", padx=14)

        list_frame = tk.Frame(self.root, bg=BG)
        list_frame.pack(fill="both", expand=True, padx=14, pady=(4, 0))

        self.changes_canvas = tk.Canvas(list_frame, bg=BG, highlightthickness=0)
        scrollbar = ttk.Scrollbar(list_frame, orient="vertical", command=self.changes_canvas.yview)
        self.changes_scroll_frame = tk.Frame(self.changes_canvas, bg=BG)

        self.changes_scroll_frame.bind("<Configure>",
            lambda e: self.changes_canvas.configure(scrollregion=self.changes_canvas.bbox("all")))

        self.changes_canvas.create_window((0, 0), window=self.changes_scroll_frame, anchor="nw")
        self.changes_canvas.configure(yscrollcommand=scrollbar.set)

        scrollbar.pack(side="right", fill="y")
        self.changes_canvas.pack(side="left", fill="both", expand=True)

        # ── Status Bar ──
        self.status_var = tk.StringVar(value="Ready")
        status_bar = tk.Frame(self.root, bg=BG2, pady=5)
        status_bar.pack(fill="x", side="bottom")
        self.lbl_status = tk.Label(status_bar, textvariable=self.status_var,
                                   font=FONT_S, bg=BG2, fg=FG, anchor="w")
        self.lbl_status.pack(side="left", padx=12)

        self._refresh_local_status()

    def _refresh_local_status(self):
        """Refresh and display Git status."""
        def task():
            try:
                status = get_git_status(self.local_repo_path)
                self.root.after(0, lambda: self._display_git_status(status))
            except Exception as e:
                self.root.after(0, lambda: self._set_status(f"Error: {e}"))
        threading.Thread(target=task, daemon=True).start()

    def _display_git_status(self, status):
        """Display Git status information."""
        for w in self.git_status_frame.winfo_children():
            w.destroy()

        if "error" in status:
            tk.Label(self.git_status_frame, text=f"❌ {status['error']}",
                     font=FONT_S, bg=BG2, fg=DANGER).pack(anchor="w")
            return

        branch = status.get("branch", "unknown")
        staged = status.get("staged", 0)
        unstaged = status.get("unstaged", 0)
        total = status.get("total_changes", 0)

        status_text = f"Branch: {branch}  |  Staged: {staged}  |  Unstaged: {unstaged}  |  Total changes: {total}"
        self.lbl_repo_status.config(text=status_text)

        for w in self.changes_scroll_frame.winfo_children():
            w.destroy()

        changes = status.get("changes", [])
        if not changes:
            tk.Label(self.changes_scroll_frame, text="No changes", font=FONT,
                     bg=BG, fg="#666666").pack(anchor="w", padx=10, pady=10)
            return

        for change in changes:
            status_char = change[0]
            filename = change[3:]

            if status_char == "M":
                color = "#ffa500"
                icon = "📝"
            elif status_char == "A":
                color = "#4caf50"
                icon = "✚"
            elif status_char == "D":
                color = DANGER
                icon = "✖"
            elif status_char == "R":
                color = "#5a8aff"
                icon = "→"
            else:
                color = FG
                icon = "?"

            change_label = tk.Label(self.changes_scroll_frame,
                                    text=f"{icon} {filename}",
                                    font=FONT_S, bg=BG, fg=color, anchor="w")
            change_label.pack(fill="x", padx=10, pady=2)

    # ─── UI Helpers: AI inline generation animations ─────────────
    def _start_loading_border(self, widget):
        """Animate a blue loading border on a widget by toggling highlight color."""
        def pulse():
            if getattr(widget, "_ai_loading", False):
                # toggle between accent and bg3 to simulate animation
                widget.config(highlightthickness=2, highlightbackground=ACCENT)
                widget.after(350, lambda: widget.config(highlightbackground=BG3))
                widget.after(700, pulse)
        widget._ai_loading = True
        pulse()

    def _stop_loading_border(self, widget):
        widget._ai_loading = False
        try:
            widget.config(highlightthickness=1, highlightbackground=BORDER)
        except Exception:
            pass

    def _inline_generate_commit_message(self, text_widget):
        """Generate a commit message and insert it into the provided Text widget."""
        if not self.anthropic_key:
            # generate using rule-based fallback (generate_commit_message works without key)
            pass

        # set placeholder and start animation
        def start_ui():
            text_widget.delete("1.0", "end")
            text_widget.insert("1.0", "Generating commit message...")
            self._start_loading_border(text_widget)
            text_widget.config(state="normal")
        self.root.after(0, start_ui)

        def task():
            try:
                unstaged = get_git_diff(self.local_repo_path, staged=False)
                staged   = get_git_diff(self.local_repo_path, staged=True)

                untracked_result = subprocess.run(
                    ["git", "ls-files", "--others", "--exclude-standard"],
                    cwd=self.local_repo_path, capture_output=True, text=True, timeout=5
                )
                untracked = untracked_result.stdout.strip()

                combined_diff = ""
                if staged:
                    combined_diff += f"=== STAGED CHANGES ===\n{staged}\n\n"
                if unstaged:
                    combined_diff += f"=== UNSTAGED CHANGES ===\n{unstaged}\n\n"
                if untracked:
                    combined_diff += f"=== NEW FILES ===\n{untracked}\n"

                if not combined_diff.strip():
                    result = {"success": True, "message": "chore: update files"}
                else:
                    result = generate_commit_message(combined_diff[:4000], self.anthropic_key)

                def finish_ui():
                    self._stop_loading_border(text_widget)
                    if result.get("success"):
                        # replace text with generated message
                        text_widget.delete("1.0", "end")
                        # gentle visual cue: flash background
                        orig_bg = text_widget.cget("bg")
                        text_widget.config(bg=ACCENT_H)
                        text_widget.insert("1.0", result.get("message", ""))
                        self.root.after(180, lambda: text_widget.config(bg=orig_bg))
                    else:
                        messagebox.showerror("AI Error", result.get("error", "Unknown error"))

                self.root.after(0, finish_ui)
            except Exception as e:
                def fail_ui():
                    self._stop_loading_border(text_widget)
                    messagebox.showerror("Error", str(e))
                self.root.after(0, fail_ui)

        threading.Thread(target=task, daemon=True).start()

    def _inline_generate_repo_description(self, desc_var, name_var=None, topics_var=None):
        """Generate a professional repository description and set it to desc_var."""
        # lightweight UI: find the widget for repo description by searching (best-effort)
        # create a simple placeholder dialog if no UI reference
        prompt_parts = []
        if name_var:
            name = name_var.get().strip()
            if name:
                prompt_parts.append(f"Repository name: {name}")
        if topics_var:
            topics = topics_var.get().strip()
            if topics:
                prompt_parts.append(f"Topics: {topics}")

        placeholder = "Generating repository description..."
        # try to set placeholder in desc_var
        try:
            desc_var.set(placeholder)
        except Exception:
            pass

        def task():
            try:
                prompt = "\n".join(prompt_parts) or "Create a short professional GitHub repository description."
                # reuse generator: it's fine as a fallback
                result = generate_commit_message(prompt, self.anthropic_key)
                if result.get("success"):
                    desc = result.get("message", "")
                    self.root.after(0, lambda: desc_var.set(desc))
                else:
                    self.root.after(0, lambda: messagebox.showerror("AI Error", result.get("error", "Unknown")))
            except Exception as e:
                self.root.after(0, lambda: messagebox.showerror("Error", str(e)))

        threading.Thread(target=task, daemon=True).start()

    def _preview_changes(self):
        """Show diff preview of changes."""
        try:
            diff = get_git_diff(self.local_repo_path, staged=False)
            if not diff.strip():
                diff = "(No changes)"

            preview_win = tk.Toplevel(self.root)
            preview_win.title("Preview Changes")
            preview_win.geometry("600x500")
            preview_win.configure(bg=BG)

            tk.Label(preview_win, text="📋 File Changes (diff)", font=FONT_B,
                     bg=BG, fg=FG).pack(padx=10, pady=5)

            text_widget = scrolledtext.ScrolledText(preview_win, bg=BG2, fg=FG,
                                                    font=("Consolas", 9), height=20)
            text_widget.pack(fill="both", expand=True, padx=10, pady=10)
            text_widget.insert("1.0", diff)
            text_widget.config(state="disabled")

            tk.Button(preview_win, text="Close", command=preview_win.destroy,
                      bg=BG3, fg=FG, font=FONT).pack(pady=10)
        except Exception as e:
            messagebox.showerror("Error", f"Failed to preview: {e}")

    def _commit_and_push(self):
        """Open dialog for committing and pushing."""
        commit_win = tk.Toplevel(self.root)
        commit_win.title("Commit & Push")
        commit_win.geometry("500x450")
        commit_win.configure(bg=BG)
        commit_win.grab_set()

        commit_win.update_idletasks()
        x = self.root.winfo_x() + (self.root.winfo_width() // 2) - 250
        y = self.root.winfo_y() + (self.root.winfo_height() // 2) - 225
        commit_win.geometry(f"+{x}+{y}")

        tk.Label(commit_win, text="↑ Commit & Push", font=FONT_H,
                 bg=BG, fg=ACCENT).pack(pady=(16, 10))

        form = tk.Frame(commit_win, bg=BG, padx=20)
        form.pack(fill="both", expand=True)

        tk.Label(form, text="Commit Message *", font=FONT_S, bg=BG, fg=FG).pack(anchor="w")
        # Message frame with inline AI icon
        msg_frame = tk.Frame(form, bg=BG)
        msg_frame.pack(fill="both", expand=True, pady=(2, 10))
        msg_text = tk.Text(msg_frame, font=FONT, bg=BG2, fg=FG, height=6,
                           insertbackground=FG, relief="flat", bd=6, highlightthickness=1,
                           highlightbackground=BORDER)
        msg_text.grid(row=0, column=0, sticky="nsew")
        msg_frame.grid_rowconfigure(0, weight=1)
        msg_frame.grid_columnconfigure(0, weight=1)

        def _on_generate():
            self._inline_generate_commit_message(msg_text)

        ai_btn = tk.Button(msg_frame, text="✨", command=_on_generate,
                           bg=BG3, fg=FG, relief="flat", width=3, cursor="hand2",
                           activebackground=BG2)
        ai_btn.grid(row=0, column=1, sticky="ne", padx=(6,0), pady=6)
        msg_text.focus()

        tk.Label(form, text="Push to Branch", font=FONT_S, bg=BG, fg=FG).pack(anchor="w")
        branch_var = tk.StringVar(value="main")
        branch_entry = tk.Entry(form, textvariable=branch_var, font=FONT,
                                bg=BG2, fg=FG, insertbackground=FG, relief="flat", bd=6)
        branch_entry.pack(fill="x", pady=(2, 15))

        btn_frame = tk.Frame(form, bg=BG)
        btn_frame.pack(fill="x", pady=(10, 0))

        def do_commit():
            message = msg_text.get("1.0", "end").strip()
            branch = branch_var.get().strip()

            if not message:
                messagebox.showerror("Error", "Commit message is required!", parent=commit_win)
                return

            commit_win.destroy()
            self._perform_commit(message, branch)

        self._btn(btn_frame, "✓ Commit & Push", do_commit,
                  ACCENT, ACCENT_H).pack(side="left", fill="x", expand=True, padx=2)
        self._btn(btn_frame, "✕ Cancel", commit_win.destroy,
                  BG3, "#3c3c3c").pack(side="left", fill="x", expand=True, padx=2)

    def _ai_generate_message(self):
        """Generate commit message using AI."""
        if not self.anthropic_key:
            messagebox.showwarning(
                "AI Feature Unavailable",
                "Anthropic API key not found.\n\n"
                "Set ANTHROPIC_API_KEY environment variable to enable this feature."
            )
            return

        self._set_status("Generating commit message...")

        def task():
            try:
                unstaged = get_git_diff(self.local_repo_path, staged=False)
                staged   = get_git_diff(self.local_repo_path, staged=True)

                untracked_result = subprocess.run(
                    ["git", "ls-files", "--others", "--exclude-standard"],
                    cwd=self.local_repo_path, capture_output=True, text=True, timeout=5
                )
                untracked = untracked_result.stdout.strip()

                combined_diff = ""
                if staged:
                    combined_diff += f"=== STAGED CHANGES ===\n{staged}\n\n"
                if unstaged:
                    combined_diff += f"=== UNSTAGED CHANGES ===\n{unstaged}\n\n"
                if untracked:
                    combined_diff += f"=== NEW FILES ===\n{untracked}\n"

                if not combined_diff.strip():
                    self.root.after(0, lambda: messagebox.showinfo(
                        "No Changes", "No changes found in this repository."))
                    self.root.after(0, lambda: self._set_status("Ready"))
                    return

                result = generate_commit_message(combined_diff[:4000], self.anthropic_key)

                if result["success"]:
                    self.root.after(0, lambda: self._show_ai_message_dialog(result["message"]))
                else:
                    self.root.after(0, lambda: messagebox.showerror(
                        "AI Error", result.get("error", "Unknown error")))

                self.root.after(0, lambda: self._set_status("Ready"))
            except Exception as e:
                self.root.after(0, lambda: messagebox.showerror("Error", str(e)))
                self.root.after(0, lambda: self._set_status("Error"))

        threading.Thread(target=task, daemon=True).start()

    def _show_ai_message_dialog(self, ai_message):
        """Show AI-generated message in dialog."""
        msg_win = tk.Toplevel(self.root)
        msg_win.title("✨ AI-Generated Commit Message")
        msg_win.geometry("550x350")
        msg_win.configure(bg=BG)
        msg_win.grab_set()

        msg_win.update_idletasks()
        x = self.root.winfo_x() + (self.root.winfo_width() // 2) - 275
        y = self.root.winfo_y() + (self.root.winfo_height() // 2) - 175
        msg_win.geometry(f"+{x}+{y}")

        tk.Label(msg_win, text="✨ AI-Generated Commit Message", font=FONT_H,
                 bg=BG, fg="#8a5aff").pack(pady=(16, 10))

        tk.Label(msg_win, text="Review and edit if needed:", font=FONT_S,
                 bg=BG, fg=FG).pack(anchor="w", padx=20)

        msg_text = tk.Text(msg_win, font=FONT, bg=BG2, fg=FG, height=8,
                           insertbackground=FG, relief="flat", bd=6, wrap="word")
        msg_text.pack(fill="both", expand=True, padx=20, pady=(5, 15))
        msg_text.insert("1.0", ai_message)
        msg_text.focus()

        btn_frame = tk.Frame(msg_win, bg=BG, padx=20)
        btn_frame.pack(fill="x", pady=(0, 15))

        def use_message():
            message = msg_text.get("1.0", "end").strip()
            msg_win.destroy()
            self._commit_with_message(message)

        self._btn(btn_frame, "✓ Use This", use_message,
                  ACCENT, ACCENT_H).pack(side="left", fill="x", expand=True, padx=2)
        self._btn(btn_frame, "✕ Cancel", msg_win.destroy,
                  BG3, "#3c3c3c").pack(side="left", fill="x", expand=True, padx=2)

    def _commit_with_message(self, message):
        """Show branch dialog then commit with provided message."""
        commit_win = tk.Toplevel(self.root)
        commit_win.title("Commit & Push")
        commit_win.geometry("500x200")
        commit_win.configure(bg=BG)
        commit_win.grab_set()

        commit_win.update_idletasks()
        x = self.root.winfo_x() + (self.root.winfo_width() // 2) - 250
        y = self.root.winfo_y() + (self.root.winfo_height() // 2) - 100
        commit_win.geometry(f"+{x}+{y}")

        tk.Label(commit_win, text="Commit & Push", font=FONT_H,
                 bg=BG, fg=ACCENT).pack(pady=(16, 10))

        form = tk.Frame(commit_win, bg=BG, padx=20)
        form.pack(fill="both", expand=True)

        tk.Label(form, text="Branch", font=FONT_S, bg=BG, fg=FG).pack(anchor="w")
        branch_var = tk.StringVar(value="main")
        branch_entry = tk.Entry(form, textvariable=branch_var, font=FONT,
                                bg=BG2, fg=FG, insertbackground=FG, relief="flat", bd=6)
        branch_entry.pack(fill="x", pady=(2, 15))

        btn_frame = tk.Frame(form, bg=BG)
        btn_frame.pack(fill="x")

        def do_commit():
            branch = branch_var.get().strip()
            commit_win.destroy()
            self._perform_commit(message, branch)

        self._btn(btn_frame, "✓ Push", do_commit,
                  ACCENT, ACCENT_H).pack(side="left", fill="x", expand=True, padx=2)
        self._btn(btn_frame, "✕ Cancel", commit_win.destroy,
                  BG3, "#3c3c3c").pack(side="left", fill="x", expand=True, padx=2)

    def _perform_commit(self, message, branch):
        """Perform the actual commit and push with token auth."""
        self._set_status("Staging changes...")

        def task():
            try:
                # Step 1: Stage all
                subprocess.run(["git", "add", "-A"], cwd=self.local_repo_path,
                               capture_output=True, timeout=10)
                self.root.after(0, lambda: self._set_status("Committing..."))

                # Step 2: Commit
                commit_result = subprocess.run(
                    ["git", "commit", "-m", message],
                    cwd=self.local_repo_path,
                    capture_output=True, text=True, timeout=10
                )

                if commit_result.returncode != 0:
                    err = commit_result.stderr.strip() or commit_result.stdout.strip()
                    if "nothing to commit" not in err.lower():
                        self.root.after(0, lambda: (
                            self._set_status("Commit failed"),
                            messagebox.showerror("Commit Failed", err)
                        ))
                        return

                self.root.after(0, lambda: self._set_status("Pushing..."))

                # Step 3: Push with token auth injected into URL
                remote_result = subprocess.run(
                    ["git", "remote", "get-url", "origin"],
                    cwd=self.local_repo_path,
                    capture_output=True, text=True, timeout=5
                )
                remote_url = remote_result.stdout.strip()

                if remote_url.startswith("https://") and self.token and self.token != "demo-token":
                    auth_url = remote_url.replace("https://", f"https://{self.token}@")
                    result = subprocess.run(
                        ["git", "push", auth_url, f"HEAD:{branch}"],
                        cwd=self.local_repo_path,
                        capture_output=True, text=True, timeout=30
                    )
                else:
                    result = subprocess.run(
                        ["git", "push", "-u", "origin", branch],
                        cwd=self.local_repo_path,
                        capture_output=True, text=True, timeout=30
                    )

                if result.returncode == 0:
                    self.root.after(0, lambda: (
                        self._set_status(f"✅ Pushed to '{branch}'!"),
                        messagebox.showinfo("Success", f"Changes pushed to '{branch}'!"),
                        self._refresh_local_status()
                    ))
                else:
                    err = result.stderr.strip()
                    self.root.after(0, lambda: (
                        self._set_status("Push failed"),
                        messagebox.showerror("Push Failed", err)
                    ))
            except Exception as e:
                self.root.after(0, lambda: (
                    self._set_status(f"Error: {e}"),
                    messagebox.showerror("Error", str(e))
                ))

        threading.Thread(target=task, daemon=True).start()

    # ─── Window Setup ─────────────────────────────────────────────
    def _setup_window(self):
        self.root.title("⚡ GitHub Automator")
        self.root.geometry("720x600")
        self.root.minsize(600, 500)
        self.root.configure(bg=BG)
        self.root.resizable(True, True)

        self.root.update_idletasks()
        x = (self.root.winfo_screenwidth() // 2) - 360
        y = (self.root.winfo_screenheight() // 2) - 300
        self.root.geometry(f"+{x}+{y}")

    # ─── UI Builder ───────────────────────────────────────────────
    def _build_ui(self):
        header = tk.Frame(self.root, bg=BG2, pady=12)
        header.pack(fill="x")

        tk.Label(header, text="⚡ GitHub Automator", font=FONT_H,
                 bg=BG2, fg=ACCENT).pack(side="left", padx=16)

        self.lbl_user = tk.Label(header, text="Loading...", font=FONT_S,
                                 bg=BG2, fg=FG)
        self.lbl_user.pack(side="right", padx=16)

        btn_frame = tk.Frame(self.root, bg=BG, pady=10, padx=14)
        btn_frame.pack(fill="x")

        self._btn(btn_frame, "Create Repo", self._create_repo, ACCENT, ACCENT_H).pack(side="left", padx=4)
        self._btn(btn_frame, "Clone Repo", self._clone_repo, "#5a5a8a", "#6a6a9a").pack(side="left", padx=4)
        self._btn(btn_frame, "Refresh", self._load_repos, BG3, "#3c3c3c").pack(side="left", padx=4)
        # Small trash/dustbin button (last)
        def _open_trash():
            messagebox.showinfo("Trash", "Repository trash / deleted items")
        tk.Button(btn_frame, text="🗑", command=_open_trash, bg=BG, fg=FG,
                  relief="flat", cursor="hand2", activebackground=BG3).pack(side="left", padx=6)

        # Repositories header with search
        hdr_frame = tk.Frame(self.root, bg=BG, padx=14)
        hdr_frame.pack(fill="x")
        tk.Label(hdr_frame, text="Repositories", font=FONT_B,
                 bg=BG, fg=FG, anchor="w").pack(side="left")

        search_entry = tk.Entry(hdr_frame, textvariable=self.repo_search_var,
                                font=FONT, bg=BG2, fg=FG, insertbackground=FG,
                                relief="flat", bd=6)
        search_entry.pack(side="right", padx=6)
        # lightweight placeholder handling
        search_entry.insert(0, "🔍 Search repositories...")
        def _on_search_focus_in(e):
            if search_entry.get().startswith("🔍"):
                search_entry.delete(0, "end")
        def _on_search_focus_out(e):
            if not search_entry.get().strip():
                search_entry.insert(0, "🔍 Search repositories...")
        search_entry.bind("<FocusIn>", _on_search_focus_in)
        search_entry.bind("<FocusOut>", _on_search_focus_out)
        # Re-render list on search change
        self.repo_search_var.trace_add("write", lambda *_: self._render_repos(self.repos))

        list_frame = tk.Frame(self.root, bg=BG)
        list_frame.pack(fill="both", expand=True, padx=14, pady=(4, 0))

        self.canvas = tk.Canvas(list_frame, bg=BG, highlightthickness=0)
        scrollbar = ttk.Scrollbar(list_frame, orient="vertical", command=self.canvas.yview)
        self.scroll_frame = tk.Frame(self.canvas, bg=BG)

        self.scroll_frame.bind("<Configure>",
            lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all")))

        self.canvas.create_window((0, 0), window=self.scroll_frame, anchor="nw")
        self.canvas.configure(yscrollcommand=scrollbar.set)

        scrollbar.pack(side="right", fill="y")
        self.canvas.pack(side="left", fill="both", expand=True)

        self.canvas.bind_all("<MouseWheel>",
            lambda e: self.canvas.yview_scroll(int(-1*(e.delta/120)), "units"))

        self.status_var = tk.StringVar(value="Ready")
        status_bar = tk.Frame(self.root, bg=BG2, pady=5)
        status_bar.pack(fill="x", side="bottom")
        self.lbl_status = tk.Label(status_bar, textvariable=self.status_var,
                                   font=FONT_S, bg=BG2, fg=FG, anchor="w")
        self.lbl_status.pack(side="left", padx=12)

    def _btn(self, parent, text, cmd, bg, hover_bg, danger=False):
        b = tk.Button(parent, text=text, command=cmd,
                      bg=bg, fg="white", font=FONT,
                      relief="flat", padx=12, pady=6,
                      cursor="hand2", activebackground=hover_bg,
                      activeforeground="white", bd=0)
        b.bind("<Enter>", lambda e: b.config(bg=hover_bg))
        b.bind("<Leave>", lambda e: b.config(bg=bg))
        return b

    # ─── Data Loaders ─────────────────────────────────────────────
    def _load_user(self):
        def task():
            try:
                user = self.api.get_user()
                name = user.get("name") or user.get("login", "Unknown")
                repos_count = user.get("public_repos", 0)
                self.root.after(0, lambda: self.lbl_user.config(
                    text=f"👤 {name}  |  {repos_count} repos"))
            except Exception as e:
                self.root.after(0, lambda: self.lbl_user.config(text="⚠ Auth error"))
        threading.Thread(target=task, daemon=True).start()

    def _load_repos(self):
        self._set_status("Loading repositories...")
        self._clear_repo_list()
        tk.Label(self.scroll_frame, text="Loading...", font=FONT,
                 bg=BG, fg=FG).pack(pady=20)

        def task():
            try:
                repos = self.api.list_repos(per_page=50)
                self.repos = repos
                self.root.after(0, lambda: self._render_repos(repos))
                self.root.after(0, lambda: self._set_status(f"{len(repos)} repositories loaded."))
            except Exception as e:
                self.root.after(0, lambda: self._set_status(f"Error: {e}"))

        threading.Thread(target=task, daemon=True).start()

    def _render_repos(self, repos):
        self._clear_repo_list()

        if not repos:
            tk.Label(self.scroll_frame, text="No repositories found.",
                     font=FONT, bg=BG, fg=FG).pack(pady=20)
            return

        # Apply search filter if present
        query = (self.repo_search_var.get() or "").strip()
        filtered = repos
        if query and not query.startswith("🔍"):
            q = query.lower()
            filtered = [r for r in repos if q in (r.get("name", "").lower() + " " + (r.get("description") or "").lower())]

        for r in filtered:
            self._repo_card(r)

    def _clear_repo_list(self):
        for widget in self.scroll_frame.winfo_children():
            widget.destroy()

    # ─── NEW: VS Code Open ────────────────────────────────────────
    def _open_in_vscode(self, folder_path: str):
        """Open a folder in VS Code using the 'code' CLI command."""
        try:
            subprocess.Popen(
                ["code", folder_path],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                shell=(os.name == 'nt')  # Windows pe shell=True zaroori hai
            )
            self._set_status(f"📂 Opened in VS Code: {folder_path}")
        except FileNotFoundError:
            messagebox.showwarning(
                "VS Code Not Found",
                f"VS Code automatically open nahi ho saka.\n\n"
                f"Folder yahan hai:\n{folder_path}\n\n"
                f"Fix: VS Code mein Ctrl+Shift+P → 'Shell Command: Install code command in PATH'"
            )
        except Exception as e:
            messagebox.showerror("Error", f"VS Code open karne mein error: {e}")

    # ─── NEW: Smart Open Repo ─────────────────────────────────────
    def _smart_open_repo(self, clone_url: str, repo_name: str):
        """
        Smart open logic:
        1. Pehle check karo kya repo system pe already cloned hai.
        2. Agar mila → seedha VS Code mein open karo (clone mat karo).
        3. Agar nahi mila → folder select karo, clone karo, phir VS Code mein open karo.
        """
        home = os.path.expanduser("~")

        # Common locations jahan repos clone hote hain
        search_dirs = [
            home,
            os.path.join(home, "Desktop"),
            os.path.join(home, "Documents"),
            os.path.join(home, "Projects"),
            os.path.join(home, "repos"),
            os.path.join(home, "code"),
            os.path.join(home, "source"),
            os.path.join(home, "dev"),
            # Windows specific
            os.path.join("C:\\", "Users", os.getlogin() if os.name == 'nt' else "", "source", "repos"),
        ]

        found_path = None

        for base in search_dirs:
            if not os.path.isdir(base):
                continue
            candidate = os.path.join(base, repo_name)
            if os.path.isdir(candidate) and is_git_repo(candidate):
                # Remote URL se verify karo ke same repo hai
                try:
                    result = subprocess.run(
                        ["git", "remote", "get-url", "origin"],
                        cwd=candidate, capture_output=True, text=True, timeout=5
                    )
                    remote = result.stdout.strip()
                    # repo_name URL mein match karo (token-injected URLs bhi handle honge)
                    if repo_name.lower() in remote.lower():
                        found_path = candidate
                        break
                except Exception:
                    pass

        if found_path:
            # ✅ Repo pehle se cloned hai — seedha VS Code mein open karo
            self._set_status(f"✅ Existing clone found: {found_path}")
            messagebox.showinfo(
                "Repo Found!",
                f"'{repo_name}' already cloned hai:\n{found_path}\n\nVS Code mein open ho raha hai..."
            )
            self._open_in_vscode(found_path)
        else:
            # ✅ Clone nahi mila — pehle clone karo, phir VS Code mein open karo
            dest = filedialog.askdirectory(title=f"'{repo_name}' kahan clone karein?")
            if not dest:
                return

            dest_path = os.path.join(dest, repo_name)
            self._set_status(f"Cloning '{repo_name}'...")

            def task():
                try:
                    auth_url = clone_url.replace("https://", f"https://{self.token}@")
                    result = subprocess.run(
                        ["git", "clone", auth_url, dest_path],
                        capture_output=True, text=True, timeout=60
                    )
                    if result.returncode == 0:
                        self.root.after(0, lambda: self._set_status(f"✅ Cloned: {dest_path}"))
                        # Clone complete → VS Code mein open karo
                        self.root.after(0, lambda: self._open_in_vscode(dest_path))
                    else:
                        err = result.stderr.strip()
                        self.root.after(0, lambda: self._set_status("Clone failed."))
                        self.root.after(0, lambda: messagebox.showerror("Clone Failed", err))
                except FileNotFoundError:
                    self.root.after(0, lambda: messagebox.showerror(
                        "Error", "git installed nahi hai ya PATH mein nahi."))
                except Exception as e:
                    self.root.after(0, lambda: messagebox.showerror("Error", str(e)))

            threading.Thread(target=task, daemon=True).start()

    # ─── Repo Card ────────────────────────────────────────────────
    def _repo_card(self, repo):
        name       = repo.get("name", "")
        desc       = repo.get("description") or "No description"
        is_private = repo.get("private", False)
        language   = repo.get("language") or "N/A"
        url        = repo.get("html_url", "")
        clone_url  = repo.get("clone_url", "")
        # Determine if this repo is active (opened locally)
        active = False
        try:
            if self.local_repo_path and os.path.basename(self.local_repo_path) == name:
                active = True
        except Exception:
            active = False

        card = tk.Frame(self.scroll_frame, bg=BG2, pady=8, padx=10,
                        highlightbackground=(ACCENT if active else BORDER), highlightthickness=(2 if active else 1))
        card.pack(fill="x", pady=3, padx=2)

        accent = tk.Frame(card, bg=ACCENT, width=3)
        accent.pack(side="left", fill="y", padx=(0, 10))

        info = tk.Frame(card, bg=BG2)
        info.pack(side="left", fill="both", expand=True)

        name_row = tk.Frame(info, bg=BG2)
        name_row.pack(fill="x")

        tk.Label(name_row, text=name, font=FONT_B, bg=BG2, fg=FG).pack(side="left")
        if active:
            # small green dot + Active label
            tk.Label(name_row, text="●", font=("Segoe UI",8), bg=BG2, fg="#4caf50").pack(side="left", padx=(8,2))
            tk.Label(name_row, text="Active", font=("Segoe UI",8), bg=BG2, fg="#4caf50").pack(side="left", padx=(0,6))
        self._badge(name_row, "🔒 Private" if is_private else "🌐 Public").pack(side="left", padx=4)
        if language != "N/A":
            self._badge(name_row, language).pack(side="left", padx=2)

        tk.Label(info, text=desc, font=FONT_S, bg=BG2, fg="#888888",
                 anchor="w", wraplength=400, justify="left").pack(fill="x")

        actions = tk.Frame(card, bg=BG2)
        actions.pack(side="right", padx=6)

        # ✅ NEW: "📂 Open" button — smart open (existing clone detect kare ya clone karke VS Code mein open kare)
        self._btn(actions, "📂 Open", lambda cu=clone_url, n=name: self._smart_open_repo(cu, n),
                  "#2d7a4f", "#3a9a62").pack(side="left", padx=2)

        # 🌐 GitHub button — browser mein open kare (pehle wala "Open" button)
        self._btn(actions, "🌐 GitHub", lambda u=url: self._open_url(u),
                  BG3, "#3c3c3c").pack(side="left", padx=2)

        # 🗑 Delete button
        self._btn(actions, "Delete", lambda n=name: self._delete_repo(n),
                  DANGER, DANGER_H).pack(side="left", padx=2)

    def _badge(self, parent, text):
        return tk.Label(parent, text=text, font=FONT_S,
                        bg=BG3, fg=FG, padx=5, pady=1)

    # ─── Actions ──────────────────────────────────────────────────
    def _create_repo(self):
        win = tk.Toplevel(self.root)
        win.title("Create Repository")
        win.geometry("450x500")
        win.configure(bg=BG)
        win.resizable(False, False)
        win.grab_set()

        win.update_idletasks()
        x = self.root.winfo_x() + (self.root.winfo_width() // 2) - 225
        y = self.root.winfo_y() + (self.root.winfo_height() // 2) - 250
        win.geometry(f"+{x}+{y}")

        tk.Label(win, text="⚡ Create New Repository", font=FONT_H,
                 bg=BG, fg=ACCENT).pack(pady=(16, 10))

        canvas = tk.Canvas(win, bg=BG, highlightthickness=0)
        scrollbar = ttk.Scrollbar(win, orient="vertical", command=canvas.yview)
        form = tk.Frame(canvas, bg=BG, padx=20, pady=10)

        form.bind("<Configure>",
            lambda e: canvas.configure(scrollregion=canvas.bbox("all")))

        canvas.create_window((0, 0), window=form, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)

        scrollbar.pack(side="right", fill="y")
        canvas.pack(side="left", fill="both", expand=True, padx=10, pady=10)

        tk.Label(form, text="Repository Name *", font=FONT_S, bg=BG, fg=FG).pack(anchor="w")
        name_var = tk.StringVar()
        name_entry = tk.Entry(form, textvariable=name_var, font=FONT,
                              bg=BG2, fg=FG, insertbackground=FG, relief="flat", bd=6)
        name_entry.pack(fill="x", pady=(2, 10))
        name_entry.focus()

        tk.Label(form, text="Description (optional)", font=FONT_S, bg=BG, fg=FG).pack(anchor="w")
        desc_var = tk.StringVar()
        # Description with inline AI icon
        desc_frame = tk.Frame(form, bg=BG)
        desc_frame.pack(fill="x", pady=(2, 10))
        desc_entry = tk.Entry(desc_frame, textvariable=desc_var, font=FONT,
                               bg=BG2, fg=FG, insertbackground=FG, relief="flat", bd=6)
        desc_entry.pack(side="left", fill="x", expand=True)
        def _gen_desc():
            self._inline_generate_repo_description(desc_var, name_var, topics_var)
        ai_desc_btn = tk.Button(desc_frame, text="✨", command=_gen_desc,
                                bg=BG3, fg=FG, relief="flat", width=3, cursor="hand2",
                                activebackground=BG2)
        ai_desc_btn.pack(side="right", padx=(6,0))

        tk.Label(form, text="Topics (comma-separated, optional)", font=FONT_S, bg=BG, fg=FG).pack(anchor="w")
        topics_var = tk.StringVar()
        tk.Entry(form, textvariable=topics_var, font=FONT,
                 bg=BG2, fg=FG, insertbackground=FG, relief="flat", bd=6).pack(fill="x", pady=(2, 10))

        opts_frame = tk.Frame(form, bg=BG)
        opts_frame.pack(fill="x", pady=8)

        private_var = tk.BooleanVar(value=False)
        tk.Checkbutton(opts_frame, text="🔒 Private Repository", variable=private_var,
                       bg=BG, fg=FG, selectcolor=BG2, activebackground=BG,
                       activeforeground=FG, font=FONT).pack(anchor="w", pady=2)

        readme_var = tk.BooleanVar(value=True)
        tk.Checkbutton(opts_frame, text="📝 Initialize with README", variable=readme_var,
                       bg=BG, fg=FG, selectcolor=BG2, activebackground=BG,
                       activeforeground=FG, font=FONT).pack(anchor="w", pady=2)

        gitignore_var = tk.BooleanVar(value=False)
        tk.Checkbutton(opts_frame, text="⊘ Add .gitignore", variable=gitignore_var,
                       bg=BG, fg=FG, selectcolor=BG2, activebackground=BG,
                       activeforeground=FG, font=FONT).pack(anchor="w", pady=2)

        wiki_var = tk.BooleanVar(value=False)
        tk.Checkbutton(opts_frame, text="📖 Enable Wiki", variable=wiki_var,
                       bg=BG, fg=FG, selectcolor=BG2, activebackground=BG,
                       activeforeground=FG, font=FONT).pack(anchor="w", pady=2)

        issues_var = tk.BooleanVar(value=True)
        tk.Checkbutton(opts_frame, text="🐛 Enable Issues", variable=issues_var,
                       bg=BG, fg=FG, selectcolor=BG2, activebackground=BG,
                       activeforeground=FG, font=FONT).pack(anchor="w", pady=2)

        btn_frame = tk.Frame(form, bg=BG)
        btn_frame.pack(fill="x", pady=(12, 0))

        def submit():
            name = name_var.get().strip()
            if not name:
                messagebox.showerror("Error", "Repository name is required!", parent=win)
                return

            win.destroy()
            self._set_status(f"Creating '{name}'...")

            def task():
                try:
                    result = self.api.post("/user/repos", {
                        "name": name,
                        "private": private_var.get(),
                        "description": desc_var.get().strip(),
                        "auto_init": readme_var.get(),
                        "has_wiki": wiki_var.get(),
                        "has_issues": issues_var.get(),
                        "topics": [t.strip() for t in topics_var.get().split(",") if t.strip()]
                    })
                    repo_name = result.get("name")
                    repo_url  = result.get("html_url")
                    self.root.after(0, lambda: self._set_status(f"✅ '{repo_name}' created!"))
                    self.root.after(0, self._load_repos)
                    self.root.after(0, lambda: messagebox.showinfo(
                        "✅ Success", f"Repository '{repo_name}' created!\n\n🔗 {repo_url}"))
                except Exception as e:
                    self.root.after(0, lambda: self._set_status(f"❌ Error: {e}"))
                    self.root.after(0, lambda: messagebox.showerror("❌ Error", str(e)))

            threading.Thread(target=task, daemon=True).start()

        def cancel():
            win.destroy()

        self._btn(btn_frame, "✓ Create", submit,
                  ACCENT, ACCENT_H).pack(side="left", fill="x", expand=True, padx=2)
        self._btn(btn_frame, "✕ Cancel", cancel,
                  BG3, "#3c3c3c").pack(side="left", fill="x", expand=True, padx=2)

    def _delete_repo(self, repo_name):
        confirm = messagebox.askyesno(
            "Confirm Delete",
            f"⚠️ Permanently delete '{repo_name}'?\n\nThis CANNOT be undone!",
            icon="warning"
        )
        if not confirm:
            return

        self._set_status(f"Deleting '{repo_name}'...")

        def task():
            try:
                user = self.api.get_user()
                owner = user.get("login")
                success = self.api.delete_repo(owner, repo_name)
                if success:
                    self.root.after(0, lambda: self._set_status(f"🗑 '{repo_name}' deleted."))
                    self.root.after(0, self._load_repos)
                else:
                    self.root.after(0, lambda: self._set_status("Delete failed."))
                    self.root.after(0, lambda: messagebox.showerror("Error", "Could not delete repository."))
            except Exception as e:
                self.root.after(0, lambda: self._set_status(f"Error: {e}"))
                self.root.after(0, lambda: messagebox.showerror("Error", str(e)))

        threading.Thread(target=task, daemon=True).start()

    def _clone_repo(self):
        if not self.repos:
            messagebox.showinfo("No Repos", "Load repositories first.")
            return

        names = [r.get("name") for r in self.repos]
        win = tk.Toplevel(self.root)
        win.title("Clone Repository")
        win.geometry("400x220")
        win.configure(bg=BG)
        win.resizable(False, False)
        win.grab_set()

        x = self.root.winfo_x() + (self.root.winfo_width() // 2) - 200
        y = self.root.winfo_y() + (self.root.winfo_height() // 2) - 110
        win.geometry(f"+{x}+{y}")

        tk.Label(win, text="Clone Repository", font=FONT_H,
                 bg=BG, fg=ACCENT).pack(pady=(16, 10))

        form = tk.Frame(win, bg=BG, padx=20)
        form.pack(fill="x")

        tk.Label(form, text="Select Repository", font=FONT_S, bg=BG, fg=FG).pack(anchor="w")
        selected = tk.StringVar(value=names[0])
        ttk.Combobox(form, textvariable=selected, values=names,
                     state="readonly", font=FONT).pack(fill="x", pady=(2, 10))

        def pick_and_clone():
            repo_name = selected.get()
            repo = next((r for r in self.repos if r.get("name") == repo_name), None)
            if not repo:
                return
            clone_url = repo.get("clone_url", "")
            win.destroy()
            self._clone_specific(clone_url, repo_name)

        tk.Button(form, text="Select Destination & Clone", command=pick_and_clone,
                  bg=ACCENT, fg="white", font=FONT_B,
                  relief="flat", padx=12, pady=8,
                  cursor="hand2", activebackground=ACCENT_H).pack(fill="x", pady=6)

    def _clone_specific(self, clone_url, repo_name):
        dest = filedialog.askdirectory(title=f"Select folder to clone '{repo_name}' into")
        if not dest:
            return

        dest_path = os.path.join(dest, repo_name)
        self._set_status(f"Cloning '{repo_name}'...")

        def task():
            try:
                auth_url = clone_url.replace("https://", f"https://{self.token}@")
                result = subprocess.run(
                    ["git", "clone", auth_url, dest_path],
                    capture_output=True, text=True, timeout=60
                )
                if result.returncode == 0:
                    self.root.after(0, lambda: self._set_status(f"✅ Cloned to {dest_path}"))
                    self.root.after(0, lambda: messagebox.showinfo(
                        "Cloned!", f"'{repo_name}' cloned to:\n{dest_path}"))
                else:
                    err = result.stderr.strip()
                    self.root.after(0, lambda: self._set_status("Clone failed."))
                    self.root.after(0, lambda: messagebox.showerror("Clone Failed", err))
            except FileNotFoundError:
                self.root.after(0, lambda: messagebox.showerror(
                    "Error", "git is not installed or not in PATH."))
            except Exception as e:
                self.root.after(0, lambda: messagebox.showerror("Error", str(e)))

        threading.Thread(target=task, daemon=True).start()

    def _open_url(self, url):
        import webbrowser
        webbrowser.open(url)

    def _set_status(self, msg):
        self.status_var.set(msg)


# ─── Entry Point ──────────────────────────────────────────────────
if __name__ == "__main__":
    token = ""

    try:
        stdin_data = sys.stdin.read().strip()
        if stdin_data:
            args = json.loads(stdin_data)
            token = args.get("token", "")
    except:
        pass

    root = tk.Tk()
    app = GitHubAutomatorApp(root, token if token else "demo-token")
    root.mainloop()

    try:
        print(json.dumps({"success": True}))
    except:
        pass