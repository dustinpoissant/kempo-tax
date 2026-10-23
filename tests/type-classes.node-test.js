import { TAX_CLASSES, parseRequest } from '../server/utils/tax/shape.js';
import { DEFAULTS, normaliseTypeClasses } from '../server/utils/config/settings.js';

/*
  What a product type is taxed as. A line that names a class of its own wins; otherwise the class of its product type
  from the Settings screen; otherwise the default class. No Stripe and no database.
*/

const parse = (lines, defaults) => {
  const [error, parsed] = parseRequest({ address: { country: 'US', state: 'VT', postalCode: '05401' }, lines }, defaults);
  if(error) throw new Error(`unexpected refusal: ${error.msg}`);
  return parsed;
};

const defaults = { taxClass: 'physical', typeClasses: { 'credits-only': 'nontaxable', ebook: 'digital' } };

export default {
  'a line is taxed as the class of its product type': async ({ pass, fail }) => {
    const { lines } = parse([{ amount: 900, reference: 'credits', productType: 'credits-only' }, { amount: 500, reference: 'book', productType: 'ebook' }], defaults);
    if(lines[0].taxClass !== 'nontaxable' || lines[0].taxCode !== TAX_CLASSES.nontaxable) return fail(`credits were ${lines[0].taxClass} / ${lines[0].taxCode}`);
    if(lines[1].taxClass !== 'digital' || lines[1].taxCode !== TAX_CLASSES.digital) return fail(`the e-book was ${lines[1].taxClass}`);
    pass('credits are non-taxable and an e-book is digital, from the map');
  },

  'a class the line names beats its product type, and a type with no entry uses the default class': async ({ pass, fail }) => {
    const { lines } = parse([
      { amount: 900, reference: 'a', productType: 'credits-only', taxClass: 'digital' },
      { amount: 900, reference: 'b', productType: 'credits-only', taxCode: 'txcd_20030000' },
      { amount: 900, reference: 'c', productType: 'generic' },
      { amount: 900, reference: 'd' },
    ], defaults);
    if(lines[0].taxClass !== 'digital') return fail(`a named class was overridden by the type: ${lines[0].taxClass}`);
    if(lines[1].taxCode !== 'txcd_20030000') return fail(`a named code was overridden by the type: ${lines[1].taxCode}`);
    if(lines[2].taxClass !== 'physical') return fail(`a type with no entry should use the default, got ${lines[2].taxClass}`);
    if(lines[3].taxClass !== 'physical') return fail(`a line with no type should use the default, got ${lines[3].taxClass}`);
    pass('named class, then the type, then the default');
  },

  'no map, or a product type that is not text, changes nothing': async ({ pass, fail }) => {
    const { lines } = parse([{ amount: 900, reference: 'a', productType: 'credits-only' }, { amount: 900, reference: 'b', productType: 42 }, { amount: 900, reference: 'c', productType: '__proto__' }], { taxClass: 'physical' });
    for(const line of lines) if(line.taxClass !== 'physical') return fail(`${line.reference} was ${line.taxClass}`);
    const typed = parse([{ amount: 900, reference: 'a', productType: 42 }, { amount: 900, reference: 'b', productType: 'constructor' }], defaults);
    for(const line of typed.lines) if(line.taxClass !== 'physical') return fail(`${line.reference} was ${line.taxClass}`);
    pass('an unmapped or odd type is the default class');
  },

  'the stored map is read over the built-in defaults, and anything invalid is dropped': async ({ pass, fail }) => {
    const builtIn = normaliseTypeClasses('');
    if(builtIn.physical !== 'physical' || builtIn['credits-only'] !== 'digital') return fail(`the defaults are ${JSON.stringify(builtIn)}`);
    if(JSON.stringify(builtIn) !== JSON.stringify(DEFAULTS.taxClassByType)) return fail('an empty setting should be the defaults');

    const custom = normaliseTypeClasses(JSON.stringify({ 'credits-only': 'digital', ebook: ' DIGITAL ', course: 'txcd_20030000', junk: 'not-a-class', 'bad key!': 'digital', blank: '' }));
    if(custom['credits-only'] !== 'digital') return fail('a stored value should replace the default');
    if(custom.ebook !== 'digital' || custom.course !== 'txcd_20030000') return fail(`a class or a txcd code should be kept: ${JSON.stringify(custom)}`);
    if('junk' in custom || 'bad key!' in custom || 'blank' in custom) return fail(`invalid entries were kept: ${JSON.stringify(custom)}`);
    pass('merged over the defaults; bad classes, bad keys and blanks are dropped');
  },

  'a blank value sends the type back to the default class, and an unreadable setting falls back to the built-in map': async ({ pass, fail }) => {
    const blank = normaliseTypeClasses({ 'credits-only': '' });
    if('credits-only' in blank) return fail('a blank should remove the type from the map, so the default class applies');
    for(const bad of ['{not json', 'null', '[]', '42', null, undefined]){
      const result = normaliseTypeClasses(bad);
      if(result['credits-only'] !== 'digital') return fail(`${JSON.stringify(bad)} should fall back to the built-in map, got ${JSON.stringify(result)}`);
    }
    pass('blank means the default class; garbage means the built-in map');
  },
};
