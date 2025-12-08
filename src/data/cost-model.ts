/**
 * Centralized pricing catalog and helper utilities for the Realm cost calculator.
 *
 * Updating this file when new integrations or pricing changes occur:
 * 1. Add or modify the relevant entry in the `sources` or `destinations` list.
 * 2. Keep the `unitCostPerMillion` aligned with the latest public pricing.
 * 3. Document any free tier adjustments in `freeTier` so UI copy remains accurate.
 * 4. Provide a `realmReduction` with its basis (empirical measurement or assumption)
 *    and a short reference that future revisions can follow up on.
 * 5. If the change impacts platform-level fees or competitor benchmarks, adjust the
 *    exported constants and update accompanying comments.
 */

export const REALM_PLATFORM_FEE_PER_MILLION = 7.5;

// Cribl baseline used for comparative messaging. Values stem from a January 2024
// field study of proof-of-concept deployments. Adjust when better data is available.
export const CRIBL_PLATFORM_FEE_PER_MILLION = 12;
export const CRIBL_DISCOUNT_FACTOR = 0.18; // Assumes Cribl realizes an 18% blend reduction.

export type RationaleBasis = 'empirical' | 'assumption';

export interface FreeTier {
  includedEventsPerMonth: number;
  notes: string;
}

export interface RealmReduction {
  /** Reduction factor expressed as decimal (0.25 === 25%). */
  factor: number;
  /** Indicates whether the factor is measurement-backed or a planning assumption. */
  basis: RationaleBasis;
  /** Short reference describing where the factor originated. */
  reference: string;
}

export interface IntegrationCost {
  id: string;
  label: string;
  description: string;
  unitCostPerMillion: number;
  freeTier?: FreeTier;
  realmReduction: RealmReduction;
  /** Additional context such as region caveats or billing nuances. */
  notes: string;
}

export type CostIntegrationKind = 'source' | 'destination';

const sourceNotes = {
  atlas: 'Includes cloud egress after exhausting the free 10 GB monthly allocation.',
  debezium: 'Kafka bridge costs excluded; adjust if a dedicated cluster is required.',
  salesforce:
    'Pricing tied to Enterprise edition event delivery. Monitor for API entitlement updates.',
  shopify: 'Assumes Plus tier webhook allowances with standard retry behavior.',
} as const;

export const sources: IntegrationCost[] = [
  {
    id: 'mongodb-atlas',
    label: 'MongoDB Atlas',
    description: 'Change Streams replication with 10 GB included egress.',
    unitCostPerMillion: 18,
    freeTier: {
      includedEventsPerMonth: 8_000_000,
      notes: '10 GB egress is roughly 8M 1 KB events before overage is charged.',
    },
    realmReduction: {
      factor: 0.32,
      basis: 'empirical',
      reference: 'Realm Labs change stream benchmark, Nov 2023.',
    },
    notes: sourceNotes.atlas,
  },
  {
    id: 'postgresql-debezium',
    label: 'PostgreSQL (Debezium)',
    description: 'Logical decoding via Debezium connectors and Kafka bridge.',
    unitCostPerMillion: 22,
    realmReduction: {
      factor: 0.27,
      basis: 'empirical',
      reference: 'Debezium + Realm soak test @ 40K eps, Jan 2024.',
    },
    notes: sourceNotes.debezium,
  },
  {
    id: 'salesforce',
    label: 'Salesforce',
    description: 'Streaming API events with Enterprise edition licensing.',
    unitCostPerMillion: 34,
    realmReduction: {
      factor: 0.42,
      basis: 'assumption',
      reference: 'Modeled from customer advisory board feedback, Q4 2023.',
    },
    notes: sourceNotes.salesforce,
  },
  {
    id: 'shopify',
    label: 'Shopify',
    description: 'Webhook based product/order synchronization.',
    unitCostPerMillion: 16,
    freeTier: {
      includedEventsPerMonth: 1_500_000,
      notes: 'Shopify Plus includes 50 credits/min; converted to monthly event allowance.',
    },
    realmReduction: {
      factor: 0.25,
      basis: 'empirical',
      reference: 'Realm connector profiling against Shopify Plus sandbox, Aug 2023.',
    },
    notes: sourceNotes.shopify,
  },
];

const destinationNotes = {
  snowflake: 'Assumes medium virtual warehouse running 1 hour/day with auto-suspend.',
  bigquery: 'On-demand analysis pricing; slot reservations may reduce this further.',
  dynamodb: 'Modeled with write capacity mode and adaptive capacity enabled.',
  s3: 'Lifecycle transitions to infrequent access not included in base rate.',
} as const;

export const destinations: IntegrationCost[] = [
  {
    id: 'snowflake',
    label: 'Snowflake',
    description: 'Warehouse ingestion with medium-sized virtual warehouse.',
    unitCostPerMillion: 24,
    realmReduction: {
      factor: 0.38,
      basis: 'empirical',
      reference: 'Snowpipe auto-ingest benchmark, Dec 2023.',
    },
    notes: destinationNotes.snowflake,
  },
  {
    id: 'bigquery',
    label: 'BigQuery',
    description: 'Streaming inserts with on-demand pricing.',
    unitCostPerMillion: 21,
    realmReduction: {
      factor: 0.33,
      basis: 'empirical',
      reference: 'GCP dataflow comparison run, Feb 2024.',
    },
    notes: destinationNotes.bigquery,
  },
  {
    id: 'dynamodb',
    label: 'Amazon DynamoDB',
    description: 'Write capacity mode optimized for incremental updates.',
    unitCostPerMillion: 19,
    realmReduction: {
      factor: 0.24,
      basis: 'assumption',
      reference: 'Projected from DynamoDB write optimization whitepaper, 2022.',
    },
    notes: destinationNotes.dynamodb,
  },
  {
    id: 's3-lake',
    label: 'Amazon S3 Data Lake',
    description: 'Event batching into S3 with lifecycle transitions.',
    unitCostPerMillion: 14,
    realmReduction: {
      factor: 0.18,
      basis: 'assumption',
      reference: 'Assumes 180 KB object batching per Realm design doc RFC-417.',
    },
    notes: destinationNotes.s3,
  },
];

export interface CostComputationInput {
  source: IntegrationCost;
  destination: IntegrationCost;
  dailyEvents: number;
}

export interface CostEstimate {
  dailyEvents: number;
  /** Millions of events per day derived from the provided daily volume. */
  millionsOfEvents: number;
  standard: {
    ratePerMillion: number;
    total: number;
  };
  realm: {
    ratePerMillion: number;
    platformFeePerMillion: number;
    total: number;
    savings: number;
    savingsPercentage: number;
    reductionApplied: number;
  };
  cribl: {
    ratePerMillion: number;
    platformFeePerMillion: number;
    total: number;
    savingsVsStandard: number;
    savingsVsRealm: number;
    discountFactor: number;
  };
}

export const calculateCombinedReduction = (
  source: IntegrationCost,
  destination: IntegrationCost,
): number => {
  const blended = (source.realmReduction.factor + destination.realmReduction.factor) / 2;
  return Math.min(0.65, Math.max(0, blended));
};

export const estimateCosts = ({
  source,
  destination,
  dailyEvents,
}: CostComputationInput): CostEstimate => {
  const sanitizedDailyEvents = Number.isFinite(dailyEvents) && dailyEvents > 0 ? dailyEvents : 0;
  const millions = sanitizedDailyEvents / 1_000_000;

  const standardRatePerMillion = source.unitCostPerMillion + destination.unitCostPerMillion;
  const standardTotal = millions * standardRatePerMillion;

  const realmReduction = calculateCombinedReduction(source, destination);
  const realmRatePerMillion = standardRatePerMillion * (1 - realmReduction);
  const realmTotal =
    millions * (realmRatePerMillion + REALM_PLATFORM_FEE_PER_MILLION);
  const realmSavings = standardTotal - realmTotal;
  const realmSavingsPercentage = standardTotal
    ? (realmSavings / standardTotal) * 100
    : 0;

  const criblBlendedRate = standardRatePerMillion * (1 - CRIBL_DISCOUNT_FACTOR);
  const criblRatePerMillion = criblBlendedRate + CRIBL_PLATFORM_FEE_PER_MILLION;
  const criblTotal = millions * criblRatePerMillion;
  const criblSavingsVsStandard = standardTotal - criblTotal;
  const criblSavingsVsRealm = realmTotal - criblTotal;

  return {
    dailyEvents: sanitizedDailyEvents,
    millionsOfEvents: millions,
    standard: {
      ratePerMillion: standardRatePerMillion,
      total: standardTotal,
    },
    realm: {
      ratePerMillion: realmRatePerMillion,
      platformFeePerMillion: REALM_PLATFORM_FEE_PER_MILLION,
      total: realmTotal,
      savings: realmSavings,
      savingsPercentage: realmSavingsPercentage,
      reductionApplied: realmReduction,
    },
    cribl: {
      ratePerMillion: criblRatePerMillion,
      platformFeePerMillion: CRIBL_PLATFORM_FEE_PER_MILLION,
      total: criblTotal,
      savingsVsStandard: criblSavingsVsStandard,
      savingsVsRealm: criblSavingsVsRealm,
      discountFactor: CRIBL_DISCOUNT_FACTOR,
    },
  };
};

export const getIntegrationById = (
  list: IntegrationCost[],
  id: string,
): IntegrationCost => {
  const integration = list.find((item) => item.id === id);
  if (!integration) {
    throw new Error(`Unknown integration id: ${id}`);
  }
  return integration;
};
