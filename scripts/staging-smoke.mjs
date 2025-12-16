#!/usr/bin/env node
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const BASE_URL = (process.env.STAGING_BASE_URL ?? process.env.NEXT_PUBLIC_API_GATEWAY_URL ?? "https://stg-vnext.get-latitude.com")
  .replace(/\/+$/, "");
const TOKEN = process.env.LATITUDE_TOKEN ?? process.env.AUTH_TOKEN ?? null;
const API_KEY = process.env.API_GATEWAY_KEY ?? process.env.NEXT_PUBLIC_API_GATEWAY_KEY ?? null;
const ALLOW_SELF_SIGNED = process.env.ALLOW_SELF_SIGNED === "true";

if (ALLOW_SELF_SIGNED && !process.env.NODE_TLS_REJECT_UNAUTHORIZED) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const headersForAuth = () => {
  const headers = {};
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  if (API_KEY) headers["x-api-key"] = API_KEY;
  return headers;
};

async function fetchJson(path, init = {}) {
  const url = `${BASE_URL}${path}`;
  let res;
  try {
    res = await fetch(url, {
      redirect: "manual",
      ...init,
      headers: {
        ...(init.headers ?? {}),
      },
    });
  } catch (error) {
    const cause = error?.cause;
    const code = cause?.code ?? error?.code;
    if (code === "DEPTH_ZERO_SELF_SIGNED_CERT") {
      throw new Error(
        `TLS failed due to self-signed cert at ${BASE_URL}. Re-run with ALLOW_SELF_SIGNED=true or NODE_TLS_REJECT_UNAUTHORIZED=0.`,
      );
    }
    throw error;
  }
  const text = await res.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { url, res, text, json };
}

function logResult(name, ok, details = "") {
  const status = ok ? "OK" : "FAIL";
  console.log(`${status} ${name}${details ? ` -- ${details}` : ""}`);
  if (!ok) {
    process.exitCode = 1;
  }
}

async function checkHealth() {
  const { res, url } = await fetchJson("/readyz");
  logResult("web /readyz", res.ok, `${res.status} ${url}`);
  const gwAggregate = await fetchJson("/api/healthz/aggregate");
  if (gwAggregate.res.status === 404) {
    const gwRoot = await fetchJson("/healthz");
    logResult("gateway /healthz", gwRoot.res.ok, `${gwRoot.res.status} ${gwRoot.url}`);
  } else {
    logResult("gateway /api/healthz/aggregate", gwAggregate.res.ok, `${gwAggregate.res.status} ${gwAggregate.url}`);
  }
}

async function checkAuth() {
  if (!TOKEN) {
    console.log("SKIP auth checks -- set LATITUDE_TOKEN to run.");
    return;
  }
  const me = await fetchJson("/api/auth/me", { headers: headersForAuth() });
  logResult("auth /api/auth/me", me.res.ok, `${me.res.status} ${me.url}`);
}

async function checkLinkedInIdentities() {
  const ids = await fetchJson("/web-api/publish/identities", { headers: headersForAuth() });
  const ok =
    ids.res.ok &&
    ids.json &&
    Array.isArray(ids.json.identities);
  const count = ok ? ids.json.identities.length : 0;
  logResult("linkedin identities /web-api/publish/identities", ok, `${ids.res.status} (${count} identities)`);
  if (!ok && ids.json?.error) {
    console.log("  error:", ids.json.error, ids.json.message ?? "");
  }
}

async function checkAnalytics() {
  if (!TOKEN) {
    console.log("SKIP analytics -- set LATITUDE_TOKEN to run.");
    return;
  }
  const highlights = await fetchJson("/api/analytics/highlights", { headers: headersForAuth() });
  logResult("analytics /api/analytics/highlights", highlights.res.ok, `${highlights.res.status}`);
  const summary = await fetchJson("/api/analytics/summary", { headers: headersForAuth() });
  logResult("analytics /api/analytics/summary", summary.res.ok, `${summary.res.status}`);
}

async function checkCommandCenter() {
  if (!TOKEN) {
    console.log("SKIP command center -- set LATITUDE_TOKEN to run.");
    return;
  }
  const campaigns = await fetchJson("/api/command-center/campaigns", { headers: headersForAuth() });
  logResult("command center /api/command-center/campaigns", campaigns.res.ok, `${campaigns.res.status}`);
}

async function checkPublishDryRun() {
  const dryRun = process.env.PUBLISH_DRY_RUN === "true";
  if (!dryRun) {
    console.log("SKIP publish -- set PUBLISH_DRY_RUN=true and provide PUBLISH_PAYLOAD_JSON to run.");
    return;
  }
  if (!TOKEN) {
    console.log("SKIP publish -- LATITUDE_TOKEN required.");
    return;
  }
  const payloadRaw = process.env.PUBLISH_PAYLOAD_JSON;
  if (!payloadRaw) {
    console.log("SKIP publish -- missing PUBLISH_PAYLOAD_JSON.");
    return;
  }
  let payload;
  try {
    payload = JSON.parse(payloadRaw);
  } catch {
    console.log("SKIP publish -- PUBLISH_PAYLOAD_JSON is not valid JSON.");
    return;
  }
  const publish = await fetchJson("/web-api/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headersForAuth() },
    body: JSON.stringify(payload),
  });
  logResult("publish /web-api/publish", publish.res.ok, `${publish.res.status} ${publish.url}`);
  const jobId = publish.json?.jobId ?? publish.json?.id ?? null;
  if (!jobId) return;

  const pollBase = `/api/growth/jobs/${jobId}`;
  for (let i = 0; i < 20; i++) {
    await delay(3000);
    const job = await fetchJson(pollBase, { headers: headersForAuth() });
    if (!job.res.ok) continue;
    const status = job.json?.status ?? job.json?.state;
    if (status && ["completed", "failed", "cancelled"].includes(String(status))) {
      logResult(`growth job ${jobId}`, status === "completed", `status=${status}`);
      return;
    }
  }
  logResult(`growth job ${jobId}`, false, "timed out waiting for completion");
}

async function main() {
  console.log(`Latitude staging smoke against ${BASE_URL}`);
  await checkHealth();
  await checkAuth();
  await checkLinkedInIdentities();
  await checkAnalytics();
  await checkCommandCenter();
  await checkPublishDryRun();
}

main().catch((err) => {
  console.error("Smoke run crashed:", err);
  process.exitCode = 1;
});
