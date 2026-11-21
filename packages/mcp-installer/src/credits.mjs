const BALANCE_FIELDS = ['remaining', 'monthlyRemaining', 'purchasedRemaining', 'reserved', 'debt'];
const numberFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });

function decimal(value) {
  return typeof value === 'string' && value.length <= 48 && /^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value)) && Number(value) > 0
    ? value : null;
}

function minimumCredits(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function parseCreditSummary(data) {
  const balance = data?.balance;
  if (!balance || BALANCE_FIELDS.some((field) => typeof balance[field] !== 'number' || !Number.isFinite(balance[field]) || balance[field] < 0)
    || typeof balance.usagePending !== 'boolean') return null;

  const reset = typeof balance.nextReset === 'string' ? Date.parse(balance.nextReset) : NaN;
  return {
    balance: {
      ...Object.fromEntries(BALANCE_FIELDS.map((field) => [field, balance[field]])),
      usagePending: balance.usagePending,
      nextReset: Number.isFinite(reset) ? new Date(reset).toISOString() : null,
    },
    pricing: {
      configured: data.pricing?.configured === true,
      usdPerCredit: decimal(data.pricing?.usdPerCredit),
      renderPerMinute: decimal(data.pricing?.renderPerMinute),
    },
    mcpPricing: data.mcpPricing?.sceneAuthoringCredits === 0 && data.mcpPricing?.serverRenderingBilled === true
      && data.mcpPricing?.sceneCompilationCredits === 0
      && data.mcpPricing?.toolSelectionCredits === 0 && typeof data.mcpPricing?.providerPricingConfigured === 'boolean'
      ? { providerPricingConfigured: data.mcpPricing.providerPricingConfigured,
        renderPricingConfigured: data.mcpPricing.renderPricingConfigured === true,
        renderPerMinute: decimal(data.mcpPricing.renderPerMinute),
        sceneRenderPerMinute: decimal(data.mcpPricing.sceneRenderPerMinute),
        speechMinimumCredits: minimumCredits(data.mcpPricing.speechMinimumCredits),
        transcriptionMinimumCredits: minimumCredits(data.mcpPricing.transcriptionMinimumCredits) } : null,
  };
}

export function creditSummaryLines(summary) {
  const { balance, pricing, mcpPricing } = summary;
  const n = (value) => numberFormat.format(value);
  const lines = [
    `API credits: ${n(balance.remaining)} available (monthly ${n(balance.monthlyRemaining)}; purchased ${n(balance.purchasedRemaining)}).`,
    'Credits are charged from actual usage after completion, not reserved for current work.',
  ];
  if (balance.debt > 0) lines.push(`Usage awaiting payment: ${n(balance.debt)} credits.`);
  if (balance.usagePending) lines.push('Some provider costs are still being finalized; this does not reserve the balance.');
  if (balance.remaining < 30) lines.push(mcpPricing
    ? 'Low balance: server video/scene rendering and image, speech and caption charges follow actual usage.'
    : 'Low balance: rendering and scene cost estimates are approximate; final charges follow actual usage.');
  if (balance.nextReset) lines.push(`Next monthly reset (UTC): ${balance.nextReset.slice(0, 10)}.`);
  if (mcpPricing) {
    lines.push('MCP: the current client writes scene code without a server AI generation fee. Server video rendering AND server scene rendering are billed; compiling live source is not an encoded scene export.');
    if (!mcpPricing.renderPricingConfigured) lines.push('Server rendering pricing is not configured. Video and scene rendering cannot start; source authoring/compilation remains available.');
    else if (mcpPricing.renderPerMinute && mcpPricing.sceneRenderPerMinute) lines.push(`Server render pricing: video ${mcpPricing.renderPerMinute} and scenes ${mcpPricing.sceneRenderPerMinute} credits/output minute, recorded separately.`);
    if (!mcpPricing.providerPricingConfigured) lines.push('Paid image, speech and caption pricing is not configured.');
    else lines.push(pricing.usdPerCredit
      ? `Pricing: USD ${pricing.usdPerCredit}/credit. AI charges are known after usage.`
      : 'Paid media charges are known after usage; no exact advance AI quote is available.');
    if (mcpPricing.providerPricingConfigured && mcpPricing.speechMinimumCredits > 0 && mcpPricing.transcriptionMinimumCredits > 0) {
      lines.push(`Audio minimums: speech ${n(mcpPricing.speechMinimumCredits)} and captions/transcription ${n(mcpPricing.transcriptionMinimumCredits)} credits per new provider request with verified positive usage; higher usage costs more.`);
    }
    return lines;
  }
  if (!pricing.configured) {
    lines.push('Paid API pricing is not configured. Recipe preparation/validation is still possible.');
  } else if (pricing.renderPerMinute && pricing.usdPerCredit) {
    lines.push(`Pricing: ${pricing.renderPerMinute} credits/output minute; USD ${pricing.usdPerCredit}/credit. AI charges are known after usage.`);
  } else {
    lines.push('Exact pricing could not be displayed. Do not assume a free render or an exact AI cost.');
  }
  return lines;
}

export function compactCreditSummaryLines(summary) {
  const lines = creditSummaryLines(summary);
  const important = /^(Usage awaiting payment:|Some provider costs|Low balance:|Server rendering pricing|Audio minimums:|Paid image, speech and caption pricing|Paid API pricing|Exact pricing)/;
  return [
    `API credits: ${numberFormat.format(summary.balance.remaining)} available.`,
    'Server rendering and generated media are billed after usage; credits are not reserved.',
    ...lines.filter((line) => important.test(line)),
  ];
}
