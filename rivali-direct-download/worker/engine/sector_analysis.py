"""Assign GPS observations to operator-approved track segments, independent of map colors."""
import math
from .gps_laps import _find, _plain, GPS_LAT_NAMES, GPS_LON_NAMES
NAMES=("front_straight","turn_1","turn_2","back_straight","turn_3","turn_4")
def classify_track_sectors(data,track):
    meta=(track.get("turns") or {}).get("_rivali") or {}
    zones=meta.get("zones") or {}
    groove=meta.get("groove") or []
    breaks=zones.get("breaks")
    if zones.get("review_status")!="approved":
        return {"status":"unapproved","reason":"Sector boundaries require operator approval."}
    if (not isinstance(breaks,list) or len(breaks)!=6 or
        any(not isinstance(x,(float,int)) or not 0<=x<1 for x in breaks) or
        len(set(breaks))!=6 or len(groove)<4):
        return {"status":"invalid","reason":"Approved segment definitions must have six distinct fractions and a saved track centerline."}
    latcol,loncol=_find(data,GPS_LAT_NAMES),_find(data,GPS_LON_NAMES)
    if latcol is None or loncol is None:
        return {"status":"unavailable","reason":"GPS positions missing."}
    refs=[]
    for i,p in enumerate(groove):
        try:
            lat,lng=float(p["lat"]),float(p["lng"])
            if math.isfinite(lat) and math.isfinite(lng):refs.append((lat,lng,i))
        except (ValueError,TypeError,KeyError): continue
    if len(refs)<4:return {"status":"invalid","reason":"Track reference GPS points missing."}
    coslat=math.cos(math.radians(sum(p[0] for p in refs)/len(refs)))
    counts=[0]*6;inside=0;total=0
    width=float(zones.get("width_m") or 12)
    for lat,lon in zip(_plain(data[latcol]),_plain(data[loncol])):
        try:
            lat,lon=float(lat),float(lon)
            if not math.isfinite(lat) or not math.isfinite(lon) or (lat==0 and lon==0):continue
        except (TypeError,ValueError):continue
        total+=1
        nearest=min(refs,key=lambda p:(p[0]-lat)**2+((p[1]-lon)*coslat)**2)
        distance=111320*math.hypot(nearest[0]-lat,(nearest[1]-lon)*coslat)
        if distance>max(8,width/2+6):continue
        inside+=1
        fraction=nearest[2]/len(groove)
        zone=5
        for i in range(6):
            start=breaks[i];end=breaks[i+1] if i<5 else 1
            if (start<=fraction<end if start<end else fraction>=start or fraction<end):zone=i;break
        counts[zone]+=1
    coverage=inside/total if total else 0
    return {"status":"classified" if coverage>=.6 and min(counts)>=3 else "low_coverage",
            "definition_source":"operator_approved_track_geometry",
            "segment_names":list(NAMES),"gps_sample_counts":counts,
            "gps_coverage_pct":round(coverage*100,1),
            "confidence":"provisional","analysis_ready":False,
            "reason":"Sample-to-sector assignment is provisional until lap direction and XRK alignment are verified."}
