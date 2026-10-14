import calculateTax from '../../../server/utils/tax/calculate.js';
import { gate } from '../../../server/utils/permissions/gate.js';

/*
  Ask what tax is owed on a set of items. Gated on `tax:calculate`, not left open — every call is
  an API call to Stripe, and an open endpoint would let anybody spend them. A storefront asks from
  its own server through the SDK instead.

  The body is exactly what `calculateTax` takes: `{ address, lines, shipping?, currency?, taxIds? }`.
*/
export default async (request, response) => {
  const [gateError] = await gate(request, 'tax:calculate');
  if(gateError) return response.status(gateError.code).json({ error: gateError.msg });

  const [error, result] = await calculateTax(request.body);
  if(error) return response.status(error.code).json({ error: error.msg });

  response.json(result);
};
