import install from './install.js';

/*
  Updating is the same job as installing: say something useful if the encryption key is missing.

  New settings, permissions and groups are added by kempo's own declarative diff before this runs,
  and existing values are never overwritten — so a site's Stripe key and defaults survive an update.
*/
export default async () => {
  await install();
};
