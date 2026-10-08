import json
import os
import re
import tempfile
from urllib.parse import quote
import requests
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from analysis import analyze

app = FastAPI()
MAX_BYTES = 20 * 1024 * 1024


class Intake(BaseModel):
    path: str = Field(max_length=200)
    filename: str = Field(max_length=200)


@app.get('/health')
def health():
    return {'ok': True, 'service': 'Rivali track analysis', 'reportSchema': 1}


@app.post('/analyze')
def analyze_uploaded_file(body: Intake, authorization: str = Header(default='')):
    if not authorization.startswith('Bearer '):
        raise HTTPException(401, 'Sign in to Rivali before analyzing a run.')
    base = os.environ['SUPABASE_URL'].rstrip('/')
    headers = {'apikey': os.environ['SUPABASE_PUBLISHABLE_KEY'], 'Authorization': authorization}
    auth = requests.get(base + '/auth/v1/user', headers=headers, timeout=20)
    if auth.status_code != 200:
        raise HTTPException(401, 'Your Rivali session expired. Sign in again.')
    user_id = auth.json()['id']
    if not re.fullmatch(re.escape(user_id) + r'/track-tests/[a-zA-Z0-9-]{10,64}/source\.xrk', body.path):
        raise HTTPException(403, 'Choose a run uploaded by this Rivali account.')
    if not body.filename.lower().endswith('.xrk'):
        raise HTTPException(400, 'Choose a MyChron .xrk file.')
    prefix = body.path.rsplit('/', 1)[0]
    report_path = prefix + '/report.json'
    cached = requests.get(base + '/storage/v1/object/telemetry/' + quote(report_path, safe='/'), headers=headers, timeout=20)
    if cached.status_code == 200:
        return cached.json()
    try:
        with requests.get(base + '/storage/v1/object/telemetry/' + quote(body.path, safe='/'), headers=headers, timeout=(20, 120), stream=True) as source:
            if source.status_code != 200:
                raise HTTPException(404, 'The uploaded XRK file could not be found.')
            with tempfile.NamedTemporaryFile(suffix='.xrk') as file:
                size = 0
                for block in source.iter_content(1024 * 1024):
                    size += len(block)
                    if size > MAX_BYTES:
                        raise HTTPException(413, 'Track testing supports files up to 20 MB.')
                    file.write(block)
                if size == 0:
                    raise HTTPException(400, 'This XRK file is empty.')
                file.flush()
                report = analyze(file.name, body.filename)
        saved = requests.post(base + '/storage/v1/object/telemetry/' + quote(report_path, safe='/'),
                              headers={**headers, 'Content-Type': 'application/json', 'x-upsert': 'true'},
                              data=json.dumps(report, allow_nan=False), timeout=30)
        if saved.status_code not in (200, 201):
            raise HTTPException(502, 'Analysis finished, but the report could not be saved. Please retry.')
        return report
    except HTTPException:
        raise
    except requests.RequestException:
        raise HTTPException(502, 'Storage connection interrupted. Your uploaded run is saved; retry analysis.')
    except Exception as error:
        print('XRK analysis failed:', type(error).__name__, flush=True)
        raise HTTPException(422, 'Rivali could not read this XRK file. Keep the original and try a fresh RS3 download. No report was invented.')
