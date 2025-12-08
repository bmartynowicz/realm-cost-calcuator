# Realm Cost Calculator

An interactive, client-side tool for estimating daily integration costs and projected
savings when routing data through Realm. The calculator lets you choose from 44
enterprise data sources spanning network, identity, infrastructure, and endpoint
telemetry plus the top 20 SIEM destinations, enter expected daily traffic, and
immediately compare traditional integration spend versus Realm's optimized
approach.

## Feature highlights

- Daily volume tiers auto-populate realistic traffic baselines using category-specific event sizes.
  See [`docs/traffic-baselines.md`](docs/traffic-baselines.md) for the research notes behind each tier.
- Per-terabyte pricing model makes costs explicit ($500k/TB legacy SIEM vs $70k/TB Realm Focus), with ROI and data-reduction outputs in the results panel.
- Executive summary PDF export packages the current scenario for finance or procurement stakeholders.
- Competitive benchmarking against Cribl is temporarily hidden while we prep the V2 experience.
- Updated data catalog and supporting research samples live under [`research/`](research/), making it easy to
  trace every assumption back to a published source.
- Automated Playwright QA runs critical journeys (traffic presets and validation) on each build.

## Getting started

The project uses [Vite](https://vitejs.dev/) with a TypeScript entry point for a fast
local development experience.

### Prerequisites

- Node.js 18 or newer (to match Vite's engine requirement)
- npm 8+

### Installation

```bash
npm install
```

### Available scripts

```bash
# Start a local development server with hot module reloading
npm run dev

# Type-check and create a production build in dist/
npm run build

# Preview the production build locally
npm run preview

# Run the headless QA suite
npm run qa
```

Once the dev server is running, open the printed localhost URL to explore the calculator.

> **Quick preview without dependencies**
>
> If you simply want to view the calculator without installing npm packages, run `tsc`
> from the project root (TypeScript is available globally in this environment) and open
> [`preview.html`](preview.html) in a static server such as `python -m http.server`.
> The page loads the compiled `src/main.js` bundle directly for a zero-build walkthrough.

### Sandbox server (click-around demo)

Need a disposable sandbox to explore the experience without the Vite toolchain? Use the
bundled Node server, which serves `preview.html` and the compiled JavaScript directly:

```bash
# No npm install required
npm run sandbox

# `npm start` is an alias for the same command if you prefer muscle memory defaults
npm start
```

The script starts a static server on <http://localhost:4178>. Open that URL in your
browser to click around the calculator with hot-reloading disabled. Set the `PORT`
environment variable if you need a different port.

#### Troubleshooting the sandbox script

- If you see `npm ERR! Missing script: "sandbox"`, ensure your working copy is on the
  latest commit (`git pull` or re-checkout the repository). The sandbox command lives in
  the root `package.json`.
- You can always bypass npm scripts entirely by running `node sandbox/server.mjs` from
  the project root - the server has no external dependencies.

## Project structure

```
index.html                   # Application shell served by Vite
preview.html                 # Static preview wired to the compiled JS bundle
public/realm-cost-flow.svg   # High-level integration flow for demos and docs
src/main.ts                  # Calculator logic and DOM bindings
src/data/catalog.ts          # Shared catalog of sources and SIEM destinations
src/data/traffic-profiles.ts # Organization size traffic baselines
src/styles.css               # Global styling for the single-page experience
docs/traffic-baselines.md    # Research notes backing the new presets
docs/CHANGELOG.md         # Narrative history of recent changes
research/                    # Sample payloads and telemetry references
tests/                       # Playwright QA scenarios (run with `npm run qa`)
```

Static assets placed in `public/` are copied as-is to the output directory during builds.

## Customizing the model

The pricing assumptions live in `src/data/catalog.ts`, which exports the 44-entry
`sources` array and top-20 `destinations` array. Adjust the per-terabyte pricing and
optimization percentages to fit your data contracts, and tweak the Realm TB rate in
`src/main.ts` (and the mirrored values in `src/data/cost-model.ts`) to reflect your Realm
platform agreement.

Organization size presets and traffic baselines are defined in
`src/data/traffic-profiles.ts` and documented in
[`docs/traffic-baselines.md`](docs/traffic-baselines.md). Update both the code and the
research note whenever you calibrate those defaults.

After editing the TypeScript sources, run `npm run build` so the compiled JavaScript used
by `preview.html` and the sandbox server stays in sync, and execute `npm run qa` to
confirm the UI flows still pass the automated checks.

## Quality assurance

The repository includes a headless Playwright suite that spins up the Vite dev server and
tests critical calculator flows:

```bash
npm run qa
```

The scenarios cover traffic presets and validation around the
executive summary export. Review the generated traces in `playwright-report/` if a test
fails during local development or CI.
