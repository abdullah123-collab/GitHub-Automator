import time
import subprocess
import os

env = dict(os.environ, PYTHONPATH=r'i:\Abdullah\GitHub-Automator\backend')
for i in range(5):
    t0 = time.time()
    try:
        subprocess.run(
            ['python', r'backend\managers\repo_manager.py'],
            input='{"action":"list","token":"fake"}',
            text=True,
            capture_output=True,
            cwd=r'i:\Abdullah\GitHub-Automator',
            env=env
        )
    except Exception as e:
        print(e)
    t1 = time.time()
    print(f'Run {i+1}: {t1-t0:.2f} seconds')
