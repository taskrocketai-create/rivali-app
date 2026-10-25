"""Conservative Alfano 6 .alf2 reader. Validates timing; does not guess GPS scales."""
import csv
import io
import math
import re
import statistics
import zipfile
from dataclasses import asdict
from engine.session_summary import LapSummary, SessionSummary

def read_alfano(path):
    with zipfile.ZipFile(path) as archive:
        entries=archive.infolist()
        if len(entries)>100 or sum(e.file_size for e in entries)>100*1024*1024:
            raise ValueError("Alfano archive exceeds safety limits")
        names=[e.filename for e in entries]
        if any("/" in n or "\\" in n or n.startswith(".") for n in names):
            raise ValueError("Invalid Alfano archive entries")
        summaries=[n for n in names if re.match(r"^SN.*\.csv$", n, re.I)]
        lap_files=[n for n in names if re.match(r"^LAP_\d+_.*\.csv$", n, re.I)]
        if len(summaries)!=1 or not lap_files:
            raise ValueError("Unsupported Alfano session layout")
        def rows(name):
            if archive.getinfo(name).file_size>10*1024*1024:
                raise ValueError("Alfano CSV member too large")
            return list(csv.reader(io.StringIO(archive.read(name).decode("utf-8-sig",errors="replace"))))
        table=rows(summaries[0])
        if len(table)<3 or "ALFANO" not in " ".join(table[0]).upper():
            raise ValueError("Missing Alfano session identification")
        headers=table[1]
        i_lap=headers.index("lap")
        i_time=headers.index("time lap")
        lap_times={}
        for row in table[2:]:
            if len(row)<=max(i_lap,i_time): continue
            try:
                lap=int(row[i_lap]); milliseconds=int(row[i_time])
            except ValueError: continue
            if lap>0 and 3000<=milliseconds<=180000:
                lap_times.setdefault(lap,milliseconds/1000)
        if not lap_times: raise ValueError("Alfano file has no verified completed laps")
        laps=[LapSummary(number,sec) for number,sec in sorted(lap_times.items())]
        times=[lap.lap_time_sec for lap in laps]
        best=min(times)
        for lap in laps: lap.is_best=(lap.lap_time_sec==best)
        half=len(times)//2
        first=statistics.mean(times[:half]) if half else None
        second=statistics.mean(times[half:]) if times[half:] else None
        meta=table[0]
        summary=SessionSummary(
            racer=meta[5] if len(meta)>5 else None,
            track=meta[4] if len(meta)>4 else None,
            date=meta[0] if meta else None,
            time=meta[1] if len(meta)>1 else None,
            lap_count=len(laps),laps=laps,best_lap_sec=best,
            average_lap_sec=statistics.mean(times),median_lap_sec=statistics.median(times),
            consistency_stdev_sec=statistics.pstdev(times) if len(times)>1 else 0,
            slowest_lap_sec=max(times),first_half_avg_sec=first,second_half_avg_sec=second,
            fade_sec=second-first if first is not None and second is not None else None,
            warnings=["Alfano GPS coordinate scaling, GPS speed units, and lap alignment not yet validated.",
                      "No driver-vs-kart attribution or setup recommendations from this import."]
        )
        channels=set()
        segment_numbers=set()
        for filename in lap_files:
            segment_numbers.add(int(re.match(r"^LAP_(\d+)_",filename,re.I).group(1)))
            with archive.open(filename) as raw:
                header=raw.readline().decode("utf-8-sig",errors="replace").strip()
            channels.update(next(csv.reader([header])))
        return summary, sorted(channels), sorted(segment_numbers-set(lap_times))
