import ButtonControl from '/kempo-ui/components/controls/ButtonControl.js';
import { html } from '/kempo-ui/lit-all.min.js';
import '/kempo-ui/components/Icon.js';

/*
  A row control on a tax table, drawn as an icon. It reports its action as a `rateAction` event on the table:
  { action, record }. The page does the work. A "toggle" control ends an active rate and resumes an ended one.

    <k-tax-rate-action slot="after" action="toggle" label="End or resume"></k-tax-rate-action>
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

  connectedCallback(){
    super.connectedCallback();
    if(!this.hasAttribute('title')) this.title = this.label;
  }

  get record(){
    const index = this.closest('.record')?.dataset?.index;
    return index === undefined ? null : this.host?.records?.[index] ?? null;
  }

  handleAction(){
    this.host.dispatchEvent(new CustomEvent('rateAction', { detail: { action: this.action, record: this.record } }));
  }

  render(){
    if(this.action === 'edit' || this.action === 'change') return html`<slot><k-icon name="edit"></k-icon></slot>`;
    if(this.action === 'toggle' && this.record?.effectiveTo) return html`<slot><k-icon name="play"></k-icon></slot>`;
    if(this.action === 'toggle') return html`<slot><k-icon src="/admin/extension/kempo-tax/icons/stop_circle.svg"></k-icon></slot>`;
    return html`<slot>${this.label}</slot>`;
  }
}

customElements.define('k-tax-rate-action', RateAction);
