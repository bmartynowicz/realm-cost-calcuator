# Realm Cost Calculator

An interactive, client-side tool for estimating monthly integration costs and projected
savings when routing data through Realm. The calculator lets you choose from common source
and destination systems, enter expected daily traffic, and immediately compare traditional
integration spend versus Realm's optimized approach.

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

## Project structure

```
index.html         # Application shell and layout
src/main.ts        # Calculator logic and DOM bindings
src/styles.css     # Global styling for the single-page experience
```

Static assets placed in `public/` are copied as-is to the output directory during builds.

## Customizing the model

The pricing assumptions live in `src/main.ts` within the `sources` and `destinations`
arrays. Adjust the per-million event pricing or optimization percentages to fit your
data contracts, and tweak the `REALM_PLATFORM_FEE_PER_MILLION` constant to reflect your
Realm platform agreement.
