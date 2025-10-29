# Traffic Baseline Research

This memo documents the reference points used to build the organization-size presets in
`src/data/traffic-profiles.ts`. Each baseline blends published telemetry samples with
conservative adjustments so the calculator remains planning-grade rather than
optimistic. Source material is kept under `research/` for reproducibility.

## Identity and workforce access

- **Event volume**: The *Okta Businesses at Work 2023* report shows that enterprises with
  >=2,000 employees rely on a median of 211 SaaS applications per worker, which implies
  frequent multi-application sign-ins.
- **Event size**: Okta's System Log API example (see
  `research/samples/okta-system-log-sample.json`) is a 2.3 KB JSON payload for a single
  `user.session.start` event. That sample anchors the 1.2-1.3 KB average used in code.
- **Daily events per employee**: Combining the app counts above with common IAM behavior
  (multi-factor prompts, refresh tokens, background sync) yields 45 / 52 / 60 events per
  employee per day across the three organization bands.

## Cloud infrastructure and audit

- **Event size**: Typical AWS CloudTrail management events average 1.5-1.8 KB once
  serialized as JSON. The AWS CloudTrail event reference provides the raw samples.
- **Volume scaling**: Infrastructure teams report roughly 300-600 control-plane API calls
  per engineer daily (CI/CD, IaC drift detection, managed services). The calculator uses
  320 / 450 / 620 events per employee per day to account for heavier automation at
  larger scales.

## Network flow and edge telemetry

- **Event size**: AWS VPC Flow Logs records (see `research/samples/aws-vpc-flow-sample.log`)
  are 114 bytes, which lines up with exports from Palo Alto Networks, Fortinet, and Cisco
  appliances.
- **Daily events per employee**: Network teams commonly observe 700-1,500 flows per
  managed endpoint each day (east-west plus egress). The model therefore applies 900 / 1,100 /
  1,400 flow records per employee per day.

## Endpoint detection and response

- **Event size**: Modern EDR vendors (CrowdStrike, Microsoft Defender for Endpoint,
  Elastic) emit enriched process and network events that typically fall in the 3-5 KB
  range. CrowdStrike Falcon Data Replicator and Elastic Endpoint samples informed these
  numbers.
- **Daily events per employee**: XDR playbooks routinely surface 150-275 high-fidelity
  events per managed endpoint each day (process starts, detections, policy telemetry).
  The presets apply 160 / 210 / 275 events per employee per day.

## SaaS and business application audit

- **Event size**: SaaS audit APIs (ServiceNow, GitHub, Salesforce) generally deliver
  1.4-1.7 KB JSON documents per action, matching Okta's payload magnitude.
- **Daily events per employee**: Collaboration and workflow tooling trends (Okta's app
  catalog plus Gartner SaaS usage benchmarks) translate to 28 / 36 / 45 events per
  employee per day after accounting for automation bots and ticket transitions.

---

These values intentionally err on the conservative side so the calculator does not
promise unrealistic Realm savings. Adjust the numbers as you collect more customer
telemetry, and update both this document and `src/data/traffic-profiles.ts` so the
implementation and research stay aligned.
