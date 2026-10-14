import { activeProvider } from '../../../server/providers/index.js';
import { gate } from '../../../server/utils/permissions/gate.js';

/*
  Whether tax can actually be looked up, and if not, why.

  Two separate questions with two separate answers, and the screen needs both: `status` is whether
  *this site* has a key, which costs nothing to answer, and `account` is whether Stripe Tax is
  switched on for that account, which is a call to Stripe. A key can be perfectly valid on an
  account that has never enabled Stripe Tax, and the failure is then in a different place.

  A failure of the second is reported beside the first rather than failing the request, so a
  revoked key still shows the screen that lets somebody replace it.
*/
export default async (request, response) => {
  const [gateError] = await gate(request, 'tax:view');
  if(gateError) return response.status(gateError.code).json({ error: gateError.msg });

  const [providerError, provider] = await activeProvider();
  if(providerError) return response.status(providerError.code).json({ error: providerError.msg });

  const [, status] = await provider.status();

  let account = null;
  let accountError = null;
  if(status.configured){
    const [error, data] = await provider.accountSettings();
    account = data;
    accountError = error ? error.msg : null;
  }

  response.json({ status, account, accountError });
};
