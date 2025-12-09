# Changelog

## 2025-12-08

- Synced the source catalog to the full "Data Source - Priority" list (44 sources) and documented the sheet snapshot in `docs/V2/data-source-priority.md`. The UI copy now reflects the expanded catalog and remains covered by automated QA.
- Removed the "Monthly events" framing from the calculator documentation so every reference now speaks in terms of daily traffic, matching the code updates in `index.html` and `src/main.ts`.
- Clarified the backlog export to mark the "Remove Monthly Events" request as satisfied and to note that the experience now surfaces daily savings.
- Shifted the cost model to per-terabyte pricing ($500k/TB traditional SIEM vs $70k/TB Realm Focus), added ROI and data-reduction outputs to the UI, and covered them with Playwright assertions.
- Added an in-product pricing note to spell out Realm’s $70k/TB all-in cost versus the $500k/TB SIEM benchmark for transparency (Shortcut 4066).
- Default traffic unit now loads as terabytes; QA updated to expect TB-first recommendations.
- Destination list now matches Devon’s confirmed set (Splunk, Sumo, S3/GCS/Azure Blob, Chronicle, Exabeam, Datadog, Cortex XSIAM, Hydrolix, Databricks, Snowflake, Panther, SentinelOne, Elastic SIEM, Hunters, CrowdStrike NG SIEM, MS Sentinel).

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
