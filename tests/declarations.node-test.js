import { readFile, readdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { SAVEABLE } from '../public/api/settings/PUT.js';
import { listProviders } from '../server/providers/index.js';

/*
  Static checks that what the code asks for is what the extension declares.

  A permission check against a name nobody registered does not error — it answers no, forever, and
  only for people who are not administrators, which is why it survives manual testing.

  Here the same drift is worse in one place: a credential written without its declared `secret`
  type is an API key stored in plain text, in a row kempo's own settings screen shows to anybody
  who can open it.
*/

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(path.join(root, 'kempo-config.json'), 'utf8'));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

const walk = async dir => {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for(const entry of entries){
    if(entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if(entry.isDirectory()) files.push(...await walk(full));
    else if(entry.name.endsWith('.js')) files.push(full);
  }
  return files;
};

const routes = await walk(path.join(root, 'public', 'api'));
const contents = new Map(await Promise.all(routes.map(async file => [file, await readFile(file, 'utf8')])));
const page = await readFile(path.join(root, 'admin', 'index.page.html'), 'utf8');
const publicSdk = await readFile(path.join(root, 'public', 'sdk.js'), 'utf8');

export default {
  'every permission a route checks is one the extension declares': async ({ pass, fail }) => {
    const declared = new Set(config.permissions.map(permission => permission.name));

    for(const [file, text] of contents){
      for(const match of text.matchAll(/gate\(request,\s*'([^']+)'\)/g)){
        if(!declared.has(match[1])) return fail(`${path.relative(root, file)} checks "${match[1]}", which kempo-config.json does not declare`);
      }
    }
    pass('');
  },

  'every route is gated': async ({ pass, fail }) => {
    for(const [file, text] of contents){
      if(!/gate\(request,/.test(text)) return fail(`${path.relative(root, file)} has no permission check — there is no public route in this extension`);
    }
    pass('');
  },

  'every permission and group names only declared permissions': async ({ pass, fail }) => {
    const declared = new Set(config.permissions.map(permission => permission.name));
    for(const group of config.groups){
      for(const permission of group.permissions){
        if(!declared.has(permission)) return fail(`group ${group.name} lists "${permission}", which is not declared`);
      }
    }
    pass('');
  },

  'the admin page only gates on declared permissions': async ({ pass, fail }) => {
    const declared = new Set(config.permissions.map(permission => permission.name));
    for(const match of page.matchAll(/has="([^"]+)"/g)){
      if(!declared.has(match[1])) return fail(`the page gates on "${match[1]}", which is not declared`);
    }
    pass('');
  },

  'every saveable setting is declared, and every credential is a secret': async ({ pass, fail }) => {
    const declared = new Map(config.settings.map(setting => [setting.name, setting]));

    for(const name of SAVEABLE){
      if(!declared.has(name)) return fail(`${name} can be saved but kempo-config.json does not declare it`);
    }

    for(const provider of listProviders()){
      for(const field of provider.credentialFields){
        if(declared.get(field.name)?.type !== 'secret') return fail(`${field.name} must be declared with type "secret"`);
      }
    }
    pass('');
  },

  'every route the browser client calls exists': async ({ pass, fail }) => {
    const present = new Set(routes.map(file => path.relative(path.join(root, 'public', 'api'), file).replace(/\\/g, '/')));

    for(const match of publicSdk.matchAll(/request\('([^'?]+)'(?:,\s*json\('(\w+)')?/g)){
      const method = match[2] || 'GET';
      const expected = `${match[1].replace(/^\//, '')}/${method}.js`;
      if(!present.has(expected)) return fail(`public/sdk.js calls ${method} ${match[1]} but ${expected} does not exist`);
    }
    pass('');
  },

  'the public scope is declared and the SDK is exported': async ({ pass, fail }) => {
    if(config['public-scope'] !== 'tax') return fail('public-scope should be "tax", which the browser client is written against');
    if(!pkg.exports['./sdk']) return fail('package.json should export ./sdk');
    pass('');
  },
};
