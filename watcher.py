r"""Simulate CCTV frame ingestion for the Drishti hackathon demo.

Usage:
  .\.venv\Scripts\python.exe watcher.py --source "D:\sample_frames" --interval 2

The script copies images one-by-one into data/incoming_frames and asks the local
Drishti server to scan the folder. The Node backend then auto-processes queued
frames and creates evidence records without manual upload clicks.
"""
from __future__ import annotations

import argparse
import shutil
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
INCOMING = ROOT / "data" / "incoming_frames"
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def ping_scan(server: str) -> None:
    req = urllib.request.Request(f"{server.rstrip('/')}/api/ingestion/scan", data=b"{}", method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            print(f"[watcher] scan acknowledged: HTTP {res.status}")
    except Exception as exc:
        print(f"[watcher] server scan failed: {exc}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Drishti CCTV ingestion simulator")
    parser.add_argument("--source", default=str(ROOT / "data" / "demo_frames"), help="Folder containing sample CCTV images")
    parser.add_argument("--interval", type=float, default=2.0, help="Seconds between frame arrivals")
    parser.add_argument("--server", default="http://localhost:3000", help="Drishti server URL")
    parser.add_argument("--loop", action="store_true", help="Keep replaying the source folder")
    args = parser.parse_args()

    source = Path(args.source).expanduser().resolve()
    if not source.exists():
        raise SystemExit(f"Source folder not found: {source}")

    images = sorted(p for p in source.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTS)
    if not images:
        raise SystemExit(f"No JPG/PNG/WEBP images found in: {source}")

    INCOMING.mkdir(parents=True, exist_ok=True)
    print(f"[watcher] replaying {len(images)} frame(s) from {source}")
    print(f"[watcher] dropping into {INCOMING}")

    round_no = 1
    while True:
        for idx, src in enumerate(images, start=1):
            stamp = time.strftime("%Y%m%d-%H%M%S")
            dst = INCOMING / f"CAM04-{stamp}-R{round_no:02d}-{idx:03d}{src.suffix.lower()}"
            shutil.copy2(src, dst)
            print(f"[watcher] new frame: {dst.name}")
            ping_scan(args.server)
            time.sleep(args.interval)
        if not args.loop:
            break
        round_no += 1

    print("[watcher] done. The dashboard Live Ingestion tab will continue showing processing status.")


if __name__ == "__main__":
    main()
