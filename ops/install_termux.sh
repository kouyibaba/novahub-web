#!/data/data/com.termux/files/usr/bin/bash
# Run from a complete checkout on the tablet. Does not restart any service.
set -euo pipefail
source_dir="$(cd -- "$(dirname -- "$0")/.." && pwd)"
target_dir="$HOME/novahub"
mkdir -p "$target_dir/novel_engine"
if [ "$source_dir" != "$target_dir" ]; then
  for name in server.py db.py safe_http.py source_probe.py sources.json backup_db.py admin_cli.py index.html admin.html app.js style.css manifest.json icon.svg; do
    cp -- "$source_dir/$name" "$target_dir/$name"
  done
fi
for name in auto_tunnel.py watchdog.py; do
  cp -- "$source_dir/ops/$name" "$target_dir/$name"
done
if [ ! -f "$target_dir/novel_engine/config.yml" ]; then
  cp -- "$source_dir/novel_engine/config.yml" "$target_dir/novel_engine/config.yml"
fi
echo "Code installed. Existing database, keys and tunnel state preserved."
echo "Restart the backend/watchdog using the documented exact PID procedure."
