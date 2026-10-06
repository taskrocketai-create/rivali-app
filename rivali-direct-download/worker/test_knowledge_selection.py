import unittest
from engine.knowledge_selection import select_knowledge


class KnowledgeSafetyTests(unittest.TestCase):
    def item(self, id, state, weight, scope=None, status="active"):
        return {"id": id, "verification_status": state, "retrieval_weight": weight,
                "status": status, "review_metadata": {"applicability": scope or {}}}

    def test_unreviewed_high_confidence_cannot_outrank_corroborated(self):
        weak = {**self.item("weak", "unreviewed", 1), "confidence": "high"}
        strong = self.item("strong", "corroborated", .85)
        self.assertEqual(select_knowledge([weak, strong], {}, {}, 1)[0]["id"], "strong")

    def test_wrong_chassis_and_unknown_equipment_are_excluded(self):
        row = self.item("elevate", "primary_only", .8, {"chassis_make": ["Slack"], "chassis_model": ["Elevate"]})
        self.assertEqual(select_knowledge([row], {}, {"chassis_make": "Phantom"}), [])
        self.assertEqual(select_knowledge([row], {}, {}), [])
        self.assertEqual(len(select_knowledge([row], {}, {"chassis_make": "Slack", "chassis_model": "Elevate"})), 1)

    def test_catalog_and_drafts_do_not_become_advice(self):
        rows = [self.item("video", "catalog_only", 1), self.item("draft", "primary_only", .8, status="draft")]
        self.assertEqual(select_knowledge(rows, {}, {}), [])

    def test_conflict_cannot_override_verified_claim(self):
        rows = [self.item("conflict", "conflicting", 1), self.item("verified", "corroborated", .85)]
        self.assertEqual(select_knowledge(rows, {}, {}, 1)[0]["id"], "verified")

    def test_specific_track_and_tire_are_required(self):
        row = {**self.item("burris", "primary_only", .75, {"tire_brand": ["Burris"], "tire_compound": ["SS-33A"]}), "track_id": "track-a"}
        self.assertEqual(select_knowledge([row], {"track_id": "track-b"}, {"tire_brand": "Burris", "tire_compound": "SS-33A"}), [])
        self.assertEqual(select_knowledge([row], {"track_id": "track-a"}, {"tire_brand": "Maxxis"}), [])


if __name__ == "__main__":
    unittest.main()
