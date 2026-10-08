import io
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import app

USER = '00000000-0000-0000-0000-000000000001'
BODY = {'path': USER + '/track-tests/1791430000000-test/source.xrk', 'filename': 'a_0394.xrk'}
HEADERS = {'Authorization': 'Bearer test-session'}


class Response:
    def __init__(self, status, data=None, raw=b''):
        self.status_code = status
        self.data = data
        self.raw = raw
    def json(self):
        return self.data
    def iter_content(self, size):
        return iter([self.raw])
    def __enter__(self):
        return self
    def __exit__(self, *args):
        pass


def setup(monkeypatch):
    monkeypatch.setenv('SUPABASE_URL', 'https://storage.example')
    monkeypatch.setenv('SUPABASE_PUBLISHABLE_KEY', 'publishable-test')
    return TestClient(app)


def test_authentication_required(monkeypatch):
    assert setup(monkeypatch).post('/analyze', json=BODY).status_code == 401


def test_foreign_account_refused(monkeypatch):
    with patch('app.requests.get', return_value=Response(200, {'id': 'another-user'})):
        assert setup(monkeypatch).post('/analyze', json=BODY, headers=HEADERS).status_code == 403


def test_real_file_roundtrip(monkeypatch):
    fixture = Path(__file__).resolve().parents[3] / 'track-test-fixture/a_0394.xrk'
    if not fixture.exists():
        import pytest
        pytest.skip('Personal XRK fixture is not committed.')
    saved = []
    def get(url, **kwargs):
        assert kwargs['headers']['Authorization'] == HEADERS['Authorization']
        if url.endswith('/auth/v1/user'): return Response(200, {'id': USER})
        if url.endswith('report.json'): return Response(404)
        return Response(200, raw=fixture.read_bytes())
    def post(url, **kwargs):
        import json
        saved.append(json.loads(kwargs['data']))
        assert url.endswith('/' + USER + '/track-tests/1791430000000-test/report.json')
        return Response(200)
    with patch('app.requests.get', side_effect=get), patch('app.requests.post', side_effect=post):
        response = setup(monkeypatch).post('/analyze', json=BODY, headers=HEADERS)
    assert response.status_code == 200
    report = response.json()
    assert report == saved[0]
    assert report['summary']['lap_count'] == 0
    assert report['confidence'] == 'low'
    assert len(report['channels']) == 13
    assert 'No valid completed laps' in report['text']
    assert 'Driver versus kart percentages cannot be established' in report['text']


def test_invalid_file_never_yields_report(monkeypatch):
    replies = [Response(200, {'id': USER}), Response(404), Response(200, raw=b'not-an-xrk')]
    with patch('app.requests.get', side_effect=replies), patch('app.requests.post') as saved:
        response = setup(monkeypatch).post('/analyze', json=BODY, headers=HEADERS)
    assert response.status_code == 422
    assert not saved.called
