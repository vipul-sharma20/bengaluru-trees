"""Bounded production workers; TLS and routing remain with Traefik."""
import os

bind = f"0.0.0.0:{int(os.environ.get('PORT', '3000'))}"
workers = 2
worker_class = "gthread"
threads = 2
worker_connections = 16
backlog = 64
timeout = 30
graceful_timeout = 30
keepalive = 2
max_requests = 10000
max_requests_jitter = 1000
# Docker's shared-memory mount stays writable with a read-only root filesystem.
worker_tmp_dir = "/dev/shm"
control_socket_disable = True
accesslog = None
errorlog = "-"
# No app code needs client IP/scheme; do not trust arbitrary forwarded headers.
forwarded_allow_ips = ""


def on_starting(server):
    from contextlib import closing
    import sqlite3
    from server import DATABASE, ROOT

    if not DATABASE.is_file() or not (ROOT / "dist/index.html").is_file():
        raise RuntimeError("First prepare data/trees.sqlite and run npm run build")
    with closing(sqlite3.connect(f"file:{DATABASE}?mode=ro", uri=True)) as db:
        db.execute("SELECT asin(sqrt(pow(sin(radians(1)), 2)))").fetchone()
        db.execute("SELECT json FROM metadata").fetchone()
