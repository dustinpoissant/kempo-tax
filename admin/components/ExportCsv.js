import TcExportCsv from '/kempo-ui/components/controls/TcExportCsv.js';
import ButtonControl from '/kempo-ui/components/controls/ButtonControl.js';
import { html } from '/kempo-ui/lit-all.min.js';
import '/kempo-ui/components/Icon.js';

/*
  The rates table's CSV export: kempo-ui's export control, drawn with the download icon at the size of the base button.
*/
export default class ExportCsv extends TcExportCsv {
  static styles = ButtonControl.styles;

  render(){
    return html`<slot><k-icon name="download"></k-icon> Export CSV</slot>`;
  }
}

customElements.define('k-tax-export-csv', ExportCsv);
