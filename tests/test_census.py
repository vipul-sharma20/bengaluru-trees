import gzip
import json
import math
from pathlib import Path
import sqlite3
import tempfile
import unittest
import zipfile

from import_data import import_census
from server import create_app, query


class CensusTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        path = Path(self.temp.name)
        features = []
        # Asymmetric locations distinguish bounding-box, radial and species filters.
        for i, (species, tree_id, lng, lat) in enumerate([
            ('Neem', 'duplicate', 77.600, 13.000),
            ('Neem', 'duplicate', 77.601, 13.000),
            ('Mango', 'mango', 77.604, 13.004),
            ('Mango', 'far', 77.610, 13.000),
            (' Neem  ', 'spaced', 77.602, 13.000),
            ('Neem', 'loadtesting1', 77.600, 13.000),
        ], 1):
            features.append({'geometry': {'type': 'Point', 'coordinates': [lng, lat]},
                             'properties': {'OBJECTID': i, 'TreeName': species,
                                            'KGISTreeID': tree_id, 'WardNumber': '8'}})
        archive = path / 'source.zip'
        with zipfile.ZipFile(archive, 'w') as z:
            z.writestr('trees.geojson', json.dumps({'features': features}))
        database = path / 'trees.sqlite'
        import_census(archive, database)
        self.db = sqlite3.connect(database)
        self.db.row_factory = sqlite3.Row
        self.addCleanup(self.db.close)
        self.database = database
        self.dist = path / 'dist'
        (self.dist / 'assets').mkdir(parents=True)
        (self.dist / 'index.html').write_text('<h1>Trees</h1>')
        (self.dist / 'analytics.html').write_text('<h1>Analytics</h1>')
        self.asset = b'console.log("trees");' * 100
        (self.dist / 'assets/index-test123.js').write_bytes(self.asset)
        (self.dist / 'assets/index-test123.js.gz').write_bytes(gzip.compress(self.asset))

    def test_import_and_species_catalog(self):
        result = query(self.db, '/api/catalog', {})
        self.assertEqual(result['metadata']['count'], 5)
        self.assertEqual(result['metadata']['excluded'], 1)
        self.assertEqual(result['species'], [{'name': 'Mango', 'count': 2}, {'name': 'Neem', 'count': 3}])

    def test_analytics_groups_full_census_by_ward_and_species(self):
        self.db.executemany('INSERT INTO trees VALUES (?,?,?,?,?,?)', [
            (i, 'duplicate', 'Others', '9', 77.6, 13) for i in range(10, 2021)])
        self.db.execute('INSERT INTO trees VALUES (?,?,?,?,?,?)',
                        (2021, 'another', 'Neem', '9', 77.6, 13))
        self.db.commit()
        response = create_app(self.database, self.dist).test_client().get('/api/analytics')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertEqual(response.json['metadata']['release'], 'July 2026')
        self.assertEqual(response.json['wards'], [
            {'name': '8', 'species': [{'name': 'Mango', 'count': 2}, {'name': 'Neem', 'count': 3}]},
            {'name': '9', 'species': [{'name': 'Neem', 'count': 1}, {'name': 'Others', 'count': 2011}]},
        ])
        empty = Path(self.temp.name) / 'empty.sqlite'
        with zipfile.ZipFile(Path(self.temp.name) / 'empty.zip', 'w') as archive:
            archive.writestr('empty.geojson', '{"features": []}')
        import_census(Path(self.temp.name) / 'empty.zip', empty)
        result = create_app(empty, self.dist).test_client().get('/api/analytics')
        self.assertEqual(result.json['wards'], [])

    def test_bbox_species_order_and_duplicate_ids(self):
        result = query(self.db, '/api/trees', {'bbox': ['77.599,12.999,77.6035,13.001'], 'species': ['Neem']})
        self.assertEqual(result['total'], 3)
        self.assertEqual([t['id'] for t in result['trees']], [2, 5, 1])
        self.assertEqual(sum(t['tree_id'] == 'duplicate' for t in result['trees']), 2)

    def test_species_search_locates_only_when_local_results_are_empty(self):
        client = create_app(self.database, self.dist).test_client()
        local = '/api/trees?bbox=77.599,12.999,77.6035,13.001'
        found = client.get(local + '&species=Neem&locate=1').json
        self.assertEqual(found['total'], 3)
        self.assertNotIn('species_bounds', found)
        elsewhere = client.get(local + '&species=Mango&locate=1').json
        self.assertEqual(elsewhere['trees'], [])
        self.assertEqual(elsewhere['species_bounds'], [[13.0, 77.604], [13.004, 77.610]])
        # Manual map exploration must not jump back to the species automatically.
        self.assertNotIn('species_bounds', client.get(local + '&species=Mango').json)
        self.assertNotIn('species_bounds', client.get(local + '&locate=1').json)
        missing = client.get(local + '&species=Absent&locate=1').json
        self.assertEqual(missing['total'], 0)
        self.assertIsNone(missing['species_bounds'])
        # A species beyond the 500 m circle can still be found, even inside the bbox.
        nearby = client.get('/api/trees?bbox=77.59,12.99,77.62,13.01'
                            '&near=13,77.6&species=Mango&locate=1').json
        self.assertEqual(nearby['total'], 0)
        self.assertEqual(nearby['species_bounds'], elsewhere['species_bounds'])

    def test_nearby_uses_circle_not_just_bbox(self):
        result = query(self.db, '/api/trees', {'bbox': ['77.59,12.99,77.62,13.01'], 'near': ['13,77.6']})
        self.assertEqual([t['id'] for t in result['trees']], [1, 2, 5])
        self.assertAlmostEqual(result['trees'][1]['meters'], 108.34, delta=0.1)
        empty = query(self.db, '/api/trees', {'bbox': ['77.59,12.99,77.62,13.01'],
                                           'near': ['13,77.6'], 'species': ['Mango']})
        self.assertEqual(empty['total'], 0)

    def test_limit_is_explicit_and_preserves_total(self):
        self.db.executemany('INSERT INTO trees VALUES (?,?,?,?,?,?)',
                            [(i, str(i), 'Many', '8', 77.6, 13) for i in range(10, 2020)])
        self.db.executemany('INSERT INTO spatial VALUES (?,?,?,?,?)',
                            [(i, 77.6, 77.6, 13, 13) for i in range(10, 2020)])
        result = query(self.db, '/api/trees', {'bbox': ['77.59,12.99,77.62,13.01'], 'species': ['Many']})
        self.assertEqual(result['total'], 2010)
        self.assertEqual(result['limit'], 2000)
        self.assertEqual(len(result['trees']), 2000)
        self.assertEqual([t['id'] for t in result['trees']], list(range(10, 2010)))
        self.db.commit()
        client = create_app(self.database, self.dist).test_client()
        url = '/api/trees?bbox=77.59,12.99,77.62,13.01&species=Many'
        compressed = client.get(url, headers={'Accept-Encoding': 'gzip'})
        self.assertEqual(compressed.headers['Content-Encoding'], 'gzip')
        self.assertEqual(json.loads(gzip.decompress(compressed.data)), result)
        head = client.head(url, headers={'Accept-Encoding': 'gzip'})
        self.assertEqual(head.data, b'')
        self.assertEqual(head.headers['Content-Encoding'], 'gzip')
        self.assertEqual(head.headers['Content-Length'], compressed.headers['Content-Length'])
        # The full species extent must include points beyond the display limit.
        self.db.execute('UPDATE trees SET lat=13.02, lng=77.64 WHERE id=2019')
        self.db.execute('UPDATE spatial SET minx=77.64, maxx=77.64, miny=13.02, maxy=13.02 WHERE id=2019')
        self.db.commit()
        located = client.get('/api/trees?bbox=77.7,13.1,77.8,13.2&species=Many&locate=1').json
        self.assertEqual(located['species_bounds'], [[13, 77.6], [13.02, 77.64]])

    def test_nearby_radius_boundary(self):
        # Due north on a 6,371km sphere: one point on either side of 500m.
        for i, meters in [(10, 499.9), (11, 500.1)]:
            lat = 13 + math.degrees(meters / 6371000)
            self.db.execute('INSERT INTO trees VALUES (?,?,?,?,?,?)', (i, str(i), 'Boundary', '8', 77.6, lat))
            self.db.execute('INSERT INTO spatial VALUES (?,?,?,?,?)', (i, 77.6, 77.6, lat, lat))
        result = query(self.db, '/api/trees', {'bbox': ['77.59,12.99,77.62,13.01'],
                                           'near': ['13,77.6'], 'species': ['Boundary']})
        self.assertEqual(result['total'], 1)
        self.assertEqual([t['id'] for t in result['trees']], [10])
        self.assertAlmostEqual(result['trees'][0]['meters'], 499.9, places=5)

    def test_http_api_contract_and_private_responses(self):
        client = create_app(self.database, self.dist).test_client()
        self.assertEqual(client.get('/healthz').json, {'status': 'ok'})
        self.assertEqual(client.get('/api/catalog').json['metadata']['count'], 5)
        url = '/api/trees?bbox=77.59,12.99,77.62,13.01&near=13,77.6&species=Neem'
        result = client.get(url)
        self.assertEqual([t['id'] for t in result.json['trees']], [1, 2, 5])
        self.assertEqual(result.headers['Cache-Control'], 'no-store')
        for url, status in [('/api/trees?bbox=nan,12,78,14', 400), ('/api/missing', 404)]:
            response = client.get(url)
            self.assertEqual(response.status_code, status)
            self.assertIn('error', response.json)
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertEqual(client.head('/api/catalog').data, b'')
        self.database.unlink()
        self.assertEqual(client.get('/healthz').status_code, 503)
        self.assertEqual(client.get('/api/trees?bbox=77,12,78,14').status_code, 503)

    def test_http_static_compression_caching_and_isolation(self):
        client = create_app(self.database, self.dist).test_client()
        index = client.get('/')
        self.addCleanup(index.close)
        self.assertEqual(index.status_code, 200)
        self.assertIn('max-age=0', index.headers['Cache-Control'])
        for path in ['/analytics', '/analytics.html']:
            response = client.get(path)
            self.addCleanup(response.close)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.mimetype, 'text/html')
            self.assertEqual(response.data, b'<h1>Analytics</h1>')
        with client.head('/analytics') as response:
            self.assertEqual(response.data, b'')
        url = '/assets/index-test123.js'
        plain = client.get(url)
        compressed = client.get(url, headers={'Accept-Encoding': 'gzip'})
        self.addCleanup(plain.close)
        self.addCleanup(compressed.close)
        self.assertEqual(plain.data, self.asset)
        self.assertEqual(compressed.headers['Content-Encoding'], 'gzip')
        self.assertEqual(gzip.decompress(compressed.data), self.asset)
        self.assertIn('javascript', compressed.content_type)
        self.assertIn('immutable', compressed.headers['Cache-Control'])
        self.assertIn('Accept-Encoding', compressed.headers['Vary'])
        self.assertEqual(client.get(url, headers={'If-None-Match': plain.headers['ETag']}).status_code, 304)
        self.assertEqual(client.head(url).data, b'')
        self.assertEqual(client.get('/server.py').status_code, 404)
        self.assertEqual(client.get('/data/trees.sqlite').status_code, 404)
        self.assertEqual(client.get('/../trees.sqlite').status_code, 404)

    def test_invalid_queries_are_rejected(self):
        for bbox in ['', 'nan,12,78,14', '78,12,77,14', '77,14,78,12']:
            with self.subTest(bbox=bbox), self.assertRaises(ValueError):
                query(self.db, '/api/trees', {'bbox': [bbox]})
        with self.assertRaises(ValueError):
            query(self.db, '/api/trees', {'bbox': ['77,12,78,14'], 'near': ['nan,77']})


if __name__ == '__main__':
    unittest.main()
