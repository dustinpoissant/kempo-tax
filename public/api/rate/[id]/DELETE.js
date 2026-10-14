import { deleteRate } from '../../../../server/utils/rates/store.js';
import { gate } from '../../../../server/utils/permissions/gate.js';

/*
  Remove a rate. The ledger keeps its own copy of what every recorded sale was taxed at, so this
  cannot change a past report — but it *can* change what a past date is quoted at, which is why the
  admin screen offers "end" first and this only for a row entered by mistake.
*/
export default async (request, response) => {
  const [gateError] = await gate(request, 'tax:rates');
  if(gateError) return response.status(gateError.code).json({ error: gateError.msg });

  const [error, result] = await deleteRate(Number(request.params.id));
  if(error) return response.status(error.code).json({ error: error.msg });

  response.json(result);
};
