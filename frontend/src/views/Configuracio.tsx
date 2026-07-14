import { useEffect, useState } from 'react';
import { actualitzaConfiguracio, getConfiguracio } from '../api/client';
import type { Configuracio as ConfiguracioData } from '../api/types';

interface CampConfig {
  camp: keyof ConfiguracioData;
  etiqueta: string;
  descripcio: string;
  unitat: string;
  min: number;
  max: number;
  step: number;
  /** Els valors mostrats/editats a la UI com a percentatge (0-100) es converteixen des de/cap a la fracció (0-1) que espera l'API. */
  esPercentatge?: boolean;
}

const CAMPS: CampConfig[] = [
  {
    camp: 'toleranciaImportConciliacio',
    etiqueta: 'Marge d\'import per a un recurrent aproximat',
    descripcio:
      'Un recurrent amb import aproximat es concilia amb un moviment real dins d\'aquest marge (percentatge de l\'import previst). Un recurrent amb import real sempre exigeix coincidència exacta, independentment d\'aquest valor.',
    unitat: '%',
    min: 0,
    max: 100,
    step: 1,
    esPercentatge: true,
  },
  {
    camp: 'finestraConciliacioDies',
    etiqueta: 'Finestra de conciliació',
    descripcio: 'Dies al voltant de la data prevista dins els quals un moviment real es considera la liquidació d\'un recurrent encara no vençut.',
    unitat: 'dies',
    min: 0,
    max: 365,
    step: 1,
  },
  {
    camp: 'diesDesplacamentVencut',
    etiqueta: 'Desplaçament d\'un vençut',
    descripcio: 'Dies després d\'avui on es mostra desplaçada una ocurrència vençuda encara no conciliada (amb el venciment original visible).',
    unitat: 'dies',
    min: 0,
    max: 365,
    step: 1,
  },
  {
    camp: 'finestraResolucioVencutDies',
    etiqueta: 'Finestra de resolució d\'un vençut',
    descripcio: 'Dies des del venciment original dins els quals un moviment real encara es reconeix com la liquidació d\'una ocurrència ja vençuda.',
    unitat: 'dies',
    min: 0,
    max: 365,
    step: 1,
  },
  {
    camp: 'diesDiferenciaTransferencies',
    etiqueta: 'Finestra de transferències internes',
    descripcio: 'Dies de diferència màxima entre dos moviments de signe oposat i mateix import perquè se suggereixin com a transferència interna.',
    unitat: 'dies',
    min: 0,
    max: 365,
    step: 1,
  },
  {
    camp: 'maxCopiesSeguretat',
    etiqueta: 'Còpies de seguretat automàtiques a conservar',
    descripcio: 'Nombre de còpies automàtiques del fitxer de dades que es conserven; les més antigues s\'esborren en superar-lo.',
    unitat: 'còpies',
    min: 1,
    max: 1000,
    step: 1,
  },
];

function aValorUI(config: ConfiguracioData, camp: CampConfig): number {
  const valor = config[camp.camp];
  return camp.esPercentatge ? Math.round(valor * 100) : valor;
}

function aValorApi(valorUI: number, camp: CampConfig): number {
  return camp.esPercentatge ? valorUI / 100 : valorUI;
}

/** Pestanya "Configuració" (especificacio.md 4.4): agrupa els marges i finestres de dies que fa servir el motor de conciliació de la previsió, més la finestra de transferències internes i el nombre de còpies de seguretat — tot editable sense tocar codi. */
export function Configuracio() {
  const [config, setConfig] = useState<ConfiguracioData | null>(null);
  const [esborrany, setEsborrany] = useState<Record<string, string>>({});
  const [desant, setDesant] = useState<keyof ConfiguracioData | null>(null);
  const [missatge, setMissatge] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getConfiguracio().then((c) => {
      setConfig(c);
      setEsborrany(Object.fromEntries(CAMPS.map((camp) => [camp.camp, String(aValorUI(c, camp))])));
    });
  }, []);

  async function handleDesa(camp: CampConfig) {
    if (!config) return;
    const valorUI = Number(esborrany[camp.camp]);
    if (!Number.isFinite(valorUI) || valorUI < camp.min || valorUI > camp.max) {
      setError(`${camp.etiqueta}: valor fora de rang (${camp.min}–${camp.max}).`);
      return;
    }
    setDesant(camp.camp);
    setError(null);
    setMissatge(null);
    try {
      const nou = await actualitzaConfiguracio({ [camp.camp]: aValorApi(valorUI, camp) });
      setConfig(nou);
      setEsborrany((prev) => ({ ...prev, [camp.camp]: String(aValorUI(nou, camp)) }));
      setMissatge(`${camp.etiqueta} actualitzat.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDesant(null);
    }
  }

  if (!config) return <p>Carregant…</p>;

  return (
    <section>
      <h2>Configuració</h2>
      <p style={{ fontSize: 12, color: '#555' }}>
        Marges i finestres de dies que fa servir el motor de previsió i conciliació (especificacio.md 4.4). Els canvis
        s'apliquen immediatament a properes consultes.
      </p>

      {error && <p style={{ color: '#c00' }}>{error}</p>}
      {missatge && <p style={{ color: '#2a6' }}>{missatge}</p>}

      <table style={{ borderCollapse: 'collapse', maxWidth: 700 }}>
        <tbody>
          {CAMPS.map((camp) => (
            <tr key={camp.camp}>
              <td style={{ padding: '8px 12px 8px 0', verticalAlign: 'top' }}>
                <strong>{camp.etiqueta}</strong>
                <div style={{ fontSize: 12, color: '#555', maxWidth: 420 }}>{camp.descripcio}</div>
              </td>
              <td style={{ padding: '8px 0', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                <input
                  type="number"
                  min={camp.min}
                  max={camp.max}
                  step={camp.step}
                  value={esborrany[camp.camp] ?? ''}
                  onChange={(e) => setEsborrany((prev) => ({ ...prev, [camp.camp]: e.target.value }))}
                  style={{ width: 80 }}
                />{' '}
                {camp.unitat}{' '}
                <button onClick={() => handleDesa(camp)} disabled={desant === camp.camp}>
                  {desant === camp.camp ? 'Desant…' : 'Desa'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
