#!/usr/bin/env python3
"""Minimal test of the GitHub Automator GUI"""

import tkinter as tk

# Test basic Tkinter setup
print("✅ Testing Tkinter...")
root = tk.Tk()
root.title("Test")
root.geometry("400x200")
root.configure(bg="#1e1e1e")

label = tk.Label(root, text="✅ Tkinter works!", bg="#1e1e1e", fg="#d4d4d4", font=("Segoe UI", 14, "bold"))
label.pack(pady=30)

button1 = tk.Button(root, text="Button 1", bg="#0078d4", fg="white", font=("Segoe UI", 10), relief="flat", padx=20, pady=10, cursor="hand2")
button1.pack(pady=10)

button2 = tk.Button(root, text="Button 2", bg="#4caf50", fg="white", font=("Segoe UI", 10), relief="flat", padx=20, pady=10, cursor="hand2")
button2.pack(pady=10)

print("✅ Window created successfully")
print("   - You should see a dark window")
print("   - With a label and 2 buttons")
print("\nClosing test window...")
root.after(2000, root.quit)
root.mainloop()

print("✅ Tkinter test passed!")
print("\nNow try running: python gui.py")
