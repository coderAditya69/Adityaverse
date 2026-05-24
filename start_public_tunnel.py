from __future__ import annotations

import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
TOOLS_DIR = BASE_DIR / "tools"
LOGS_DIR = BASE_DIR / "logs"
PUBLIC_URL_FILE = LOGS_DIR / "public_url.txt"
PUBLIC_APK_URL_FILE = LOGS_DIR / "public_apk_url.txt"
SERVER_LOG = LOGS_DIR / "server.log"
SERVER_ERR_LOG = LOGS_DIR / "server.err.log"
TUNNEL_LOG = LOGS_DIR / "cloudflared.log"

PORT = 8000
CLOUDFLARED_PATH = TOOLS_DIR / "cloudflared.exe"
URL_PATTERN = re.compile(r"https://[-a-z0-9.]*trycloudflare\.com")


def bootstrap_available() -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/bootstrap", timeout=5):
            return True
    except Exception:
        return False


def wait_for_local_server() -> None:
    for _ in range(30):
        if bootstrap_available():
            return
        time.sleep(1)
    raise RuntimeError(f"Local app did not start on port {PORT}.")


def start_server_if_needed() -> bool:
    if bootstrap_available():
        return False

    with SERVER_LOG.open("w", encoding="utf-8") as stdout_handle, SERVER_ERR_LOG.open(
        "w", encoding="utf-8"
    ) as stderr_handle:
        subprocess.Popen(
            [sys.executable, "app.py", "--host", "0.0.0.0", "--port", str(PORT), "--no-browser"],
            cwd=BASE_DIR,
            stdout=stdout_handle,
            stderr=stderr_handle,
            text=True,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS,
        )

    wait_for_local_server()
    return True


def start_tunnel() -> subprocess.Popen[str]:
    with TUNNEL_LOG.open("w", encoding="utf-8") as stdout_handle:
        process = subprocess.Popen(
            [
                str(CLOUDFLARED_PATH),
                "tunnel",
                "--url",
                f"http://127.0.0.1:{PORT}",
                "--no-autoupdate",
            ],
            cwd=BASE_DIR,
            stdout=stdout_handle,
            stderr=subprocess.STDOUT,
            text=True,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS,
        )
    return process


def wait_for_public_url() -> str:
    for _ in range(90):
        if TUNNEL_LOG.exists():
            text = TUNNEL_LOG.read_text(encoding="utf-8", errors="replace")
            match = URL_PATTERN.search(text)
            if match:
                return match.group(0)
        time.sleep(1)
    raise RuntimeError("Cloudflare tunnel started but no public URL was detected.")


def main() -> None:
    LOGS_DIR.mkdir(exist_ok=True)
    if not CLOUDFLARED_PATH.exists():
        raise RuntimeError(f"cloudflared.exe was not found at {CLOUDFLARED_PATH}")

    for path in [PUBLIC_URL_FILE, PUBLIC_APK_URL_FILE, TUNNEL_LOG]:
        if path.exists():
            path.unlink()

    server_started = start_server_if_needed()
    tunnel_process = start_tunnel()
    public_url = wait_for_public_url()
    apk_url = f"{public_url}/downloads/MoleculeBuilder-android.apk"
    PUBLIC_URL_FILE.write_text(public_url, encoding="utf-8")
    PUBLIC_APK_URL_FILE.write_text(apk_url, encoding="utf-8")

    print(f"Local server started by helper: {server_started}")
    print(f"Tunnel process id: {tunnel_process.pid}")
    print(f"Public URL: {public_url}")
    print(f"Saved URL to: {PUBLIC_URL_FILE}")
    print(f"APK URL: {apk_url}")
    print(f"Saved APK URL to: {PUBLIC_APK_URL_FILE}")


if __name__ == "__main__":
    main()
