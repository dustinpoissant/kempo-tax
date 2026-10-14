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
