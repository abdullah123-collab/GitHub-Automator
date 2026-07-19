import sys
import json
import runpy
import io
import urllib.request
import traceback

# Disable proxy auto-detection which causes 20-60 second delays on Windows WPAD
proxy_support = urllib.request.ProxyHandler({})
opener = urllib.request.build_opener(proxy_support)
urllib.request.install_opener(opener)

def main():
    while True:
        try:
            line = sys.stdin.readline()
        except KeyboardInterrupt:
            break
            
        if not line:
            break
            
        line = line.strip()
        if not line:
            continue
            
        try:
            req = json.loads(line)
            req_id = req.get("id")
            script = req.get("scriptName")
            payload = req.get("payload", {})
            
            # Save real stdin/stdout
            original_stdin = sys.stdin
            original_stdout = sys.stdout
            
            # Setup fake stdin/stdout for the script
            payload_str = json.dumps(payload)
            sys.stdin = io.StringIO(payload_str)
            sys.stdin.buffer = io.BytesIO(payload_str.encode('utf-8'))
            fake_stdout = io.StringIO()
            sys.stdout = fake_stdout
            
            try:
                runpy.run_path(script, run_name="__main__")
                output = fake_stdout.getvalue().strip()
                
                # Restore
                sys.stdin = original_stdin
                sys.stdout = original_stdout
                
                # Send result back to Node
                try:
                    parsed_result = json.loads(output)
                    print(json.dumps({"id": req_id, "result": parsed_result}), flush=True)
                except json.JSONDecodeError:
                    print(json.dumps({"id": req_id, "error": f"Invalid JSON returned by script: {output}"}), flush=True)
                    
            except Exception as e:
                # Restore on error
                sys.stdin = original_stdin
                sys.stdout = original_stdout
                
                error_msg = str(e)
                if not error_msg:
                    error_msg = traceback.format_exc()
                print(json.dumps({"id": req_id, "error": error_msg}), flush=True)
                
        except Exception:
            pass

if __name__ == "__main__":
    main()
