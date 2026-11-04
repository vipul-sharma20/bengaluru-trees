"""WSGI application serving the built client and read-only census queries."""
import gzip
import json
import math
import time
from contextlib import closing
from functools import cache
from pathlib import Path
import sqlite3

from flask import Flask, jsonify, request, send_from_directory
from whitenoise import WhiteNoise

ROOT = Path(__file__).parent
DATABASE = ROOT / "data/trees.sqlite"
LIMIT = 2000
QUERY_TIMEOUT = 5
# Native SQLite math avoids a Python callback/GIL acquisition for every tree.
DISTANCE_SQL = """12742000 * asin(min(1, sqrt(
    pow(sin(radians(:lat - t.lat) / 2), 2) +
    cos(radians(t.lat)) * cos(radians(:lat)) *
    pow(sin(radians(:lng - t.lng) / 2), 2))))"""


def query(db, path, params):
    if path == "/api/catalog":
        metadata = json.loads(db.execute("SELECT json FROM metadata").fetchone()[0])
        species = [{"name": name, "count": count} for name, count in db.execute(
            "SELECT species, count(*) FROM trees GROUP BY species ORDER BY species COLLATE NOCASE")]
        return {"metadata": metadata, "species": species}
    if path == "/api/analytics":
        metadata = json.loads(db.execute("SELECT json FROM metadata").fetchone()[0])
        wards = {}
        for ward, species, count in db.execute(
                "SELECT ward, species, count(*) FROM trees GROUP BY ward, species ORDER BY ward, species"):
            wards.setdefault(ward, []).append({"name": species, "count": count})
        return {"metadata": metadata, "wards": [
            {"name": ward, "species": species} for ward, species in wards.items()]}
    if path != "/api/trees":
        raise LookupError("Unknown endpoint")
    try:
        west, south, east, north = map(float, params.get("bbox", [""])[0].split(","))
        if not all(math.isfinite(v) for v in (west, south, east, north)) or not (
                -180 <= west < east <= 180 and -90 <= south < north <= 90):
            raise ValueError
        near = params.get("near", [None])[0]
        if near:
            lat, lng = map(float, near.split(","))
            if not (math.isfinite(lat) and math.isfinite(lng) and -90 <= lat <= 90 and -180 <= lng <= 180):
                raise ValueError
        else:
            lng, lat = (west + east) / 2, (south + north) / 2
    except (ValueError, TypeError):
        raise ValueError("Supply a valid bbox=west,south,east,north and optional near=lat,lng") from None
    where = "s.minx <= :east AND s.maxx >= :west AND s.miny <= :north AND s.maxy >= :south"
    args = dict(east=east, west=west, north=north, south=south, lng=lng, lat=lat, limit=LIMIT)
    species = params.get("species", [""])[0]
    if species:
        where += " AND t.species = :species"
        args["species"] = species
    if near:
        where += f" AND {DISTANCE_SQL} <= 500"
    base = f"FROM spatial s JOIN trees t ON t.id=s.id WHERE {where}"
    total = db.execute(f"SELECT count(*) {base}", args).fetchone()[0]
    rows = db.execute(f"SELECT t.*, {DISTANCE_SQL} AS meters {base} ORDER BY meters,t.id LIMIT :limit", args)
    result = {"total": total, "limit": LIMIT, "trees": [dict(row) for row in rows]}
    if not total and species and params.get("locate", [""])[0] == "1":
        bounds = db.execute(
            "SELECT min(lat), min(lng), max(lat), max(lng) FROM trees WHERE species = ?",
            (species,)).fetchone()
        result["species_bounds"] = [[bounds[0], bounds[1]], [bounds[2], bounds[3]]] if bounds[0] is not None else None
    return result


def create_app(database=DATABASE, dist=ROOT / "dist"):
    app = Flask(__name__, static_folder=None)
    app.json.sort_keys = False
    app.config["MAX_CONTENT_LENGTH"] = 1024

    def run_query(path, params):
        with closing(sqlite3.connect(f"file:{database}?mode=ro", uri=True)) as db:
            db.row_factory = sqlite3.Row
            deadline = time.monotonic() + QUERY_TIMEOUT
            db.set_progress_handler(lambda: time.monotonic() >= deadline, 100000)
            return query(db, path, params)

    @cache
    def catalog():
        # The database is a release artifact. Replacing it requires a worker restart.
        return run_query("/api/catalog", {})

    @cache
    def analytics():
        return run_query("/api/analytics", {})

    @app.get("/analytics")
    def analytics_page():
        return send_from_directory(dist, "analytics.html")

    @app.get("/healthz")
    def health():
        try:
            catalog()
            if not (dist / "index.html").is_file() or not database.is_file():
                raise FileNotFoundError
        except (sqlite3.Error, FileNotFoundError):
            return jsonify(status="unavailable"), 503
        return jsonify(status="ok")

    @app.get("/api/<path:endpoint>")
    def api(endpoint):
        try:
            if endpoint == "catalog":
                result = catalog()
            elif endpoint == "analytics":
                result = analytics()
            else:
                result = run_query(f"/api/{endpoint}", request.args.to_dict(flat=False))
            return jsonify(result)
        except ValueError as error:
            return jsonify(error=str(error)), 400
        except LookupError as error:
            return jsonify(error=str(error)), 404
        except sqlite3.Error:
            return jsonify(error="Census temporarily unavailable. Try again or zoom in."), 503

    @app.after_request
    def response_headers(response):
        # Neither coordinates nor results belong in browser/proxy caches or access logs.
        response.headers["Cache-Control"] = "no-store"
        if response.mimetype == "application/json":
            response.vary.add("Accept-Encoding")
            if request.accept_encodings["gzip"] > 0:
                body = response.get_data()
                if len(body) >= 1024:
                    response.set_data(gzip.compress(body, compresslevel=5, mtime=0))
                    response.headers["Content-Encoding"] = "gzip"
        return response

    app.wsgi_app = WhiteNoise(
        app.wsgi_app, root=str(dist), index_file="index.html", max_age=0,
        immutable_file_test=r"/assets/.+-[\w-]+\.[\w.]+$",
    )
    return app


app = create_app()
