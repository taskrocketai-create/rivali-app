# Rivali evidence review

The 2026-10-06 import adds 63 paraphrased technical knowledge records and four
official-index video discovery records. Discovery is not ingestion of a video.
Every record preserves its canonical URL, page/section locator, equipment scope,
review date, corroboration and unresolved differences. No copyrighted books or
complete video transcripts are included in this import.

## Editorial weights

- Corroborated general principle: 0.85. Exact factory values are not independently
  established just because another manufacturer supports the general principle.
- Primary text reviewed: 0.45–0.80 depending on age, specificity and claim type.
- Conflicting or internally qualified wording: 0.30 maximum.
- Legacy records not re-reviewed in this batch: 0.25 maximum.
- Catalog-only video records: draft, zero weight, excluded from advice.

These are retrieval priorities, not probabilities. Promotion requires a recorded
claim-specific independent comparison or repeated condition-matched testing.
Reposts of the same originating advice do not count as independent support.
There is no automatic promotion based on popularity, elapsed time or model output.

The database columns are `retrieval_weight`, `verification_status` and
`review_metadata`. Existing RLS policies remain in force. The import is
deduplicated by owner, source URL and title. Imported content is searchable through
the existing generated full-text search vector.

The worker selector enforces equipment/surface/class restrictions and applies
verification caps before selecting report references. Unknown required equipment
excludes a claim. Run the worker tests with:

    python -m unittest discover -s worker -p 'test*.py'

Restart/redeploy the Python worker with this commit to activate that selector.
Database weights are already stored; changing the database alone does not update
an independently running worker process. The selector ranks curated references;
it does not establish a handling cause or driver-versus-kart percentage.

## Review caveats

Factory setups must not be averaged across models. Toe reference-side conventions
differ between Phantom, Slack Elevate and legacy Ultramax documents. Track Tac
SST-5 and PRW Orange pages distinguish intended purpose from possible hardness
reduction. GPS-inferred pedal states must remain labeled inferred.

For future sources, read the actual text before creating active claims. Keep
unread recordings, unavailable PDFs and source listings in draft. Confirm numeric
tables against page images before publishing newly extracted values. Retain current
track/class rules separately from performance suggestions.
