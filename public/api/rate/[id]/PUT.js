import { updateRate } from '../../../../server/utils/rates/store.js';
import { presentRate } from '../../../../server/utils/rates/validate.js';
import { gate } from '../../../../server/utils/permissions/gate.js';

/*
  Edit a rate. To change a rate going forward, set `effectiveTo` on the old row and add a new one:
  a sale quoted last month must still be taxed at last month's rate, and an edit in place would
  change that.
*/
export default async (request, response) => {
  const [gateError] = await gate(request, 'tax:rates');
  if(gateError) return response.status(gateError.code).json({ error: gateError.msg });

  const [error, row] = await updateRate(Number(request.params.id), request.body);
  if(error) return response.status(error.code).json({ error: error.msg });

  response.json({ rate: presentRate(row) });
};
