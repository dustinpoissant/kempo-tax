import ShadowComponent from '/kempo-ui/components/ShadowComponent.js';
import '/kempo-ui/components/Spinner.js';
import { html, css } from '/kempo-ui/lit-all.min.js';
import { getReport, listLedger, exportUrls } from '/tax/sdk.js';

/*
  What was collected, in the shape a return asks for.

  Three things about it are said on the screen rather than left to be assumed:

  - **It is a record, not a filing.** The numbers come from what this site recorded. Filing and
    paying are still done on the tax authority's own portal.
  - **A refund counts in the period it happened.** A refund in April of a March sale reduces April.
  - **"Not collected" is a different column from "exempt".** Sales made where the site is not
    registered appear on no return; exempt sales do, as exempt. Mixing them up is the error that
    makes a return wrong.
*/

const quarters = () => {
  const now = new Date();
  const list = [];
  for(let offset = 0; offset < 8; offset++){
    const index = now.getUTCFullYear() * 4 + Math.floor(now.getUTCMonth() / 3) - offset;
    list.push(`${Math.floor(index / 4)}-Q${(index % 4) + 1}`);
  }
  return list;
};

export default class TaxReports extends ShadowComponent {
  static properties = {
    quarter: { type: String, state: true },
    from: { type: String, state: true },
    to: { type: String, state: true },
    mode: { type: String, state: true },
    report: { type: Object, state: true },
    entries: { type: Array, state: true },
    total: { type: Number, state: true },
    loading: { type: Boolean, state: true },
    error: { type: String, state: true },
  };

  constructor(){
    super();
    this.quarter = quarters()[0];
    this.from = '';
    this.to = '';
    this.mode = 'quarter';
    this.report = null;
    this.entries = [];
    this.total = 0;
    this.loading = false;
    this.error = '';
  }

  /*
    Lifecycle
  */

  connectedCallback(){
    super.connectedCallback();
    this.run();
  }

  /*
    Data
  */

  get params(){
    return this.mode === 'quarter' ? { quarter: this.quarter } : { from: this.from, to: this.to };
  }

  run = async () => {
    this.loading = true;
    this.error = '';

    const [error, report] = await getReport(this.params);
    if(error){
      this.error = error.msg;
      this.loading = false;
      return;
    }
    this.report = report;

    const [, ledger] = await listLedger({ ...this.params, from: report.from || this.from, to: report.to || this.to, limit: 50 });
    if(ledger){
      this.entries = ledger.entries;
      this.total = ledger.total;
    }

    this.loading = false;
  };

  /*
    Rendering
  */

  #money = (minor, currency) => {
    const format = new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() });
    return format.format(minor / 10 ** format.resolvedOptions().maximumFractionDigits);
  };

  #renderCurrency(currency, data){
    const money = value => this.#money(value, currency);
    const t = data.totals;

    return html`
      <h2>${currency.toUpperCase()}</h2>
      <div class="cards">
        <div class="card pb"><span class="tc-muted d-b">Tax collected</span><strong>${money(t.taxCollected)}</strong></div>
        <div class="card pb"><span class="tc-muted d-b">Tax reversed (refunds)</span><strong>${money(t.taxReversed)}</strong></div>
        <div class="card pb"><span class="tc-muted d-b">Net tax owed</span><strong>${money(t.taxNet)}</strong></div>
        <div class="card pb"><span class="tc-muted d-b">Sales</span><strong>${money(t.sales)}</strong></div>
        <div class="card pb"><span class="tc-muted d-b">Taxable sales</span><strong>${money(t.taxable)}</strong></div>
        <div class="card pb"><span class="tc-muted d-b">Exempt sales</span><strong>${money(t.exempt)}</strong></div>
        <div class="card pb"><span class="tc-muted d-b">Not collected</span><strong>${money(t.uncollected)}</strong></div>
      </div>
      <p class="tc-muted mb">${t.salesCount} sale${t.salesCount === 1 ? '' : 's'}, ${t.reversalsCount} refund${t.reversalsCount === 1 ? '' : 's'}.
        <em>Not collected</em> is sold where this site has no rate — it appears on no return.</p>

      ${data.jurisdictions.length ? html`
        <table class="mb">
          <thead><tr><th>Jurisdiction</th><th>Level</th><th>Rate</th><th>Taxable sales</th><th>Tax (net)</th></tr></thead>
          <tbody>
            ${data.jurisdictions.map(row => html`
              <tr>
                <td>${row.jurisdiction}${row.state && row.state !== row.jurisdiction ? ` (${row.state})` : ''}</td>
                <td>${row.level}</td>
                <td>${row.rate ?? ''}%</td>
                <td>${money(row.taxableAmount)}</td>
                <td>${money(row.taxAmount)}</td>
              </tr>
            `)}
          </tbody>
        </table>
      ` : ''}

      ${data.months.length > 1 ? html`
        <table class="mb">
          <thead><tr><th>Month</th><th>Collected</th><th>Reversed</th><th>Net</th></tr></thead>
          <tbody>
            ${data.months.map(row => html`
              <tr><td>${row.month}</td><td>${money(row.taxCollected)}</td><td>${money(row.taxReversed)}</td><td>${money(row.taxNet)}</td></tr>
            `)}
          </tbody>
        </table>
      ` : ''}
      <p class="mb"><a class="button secondary" href=${exportUrls.report({ ...this.params, currency })}>Export ${currency.toUpperCase()} report (CSV)</a></p>
    `;
  }

  render(){
    const currencies = this.report ? Object.entries(this.report.currencies) : [];

    return html`
      <div class="row mb">
        <label class="col mrh">
          Report on
          <select .value=${this.mode} @change=${event => { this.mode = event.target.value; }}>
            <option value="quarter" ?selected=${this.mode === 'quarter'}>A quarter</option>
            <option value="custom" ?selected=${this.mode === 'custom'}>A date range</option>
          </select>
        </label>
        ${this.mode === 'quarter' ? html`
          <label class="col mrh">
            Quarter
            <select .value=${this.quarter} @change=${event => { this.quarter = event.target.value; }}>
              ${quarters().map(name => html`<option value=${name} ?selected=${name === this.quarter}>${name}</option>`)}
            </select>
          </label>
        ` : html`
          <label class="col mrh">
            From
            <input type="date" .value=${this.from} @input=${event => { this.from = event.target.value; }} />
          </label>
          <label class="col mrh">
            To
            <small class="tc-muted d-b">This day is not included</small>
            <input type="date" .value=${this.to} @input=${event => { this.to = event.target.value; }} />
          </label>
        `}
      </div>
      <button class="primary mb" ?disabled=${this.loading} @click=${this.run}>${this.loading ? 'Loading…' : 'Run report'}</button>

      <p class="tc-muted mb">
        A record of what this site collected — <strong>not a tax return</strong>. File and pay on your tax authority's own
        portal. A refund counts in the period it happened in.
      </p>

      ${this.error ? html`<p class="tc-danger mb">${this.error}</p>` : ''}
      ${this.loading && !this.report ? html`<k-spinner></k-spinner>` : ''}

      ${this.report && !currencies.length ? html`<p class="mb">No sales were recorded in this period.</p>` : ''}
      ${currencies.map(([currency, data]) => this.#renderCurrency(currency, data))}

      ${this.entries.length ? html`
        <h2>Ledger <span class="tc-muted">(${this.entries.length} of ${this.total})</span></h2>
        <table class="mb">
          <thead><tr><th>When</th><th>Kind</th><th>Reference</th><th>Provider</th><th>Place</th><th>Sales</th><th>Tax</th></tr></thead>
          <tbody>
            ${this.entries.map(entry => html`
              <tr>
                <td >${new Date(entry.occurredAt).toLocaleString()}</td>
                <td>${entry.kind}</td>
                <td class="ff-mono">${entry.reference}</td>
                <td>${entry.provider}</td>
                <td>${[entry.country, entry.state].filter(Boolean).join(' ')}</td>
                <td>${this.#money(entry.salesAmount, entry.currency)}</td>
                <td>${this.#money(entry.taxAmount, entry.currency)}</td>
              </tr>
            `)}
          </tbody>
        </table>
      ` : ''}
      <p class="mb">
        <a class="button secondary" href=${exportUrls.ledger(this.report ? { from: this.report.from || '', to: this.report.to || '' } : {})}>Export this period's ledger (CSV)</a>
        <a class="button secondary" href=${exportUrls.ledger({})}>Export the whole ledger</a>
      </p>
      <p class="tc-muted mb">
        The ledger is your legal record of tax collected. It is deleted if this extension is uninstalled —
        export it first.
      </p>
    `;
  }

  static styles = css`
    :host { display: block; }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr)); gap: var(--spacer_h); margin-bottom: var(--spacer); }
    .card { margin: 0; }
  `;
}

customElements.define('k-tax-reports', TaxReports);
