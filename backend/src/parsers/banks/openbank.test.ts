import { describe, expect, it } from 'vitest';
import { readHtmlToRawTable } from '../htmlTable';
import { parseOpenbankAccount } from './openbank';

describe('parseOpenbankAccount', () => {
  it('extracts movements from the malformed HTML-table export saved as .xls', () => {
    const html = `
      <html><body><table>
        <tr><td id="sep" /><td><b>Cuentas - Movimientos</b></td></tr>
        <tr><td id="sep" /><font id="CabeceraCuerpo"><td>Saldo:</td><td id="sep" /><td><b>1,00 EUR</b></td></font></tr>
        <tr>
          <td id="sep" /><td width="95"><font><b>Fecha Operación</b></font></td>
          <td id="sep" /><td width="95"><font><b>Fecha Valor</b></font></td>
          <td id="sep" /><td width="379"><font><b>Concepto</b></font></td>
          <td id="sep" /><td width="172"><font><b>Importe</b></font></td>
          <td id="sep" /><td width="172"><font><b>Saldo</b></font></td>
        </tr>
        <tr>
          <td id="sep" /><td align="center"><font>06/07/2026</font></td>
          <td id="sep" /><td align="center"><font>06/07/2026</font></td>
          <td id="sep" /><td align="left"><font>TRANSFERENCIA INMEDIATA A FAVOR DE Joana i Joan</font></td>
          <td id="sep" /><td align="right"><font>-763,44</font></td>
          <td id="sep" /><td align="right"><font>1,00</font></td>
        </tr>
      </table></body></html>
    `;

    const table = readHtmlToRawTable(html);
    const result = parseOpenbankAccount(table);

    expect(result.compte).toEqual({ banc: 'openbank', tipus: 'corrent' });
    expect(result.moviments).toHaveLength(1);
    expect(result.moviments[0]).toEqual({
      dataOperacio: '2026-07-06',
      dataValor: '2026-07-06',
      concepteOriginal: 'TRANSFERENCIA INMEDIATA A FAVOR DE Joana i Joan',
      importCents: -76344,
      saldoPosteriorCents: 100,
    });
  });
});
