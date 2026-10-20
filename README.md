# VidSutra.ai

Current application scope: Stitch-based, dark-only **authentication, a protected home dashboard, Gemini idea exploration, content creation/planning, and saved-plan visual generation**, with Better Auth and MongoDB. Anyone can create an account without an invitation. The earlier UI and planning endpoint are archived under `design/archive/` and removed from the active app.

## Start the application

```sh
npm install
npm run db:setup
npm run dev
```

Open http://127.0.0.1:3005 (or http://localhost:3005). Local authentication and protected writes accept both aliases on the configured protocol and port. Production domains trust only the configured `BETTER_AUTH_URL` origin. Sessions remain host-only, so sign in separately if switching between the two addresses. Signed-out users go to `/sign-in`; signed-in users go to `/home`. Successful sign-in/signup and returning authenticated users enter their dashboard. `/home` checks the session on the server. Account controls include working sign-out; the auth pages redirect active sessions back home.

## Home dashboard

The dashboard follows the latest Stitch `01 Overview` and `26 Mobile Overview` designs: charcoal surfaces, lavender actions, mint status accents, locally served Manrope/Inter, desktop sidebar, mobile navigation, and the original Stitch ocean illustration. The illustration is explicitly decorative for an empty featured slot, never presented as a user's generated content.

Sections include featured completed content, current generation activity, beta allowance, upcoming publications, recent content, Instagram connection status, account details, refresh, help, and sign-out. All values come from the signed-in user's records. New accounts have empty states, no invented jobs/posts/connection, and an unassigned quota. Loading and retryable error views are included.

Explore ideas opens `/home/ideas`. New explainer and Create content open `/home/create`; editable draft cards reopen `/home/create/[id]`. Narration/video rendering, full library/preview pages, Instagram OAuth, scheduling, and preferences remain future features. Other dashboard controls open clearly labeled contextual panels.

`GET /api/dashboard` requires a valid session, returns `Cache-Control: no-store`, accepts no caller-selected user ID, and returns a projected DTO. See `src/lib/server/dashboard.ts` and `src/lib/dashboard.ts`. Every user-owned query filters by the authenticated session ID (string or BSON ObjectId); secrets such as Instagram tokens are never selected or serialized.

Initial dashboard read contracts, to align with later writing services:

- `content_items`: `userId`, `title`, `format` (`reel`/`image`), `language` (`en`/`hi`), `status`, `createdAt`/`updatedAt` BSON dates. Statuses: draft, queued, processing, completed, failed; ready is accepted as a completed alias.
- `generation_jobs`: `userId`, `title`, status queued/running/processing, stage planning/illustrations/narration/animation/rendering/checks, `createdAt`. No ETA or percentage is inferred.
- `publications`: `userId`, `title`, status scheduled, `scheduledFor` BSON date. Dates are displayed in Asia/Kolkata.
- `social_accounts`: `userId`, provider instagram, `username`, `status`, optional `expiresAt`. Expired records prompt reconnection; the dashboard does not verify live Meta authorization.
- `app_settings`: optional per-user record with key `generation_allowance:<userId>`, integer `limit`/`used`, optional BSON `resetsAt`. No allowances are seeded, reset policy inferred, or quota enforcement claimed.

Optionally create a private, email-bound invitation locally (not required for signup):

```sh
npm run invite -- invited-person@example.com
```

The command prints a seven-day invitation link to share directly with that recipient. It sends no email. Only a SHA-256 digest of the random invitation token is stored. Invitation codes are optional: leaving the field blank allows signup with a name, email, and a password of 12–128 characters. If a code is supplied, it must be valid, unused, unexpired, and match the email; users can clear an invalid code to register without one. Better Auth hashes passwords and stores sessions in the separate `vidsutra_ai` database. Supplied invitation use is recorded after registration; unique email indexes prevent duplicate accounts, including concurrent requests.

`MONGODB_URI`, `MONGODB_DB`, `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL` are configured in the ignored environment files. Set the latter to the exact application origin; the local default is `http://127.0.0.1:3005`. The auth secret must contain at least 32 characters. Serve a deployed app over HTTPS for secure production cookies. The database must support transactions (the configured Atlas cluster does).

Email delivery, verification emails, and password recovery are not configured. Accounts remain `emailVerified: false`; sign-in currently permits accounts without a separate verification email. The recovery link explains this limitation. No final legal policy or consent claims are taken from the draft Stitch placeholders.

## Ideas and manual review

`/home/ideas` follows the Stitch `04 Explore Ideas` layout and the existing dark studio theme. Set a topic, category, language (English/Hindi), and format (Reel/image) to request six Gemini ideas. Decorative abstract card artwork is UI decoration, not generated media. Gemini credentials stay on the server; `GEMINI_MODEL` selects the configured model (default `gemini-3.8-flash`). Provider JSON is schema-validated before saving or displaying it. AI suggestions still require human fact checking.

“Use Idea” fills the editable title, opening hook, explanation, language, and format. Replacing a nonempty draft requires an inline confirmation. Changes autosave after a 700 ms pause into one current idea draft per account in `idea_drafts`, separate from generated content. Browser recovery data is scoped to that account. If browser storage is unavailable, the UI explains that recovery requires keeping the page open until the server save completes.

Manual controls mark a draft pending, approved, or dismissed. Editing an approved/dismissed idea returns it to pending. Dismiss keeps the draft recoverable; approval records a review decision and enables Continue to creation once the approved revision is saved. Handoff creates or reopens a separate content draft; it does not generate or publish media.

Reliability contracts:

- Results are accepted only for the current request ID and matching topic/category/language/format. Suggestions never automatically replace a draft. A changed brief disables the previous suggestions.
- Draft saves are serialized and use a revision comparison plus mutation ID. A lost response can be retried without applying the same save twice. Another tab's change produces a conflict with explicit “Load saved version” / “Keep my draft” choices. An old save acknowledgement never replaces newer local text.
- `idea_requests` stores the brief, state, ideas, lease, and safe errors. Refresh/recovery looks up a request before retrying it. Active work returns HTTP 202; completed retries return the existing result. Gemini runs synchronously in the request with a 40-second timeout; deployment must allow the route's 60-second duration. A terminated process leaves an expired lease that can be manually retried after 65 seconds. This is request recovery, not a background job worker or provider-level exactly-once billing guarantee.
- Retries are manual, bounded to three attempts per request, and use cooldowns for errors. A rolling-hour admission check limits new requests to 12 per account; this count check is best effort under concurrent distinct requests. After a retry limit, use Generate new ideas. No video allowance is charged by this feature.
- `GET/POST /api/ideas` and `GET/PUT /api/idea-draft` require authentication, derive ownership from the session, and return `no-store`. Writes also require the configured application origin and bounded JSON input. All records/indexes stay inside `vidsutra_ai`.

Validation:

```sh
npm run db:setup                       # Creates/verifies the idea collections/indexes
npm run test:ideas                     # No network or credentials needed
npm run test:ideas:integration         # Local server + database, synthetic fixtures cleaned up
npm run test:ideas:integration -- --live # Also makes one real Gemini request
```

The integration suite verifies authentication/origin checks, account isolation, request replay and leases, interrupted request recovery, retry caps, concurrent draft save conflicts, mutation replay, persisted review decisions, and the protected page. The optional live check validates six actual provider ideas and never generates audio/video.

## Content creation and planning

`/home/create` follows the Stitch creation layouts and the shared dark studio shell. Start with a manual brief, or use Continue to creation on a saved approved idea. Approval handoff checks the idea revision and uses its saved mutation ID for idempotency. Later idea edits cannot overwrite the separate content draft.

Reels support English/Hindi, 30/60/90-second targets, and Viraj/Monika only. Single-image posts use 4:5 and have no voice or duration. The initial visual direction is illustrated infographic. The right-hand composition is explicitly decorative; it never claims to be generated media.

Create draft / Save draft persists the brief and settings in `content_items`. These settings use **explicit saves**, with account-scoped local recovery for unfinished edits. The Save button and unsaved status make this visible. Revision and mutation checks preserve edits across lost responses and another tab's saves. Saved drafts appear on the dashboard and reopen in the composer. Existing non-composer content keeps its earlier detail behavior.

Generate script & plan first saves changed settings, then calls Gemini for a structured script/visual plan/caption. A 30/60/90-second Reel gets 4/6/8 scenes respectively; an image post gets one composition and no narration. Speaking time remains a target until real audio is measured. Scene plans are read-only; there is no manual timeline editor or extra required script-approval step. This button performs planning only. The separate Generate visuals section uses that saved plan; speech, rendering and publication remain separate stages.

Plans are tied to the saved content revision. A save clears the earlier plan and lease; an older planning completion cannot overwrite the newer revision. Planning status and results persist across reloads. Active leases prevent duplicate calls, completed retries reuse results, expired leases can be manually retried, and each request gets at most three attempts. Gemini 3 models use LOW reasoning for this bounded planning task, with an 8192-token output cap. The route has a 40-second provider timeout and 60-second deployment duration; it is synchronous request recovery, not a media worker. An atomic per-account admission counter in `app_settings` caps provider planning attempts at 12 per UTC clock hour across instances. Retries and failed provider calls consume a slot. Full media quota accounting remains on the roadmap.

APIs: `POST /api/content`, `GET/PUT /api/content/[id]`, and `POST /api/content/[id]/plan`. Authentication, ownership, bounded JSON, write-origin checks, and no-store responses reuse the existing API boundary. Index setup adds a partial unique `(userId, creationId)` index, preserving older content records. Only `vidsutra_ai` is used.

```sh
npm run db:setup
npm run test:content
npm run test:content:integration          # Local app and synthetic database fixtures
npm run test:content:integration -- --live # Also one real Reel and one image-planning call
```

See [ROADMAP.md](ROADMAP.md) for the next features in implementation order.

## Visual generation

After saving a current plan, the composer exposes **Generate visuals**, per-scene progress, image previews, private PNG downloads, recovery, and retry of unfinished scenes. Gemini creates text-free illustrations using `GEMINI_IMAGE_MODEL` (default `gemini-3.1-flash-image`). Later Reel scenes use the first illustration as a style reference. Sharp validates/normalizes raster output to 1080×1920 for Reels or 1080×1350 for image posts, then typesets the plan's on-screen text. Noto Sans Devanagari is bundled under `assets/fonts/` with its OFL license; rendering does not depend on installed host fonts. Raw artwork is retained for later animation and narration stages.

The configured Gemini key successfully listed image models, but its live image-generation probe returned **429 with free-tier image quota 0**. Model listing alone does not establish generation entitlement. Enable image-generation quota/billing or supply an eligible key before expecting real images. No billing settings are changed by the app. Tests use explicitly synthetic images through a private injected worker dependency; the production API has no mock-generation switch.

### Private storage

- R2 is the only media store. Configure `VISUAL_STORAGE=r2`, `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` for a private bucket. The app does not create buckets or public URLs. Credentials stay on the server.
- Keep `VISUAL_GENERATION_ENABLED=false` until Gemini image access and R2 are ready, then explicitly set it to `true`. Missing configuration disables submission. The worker also checks this switch before each provider admission.
- Live R2 uploads/downloads remain unverified because credentials are not configured. SDK serialization and byte round trips are tested with an in-memory transport, without contacting R2.
- `GET /api/media/[id]` requires the owning user's session, proxies the PNG, and returns private/no-store and nosniff headers. `?download=1` supplies an attachment filename. Raw object keys and credentials are never returned by the visual status API.

### Durable visual jobs

`POST /api/content/[id]/visuals` validates the saved revision/plan ID, creates one idempotent visual batch, and returns HTTP 202. `GET` returns genuine persisted scene progress. Repeated starts do not regenerate completed scenes. Jobs live in `generation_jobs`, assets in `media_assets`; all account-owned operations filter by session-derived ownership.

For a **long-lived Node Next.js server**, set `VISUAL_WORKER_MODE=node`. The instrumentation hook starts a sequential worker inside Next.js, independently of the browser. Queued jobs resume after server restart. An interrupted in-flight call becomes manually retryable after its lease expires; the app does not silently spend again. Each scene has at most three attempts. Provider failures pause the batch and preserve completed scenes. A durable raw-artwork checkpoint lets composition/storage retries reuse that artwork after it has been saved.

For **serverless/Vercel**, do not rely on timers. Set `VISUAL_WORKER_MODE=dispatch`, configure a random `VISUAL_WORKER_SECRET` of at least 32 characters, and schedule authenticated calls to `GET/POST /api/internal/visual-worker` with `Authorization: Bearer <secret>`. Each dispatch claims one bounded scene; the platform must allow the route's 180-second maximum duration. Set `VISUAL_DISPATCH_SCHEDULED=true` only after that external dispatcher is actually configured. The submit route also kicks one step with Next's `after`, but `after` alone is not a durable scheduler. No deployed dispatcher has been configured by this task.

Workers use atomic leases. Image checkpoints transactionally fence against the content revision and saved plan before attaching results, so an old worker cannot replace newer work. Saving settings or starting a new plan cancels obsolete queued/running jobs. Unknown provider outcomes before the raw checkpoint can still incur a charge on a manual retry; provider-level exactly-once billing is not claimed. Interrupted uploads can leave private, unattached objects for future operational cleanup; completed referenced assets are never deleted by retry.

An atomic per-account counter allows at most 24 illustration provider admissions per UTC clock hour. Failed provider calls also consume a slot; a retry using saved raw artwork does not. `VISUAL_QUEUE` namespaces workers (default `visuals-v1`); integration tests use a unique private queue, so the running app cannot claim their fixture work.

```sh
npm run db:setup
npm run test:visuals
npm run test:visuals:integration          # Real MongoDB, mock R2 transport and fixture provider, automatic cleanup
npm run test:visuals:integration -- --http # Also authenticated local API/privacy checks; start the local app first
```

The regression suite covers partial progress/retries, raw checkpoint reuse, style references, queue isolation, leases, stale-plan fences, private ownership, cooldowns, admission limits, raster validation, Hindi labels, and dimensions. R2 network access and live successful image generation remain unverified pending configuration/access.

## Narration and caption alignment

Saved **Reel** plans now have a narration panel below visuals. It uses only the approved Viraj (`bajNon13EdhNMndG3z05`) and Monika (`2zRM7PkgwBPiau2jvVXc`) voices with Eleven Multilingual v2. A continuous script is sent to ElevenLabs' [speech-with-timestamps endpoint](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps). The service measures the returned MP3 using `music-metadata`, validates original character timestamps against the saved script, derives word/caption cues and contiguous 30 fps scene cuts, and stores the measured duration. Target duration remains a planning target; the app does not silently stretch or truncate speech.

Original alignment is preferred. Normalized alignment is accepted only when its words match the saved script (Unicode NFC and whitespace differences are supported). Number expansion or other transcript changes that cannot be mapped safely fail alignment rather than invent timings. Saved audio is retained. Captions are grouped by scene, length, punctuation, and duration and can be downloaded as SRT or VTT; the preview follows audio playback. These are narration/caption previews, not rendered videos.

Configure private R2 and `NARRATION_GENERATION_ENABLED=true` to enable speech. It defaults to `false` locally. This flag is independent of `VISUAL_GENERATION_ENABLED`; narration can be prepared while images remain paused. A read-only check on 19 October 2026 confirmed both voice endpoints returned 200, but the subscription endpoint returned 401. Available credits and synthesis entitlement remain unverified. The configured key needs access to [subscription information](https://elevenlabs.io/docs/api-reference/user/subscription/get) so the worker can check remaining allowance before requesting speech. No paid speech call was made during implementation.

`GET/POST /api/content/[id]/narration` loads or starts/retries the current saved plan's job. Duplicate starts/replays reuse it. `GET /api/narration-media/[id]` serves private owner-only MP3 data with byte-range support; `?download=1` supplies an attachment. `GET /api/content/[id]/narration/captions?format=srt|vtt` downloads captions for the current completed job. API responses exclude raw character arrays, credentials, and R2 keys.

The existing Next.js Node worker and authenticated `/api/internal/visual-worker` dispatcher now process both image and narration jobs, alternating between stages. The same serverless scheduling requirements apply. Narration uses a four-minute lease, at most three manual attempts, retry cooldowns, and six provider admissions per account per UTC hour. The credit preflight is conservative but is not an account-wide reservation against usage by other clients. No provider-level exactly-once billing is claimed. Provider timeout or failure before the durable audio checkpoint may have consumed credits; recovery does not automatically make a new paid call. Once audio and its timing source are checkpointed, alignment retries reuse them without generating speech again.

Audio lives in R2; job state and timing metadata live in MongoDB. Transactional plan/revision fences stop stale workers attaching results after edits or replanning. The test suite uses a four-second synthetic test tone, mock ElevenLabs responses, and an in-memory R2 SDK transport. Production has no public mock switch. Live synthesis and R2 network transfers remain unverified pending configuration.

```sh
npm run test:narration
npm run test:narration:integration
npm run test:narration:integration -- --http # Start the local app first
```

## Authentication validation

```sh
npm run typecheck
npm run build
npm run test:auth  # Start the local app first; requires database access
npm run test:origins
npm run test:auth:origins # Signup/sign-in/draft writes on both local aliases
```

The integration checks use temporary, uniquely identified synthetic records and remove their users, accounts, sessions, invitations, dashboard fixtures, and rate-limit entries in a cleanup block. They verify authentication and optional invitations, dashboard routing/protection, empty states, own-versus-foreign content/jobs/publications/accounts/allowance, private-field exclusion, cookie attributes, session persistence, sign-out, remember-me, origin rejection, rate limiting, and removal of old routes. Do not terminate the test process before cleanup completes.

Design references: Stitch screens `16 Sign In` and `17 Invitation Signup` in `design/stitch/`. Manrope and Inter are served locally. Shared form components and global design tokens define responsive layouts, password visibility, input errors, pending/error states, and keyboard focus.

## Preserved video synchronization prototype

This prototype renders an English internet explainer using only the approved Viraj voice. Monika is the second allowed voice. The sample script is authored in `scripts/sample.mjs`; Gemini planning and generated illustrations are not part of this first synchronization test.

## Current result and account limitation

Both selected voices were verified in the shared library and added to My Voices. The current ElevenLabs account returned `402 paid_plan_required` for library-voice API synthesis. The sample narration was therefore generated through the normal logged-in ElevenLabs web interface using Viraj and Eleven v4, then downloaded. This is a prototype workflow, not a completed automated generation integration.

ElevenLabs forced alignment successfully aligned that audio with the exact transcript. The renderer uses the resulting character timestamps for word highlighting and scene boundaries. No background music is included.

## Commands

```sh
npm install
npm run generate       # Uses cached speech; new synthesis requires eligible API access
npm run align          # Aligns public/generated/narration.mp3 with the sample transcript
npm run stills         # Render one inspection image per scene
npm run render         # Render the full 1080x1920 H.264/AAC MP4
```

Run from the repository root. API secrets load only in Node from the ignored `.env.local`. They are never passed to the Remotion composition or browser bundle. Generated audio, alignment, and plan files are ignored under `public/generated/`; outputs are under `output/`.

The renderer receives its validated plan through Remotion `inputProps`; it does not statically import generated JSON. App type checking/building and Remotion bundling do not require `public/generated/`. Only an actual render requires a generated plan and narration. Run `npm run generate` (or the existing alignment workflow) before `npm run render`; a missing plan produces an actionable error rather than a module-resolution failure.

`npm run test:clean-checkout` stages source/configuration in an isolated temporary directory, reuses installed dependencies, and checks TypeScript and Remotion bundling without generated assets, environment files, or build caches. It also checks the missing-plan render error. Add `-- --metadata` to validate real Remotion composition metadata from runtime inputs; this optional check requires Remotion's headless browser. No provider calls or live-project assets are changed by these checks.

The render follows the actual narration length rather than cutting speech to a nominal 30-second target. Full-content regeneration should be deliberate: changing the script or selected voice invalidates the speech cache and invokes synthesis.

## Validation

Before rendering, the generator validates transcript equality and alignment array lengths. Six scene inspection frames are rendered before the complete video. Final checks cover the stream formats, dimensions, frame rate, audio/video start timestamps, duration, and complete media decoding. Word timing is model-derived and still benefits from human playback review.

## References

- https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps
- https://elevenlabs.io/docs/api-reference/forced-alignment/create
- https://www.remotion.dev/docs/renderer/render-media

## MongoDB foundation

The separate Atlas database is **`vidsutra_ai`**. `MONGODB_URI` explicitly targets this database and `MONGODB_DB=vidsutra_ai` is configured in the ignored `.env` and `.env.local` files. Both files are private local configuration; never commit their values. `.env.local` takes precedence in Next.js, so keep the MongoDB settings consistent if changing them.

Run `npm run db:setup` to initialize or verify the database. The command checks ownership before modifying an existing database, creates missing collections and indexes without dropping data, and verifies ping, write/read access, and index creation. All operations explicitly target `vidsutra_ai`; it does not inspect or modify the cluster's other databases. The server-only connection helper is `src/lib/server/mongodb.ts` and reuses a bounded MongoClient pool.

Collections: `_app_metadata`, `content_items`, `content_versions`, `generation_jobs`, `media_assets`, `social_accounts`, `publications`, `beta_invitations`, `usage_ledger`, `user_feedback`, `app_settings`, plus Better Auth's `user`, `account`, `session`, `verification`, and `rateLimit`. The schema/index manifest is `scripts/database-schema.mjs`. Authentication, dashboard reads, content drafts, planning, and visual job writes are integrated; narration, rendering, and publishing remain later stages. No admin accounts or quota allowances are seeded.

This setup uses the [official MongoDB Node.js driver](https://www.mongodb.com/docs/drivers/node/current/databases-collections/).

