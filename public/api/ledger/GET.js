import { listEntries } from '../../../server/utils/ledger/store.js';
import { gate } from '../../../server/utils/permissions/gate.js';

/*
  The ledger, newest first, a page at a time. Read-only: there is no route that writes or edits an
  entry directly, by design. Entries are made by recording a sale and by reversing one.
*/
export default async (request, response) => {
  const [gateError] = await gate(request, 'tax:reports');
  if(gateError) return response.status(gateError.code).json({ error: gateError.msg });

  const { from, to, kind, state, limit, offset } = request.query || {};

  const [error, data] = await listEntries({ from, to, kind, state, limit, offset });
  if(error) return response.status(error.code).json({ error: error.msg });

  response.json(data);
};
