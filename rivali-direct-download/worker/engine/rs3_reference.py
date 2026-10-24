"""RS3 comparison reference for Stephen's July recording only."""

REFERENCE = {8: 12.295, 10: 12.316, 17: 12.312, 20: 12.313, 21: 12.314}


def validate_offset(records, reference=REFERENCE):
    matches = {}
    for offset in range(-3, 4):
        matching = [number for number, seconds in reference.items() if any(
            row['record_ordinal'] + offset == number and
            abs(row['duration_seconds'] - seconds) < 0.0011 for row in records)]
        if len(matching) >= 4:
            matches[offset] = matching
    if len(matches) != 1:
        return None
    return next(iter(matches))
