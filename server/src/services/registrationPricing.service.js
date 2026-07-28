const ELECTIVE_PRICE_DEFAULT = 130;
const IXL_PRICES = {
  NONE: 0,
  CORE: 5,
  CORE_SPANISH: 10,
};
const DEPOSIT_RATE = 0.15;

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Pure pricing calculation — mirrors the Google Apps Script trigger.
 * groupType: 'REGULAR' | 'ANCHORED'
 * priceOverride: the class's own price, or null to use the term rate
 * electives: [{ price }] (Elective rows already loaded for the chosen ids)
 * ixlPlan: 'NONE' | 'CORE' | 'CORE_SPANISH'
 * term: { regularRate, anchoredRate, depositDueDate }
 *
 * A term holds two rates, which the Discovery Coves use (regular = Lighthouse
 * / Deep Sea, anchored = Anchored Learning Group). Everything else on the price
 * list — Biology, Algebra 1, the 8th grade programme — is its own number in the
 * same period, so a class may carry its own price and that price wins.
 *
 * Note 0 is a real answer here, not "unset": a free class prices at 0 rather
 * than falling back to the term. Only null/undefined defers to the term.
 */
export const calculateRegistrationBilling = ({ term, groupType, priceOverride = null, electives = [], ixlPlan = 'NONE' }) => {
  const termRate = Number(groupType === 'ANCHORED' ? term.anchoredRate : term.regularRate) || 0;
  const baseRate = priceOverride === null || priceOverride === undefined
    ? termRate
    : Number(priceOverride) || 0;
  const electivesTotal = round2(electives.reduce((sum, e) => sum + (e.price != null ? Number(e.price) : ELECTIVE_PRICE_DEFAULT), 0));
  const ixlTotal = IXL_PRICES[ixlPlan] ?? 0;
  const totalQuarterly = round2(baseRate + electivesTotal + ixlTotal);
  const depositAmount = round2(totalQuarterly * DEPOSIT_RATE);

  return {
    baseRate,
    electivesTotal,
    ixlTotal,
    totalQuarterly,
    depositAmount,
    depositDueDate: term.depositDueDate || null,
  };
};
