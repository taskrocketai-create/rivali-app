"""Extract a cautious GPS lap trace from AiM session data.

Never claim a fastest lap where the AiM lap table is absent/invalid or GPS
boundaries cannot be established. Coordinates are [latitude, longitude].
"""
import math

def _values(series):
    try:
        return series.pint.magnitude
    except (AttributeError, TypeError):
        return series

def extract_fastest_lap(header, data):
    columns = {str(name).strip().lower(): name for name in data.columns}
    def channel(*names):
        for name in names:
            if name in columns:
                return columns[name]
        return None
    lat_col = channel('gps latitude','gps lat','latitude')
    lon_col = channel('gps longitude','gps long','gps lon','longitude')
    if lat_col is None or lon_col is None:
        return {'status':'unavailable','reason':'XRK contains no GPS latitude/longitude channels.'}
    raw=[]
    for t, lat, lon in zip(data.index, _values(data[lat_col]), _values(data[lon_col])):
        try:
            t,lat,lon = float(t),float(lat),float(lon)
            if all(math.isfinite(x) for x in (t,lat,lon)) and 34 <= lat <= 37 and -80 <= lon <= -76:
                if not raw or t>raw[-1][0]:
                    raw.append((t,lat,lon))
        except (ValueError,TypeError):
            continue
    if len(raw)<30:
        return {'status':'unavailable','reason':'Not enough valid Tri-County GPS points.'}
    # AiM lap entries may contain multiple sector records; only take full lap records.
    laps={}
    for item in header.get('Laps') or []:
        try:
            number=int(item['lap_number'])
            duration=float(item['lap_time'])/1000.0
            if 5.0 <= duration <= 180 and (number not in laps or duration < laps[number]):
                laps[number]=duration
        except (TypeError,ValueError,KeyError):
            continue
    if not laps:
        return {'status':'unavailable','reason':'AiM did not provide valid completed lap timing. GPS was not labeled as a fastest lap.'}
    # Repeated GPS visits near the first on-track location are not automatically
    # finish-line crossings. Require a real start/finish location for association.
    # AiM may provide validated absolute lap timestamps as metadata.
    records = header.get('Laps') or []
    candidates=[]
    for entry in records:
        for key in ('time','timestamp','start_time','end_time'):
            if key not in entry: continue
            try:
                stamp=float(entry[key])
                if stamp > 100000: stamp /= 1000
                duration=float(entry['lap_time'])/1000
                if 5 <= duration <= 180 and raw[0][0] <= stamp <= raw[-1][0]:
                    start=stamp-duration if key in ('time','timestamp','end_time') else stamp
                    segment=[(a,b) for t,a,b in raw if start <= t <= start+duration]
                    if len(segment)>=25 and 5<=duration<=180:
                        candidates.append((duration,segment,int(entry.get('lap_number',0))))
            except (TypeError,ValueError,KeyError):
                continue
    if not candidates:
        return {'status':'unavailable','reason':'AiM lap times exist, but GPS time boundaries could not be matched. Verify AiM lap timestamps or map the start/finish.'}
    duration,segment,lap=min(candidates,key=lambda x:x[0])
    # Check the start and end of the GPS slice are geographically adjacent.
    a,b=segment[0],segment[-1]
    meters=111320*math.hypot(a[0]-b[0],(a[1]-b[1])*math.cos(math.radians(a[0])))
    if meters>25:
        return {'status':'unavailable','reason':'Fastest timed GPS slice does not close on the track; no groove inferred.'}
    stride=max(1,len(segment)//200)
    pts=[list(p) for p in segment[::stride]]
    if pts[-1]!=list(segment[-1]):pts.append(list(segment[-1]))
    return {'status':'ready','lap_number':lap,'lap_time_sec':round(duration,3),'coordinates':pts,'source':'AiM XRK GPS and lap timing','confidence':'requires operator verification'}
