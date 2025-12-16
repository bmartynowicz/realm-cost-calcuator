#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);

function usage(message) {
  if (message) {
    console.error(message);
  }
  console.error(`Usage: ${path.basename(process.argv[1])} --overlay <path> --namespace <ns> [--max-pods <count>]`);
  console.error('  --overlay     Kustomize overlay path to apply');
  console.error('  --namespace   Target namespace for guardrails and cluster lookups');
  console.error('  --max-pods    Maximum allowed targeted pods (default: 9 or $MAX_PODS_GUARDRAIL)');
  process.exit(1);
}

function parseFlag(flagName) {
  const index = args.indexOf(flagName);
  if (index === -1 || index === args.length - 1) {
    return null;
  }
  return args[index + 1];
}

const overlay = parseFlag('--overlay');
const namespace = parseFlag('--namespace') ?? process.env.NAMESPACE;
const maxPods = Number.parseInt(parseFlag('--max-pods') ?? process.env.MAX_PODS_GUARDRAIL ?? '9', 10);

if (!overlay) {
  usage('Missing required flag: --overlay');
}

if (!namespace) {
  usage('Missing required flag: --namespace (or set NAMESPACE)');
}

if (Number.isNaN(maxPods) || maxPods < 1) {
  usage('Invalid --max-pods value; it must be a positive integer');
}

function runKubectl(commandArgs, { allowNonZero = false, inheritStdio = false } = {}) {
  const result = spawnSync('kubectl', commandArgs, {
    encoding: 'utf-8',
    stdio: inheritStdio ? 'inherit' : 'pipe',
  });

  if (result.error) {
    console.error(`kubectl ${commandArgs.join(' ')} failed: ${result.error.message}`);
    process.exit(1);
  }

  if (!allowNonZero && result.status !== 0) {
    console.error((result.stderr || '').trim() || `kubectl ${commandArgs.join(' ')} exited with status ${result.status}`);
    process.exit(result.status ?? 1);
  }

  return result;
}

function normalizeItems(payload) {
  if (!payload) return [];
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload)) return payload;
  return [];
}

function replicaCount(resource) {
  const replicas = resource?.spec?.replicas;
  if (Number.isInteger(replicas) && replicas >= 0) {
    return replicas;
  }
  return 1;
}

function extractWorkloads(items, targetNamespace) {
  const workloads = new Map();
  for (const resource of items) {
    const { kind, metadata = {}, spec = {} } = resource;
    const name = metadata.name;
    if (!kind || !name) continue;

    const resourceNamespace = metadata.namespace ?? targetNamespace;
    if (resourceNamespace !== targetNamespace) {
      continue;
    }

    if (['Deployment', 'StatefulSet', 'ReplicaSet', 'ReplicationController', 'DaemonSet'].includes(kind)) {
      const replicas = kind === 'DaemonSet' ? 1 : replicaCount({ spec });
      const key = `${kind}/${name}`;
      workloads.set(key, { kind, name, namespace: resourceNamespace, replicas });
    }
  }
  return workloads;
}

function sumReplicas(workloadMap) {
  let total = 0;
  for (const workload of workloadMap.values()) {
    total += workload.replicas ?? 0;
  }
  return total;
}

function formatWorkloadSummary(title, workloadMap) {
  const rows = Array.from(workloadMap.values())
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
    .map(({ kind, name, replicas }) => `${kind.padEnd(16)} ${name.padEnd(32)} replicas=${replicas}`);
  if (rows.length === 0) {
    return `${title}: none`;
  }
  return `${title}:\n${rows.map((row) => `  ${row}`).join('\n')}`;
}

function printGuardrailSummary(currentWorkloads, plannedWorkloads, mergedWorkloads) {
  console.log(formatWorkloadSummary('Current workloads', currentWorkloads));
  console.log(formatWorkloadSummary('Planned workloads', plannedWorkloads));
  console.log(formatWorkloadSummary('Projected workloads', mergedWorkloads));
  console.log(`Projected pod total: ${sumReplicas(mergedWorkloads)} (limit: ${maxPods})`);
}

const plannedResult = runKubectl(['apply', '-k', overlay, '--dry-run=client', '-o', 'json']);
const plannedItems = normalizeItems(JSON.parse(plannedResult.stdout || '{}'));
const plannedWorkloads = extractWorkloads(plannedItems, namespace);

const currentResult = runKubectl(['get', 'deployments,statefulsets,replicasets,replicationcontrollers,daemonsets', '-n', namespace, '-o', 'json'], {
  allowNonZero: true,
});
const currentItems = currentResult.status === 0 ? normalizeItems(JSON.parse(currentResult.stdout || '{}')) : [];
const currentWorkloads = extractWorkloads(currentItems, namespace);

const mergedWorkloads = new Map(currentWorkloads);
for (const [key, workload] of plannedWorkloads.entries()) {
  mergedWorkloads.set(key, workload);
}

printGuardrailSummary(currentWorkloads, plannedWorkloads, mergedWorkloads);

const projectedTotal = sumReplicas(mergedWorkloads);
if (projectedTotal > maxPods) {
  console.error(`\nRefusing to apply ${overlay} because it would target ${projectedTotal} pods (limit ${maxPods}).`);
  process.exit(1);
}

console.log(`\nRunning kubectl diff for ${overlay}...`);
const diffResult = runKubectl(['diff', '-k', overlay], { allowNonZero: true, inheritStdio: true });
if (diffResult.status !== 0 && diffResult.status !== 1) {
  console.error('kubectl diff failed; aborting apply.');
  process.exit(diffResult.status ?? 1);
}

console.log('\nApplying manifests...');
runKubectl(['apply', '-k', overlay], { inheritStdio: true });
console.log('Apply complete.');
