import * as stripe from '../server/providers/stripe.js';
import { listProviders } from '../server/providers/index.js';

/*
  What can be checked about the Stripe module without a key and without a network.
*/

export default {
  'with no key anywhere the provider reports itself unconfigured, and a call says why': async ({ pass, fail }) => {
    const [, status] = await stripe.status();
    if(status.configured) return fail('there should be no key in a test database');
    if(status.mode !== null) return fail('no key means no mode');

    const [error] = await stripe.calculate({ currency: 'usd', lines: [], address: { country: 'US' }, taxIds: [], shipping: null });
    if(!error || error.code !== 409) return fail('a call without a key should be a 409, never a silent zero');
    pass('');
  },

  'the location error gets wording a caller can act on': async ({ pass, fail }) => {
    const [error] = stripe.failure({ code: 'customer_tax_location_invalid', statusCode: 400, message: 'internal wording' });
    if(error.code !== 422) return fail(`expected 422, got ${error.code}`);
    if(/internal/.test(error.msg)) return fail('the stock message should be replaced');
    pass('');
  },

  'a long provider error is cut to one short sentence': async ({ pass, fail }) => {
    const message = `First sentence. ${'More detail about the account. '.repeat(40)}`;
    const [error] = stripe.failure({ type: 'StripeInvalidRequestError', statusCode: 400, message });
    if(error.msg !== 'First sentence.') return fail(`got: ${error.msg}`);
    pass('');
  },

  'a network failure becomes a 502, not a status of zero': async ({ pass, fail }) => {
    const [error] = stripe.failure({ type: 'StripeConnectionError', message: 'socket hang up' });
    if(error.code !== 502) return fail(`expected 502, got ${error.code}`);
    pass('');
  },

  'every credential the provider declares is a secret': async ({ pass, fail }) => {
    for(const provider of listProviders()){
      for(const field of provider.credentialFields){
        if(field.type !== 'secret') return fail(`${field.name} is not a secret, so it would be stored as plain text`);
      }
    }
    pass('');
  },
};
