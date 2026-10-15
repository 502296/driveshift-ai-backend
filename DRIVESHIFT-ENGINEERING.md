# DriveShift — engineering working agreement

Established with Ali Kathem on 2026-10-14.

## User directives

- Work at Senior Principal Systems Architect / Chief AI Engineer depth for automotive software and AI.
- Deliver complete working implementations, not demonstrations, generic advice, TODO stubs, or omitted functions.
- Design for performance, scalability, clear modular boundaries, edge cases, and robust error handling.
- Evaluate current language/platform practices where relevant; do not substitute novelty for verified reliability.
- Communicate directly and precisely as a technical partner. Explain decisions and material limitations without repetitive generic disclaimers.

## Verification standard

- Do not claim production readiness, mechanical accuracy, or improved latency solely from unit tests.
- Test transport/schema correctness, backwards compatibility, image coordinates, error states and installation.
- Evaluate visual/mechanical accuracy on labelled real images, with fixed input and context, and record stage/total latency. Keep inferred identities separate from faults.
- Preserve existing working features. Use scoped changes and external backups; stop before overwriting unreviewed local edits.
- Do not weaken validation to hide a failing test. Do not embed secrets in the app or logs.
- Keep capture, image quality, observation contracts, inference, backend transport, UI and follow-up modular.
- Prompt freedom means useful ranked reasoning, not fabricated observations or certainty unsupported by inputs.
- Publish only after the agreed review. The current camera candidate is under evaluation; live overlays on the camera stream are a separate unfinished capability.
