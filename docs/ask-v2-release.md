# Ask DriveShift: evidence-based interview and learning links

## Isolation and current status

This branch is development work, not a production release. Do not merge or deploy
to the production Vercel project until the checklist below is complete. The base
commit is `7aaf99c83aa882ca49c5f8d8eb7c074e060dc73a`.

The available repository contains the backend and admin page, not the current
Flutter/iOS application. Archived mobile patches from October 15 are not a reliable
substitute for the version now distributed through Apple. UI work and TestFlight
validation require the current mobile source.

## Implemented

- Adaptive interview policy across noise, starting, vibration, cooling, engine
  performance, brakes, steering, electrical and transmission concerns. Three
  initial follow-ups remain a ceiling, not a mandatory count.
- Paired Q/A context is passed separately from raw symptom/DTC extraction, so short
  answers retain their context without making question premises into vehicle facts.
- Ambiguous yes/no answers to compound questions no longer affirm every premise.
- Saved-case regeneration extracts OBD evidence from user evidence, not the entire
  question transcript. Corrections and explanations remain distinct.
- Explicit missing information and safety triage. Unknown driving suitability
  cannot become NORMAL or permission to drive; existing critical action is preserved.
- Opt-in v2 presentation omits confidence, hypothesis likelihood and evidence-strength
  labels. v1 retains its expected enum fields for compatibility.
- Lazy link-out learning API, fixed editorial allowlist, runtime availability check,
  bounded cache/in-flight deduplication, and empty results on failure. No complaint,
  VIN or transcript is sent to YouTube. No video hosting or extra package dependency.

## Mobile integration contract (requires current app source)

1. Use an explicitly configured staging base URL in a separate development flavor.
   Never silently switch a production build to a preview server.
2. POST `/api/diagnose` with the existing body plus `experienceVersion: 2`.
   Saved-case continuations also need this field. Omitted/other values retain v1.
3. Parse `report.schemaVersion: "2.0"`. Render hypotheses as ordered possibilities
   without confidence/likelihood/strength chips. Retain evidence and urgency guidance.
4. Show `missingInformation` in an optional compact explanation. Do not display
   "not assessed" as normal or safe to drive.
5. If `report.learning.endpoint` is non-null, GET it from the same configured backend
   after showing the report. The endpoint includes topic and language. Do not transmit
   the case text, vehicle identity or personal information.
6. Hide learning UI for empty/error results. For a result show the curated title,
   publisher, scope and education notice. On a user tap, launch its HTTPS YouTube
   watch URL externally. Do not embed returned HTML, auto-play or download video.
7. Handle external-launch failure without losing the saved report or case history.

### Learning coverage and limits

Four initial English videos are linked by the publisher's own official pages:
OBD code reading, live data, slow cranking, and a rough-running-engine case study.
These are professional Bosch demonstrations, not instructions specific to DriveShift
or to the user's exact vehicle. They were selected from source-page descriptions;
full video content/safety review is still a release gate. There is currently no
approved belt-noise video, and no approved Spanish videos. Those combinations return
an empty list instead of an unrelated or invented link. Expand the editorial catalog
only after reviewing relevance, language, safety, publisher and applicability.
Availability checks do not prove medical/mechanical correctness or regional playback.

Sources:
- https://www.boschdiagnostics.com/tutorials
- https://www.boschdiagnostics.com/bosch-solves/solving-vehicle-slow-start
- https://www.boschdiagnostics.com/bosch-solves/solving-vehicle-rough-running-engine-and-check-engine-light

## Validation

`node --test test/*.test.mjs` runs backend regression/contract tests with mocked model
responses. These prove control flow, evidence boundaries and response compatibility,
not real-world diagnostic accuracy. No live paid model evaluation was run in this
workspace because it has no configured model API credential.

`node tools/evaluate-ask-v2.mjs` inventories 18 synthetic evaluation cases without
making API calls. Explicit `--live` plus `OPENAI_API_KEY` enables paid local evaluation.
Results checkpoint to `/tmp/ask-evaluation.json`; never commit real case data or keys.
Automated gates check stage, urgency and contract; a qualified reviewer must assess
causal ranking, evidence fidelity, question value, safe verification, corrections,
language clarity and usefulness. Do not equate contract pass rate with accuracy.

## Before any production release

- Confirm the current App Store app's actual backend URL and production Git branch.
- Use an isolated staging project with separate telemetry/storage and server-only
  credentials. Review preview access controls before allowing model-backed requests.
- Run live synthetic evaluations against the chosen production model configuration.
  Record latency/token usage and compare the same cases with the base version.
- Resolve every safety/evidence error; review representative cases in each family.
- Complete the mobile UI integration and run TestFlight on real devices, including
  existing saved reports, v1 clients, poor network, unavailable videos and continuation.
- Review applicable App Store disclosures if functionality or data practices change.
- Deploy only after review, keep the base deployment available for rollback, and
  monitor errors/latency. Do not change model IDs, production secrets or database
  schema as part of this branch's rollout.
