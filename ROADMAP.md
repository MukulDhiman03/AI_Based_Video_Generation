# VidSutra feature queue

Completed: working authentication (optional invitations), protected dashboard, Gemini idea suggestions, editable idea drafts, autosave/recovery/conflict protection, and manual idea review.

Completed creation/planning stage: **Create Content and AI planning**. An approved idea or manual brief becomes a saved content draft. Reel settings support English/Hindi, 30/60/90-second targets, and only Viraj/Monika. Single-image posts exclude voice and duration. Gemini creates a persisted script, scene directions, on-screen text, and caption; settings changes invalidate earlier plans. Creation/retries are idempotent, saves check revisions, and interrupted planning is recoverable. The dashboard reopens these drafts. This stage produces a plan, not finished media.

Completed integration: **Visual generation** is implemented with private R2 storage, durable per-scene progress/checkpoints, programmatic English/Hindi labels, previews/downloads, and retry/stale-plan protection. Generation is paused until R2 and Gemini image access are configured. Live Gemini images require quota/billing access; R2 deployment still requires credentials. The implementation is available for review, with those live configuration dependencies outstanding.

Current feature: **Narration and caption alignment** is implemented with approved voice selection, continuous MP3 narration, measured speech duration, English/Hindi word/caption timing, scene cuts, playback/caption previews, private MP3/SRT/VTT downloads, durable audio checkpoints, and manual recovery. Live ElevenLabs synthesis and R2 transfers still need configuration. Both voice endpoints are accessible, but the current key's subscription check returned 401; credit entitlement is unverified. Narration is paused by default.

Remaining implementation order:

1. **Visual launch configuration:** enable Gemini image-generation access, configure and verify private R2, and configure a dispatcher if deploying to serverless hosting.
2. **Narration launch configuration:** enable subscription-read permission for the ElevenLabs key, verify credits and synthesis, configure private R2, then enable narration and run an explicitly authorized live smoke test.
3. **Reel animation and rendering:** drive Remotion from the saved plan, narration, and illustrations; assemble and render downloadable MP4s.
4. **Preview, downloads, and content library:** full Reel/image previews, search/filtering, saved versions, and signed media downloads.
5. **Production job reliability and limits:** durable execution for media stages, genuine progress, cancellation/recovery, cost accounting, quota admission and retry policies. Planning already has a basic shared provider-call ceiling; this item covers the complete pipeline. Build the execution foundation as part of stages 1–3, rather than running long media work inside a short request.
6. **Instagram connection:** account eligibility checks, Meta OAuth, protected token storage, refresh/reconnect, and account status.
7. **Publish now:** an explicit review/publish action, provider status tracking, duplicate-publication prevention, and clear failures.
8. **Scheduling and calendar:** timezone-aware scheduling, background dispatch, publication details, and recoverable failures.
9. **Account settings and email:** profile/preferences, verification delivery, password recovery, and notification preferences.
10. **Beta operations:** feedback, usage/job visibility, access administration, and operational diagnostics.

Keep Phase 1 focused: dark UI, automated scene planning, no timeline editor, no manual scene editing, no background music, no paid subscriptions, and no automatic publication without an explicit action. Generation and publication remain separate actions.
