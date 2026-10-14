import { activeProvider } from '../../../server/providers/index.js';
import { gate } from '../../../server/utils/permissions/gate.js';

/*
  The places tax is actually being collected — read-only. Registering is done in the provider's own
  dashboard, where the filing obligations that come with it are explained.
*/
export default async (request, response) => {
  const [gateError] = await gate(request, 'tax:view');
  if(gateError) return response.status(gateError.code).json({ error: gateError.msg });

  const [providerError, provider] = await activeProvider();
  if(providerError) return response.status(providerError.code).json({ error: providerError.msg });

  const [error, registrations] = await provider.listRegistrations();
  if(error) return response.status(error.code).json({ error: error.msg });

  response.json({ registrations });
};
