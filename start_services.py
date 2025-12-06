"""
Start both the FastAPI backend and Next.js frontend for local development.

Usage:
    python start_services.py

Requirements:
- Backend Python deps installed (`pip install -r backend/requirements.txt`)
- Frontend deps installed (`npm install`)
"""

import os
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def start_process(cmd: list[str], cwd: Path, name: str) -> subprocess.Popen:
    env = os.environ.copy()
    if name == "frontend" and "NEXT_PUBLIC_API_URL" not in env:
        env["NEXT_PUBLIC_API_URL"] = "http://localhost:8000/api"
    print(f"[runner] starting {name}: {' '.join(cmd)} (cwd={cwd})", flush=True)
    return subprocess.Popen(
        cmd,
        cwd=str(cwd),
        env=env,
        stdout=sys.stdout,
        stderr=sys.stderr,
    )


def main() -> int:
    processes: list[tuple[str, subprocess.Popen]] = []
    try:
        backend_cmd = [
            sys.executable,
            "-m",
            "uvicorn",
            "backend.main:app",
            "--reload",
            "--host",
            "0.0.0.0",
            "--port",
            "8000",
        ]
        frontend_cmd = ["npm", "run", "dev", "--", "--port", "3000"]

        processes.append(("backend", start_process(backend_cmd, ROOT, "backend")))
        processes.append(("frontend", start_process(frontend_cmd, ROOT, "frontend")))

        print("\n[runner] services running. Press Ctrl+C to stop.")

        while True:
            time.sleep(1)
            for name, proc in processes:
                ret = proc.poll()
                if ret is not None:
                    print(f"[runner] {name} exited with code {ret}", flush=True)
                    return ret or 0
    except KeyboardInterrupt:
        print("\n[runner] received interrupt, stopping...", flush=True)
    finally:
        for name, proc in processes:
            if proc.poll() is None:
                print(f"[runner] terminating {name}...", flush=True)
                proc.terminate()
        time.sleep(2)
        for name, proc in processes:
            if proc.poll() is None:
                print(f"[runner] killing {name}...", flush=True)
                proc.kill()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
