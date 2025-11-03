import { destinations, sources } from './data/catalog.js';
import type { Endpoint } from './data/catalog.js';
import {
  describeTrafficRecommendation,
  getTrafficRecommendation,
  organizationSizeOptions,
  type TrafficRecommendation,
  type OrganizationSizeKey,
} from './data/traffic-profiles.js';

type CalculatorState = {
  sources: Endpoint[];
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
// Average third-party tooling + operations overhead Realm removes from legacy pipelines.
const LEGACY_PIPELINE_OVERHEAD_PER_MILLION = 12;
const CRIBL_MARKUP_RATE = 0.18;
const CRIBL_PLATFORM_FEE_PER_MILLION = 12;
const CRIBL_REVEAL_LABEL = 'Enter work email to unlock';
const CRIBL_UNLOCKED_LABEL = 'Cribl estimate unlocked';
const WORK_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const ENABLE_CRIBL_COMPARISON = false; // Temporary launch toggle for Cribl comparison
const CONSUMER_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'ymail.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'msn.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'yandex.com',
]);

if (!ENABLE_CRIBL_COMPARISON) {
  document.querySelector<HTMLElement>('[data-role="cribl-comparison"]')?.remove();
}

type JsPdfConstructor = typeof import('jspdf').jsPDF;
type JsPdfGlobalNamespace = {
  jspdf?: {
    jsPDF?: JsPdfConstructor;
  };
};

const EXPORT_BUTTON_DEFAULT_LABEL = 'Download executive summary PDF';
const EXPORT_BUTTON_ERROR_LABEL = 'Export unavailable - try again';

let jsPdfLoader: Promise<JsPdfConstructor | null> | null = null;

const loadJsPdf = async (): Promise<JsPdfConstructor | null> => {
  if (typeof window === 'undefined') {
    return null;
  }

  const namespace = window as unknown as JsPdfGlobalNamespace;
  if (namespace.jspdf?.jsPDF) {
    return namespace.jspdf.jsPDF;
  }

  if (!jsPdfLoader) {
    jsPdfLoader = new Promise<JsPdfConstructor | null>((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.onload = () => {
        const loaded = (window as unknown as JsPdfGlobalNamespace).jspdf?.jsPDF ?? null;
        resolve(loaded);
      };
      script.onerror = () => resolve(null);
      document.head.appendChild(script);
    });
  }

  return jsPdfLoader;
};

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

const formatDecimal = (
  value: number,
  { maximumFractionDigits = 2, minimumFractionDigits }: { maximumFractionDigits?: number; minimumFractionDigits?: number } = {},
): string => {
  const minFractionDigits =
    typeof minimumFractionDigits === 'number'
      ? minimumFractionDigits
      : value % 1 === 0
        ? 0
        : Math.min(2, maximumFractionDigits);

  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits,
    minimumFractionDigits: minFractionDigits,
  }).format(value);
};

type CombinedSourceMetrics = {
  costPerMillionEvents: number;
  realmOptimization: number;
};

const summarizeSources = (selectedSources: Endpoint[]): CombinedSourceMetrics => {
  if (selectedSources.length === 0) {
    throw new Error('At least one source must be provided for calculation.');
  }

  if (selectedSources.length === 1) {
    const [singleSource] = selectedSources;
    return {
      costPerMillionEvents: singleSource.costPerMillionEvents,
      realmOptimization: singleSource.realmOptimization,
    };
  }

  const aggregates = selectedSources.reduce(
    (accumulator, source) => {
      accumulator.costPerMillionEvents += source.costPerMillionEvents;
      accumulator.realmOptimization += source.realmOptimization;
      return accumulator;
    },
    { costPerMillionEvents: 0, realmOptimization: 0 },
  );

  return {
    costPerMillionEvents: aggregates.costPerMillionEvents / selectedSources.length,
    realmOptimization: aggregates.realmOptimization / selectedSources.length,
  };
};

const calculate = ({ sources: selectedSources, destination, dailyTraffic }: CalculatorState) => {
  if (selectedSources.length === 0) {
    throw new Error('At least one source must be selected.');
  }

  const monthlyEvents = dailyTraffic * DAYS_PER_MONTH;
  const millions = monthlyEvents / 1_000_000;

  const combinedSource = summarizeSources(selectedSources);

  const providerRatePerMillion =
    combinedSource.costPerMillionEvents + destination.costPerMillionEvents;
  const legacyRatePerMillion = providerRatePerMillion + LEGACY_PIPELINE_OVERHEAD_PER_MILLION;
  const standardCost = millions * legacyRatePerMillion;

  const overrideKey =
    selectedSources.length === 1 ? `${selectedSources[0].id}::${destination.id}` : null;
  const override = overrideKey ? combinationOverrides[overrideKey] : undefined;
  const averageOptimization =
    override?.averageOptimization ??
    Math.min(
      MAX_REALM_OPTIMIZATION,
      (combinedSource.realmOptimization + destination.realmOptimization) / 2,
    );

  const optimizedRatePerMillion = providerRatePerMillion * (1 - averageOptimization);
  const realmCost = millions * (optimizedRatePerMillion + REALM_PLATFORM_FEE_PER_MILLION);
  const savings = standardCost - realmCost;
  const savingsPercentage = standardCost > 0 ? (savings / standardCost) * 100 : 0;

  return {
    monthlyEvents,
    standardCost,
    realmCost,
    savings,
    savingsPercentage,
    providerRatePerMillion,
    legacyRatePerMillion,
    optimizedRatePerMillion,
    averageOptimization,
    calibrationNote: override?.note ?? '',
  };
};

type CalculationResult = ReturnType<typeof calculate>;

type ExportSnapshot = CalculationResult & {
  sources: Endpoint[];
  destination: Endpoint;
  trafficUnit: TrafficUnit;
  organizationSize: OrganizationSizeKey;
  recommendation: TrafficRecommendation;
  dailyInput: number;
  dailyEvents: number;
  eventSizeKb: number;
  criblCost: number;
  criblEstimateUnlocked: boolean;
};

const sourceSelect = document.querySelector<HTMLSelectElement>('#sourceSelect');
const destinationSelect = document.querySelector<HTMLSelectElement>('#destinationSelect');
const organizationSizeSelect = document.querySelector<HTMLSelectElement>('#organizationSize');
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
const trafficRecommendationEl = document.querySelector<HTMLParagraphElement>('#trafficRecommendation');
const criblCostEl = ENABLE_CRIBL_COMPARISON
  ? document.querySelector<HTMLElement>('#criblCost')
  : null;
const criblRevealButtonEl = ENABLE_CRIBL_COMPARISON
  ? document.querySelector<HTMLButtonElement>('[data-role="cribl-reveal-button"]')
  : null;
const criblRevealContainerEl = ENABLE_CRIBL_COMPARISON
  ? document.querySelector<HTMLElement>('#criblRevealForm')
  : null;
const criblRevealFormEl = ENABLE_CRIBL_COMPARISON
  ? document.querySelector<HTMLFormElement>('[data-role="cribl-reveal-form"]')
  : null;
const criblEmailInputEl = ENABLE_CRIBL_COMPARISON
  ? document.querySelector<HTMLInputElement>('#criblEmailInput')
  : null;
const criblErrorMessageEl = ENABLE_CRIBL_COMPARISON
  ? document.querySelector<HTMLParagraphElement>('[data-role="cribl-error-message"]')
  : null;
const exportPdfButtonEl = document.querySelector<HTMLButtonElement>('[data-role="export-pdf-button"]');

const assertElement = <T>(value: T | null, label: string): T => {
  if (value === null) {
    throw new Error(`${label} element was not found in the document`);
  }
  return value;
};

const requiredSourceSelect = assertElement(sourceSelect, 'Source select');
const requiredDestinationSelect = assertElement(destinationSelect, 'Destination select');
const requiredOrganizationSizeSelect = assertElement(
  organizationSizeSelect,
  'Organization size select',
);
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
const requiredTrafficRecommendation = assertElement(
  trafficRecommendationEl,
  'Traffic recommendation',
);
const requiredExportPdfButton = assertElement(exportPdfButtonEl, 'Export PDF button');
const optionalCalibrationNote = calibrationNoteEl ?? null;
let userTrafficEdited = false;
let userEventSizeEdited = false;
let currentRecommendation: TrafficRecommendation | null = null;

type CriblUiElements = {
  cost: HTMLElement;
  button: HTMLButtonElement;
  container: HTMLElement;
  form: HTMLFormElement;
  input: HTMLInputElement;
  error: HTMLParagraphElement;
};

const criblUi: CriblUiElements | null =
  ENABLE_CRIBL_COMPARISON &&
  criblCostEl &&
  criblRevealButtonEl &&
  criblRevealContainerEl &&
  criblRevealFormEl &&
  criblEmailInputEl &&
  criblErrorMessageEl
    ? {
        cost: criblCostEl,
        button: criblRevealButtonEl,
        container: criblRevealContainerEl,
        form: criblRevealFormEl,
        input: criblEmailInputEl,
        error: criblErrorMessageEl,
      }
    : null;

let hasUnlockedCriblEstimate = false;
const exportButtonLabelDefault =
  requiredExportPdfButton.textContent?.trim() || EXPORT_BUTTON_DEFAULT_LABEL;
requiredExportPdfButton.textContent = exportButtonLabelDefault;

const resetExportButtonMessage = () => {
  requiredExportPdfButton.textContent = exportButtonLabelDefault;
  requiredExportPdfButton.classList.remove('metrics__export-button--error');
  requiredExportPdfButton.removeAttribute('data-error');
};

const showExportError = (message: string) => {
  requiredExportPdfButton.textContent = message;
  requiredExportPdfButton.classList.add('metrics__export-button--error');
  requiredExportPdfButton.setAttribute('data-error', message);
  window.setTimeout(() => {
    resetExportButtonMessage();
  }, 4000);
};

const setExportButtonState = (enabled: boolean) => {
  requiredExportPdfButton.disabled = !enabled;
  if (enabled) {
    resetExportButtonMessage();
    requiredExportPdfButton.removeAttribute('aria-disabled');
  } else {
    requiredExportPdfButton.setAttribute('aria-disabled', 'true');
    resetExportButtonMessage();
  }
};

setExportButtonState(false);

let lastSnapshot: ExportSnapshot | null = null;

const clearCriblError = () => {
  if (!criblUi) {
    return;
  }
  criblUi.error.textContent = '';
  criblUi.error.classList.add('field--hidden');
};

const hideCriblForm = () => {
  if (!criblUi) {
    return;
  }
  criblUi.container.classList.add('field--hidden');
  criblUi.button.setAttribute('aria-expanded', 'false');
};

const showCriblForm = () => {
  if (!criblUi) {
    return;
  }
  criblUi.container.classList.remove('field--hidden');
  criblUi.button.setAttribute('aria-expanded', 'true');
  criblUi.input.focus();
};

const updateCriblDisplay = (formattedCost: string) => {
  if (!criblUi) {
    return;
  }

  const displayValue = hasUnlockedCriblEstimate ? formattedCost : '--';
  criblUi.cost.textContent = displayValue;
  criblUi.cost.setAttribute('data-unlocked', hasUnlockedCriblEstimate ? 'true' : 'false');
  if (hasUnlockedCriblEstimate) {
    criblUi.button.dataset.preview = '';
    criblUi.button.classList.add('metrics__veil-button--unlocked');
    criblUi.button.disabled = true;
    criblUi.button.setAttribute('aria-hidden', 'true');
    criblUi.button.textContent = CRIBL_UNLOCKED_LABEL;
  } else {
    criblUi.button.dataset.preview = formattedCost;
    criblUi.button.classList.remove('metrics__veil-button--unlocked');
    criblUi.button.disabled = false;
    criblUi.button.removeAttribute('aria-hidden');
    criblUi.button.textContent = CRIBL_REVEAL_LABEL;
  }
};

const estimateCriblCost = (monthlyEvents: number, providerRatePerMillion: number): number => {
  if (monthlyEvents <= 0) {
    return 0;
  }

  const millions = monthlyEvents / 1_000_000;
  const baseRate = providerRatePerMillion + CRIBL_PLATFORM_FEE_PER_MILLION;
  const adjustedRate = baseRate * (1 + CRIBL_MARKUP_RATE);
  return millions * adjustedRate;
};

const isConsumerDomain = (domain: string): boolean => CONSUMER_EMAIL_DOMAINS.has(domain);

const validateWorkEmail = (value: string): string | null => {
  if (!value.trim()) {
    return 'Enter your work email to unlock the estimate.';
  }

  if (!WORK_EMAIL_PATTERN.test(value)) {
    return 'Use a valid business email address.';
  }

  const domain = value.trim().split('@')[1]?.toLowerCase() ?? '';
  if (!domain) {
    return 'Use a valid business email address.';
  }

  if (isConsumerDomain(domain)) {
    return 'Enter a company email rather than a personal domain.';
  }

  return null;
};

const unlockCriblEstimate = () => {
  if (!criblUi) {
    return;
  }
  hasUnlockedCriblEstimate = true;
  if (lastSnapshot) {
    lastSnapshot = { ...lastSnapshot, criblEstimateUnlocked: true };
  }
  hideCriblForm();
  clearCriblError();
  criblUi.button.classList.add('metrics__veil-button--unlocked');
  criblUi.button.disabled = true;
  criblUi.button.setAttribute('aria-hidden', 'true');
  criblUi.button.dataset.preview = '';
  criblUi.button.blur();
  const snapshotCost = lastSnapshot
    ? formatCurrency(Math.max(0, lastSnapshot.criblCost))
    : '--';
  updateCriblDisplay(snapshotCost);
};

const populateSelect = (select: HTMLSelectElement, items: Endpoint[]) => {
  select.innerHTML = '';
  for (const endpoint of items) {
    const option = document.createElement('option');
    option.value = endpoint.id;
    option.textContent = endpoint.label;
    select.appendChild(option);
  }
};

const populateOrganizationSizeSelect = (select: HTMLSelectElement) => {
  select.innerHTML = '';
  for (const sizeOption of organizationSizeOptions) {
    const option = document.createElement('option');
    option.value = sizeOption.id;
    option.textContent = sizeOption.optionLabel;
    option.title = sizeOption.description;
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

const enableClickToToggleMultiSelect = (select: HTMLSelectElement) => {
  select.addEventListener('mousedown', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLOptionElement)) {
      return;
    }

    event.preventDefault();
    target.selected = !target.selected;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

const getSelectedSourceIds = (): string[] =>
  Array.from(requiredSourceSelect.selectedOptions).map((option) => option.value);

const getSelectedSources = (): Endpoint[] => {
  const selectedIds = getSelectedSourceIds();
  if (selectedIds.length === 0 && requiredSourceSelect.options.length > 0) {
    const [firstOption] = Array.from(requiredSourceSelect.options);
    if (firstOption) {
      firstOption.selected = true;
      return [getEndpoint(sources, firstOption.value)];
    }
  }

  return selectedIds.map((id) => getEndpoint(sources, id));
};

const renderSourcesSummary = (element: HTMLElement, selectedSources: Endpoint[]) => {
  if (selectedSources.length === 0) {
    element.textContent = 'Select at least one source.';
    element.removeAttribute('title');
    return;
  }

  if (selectedSources.length === 1) {
    renderSummary(element, selectedSources[0]);
    element.title = selectedSources[0].label;
    return;
  }

  const combined = summarizeSources(selectedSources);
  element.textContent = `${selectedSources.length} sources selected • Avg provider rate ${formatCurrency(
    combined.costPerMillionEvents,
  )} per million events`;
  element.title = selectedSources.map((endpoint) => endpoint.label).join(', ');
};

const resetOutputs = () => {
  lastSnapshot = null;
  setExportButtonState(false);
  requiredMonthlyEvents.textContent = '--';
  requiredStandardCost.textContent = '--';
  requiredRealmCost.textContent = '--';
  requiredSavings.textContent = '--';
  requiredStandardBreakdown.textContent = '';
  requiredRealmBreakdown.textContent = '';
  requiredSavingsPercent.textContent = '';
  updateCriblDisplay('--');
  clearCriblError();
  if (!hasUnlockedCriblEstimate) {
    hideCriblForm();
  }
  if (optionalCalibrationNote) {
    optionalCalibrationNote.textContent = '';
    optionalCalibrationNote.classList.add('field--hidden');
  }
};

const applyRecommendation = ({
  overrideTraffic,
  overrideEventSize,
}: { overrideTraffic?: boolean; overrideEventSize?: boolean } = {}) => {
  const size = requiredOrganizationSizeSelect.value as OrganizationSizeKey;
  const selectedSources = getSelectedSources();
  const primarySource = selectedSources[0] ?? sources[0];
  if (!primarySource) {
    return;
  }

  const recommendation = getTrafficRecommendation(primarySource, size);
  currentRecommendation = recommendation;

  const shouldOverrideTraffic =
    overrideTraffic ?? (!userTrafficEdited || requiredTrafficInput.value.trim() === '');
  const shouldOverrideEventSize =
    overrideEventSize ?? (!userEventSizeEdited || requiredEventSizeInput.value.trim() === '');

  if (shouldOverrideTraffic) {
    if (requiredTrafficUnit.value === 'events') {
      requiredTrafficInput.value = Math.round(recommendation.dailyEvents).toString();
    } else {
      const kbPerUnit =
        requiredTrafficUnit.value === 'gigabytes' ? KB_PER_GIGABYTE : KB_PER_TERABYTE;
      const volumeInUnits =
        (recommendation.dailyEvents * recommendation.averageEventSizeKb) / kbPerUnit;
      const decimals =
        volumeInUnits >= 100 ? 0 : volumeInUnits >= 10 ? 1 : volumeInUnits >= 1 ? 2 : 3;
      requiredTrafficInput.value = Number(volumeInUnits.toFixed(decimals)).toString();
    }
    userTrafficEdited = false;
  }

  if (shouldOverrideEventSize) {
    requiredEventSizeInput.value = recommendation.averageEventSizeKb.toFixed(1);
    userEventSizeEdited = false;
  }

  const recommendationSummary = describeTrafficRecommendation(recommendation);
  requiredTrafficRecommendation.textContent =
    selectedSources.length > 1
      ? `${recommendationSummary} (baseline uses ${primarySource.label} — adjust for additional sources as needed.)`
      : recommendationSummary;
};

const update = () => {
  const selectedSources = getSelectedSources();
  const primarySource = selectedSources[0] ?? sources[0];
  if (!primarySource) {
    return;
  }
  const destination = getEndpoint(destinations, requiredDestinationSelect.value);
  renderSourcesSummary(requiredSourceSummary, selectedSources);
  renderSummary(requiredDestinationSummary, destination);
  const organizationSizeKey = requiredOrganizationSizeSelect.value as OrganizationSizeKey;
  const recommendation =
    currentRecommendation ?? getTrafficRecommendation(primarySource, organizationSizeKey);
  currentRecommendation = recommendation;
  const recommendationSummary = describeTrafficRecommendation(recommendation);
  requiredTrafficRecommendation.textContent =
    selectedSources.length > 1
      ? `${recommendationSummary} (baseline uses ${primarySource.label} — adjust for additional sources as needed.)`
      : recommendationSummary;

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
    providerRatePerMillion,
    legacyRatePerMillion,
    optimizedRatePerMillion,
    averageOptimization,
    calibrationNote,
  } = calculate({
    sources: selectedSources,
    destination,
    dailyTraffic: dailyEvents,
  });

  requiredMonthlyEvents.textContent = formatNumber(monthlyEvents);
  requiredStandardCost.textContent = formatCurrency(Math.max(0, standardCost));
  requiredRealmCost.textContent = formatCurrency(Math.max(0, realmCost));
  requiredSavings.textContent = formatCurrency(savings);
  requiredStandardBreakdown.textContent = `(${formatCurrency(
    providerRatePerMillion,
  )} provider ingest + ${formatCurrency(LEGACY_PIPELINE_OVERHEAD_PER_MILLION)} legacy tooling per million events)`;
  const breakdownMessage = `Realm removes ${formatCurrency(
    LEGACY_PIPELINE_OVERHEAD_PER_MILLION,
  )} in legacy tooling, reduces provider ingest by ${(averageOptimization * 100).toFixed(
    0,
  )}% to ${formatCurrency(optimizedRatePerMillion)} per million events and adds a ${formatCurrency(
    REALM_PLATFORM_FEE_PER_MILLION,
  )} platform fee per million.`;
  requiredRealmBreakdown.textContent = breakdownMessage;
  const eventSizeForSnapshot = unit === 'events' ? DEFAULT_EVENT_SIZE_KB : parsedEventSize;
  const criblCost = estimateCriblCost(monthlyEvents, providerRatePerMillion);

  lastSnapshot = {
    sources: selectedSources,
    destination,
    trafficUnit: unit,
    organizationSize: organizationSizeKey,
    recommendation,
    dailyInput: parsedTraffic,
    dailyEvents,
    eventSizeKb: eventSizeForSnapshot,
    criblCost,
    criblEstimateUnlocked: hasUnlockedCriblEstimate,
    monthlyEvents,
    standardCost,
    realmCost,
    savings,
    savingsPercentage,
    providerRatePerMillion,
    legacyRatePerMillion,
    optimizedRatePerMillion,
    averageOptimization,
    calibrationNote,
  };
  setExportButtonState(true);

  updateCriblDisplay(formatCurrency(Math.max(0, criblCost)));
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

const describeDailyVolume = (snapshot: ExportSnapshot): string => {
  if (snapshot.trafficUnit === 'events') {
    return `${formatNumber(Math.round(snapshot.dailyInput))} events per day`;
  }

  const unitLabel = snapshot.trafficUnit === 'gigabytes' ? 'GB' : 'TB';
  const volume = formatDecimal(snapshot.dailyInput, { maximumFractionDigits: 2 });
  const averageSize = formatDecimal(snapshot.eventSizeKb, { maximumFractionDigits: 2 });
  return `${volume} ${unitLabel} per day | ${averageSize} KB avg. event size`;
};

const buildScenarioLines = (snapshot: ExportSnapshot): string[] => {
  const sourceLabels = snapshot.sources.map((endpoint) => endpoint.label);
  const lines = [
    `Sources (${snapshot.sources.length}): ${sourceLabels.join(', ')}`,
    `Destination: ${snapshot.destination.label}`,
  ];

  for (const source of snapshot.sources) {
    if (source.description) {
      lines.push(`Source notes (${source.label}): ${source.description}`);
    }
  }

  if (snapshot.destination.description) {
    lines.push(`Destination notes: ${snapshot.destination.description}`);
  }

  if (snapshot.sources.length > 1) {
    const combined = summarizeSources(snapshot.sources);
    lines.push(
      `Average provider rate across sources: ${formatCurrency(combined.costPerMillionEvents)} per million events.`,
      'Scenario assumes evenly distributed volume across selected sources.',
    );
  }

  lines.push(
    `Daily volume: ${describeDailyVolume(snapshot)}`,
    `Converted daily events: ${formatNumber(Math.round(snapshot.dailyEvents))}`,
    `Monthly events modeled: ${formatNumber(Math.round(snapshot.monthlyEvents))}`,
  );

  const baselineSummary = describeTrafficRecommendation(snapshot.recommendation);
  lines.push(`Realm baseline: ${baselineSummary}`);

  return lines;
};

const buildFinancialLines = (snapshot: ExportSnapshot): string[] => {
  const absoluteSavingsPercent = Math.abs(snapshot.savingsPercentage);
  const savingsLine =
    snapshot.savings >= 0
      ? `Projected monthly savings: ${formatCurrency(snapshot.savings)} (${absoluteSavingsPercent.toFixed(
          1,
        )}% vs standard)`
      : `Projected monthly increase: ${formatCurrency(Math.abs(snapshot.savings))} (${absoluteSavingsPercent.toFixed(
          1,
        )}% vs standard)`;

  const lines = [
    `Standard integration cost: ${formatCurrency(Math.max(0, snapshot.standardCost))}`,
    `Realm optimized cost: ${formatCurrency(Math.max(0, snapshot.realmCost))}`,
    savingsLine,
    `Legacy pipeline rate per million: ${formatCurrency(snapshot.legacyRatePerMillion)} (${formatCurrency(
      snapshot.providerRatePerMillion,
    )} provider ingest + ${formatCurrency(LEGACY_PIPELINE_OVERHEAD_PER_MILLION)} tooling)`,
    `Blended rate per million (Realm): ${formatCurrency(snapshot.optimizedRatePerMillion)} + ${formatCurrency(
      REALM_PLATFORM_FEE_PER_MILLION,
    )} platform fee`,
    `Average optimization applied: ${(snapshot.averageOptimization * 100).toFixed(1)}%`,
  ];

  const criblLine = snapshot.criblEstimateUnlocked
    ? `Estimated Cribl cost: ${formatCurrency(Math.max(0, snapshot.criblCost))}`
    : 'Estimated Cribl cost: Unlock with a work email to include this comparison.';

  lines.push(criblLine);

  return lines;
};

const createExecutiveSummaryPdf = async (snapshot: ExportSnapshot) => {
  const JsPdfConstructor = await loadJsPdf();
  if (!JsPdfConstructor) {
    throw new Error('jsPDF library is not available.');
  }

  const doc = new JsPdfConstructor({ unit: 'pt', format: 'letter' });
  const margin = 56;
  const sectionSpacing = 12;
  const lineHeight = 16;
  const pageWidth = doc.internal.pageSize.getWidth();
  const textWidth = pageWidth - margin * 2;
  let cursorY = margin;

  const ensureSpace = (heightNeeded: number) => {
    const pageHeight = doc.internal.pageSize.getHeight();
    if (cursorY + heightNeeded > pageHeight - margin) {
      doc.addPage();
      cursorY = margin;
    }
  };

  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(15, 23, 42);
  doc.text('Realm Cost Calculator Executive Summary', margin, cursorY);
  cursorY += 28;

  doc.setFont('Helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(100, 116, 139);
  const generatedStamp = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date());
  doc.text(`Generated on ${generatedStamp}`, margin, cursorY);
  cursorY += 24;

  doc.setDrawColor(99, 102, 241);
  doc.setLineWidth(0.75);
  doc.line(margin, cursorY, margin + textWidth, cursorY);
  cursorY += 24;

  const addSection = (heading: string, lines: string[]) => {
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(15, 23, 42);
    ensureSpace(18);
    doc.text(heading, margin, cursorY);
    cursorY += 18;

    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(51, 65, 85);

    for (const line of lines) {
      const wrapped = doc.splitTextToSize(line, textWidth);
      for (const segment of wrapped) {
        ensureSpace(lineHeight);
        doc.text(segment, margin, cursorY);
        cursorY += lineHeight;
      }
      cursorY += 4;
    }

    cursorY += sectionSpacing;
  };

  addSection('Scenario Inputs', buildScenarioLines(snapshot));
  addSection('Financial Impact', buildFinancialLines(snapshot));

  if (snapshot.calibrationNote) {
    doc.setFont('Helvetica', 'italic');
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    const noteLines = doc.splitTextToSize(`Calibration note: ${snapshot.calibrationNote}`, textWidth);
    for (const noteLine of noteLines) {
      ensureSpace(lineHeight);
      doc.text(noteLine, margin, cursorY);
      cursorY += lineHeight;
    }
    cursorY += sectionSpacing;
  }

  const totalPages = doc.getNumberOfPages();
  for (let pageIndex = 1; pageIndex <= totalPages; pageIndex += 1) {
    doc.setPage(pageIndex);
    const { width, height } = doc.internal.pageSize;
    const footerBaseline = height - 36;

    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(148, 163, 184);
    doc.text('Realm | https://realm.build', margin, footerBaseline);

    const footerRight = `Scenario export | Page ${pageIndex} of ${totalPages}`;
    const footerRightWidth = doc.getTextWidth(footerRight);
    doc.text(footerRight, width - margin - footerRightWidth, footerBaseline);
  }

  doc.setPage(totalPages);
  doc.save('realm-executive-summary.pdf');
};

const handleExportPdf = async () => {
  if (!lastSnapshot || requiredExportPdfButton.dataset.loading === 'true') {
    return;
  }

  requiredExportPdfButton.dataset.loading = 'true';
  requiredExportPdfButton.disabled = true;
  requiredExportPdfButton.setAttribute('aria-disabled', 'true');
  requiredExportPdfButton.textContent = 'Preparing PDF...';

  try {
    await createExecutiveSummaryPdf(lastSnapshot);
    requiredExportPdfButton.blur();
  } catch (error) {
    console.error('PDF export failed:', error);
    showExportError(EXPORT_BUTTON_ERROR_LABEL);
  } finally {
    requiredExportPdfButton.disabled = false;
    requiredExportPdfButton.removeAttribute('aria-disabled');
    delete requiredExportPdfButton.dataset.loading;
    if (!requiredExportPdfButton.classList.contains('metrics__export-button--error')) {
      resetExportButtonMessage();
    }
  }
};

const initialize = () => {
  populateSelect(requiredSourceSelect, sources);
  populateSelect(requiredDestinationSelect, destinations);
  populateOrganizationSizeSelect(requiredOrganizationSizeSelect);
  enableClickToToggleMultiSelect(requiredSourceSelect);
  requiredSourceSelect.value = sources[0]?.id ?? '';
  requiredDestinationSelect.value = destinations[0]?.id ?? '';
  requiredTrafficUnit.value = 'events';
  requiredOrganizationSizeSelect.value =
    organizationSizeOptions[0]?.id ?? requiredOrganizationSizeSelect.value;
  applyRecommendation({ overrideTraffic: true, overrideEventSize: true });
  update();
};

requiredSourceSelect.addEventListener('change', () => {
  applyRecommendation();
  update();
});
requiredDestinationSelect.addEventListener('change', update);
requiredOrganizationSizeSelect.addEventListener('change', () => {
  applyRecommendation({ overrideTraffic: true, overrideEventSize: true });
  update();
});
requiredTrafficInput.addEventListener('input', () => {
  userTrafficEdited = true;
  update();
});
requiredTrafficUnit.addEventListener('change', () => {
  applyRecommendation({ overrideTraffic: !userTrafficEdited });
  update();
});
requiredEventSizeInput.addEventListener('input', () => {
  userEventSizeEdited = true;
  update();
});
requiredExportPdfButton.addEventListener('click', () => {
  void handleExportPdf();
});

if (criblUi) {
  const { button, container, form, input, error } = criblUi;

  button.addEventListener('click', () => {
    if (hasUnlockedCriblEstimate) {
      return;
    }

    if (container.classList.contains('field--hidden')) {
      showCriblForm();
      clearCriblError();
    } else {
      hideCriblForm();
      clearCriblError();
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const email = input.value;
    const validationError = validateWorkEmail(email);
    if (validationError) {
      error.textContent = validationError;
      error.classList.remove('field--hidden');
      return;
    }

    unlockCriblEstimate();
  });
}

initialize();
