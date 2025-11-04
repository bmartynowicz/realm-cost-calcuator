const KB_PER_GIGABYTE = 1024 * 1024;
const ORGANIZATION_SIZE_METAS = [
    {
        id: 'under-1000-gb',
        label: 'Less than 1,000 employees',
        optionLabel: 'Less than 1,000 employees',
        shortLabel: 'Less than 1,000 employees',
        defaultDailyGigabytes: 750,
        description: 'Ideal for smaller teams where log pipelines rarely exceed a terabyte per day.',
    },
    {
        id: '1000-5000-gb',
        label: '1,000 - 5,000 employees',
        optionLabel: '1,000 - 5,000 employees',
        shortLabel: '1,000 - 5,000 employees',
        defaultDailyGigabytes: 3000,
        description: 'Best fit for mid-size estates that typically ingest one to five terabytes daily.',
    },
    {
        id: 'over-5000-gb',
        label: '5,000+ employees',
        optionLabel: '5,000+ employees',
        shortLabel: '5,000+ employees',
        defaultDailyGigabytes: 6500,
        description: 'Use this for large enterprises where daily log volume usually tops five terabytes.',
    },
];
const ORGANIZATION_SIZE_INDEX = new Map(ORGANIZATION_SIZE_METAS.map((meta) => [meta.id, meta]));
const fallbackCategory = 'identity';
const categoryLabels = {
    identity: 'Identity and workforce access telemetry',
    'cloud-infrastructure': 'Cloud platform control-plane and audit activity',
    'network-security': 'Network flow, firewall, and secure service edge telemetry',
    'endpoint-edr': 'Endpoint detection and response telemetry',
    'saas-business': 'SaaS application and collaboration activity',
};
const categoryBaselines = {
    identity: {
        'under-1000-gb': { averageEventSizeKb: 1.2 },
        '1000-5000-gb': { averageEventSizeKb: 1.3 },
        'over-5000-gb': { averageEventSizeKb: 1.3 },
    },
    'cloud-infrastructure': {
        'under-1000-gb': { averageEventSizeKb: 1.6 },
        '1000-5000-gb': { averageEventSizeKb: 1.7 },
        'over-5000-gb': { averageEventSizeKb: 1.8 },
    },
    'network-security': {
        'under-1000-gb': { averageEventSizeKb: 0.12 },
        '1000-5000-gb': { averageEventSizeKb: 0.13 },
        'over-5000-gb': { averageEventSizeKb: 0.14 },
    },
    'endpoint-edr': {
        'under-1000-gb': { averageEventSizeKb: 3.5 },
        '1000-5000-gb': { averageEventSizeKb: 3.8 },
        'over-5000-gb': { averageEventSizeKb: 4 },
    },
    'saas-business': {
        'under-1000-gb': { averageEventSizeKb: 1.5 },
        '1000-5000-gb': { averageEventSizeKb: 1.6 },
        'over-5000-gb': { averageEventSizeKb: 1.7 },
    },
};
export const trafficCategoryLabels = categoryLabels;
export const organizationSizeOptions = ORGANIZATION_SIZE_METAS;
export const getOrganizationSizeMeta = (size) => {
    const meta = ORGANIZATION_SIZE_INDEX.get(size);
    if (!meta) {
        throw new Error(`Unknown organization size key: ${size}`);
    }
    return meta;
};
const getBaseline = (category, size) => {
    const categorySet = categoryBaselines[category] ?? categoryBaselines[fallbackCategory];
    const baseline = categorySet[size];
    if (!baseline) {
        throw new Error(`Missing baseline for category ${category} and size ${size}`);
    }
    return baseline;
};
export const getTrafficRecommendation = (endpoint, size) => {
    const meta = getOrganizationSizeMeta(size);
    const category = endpoint.trafficCategory ?? fallbackCategory;
    const baseline = getBaseline(category, size);
    const dailyGigabytes = meta.defaultDailyGigabytes;
    const averageEventSizeKb = baseline.averageEventSizeKb;
    const dailyEvents = Math.round((dailyGigabytes * KB_PER_GIGABYTE) / Math.max(averageEventSizeKb, 0.0001));
    return {
        organizationSize: meta,
        category,
        dailyEvents,
        dailyGigabytes,
        averageEventSizeKb,
    };
};
export const describeTrafficRecommendation = (recommendation) => {
    const { organizationSize, category, dailyEvents, averageEventSizeKb, dailyGigabytes } = recommendation;
    const categoryLabel = categoryLabels[category] ?? categoryLabels[fallbackCategory];
    const dailyTb = dailyGigabytes / 1024;
    const volumeDisplay = dailyGigabytes >= 1024
        ? `${dailyTb.toLocaleString(undefined, { maximumFractionDigits: 2 })} TB`
        : `${dailyGigabytes.toLocaleString(undefined, {
            maximumFractionDigits: dailyGigabytes >= 100 ? 0 : 1,
        })} GB`;
    return [
        `${categoryLabel} baseline for ${organizationSize.shortLabel.toLowerCase()}:`,
        `Approximately ${volumeDisplay} per day (~${dailyEvents.toLocaleString()} events at ${averageEventSizeKb.toFixed(1)} KB per event).`,
    ].join(' ');
};
