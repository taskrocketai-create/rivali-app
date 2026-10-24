import unittest
from engine.lateral_grip_evidence import attach_knowledge_sources


class TestKnowledgeBoundary(unittest.TestCase):
    def test_filters_unapproved_sources(self):
        records = [
            {"id": "a", "title": "Approved", "body": "Evidence", "status": "active",
             "verification_status": "corroborated"},
            {"id": "b", "title": "Draft", "body": "Unverified", "status": "draft",
             "verification_status": "unreviewed"},
            {"id": "c", "title": "Active unreviewed", "body": "Unverified",
             "status": "active", "verification_status": "unreviewed"},
        ]
        result = attach_knowledge_sources([{"sample_count": 10}], records)
        self.assertEqual([item["id"] for item in result["knowledge_sources"]], ["a"])
        self.assertEqual(result["recommendations"], [])
        self.assertEqual(result["analysis_status"], "awaiting_source_grounded_interpretation")
