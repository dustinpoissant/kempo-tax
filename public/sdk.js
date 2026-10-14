/*
  Browser client, served at /tax/sdk.js.

  Mirrors the server SDK's names so a call reads the same on either side, and returns the same
  [error, data] tuples the rest of kempo uses.

  Every call needs a signed-in user holding the matching permission — there is deliberately no
  anonymous endpoint, see public/api/calculate/POST.js. A storefront shows its customers a tax
  figure by asking from its own server.
*/

const BASE = '/tax/api';

const request = async (path, options = {}) => {
  try {
    const response = await fetch(`${BASE}${path}`, { credentials: 'same-origin', ...options });
    const data = await response.json().catch(() => ({}));
    if(!response.ok) return [{ code: response.status, msg: data.error || response.statusText }, null];
    return [null, data];
  } catch(error) {
    return [{ code: 0, msg: error.message }, null];
  }
};

const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body ?? {}),
});

export const calculateTax = body => request('/calculate', json('POST', body));

export const recordTransaction = ({ calculationId, reference }) => request('/transactions/record', json('POST', { calculationId, reference }));

export const reverseTransaction = ({ transactionId, reference, amount }) => request('/transactions/reverse', json('POST', { transactionId, reference, amount }));

export const getStatus = () => request('/status');

export const listRegistrations = () => request('/registrations');

export const listTaxCodes = () => request('/tax-codes');

export const getSettings = () => request('/settings');

export const saveSettings = body => request('/settings', json('PUT', body));

/*
  The rate table
*/

export const listRates = (params = {}) => {
  const search = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== ''));
  return request(`/rates${search.toString() ? `?${search}` : ''}`);
};

export const createRate = body => request('/rates', json('POST', body));

export const updateRate = (id, body) => request(`/rate/${id}`, json('PUT', body));

export const deleteRate = id => request(`/rate/${id}`, { method: 'DELETE' });

export const importRates = csv => request('/rate-import', json('POST', { csv }));

export const quickStart = answers => request('/rate-quickstart', json('POST', answers));

/*
  The ledger and reports. The export routes return files, so they are links, not calls.
*/

export const listLedger = (params = {}) => {
  const search = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== ''));
  return request(`/ledger${search.toString() ? `?${search}` : ''}`);
};

export const getReport = (params = {}) => {
  const search = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== ''));
  return request(`/reports${search.toString() ? `?${search}` : ''}`);
};

export const exportUrls = {
  rates: `${BASE}/rate-export`,
  ledger: params => `${BASE}/ledger-export${params && Object.keys(params).length ? `?${new URLSearchParams(params)}` : ''}`,
  report: params => `${BASE}/report-export${params && Object.keys(params).length ? `?${new URLSearchParams(params)}` : ''}`,
};
