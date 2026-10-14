/*
  One thing the declarative config cannot do: say that the encryption key is missing.

  The Stripe key is a `secret` setting, and kempo can only encrypt those when SETTINGS_ENCRYPTION_KEY
  is set. Without it the setting is silently not created, and the first sign of trouble is a
  settings screen that refuses to save a key with no explanation. Saying so at install time is the
  difference between a two-minute fix and an hour.

  This extension has no tables, so there is nothing else to set up.
*/
export default async () => {
  if(!process.env.SETTINGS_ENCRYPTION_KEY){
    console.warn([
      '[kempo-tax] SETTINGS_ENCRYPTION_KEY is not set, so the Stripe key cannot be stored.',
      '  Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
      '  Put it in .env, restart, then reinstall this extension.',
      '  Back it up somewhere — losing it makes every stored secret on the site unrecoverable.',
    ].join('\n'));
    return;
  }

  console.log('[kempo-tax] Installed. Connect Stripe at /admin/extension/kempo-tax/ — no tax can be looked up until you do.');
};
