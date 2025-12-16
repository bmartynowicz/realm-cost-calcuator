import process from 'node:process';

const BOOL_TRUE = new Set(['1', 'true', 'yes', 'on']);
const toBoolean = (value) => (value ? BOOL_TRUE.has(value.toLowerCase()) : false);
const hasValue = (value) => typeof value === 'string' && value.trim().length > 0;
const hasAll = (vars) => vars.every((envName) => hasValue(process.env[envName]));

const checks = [
  {
    name: 'LinkedIn publishing',
    anyOf: [
      ['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_REFRESH_TOKEN'],
      ['AUTH_SERVICE_URL'],
      ['LINKEDIN_IDENTITY_LOOKUP_URL'],
      ['LINKEDIN_SERVICE_URL'],
    ],
    forceFlag: 'FORCE_LINKEDIN_MOCKS',
    help: 'Set AUTH_SERVICE_URL/LINKEDIN_IDENTITY_LOOKUP_URL (preferred) or a LINKEDIN_ACCESS_TOKEN/REFRESH_TOKEN pair, or temporarily export FORCE_LINKEDIN_MOCKS=true.',
  },
  {
    name: 'LinkedIn community',
    anyOf: [
      ['LINKEDIN_COMMUNITY_ACCESS_TOKEN'],
      ['AUTH_SERVICE_URL'],
      ['LINKEDIN_IDENTITY_LOOKUP_URL'],
      ['LINKEDIN_SERVICE_URL'],
    ],
    forceFlag: 'FORCE_LINKEDIN_COMMUNITY_MOCKS',
    help: 'Provide AUTH_SERVICE_URL/LINKEDIN_IDENTITY_LOOKUP_URL (preferred) or LINKEDIN_COMMUNITY_ACCESS_TOKEN, or enable FORCE_LINKEDIN_COMMUNITY_MOCKS.',
  },
  {
    name: 'Email delivery',
    required: ['RESEND_API_KEY', 'RESEND_FROM_EMAIL'],
    forceFlag: 'FORCE_EMAIL_MOCKS',
    help: 'Provide Resend credentials or export FORCE_EMAIL_MOCKS=true.',
  },
  {
    name: 'Calendar scheduling',
    anyOf: [
      ['O365_CALENDAR_TENANT_ID', 'O365_CALENDAR_CLIENT_ID', 'O365_CALENDAR_CLIENT_SECRET', 'O365_CALENDAR_MAILBOX'],
      ['CALCOM_API_KEY', 'CALCOM_EVENT_TYPE'],
    ],
    forceFlag: 'FORCE_CALENDAR_MOCKS',
    help: 'Provide O365 Graph credentials (tenant/client id/client secret/mailbox) or Cal.com credentials, or export FORCE_CALENDAR_MOCKS=true.',
  },
  {
    name: 'CRM adapters',
    anyOf: [
      ['HUBSPOT_ACCESS_TOKEN'],
      ['SALESFORCE_ACCESS_TOKEN', 'SALESFORCE_BASE_URL'],
    ],
    forceFlag: 'FORCE_CRM_MOCKS',
    help: 'Provide HubSpot or Salesforce credentials or enable FORCE_CRM_MOCKS=true.',
  },
  {
    name: 'Object storage',
    required: ['OBJECT_STORAGE_ENDPOINT', 'OBJECT_STORAGE_ACCESS_KEY', 'OBJECT_STORAGE_SECRET_KEY', 'OBJECT_STORAGE_BUCKET'],
    forceFlag: 'FORCE_STORAGE_MOCKS',
    help: 'Provide S3/MinIO credentials or export FORCE_STORAGE_MOCKS=true.',
  },
  {
    name: 'Analytics telemetry',
    required: ['KAFKA_BROKERS', 'POSTGRES_URL'],
    forceFlag: 'FORCE_ANALYTICS_MOCKS',
    help: 'Ensure Kafka/Postgres are reachable or set FORCE_ANALYTICS_MOCKS=true for offline mocks.',
  },
];

export function validateEnvironment() {
  for (const check of checks) {
    let missing = [];
    if (Array.isArray(check.required)) {
      missing = check.required.filter((envName) => !hasValue(process.env[envName]));
    } else if (Array.isArray(check.anyOf)) {
      const hasCombination = check.anyOf.some((combo) => hasAll(combo));
      if (!hasCombination) {
        missing = check.anyOf.flat();
      }
    }
    const forceEnabled = toBoolean(process.env[check.forceFlag]);
    if (missing.length === 0) {
      if (forceEnabled) {
        console.warn(`[env] ${check.name}: real credentials found but ${check.forceFlag}=true so mocks remain enabled.`);
      } else {
        console.log(`[env] ${check.name}: credentials detected, running live.`);
      }
      continue;
    }
    if (forceEnabled) {
      console.warn(`[env] ${check.name}: missing ${missing.join(', ')}; proceeding with ${check.forceFlag}=true.`);
    } else {
      console.warn(
        `[env] ${check.name}: missing ${missing.join(', ')}. ${check.help} This will block the full workflow.`,
      );
    }
  }
}

if (process.argv[1] && process.argv[1].includes('validate-env')) {
  validateEnvironment();
}
