import ShadowComponent from '/kempo-ui/components/ShadowComponent.js';
import '/kempo-ui/components/Spinner.js';
import { html, css } from '/kempo-ui/lit-all.min.js';
import { listRates, createRate, updateRate, deleteRate, importRates, quickStart, exportUrls } from '/tax/sdk.js';

/*
  The rate table, and the quick start that fills it.

  Two ideas the screen has to carry, because they are not obvious from a table of numbers:

  - **Rates are layers.** A state rate and a local option are two rows that *add*, one per level.
    The Level column is there so somebody can see why a customer in one town pays 7% and in the
    next 6%.
  - **A rate is ended, not edited, when it changes.** A sale quoted last month must still be taxed
    at last month's rate. "End" sets the date; "Edit" is for fixing a mistake.

  The quick start writes ordinary rows and nothing hidden — after it runs, every line it made is
  right here, to be read and changed.
*/

const CLASSES = ['physical', 'digital', 'saas', 'saas-business'];

const blank = () => ({
  country: 'US', state: '', locality: '', postalPattern: '', taxClass: 'physical', level: '', kind: 'taxable',
  rate: '', appliesToShipping: false, shippingProportional: false, jurisdiction: '', label: '', priority: 0, effectiveFrom: '', effectiveTo: '', note: '',
});

export default class TaxRates extends ShadowComponent {
  static properties = {
    rates: { type: Array, state: true },
    loaded: { type: Boolean, state: true },
    editing: { type: Object, state: true },
    quick: { type: Object, state: true },
    importing: { type: Boolean, state: true },
    csv: { type: String, state: true },
    error: { type: String, state: true },
    notice: { type: String, state: true },
    busy: { type: Boolean, state: true },
  };

  constructor(){
    super();
    this.rates = [];
    this.loaded = false;
    this.editing = null;
    this.quick = { country: 'US', state: '', stateRate: '', jurisdiction: '', taxable: ['physical'], exempt: ['nontaxable'], shipping: 'none', locals: '' };
    this.importing = false;
    this.csv = '';
    this.error = '';
    this.notice = '';
    this.busy = false;
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
    const [error, data] = await listRates();
    if(error) this.error = error.msg;
    else this.rates = data.rates;
    this.loaded = true;
  };

  say = (notice, error = '') => {
    this.notice = notice;
    this.error = error;
  };

  save = async () => {
    this.busy = true;
    const { id, ...body } = this.editing;
    const [error] = id ? await updateRate(id, body) : await createRate(body);
    this.busy = false;

    if(error) return this.say('', error.msg);
    this.editing = null;
    this.say('Saved.');
    await this.load();
  };

  /*
    Ending a rate is "stop applying from today", not removal. Today's date is UTC, which is what
    the calculation compares against.
  */
  end = async rate => {
    const today = new Date().toISOString().slice(0, 10);
    const [error] = await updateRate(rate.id, { ...rate, effectiveTo: today });
    if(error) return this.say('', error.msg);
    this.say(`Ended ${rate.jurisdiction || rate.country} ${rate.taxClass} from ${today}.`);
    await this.load();
  };

  remove = async rate => {
    if(!confirm('Delete this rate? Ending it keeps the history; deleting is for a row entered by mistake. Recorded sales are not affected either way.')) return;
    const [error] = await deleteRate(rate.id);
    if(error) return this.say('', error.msg);
    this.say('Deleted.');
    await this.load();
  };

  runQuickStart = async () => {
    const { country, state, stateRate, jurisdiction, taxable, exempt, shipping, locals } = this.quick;

    const localRates = locals.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
      const [locality, rate] = line.split('=').map(part => part.trim());
      return { locality, rate };
    });

    this.busy = true;
    const [error, data] = await quickStart({
      country, state, stateRate, jurisdiction, taxableClasses: taxable, exemptClasses: exempt, shipping, localRates,
    });
    this.busy = false;

    if(error) return this.say('', error.msg);
    this.say(`Added ${data.added} rates and switched the provider to the rate table. Review them below.`);
    await this.load();
  };

  runImport = async () => {
    this.busy = true;
    const [error, data] = await importRates(this.csv);
    this.busy = false;

    if(error) return this.say('', error.msg);
    this.importing = false;
    this.csv = '';
    this.say(`Added ${data.added} rates.`);
    await this.load();
  };

  toggle = (name, value) => {
    const current = this.quick[name];
    this.quick = { ...this.quick, [name]: current.includes(value) ? current.filter(item => item !== value) : [...current, value] };
  };

  setQuick = (name, value) => {
    this.quick = { ...this.quick, [name]: value };
  };

  set = (name, value) => {
    this.editing = { ...this.editing, [name]: value };
  };

  /*
    Rendering
  */

  #field = (label, name, extra = {}) => html`
    <label class="field">
      <span class="d-b">${label}</span>
      <input type=${extra.type || 'text'} placeholder=${extra.placeholder || ''} .value=${String(this.editing[name] ?? '')}
        @input=${event => this.set(name, event.target.value)} />
    </label>
  `;

  #renderEditor(){
    const rate = this.editing;

    return html`
      <div class="card pb">
        <h2>${rate.id ? 'Edit rate' : 'Add a rate'}</h2>
        <div class="grid">
          ${this.#field('Country', 'country', { placeholder: 'US' })}
          ${this.#field('State / region', 'state', { placeholder: 'VT — blank for the whole country' })}
          ${this.#field('Town (optional)', 'locality', { placeholder: 'Burlington' })}
          ${this.#field('Postal codes (optional)', 'postalPattern', { placeholder: '05401, 054*, 05400-05499' })}
          <label class="field">
            <span class="d-b">Applies to</span>
            <input type="text" list="classes" .value=${rate.taxClass} @input=${event => this.set('taxClass', event.target.value)} />
            <datalist id="classes">
              <option value="*">every class</option>
              ${CLASSES.concat(['nontaxable', 'shipping']).map(name => html`<option value=${name}></option>`)}
            </datalist>
          </label>
          <label class="field">
            <span class="d-b">Kind</span>
            <select .value=${rate.kind} @change=${event => this.set('kind', event.target.value)}>
              <option value="taxable" ?selected=${rate.kind === 'taxable'}>Taxable</option>
              <option value="exempt" ?selected=${rate.kind === 'exempt'}>Exempt (no tax, still reported)</option>
            </select>
          </label>
          ${rate.kind === 'taxable' ? this.#field('Rate %', 'rate', { placeholder: '6 or 7.25' }) : ''}
          <label class="field">
            <span class="d-b">Level</span>
            <select .value=${rate.level} @change=${event => this.set('level', event.target.value)}>
              <option value="" ?selected=${!rate.level}>Work it out</option>
              ${['country', 'state', 'county', 'city', 'district', 'special'].map(level => html`<option value=${level} ?selected=${rate.level === level}>${level}</option>`)}
            </select>
          </label>
          ${this.#field('Jurisdiction (shown on reports)', 'jurisdiction', { placeholder: 'Vermont' })}
          ${this.#field('Effective from', 'effectiveFrom', { type: 'date' })}
          ${this.#field('Effective to (exclusive)', 'effectiveTo', { type: 'date' })}
          ${this.#field('Priority', 'priority', { type: 'number' })}
        </div>
        <label class="field">
          <input type="checkbox" .checked=${!!rate.appliesToShipping} @change=${event => this.set('appliesToShipping', event.target.checked)} />
          This row applies to shipping charges
        </label>
        ${rate.appliesToShipping ? html`
          <label class="field">
            <input type="checkbox" .checked=${!!rate.shippingProportional} @change=${event => this.set('shippingProportional', event.target.checked)} />
            …and only in proportion to the taxable goods in the order
          </label>
        ` : ''}
        <button class="primary" ?disabled=${this.busy} @click=${this.save}>${this.busy ? 'Saving…' : 'Save'}</button>
        <button class="secondary" @click=${() => { this.editing = null; }}>Cancel</button>
      </div>
    `;
  }

  #renderQuickStart(){
    const quick = this.quick;

    return html`
      <div class="card pb">
        <h2>Quick start</h2>
        <p class="tc-muted mb">
          Answer five questions and the matching rows are created for you — real rows, which you can then edit.
          <strong>Get the rate from your tax authority</strong>; this does not look it up or guess it.
        </p>
        <div class="grid">
          <label class="field"><span class="d-b">Country</span>
            <input type="text" .value=${quick.country} @input=${event => this.setQuick('country', event.target.value)} /></label>
          <label class="field"><span class="d-b">State / region you collect in</span>
            <input type="text" placeholder="VT" .value=${quick.state} @input=${event => this.setQuick('state', event.target.value)} /></label>
          <label class="field"><span class="d-b">State rate %</span>
            <input type="text" placeholder="6" .value=${quick.stateRate} @input=${event => this.setQuick('stateRate', event.target.value)} /></label>
          <label class="field"><span class="d-b">Name on reports</span>
            <input type="text" placeholder="Vermont" .value=${quick.jurisdiction} @input=${event => this.setQuick('jurisdiction', event.target.value)} /></label>
        </div>

        <p class="d-b mb">Taxable:</p>
        ${CLASSES.map(name => html`
          <label class="d-ib"><input type="checkbox" .checked=${quick.taxable.includes(name)} @change=${() => this.toggle('taxable', name)} /> ${name}</label>
        `)}
        <p class="d-b mb">Exempt (sold here, no tax, still reported):</p>
        ${['nontaxable'].concat(CLASSES).map(name => html`
          <label class="d-ib"><input type="checkbox" .checked=${quick.exempt.includes(name)} @change=${() => this.toggle('exempt', name)} /> ${name}</label>
        `)}

        <label class="field">
          <span class="d-b">Is shipping taxed here?</span>
          <span class="tc-muted d-b">
            <em>In proportion</em> taxes shipping only for the share of the order that is taxable — a $60 order with $50 of
            taxable goods taxes five-sixths of the shipping. Your tax authority's instructions say which applies.
          </span>
          <select .value=${quick.shipping} @change=${event => this.setQuick('shipping', event.target.value)}>
            <option value="none" ?selected=${quick.shipping === 'none'}>No</option>
            <option value="full" ?selected=${quick.shipping === 'full'}>Yes, in full</option>
            <option value="proportional" ?selected=${quick.shipping === 'proportional'}>Yes, in proportion to the taxable goods</option>
          </select>
        </label>

        <label class="field">
          <span class="d-b">Local option taxes (optional), one per line: <span class="ff-mono">Town = rate</span></span>
          <textarea rows="3" placeholder="Burlington = 1" .value=${quick.locals} @input=${event => this.setQuick('locals', event.target.value)}></textarea>
        </label>

        <button class="primary" ?disabled=${this.busy} @click=${this.runQuickStart}>${this.busy ? 'Creating…' : 'Create the rates'}</button>
      </div>
    `;
  }

  render(){
    if(!this.loaded) return html`<k-spinner></k-spinner>`;

    return html`
      ${this.error ? html`<p class="tc-danger mb">${this.error}</p>` : ''}
      ${this.notice ? html`<p class="tc-success mb">${this.notice}</p>` : ''}

      ${this.editing ? this.#renderEditor() : ''}
      ${!this.rates.length && !this.editing ? this.#renderQuickStart() : ''}

      ${this.rates.length ? html`
        <p class="tc-muted mb">
          Rates stack by level: the most specific row at each level applies, and the levels add. To change a rate going
          forward, <strong>end</strong> the old row and add a new one — a sale quoted last month keeps last month's rate.
        </p>
        <table class="mb">
          <thead>
            <tr><th>Place</th><th>Applies to</th><th>Level</th><th>Rate</th><th>Shipping</th><th>Effective</th><th>Name</th><th></th></tr>
          </thead>
          <tbody>
            ${this.rates.map(rate => html`
              <tr class=${rate.enabled ? '' : 'tc-muted'}>
                <td>${[rate.country, rate.state, rate.locality, rate.postalPattern].filter(Boolean).join(' · ')}</td>
                <td>${rate.taxClass}</td>
                <td>${rate.level}</td>
                <td>${rate.kind === 'exempt' ? html`<em>exempt</em>` : `${rate.rate}%`}</td>
                <td>${rate.appliesToShipping ? 'yes' : ''}</td>
                <td >${rate.effectiveFrom || '—'} → ${rate.effectiveTo || 'now'}</td>
                <td>${rate.jurisdiction}</td>
                <td>
                  <button class="link" @click=${() => { this.editing = { ...rate }; }}>Edit</button>
                  ${rate.effectiveTo ? '' : html`<button class="link" @click=${() => this.end(rate)}>End</button>`}
                  <button class="link tc-danger" @click=${() => this.remove(rate)}>Delete</button>
                </td>
              </tr>
            `)}
          </tbody>
        </table>
      ` : ''}

      <p class="mb">
        ${this.editing ? '' : html`<button class="primary" @click=${() => { this.editing = blank(); }}>Add a rate</button>`}
        <button class="secondary" @click=${() => { this.importing = !this.importing; }}>Import CSV</button>
        <a class="button secondary" href=${exportUrls.rates}>Export CSV</a>
      </p>

      ${this.importing ? html`
        <div class="card pb">
          <p class="tc-muted mb">
            Columns: country, state, locality, postalPattern, taxClass, level, kind, rate, appliesToShipping, taxType,
            jurisdiction, label, priority, enabled, effectiveFrom, effectiveTo, note. Only country and rate are required.
            It only adds rows, and if any row is wrong nothing is added.
          </p>
          <textarea rows="8" class="ff-mono" .value=${this.csv} @input=${event => { this.csv = event.target.value; }}></textarea>
          <button class="primary" ?disabled=${this.busy || !this.csv.trim()} @click=${this.runImport}>Import</button>
        </div>
      ` : ''}

      ${this.rates.length && !this.editing ? html`
        <details class="mb">
          <summary class="tc-muted">Run the quick start again</summary>
          ${this.#renderQuickStart()}
        </details>
      ` : ''}
    `;
  }

  static styles = css`
    :host { display: block; }
    .card { margin-bottom: var(--spacer); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr)); gap: var(--spacer_h); margin-bottom: var(--spacer); }
    .field { margin-bottom: 0; }
    textarea { width: 100%; }
  `;
}

customElements.define('k-tax-rates', TaxRates);
