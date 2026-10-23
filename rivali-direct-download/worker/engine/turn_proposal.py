"""Unapproved corner-zone proposal from recorded GPS, never final analysis."""
import math
from .gps_laps import _find, _plain, _point, GPS_LAT_NAMES, GPS_LON_NAMES
def propose_turn_segments(data, track):
    turns=track.get("turns") or {}
    arrow=(turns.get("_rivali") or {}).get("race_arrow")
    sf=track.get("start_finish")
    if not isinstance(sf,list) or len(sf)!=2 or not isinstance(arrow,list) or len(arrow)!=2:
        return {"status":"unavailable","reason":"Save the checkered line and race arrow first."}
    latcol,loncol=_find(data,GPS_LAT_NAMES),_find(data,GPS_LON_NAMES)
    radiuscol=_find(data,("GPS Radius","GPS_Radius"))
    if latcol is None or loncol is None or radiuscol is None:
        return {"status":"unavailable","reason":"GPS position and curvature/radius measurements required."}
    points=[]
    for t,lat,lon,radius in zip(data.index,_plain(data[latcol]),_plain(data[loncol]),_plain(data[radiuscol])):
        try:
            t,lat,lon,radius=float(t),float(lat),float(lon),abs(float(radius))
            if all(map(math.isfinite,(t,lat,lon,radius))) and 3<=radius<=55 and -90<=lat<=90 and -180<=lon<=180:
                points.append((t,lat,lon))
        except (ValueError,TypeError): continue
    if len(points)<30:
        return {"status":"unavailable","reason":"Insufficient trustworthy corner-radius GPS samples."}
    # Group turning samples into two spatially distinct ends of a short oval.
    # Does not assign precise turn identities until the operator confirms.
    meanlat=sum(x[1] for x in points)/len(points)
    meanlon=sum(x[2] for x in points)/len(points)
    cosine=math.cos(math.radians(meanlat))
    xx=[((p[2]-meanlon)*cosine,p[1]-meanlat) for p in points]
    spreadx=max(v[0] for v in xx)-min(v[0] for v in xx)
    spready=max(v[1] for v in xx)-min(v[1] for v in xx)
    index=0 if spreadx>=spready else 1
    coord=[x[index] for x in xx]
    lo,hi=min(coord),max(coord)
    if hi-lo<0.0001:return {"status":"unavailable","reason":"GPS turn locations are not spatially distinct."}
    centers=[]
    for subset in ([p for p,x in zip(points,coord) if x<lo+(hi-lo)*.35],
                   [p for p,x in zip(points,coord) if x>hi-(hi-lo)*.35]):
        if len(subset)<12:return {"status":"unavailable","reason":"GPS coverage is insufficient at one end of the track."}
        centers.append({"lat":round(sum(p[1] for p in subset)/len(subset),7),
                        "lng":round(sum(p[2] for p in subset)/len(subset),7),
                        "samples":len(subset)})
    return {"status":"proposed_review_required","source":"measured_gps_radius_clusters","confidence":"low",
            "corner_pairs":centers,
            "reason":"Two ends identified from GPS curvature. Turns 1-4 and entry/exit boundaries require operator review; no turn metrics approved."}
