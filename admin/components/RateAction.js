import ButtonControl from '/kempo-ui/components/controls/ButtonControl.js';
import { html } from '/kempo-ui/lit-all.min.js';

/*
  One action on a row of this order's labels or rates (track, ask for a refund, buy). It shows only when its
  row's `actions` list names it, and reports the choice as an `rateAction` event on the table: { action, record }.
  The page does the work. A row's own button text can come from the record (`buyLabel`), else from `label`.

    <k-tax-rate-action slot="after" action="edit" label="Edit"></k-tax-rate-action>
*/
export default class RateAction extends ButtonControl {
  static properties = {
    ...ButtonControl.properties,
    action: { type: String },
    label: { type: String },
  };

  constructor(){
    super();
    this.action = '';
    this.label = '';
  }

  get record(){
    const index = this.closest('.record')?.dataset?.index;
    return index === undefined ? null : this.host?.records?.[index] ?? null;
  }

  get shown(){
    return Boolean(this.record?.actions?.includes(this.action));
  }

  handleAction(){
    if(!this.shown) return;
    this.host.dispatchEvent(new CustomEvent('rateAction', { detail: { action: this.action, record: this.record } }));
  }

  render(){
    return this.shown ? html`<slot>${this.record?.[`${this.action}Label`] ?? this.label}</slot>` : html``;
  }
}

customElements.define('k-tax-rate-action', RateAction);
