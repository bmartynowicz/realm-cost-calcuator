import { destinations, sources } from './data/catalog.js';
import type { Endpoint } from './data/catalog.js';

type CalculatorState = {
  source: Endpoint;
  destination: Endpoint;
  dailyTraffic: number;
};

type TrafficUnit = 'events' | 'gigabytes' | 'terabytes';

type CombinationOverride = {
  averageOptimization?: number;
  note?: string;
};

const REALM_PLATFORM_FEE_PER_MILLION = 7.5;
const DAYS_PER_MONTH = 30;
const KB_PER_GIGABYTE = 1_024 * 1_024;
const KB_PER_TERABYTE = KB_PER_GIGABYTE * 1_024;
const DEFAULT_EVENT_SIZE_KB = 1;
const MAX_REALM_OPTIMIZATION = 0.75;

const combinationOverrides: Record<string, CombinationOverride> = {
  'fortinet-fortigate::sumo-logic-siem': {
    averageOptimization: 0.2099,
    note: 'Calibrated to Vensure case study (~$250K annual savings with Realm Focus).',
  },
};

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

  const overrideKey = `${source.id}::${destination.id}`;
  const override = combinationOverrides[overrideKey];
  const averageOptimization =
    override?.averageOptimization ??
    Math.min(MAX_REALM_OPTIMIZATION, (source.realmOptimization + destination.realmOptimization) / 2);

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
    calibrationNote: override?.note ?? '',
  };
};

const sourceSelect = document.querySelector<HTMLSelectElement>('#sourceSelect');
const destinationSelect = document.querySelector<HTMLSelectElement>('#destinationSelect');
const trafficInput = document.querySelector<HTMLInputElement>('#trafficInput');
const trafficUnitSelect = document.querySelector<HTMLSelectElement>('#trafficUnit');
const eventSizeInput = document.querySelector<HTMLInputElement>('#eventSizeInput');
const eventSizeField = document.querySelector<HTMLElement>('[data-role="event-size-field"]');
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
const calibrationNoteEl = document.querySelector<HTMLElement>('#calibrationNote');

const assertElement = <T>(value: T | null, label: string): T => {
  if (value === null) {
    throw new Error(`${label} element was not found in the document`);
  }
  return value;
};

const requiredSourceSelect = assertElement(sourceSelect, 'Source select');
const requiredDestinationSelect = assertElement(destinationSelect, 'Destination select');
const requiredTrafficInput = assertElement(trafficInput, 'Traffic input');
const requiredTrafficUnit = assertElement(trafficUnitSelect, 'Traffic unit select');
const requiredEventSizeInput = assertElement(eventSizeInput, 'Event size input');
const requiredEventSizeField = assertElement(eventSizeField, 'Event size field');
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
const optionalCalibrationNote = calibrationNoteEl ?? null;

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
  element.textContent = `${endpoint.description} - ${formatCurrency(
    endpoint.costPerMillionEvents,
  )} per million events`;
};

const resetOutputs = () => {
  requiredMonthlyEvents.textContent = '--';
  requiredStandardCost.textContent = '--';
  requiredRealmCost.textContent = '--';
  requiredSavings.textContent = '--';
  requiredStandardBreakdown.textContent = '';
  requiredRealmBreakdown.textContent = '';
  requiredSavingsPercent.textContent = '';
  if (optionalCalibrationNote) {
    optionalCalibrationNote.textContent = '';
    optionalCalibrationNote.classList.add('field--hidden');
  }
};

const update = () => {
  const source = getEndpoint(sources, requiredSourceSelect.value);
  const destination = getEndpoint(destinations, requiredDestinationSelect.value);
  renderSummary(requiredSourceSummary, source);
  renderSummary(requiredDestinationSummary, destination);

  const unit = requiredTrafficUnit.value as TrafficUnit;
  requiredEventSizeField.classList.toggle('field--hidden', unit === 'events');

  if (unit === 'events') {
    requiredTrafficInput.step = '1000';
    requiredTrafficInput.placeholder = 'e.g. 25000';
  } else if (unit === 'gigabytes') {
    requiredTrafficInput.step = '0.1';
    requiredTrafficInput.placeholder = 'e.g. 12.5';
  } else {
    requiredTrafficInput.step = '0.1';
    requiredTrafficInput.placeholder = 'e.g. 2.3';
  }

  const rawTraffic = requiredTrafficInput.value.trim();
  const parsedTraffic = rawTraffic === '' ? 0 : Number.parseFloat(rawTraffic);
  const rawEventSize = requiredEventSizeInput.value.trim();
  const parsedEventSize =
    rawEventSize === '' ? DEFAULT_EVENT_SIZE_KB : Number.parseFloat(rawEventSize);

  if (!Number.isFinite(parsedTraffic) || parsedTraffic < 0) {
    requiredTrafficError.textContent = 'Enter a positive number for daily volume.';
    resetOutputs();
    return;
  }

  if (unit !== 'events' && (!Number.isFinite(parsedEventSize) || parsedEventSize <= 0)) {
    requiredTrafficError.textContent = 'Enter a positive average event size in KB.';
    resetOutputs();
    return;
  }

  requiredTrafficError.textContent = '';

  let dailyEvents = parsedTraffic;
  if (unit !== 'events') {
    const kbPerUnit = unit === 'gigabytes' ? KB_PER_GIGABYTE : KB_PER_TERABYTE;
    dailyEvents = (parsedTraffic * kbPerUnit) / parsedEventSize;
  }

  const {
    monthlyEvents,
    standardCost,
    realmCost,
    savings,
    savingsPercentage,
    standardRatePerMillion,
    optimizedRatePerMillion,
    averageOptimization,
    calibrationNote,
  } = calculate({
    source,
    destination,
    dailyTraffic: dailyEvents,
  });

  requiredMonthlyEvents.textContent = formatNumber(monthlyEvents);
  requiredStandardCost.textContent = formatCurrency(Math.max(0, standardCost));
  requiredRealmCost.textContent = formatCurrency(Math.max(0, realmCost));
  requiredSavings.textContent = formatCurrency(savings);
  requiredStandardBreakdown.textContent = `(${formatCurrency(
    standardRatePerMillion,
  )} per million events)`;
  const breakdownMessage = `Realm reduces blended costs by ${(averageOptimization * 100).toFixed(
    0,
  )}% to ${formatCurrency(optimizedRatePerMillion)} per million events and adds a ${formatCurrency(
    REALM_PLATFORM_FEE_PER_MILLION,
  )} platform fee per million.`;
  requiredRealmBreakdown.textContent = breakdownMessage;
  if (optionalCalibrationNote) {
    optionalCalibrationNote.textContent = calibrationNote;
    optionalCalibrationNote.classList.toggle('field--hidden', calibrationNote === '');
  }
  requiredSavingsPercent.textContent = savingsPercentage
    ? `${savingsPercentage >= 0 ? 'Savings of' : 'Increase of'} ${Math.abs(
        savingsPercentage,
      ).toFixed(1)}%`
    : 'No savings at current volume.';
  if (!optionalCalibrationNote && calibrationNote) {
    requiredRealmBreakdown.textContent = `${breakdownMessage} ${calibrationNote}`;
  }
};

const initialize = () => {
  populateSelect(requiredSourceSelect, sources);
  populateSelect(requiredDestinationSelect, destinations);
  requiredSourceSelect.value = sources[0]?.id ?? '';
  requiredDestinationSelect.value = destinations[0]?.id ?? '';
  requiredTrafficInput.value = '25000';
  requiredTrafficUnit.value = 'events';
  requiredEventSizeInput.value = DEFAULT_EVENT_SIZE_KB.toString();
  update();
};

requiredSourceSelect.addEventListener('change', update);
requiredDestinationSelect.addEventListener('change', update);
requiredTrafficInput.addEventListener('input', () => {
  update();
});
requiredTrafficUnit.addEventListener('change', update);
requiredEventSizeInput.addEventListener('input', update);

initialize();
