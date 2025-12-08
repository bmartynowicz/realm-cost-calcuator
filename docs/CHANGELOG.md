# Changelog

## 2025-12-08

- Removed the "Monthly events" framing from the calculator documentation so every reference now speaks in terms of daily traffic, matching the code updates in `index.html` and `src/main.ts`.
- Clarified the backlog export to mark the "Remove Monthly Events" request as satisfied and to note that the experience now surfaces daily savings.

## 2025-11-03

- Replaced organization-size presets with daily volume tiers (Under 1,000 GB, 1,000-5,000 GB, 5,000+ GB).
- Defaulted traffic modeling to gigabytes per day and removed the manual average event size input.

## 2025-10-28

- Added organization-size traffic presets backed by documented baselines.
- Surfaced event size controls that appear when modeling gigabytes or terabytes.
- Introduced a Cribl benchmark card with work-email gating and validation.
- Delivered executive-summary PDF export with jsPDF loading and error handling.
- Refreshed the Realm vs. Legacy cost comparison logic and calibration overrides.
- Shipped a Playwright QA suite covering presets, validation, and competitor comparisons.
- Published new research assets under `research/` and the system flow diagram in `public/realm-cost-flow.svg`.
