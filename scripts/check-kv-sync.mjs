#!/usr/bin/env node
/**
 * Verifies that Azure Key Vault secrets match the CSI-synced Kubernetes Secrets.
 * Requires Azure CLI (`az`) and kubectl to be installed and authenticated.
 *
 * Usage:
 *   node scripts/check-kv-sync.mjs --vault lat-staging-kv --namespace latitude-staging
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import process from 'node:process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag, fallback) => {
    const index = args.findIndex((arg) => arg === flag || arg.startsWith(`${flag}=`));
    if (index === -1) {
      return fallback;
    }
    const [_, inline] = args[index].split('=');
    if (inline) {
      return inline;
    }
    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      return next;
    }
    return fallback;
  };

  return {
    vaultName: get('--vault', process.env.KV_VAULT_NAME || 'lat-staging-kv'),
    namespace: get('--namespace', process.env.K8S_NAMESPACE || 'latitude-staging'),
    manifestPath: path.resolve(
      get(
        '--manifest',
        path.join(__dirname, '..', 'infra', 'k8s', 'keyvault', 'keyvault-secrets-latitude-staging.yaml'),
      ),
    ),
  };
}

function parseSecretMappings(yamlText) {
  const mappings = {};
  const lines = yamlText.split(/\r?\n/);
  let inSecretObjects = false;
  let currentSecret = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!inSecretObjects) {
      if (line.trim().startsWith('secretObjects:')) {
        inSecretObjects = true;
      }
      continue;
    }

    const secretMatch = line.match(/- secretName:\s+([^\s]+)/);
    if (secretMatch) {
      currentSecret = secretMatch[1];
      mappings[currentSecret] = [];
      continue;
    }

    if (!currentSecret) {
      continue;
    }

    const keyMatch = line.match(/- key:\s+([^\s]+)/);
    if (keyMatch) {
      let objectName = null;
      for (let j = i + 1; j < lines.length; j += 1) {
        const look = lines[j];
        if (look.match(/- secretName:/) || look.match(/- key:/)) {
          break;
        }
        const objectMatch = look.match(/objectName:\s+([^\s]+)/);
        if (objectMatch) {
          objectName = objectMatch[1];
          break;
        }
      }
      mappings[currentSecret].push({ key: keyMatch[1], objectName });
    }
  }

  return mappings;
}

function runCli(command, args) {
  const useShell = process.platform === 'win32';
  try {
    return execFileSync(command, args, { encoding: 'utf8', shell: useShell }).trim();
  } catch (error) {
    throw new Error(`Failed to run ${command} ${args.join(' ')}: ${error.message}`);
  }
}

const kvCache = new Map();
function readKeyVaultSecret(vaultName, objectName) {
  if (!objectName) {
    return null;
  }
  if (kvCache.has(objectName)) {
    return kvCache.get(objectName);
  }
  try {
    const value = runCli('az', [
      'keyvault',
      'secret',
      'show',
      '--vault-name',
      vaultName,
      '--name',
      objectName,
      '--query',
      'value',
      '-o',
      'tsv',
    ]);
    kvCache.set(objectName, value);
    return value;
  } catch (error) {
    kvCache.set(objectName, null);
    return null;
  }
}

const k8sCache = new Map();
function readKubernetesSecret(namespace, secretName) {
  if (k8sCache.has(secretName)) {
    return k8sCache.get(secretName);
  }
  try {
    const raw = runCli('kubectl', ['get', 'secret', secretName, '-n', namespace, '-o', 'json']);
    const parsed = JSON.parse(raw);
    const data = parsed.data || {};
    const decoded = {};
    for (const [key, value] of Object.entries(data)) {
      decoded[key] = Buffer.from(value, 'base64').toString('utf8');
    }
    k8sCache.set(secretName, decoded);
    return decoded;
  } catch (error) {
    k8sCache.set(secretName, null);
    return null;
  }
}

function hashValue(value) {
  return crypto.createHash('sha256').update(value ?? '').digest('hex');
}

async function main() {
  const options = parseArgs();
  const manifest = await readFile(options.manifestPath, 'utf8');
  const secretMappings = parseSecretMappings(manifest);
  if (Object.keys(secretMappings).length === 0) {
    throw new Error(`No secretObjects mappings found in ${options.manifestPath}`);
  }

  const missingK8sSecrets = [];
  const missingKvSecrets = [];
  const missingK8sKeys = [];
  const mismatchedValues = [];
  const extraK8sKeys = [];

  for (const [secretName, entries] of Object.entries(secretMappings)) {
    const k8sSecret = readKubernetesSecret(options.namespace, secretName);
    if (!k8sSecret) {
      missingK8sSecrets.push(secretName);
      continue;
    }

    const expectedKeys = new Set();
    for (const entry of entries) {
      expectedKeys.add(entry.key);
      const kvValue = readKeyVaultSecret(options.vaultName, entry.objectName);
      if (kvValue === null) {
        missingKvSecrets.push(entry.objectName);
        continue;
      }
      if (!(entry.key in k8sSecret)) {
        missingK8sKeys.push(`${secretName}:${entry.key}`);
        continue;
      }
      const kvHash = hashValue(kvValue);
      const k8sHash = hashValue(k8sSecret[entry.key]);
      if (kvHash !== k8sHash) {
        mismatchedValues.push(`${secretName}:${entry.key}`);
      }
    }

    for (const key of Object.keys(k8sSecret)) {
      if (!expectedKeys.has(key)) {
        extraK8sKeys.push(`${secretName}:${key}`);
      }
    }
  }

  if (missingK8sSecrets.length > 0) {
    console.error('Missing Kubernetes Secrets:', missingK8sSecrets.join(', '));
  }
  if (missingKvSecrets.length > 0) {
    console.error('Missing Key Vault secrets:', [...new Set(missingKvSecrets)].join(', '));
  }
  if (missingK8sKeys.length > 0) {
    console.error('Missing keys inside Kubernetes Secrets:', missingK8sKeys.join(', '));
  }
  if (mismatchedValues.length > 0) {
    console.error('Hash mismatch between Key Vault and Kubernetes:', mismatchedValues.join(', '));
  }
  if (extraK8sKeys.length > 0) {
    console.warn('Extra keys present in Kubernetes Secrets:', extraK8sKeys.join(', '));
  }

  const hasDrift =
    missingK8sSecrets.length > 0 ||
    missingKvSecrets.length > 0 ||
    missingK8sKeys.length > 0 ||
    mismatchedValues.length > 0;

  if (!hasDrift) {
    console.log(
      `All ${Object.keys(secretMappings).length} Key Vault -> Kubernetes secret mappings are in sync for namespace ${options.namespace}.`,
    );
  } else {
    process.exitCode = 1;
    console.error('Drift detected between Key Vault and Kubernetes secrets.');
  }
}

main().catch((error) => {
  console.error('[check-kv-sync] Failed to verify secrets:', error.message);
  process.exitCode = 1;
});
