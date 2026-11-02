"""Import the July 2026 OpenCity census into a local spatial index."""
import argparse
import json
from pathlib import Path
import sqlite3
import urllib.request
import zipfile

RESOURCE = "368572d6-e3dc-4088-acd8-a243c440ebea"
SOURCE = f"https://data.opencity.in/dataset/bengaluru-tree-census-data/resource/{RESOURCE}"
API = f"https://data.opencity.in/api/3/action/resource_show?id={RESOURCE}"
DATA = Path(__file__).parent / "data"


def import_census(archive, database):
    with zipfile.ZipFile(archive) as z:
        name = next(n for n in z.namelist() if n.endswith(".geojson"))
        features = json.load(z.open(name))["features"]
    database = Path(database)
    temporary = database.with_suffix(".tmp")
    temporary.unlink(missing_ok=True)
    with sqlite3.connect(temporary) as db:
        db.executescript("""
            CREATE TABLE trees (id INTEGER PRIMARY KEY, tree_id TEXT, species TEXT,
                ward TEXT, lng REAL, lat REAL);
            CREATE VIRTUAL TABLE spatial USING rtree(id, minx, maxx, miny, maxy);
            CREATE INDEX species_idx ON trees(species);
            CREATE TABLE metadata (json TEXT);
        """)
        excluded = 0
        for f in features:
            p = f["properties"]
            # Preserve duplicate source IDs as separate records. Only known test data is excluded.
            if "loadtesting" in str(p["KGISTreeID"]).lower():
                excluded += 1
                continue
            lng, lat = f["geometry"]["coordinates"][:2]
            name = " ".join(p["TreeName"].split())
            row = db.execute("INSERT INTO trees VALUES (?, ?, ?, ?, ?, ?)",
                             (p["OBJECTID"], p["KGISTreeID"], name, p["WardNumber"], lng, lat))
            db.execute("INSERT INTO spatial VALUES (?, ?, ?, ?, ?)",
                       (row.lastrowid, lng, lng, lat, lat))
        metadata = {"release": "July 2026", "source": SOURCE, "raw_count": len(features),
                    "excluded": excluded, "count": len(features) - excluded}
        db.execute("INSERT INTO metadata VALUES (?)", (json.dumps(metadata),))
    temporary.replace(database)
    return metadata


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, help="Use a previously downloaded ZIP")
    args = parser.parse_args()
    DATA.mkdir(exist_ok=True)
    archive = args.archive or DATA / "census-july-2026.zip"
    if not archive.exists():
        with urllib.request.urlopen(API, timeout=60) as response:
            resource = json.load(response)["result"]
        print("Downloading", resource["name"], flush=True)
        urllib.request.urlretrieve(resource["url"], archive)
    print(json.dumps(import_census(archive, DATA / "trees.sqlite"), indent=2))
