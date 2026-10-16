"""Bounded, raw telemetry samples for driver inspection, separate from report conclusions."""
import math

def _number(value):
    try:
        out=float(value)
        return out if math.isfinite(out) else None
    except (TypeError, ValueError):
        return None

def extract_trace(data, limit=1600):
    columns={str(n).strip().lower():n for n in data.columns}
    def pick(*names):
        for n in names:
            if n in columns:return columns[n]
        return None
    channels={
        "speed":pick("gps speed","speed"),
        "rpm":pick("rpm","engine rpm"),
        "lat":pick("gps latitude","gps lat","latitude"),
        "lon":pick("gps longitude","gps long","gps lon","longitude"),
        "lateralG":pick("gps latacc","gps lateral acceleration"),
        "longitudinalG":pick("gps lonacc","gps longitudinal acceleration"),
    }
    available={k:str(v) for k,v in channels.items() if v is not None}
    if not available:return {"status":"unavailable","reason":"No compatible telemetry channels","channels":{},"samples":[]}
    length=len(data.index)
    if not length:return {"status":"unavailable","reason":"No telemetry samples","channels":available,"samples":[]}
    stride=max(1,math.ceil(length/limit))
    samples=[]
    arrays={}
    for key,col in channels.items():
        if col is None:continue
        series=data[col]
        try:arrays[key]=series.pint.magnitude
        except (AttributeError,TypeError):arrays[key]=series
    for i in range(0,length,stride):
        time=_number(data.index[i])
        if time is None:continue
        point={"t":round(time,3)}
        for key,values in arrays.items():
            v=_number(values[i])
            if v is not None:point[key]=round(v,7 if key in ("lat","lon") else 3)
        samples.append(point)
    return {"status":"ready","sampleStride":stride,"sourceSamples":length,"channels":available,"samples":samples}
