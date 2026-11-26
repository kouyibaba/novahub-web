"""SQLite online backup, integrity check and retention; no service downtime."""
import argparse
import contextlib
import datetime
import os
from pathlib import Path
import sqlite3
import threading
import time


def backup_database(source, output_dir, keep=14):
    source = Path(source).resolve(strict=True)
    output_dir = Path(output_dir).resolve()
    if keep < 1:
        raise ValueError("keep must be at least 1")
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S")
    destination = output_dir / f"novahub-{stamp}-{time.time_ns()}.db"
    temporary = destination.with_suffix(".tmp")
    try:
        with contextlib.closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True, timeout=30)) as live:
            with contextlib.closing(sqlite3.connect(temporary)) as saved:
                live.backup(saved, pages=256, sleep=0.05)
                if saved.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                    raise RuntimeError("Backup integrity check failed")
        os.chmod(temporary, 0o600)
        os.replace(temporary, destination)
    finally:
        if temporary.exists():
            temporary.unlink()
    # Prune only our own verified backup naming scheme, after a new backup exists.
    backups = sorted(output_dir.glob("novahub-????????T??????-*.db"),
                     key=lambda p: p.name, reverse=True)
    for old in backups[keep:]:
        if old.resolve() != source and not old.is_symlink():
            old.unlink()
    return destination


def start_scheduler(source, output_dir, keep=14):
    def run():
        while True:
            try:
                recent = sorted(Path(output_dir).glob("novahub-????????T??????-*.db"),
                                key=lambda p: p.stat().st_mtime, reverse=True)
                if not recent or time.time() - recent[0].stat().st_mtime >= 86400:
                    backup_database(source, output_dir, keep)
                    print("[Backup] SQLite online backup verified", flush=True)
            except Exception as exc:
                print(f"[Backup] Failed: {type(exc).__name__}; retry in one hour", flush=True)
            time.sleep(3600)
    threading.Thread(target=run, name="sqlite-backup", daemon=True).start()


if __name__ == "__main__":
    import db
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default=db.DB_PATH)
    parser.add_argument("--output-dir", default=os.environ.get("NOVAHUB_BACKUP_DIR", str(Path(db.DB_PATH).parent / "backups")))
    parser.add_argument("--keep", type=int, default=14)
    args = parser.parse_args()
    print(backup_database(args.source, args.output_dir, args.keep))
