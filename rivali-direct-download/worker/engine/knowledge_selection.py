"""Editorial evidence priority is separate from applicability and probability."""

def select_knowledge(items, session, kart, limit=3):
    setup = session.get("setup") or {}
    context = {**kart, **setup}
    context["surface"] = (session.get("conditions") or {}).get("surface_type")
    selected = []
    for item in items:
        if item.get("status", "active") != "active":
            continue
        state = item.get("verification_status", "unreviewed")
        if state == "catalog_only":
            continue
        if any(item.get(key) and item[key] != session.get(key) for key in ("track_id", "kart_id")):
            continue
        scope = (item.get("review_metadata") or {}).get("applicability") or {}
        matches = True
        for key in ("chassis_make", "chassis_model", "tire_brand", "tire_compound", "clutch_model", "tire_prep", "surface"):
            allowed = scope.get(key)
            if not allowed:
                continue
            actual = str(context.get(key) or "").strip().casefold()
            if actual not in {str(value).strip().casefold() for value in allowed}:
                matches = False
                break
        required_class = item.get("class_name")
        if required_class and str(context.get("class_name") or "").casefold() != required_class.casefold():
            matches = False
        if not matches:
            continue
        weight = float(item.get("retrieval_weight", 0.25))
        # Caps prevent a mislabeled low-evidence item overriding vetted material.
        cap = {"unreviewed": 0.25, "conflicting": 0.3, "primary_only": 0.8}.get(state, 1.0)
        selected.append((min(weight, cap), item))
    selected.sort(key=lambda pair: (-pair[0], pair[1].get("id", "")))
    return [item for _, item in selected[:limit]]
