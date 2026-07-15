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
 * electives: [{ price }] (Elective rows already loaded for the chosen ids)
 * ixlPlan: 'NONE' | 'CORE' | 'CORE_SPANISH'
 * term: { regularRate, anchoredRate, depositDueDate }
 */
export const calculateRegistrationBilling = ({ term, groupType, electives = [], ixlPlan = 'NONE' }) => {
  const baseRate = Number(groupType === 'ANCHORED' ? term.anchoredRate : term.regularRate) || 0;
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
