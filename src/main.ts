import {
  sources,
  destinations,
  estimateCosts,
  getIntegrationById,
  type IntegrationCost,
} from './data/cost-model';

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value < 100 ? 2 : 0,
  }).format(value);

const formatNumber = (value: number): string =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);

const sourceSelect = document.querySelector<HTMLSelectElement>('#sourceSelect');
const destinationSelect =
  document.querySelector<HTMLSelectElement>('#destinationSelect');
const trafficInput = document.querySelector<HTMLInputElement>('#trafficInput');
const sourceSummary = document.querySelector<HTMLSpanElement>('#sourceSummary');
const destinationSummary =
  document.querySelector<HTMLSpanElement>('#destinationSummary');
const trafficError = document.querySelector<HTMLSpanElement>('#trafficError');
const monthlyEventsEl = document.querySelector<HTMLElement>('#monthlyEvents');
const standardCostEl = document.querySelector<HTMLElement>('#standardCost');
const realmCostEl = document.querySelector<HTMLElement>('#realmCost');
const savingsEl = document.querySelector<HTMLElement>('#savings');
const standardBreakdownEl =
  document.querySelector<HTMLElement>('#standardBreakdown');
const realmBreakdownEl = document.querySelector<HTMLElement>('#realmBreakdown');
const savingsPercentEl = document.querySelector<HTMLElement>('#savingsPercent');

const assertElement = <T>(value: T | null, label: string): T => {
  if (value === null) {
    throw new Error(`${label} element was not found in the document`);
  }
  return value;
};

const requiredSourceSelect = assertElement(sourceSelect, 'Source select');
const requiredDestinationSelect = assertElement(
  destinationSelect,
  'Destination select',
);
const requiredTrafficInput = assertElement(trafficInput, 'Traffic input');
const requiredSourceSummary = assertElement(sourceSummary, 'Source summary');
const requiredDestinationSummary = assertElement(
  destinationSummary,
  'Destination summary',
);
const requiredTrafficError = assertElement(trafficError, 'Traffic error');
const requiredMonthlyEvents = assertElement(monthlyEventsEl, 'Monthly events');
const requiredStandardCost = assertElement(standardCostEl, 'Standard cost');
const requiredRealmCost = assertElement(realmCostEl, 'Realm cost');
const requiredSavings = assertElement(savingsEl, 'Savings');
const requiredStandardBreakdown = assertElement(
  standardBreakdownEl,
  'Standard breakdown',
);
const requiredRealmBreakdown = assertElement(
  realmBreakdownEl,
  'Realm breakdown',
);
const requiredSavingsPercent = assertElement(
  savingsPercentEl,
  'Savings percent',
);

const populateSelect = (select: HTMLSelectElement, items: IntegrationCost[]) => {
  select.innerHTML = '';
  for (const endpoint of items) {
    const option = document.createElement('option');
    option.value = endpoint.id;
    option.textContent = endpoint.label;
    select.appendChild(option);
  }
};

const renderSummary = (element: HTMLElement, endpoint: IntegrationCost) => {
  const summaryParts = [
    endpoint.description,
    `${formatCurrency(endpoint.unitCostPerMillion)} per million events`,
  ];

  if (endpoint.freeTier) {
    summaryParts.push(
      `${formatNumber(endpoint.freeTier.includedEventsPerMonth)} events included`,
    );
  }

  element.textContent = summaryParts.join(' • ');
};

const update = () => {
  const source = getIntegrationById(sources, requiredSourceSelect.value);
  const destination = getIntegrationById(
    destinations,
    requiredDestinationSelect.value,
  );
  renderSummary(requiredSourceSummary, source);
  renderSummary(requiredDestinationSummary, destination);

  const rawTraffic = requiredTrafficInput.value.trim();
  const parsedTraffic = rawTraffic === '' ? 0 : Number.parseFloat(rawTraffic);

  if (!Number.isFinite(parsedTraffic) || parsedTraffic < 0) {
    requiredTrafficError.textContent = 'Enter a positive number of daily events.';
    requiredMonthlyEvents.textContent = '—';
    requiredStandardCost.textContent = '—';
    requiredRealmCost.textContent = '—';
    requiredSavings.textContent = '—';
    requiredStandardBreakdown.textContent = '';
    requiredRealmBreakdown.textContent = '';
    requiredSavingsPercent.textContent = '';
    return;
  }

  requiredTrafficError.textContent = '';

  const { monthlyEvents, standard, realm, cribl } = estimateCosts({
    source,
    destination,
    dailyEvents: parsedTraffic,
  });

  requiredMonthlyEvents.textContent = formatNumber(monthlyEvents);
  requiredStandardCost.textContent = formatCurrency(Math.max(0, standard.total));
  requiredRealmCost.textContent = formatCurrency(Math.max(0, realm.total));
  requiredSavings.textContent = formatCurrency(realm.savings);
  requiredStandardBreakdown.textContent = `(${formatCurrency(
    standard.ratePerMillion,
  )} per million events)`;

  const realmBreakdown = [
    `Realm reduces blended costs by ${(realm.reductionApplied * 100).toFixed(0)}% to ${formatCurrency(
      realm.ratePerMillion,
    )} per million events.`,
    `Adds a ${formatCurrency(realm.platformFeePerMillion)} platform fee per million.`,
    `Cribl is estimated at ${formatCurrency(cribl.ratePerMillion)} per million (includes ${formatCurrency(
      cribl.platformFeePerMillion,
    )} platform fee).`,
  ];
  requiredRealmBreakdown.textContent = realmBreakdown.join(' ');

  if (realm.savingsPercentage) {
    const realmDirection = realm.savingsPercentage >= 0 ? '≈' : 'Increase of';
    const criblDirectionStandard = cribl.savingsVsStandard >= 0 ? 'saves' : 'costs';
    const criblDirectionRealm = cribl.savingsVsRealm >= 0 ? 'beats Realm by' : 'lags Realm by';
    requiredSavingsPercent.textContent = `${realmDirection} ${Math.abs(
      realm.savingsPercentage,
    ).toFixed(1)}% vs standard • Cribl ${criblDirectionStandard} ${formatCurrency(
      Math.abs(cribl.savingsVsStandard),
    )} vs standard and ${criblDirectionRealm} ${formatCurrency(
      Math.abs(cribl.savingsVsRealm),
    )}`;
  } else {
    requiredSavingsPercent.textContent = 'No savings at current volume.';
  }
};

const initialize = () => {
  populateSelect(requiredSourceSelect, sources);
  populateSelect(requiredDestinationSelect, destinations);
  requiredSourceSelect.value = sources[0]?.id ?? '';
  requiredDestinationSelect.value = destinations[0]?.id ?? '';
  requiredTrafficInput.value = '25000';
  update();
};

requiredSourceSelect.addEventListener('change', update);
requiredDestinationSelect.addEventListener('change', update);
requiredTrafficInput.addEventListener('input', () => {
  update();
});

initialize();
