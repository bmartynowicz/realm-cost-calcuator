const ORGANIZATION_SIZE_METAS = [
    {
        id: 'hundreds',
        label: '100-999 employees',
        optionLabel: 'Hundreds (100-999 employees)',
        shortLabel: 'Hundreds of employees',
        approxEmployees: 350,
        description: 'Regional or growth-stage organizations with focused security coverage and shared operations staff.',
    },
    {
        id: 'thousands',
        label: '1,000-9,999 employees',
        optionLabel: 'Thousands (1,000-9,999 employees)',
        shortLabel: 'Thousands of employees',
        approxEmployees: 3500,
        description: 'Enterprise environments with dedicated security operations, mixed automation, and multiple business units.',
    },
    {
        id: 'tens-of-thousands',
        label: '10,000+ employees',
        optionLabel: 'Tens of thousands (10,000+ employees)',
        shortLabel: 'Tens of thousands of employees',
        approxEmployees: 35000,
        description: 'Global organizations operating at scale with hybrid environments and 24/7 security coverage.',
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
        hundreds: { eventsPerEmployeePerDay: 45, averageEventSizeKb: 1.2 },
        thousands: { eventsPerEmployeePerDay: 52, averageEventSizeKb: 1.3 },
        'tens-of-thousands': { eventsPerEmployeePerDay: 60, averageEventSizeKb: 1.3 },
    },
    'cloud-infrastructure': {
        hundreds: { eventsPerEmployeePerDay: 320, averageEventSizeKb: 1.6 },
        thousands: { eventsPerEmployeePerDay: 450, averageEventSizeKb: 1.7 },
        'tens-of-thousands': { eventsPerEmployeePerDay: 620, averageEventSizeKb: 1.8 },
    },
    'network-security': {
        hundreds: { eventsPerEmployeePerDay: 900, averageEventSizeKb: 0.12 },
        thousands: { eventsPerEmployeePerDay: 1100, averageEventSizeKb: 0.13 },
        'tens-of-thousands': { eventsPerEmployeePerDay: 1400, averageEventSizeKb: 0.14 },
    },
    'endpoint-edr': {
        hundreds: { eventsPerEmployeePerDay: 160, averageEventSizeKb: 3.5 },
        thousands: { eventsPerEmployeePerDay: 210, averageEventSizeKb: 3.8 },
        'tens-of-thousands': { eventsPerEmployeePerDay: 275, averageEventSizeKb: 4 },
    },
    'saas-business': {
        hundreds: { eventsPerEmployeePerDay: 28, averageEventSizeKb: 1.5 },
        thousands: { eventsPerEmployeePerDay: 36, averageEventSizeKb: 1.6 },
        'tens-of-thousands': { eventsPerEmployeePerDay: 45, averageEventSizeKb: 1.7 },
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
    const dailyEvents = Math.round(meta.approxEmployees * baseline.eventsPerEmployeePerDay);
    return {
        organizationSize: meta,
        category,
        dailyEvents,
        averageEventSizeKb: baseline.averageEventSizeKb,
        eventsPerEmployeePerDay: baseline.eventsPerEmployeePerDay,
    };
};
export const describeTrafficRecommendation = (recommendation) => {
    const { organizationSize, category, dailyEvents, averageEventSizeKb } = recommendation;
    const dailyKb = dailyEvents * averageEventSizeKb;
    const dailyGb = dailyKb / 1048576;
    const dailyTb = dailyGb / 1024;
    const volumeDisplay = dailyGb < 1
        ? `${dailyKb.toLocaleString(undefined, { maximumFractionDigits: 0 })} KB`
        : dailyTb >= 1
            ? `${dailyTb.toLocaleString(undefined, { maximumFractionDigits: 2 })} TB`
            : `${dailyGb.toLocaleString(undefined, { maximumFractionDigits: 2 })} GB`;
    return [
        `${categoryLabels[category]} baseline for ${organizationSize.shortLabel.toLowerCase()}:`,
        `Approximately ${dailyEvents.toLocaleString()} events/day (${volumeDisplay} at ${averageEventSizeKb.toFixed(1)} KB per event).`,
    ].join(' ');
};
