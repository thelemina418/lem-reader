# Two channels, Next and Production; a release promotes the exact build Next ran

Lem Reader is served on two channels. **Next** (`next.reader.thelemina.dev`) is deployed on every push to `main`. **Production** (`reader.thelemina.dev`, plus the legacy domain `lem-reader.vercel.app`) moves only when a GitHub Release is published (not a draft or a pre-release) with a `vX.Y.Z` tag that matches `package.json`. Publishing a release does not rebuild. It promotes the deployment Next already built from that commit, and fails if Next never built it, so readers get exactly what was tested. Because one build can serve either channel, the channel is taken from the hostname at runtime. The version and commit SHA are built in. All deploys run from GitHub Actions on a GitHub-hosted runner, using the CLI launcher with a raised stack. Vercel's git integration stays off, and nobody, human or agent, deploys by hand.

## Considered options

- **Rebuild from the tag at release time** (rejected): what goes live would be a different artifact from the one tried on Next, and the release would depend on the build succeeding a second time.
- **Vercel git integration / cloud builds** (rejected for now): Vercel's builder runs out of stack on the roughly 16 MB `/api/ingest` bundle, and its build infrastructure can't take the raised stack the CLI launcher passes (see `.planning/debug/vercel-ingest-500.md`). Revisit if the bundle is split.
- **Promote ordinary preview deployments** (rejected): promoting a preview creates a new deployment, which brings back the rebuild. Next is instead deployed to the production target without assigning the production domains, then aliased to the Next domain, so promoting it is instant.
- **Channel built in at build time** (rejected): a promoted build would keep saying "Next" in Production.
- **Redirect the legacy domain to the new one** (rejected): the library lives in per-origin IndexedDB, so a redirect would land readers on an empty library while their real one stays behind. The legacy domain keeps serving Production and shows a one-time, dismissible notice (only when the library has content) that leads into export.
- **"Nightly" or "Preview" as the channel name** (rejected): Next is not scheduled, and "preview" means a per-change deploy, which Lem Reader does not have.

## Consequences

- Each channel and each domain has its own library, settings and annotations. Next shows a persistent channel marker and its commit SHA so it is never mistaken for Production.
- Next is public but sends `X-Robots-Tag: noindex`. The legacy domain sends `Link: <https://reader.thelemina.dev/>; rel="canonical"`. Both headers are keyed on the host.
- Rollback uses Vercel's Instant Rollback from the dashboard, as documented in the runbook. There is no custom rollback job.
- `npm run deploy:vercel` stays only as a documented emergency path. Agents may draft release notes, but never publish a release or deploy.
- The first release under this pipeline is `v2.1.0`, and it ships the legacy-domain notice.
