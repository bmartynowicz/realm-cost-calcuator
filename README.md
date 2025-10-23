# Realm Cost Calculator

An interactive, client-side tool for estimating monthly integration costs and projected
savings when routing data through Realm. The calculator lets you choose from 50
enterprise data sources spanning network, identity, infrastructure, and endpoint
telemetry plus the top 20 SIEM destinations, enter expected daily traffic, and
immediately compare traditional integration spend versus Realm's optimized
approach.

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
  the project root — the server has no external dependencies.

## Project structure

```
index.html         # Application shell and layout
src/main.ts        # Calculator logic and DOM bindings
src/styles.css     # Global styling for the single-page experience
```

Static assets placed in `public/` are copied as-is to the output directory during builds.

## Customizing the model

The pricing assumptions live in `src/main.ts` within the 50-entry `sources` array and the
top-20 `destinations` array. Adjust the per-million event pricing or optimization
percentages to fit your data contracts, and tweak the `REALM_PLATFORM_FEE_PER_MILLION`
constant to reflect your Realm platform agreement.
