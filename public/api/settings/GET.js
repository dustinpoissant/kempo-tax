import { activeProvider, listProviders } from '../../../server/providers/index.js';
import { readConfig } from '../../../server/utils/config/settings.js';
import { gate } from '../../../server/utils/permissions/gate.js';

/*
  Everything the settings screen renders, and not one character of a secret.

  The key comes back as a boolean — whether it is set, and where it came from — rather than a
  masked string. Masking in the response and hoping nothing logs it is a weaker promise than never
  putting it in the response at all, and the screen has no use for the value: editing a secret is
  replace-only by design.
*/
export default async (request, response) => {
  const [gateError] = await gate(request, 'tax:settings');
  if(gateError) return response.status(gateError.code).json({ error: gateError.msg });

  const config = await readConfig();
  const [providerError, provider] = await activeProvider();
  const status = providerError ? null : (await provider.status())[1];

  response.json({
    settings: config,
    providers: listProviders(),
    status,
    /*
      Said here rather than left for the admin to discover through a save that appears to work and
      does nothing. Without this key kempo cannot store a secret setting at all.
    */
    encryptionConfigured: !!process.env.SETTINGS_ENCRYPTION_KEY,
  });
};
