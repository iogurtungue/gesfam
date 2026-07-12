# Especificació de projecte: Centralitzador d'extractes bancaris amb previsió de tresoreria

> Document destinat a Claude Code. Conté els requisits funcionals, l'arquitectura proposada, el model de dades i el pla de fases. Les decisions ja preses estan marcades com a **[DECIDIT]**; els punts que requereixen confirmació de l'usuari, com a **[OBERT]**.

## 1. Context i objectiu

L'usuari treballa amb quatre bancs espanyols: **Banc Sabadell**, **BBVA**, **ING (España)** i **OpenBank**. Vol una aplicació d'ús estrictament personal que:

1. **Centralitzi els moviments bancaris** dels quatre bancs, importats manualment mitjançant els fitxers d'extracte (CSV/Excel) que cada banc permet descarregar.
2. **Generi una previsió de tresoreria** a 30, 60 i 90 dies (o horitzó configurable) a partir de la detecció de càrrecs i ingressos recurrents en l'històric.

**[DECIDIT]** Entrada de dades: importació manual de fitxers. No hi ha integració amb API bancàries ni agregadors PSD2. No descartar-ho en el futur: l'arquitectura ha de deixar la porta oberta (capa d'ingesta desacoblada).

**[DECIDIT]** Format: aplicació web local amb dues peces que corren juntes a la màquina de l'usuari: un **backend lleuger Node** (Express o Fastify) amb base de dades **SQLite** en fitxer, i un **frontend React** servit pel mateix servidor i consultat des del navegador. Ús mono-usuari, sense autenticació, sense cap servei remot.

**[DECIDIT]** Privacitat: cap dada bancària surt de la màquina de l'usuari. Tot el processament i emmagatzematge és local.

## 2. Requisits no funcionals

- **Persistència local en SQLite**: totes les dades viuen en un únic fitxer SQLite (p. ex. `dades/finances.db`) al directori del projecte, fora del navegador. El navegador és només interfície: no s'hi guarda cap dada (ni IndexedDB ni localStorage), de manera que netejar el navegador o canviar-ne no comporta cap pèrdua.
- **Còpies de seguretat**: còpia automàtica del fitxer `.db` (amb marca de temps, retenint les N últimes) abans de cada importació i de qualsevol operació destructiva; a més, funció manual d'exportar/importar tota la base en JSON per a migracions. Documentar al README que el directori `dades/` es pot situar dins d'una carpeta sincronitzada (Drive, Dropbox…) per tenir còpia externa.
- **Idioma de la interfície**: català. Formats numèrics i de data en convenció espanyola (1.234,56 € / dd/mm/aaaa).
- **Simplicitat operativa**: l'usuari arrenca tot el sistema amb una sola ordre (`npm start`), que aixeca el servidor local (p. ex. `http://localhost:3000`) i serveix el frontend ja compilat; el navegador s'obre automàticament si és possible. El servidor escolta només a `localhost`. Cap dependència de serveis externs en temps d'execució.
- **Stack proposat**: backend Node + TypeScript amb Express o Fastify i **better-sqlite3** (o Drizzle ORM sobre SQLite); frontend Vite + React + TypeScript; PapaParse (CSV) i SheetJS/xlsx (Excel) al backend, on es fa tot el parseig i la deduplicació; Recharts (gràfics). API REST interna senzilla entre frontend i backend. Claude Code pot proposar alternatives equivalents si ho justifica, però mantenint el principi 100% local i la base de dades en un fitxer SQLite.
- **Migració futura**: aquesta arquitectura ha de permetre empaquetar més endavant l'app com a aplicació d'escriptori (Tauri/Electron) reaprofitant frontend i base de dades; no implementar-ho ara, però no prendre decisions que ho impedeixin.

## 3. Funcionalitat 1 — Importació i centralització d'extractes

### 3.1 Flux d'importació

1. L'usuari selecciona (o arrossega) un o més fitxers d'extracte.
2. L'app intenta **detectar automàticament el banc** pel patró de capçaleres del fitxer.
3. Es mostra una **previsualització** dels moviments interpretats (data, concepte, import, saldo) abans de confirmar.
4. Si la detecció automàtica falla, s'ofereix un **assistent de mapatge manual de columnes** (l'usuari indica quina columna és la data, quina l'import, etc.). El mapatge es desa com a plantilla reutilitzable per banc.
5. En confirmar, els moviments s'insereixen a la base de dades **descartant duplicats** (vegeu 3.3).
6. Es mostra un resum de la importació: X moviments nous, Y duplicats ignorats, Z files no interpretables (amb detall per revisar-les).

### 3.2 Formats d'origen per banc

**Important per a Claude Code**: els formats d'exportació dels bancs canvien amb el temps i poden variar segons el tipus de compte. Les descripcions següents són orientatives; el parser ha de ser **tolerant** (detecció per capçaleres, no per posició fixa) i el mapatge manual és la xarxa de seguretat. L'usuari aportarà fitxers d'exemple reals (anonimitzats si cal) durant el desenvolupament — **demanar-los abans d'implementar cada parser**.

- **Banc Sabadell**: exporta a Excel/CSV amb columnes de l'estil «F. Operativa, Concepto, F. Valor, Importe, Saldo, Referencia 1, Referencia 2». També ofereix el format **Norma 43 (Q43/AEB43)**, estàndard bancari espanyol. Implementar un parser Norma 43 és desitjable (fase 2) perquè és el format més estable i ric.
- **ING España**: exporta a Excel amb columnes de l'estil «Fecha, Categoría, Subcategoría, Descripción, Comentario, Imagen, Importe, Saldo». Aprofitar la categoria que ja ve del banc si hi és.
- **OpenBank**: exporta a Excel/CSV amb columnes de l'estil «Fecha Operación, Fecha Valor, Concepto, Importe, Saldo».

Particularitats a gestionar: decimals amb coma, separador de milers amb punt, dates dd/mm/aaaa, files de capçalera/resum prèvies a la taula real (freqüent en exports d'Excel bancaris), imports negatius per a càrrecs, codificacions (UTF-8 vs Windows-1252).

#### 3.2.1 Moviments de targetes de crèdit

A més dels comptes corrents, l'app ha d'incloure els **moviments de les targetes de crèdit** associades, importats des dels extractes de targeta que cada banc permet descarregar (format habitualment similar: data, comerç/concepte, import; sovint sense columna de saldo).

Consideracions específiques que Claude Code ha d'implementar:

- Cada targeta es modela com un **compte de tipus «targeta de crèdit»**, vinculat opcionalment al compte corrent on es liquida (`compteLiquidacioId`) i amb un dia de càrrec configurable (`diaLiquidacio`).
- El «saldo» d'una targeta de crèdit és el **deute pendent acumulat** del període (suma dels imports dels moviments importats), no un saldo disponible; les vistes ho han d'etiquetar clarament per no confondre'l amb els saldos de compte.
- **El buit real**: l'extracte de la targeta mai inclou la seva pròpia liquidació — només els càrrecs individuals —, mentre que la liquidació apareix com un càrrec únic al compte corrent («liquidación tarjeta…»). Marcar aquest càrrec com a simple «transferència interna» evita el doble còmput als *agregats d'ingressos/despeses*, però per si sol **no atura el creixement indefinit del deute de la targeta**, ja que aquest es calcula com la suma dels seus propis moviments importats i la liquidació mai hi apareix.
- **Mecanisme de contrapartida automàtica**, per tancar aquest buit:
  1. El càrrec de liquidació es pot marcar com a «liquidació de la targeta X» — automàticament per regla configurable sobre el concepte (p. ex. patró «LIQUIDACION TARJETA», un per targeta) amb confirmació explícita de l'usuari, o manualment des del llistat de moviments.
  2. En marcar-lo, es crea un **moviment virtual a la targeta**: import positiu d'igual magnitud que el càrrec, mateixa data, concepte «Liquidació rebuda (contrapartida automàtica)», marcat també com a transferència interna. Ni el càrrec ni la seva contrapartida compten als agregats d'ingressos/despeses (3.4) ni han d'entrar a la detecció de recurrents (secció 4) com a despesa — són moviment i contrapartida d'una mateixa transferència, no consum.
  3. El moviment virtual té un **id determinista** derivat del moviment real que el va originar (idempotent: reimportar el mateix càrrec i tornar a marcar-lo reprodueix exactament la mateixa contrapartida) i s'elimina automàticament si es desfà el lot del moviment original o si es desfà el marcatge.
  4. El deute de la targeta (suma dels imports dels seus moviments, incloent-hi la contrapartida) torna a ~0 després de cada liquidació correctament marcada.
  5. **Comprovació de quadratura**: si l'import liquidat no coincideix amb la suma dels moviments reals de la targeta des de l'anterior liquidació, es mostra un avís no bloquejant amb la diferència — la liquidació es marca igualment (l'usuari pot decidir-ho conscientment), l'avís és només informatiu.
- La deduplicació (3.3) s'aplica igualment als moviments de targeta; com que sovint no hi ha columna de saldo, el hash es calcula sense aquest camp i cal documentar la limitació amb compres idèntiques el mateix dia.
- A la previsió (secció 4), els recurrents detectats en targeta es projecten segons la data de **liquidació al compte corrent** (configurable per targeta: dia del mes de càrrec), que és quan afecten realment la tresoreria.

### 3.3 Deduplicació

Cada moviment rep un identificador determinista: hash de `(banc, compte, data operació, import, concepte normalitzat, saldo posterior)`. En reimportar un extracte que se solapa amb un d'anterior (cas habitual: l'usuari descarrega sempre «últims 90 dies»), els moviments ja existents (segons aquest hash) s'ignoren silenciosament. La deduplicació **només s'aplica contra moviments d'una importació anterior**, mai entre moviments del mateix fitxer que s'està important en aquell moment: dos (o més) moviments legítimament idèntics el mateix dia (mateix import i concepte, típic a extractes de targeta sense columna de saldo) són transaccions reals i separades, no un duplicat. Com que el hash per si sol no els distingeix i l'id és clau primària, el 2n, 3r... moviment amb un hash repetit dins del mateix lot rep un sufix determinista (`-2`, `-3`...) segons l'ordre d'aparició al fitxer, de manera que una reimportació íntegra del mateix fitxer els torna a reconèixer tots com a ja existents, no només el primer.

### 3.4 Model de dades

- **Compte**: id, banc (sabadell | ing | openbank | altre), **tipus (compte corrent | targeta de crèdit)**, àlies definit per l'usuari, IBAN o últims 4 dígits opcionals, saldo actual conegut i data d'aquest saldo; per a targetes: compte corrent de liquidació vinculat i dia del mes de liquidació.
- **Moviment**: id (hash), compteId, dataOperació, dataValor, concepte original, concepte normalitzat, import (positiu = ingrés, negatiu = càrrec), saldo posterior si es coneix, categoria, lotImportació, marca de recurrència (vegeu funcionalitat 2).
- **LotImportació**: id, data, fitxer d'origen, banc, nombre de moviments, per poder desfer una importació sencera.
- **Categoria**: llista editable amb categories predefinides raonables (habitatge, subministraments, alimentació, transport, nòmina, impostos, oci, transferències internes…). Categorització per **regles** definibles per l'usuari («si el concepte conté ENDESA → subministraments») que s'apliquen automàticament en importar.
- **Transferències internes**: detectar (o permetre marcar) moviments entre els comptes propis perquè no comptin com a ingrés/despesa real en agregats ni en la previsió. Cada suggeriment es pot confirmar (marca els dos moviments) o descartar (falsa alarma: no torna a suggerir-se aquesta parella, sense marcar-los).

### 3.5 Vistes de consulta

- **Selector de comptes global**: totes les vistes de consulta han de disposar d'un selector multi-compte persistent que permeti visualitzar **un compte, una combinació lliure de comptes o tots alhora** (comptes corrents i targetes). La selecció s'aplica coherentment a tota la vista (saldos, gràfics, llistats) i es recorda entre sessions.
- **Panell general**: saldo per compte i saldo total consolidat de la selecció activa, data de l'últim moviment importat per compte (amb avís si un compte fa massa dies que no s'actualitza), gràfic d'evolució del saldo consolidat.
- **Vista de saldos a una data**: a partir de la selecció de comptes, poder consultar la **foto dels saldos en un moment determinat** — un selector de data que mostri el saldo que tenia cada compte seleccionat aquell dia (reconstruït a partir dels moviments) i el total consolidat, per comparar la posició de tresoreria entre dates.
- **Llistat de moviments**: taula unificada amb filtres per compte, rang de dates, categoria, text del concepte i tipus (ingrés/càrrec); ordenable; exportable a CSV.
- **Resum mensual**: ingressos vs despeses per mes i per categoria, respectant la selecció de comptes activa.

## 4. Funcionalitat 2 — Recurrents i previsió

### 4.1 Recurrents: alta manual i per importació

Els recurrents (compromisos periòdics o puntuals) només es donen d'alta de dues maneres — **no hi ha cap detecció automàtica sobre l'històric bancari**:

1. **Manual**: l'usuari introdueix concepte, compte, periodicitat, import i data prevista directament a la pantalla de Recurrents.
2. **Importació de compromisos confirmats** (4.2): fitxer amb venciments ja coneguts (factures, etc.).

Un cop creat (per qualsevol dels dos camins), el recurrent és directament **confirmat**: l'usuari ja n'ha decidit conscientment l'import i la data, no cal cap pas de revisió previ.

Un recurrent es pot marcar com a **transferència interna** (mateix concepte que als moviments reals) per poder-lo filtrar; la pantalla de gestió permet filtrar la llista per compte, periodicitat i categoria.

> **Nota històrica**: una primera versió d'aquesta funcionalitat (sub-fases 3.3 «motor de detecció de periodicitat» i 3.5 «estimació agregada de targeta») detectava automàticament patrons de repetició sobre l'històric real i suggeria candidats a confirmar/ignorar. Es va **eliminar completament** a petició explícita de l'usuari: només es vol donar d'alta un recurrent manualment o per importació, mai per inferència sobre moviments passats (vegeu `ESTAT.md` per al detall de la implementació original i de la decisió de reversió). Els recurrents que ja s'havien confirmat a partir d'un candidat detectat en aquella època es mantenen intactes — `origen='detectat'` és ara només una etiqueta històrica, cap camí de codi actual en genera de nous.

### 4.2 Compromisos confirmats (importació de factures amb venciment conegut)

Alguns imports i dates ja es coneixen amb certesa abans que el moviment aparegui al banc — per exemple, una factura de proveïdor ja emesa amb un venciment concret. Aquests compromisos:

- Comparteixen model amb la resta de recurrents (4.1): mateixa entitat, amb un camp `origen` (`manual` | `importat`, més el valor històric `detectat`, vegeu 4.1) i una `periodicitat` que pot ser **única** (un venciment puntual, no repetitiu) a més de les periodicitats habituals.
- Entren directament com a **confirmats** (l'import i la data són certs, no estimats), però apareixen a la mateixa pantalla que la resta de recurrents per poder-los editar o eliminar.
- **Importació**: fitxer Excel (.xlsx), un compte per importació (com la importació bancària, 3.1), amb previsualització abans de confirmar. Format de fitxer:

  | Columna | Obligatòria | Descripció |
  |---|---|---|
  | Data de venciment | Sí | Data en què s'espera el càrrec/ingrés |
  | Concepte | Sí | Nom del proveïdor o descripció |
  | Import | Sí | Amb signe: negatiu = despesa, positiu = ingrés (mateix conveni que la resta de l'app) |
  | Categoria | No | Si el nom coincideix amb una categoria existent, s'assigna automàticament |
  | Referència | No | Núm. de factura, només informatiu |

- **Conciliació amb el moviment real** (dissenyada a la sub-fase 3.6; implementada a la Fase 4): quan el moviment bancari corresponent s'acaba important normalment (3.1), cal evitar comptar-lo dues vegades a la previsió (un cop com a recurrent/compromís confirmat, un altre com a moviment real ja carregat). Disseny acordat:
  - **Totalment automàtica, sense suggeriment ni confirmació de l'usuari** (a diferència de les transferències internes, 3.4): quan el motor de previsió vulgui projectar la propera ocurrència d'un recurrent a una data D, comprova si el compte ja té un moviment real d'import semblant en una finestra de pocs dies al voltant de D (excloent transferències internes); si en troba un, no la projecta. Es recalcula a cada crida, mai es persisteix una coincidència — un error només afecta una xifra de previsió temporal que s'autocorregeix la propera vegada, no una dada real (a diferència de vincular malament dues transferències, que sí que embrutaria dades permanents).
  - **Cap taula ni camp nou**: coherent amb el criteri general del projecte de no persistir mai un càlcul que es pot refer a partir de les dades reals.
  - Un compromís puntual (`periodicitat='unica'`) ja conciliat simplement deixa de projectar-se per sempre; la fila de `Recurrent` no s'esborra sola — si cal netejar-la, l'usuari ja la pot eliminar a mà com ara.

### 4.3 Motor de previsió

- Punt de partida: saldo consolidat actual (i per compte).
- Projecció dia a dia fins a l'horitzó triat (30 / 60 / 90 dies, i camp lliure): a cada data prevista d'un recurrent confirmat, aplicar-ne l'import estimat.
- **Despesa no recurrent (banda d'incertesa)**: **ajornada** — no es fa a la v1 d'aquesta fase; la projecció es basa només en els recurrents confirmats. Es podrà afegir més endavant sense canviar el disseny base del motor.
- **Sortides**: gràfic de saldo projectat (línia de saldo cert-a-avui + projecció), taula cronològica dels moviments previstos amb els mateixos filtres que la pestanya de Moviments (categoria, tipus ingrés/càrrec, transferència interna, cerca de text), i **alertes**: dates en què el saldo projectat baixa d'un llindar configurable o es fa negatiu — **llindar global** (sobre el saldo total de la selecció activa) **i llindar per compte** (cadascun amb el seu propi valor opcional).
- **Simulació manual** (desitjable, fase 2): afegir moviments hipotètics puntuals («i si pago 3.000 € el dia 15?») i veure l'efecte sobre la corba.

## 5. Fora d'abast (v1)

Multiusuari i autenticació; connexió automàtica amb bancs; app mòbil nativa; gestió d'inversions o productes que no siguin comptes corrents; sincronització al núvol. No implementar res d'això encara que sigui fàcil: mantenir el projecte petit.

## 6. Pla de fases proposat per a Claude Code

1. **Fase 1 — Esquelet i ingesta**: monorepo amb backend Node+TS (Express/Fastify, better-sqlite3, esquema SQLite amb migracions) i frontend Vite+React+TS; arrencada unificada amb `npm start`; importador amb detecció de banc + mapatge manual (parseig al backend), deduplicació, previsualització i resum d'importació, desfer lot, còpia automàtica del `.db` abans d'importar. *Criteri d'acceptació*: importar dos extractes solapats de cada banc real sense duplicats ni files perdudes, i verificar que les dades persisteixen després de reiniciar servidor i navegador.
2. **Fase 2 — Consulta**: panell general, selector multi-compte, vista de saldos a una data, llistat filtrable, resum mensual, regles de categorització, transferències internes, exportació/importació JSON. *Criteri*: retrobar qualsevol moviment en <10 segons amb els filtres.
3. **Fase 3 — Recurrents**: pantalla de gestió, recurrents manuals i compromisos confirmats per importació. *Criteri*: cobrir nòmina, hipoteca/lloguer i els subministraments de l'usuari donant-los d'alta manualment o per importació. Desenvolupada per sub-fases, validant cadascuna amb l'usuari abans de passar a la següent:
   - **3.1 — Model de dades unificat**: taula `recurrents` (`origen`: manual/importat, i el valor històric `detectat`, vegeu 3.3/3.5 més avall; `periodicitat` inclou «única»; `estat`: confirmat/ignorat).
   - **3.2 — Importació de compromisos confirmats**: nou tipus d'importació (factures de proveïdor amb venciment conegut, format i flux a 4.2).
   - ~~3.3 — Motor de detecció de periodicitat~~ i ~~3.5 — Estimació agregada de targeta~~: **implementades i posteriorment eliminades senceres** a petició explícita de l'usuari — cap recurrent es dona d'alta per inferència sobre l'històric bancari, només manualment (3.1) o per importació (3.2). Vegeu `ESTAT.md` per al detall de la implementació original (normalització de concepte, agrupació, classificació de periodicitat; exclusió de targetes de la detecció per patrons i estimació agregada per mitjana de cicles de liquidació) i de la decisió de reversió.
   - **3.4 — Pantalla de gestió**: recurrents manuals i importats (3.1/3.2), amb accions de corregir/eliminar.
   - **3.6 — (frontera amb Fase 4) Conciliació**: dissenyat (4.2) — mecanisme totalment automàtic i calculat al vol (sense taula ni camp nou) perquè un recurrent confirmat i el moviment bancari real que finalment el liquida no comptin dues vegades a la previsió; implementació efectiva a la Fase 4.
4. **Fase 4 — Previsió**: motor de projecció, gràfic, taula, alertes de llindar. *Criteri*: la previsió a 30 dies quadra amb el que l'usuari espera manualment (±revisió conjunta). Sense despesa difusa (ajornada, veure 4.3). Desenvolupada per sub-fases:
   - **4.1 — Motor de projecció (backend)** — implementat: saldo actual (total i per compte) + recurrents confirmats -> saldo projectat dia a dia fins a l'horitzó triat, aplicant cada recurrent periòdic tantes vegades com calgui i la conciliació (3.6). `backend/src/lib/prevision.ts` (`projectaEsdeveniments`, `construeixSerieDiaria`) + `db/operations.ts` (`calculaPrevisio`) + `GET /api/previsio`.
   - **4.2 — Sortides de consulta (frontend)** — implementat: nova pestanya "Previsió" amb selector d'horitzó (30/60/90 dies + camp lliure), gràfic de saldo projectat (total de la selecció activa) i taula cronològica dels moviments previstos. `frontend/src/views/Previsio.tsx`.
   - **4.3 — Alertes de llindar**: llindar global (saldo total de la selecció activa) i llindar per compte, cadascun opcional; avís a les dates en què el saldo projectat el supera per sota o es fa negatiu.
5. **Fase 5 (opcional)**: parser Norma 43, simulacions, despesa difusa, exportacions addicionals.

Desenvolupar **fase per fase**, validant amb l'usuari abans de passar a la següent. Escriure tests unitaris com a mínim per als parsers, la deduplicació i la detecció de periodicitat (són el cor del sistema i els punts més fràgils).

## 7. Material que aportarà l'usuari

- Un fitxer d'extracte real (o anonimitzat: es poden alterar imports i conceptes mantenint l'estructura) de **cada un dels tres bancs**, imprescindible abans d'implementar cada parser.
- Un fitxer d'extracte de **cada targeta de crèdit** que vulgui incloure, més el dia de liquidació mensual de cada targeta.
- Confirmació dels punts **[OBERT]**.
- Llindar d'alerta de saldo mínim desitjat.
- Requisit previ a la màquina: tenir **Node.js** (versió LTS) instal·lat.
