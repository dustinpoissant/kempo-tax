import ShadowComponent from '/kempo-ui/components/ShadowComponent.js';
import '/kempo-ui/components/Spinner.js';
import { html, css } from '/kempo-ui/lit-all.min.js';
import { getStatus, listRegistrations } from '/tax/sdk.js';

/*
  Where tax is actually being collected, and whether it can be at all.

  The thing this screen has to make obvious is the difference between "connected" and "collecting".
  A site can have a perfectly valid key and still charge no tax anywhere, because Stripe only
  collects where the account is registered — and that is not a fault, it is the correct answer for
  somebody under every threshold. So the banner says which of the three situations this is, in
  words, instead of leaving an empty table to be misread as a problem.

  Read-only. Registering is a legal act with filing obligations attached; Stripe's dashboard is
  where that is explained, so this links there rather than imitating it.
*/
export default class TaxRegistrations extends ShadowComponent {
  static properties = {
    status: { type: Object, state: true },
    account: { type: Object, state: true },
    accountError: { type: String, state: true },
    registrations: { type: Array, state: true },
    error: { type: String, state: true },
    loaded: { type: Boolean, state: true },
  };

  constructor(){
    super();
    this.status = null;
    this.account = null;
    this.accountError = '';
    this.registrations = [];
    this.error = '';
    this.loaded = false;
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
    const [statusError, data] = await getStatus();
    if(statusError){
      this.error = statusError.msg;
      this.loaded = true;
      return;
    }

    this.status = data.status;
    this.account = data.account;
    this.accountError = data.accountError || '';

    if(data.account?.active){
      const [error, list] = await listRegistrations();
      if(error) this.error = error.msg;
      else this.registrations = list.registrations;
    }

    this.loaded = true;
  };

  /*
    Rendering
  */

  #renderBanner(){
    if(!this.status?.configured){
      return html`
        <div class="card banner tc-warning">
          <strong>Not connected.</strong>
          <p class="small">No tax can be looked up until a Stripe secret key is saved under Settings.</p>
        </div>
      `;
    }

    if(this.accountError){
      return html`
        <div class="card banner tc-danger">
          <strong>Stripe would not talk to this key.</strong>
          <p class="small">${this.accountError}</p>
        </div>
      `;
    }

    if(!this.account?.active){
      return html`
        <div class="card banner tc-warning">
          <strong>Stripe Tax is not switched on for this account yet.</strong>
          <p class="small">
            Open Tax in the Stripe dashboard and finish the setup${this.account?.missingFields?.length
              ? html` — it still needs: <span class="ff-mono">${this.account.missingFields.join(', ')}</span>`
              : ''}.
          </p>
        </div>
      `;
    }

    if(!this.registrations.length){
      return html`
        <div class="card banner tc-warning">
          <strong>Connected, but registered nowhere — so no tax is being collected.</strong>
          <p class="small">
            That is correct until a sales threshold is crossed or an obligation begins. Calculations
            still return the rate that <em>would</em> apply, marked as not collecting. Add a
            registration in the Stripe dashboard when you need to charge tax somewhere.
          </p>
        </div>
      `;
    }

    return html`
      <div class="card banner ${this.status.livemode ? 'tc-danger' : 'tc-success'}">
        <strong>
          ${this.status.livemode
            ? 'Connected in live mode — tax is collected for real.'
            : 'Connected in test mode. Nothing here is reported to anyone.'}
        </strong>
      </div>
    `;
  }

  render(){
    if(!this.loaded) return html`<k-spinner></k-spinner>`;

    return html`
      ${this.#renderBanner()}
      ${this.error ? html`<p class="tc-danger">${this.error}</p>` : ''}

      ${this.registrations.length ? html`
        <table>
          <thead>
            <tr><th>Country</th><th>Region</th><th>Type</th><th>Status</th><th>Active from</th></tr>
          </thead>
          <tbody>
            ${this.registrations.map(entry => html`
              <tr>
                <td>${entry.country}</td>
                <td>${entry.state || '—'}</td>
                <td>${entry.type || '—'}</td>
                <td>${entry.status}</td>
                <td>${entry.activeFrom ? new Date(entry.activeFrom).toLocaleDateString() : '—'}</td>
              </tr>
            `)}
          </tbody>
        </table>
      ` : ''}

      <p class="small tc-muted">
        Registrations are managed in the
        <a href="https://dashboard.stripe.com/tax/registrations" target="_blank" rel="noopener">Stripe dashboard</a>.
        This extension only looks things up and reports; it does not register you with, or file
        returns to, any tax authority.
      </p>
    `;
  }

  static styles = css`
    :host { display: block; }
    .banner { margin-bottom: var(--spacer); }
    .banner p { margin-bottom: 0; }
  `;
}

customElements.define('k-tax-registrations', TaxRegistrations);
