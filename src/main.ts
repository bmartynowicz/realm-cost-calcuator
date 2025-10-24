import { destinations, sources } from './data/catalog.js';
import type { Endpoint } from './data/catalog.js';

type CalculatorState = {
  source: Endpoint;
  destination: Endpoint;
  dailyTraffic: number;
};

const REALM_PLATFORM_FEE_PER_MILLION = 7.5;
const DAYS_PER_MONTH = 30;

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value < 100 ? 2 : 0,
  }).format(value);

const formatNumber = (value: number): string =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);

const calculate = ({ source, destination, dailyTraffic }: CalculatorState) => {
  const monthlyEvents = dailyTraffic * DAYS_PER_MONTH;
  const millions = monthlyEvents / 1_000_000;

  const standardRatePerMillion = source.costPerMillionEvents + destination.costPerMillionEvents;
  const standardCost = millions * standardRatePerMillion;

  const averageOptimization = Math.min(
    0.65,
    (source.realmOptimization + destination.realmOptimization) / 2,
  );

  const optimizedRatePerMillion = standardRatePerMillion * (1 - averageOptimization);
  const realmCost = millions * (optimizedRatePerMillion + REALM_PLATFORM_FEE_PER_MILLION);
  const savings = standardCost - realmCost;
  const savingsPercentage = standardCost > 0 ? (savings / standardCost) * 100 : 0;

  return {
    monthlyEvents,
    standardCost,
    realmCost,
    savings,
    savingsPercentage,
    standardRatePerMillion,
    optimizedRatePerMillion,
    averageOptimization,
  };
};

const sourceSelect = document.querySelector<HTMLSelectElement>('#sourceSelect');
const destinationSelect = document.querySelector<HTMLSelectElement>('#destinationSelect');
const trafficInput = document.querySelector<HTMLInputElement>('#trafficInput');
const sourceSummary = document.querySelector<HTMLSpanElement>('#sourceSummary');
const destinationSummary = document.querySelector<HTMLSpanElement>('#destinationSummary');
const trafficError = document.querySelector<HTMLSpanElement>('#trafficError');
const monthlyEventsEl = document.querySelector<HTMLElement>('#monthlyEvents');
const standardCostEl = document.querySelector<HTMLElement>('#standardCost');
const realmCostEl = document.querySelector<HTMLElement>('#realmCost');
const savingsEl = document.querySelector<HTMLElement>('#savings');
const standardBreakdownEl = document.querySelector<HTMLElement>('#standardBreakdown');
const realmBreakdownEl = document.querySelector<HTMLElement>('#realmBreakdown');
const savingsPercentEl = document.querySelector<HTMLElement>('#savingsPercent');

const assertElement = <T>(value: T | null, label: string): T => {
  if (value === null) {
    throw new Error(`${label} element was not found in the document`);
  }
  return value;
};

const requiredSourceSelect = assertElement(sourceSelect, 'Source select');
const requiredDestinationSelect = assertElement(destinationSelect, 'Destination select');
const requiredTrafficInput = assertElement(trafficInput, 'Traffic input');
const requiredSourceSummary = assertElement(sourceSummary, 'Source summary');
const requiredDestinationSummary = assertElement(destinationSummary, 'Destination summary');
const requiredTrafficError = assertElement(trafficError, 'Traffic error');
const requiredMonthlyEvents = assertElement(monthlyEventsEl, 'Monthly events');
const requiredStandardCost = assertElement(standardCostEl, 'Standard cost');
const requiredRealmCost = assertElement(realmCostEl, 'Realm cost');
const requiredSavings = assertElement(savingsEl, 'Savings');
const requiredStandardBreakdown = assertElement(standardBreakdownEl, 'Standard breakdown');
const requiredRealmBreakdown = assertElement(realmBreakdownEl, 'Realm breakdown');
const requiredSavingsPercent = assertElement(savingsPercentEl, 'Savings percent');

const populateSelect = (select: HTMLSelectElement, items: Endpoint[]) => {
  select.innerHTML = '';
  for (const endpoint of items) {
    const option = document.createElement('option');
    option.value = endpoint.id;
    option.textContent = endpoint.label;
    select.appendChild(option);
  }
};

const getEndpoint = (list: Endpoint[], id: string): Endpoint => {
  const endpoint = list.find((item) => item.id === id);
  if (!endpoint) {
    throw new Error(`Unknown endpoint id: ${id}`);
  }
  return endpoint;
};

const renderSummary = (element: HTMLElement, endpoint: Endpoint) => {
  element.textContent = `${endpoint.description} • ${formatCurrency(
    endpoint.costPerMillionEvents,
  )} per million events`;
};

const update = () => {
  const source = getEndpoint(sources, requiredSourceSelect.value);
  const destination = getEndpoint(destinations, requiredDestinationSelect.value);
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

  const {
    monthlyEvents,
    standardCost,
    realmCost,
    savings,
    savingsPercentage,
    standardRatePerMillion,
    optimizedRatePerMillion,
    averageOptimization,
  } = calculate({
    source,
    destination,
    dailyTraffic: parsedTraffic,
  });

  requiredMonthlyEvents.textContent = formatNumber(monthlyEvents);
  requiredStandardCost.textContent = formatCurrency(Math.max(0, standardCost));
  requiredRealmCost.textContent = formatCurrency(Math.max(0, realmCost));
  requiredSavings.textContent = formatCurrency(savings);
  requiredStandardBreakdown.textContent = `(${formatCurrency(
    standardRatePerMillion,
  )} per million events)`;
  requiredRealmBreakdown.textContent = `Realm reduces blended costs by ${(averageOptimization * 100).toFixed(
    0,
  )}% to ${formatCurrency(optimizedRatePerMillion)} per million events and adds a ${formatCurrency(
    REALM_PLATFORM_FEE_PER_MILLION,
  )} platform fee per million.`;
  requiredSavingsPercent.textContent = savingsPercentage
    ? `${savingsPercentage >= 0 ? '≈' : 'Increase of'} ${Math.abs(savingsPercentage).toFixed(
        1,
      )}%`
    : 'No savings at current volume.';
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
