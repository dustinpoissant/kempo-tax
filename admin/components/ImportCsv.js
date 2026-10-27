import ButtonControl from '/kempo-ui/components/controls/ButtonControl.js';
import { html } from '/kempo-ui/lit-all.min.js';
import '/kempo-ui/components/Icon.js';

/*
  A table control that opens the CSV import panel of the rates page. It tells the table, which tells the page: the page
  shows or hides the panel, and the import itself stays on the page.
*/
export default class ImportCsv extends ButtonControl {
  connectedCallback(){
    super.connectedCallback();
    if(!this.hasAttribute('title')) this.title = 'Import CSV';
  }

  handleAction(){
    this.host?.dispatchEvent(new CustomEvent('importCsv', { bubbles: true }));
  }

  render(){
    return html`<slot><k-icon name="download" rotation="180"></k-icon> Import CSV</slot>`;
  }
}

customElements.define('k-tax-import-csv', ImportCsv);
