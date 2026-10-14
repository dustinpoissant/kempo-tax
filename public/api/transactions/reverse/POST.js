import { reverseTransaction } from '../../../../server/utils/tax/transactions.js';
import { gate } from '../../../../server/utils/permissions/gate.js';

/*
  Reverse a recorded sale, wholly or in part, for a refund. `{ transactionId, reference, amount? }`.
*/
export default async (request, response) => {
  const [gateError] = await gate(request, 'tax:record');
  if(gateError) return response.status(gateError.code).json({ error: gateError.msg });

  const [error, result] = await reverseTransaction(request.body || {});
  if(error) return response.status(error.code).json({ error: error.msg });

  response.json(result);
};
