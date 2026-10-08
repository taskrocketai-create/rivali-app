"""Measured session report. No setup advice or causal driver/kart attribution."""
import math
from datetime import datetime, timezone
from daq_tools.readers import XRKReader
from session_summary import summarize_session


def analyze(path, filename):
    summary = summarize_session(path).to_dict()
    _, data = XRKReader.read(path, header_only=False)
    channels = []
    for name in data.columns:
        series = data[name]
        unit = str(getattr(series.dtype, 'units', ''))
        try:
            values = series.pint.magnitude if unit else series
            values = [float(x) for x in values if x is not None and math.isfinite(float(x))]
        except (TypeError, ValueError, AttributeError):
            values = []
        channels.append({'name': str(name), 'unit': unit, 'samples': len(values),
                         'minimum': min(values) if values else None,
                         'maximum': max(values) if values else None})
    warnings = list(summary['warnings'])
    warnings.append('Verify the reported lap times against Race Studio 3 or the MyChron before relying on this test report.')
    warnings.append('Out-laps, traffic, caution laps, and pit laps are not automatically classified. They can affect averages and run trend.')
    confidence = 'medium' if summary['lap_count'] >= 3 and not any('implausible' in w for w in warnings) else 'low'
    observations = []
    for c in channels:
        if c['samples'] and c['name'].strip().lower() in ('gps speed', 'rpm', 'engine rpm'):
            observations.append(f"Recorded peak {c['name']}: {c['maximum']:.2f} {c['unit'] or '(unit not supplied)'}. Raw channel peak; not a lap-specific diagnosis.")
    if summary['lap_count']:
        observations.append(f"{summary['lap_count']} completed laps; best {summary['best_lap_sec']:.3f}s; average {summary['average_lap_sec']:.3f}s.")
        observations.append(f"Lap-time standard deviation: {summary['consistency_stdev_sec']:.3f}s.")
        if summary['fade_sec'] is not None:
            observations.append(f"The second half averaged {abs(summary['fade_sec']):.3f}s {'slower' if summary['fade_sec'] > 0 else 'faster'} than the first half. This describes the recorded run, not its cause.")
    else:
        observations.append('No valid completed laps were present in the file. Channel coverage is available; lap performance is unavailable.')
    unavailable = ['Corner-by-corner and groove analysis require a mapped track.',
                   'Driver versus kart percentages cannot be established from this file alone.',
                   'Brake, throttle, steering, and tire-temperature conclusions require usable channels for those sensors.']
    report = {'schemaVersion': 1, 'filename': filename, 'createdAt': datetime.now(timezone.utc).isoformat(),
              'summary': summary, 'channels': channels, 'confidence': confidence,
              'confidenceReason': 'Measured file summary; timing still needs device/RS3 confirmation. Limited sensor or lap coverage reduces confidence.',
              'observations': observations, 'warnings': warnings, 'unavailable': unavailable}
    report['text'] = report_text(report)
    return report


def report_text(report):
    s = report['summary']
    lines = ['RIVALI — TURN DATA INTO SPEED', 'TRACK TEST REPORT', report['filename'], report['createdAt'],
             f"Driver: {s['racer'] or 'Not recorded'}", f"Track: {s['track'] or 'Not recorded'}",
             f"Confidence: {report['confidence'].upper()} — {report['confidenceReason']}", '', 'MEASURED RESULTS',
             *report['observations'], '', 'LAPS']
    lines += [f"Lap {lap['lap_number']}: {lap['lap_time_sec']:.3f}s" + (' — best' if lap['is_best'] else '') for lap in s['laps']]
    lines += ['', 'CHANNEL COVERAGE']
    for c in report['channels']:
        limits = f"{c['minimum']:.3f} to {c['maximum']:.3f}" if c['samples'] else 'No usable samples'
        lines.append(f"{c['name']} ({c['unit'] or 'unit not supplied'}): {limits}; {c['samples']} samples")
    return '\n'.join(lines + ['', 'QUALITY FLAGS', *report['warnings'], '', 'NOT ASSESSED', *report['unavailable']])
