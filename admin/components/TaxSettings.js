import ShadowComponent from '/kempo-ui/components/ShadowComponent.js';
import '/kempo-ui/components/Spinner.js';
import { html, css } from '/kempo-ui/lit-all.min.js';
import { getSettings, saveSettings, listTaxCodes } from '/tax/sdk.js';

/*
  Connecting the site to Stripe, and the defaults a calculation falls back on.

  Two things here are load-bearing and neither is the form:

  - **Where the key comes from.** If this extension has no key of its own it uses kempo-payments',
    and the screen says so. A key that is silently borrowed is one somebody rotates in one place
    and wonders why tax stopped working.
  - **Blank means unchanged.** A secret cannot be read back, so its field is always empty. Saving
    after changing the currency must not wipe the key, and clearing it is a separate button.
*/
export default class TaxSettings extends ShadowComponent {
  static properties = {
    status: { type: Object, state: true },
    providers: { type: Array, state: true },
    encryptionConfigured: { type: Boolean, state: true },
    values: { type: Object, state: true },
    edits: { type: Object, state: true },
    codes: { type: Array, state: true },
    saving: { type: Boolean, state: true },
    loaded: { type: Boolean, state: true },
    error: { type: String, state: true },
    notice: { type: String, state: true },
  };

  constructor(){
    super();
    this.status = null;
    this.providers = [];
    this.encryptionConfigured = true;
    this.values = {};
    this.edits = {};
    this.codes = [];
    this.saving = false;
    this.loaded = false;
    this.error = '';
    this.notice = '';
  }

  /*
    Lifecycle
  */

  connectedCallback(){
    super.connectedCallback();
    this.load();
  }

  /*
    Data
  */

  load = async () => {
    const [error, data] = await getSettings();
    if(error){
      this.error = error.msg;
      this.loaded = true;
      return;
    }

    this.providers = data.providers;
    this.status = data.status;
    this.encryptionConfigured = data.encryptionConfigured;
    this.values = { ...data.settings };
    this.edits = {};
    this.loaded = true;

    // The picker is a convenience; settings still work with a typed id if Stripe is unreachable.
    if(data.status?.configured){
      const [, tax] = await listTaxCodes();
      if(tax) this.codes = tax.codes;
    }
  };

  get provider(){
    return this.providers.find(entry => entry.name === this.values.provider) || this.providers[0] || null;
  }

  set = (name, value) => {
    this.values = { ...this.values, [name]: value };
  };

  edit = (name, value) => {
    this.edits = { ...this.edits, [name]: value };
  };

  save = async () => {
    this.saving = true;
    this.error = '';
    this.notice = '';

    const body = {
      provider: this.values.provider,
      currency: this.values.currency,
      prices_include_tax: !!this.values.includesTax,
      default_tax_code: this.values.taxCode,
      shipping_tax_code: this.values.shippingTaxCode,
    };

    // Only what was actually typed, so "blank means unchanged" holds at the wire.
    for(const field of this.provider?.credentialFields || []){
      const value = this.edits[field.name];
      if(value === null || (typeof value === 'string' && value.trim())) body[field.name] = value;
    }

    const [error] = await saveSettings(body);
    this.saving = false;

    if(error){
      this.error = error.msg;
      return;
    }

    this.notice = 'Saved.';
    await this.load();
  };

  clear = async name => {
    this.edits = { ...this.edits, [name]: null };
    await this.save();
  };

  /*
    Rendering
  */

  #renderBanner(){
    if(!this.encryptionConfigured){
      return html`
        <div class="card banner tc-danger">
          <strong>SETTINGS_ENCRYPTION_KEY is not set on this server.</strong>
          <p class="small">
            The Stripe key is encrypted with it, so none can be stored until it exists. Generate one with
            <code class="ff-mono">node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"</code>,
            put it in the site’s environment, and restart. Back it up — losing it makes every stored secret unrecoverable.
          </p>
        </div>
      `;
    }

    if(!this.status?.configured){
      return html`
        <div class="card banner tc-warning">
          <strong>Not connected.</strong>
          <p class="small">Save a Stripe secret key below, or install kempo-payments and connect Stripe there.</p>
        </div>
      `;
    }

    return html`
      <div class="card banner ${this.status.livemode ? 'tc-danger' : 'tc-success'}">
        <strong>
          ${this.status.livemode ? 'Using a live key — calculations are real.' : 'Using a test key. No real tax is reported.'}
        </strong>
        <p class="small">
          ${this.status.keySource === 'payments'
            ? 'The key is borrowed from kempo-payments. Save one below to give tax its own.'
            : 'The key is stored on this screen.'}
        </p>
      </div>
    `;
  }

  #renderCredentials(){
    return (this.provider?.credentialFields || []).map(field => {
      const isSet = !!this.status?.fields?.[field.name];
      const value = this.edits[field.name];

      return html`
        <label class="field">
          <span class="d-b">${field.label} ${isSet ? html`<span class="small tc-success">· set</span>` : ''}</span>
          <span class="small tc-muted d-b">${field.help}</span>
          <input
            type="password"
            autocomplete="off"
            placeholder=${isSet ? '•••••••• — leave blank to keep' : field.placeholder}
            .value=${typeof value === 'string' ? value : ''}
            @input=${event => this.edit(field.name, event.target.value)}
          />
          ${isSet ? html`<button class="link small" ?disabled=${this.saving} @click=${() => this.clear(field.name)}>Clear this key</button>` : ''}
        </label>
      `;
    });
  }

  #renderCodePicker(label, help, name){
    return html`
      <label class="field">
        <span class="d-b">${label}</span>
        <span class="small tc-muted d-b">${help}</span>
        ${this.codes.length ? html`
          <select .value=${this.values[name]} @change=${event => this.set(name, event.target.value)}>
            <option value="" ?selected=${!this.values[name]}>Stripe’s own default</option>
            ${this.codes.map(code => html`<option value=${code.id} ?selected=${code.id === this.values[name]}>${code.name} (${code.id})</option>`)}
          </select>
        ` : html`
          <input type="text" placeholder="txcd_…" .value=${this.values[name]} @input=${event => this.set(name, event.target.value)} />
        `}
      </label>
    `;
  }

  render(){
    if(!this.loaded) return html`<k-spinner></k-spinner>`;

    return html`
      ${this.#renderBanner()}
      ${this.error ? html`<p class="tc-danger">${this.error}</p>` : ''}
      ${this.notice ? html`<p class="tc-success small">${this.notice}</p>` : ''}

      <h2>Provider</h2>
      <label class="field">
        <span class="small tc-muted d-b">What works out the tax</span>
        <select .value=${this.values.provider} @change=${event => this.set('provider', event.target.value)}>
          ${this.providers.map(entry => html`<option value=${entry.name} ?selected=${entry.name === this.values.provider}>${entry.label}</option>`)}
        </select>
      </label>

      ${this.#renderCredentials()}

      <h2>Defaults</h2>
      <label class="field">
        <span class="d-b">Currency</span>
        <span class="small tc-muted d-b">Used when whatever asks for a calculation does not name one</span>
        <input type="text" maxlength="3" .value=${this.values.currency} @input=${event => this.set('currency', event.target.value)} />
      </label>

      <label class="field">
        <span class="d-b">
          <input type="checkbox" .checked=${!!this.values.includesTax} @change=${event => this.set('includesTax', event.target.checked)} />
          Prices already include tax
        </span>
        <span class="small tc-muted d-b">
          Turn on for VAT-style pricing where the sticker price is what is paid. Leave off for US-style
          pricing where tax is added at checkout. A caller can still say otherwise per line.
        </span>
      </label>

      ${this.#renderCodePicker('Default tax category', 'For an item whose caller names none. Whether it is taxable, and at what rate, is decided per place by Stripe.', 'taxCode')}
      ${this.#renderCodePicker('Shipping tax category', 'For shipping charges. Blank uses Stripe’s shipping category.', 'shippingTaxCode')}

      <button class="primary" ?disabled=${this.saving} @click=${this.save}>${this.saving ? 'Saving…' : 'Save settings'}</button>
    `;
  }

  static styles = css`
    :host { display: block; }
    .banner { margin-bottom: var(--spacer); }
    .banner p { margin-bottom: 0; }
    .field { margin-bottom: var(--spacer); max-width: 40rem; }
  `;
}

customElements.define('k-tax-settings', TaxSettings);
