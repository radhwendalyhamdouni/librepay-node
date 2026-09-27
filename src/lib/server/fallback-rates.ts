/**
 * Static fallback fiat rates (fiat per BTC) used when the live rate API is
 * unreachable — keeps checkout usable. Clearly flagged as "fallback" to UI.
 */

export const FALLBACK_RATES: Record<string, number> = {
  USD: 65000, EUR: 60000, GBP: 51500, CHF: 57000, CAD: 88500, AUD: 97500,
  JPY: 9500000, AED: 238700, SAR: 243800, TND: 202000, DZD: 8720000,
  MAD: 642000, EGP: 3160000, TRY: 2730000,
};
