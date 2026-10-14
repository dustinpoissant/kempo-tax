import { listRates } from '../../../server/utils/rates/store.js';
import { presentRate } from '../../../server/utils/rates/validate.js';
import { gate } from '../../../server/utils/permissions/gate.js';

/*
  The rate table, as the admin screen and the CSV show it: rates as percentages, never millionths.
*/
export default async (request, response) => {
  const [gateError] = await gate(request, 'tax:view');
  if(gateError) return response.status(gateError.code).json({ error: gateError.msg });

  const [error, rows] = await listRates({ country: request.query?.country, state: request.query?.state });
  if(error) return response.status(error.code).json({ error: error.msg });

  response.json({ rates: rows.map(presentRate) });
};
