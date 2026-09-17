"""
Rivali — session_summary.py

Reads an AiM MyChron .xrk session file (via the open-source `daq_tools`
library) and boils it down into a small, clean summary dict that's cheap
to hand to an LLM for coaching feedback — instead of dumping raw
telemetry at it.

Usage:
    python session_summary.py path/to/session.xrk

Install:
    pip install git+https://github.com/zaggyai/daq_tools.git
    (daq_tools is NOT on PyPI as of this writing — install from GitHub)

IMPORTANT — one thing to verify against a REAL file from your unit:
    The raw `lap_time` / `best_time` / `total_time` values that daq_tools
    pulls out of the .xrk are NOT documented anywhere as to their unit
    (milliseconds vs. some other tick count). This script assumes
    milliseconds, which is the common convention for these AiM formats,
    and includes a sanity check that will flag it loudly if a lap time
    comes out looking wrong (e.g. absurdly short/long). The first time
    you run this against a real session, eyeball the "lap_time_sec"
    values against what the MyChron itself displayed for that session —
    if they don't match, the SCALE_FACTOR below needs adjusting.
"""

import json
import statistics
import sys
from dataclasses import dataclass, field
from typing import Optional

# Adjust this if real-file testing shows lap times are off by a factor
# (e.g. if raw units turn out to be in 1/10,000 sec instead of ms).
SCALE_FACTOR_MS = 1.0


@dataclass
class LapSummary:
    lap_number: int
    lap_time_sec: float
    is_best: bool = False


@dataclass
class SessionSummary:
    racer: Optional[str]
    track: Optional[str]
    date: Optional[str]
    time: Optional[str]
    lap_count: int
    laps: list
    best_lap_sec: Optional[float]
    average_lap_sec: Optional[float]
    median_lap_sec: Optional[float]
    consistency_stdev_sec: Optional[float]
    slowest_lap_sec: Optional[float]
    first_half_avg_sec: Optional[float]
    second_half_avg_sec: Optional[float]
    fade_sec: Optional[float]  # positive = got slower over the run
    warnings: list = field(default_factory=list)

    def to_dict(self):
        d = self.__dict__.copy()
        d["laps"] = [lap.__dict__ for lap in self.laps]
        return d


def _raw_to_seconds(raw_value: int) -> float:
    """Convert a raw lap_time integer from daq_tools into seconds."""
    return (raw_value * SCALE_FACTOR_MS) / 1000.0


def summarize_session(xrk_path: str) -> SessionSummary:
    """
    Read an .xrk file and produce a SessionSummary.

    Raises a clear error if daq_tools isn't installed, or if the file
    has no lap data (e.g. a bench-test session with no closed laps).
    """
    try:
        from daq_tools.readers import XRKReader
    except ImportError as e:
        raise ImportError(
            "daq_tools is not installed. Install it with:\n"
            "  pip install git+https://github.com/zaggyai/daq_tools.git\n"
            "(it is not published on PyPI under this name)"
        ) from e

    header, _data = XRKReader.read(xrk_path, header_only=False)

    # IMPORTANT (found by testing against a real .xrk file, not assumed):
    # daq_tools' XRKReader.read() returns the raw internal metadata dict,
    # NOT a Header object with a .meta() method, despite what the
    # library's own class structure implies. Access it as a plain dict.
    racer = header.get("Racer")
    track = header.get("Track")
    date = header.get("Date")
    time_ = header.get("Time")
    raw_laps = header.get("Laps") or []

    warnings = []

    # IMPORTANT (also found via real-file testing): each completed lap
    # appears as THREE consecutive entries in raw_laps with the SAME
    # lap_time (likely sector/split records within that lap) but
    # different best_time. Naively treating every entry as a separate
    # lap would triple-count laps and badly skew consistency/fade math.
    # Deduplicate to one entry per lap_number, keeping the first seen.
    seen_lap_numbers = set()
    deduped_laps = []
    for l in raw_laps:
        if l["lap_number"] not in seen_lap_numbers:
            seen_lap_numbers.add(l["lap_number"])
            deduped_laps.append(l)
    raw_laps = deduped_laps

    # IMPORTANT (also found via real-file testing): incomplete laps
    # (e.g. an out-lap before the first full lap) are marked with
    # lap_time = 2147483647 (0x7FFFFFFF, the max 32-bit signed int) as
    # a sentinel for "no valid time" rather than being omitted. These
    # must be filtered out before computing any statistics.
    INVALID_LAP_TIME_SENTINEL = 2147483647
    invalid_count = sum(1 for l in raw_laps if l["lap_time"] == INVALID_LAP_TIME_SENTINEL)
    raw_laps = [l for l in raw_laps if l["lap_time"] != INVALID_LAP_TIME_SENTINEL]
    if invalid_count:
        warnings.append(
            f"{invalid_count} incomplete/out-lap(s) with no valid time were "
            "excluded (e.g. the formation/out lap before the first timed lap)."
        )

    if not raw_laps:
        warnings.append(
            "No lap data found in this session. This can happen with a "
            "bench/test session, a session where the unit never crossed "
            "the start/finish line twice, or a track that wasn't "
            "recognized/learned. Nothing to summarize."
        )
        return SessionSummary(
            racer=racer, track=track, date=date, time=time_,
            lap_count=0, laps=[], best_lap_sec=None, average_lap_sec=None,
            median_lap_sec=None, consistency_stdev_sec=None,
            slowest_lap_sec=None, first_half_avg_sec=None,
            second_half_avg_sec=None, fade_sec=None, warnings=warnings,
        )

    # Build clean lap list, sorted by lap number
    laps_sorted = sorted(raw_laps, key=lambda l: l.get("lap_number", 0))
    lap_times_sec = []
    lap_objs = []
    for l in laps_sorted:
        sec = _raw_to_seconds(l["lap_time"])
        lap_times_sec.append(sec)
        lap_objs.append(LapSummary(lap_number=l.get("lap_number", 0), lap_time_sec=sec))

    # Sanity check on plausibility (dirt kart laps are realistically
    # somewhere between ~5 sec and ~90 sec on almost any track)
    implausible = [t for t in lap_times_sec if t < 3 or t > 180]
    if implausible:
        warnings.append(
            f"{len(implausible)} lap(s) look implausible ({min(implausible):.1f}s - "
            f"{max(implausible):.1f}s). This likely means SCALE_FACTOR_MS needs "
            "adjusting for your unit/firmware — verify against what the MyChron "
            "display actually showed for this session before trusting these numbers."
        )

    best = min(lap_times_sec)
    worst = max(lap_times_sec)
    avg = statistics.mean(lap_times_sec)
    med = statistics.median(lap_times_sec)
    stdev = statistics.pstdev(lap_times_sec) if len(lap_times_sec) > 1 else 0.0

    for lap in lap_objs:
        if lap.lap_time_sec == best:
            lap.is_best = True

    # Fade analysis: compare first half of the run to second half
    n = len(lap_times_sec)
    half = n // 2
    first_half_avg = statistics.mean(lap_times_sec[:half]) if half > 0 else None
    second_half_avg = statistics.mean(lap_times_sec[half:]) if (n - half) > 0 else None
    fade = None
    if first_half_avg is not None and second_half_avg is not None:
        fade = second_half_avg - first_half_avg  # positive = slower late in run

    return SessionSummary(
        racer=racer, track=track, date=date, time=time_,
        lap_count=n, laps=lap_objs,
        best_lap_sec=best, average_lap_sec=avg, median_lap_sec=med,
        consistency_stdev_sec=stdev, slowest_lap_sec=worst,
        first_half_avg_sec=first_half_avg, second_half_avg_sec=second_half_avg,
        fade_sec=fade, warnings=warnings,
    )


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python session_summary.py path/to/session.xrk")
        sys.exit(1)

    summary = summarize_session(sys.argv[1])
    print(json.dumps(summary.to_dict(), indent=2))
