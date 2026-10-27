import ShadowComponent from '/kempo-ui/components/ShadowComponent.js';
import '/kempo-ui/components/controls/TcSearch.js';
import '/kempo-ui/components/controls/TcFilters.js';
import '/kempo-ui/components/controls/TcFieldSortHide.js';
import '/kempo-ui/components/Table.js';
import '/kempo-ui/components/Spinner.js';
import '/kempo-ui/components/Icon.js';
import '/kempo-ui/components/Accordion.js';
import { html, css, nothing } from '/kempo-ui/lit-all.min.js';
import Dialog from '/kempo-ui/components/Dialog.js';
import Toast from '/kempo-ui/components/Toast.js';
import '/kempo-ui/components/controls/TcDeleteRecord.js';
import '/kempo-ui/components/controls/TcDeleteSelected.js';
import './RateAction.js';
import './ImportCsv.js';
import './ExportCsv.js';
import { listRates, createRate, updateRate, deleteRate, importRates, quickStart } from '/tax/sdk.js';

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
const pane = this.closest('k-tab-content');
    // Loads when its tab is first opened, so a tab nobody opens makes no requests.
    if(!pane || pane.active) this.load();
    else this.closest('k-tabs')?.addEventListener('tabfirstshown', ({ detail }) => {
      if(detail.tab === pane.name) this.load();
    });
  }

  /*
    Data
  */

  load = async () => {
    const [error, data] = await listRates();
    if(error) Toast.error(error.msg);
    else this.rates = data.rates;
    this.loaded = true;
  };

  say = (notice, error = '') => {
    if(notice) Toast.success(notice);
    if(error) Toast.error(error);
  };

  /* The columns the table shows, and the hidden ones that carry the CSV columns. */
  tableFields = [
  { name: 'place', label: 'Place', size: 240, editable: false, calculator: rate => [rate.country, rate.state, rate.locality, rate.postalPattern].filter(Boolean).join(' · ') },
  { name: 'taxClass', label: 'Applies to', size: 170, editable: false },
  { name: 'level', label: 'Level', size: 110, editable: false },
  { name: 'rateDisplay', label: 'Rate', size: 100, editable: false, calculator: rate => rate.kind === 'exempt' ? 'exempt' : `${rate.rate}%` },
  { name: 'shippingDisplay', label: 'Shipping', size: 100, editable: false, calculator: rate => rate.appliesToShipping === 'true' ? 'yes' : '' },
  { name: 'effectiveDisplay', label: 'Effective', size: 200, editable: false, calculator: rate => `${rate.effectiveFrom || '—'} → ${rate.effectiveTo || 'now'}` },
  { name: 'jurisdiction', label: 'Name', editable: false },
  { name: 'country', hidden: true },
  { name: 'state', hidden: true },
  { name: 'locality', hidden: true },
  { name: 'postalPattern', hidden: true },
  { name: 'kind', hidden: true },
  { name: 'rate', hidden: true },
  { name: 'appliesToShipping', hidden: true },
  { name: 'shippingProportional', hidden: true },
  { name: 'taxType', hidden: true },
  { name: 'label', hidden: true },
  { name: 'priority', hidden: true },
  { name: 'enabled', hidden: true },
  { name: 'effectiveFrom', hidden: true },
  { name: 'effectiveTo', hidden: true },
  { name: 'note', hidden: true }
  ];

  /* The table's rows: the rates with the booleans and the rate as text, so an export writes them as they are imported. */
  tableRecords = () => this.rates.map(rate => ({
    ...rate,
    rate: String(rate.rate),
    priority: String(rate.priority ?? 0),
    appliesToShipping: String(rate.appliesToShipping === true),
    shippingProportional: String(rate.shippingProportional === true),
    enabled: String(rate.enabled !== false),
  }));

  /* The editor is a dialog: it opens when a rate is being edited or added, and the page clears the rate when it closes. */
  updated(changed){
    super.updated(changed);
    if(changed.has('rates')) this.renderRoot.querySelector('k-table')?.setData({ records: this.tableRecords(), fields: this.tableFields });
    const dialog = this.renderRoot.querySelector('#rateDialog');
    if(!dialog || !changed.has('editing')) return;
    if(this.editing && !dialog.opened) dialog.open();
    if(!this.editing && dialog.opened) dialog.close();
  }

  closeEditor = () => {
    this.editing = null;
  };

  confirmSave = event => {
    event.keepDialogOpen = true;
    this.save();
  };

  save = async () => {
    this.busy = true;
    const { id, ...body } = this.editing;
    const [error] = id ? await updateRate(id, body) : await createRate(body);
    this.busy = false;

    if(error) return Toast.error(error.msg);
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

  openQuickStart = () => this.renderRoot.querySelector('#quickStartDialog').open();

  confirmQuickStart = event => {
    event.keepDialogOpen = true;
    this.runQuickStart();
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
    this.renderRoot.querySelector('#quickStartDialog')?.close();
    this.say(`Added ${data.added} rates and switched the provider to the rate table. Review them below.`);
    await this.load();
  };

  /* The import control opens the dialog, where a CSV file is chosen. The file's text is what gets imported. */
  openImport = () => this.renderRoot.querySelector('#importDialog').open();

  pickFile = async ({ target }) => {
    const [file] = target.files;
    this.csv = file ? await file.text() : '';
  };

  confirmImport = event => {
    event.keepDialogOpen = true;
    if(!this.csv) return Toast.error('Choose a CSV file to import');
    this.runImport();
  };

  resume = async rate => {
    const [error] = await updateRate(rate.id, { ...rate, effectiveTo: '' });
    if(error) return Toast.error(error.msg);
    this.say('Resumed.');
    await this.load();
  };

  runImport = async () => {
    this.busy = true;
    const [error, data] = await importRates(this.csv);
    this.busy = false;

    if(error) return Toast.error(error.msg);
    this.renderRoot.querySelector('#importDialog').close();
    this.csv = '';
    const added = data.added ? `Added ${data.added} rate${data.added === 1 ? '' : 's'}.` : 'Nothing added.';
    this.say(data.skipped ? `${added} Skipped ${data.skipped} already in the table.` : added);
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
      <div>
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
      </div>
    `;
  }

  #renderQuickStart(inDialog = false){
    const quick = this.quick;

    return html`
      <div class="${inDialog ? '' : 'card pb'}">
        ${inDialog ? nothing : html`<h2>Quick start</h2>`}
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

        ${inDialog ? nothing : html`<button class="primary" ?disabled=${this.busy} @click=${this.runQuickStart}>${this.busy ? 'Creating…' : 'Create the rates'}</button>`}
      </div>
    `;
  }

  /* A row action from the rates table. Editing works on a copy without the row's own action list. */
  rateAction = ({ action, record }) => {
    const rate = this.rates.find(entry => entry.id === record.id);
    if(action === 'edit') this.editing = { ...rate };
    else if(action === 'toggle') rate.effectiveTo ? this.resume(rate) : this.end(rate);
  };

  /* Deleting a row, or the selected rows, after the person confirms. The table removes them once this approves. */
  confirmDelete = ({ detail: { records, approve, reject } }) => {
    const count = records.length;
    Dialog.confirm(`Delete ${count === 1 ? 'this rate' : `${count} rates`}? Ending keeps the history; deleting is for a row entered by mistake. Recorded sales are not affected either way.`, async confirmed => {
      if(!confirmed) return reject();
      for(const rate of records){
        const [error] = await deleteRate(rate.id);
        if(error){
          reject();
          return this.say('', error.msg);
        }
      }
      approve();
      this.say(`Deleted ${count === 1 ? 'the rate' : `${count} rates`}.`);
      await this.load();
    });
  };

  render(){
    if(!this.loaded) return html`<k-spinner></k-spinner>`;

    return html`

      <k-dialog id="rateDialog" style="--width: 52rem;" confirm-text="Save" confirm-classes="primary ml" cancel-text="Cancel" .confirmAction=${this.confirmSave} @close=${this.closeEditor}>
        <h2 slot="title" class="h5 pyh px m0">${this.editing?.id ? 'Edit rate' : 'Add a rate'}</h2>
        <div class="p">
          ${this.editing ? this.#renderEditor() : nothing}
        </div>
      </k-dialog>
      ${!this.rates.length ? this.#renderQuickStart() : ''}

      ${this.rates.length ? html`
        <p class="tc-muted mb">
          Rates stack by level: the most specific row at each level applies, and the levels add. To change a rate going
          forward, <strong>end</strong> the old row and add a new one — a sale quoted last month keeps last month's rate.
        </p>
      ` : ''}

      <k-table enable-selection request-delete placeholder="No rates yet. Answer the quick start questions above, or add a rate."
        @rateAction=${event => this.rateAction(event.detail)}
        @requestDelete=${this.confirmDelete}
        @importCsv=${this.openImport}>
        <k-tax-rate-action slot="before" action="edit" label="Edit"></k-tax-rate-action>
        <k-tax-rate-action slot="after" action="toggle" label="End or resume"></k-tax-rate-action>
        <kc-tc-delete-record slot="after"></kc-tc-delete-record>
        <div slot="top" class="d-f full" style="align-items: center; gap: var(--spacer);">
          <kc-tc-search style="width: 16rem"></kc-tc-search><kc-tc-filters></kc-tc-filters><kc-tc-field-sort-hide></kc-tc-field-sort-hide>
          <kc-tc-delete-selected></kc-tc-delete-selected>
          <div class="flex"></div>
          <k-tax-export-csv></k-tax-export-csv>
          <k-tax-import-csv></k-tax-import-csv>
          <button class="primary" @click=${() => { this.editing = blank(); }}><k-icon name="add"></k-icon> Add a rate</button>
        </div>
      </k-table>

      <k-dialog id="importDialog" style="--width: 40rem;" confirm-text="Import" confirm-classes="primary ml" cancel-text="Cancel" .confirmAction=${this.confirmImport}>
        <h2 slot="title" class="h5 pyh px m0">Import rates from a CSV</h2>
        <div class="p">
          <p class="tc-muted mb">
            Columns: country, state, locality, postalPattern, taxClass, level, kind, rate, appliesToShipping, taxType,
            jurisdiction, label, priority, enabled, effectiveFrom, effectiveTo, note. Only country and rate are required.
            It only adds rows, and if any row is wrong nothing is added.
          </p>
          <input type="file" accept=".csv,text/csv" @change=${this.pickFile}>
        </div>
      </k-dialog>

      ${this.rates.length ? html`
        <p class="mb"><button class="secondary" @click=${this.openQuickStart}>Run the quick start again</button></p>
        <k-dialog id="quickStartDialog" style="--width: 48rem;" confirm-text="Create the rates" confirm-classes="primary ml" cancel-text="Cancel" .confirmAction=${this.confirmQuickStart}>
          <h2 slot="title" class="h5 pyh px m0">Quick start</h2>
          <div class="p">
            ${this.#renderQuickStart(true)}
          </div>
        </k-dialog>
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
