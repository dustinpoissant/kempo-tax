/*
  Minor units to a decimal string, for exports. Nothing in this extension stores anything but
  integers, so this is only ever for presentation; a spreadsheet wants 12.34, not 1234.
*/

const ZERO = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);
const THREE = new Set(['bhd', 'iqd', 'jod', 'kwd', 'lyd', 'omr', 'tnd']);

export const decimalsFor = currency => {
  const code = String(currency || '').toLowerCase();
  return ZERO.has(code) ? 0 : THREE.has(code) ? 3 : 2;
};

export const formatMinor = (amount, currency) => {
  const decimals = decimalsFor(currency);
  const negative = amount < 0;
  const digits = String(Math.abs(amount)).padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals ? `.${digits.slice(-decimals)}` : '';
  return `${negative ? '-' : ''}${whole}${fraction}`;
};
