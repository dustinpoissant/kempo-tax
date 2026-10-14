import { recordTransaction } from '../../../../server/utils/tax/transactions.js';
import { gate } from '../../../../server/utils/permissions/gate.js';

/*
  Record a finished sale for tax reporting. `{ calculationId, reference }`.
*/
export default async (request, response) => {
  const [gateError] = await gate(request, 'tax:record');
  if(gateError) return response.status(gateError.code).json({ error: gateError.msg });

  const [error, result] = await recordTransaction(request.body || {});
  if(error) return response.status(error.code).json({ error: error.msg });

  response.json(result);
};
