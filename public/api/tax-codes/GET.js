import { activeProvider } from '../../../server/providers/index.js';
import { TAX_CLASSES } from '../../../server/utils/tax/shape.js';
import { gate } from '../../../server/utils/permissions/gate.js';

/*
  The tax categories the provider understands, and this extension's own short names for the common
  ones. The screen uses it for the default-category picker, and it is how somebody checks that a
  class name resolves to the category they meant before selling anything under it.
*/
export default async (request, response) => {
  const [gateError] = await gate(request, 'tax:view');
  if(gateError) return response.status(gateError.code).json({ error: gateError.msg });

  const [providerError, provider] = await activeProvider();
  if(providerError) return response.status(providerError.code).json({ error: providerError.msg });

  const [error, codes] = await provider.listTaxCodes();
  if(error) return response.status(error.code).json({ error: error.msg });

  response.json({ classes: TAX_CLASSES, codes });
};
