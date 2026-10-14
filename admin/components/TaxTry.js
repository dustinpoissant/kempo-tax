import ShadowComponent from '/kempo-ui/components/ShadowComponent.js';
import { html, css } from '/kempo-ui/lit-all.min.js';
import { calculateTax, listTaxCodes } from '/tax/sdk.js';

/*
  Ask for a calculation by hand.

  The fastest way to find out whether tax is wired up correctly, and the only way to see what a
  particular address and category actually do before a customer does. It is a quote and nothing
  more: nothing is recorded, nothing is reported to anyone, and it can be run as often as wanted.

  Amounts are typed in the currency's smallest unit (cents) to match what the SDK takes, so that
  what is tried here is exactly what an extension will be sending.
*/
export default class TaxTry extends ShadowComponent {
  static properties = {
    form: { type: Object, state: true },
    classes: { type: Object, state: true },
    result: { type: Object, state: true },
    error: { type: String, state: true },
    busy: { type: Boolean, state: true },
  };

  constructor(){
    super();
    this.form = { country: 'US', state: 'CA', postalCode: '94103', amount: '5000', taxClass: 'physical', shipping: '' };
    this.classes = {};
    this.result = null;
    this.error = '';
    this.busy = false;
  }

  /*
    Lifecycle
  */

  connectedCallback(){
    super.connectedCallback();
    this.loadClasses();
  }

  /*
    Data
  */

  loadClasses = async () => {
    const [, data] = await listTaxCodes();
    if(data) this.classes = data.classes;
  };

  set = (name, value) => {
    this.form = { ...this.form, [name]: value };
  };

  run = async () => {
    this.busy = true;
    this.error = '';
    this.result = null;

    const { country, state, postalCode, amount, taxClass, shipping } = this.form;

    const [error, data] = await calculateTax({
      address: { country, state, postalCode },
      lines: [{ amount: Number(amount), reference: 'try', taxClass }],
      ...(Number(shipping) > 0 ? { shipping: { amount: Number(shipping) } } : {}),
    });

    this.busy = false;
    if(error){
      this.error = error.msg;
      return;
    }
    this.result = data;
  };

  /*
    Rendering
  */

  #money = minor => (Number(minor) / 100).toFixed(2);

  #field = (label, name, extra = {}) => html`
    <label class="field">
      <span class="d-b">${label}</span>
      <input type="text" .value=${this.form[name]} @input=${event => this.set(name, event.target.value)} placeholder=${extra.placeholder || ''} />
    </label>
  `;

  render(){
    return html`
      <p class="tc-muted">A quote only — nothing is recorded or reported.</p>

      <div class="grid">
        ${this.#field('Country', 'country', { placeholder: 'US' })}
        ${this.#field('State / region', 'state', { placeholder: 'CA' })}
        ${this.#field('Postal code', 'postalCode', { placeholder: '94103' })}
        ${this.#field('Amount (smallest unit — cents)', 'amount')}
        ${this.#field('Shipping (smallest unit, optional)', 'shipping')}
        <label class="field">
          <span class="d-b">Tax class</span>
          <select .value=${this.form.taxClass} @change=${event => this.set('taxClass', event.target.value)}>
            ${Object.keys(this.classes).map(name => html`<option value=${name} ?selected=${name === this.form.taxClass}>${name}</option>`)}
          </select>
        </label>
      </div>

      <button class="primary" ?disabled=${this.busy} @click=${this.run}>${this.busy ? 'Calculating…' : 'Calculate'}</button>

      ${this.error ? html`<p class="tc-danger">${this.error}</p>` : ''}

      ${this.result ? html`
        <h2>Result</h2>
        <p>
          <strong>Tax ${this.#money(this.result.tax)} ${this.result.currency.toUpperCase()}</strong>
          · total ${this.#money(this.result.total)}
          · ${this.result.collecting
            ? html`<span class="tc-success">collecting</span>`
            : html`<span class="tc-warning">not collecting here — this is a quote of the rate only</span>`}
        </p>
        ${this.result.breakdown.length ? html`
          <table>
            <thead><tr><th>Jurisdiction</th><th>Type</th><th>Rate</th><th>Taxable</th><th>Tax</th><th>Reason</th></tr></thead>
            <tbody>
              ${this.result.breakdown.map(entry => html`
                <tr>
                  <td>${entry.jurisdiction || '—'}</td>
                  <td>${entry.taxType || '—'}</td>
                  <td>${entry.rate === null ? '—' : `${entry.rate}%`}</td>
                  <td>${this.#money(entry.taxableAmount)}</td>
                  <td>${this.#money(entry.amount)}</td>
                  <td >${entry.reason}</td>
                </tr>
              `)}
            </tbody>
          </table>
        ` : ''}
      ` : ''}
    `;
  }

  static styles = css`
    :host { display: block; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr)); gap: var(--spacer_h); margin-bottom: var(--spacer); }
    .field { margin-bottom: 0; }
  `;
}

customElements.define('k-tax-try', TaxTry);
