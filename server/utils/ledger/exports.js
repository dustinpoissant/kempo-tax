import { formatMinor } from './money.js';

/*
  The columns of the two CSV exports. Amounts are written as decimals in the major unit
  (12.34), because a spreadsheet wants that; the integers in the database are an implementation
  detail of keeping money exact.
*/

const money = field => row => formatMinor(row[field], row.currency);

const iso = value => (value instanceof Date ? value.toISOString() : value);

export const ledgerColumns = [
  { key: 'id', label: 'entry' },
  { key: 'kind', label: 'kind' },
  { key: 'reference', label: 'reference' },
  { key: 'occurredAt', label: 'occurred_at', value: row => iso(row.occurredAt) },
  { key: 'currency', label: 'currency' },
  { key: 'salesAmount', label: 'sales', value: money('salesAmount') },
  { key: 'taxableAmount', label: 'taxable', value: money('taxableAmount') },
  { key: 'exemptAmount', label: 'exempt', value: money('exemptAmount') },
  { key: 'uncollectedAmount', label: 'not_collected', value: money('uncollectedAmount') },
  { key: 'taxAmount', label: 'tax', value: money('taxAmount') },
  { key: 'country', label: 'country' },
  { key: 'state', label: 'state' },
  { key: 'postalCode', label: 'postal_code' },
  { key: 'provider', label: 'provider' },
  { key: 'livemode', label: 'live' },
  { key: 'originalEntryId', label: 'reverses_entry' },
  {
    key: 'jurisdictions',
    label: 'jurisdictions',
    value: row => (row.jurisdictions || []).map(part => `${part.jurisdiction} ${part.rate ?? ''}% ${formatMinor(part.amount, row.currency)}`).join('; '),
  },
  { key: 'note', label: 'note' },
];

export const reportColumns = currency => {
  const amount = field => row => (row[field] === '' || row[field] === undefined ? '' : formatMinor(row[field], currency));
  return [
    { key: 'currency', label: 'currency' },
    { key: 'row', label: 'row' },
    { key: 'country', label: 'country' },
    { key: 'state', label: 'state' },
    { key: 'level', label: 'level' },
    { key: 'jurisdiction', label: 'jurisdiction' },
    { key: 'rate', label: 'rate_percent' },
    { key: 'taxableAmount', label: 'taxable_sales', value: amount('taxableAmount') },
    { key: 'taxAmount', label: 'tax_net', value: amount('taxAmount') },
    { key: 'sales', label: 'total_sales', value: amount('sales') },
    { key: 'exempt', label: 'exempt_sales', value: amount('exempt') },
    { key: 'uncollected', label: 'not_collected_sales', value: amount('uncollected') },
    { key: 'taxCollected', label: 'tax_collected', value: amount('taxCollected') },
    { key: 'taxReversed', label: 'tax_reversed', value: amount('taxReversed') },
  ];
};
