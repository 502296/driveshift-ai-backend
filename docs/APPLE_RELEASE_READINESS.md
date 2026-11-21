# DriveShift backup release readiness

This is an incremental development checkpoint, not approval to merge into main,
promote a backend to production, or submit an App Store update.

## Source checkpoints

- Mobile: `502296/driveshift-app`, `qa/firebase-analytics`,
  `ebacb9e769362536a30fcc8c6ecc4c37210e7868`.
- Camera backend baseline: `fix/qa-camera-inspection`,
  `de80ad42a33a63db1711230999169d269125c000`.
- Ask V2 remains a separate draft PR (#2). Its review and evaluation gates
  remain open; do not assume its changes are included in this camera branch.

These are repository checkpoints. They do not identify the build currently
installed on the owner's iPhone.

## Completed in this change

Camera inspection now rejects an inconsistent generated report when normalization
would discard a hypothesis, a verification step, or any of their evidence links.
Previously, an invalid leading cause could be dropped while a valid alternative
survived, leaving the generated headline and next action unchanged. Invalid
reports use the existing `CAMERA_CONTRACT_INVALID` response; they are not shown
as successful diagnoses.

Supported alternatives, shared verification steps and duplicate references to
the same valid evidence remain accepted. The response schema, model selection,
legacy camera endpoints and production configuration are unchanged.

Validation: 43/43 camera tests passed on Node 24.22.3, including five new regression
and positive-control tests. Four new regression tests failed against the baseline
before the change. These tests mock model output and do not establish
mechanical, real-image or on-device accuracy.

```sh
node --test test/camera-inspect.test.mjs test/camera-follow-up.test.mjs test/camera-mechanic.test.mjs test/camera-workspace.test.mjs
```

## Next verification gate: isolated device acceptance

1. Identify the installed build's mobile commit, version and build number.
2. Use `lib/main_internal_qa.dart` with `DRIVESHIFT_INTERNAL_QA=true`,
   `ASK_EXPERIENCE_V2=true` and the exact protected staging Preview origin as
   `DIAGNOSIS_API_BASE_URL`. The app's default backend is production; the
   repository branch name alone does not isolate requests.
3. For the separate non-internal camera path, also verify `CAMERA_API_BASE_URL`.
   Never place access codes or temporary share URLs in committed files.
4. Test both Camera and Choose Photo with controlled fixtures: dashboard warning
   with unknown running state, tire deformation, residue of uncertain origin,
   normal component and irrelevant/unreadable image. Record expected vs actual
   results, timing, evidence and the tested deployment commit.
5. Verify permission refusal, offline/timeout handling, follow-up, back/copy,
   report saving/reopening, large text and external educational-link return.
6. Have an automotive expert review cause ranking, evidence fidelity, action and
   conditional driving guidance before acceptance.

A stricter validator may increase retry responses for inconsistent model output.
Measure this on staging; do not soften evidence validation solely to reduce the
error rate. Report contract failure is a rejection, not a corrected diagnosis.

## Remaining release gates

- [ ] Run Flutter analysis, widget tests and an iOS build on the development Mac.
      Flutter/Dart and Apple signing are unavailable in the editing environment.
- [ ] Complete camera acceptance against the exact candidate backend above.
- [ ] Complete OBD adapter/vehicle, reconnect and multi-code navigation tests.
- [ ] Evaluate Ask V2 and integrate its approved contract on an isolated branch.
- [ ] Review educational links and saved-report/case-chat safety updates.
- [ ] Verify analytics consent, event delivery and withdrawal on the candidate app.
- [ ] Record service health, costs, p95 latency and rollback instructions.
- [ ] Complete TestFlight acceptance and review store materials/privacy answers.
- [ ] Obtain the owner's explicit approval before any production promotion,
      merge into main or Apple submission.

Track each gate with status, source commit, deployment, build/device, date,
evidence, owner and next action. Do not close device or expert gates using mock
unit tests alone.
