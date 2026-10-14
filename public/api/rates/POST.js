import { createRate } from '../../../server/utils/rates/store.js';
import { presentRate } from '../../../server/utils/rates/validate.js';
import { gate } from '../../../server/utils/permissions/gate.js';

/*
  Add one rate. Validated by the same function the CSV import and the quick start use, so a row
  means the same thing however it arrived.
*/
export default async (request, response) => {
  const [gateError] = await gate(request, 'tax:rates');
  if(gateError) return response.status(gateError.code).json({ error: gateError.msg });

  const [error, row] = await createRate(request.body);
  if(error) return response.status(error.code).json({ error: error.msg });

  response.status(201).json({ rate: presentRate(row) });
};
