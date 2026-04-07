#!/usr/bin/env python3
"""
Quick test script to verify the GUI works
Run: python test_gui.py
"""
import sys
sys.path.insert(0, 'python-backend')

import tkinter as tk
from python_backend.gui import GitHubAutomatorApp

if __name__ == "__main__":
    print("Starting GitHub Automator...")
    root = tk.Tk()
    
    try:
        app = GitHubAutomatorApp(root, "test-token")
        print("✅ GUI initialized successfully")
        print("You should see a window with two buttons:")
        print("  1. 🌐 Manage GitHub Repositories")
        print("  2. 💻 Work with Local Repository")
        print("\nClosing window in 3 seconds...")
        root.after(3000, root.quit)
        root.mainloop()
        print("✅ GUI test completed successfully!")
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
