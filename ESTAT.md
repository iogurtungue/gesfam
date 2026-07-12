# ESTAT.md

Aquest fitxer es manté actualitzat segons les instruccions de `CLAUDE.md`. Conté la situació actual del projecte i l'historial cronològic invers de canvis.

## 1. Situació actual

### Què és el projecte

Aplicació web local per centralitzar moviments bancaris de Banc Sabadell, BBVA, ING i OpenBank, importats manualment des de fitxers d'extracte. Frontend Vite + React + TypeScript (només UI i lectura via API); backend Node + TypeScript + Express amb persistència en un fitxer SQLite (`dades/finances.db`), tota en local. Especificació completa a `especificacio.md`. Sense autenticació, sense sortida de dades de la màquina de l'usuari — el backend només escolta a `localhost`.

### Fases completades

**Fase 1 — Esquelet i ingesta**: parsers per banc, deduplicació, previsualització/resum d'importació, desfer lot.
**Fase 2 — Consulta**: selector global de comptes, panell general, saldos a una data, llistat filtrable, resum mensual, categories i regles, transferències internes, còpia de seguretat JSON, i menú de manteniment (eliminar només els moviments, o reinicialitzar la base de dades sencera).
**Migració d'arquitectura (post Fase 2, abans de la Fase 3)**: pas de tot (parsers, dedup, persistència) del navegador (Dexie/IndexedDB) a un backend Node/Express amb SQLite. Vegeu l'entrada d'historial corresponent i la secció Arquitectura més avall. **Pendent de validació de l'usuari abans d'iniciar la Fase 3** (vegeu "Pendent / coses obertes").

### Abast de bancs (ampliat respecte a l'especificació original)

L'especificació original només parlava de Sabadell/ING/OpenBank amb formats CSV/Excel genèrics. Durant la Fase 1, l'usuari va aportar fitxers reals que van revelar formats diferents dels previstos, i es va decidir ampliar l'abast:

| Banc | Tipus de compte | Format real | Parser |
|---|---|---|---|
| Banc Sabadell | Corrent | Norma 43 / AEB43 (text de longitud fixa, 80 caràcters) | `src/parsers/norma43.ts` |
| BBVA | Corrent | Norma 43 / AEB43 | `src/parsers/norma43.ts` (mateix parser, detecta el banc per codi d'entitat: 0081=Sabadell, 0182=BBVA) |
| BBVA | Targeta | Excel (capçaleres en català: "Data d'operació", "Concepte", "Import") | `src/parsers/banks/bbva.ts` |
| ING | Corrent | `.xls` binari real (JasperReports), cel·les numèriques/data natives | `src/parsers/banks/ing.ts` |
| ING | Targeta | Idem, sense columna de saldo | `src/parsers/banks/ing.ts` |
| OpenBank | Corrent | Taula HTML amb extensió `.xls` (marcatge sovint mal format) | `src/parsers/banks/openbank.ts` |

Norma 43 no estava previst per a la Fase 1 (l'especificació el marcava com a "desitjable, fase 5"), però es va implementar ja que és el format real que fa servir l'usuari per a Sabadell i BBVA. Els offsets de camp es van validar contra l'especificació oficial AEB/CECA (PDF "Cuaderno 43", juny 2012) i després es van contrastar amb els fitxers reals comprovant que el saldo reconstruït moviment a moviment quadra exactament amb els totals del peu de fitxer.

### Arquitectura

Monorepo amb npm workspaces (`backend/`, `frontend/`). El backend és l'única font de veritat: parseig, deduplicació, categorització i persistència hi viuen sencers; el frontend és una capa d'UI que parla amb `/api/*` per fetch i no escriu cap dada de negoci enlloc (ni IndexedDB ni localStorage — localStorage només guarda preferències d'interfície, com la selecció de comptes activa).

```
backend/src/
  db/
    migrations/001_init.sql   Esquema SQL (comptes, categories, regles, lots, moviments + índexs)
               002_comptes_ordre_grup.sql   Afegeix `ordre`/`grup` a comptes
               003_liquidacio_targeta.sql   Afegeix `es_liquidacio_targeta_id`/`moviment_origen_id`
                                            a moviments i la taula `regles_liquidacio`
    client.ts        getDb() — obre/crea dades/finances.db (node:sqlite DatabaseSync), aplica
                      migracions pendents (versionades per nom de fitxer, taula _migrations),
                      WAL mode. DB_PATH/DADES_DIR overridables per GESFAM_DB_PATH/GESFAM_DADES_DIR
                      (tests fan servir ':memory:')
    backupFile.ts     backupDbFile() — checkpoint WAL + còpia timestampada a dades/backups/,
                      reté només les N més recents. Cridada abans de commitImport, eliminaCompte,
                      importaCopiaSeguretat, reinicialitzaBaseDades, eliminaTotsElsMoviments
    types.ts          Compte, Moviment (amb `seq`, `esLiquidacioTargetaId`, `movimentOrigenId`),
                      LotImportacio, Categoria, ReglaCategoritzacio, ReglaLiquidacioTargeta
                      (interfícies camelCase; mapeig manual a/des de columnes snake_case)
    operations.ts     Tota la lògica de negoci sobre SQLite: importació/dedup/undo,
                      categories/regles, transferències internes, liquidacions de targeta
                      (marcaLiquidacioTargeta/desmarcaLiquidacioTargeta/suggereixLiquidacionsTargeta,
                      especificacio.md 3.2.1), recurrents manuals/importats sense cap detecció
                      automàtica (especificacio.md 4.1/4.2), motor de previsió (`calculaPrevisio`,
                      especificacio.md 4.3, sub-fase 4.1), còpia de seguretat, reinicialització —
                      equivalent 1:1 al `db/operations.ts` de Dexie de l'antiga arquitectura, ara
                      amb SQL preparat en lloc de crides a Dexie

  lib/              Utilitats pures i testejades (numbers, dates, concept, hash, encoding,
                     categorization, internalTransfers, liquidacioTargeta, prevision) —
                     subconjunt "de backend" (parseig/dedup/previsió) de les utilitats originals

  parsers/, dedup/  Mateixos mòduls que abans (independents de qualsevol capa de persistència),
                    ara executant-se al backend. `importFile.ts` pren `{name, buffer: ArrayBuffer}`
                    en lloc d'un `File` del navegador; `readRawTable()` exportat a part perquè
                    la ruta de mapatge manual el pugui reutilitzar sense duplicar-lo

  routes.ts         Totes les rutes REST (Router d'Express), muntades a /api per server.ts
  server.ts         Punt d'entrada: obre la BD, serveix /api, serveix frontend/dist ja compilat
                    (catch-all cap a index.html per a l'SPA), obre el navegador (llevat que
                    GESFAM_NO_OPEN estigui definit — el `dev` script el defineix per evitar
                    obrir una pestanya nova cada reinici de tsx watch)
  migrateFromJson.ts  Script d'un sol ús: llegeix una còpia de seguretat JSON exportada per
                      l'antic frontend i la carrega a SQLite via importaCopiaSeguretat()

frontend/src/
  api/
    types.ts        Formes de tipus pures que reflecteixen el domini del backend — sense lògica
    client.ts        Totes les crides fetch a /api/*, amb els mateixos noms de funció que
                     l'antic db/operations.ts (per minimitzar canvis a les vistes)

  lib/              Subconjunt "de visualització" de les utilitats originals: numbers.ts
                    (només centsToEs), dates.ts (només avui/formatDateEs), balance.ts
                    (saldoEnData — el frontend encara reconstrueix el saldo a partir dels
                    moviments que rep, no cal exposar-ho com a endpoint), summary.ts, bankLabel.ts

  hooks/useCompteSeleccio.ts   Selecció global de comptes, persistida a localStorage (preferència
                                d'interfície, no dada de negoci — es manté igual que abans)
  components/CompteSelector.tsx
  views/            Dashboard.tsx, MovimentsList.tsx, Summary.tsx, CategoriesManager.tsx,
                    AccountsManager.tsx, Maintenance.tsx (inclou la còpia de seguretat JSON i les
                    còpies automàtiques del `.db`; no hi ha pestanyes separades per a cap de les dues),
                    Previsio.tsx (pestanya "Previsió", especificacio.md 4.3, sub-fase 4.2: selector
                    d'horitzó 30/60/90/lliure, gràfic de saldo projectat via recharts i taula
                    cronològica dels moviments previstos, cridant `GET /api/previsio`)
  import/           ImportWizard.tsx (puja fitxers via FormData a /api/importacio/*),
                    ManualMapping.tsx, LotsList.tsx
  App.tsx           Navegació per pestanyes + estat global (comptes/lots/categories/regles)
```

**Principi de disseny clau**: el frontend no conté cap lògica de parseig, deduplicació ni persistència — només `fetch` cap al backend i reconstrucció de vistes (saldo/resum) a partir de les dades ja rebudes. No hi ha un paquet compartit entre `backend/` i `frontend/`: cada banda té la seva pròpia còpia trimmed dels fitxers purs que necessita (p. ex. `lib/dates.ts` existeix a totes dues bandes amb funcions diferents), triat deliberadament per no afegir complexitat de tooling de monorepo a canvi de duplicació petita i de baix risc de divergència.

**`node:sqlite` (`DatabaseSync`) en lloc de `better-sqlite3`**: mòdul natiu de Node (des de la v22+), sense compilació nativa, API síncrona equivalent. Evita problemes de build natiu a Windows sense sacrificar cap capacitat necessària (transaccions, `.exec()` multi-sentència, PRAGMA).

**Migracions SQL fetes a mà** (`db/migrations/*.sql` + runner a `client.ts`) en lloc d'un ORM — justificat per l'especificació ("Claude Code pot proposar alternatives equivalents si ho justifica") i per simplicitat operativa.

### Decisions preses (no reobrir sense motiu)

- **Unitats monetàries**: sempre cèntims enters (`importCents`, `saldoPosteriorCents`), mai float en euros, per evitar errors d'arrodoniment als hash de deduplicació i sumes. La conversió a text només passa a la UI (`centsToEs`).
- **Deduplicació**: id = hash(banc, compteId, dataOperació, import, concepte normalitzat, saldo posterior). Limitació documentada (spec 3.3): dos moviments idèntics el mateix dia amb el mateix saldo posterior col·lideixen; es tracta com a duplicat.
- **Targetes de crèdit**: no tenen columna de saldo a l'origen, així que el "saldo" mostrat és el deute acumulat dels moviments importats (suma de `importCents`), no un saldo bancari verificat. Etiquetat com a tal a la UI (spec 3.2.1).
- **Liquidació de targeta — contrapartida automàtica** (spec 3.2.1): l'extracte de la targeta mai inclou la seva pròpia liquidació, així que el deute (suma de `importCents`) creixeria indefinidament sense una contrapartida. Marcar el càrrec del compte corrent com "liquidació de la targeta X" (`marcaLiquidacioTargeta`) crea un moviment virtual a la targeta amb `movimentOrigenId` apuntant al càrrec real, id determinista (`computeContrapartidaId`, idempotent davant reimportacions) i el mateix `lotImportacioId` que el càrrec — així `undoLot` ja l'elimina en cascada sense cap codi addicional. Tots dos es marquen `esTransferenciaInterna=true` (exclosos dels agregats de `summary.ts`, i haurien d'excloure's igualment de la futura detecció de recurrents). La quadratura (import liquidat vs. suma de moviments de la targeta des de l'anterior liquidació) es calcula i es retorna a la crida de marcar, per mostrar un avís no bloquejant si no coincideix.
- **Transferències internes**: mai es marquen automàticament. Hi ha un detector heurístic (`suggereixTransferenciesInternes`) que proposa parelles (mateix import, signe oposat, comptes diferents, ±2 dies) però requereix confirmació explícita de l'usuari — validat amb dades reals que produeix tant positius certs com falsos positius plausibles.
- **Categories/regles**: aplicades automàticament en importar (moviments nous), mai sobreescriuen una categoria ja assignada manualment. Hi ha un botó per reaplicar regles només als moviments sense categoria.
- **Número de compte per deduplicar entre sessions**: els bancs de taula (ING/BBVA-targeta/OpenBank) no posen el número de compte a la capçalera de moviments — es va afegir `findLabeledValue` per extreure'l de les metadades del fitxer (p. ex. "Número de cuenta:"), imprescindible perquè l'app reconegui "aquest fitxer ja és d'aquest compte" entre importacions separades.
- **xlsx via CDN de SheetJS, no npm** (backend): la versió publicada a npm té vulnerabilitats conegudes sense pedaç (prototip pollution, ReDoS) perquè SheetJS distribueix les versions corregides des del seu propi CDN. `backend/package.json` apunta a `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.
- **`Samples/` i `dades/` mai es commitegen**: `Samples/` conté fitxers reals d'extractes bancaris de l'usuari; `dades/` conté el `finances.db` real i les seves còpies de seguretat. Totes dues exclosos via `.gitignore`.
- **`Moviment.seq`**: cap font de dades (abans IndexedDB, ara SQL sense `ORDER BY` explícit) garanteix retornar les files en ordre d'inserció, així que `dataOperacio` per si sola no basta per ordenar cronològicament una llista — cal un desempat explícit per a moviments del mateix dia. `commitImport` assigna `seq` estrictament creixent seguint l'ordre del fitxer parsejat (mai l'ordre de retorn de la BD). El llistat de moviments (`views/MovimentsList.tsx`) fa servir `seq` directament com a desempat. `lib/balance.ts` (`saldoEnData`, frontend) reconstrueix igualment l'ordre cronològic real a partir de la cadena de saldos (`saldoPosteriorCents`/`importCents` de cada moviment) per no dependre només de `seq` en dades antigues, i només hi recorre com a últim recurs quan la cadena no es pot resoldre (buit, primer moviment de la història, duplicats ambigus).

### Estat de les proves

Backend: 185 tests (Vitest) — parsers (inclou `recurrentsFile.ts`, el parser del format fix de compromisos), dedup (inclou `dedup/recurrents.ts`), `lib/` (inclou `liquidacioTargeta.ts`, `computeContrapartidaId`, `computeRecurrentHash`, `dates.ts` — `afegeixDies`/`afegeixMesos`/`diesEntre`/`isoAvui`, reutilitzats pel motor de previsió —, i el motor de previsió `prevision.ts`: `projectaEsdeveniments`/`construeixSerieDiaria`), `db/operations.ts` contra SQLite en memòria (`GESFAM_DB_PATH=':memory:'`, inclou el mecanisme de liquidació de targeta: marcatge, quadratura, idempotència, cascada via `undoLot`; i el model de recurrents: creació manual, validacions, eliminació, importació amb dedup i resolució de categoria, còpia de seguretat, manteniment), `db/client.ts` (migracions) i `db/backupFile.ts` (còpia + retenció). Frontend: 36 tests — `lib/balance.ts`, `lib/summary.ts`, `lib/dates.ts` (inclou `faDiesAbans`), `lib/numbers.ts` (només lògica de visualització; els components de vista, inclosos els de recurrents i ara `views/Previsio.tsx` — no tenen tests propis: es verifiquen manualment/via HTTP, seguint el mateix criteri que la resta de `views/`/`import/`). `npx tsc -b` net a totes dues bandes, `npm run build` (frontend) i `oxlint` (frontend) nets.

Verificació addicional (no automatitzada, feta manualment durant la migració d'arquitectura, vegeu historial): migració de la còpia de seguretat JSON real de l'usuari (4 comptes, 266 moviments, 4 lots, 23 categories, 15 regles) a SQLite amb comparació camp a camp — 0 diferències reals; arrencada de `npm start` real contra `dades/finances.db` migrat, import/undo/eliminar compte de prova via HTTP (confirmant que `backupDbFile()` es dispara), i reinici del servidor confirmant que les dades hi són intactes.

### Pendent / coses obertes

- **Fase 3 (recurrents) COMPLETA**, per sub-fases (pla a `especificacio.md` §4.1, §4.2, §6 punt 3): **3.1 model de dades unificat**, **3.2 importació de compromisos confirmats**, **3.4 pantalla de gestió** (edició/eliminació), **3.6 conciliació — dissenyada** (mecanisme totalment automàtic i calculat al vol, sense taula ni camp nou; implementada a la Fase 4). **3.3 (motor de detecció de periodicitat) i 3.5 (estimació agregada de targeta) es van implementar i posteriorment eliminar senceres** a petició explícita de l'usuari: cap recurrent es dona d'alta per inferència sobre l'històric, només manualment o per importació. Vegeu l'entrada d'historial "Eliminació de la detecció automàtica de recurrents" per al detall.
- **Fase 4 (previsió) en curs**, per sub-fases (pla a `especificacio.md` §4.3, §6 punt 4), acordat amb l'usuari: **4.1 motor de projecció (backend) — implementat**, **4.2 sortides de consulta — implementada** (nova pestanya "Previsió": gràfic + taula), **4.3 alertes de llindar** (llindar global i per compte, tots dos opcionals, pendent). Decisions preses en començar: **despesa difusa ajornada** (no a la v1 d'aquesta fase — ja no és un [OBERT] pendent), llindar d'alerta **global i per compte** (no només un dels dos).
- **Verificació de la pestanya "Previsió" (4.2) només via API/tsc/build/oxlint, no clic a clic en un navegador real**: no hi ha eina de navegador disponible en aquesta sessió; es va arrencar el servidor real contra una còpia temporal de `dades/finances.db` (esborrada en acabar) i es va cridar `GET /api/previsio` per HTTP (inclòs el cas d'error 400 amb `horitzoDies` no numèric), confirmant que la ruta i el contracte de dades funcionen d'punta a punta. Falta la confirmació visual de l'usuari a un navegador real.
- **Nova pestanya "Recurrents"** (abans la importació/llistat de compromisos vivia sota "Importar"): decisió presa sense preguntar explícitament, per no amuntegar tot sota "Importar" un cop hi ha també formulari manual i assistent d'importació — reconsiderar si l'usuari ho prefereix d'una altra manera.
- **La importació de compromisos (3.2) no té "lot"/desfer com la importació bancària**: cada fila importada és un `recurrent` independent, eliminable un a un (`eliminaRecurrent`, ja de la 3.1) — decisió d'abast per no duplicar la maquinària de `lots`/`undoLot` per a un cas d'ús que sol ser de pocs registres. Revisar si el volum real ho justifica.
- **Verificació de la UI de recurrents (3.2/3.4) només via API/build, no clic a clic**: no hi ha eina de navegador disponible en aquesta sessió; `tsc -b`, `oxlint` i `vite build` nets, i els fluxos sencers (previsualitzar+confirmar+dedup d'un import, detectar+confirmar-amb-correcció+ignorar un candidat, editar i eliminar un recurrent) verificats per HTTP contra un servidor i dades temporals. Falta la confirmació visual de l'usuari a un navegador real.
- **Un recurrent ja confirmat amb `dataPrevista` passada no s'actualitza automàticament a la seva pròpia fila**: l'usuari l'ha de corregir a mà des de l'edició in-line si vol que `dataPrevista` reflecteixi la realitat. El motor de previsió (Fase 4, 4.1) ja ho gestiona sense necessitat d'aquesta correcció manual: per a un periòdic avança silenciosament fins la primera ocurrència futura, i per a un `unica` vençut i encara no conciliat, el projecta avui mateix marcat `vençut: true` (vegeu entrada d'historial corresponent) en lloc de desaparèixer o quedar-se enrere.
- **Fase 5 (opcional)**: simulacions manuals, despesa difusa, exportacions addicionals — no iniciades.
- El bundle de producció del frontend supera els 500 kB (principalment `recharts`); Vite ho avisa en el build però no s'ha considerat necessari fer code-splitting per a una app d'ús personal.

### 2026-07-12 — Eliminació de la detecció automàtica de recurrents

L'usuari ha demanat un canvi important: eliminar completament la detecció automàtica de recurrents. A partir d'ara, un `Recurrent` només es pot crear de dues maneres — manualment (3.1) o per importació d'un fitxer de compromisos confirmats (3.2). Abans d'executar-ho es va preguntar l'abast exacte: l'usuari va confirmar (opció recomanada) eliminar **tots dos** mecanismes de detecció — tant la detecció per patrons de comerç a compte corrent (3.3) com l'estimació agregada de liquidació de targeta (3.5) —, no només el primer.

**Backend**:
- `lib/recurrenceDetection.ts` i el seu test (`recurrenceDetection.test.ts`) **esborrats sencers**: `detectaRecurrents`, `estimaLiquidacioTargeta`, i tota la maquinària auxiliar (periodicitats, cicles de liquidació, confiança...).
- `db/operations.ts`: eliminades `detectaCandidatsRecurrents`, `confirmaCandidatRecurrent`, `ignoraCandidatRecurrent` i la constant `CONCEPTE_ESTIMACIO_TARGETA`; net l'import de `normalizeConceptForRecurrence` (ja sense ús).
- `routes.ts`: eliminades `GET /recurrents/candidats`, `POST /recurrents/candidats/confirma`, `POST /recurrents/candidats/ignora`.
- `operations.test.ts`: eliminats els blocs de tests de detecció/estimació/confirma-ignora; el bloc `actualitzaRecurrent` es manté (renombrat, sense l'ajut `dades()` compartit amb els tests eliminats).

**Frontend**:
- `import/RecurrentsCandidatsList.tsx` **esborrat sencer**.
- `views/RecurrentsManager.tsx`: ja no crida `detectaCandidatsRecurrents` ni renderitza cap llista de candidats; només formulari manual + assistent d'importació + llista de confirmats.
- `api/client.ts`/`api/types.ts`: eliminats `detectaCandidatsRecurrents`/`confirmaCandidatRecurrent`/`ignoraCandidatRecurrent`, `CandidatRecurrent`, `PeriodicitatDetectable`.
- `lib/periodicitat.ts`: `PeriodicitatDetectable` (que venia de `api/types.ts`, ara eliminat) substituït per un `Exclude<PeriodicitatRecurrent, 'unica'>` inline — aquesta llista (`PERIODICITATS_REPETITIVES`) és d'ordenació de desplegables, no té relació intrínseca amb la detecció, així que no calia eliminar-la.

**Què es manté intacte**: els 15 recurrents que en algun moment es van confirmar a partir d'un candidat detectat (`origen='detectat'`) — no es toquen, continuen funcionant amb normalitat (incloent-hi la projecció a la Previsió); `origen='detectat'` es queda com a valor vàlid del tipus, ara purament una etiqueta històrica que cap camí de codi actual torna a generar. El marcatge de liquidació de targeta (`marcaLiquidacioTargeta`/`desmarcaLiquidacioTargeta`, spec 3.2.1) tampoc es toca: és una funcionalitat independent (vincular un càrrec real amb la targeta que liquida), no depenia de la detecció.

**Neteja de dades demanada explícitament**: l'usuari també ha demanat eliminar les 5 files amb `estat='ignorat'` que quedaven (candidats prèviament descartats, ja invisibles a la UI). Fet amb un script d'un sol ús que crida `eliminaRecurrent` per a cadascuna (backup automàtic abans de cada esborrat, igual que qualsevol altra eliminació de l'app), contra `dades/finances.db` real. Script esborrat en acabar.

**Incident durant la verificació (fals positiu, resolt)**: en comprovar l'estat final de `dades/finances.db`, es va detectar que, a més de les 5 files `ignorat` eliminades pel script, havien desaparegut també els 15 recurrents `origen='detectat'`/`confirmat` i 1 manual — cap operació d'aquesta sessió els havia tocat (totes les proves d'aquesta tasca corren contra `:memory:` o còpies temporals). Es va aturar la feina i reportar-ho explícitament a l'usuari abans de continuar, ja que semblava una pèrdua de dades. L'usuari va confirmar que havia estat ell mateix, en paral·lel des de l'app real, qui havia eliminat aquells 15 recurrents — no hi ha hagut cap pèrdua de dades ni cap bug. Estat final real: 37 recurrents (tots `origen='importat'`).

Verificació de codi: `tsc -b`/`oxlint`/`vite build` nets a totes dues bandes; 185 tests backend (down de 229; s'han eliminat els ~44 tests de detecció/estimació/confirma-ignora) i 36 tests frontend sense canvis, tots en verd.

`especificacio.md` actualitzat: §4 ja no es diu "Detecció de recurrents i previsió" sinó "Recurrents i previsió"; §4.1 reescrit («Recurrents: alta manual i per importació», amb nota històrica sobre la detecció eliminada); §4.2 ja no parla de recurrents "detectats automàticament"; §6 punt 3 marca 3.3/3.5 amb ratllat (~~tatxat~~) com a implementades-i-eliminades, redirigint a aquest `ESTAT.md` per al detall.

### 2026-07-12 — Previsió: un compromís puntual vençut es projecta avui, marcat com a tal (no desapareix)

L'usuari va preguntar què passava amb un recurrent amb data passada. Resposta: per a un recurrent **periòdic** ja funcionava bé (s'avança silenciosament a la propera ocurrència futura, vegeu la 4.1). Per a un compromís **puntual** (`periodicitat='unica'`) amb `dataPrevista` passada i encara no conciliat, el comportament fins ara era que simplement **desapareixia** de la previsió per sempre, sense cap avís — una decisió pròpia presa a la 4.1 que, en preguntar-ho, es va confirmar que no era la desitjada.

Canvi acordat amb l'usuari: en lloc de desaparèixer, es projecta **avui mateix**, marcat perquè es pugui identificar com a vençut.

- `lib/prevision.ts` (`EsdevenimentPrevist`): nou camp opcional `vençut?: boolean`. `projectaEsdeveniments` separa ara el cas `unica` de l'avanç periòdic: si `dataPrevista < avui` i el compromís no està conciliat, es projecta amb `data: avui` i `vençut: true`. **Detall important de correcció**: la conciliació es comprova contra la `dataPrevista` **original**, no contra la data mostrada (avui) — si es comprovés contra avui, un pagament real fet fa setmanes (a prop de la data de venciment original però lluny d'avui) no coincidiria dins la finestra de ±3 dies, i el compromís ja pagat seguiria apareixent com a pendent. Si l'esdeveniment vençut xoca amb la seva pròpia `dataFi` (rar, però possible si `dataFi` és anterior a avui), no es projecta.
- `views/Previsio.tsx` i `api/types.ts`: nou camp `vençut` propagat de punta a punta. La fila d'un esdeveniment vençut es ressalta (fons taronja clar) i el concepte porta l'etiqueta "⚠ vençut" amb un `title` explicatiu.

Tests: 4 nous a `prevision.test.ts` (es projecta avui i marcat, un `unica` futur no es marca, la conciliació ancora a la data original i no a avui, un vençut no traspassa la seva pròpia `dataFi`) — 229 tests backend en total. `tsc -b`/`oxlint`/`vite build` nets a totes dues bandes.

Validat contra l'històric real (només lectura, còpia temporal esborrada en acabar): actualment l'usuari no té cap compromís puntual confirmat amb data passada, així que el nou camí de codi no s'exercita amb dades reals ara mateix — cobertura només per tests unitaris determinístics.

### 2026-07-12 — Previsió: la taula de moviments previstos passa a tenir una columna Import/Saldo per compte (com Moviments)

Feedback de l'usuari sobre la taula de la 4.2: en lloc d'una sola columna "Compte" per fila, ha de ser com la taula de Moviments — totes les columnes dels comptes seleccionats en paral·lel, amb el saldo projectat a cada esdeveniment.

- `views/Previsio.tsx`: la taula ja no té columna "Compte" ni "Import" únics; ara té una capçalera de dues files amb un parell Import/Saldo per cada compte seleccionat (`colSpan={2}`), igual que `MovimentsList.tsx`. El saldo projectat de cada compte "en aquell moment" es calcula amb una sola passada lineal sobre `previsio.esdeveniments` (que el backend ja retorna ordenats cronològicament): s'acumula cada import sobre `previsio.saldosInicials`, i com que la passada és en ordre de data creixent, el valor acumulat de QUALSEVOL compte en un punt donat ja és el seu saldo projectat vigent en aquell moment — no cal cap cerca addicional per data (a diferència de `consultaSaldoPerCompte` de `MovimentsList.tsx`, necessària allà perquè els moviments reals no vénen ja ordenats de la mateixa manera per a tots els comptes alhora). El compte propi de la fila mostra Import (amb color per signe) + Saldo en negreta; la resta de comptes mostren només el seu Saldo vigent, en gris, com fa `MovimentsList.tsx` amb el "saldo anterior".
- Estils de columna propis del fitxer (ja no reutilitza `lib/recurrentsTable.ts`, pensat per a les taules de Recurrents amb columnes diferents): rèplica reduïda dels de `MovimentsList.tsx` (`cellData`/`cellConcepte`/`cellCategoria`/`cellNumeric`, sense TI/Liquidació/accions perquè un esdeveniment previst no és una fila persistida i editable).

`tsc -b`/`oxlint`/`vite build` nets; 36 tests frontend sense canvis (sense test dedicat, mateix criteri que la resta de `views/`). Sense verificació clic a clic en un navegador real (no hi ha eina de navegador disponible en aquesta sessió) — el contracte de `GET /api/previsio` no ha canviat (ja verificat per HTTP a l'entrada anterior), només la seva representació a la taula.

### 2026-07-12 — Sub-fase 4.2: sortides de consulta de la previsió (frontend)

Segona sub-fase de la Fase 4, sobre el motor ja implementat a la 4.1. Nova pestanya **"Previsió"** (`frontend/src/views/Previsio.tsx`), amb selector global de comptes (`ambSelector: true`, com "Panell general"/"Moviments"/"Resums" — la "selecció activa" de l'especificació 4.3 és la mateixa selecció global de tota l'app):

- **Selector d'horitzó**: botons 30/60/90 dies + un camp numèric lliure, tots controlant el mateix estat (`horitzoDies`, per defecte 30).
- **Gràfic de saldo projectat**: `LineChart` de `recharts`, mateix patró que el gràfic ja existent a `Dashboard.tsx` (línia `stepAfter`, `ResponsiveContainer` a 300px d'alçada) — el primer punt de la sèrie diària ja és el saldo cert d'avui (calculat pel motor de la 4.1), així que la línia ja combina "cert-a-avui + projecció" sense cap tractament especial al frontend.
- **Taula cronològica**: llista els `esdeveniments` previstos (Data, Compte, Concepte, Import, Categoria), reutilitzant els estils de columna de `lib/recurrentsTable.ts` (`cellData`/`cellCompte`/`cellConcepte`/`cellImport`/`cellCategoria`) perquè l'amplada de columna sigui coherent amb les taules de Recurrents.

Nous a `api/`: tipus `EsdevenimentPrevist`/`PuntSerieDiaria`/`Previsio` (`types.ts`) i `calculaPrevisio(compteIds, horitzoDies)` (`client.ts`, crida `GET /api/previsio`).

Decisió pròpia (no calia preguntar, mirall directe de `Dashboard.tsx` i de l'especificació "gràfic de saldo projectat", en singular): el gràfic mostra només el **saldo total** de la selecció activa, no una línia per compte — coherent amb el fet que el llindar global de la 4.3 també és sobre el total, no un desglossament per compte al gràfic.

`tsc -b`/`oxlint`/`vite build` nets a totes dues bandes; 36 tests frontend sense canvis (cap test nou — `Previsio.tsx` es verifica manualment/via HTTP, mateix criteri que la resta de `views/`). Verificat per HTTP contra un servidor real arrencat amb una còpia temporal de `dades/finances.db` (esborrada en acabar): `GET /api/previsio` amb els 9 comptes reals i horitzó de 30 dies retorna 35 esdeveniments i una sèrie de 31 punts amb el saldo inicial correcte; `horitzoDies=abc` retorna 400 amb el missatge d'error esperat. Sense verificació clic a clic en un navegador real (no hi ha eina de navegador disponible en aquesta sessió).

`especificacio.md` actualitzat: §6 punt 4, sub-fase 4.2 marcada com a implementada.

### 2026-07-12 — Sub-fase 4.1: motor de projecció (backend)

Primera sub-fase de la Fase 4, implementada després del pla i les decisions de disseny acordades (vegeu entrada següent). Nou mòdul pur `backend/src/lib/prevision.ts`:

- **`projectaEsdeveniments(recurrents, movimentsPerConciliacio, horitzoDies, avui?)`**: per a cada recurrent `confirmat`, avança des de `dataPrevista` període a període (`avancaPeriodicitat`, un `switch` sobre `periodicitat` reutilitzant `afegeixDies`/`afegeixMesos`) fins a `avui + horitzoDies`. Cada ocurrència dins la finestra `[avui, límit]` es projecta llevat que ja estigui **conciliada** (3.6): un moviment real del mateix compte, mateix signe, import dins ±15% i data dins ±3 dies. Les ocurrències anteriors a avui es salten sense comprovar conciliació — per disseny, mai es projecta el passat; per a un recurrent amb `dataPrevista` desfasada (no hi ha cap mecanisme que l'avanci sol, vegeu "Pendent"), això avança silenciosament fins a la primera ocurrència futura. Respecta `dataFi` si n'hi ha. Un compromís `unica` es projecta com a molt un cop.
- **`construeixSerieDiaria(saldosInicialsPerCompte, esdeveniments, horitzoDies, avui?)`**: un punt per dia (d'avui a avui+horitzó) amb `saldoPerCompte` i `saldoTotal`, acumulant els esdeveniments previstos sobre els saldos inicials.
- **Finestra i tolerància de conciliació** (3 dies, 15%): no especificades amb un valor exacte a l'especificació ("finestra de pocs dies", "import semblant") — criteri propi, coherent amb la tolerància ja existent a la detecció de patrons (`recurrenceDetection.ts`).

`db/operations.ts` afegeix `calculaPrevisio(compteIds, horitzoDies, avui?)`: calcula el saldo actual per compte amb SQL simple (**no** reprodueix la lògica d'ordenació/desempat del frontend per a targetes amb moviments del mateix dia — innecessària aquí perquè la suma és independent de l'ordre): targetes = `SUM(import_cents)` de tots els seus moviments; comptes corrent = `saldoPosteriorCents` del moviment amb `(dataOperacio, seq)` més recent (`seq` és estrictament creixent en ordre d'importació, i el saldo posterior és informat pel banc). Després crida `projectaEsdeveniments`/`construeixSerieDiaria` amb els recurrents confirmats i els moviments (exclosos transferències internes) dels comptes demanats. Nova ruta `GET /api/previsio?compteIds=...&horitzoDies=...` (400 si `horitzoDies` no és un enter positiu).

**Refactor previ necessari**: `isoAvui`/`afegeixDies`/`afegeixMesos`/`diesEntre` vivien duplicats o mig privats a `lib/recurrenceDetection.ts`; ara centralitzats a `lib/dates.ts` (ja existia per al frontend, ara també al backend) i reutilitzats des de totes dues bandes (`recurrenceDetection.ts` hi importa en lloc de definir-los localment; `operations.ts` importa `isoAvui` de `dates.ts` en lloc de `recurrenceDetection.ts`).

Tests: 6 nous a `dates.test.ts` (`afegeixDies`/`afegeixMesos`/`diesEntre`) i 11 nous a `prevision.test.ts` (projecció mensual dins l'horitzó, `unica` un sol cop, avanç silenciós d'una `dataPrevista` desfasada, conciliació per import/data/compte/signe — inclosos els casos que NO han de conciliar —, tall a `dataFi`, ordenació cronològica entre diversos recurrents, acumulació de la sèrie diària amb un i diversos comptes) — 225 tests backend en total. `tsc -b` net.

Validat contra l'històric real (només lectura, còpia temporal de `dades/finances.db`, esborrada en acabar): els saldos inicials calculats per `calculaSaldosActuals` coincideixen exactament, compte a compte, amb els valors bruts de la BD (`saldo_posterior_cents` del moviment més recent per a cada corrent, `SUM(import_cents)` per a cada targeta) — incloent-hi el cas subtil d'OB-JA, on el moviment de `seq` més alt no és el de la data més recent i cal ordenar per `(data_operacio, seq)` i no només per `seq`. La previsió a 90 dies sobre les 9 comptes reals produeix una sèrie diària i una llista d'esdeveniments coherents, sense errors.

### 2026-07-12 — Inici de la Fase 4 (previsió): pla de sub-fases i decisions de disseny

L'usuari ha demanat iniciar la Fase 4. Abans d'implementar es van confirmar tres decisions:

- **Despesa difusa**: ajornada — no es fa a la v1 d'aquesta fase, deixant de ser un punt [OBERT] de l'especificació. La projecció es basa només en els recurrents confirmats.
- **Llindar d'alerta**: **global** (sobre el saldo total de la selecció activa) **i per compte** (cadascun amb el seu propi valor opcional) — no només un dels dos.
- **Ubicació a la interfície**: nova pestanya **"Previsió"**, coherent amb com ja es va fer "Recurrents".

`especificacio.md` actualitzat: §4.3 substitueix el punt [OBERT] de despesa difusa per la decisió d'ajornar-la, i aclareix que l'alerta de llindar és global i per compte; §6 punt 4 desglossa la Fase 4 en sub-fases: **4.1 motor de projecció** (backend), **4.2 sortides de consulta** (gràfic + taula a la pestanya "Previsió"), **4.3 alertes de llindar**.

Sense canvis de codi encara — aquesta entrada només documenta l'acord de planificació.

### 2026-07-12 — Sub-fase 3.6: disseny de la conciliació (frontera amb Fase 4) — Fase 3 completa

Última sub-fase de la Fase 3, explícitament **només de disseny** (l'especificació ja deia que la implementació efectiva s'ajorna a la Fase 4). Problema a resoldre: un `Recurrent` prediu un import a una data futura; quan arriba el moviment bancari real que el liquida, cal evitar comptar-lo dues vegades a la previsió (un cop com a projecció, un altre com a moviment real ja al saldo).

Disseny acordat amb l'usuari (dues preguntes, totes dues amb la resposta recomanada):

- **Totalment automàtica, sense suggeriment ni confirmació** — a diferència de les transferències internes (3.4), que sí que requereixen confirmar-les. Raó: aquí un error només afecta una xifra d'una previsió temporal que es recalcula (i s'autocorregeix) cada vegada, no una dada real — vincular malament dues transferències, en canvi, embrutaria dades permanents. Mecanisme: quan el motor de previsió (Fase 4) vulgui projectar la propera ocurrència d'un recurrent a una data D, comprovarà si el compte ja té un moviment real d'import semblant en una finestra de pocs dies al voltant de D (excloent transferències internes); si en troba un, no la projecta.
- **Cap taula ni camp nou ara**: coherent amb la resta de la Fase 3 (candidats detectats, estimació de targeta), on mai es persisteix una coincidència calculada — es recalcula sempre. Un compromís puntual (`periodicitat='unica'`) ja conciliat simplement deixa de projectar-se per sempre; la fila de `Recurrent` no s'esborra sola (l'usuari ja la pot eliminar a mà si vol netejar-la).

`especificacio.md` actualitzat: la secció 4.2 substitueix el punt **[OBERT]** de conciliació per aquest disseny concret (deixa de ser obert); el punt 3.6 del pla de fases (secció 6) es marca com a dissenyat; el punt 3.5 del mateix pla s'actualitza per reflectir la versió final (estimació agregada), no la primera versió (patrons) que va quedar superada durant la pròpia sub-fase 3.5.

Sense canvis de codi — aquesta entrada només documenta l'acord de disseny. **Amb això, la Fase 3 (recurrents) queda completa**; la implementació de la conciliació, junt amb la resta del motor de previsió, són feina de la Fase 4 (encara no iniciada).

### 2026-07-12 — Bug: eliminar un recurrent no en feia còpia de seguretat abans

L'usuari va esborrar per error un recurrent de targeta i va preguntar com recuperar-lo. Resposta pràctica: com que és una estimació de targeta (sub-fase 3.5 revisada), es recalcula sempre a partir dels moviments reals — en eliminar el `Recurrent` confirmat, torna a aparèixer com a candidat pendent de confirmar la propera vegada que es demanen els candidats (verificat contra el servidor real de l'usuari, només lectura: les dues targetes ING-TG-JN i ING-TG-JA ja tornaven a mostrar l'estimació com a candidat). No es perd cap dada perquè el "recurrent" no és més que una confirmació d'un càlcul reproduïble.

Però això només s'aplica a recurrents derivats d'un candidat (detectats o d'estimació de targeta); un recurrent **manual** eliminat per error no es pot regenerar sol. Es va detectar que `eliminaRecurrent` era l'única operació destructiva de tota l'aplicació que **no** feia una còpia de seguretat abans d'esborrar (a diferència d'`eliminaMoviment`, `eliminaCompte`, `reinicialitzaBaseDades`, etc.) — corregit: `db/operations.ts` hi afegeix ara una crida a `backupDbFile()` abans del `DELETE`. Verificat per HTTP contra un servidor i dades temporals (0 còpies abans, 1 després d'eliminar). Sense test dedicat a `operations.test.ts` — cap altra operació similar en té (el DB de test és `:memory:`, on `backupDbFile()` ja és un no-op per disseny), coherent amb el criteri existent.

### 2026-07-12 — Sub-fase 3.5 revisada: estimació agregada de targeta (substitueix la detecció per patrons)

L'usuari va trobar la 3.5 original (detecció per patrons de repetició també a les targetes) massa complexa i poc fiable per a aquest cas: una targeta té massa comerços diferents amb imports irregulars i poques ocurrències cadascun perquè la detecció per patró tingui sentit. El que realment cal per a la tresoreria és **quant costarà en total la propera liquidació**, no saber que "Bon Àrea" es repeteix cada setmana. Es demana explícitament **no** desglossar per categoria tampoc — només un total agregat per targeta.

Abans d'implementar es van confirmar tres decisions:
- **Període de liquidació**: cicle segons `diaLiquidacio` (del dia després del `diaLiquidacio` d'un mes fins al `diaLiquidacio` del mes següent), no mes calendari ni liquidacions marcades manualment.
- **Finestra**: mitjana dels últims 3 cicles complets, amb un mínim de 2 amb dades per generar cap estimació.
- **Targeta sense `diaLiquidacio` configurat**: no es proposa cap estimació (no hi ha manera fiable de delimitar cicles ni de saber quan es liquidarà).

Implementació:

- `lib/recurrenceDetection.ts`: **elimina** `properaDataLiquidacio` (i els seus 6 tests) — quedava sense ús, substituïda per un enfocament diferent. Noves `cicleAnterior`/`cicleSeguent`/`ultimaDataLiquidacio` (privades, aritmètica de cicles de calendari a partir d'un dia de mes, amb el mateix clamp de fi de mes que ja feien servir `afegeixMesos`/l'antiga `properaDataLiquidacio`) i `estimaLiquidacioTargeta(moviments, diaLiquidacio, avui?)` (exportada): suma tots els moviments (amb signe — una devolució redueix el total) de cada un dels 3 últims cicles complets, en descarta els buits, i calcula la mediana dels totals amb dades com a estimació (`importEstimatCents`, amb `importMinCents`/`importMaxCents` del rang i `confianca` proporcional al nombre de cicles usats sobre 3). Retorna `null` si hi ha menys de 2 cicles amb dades. `isoAvui` (abans privada) ara s'exporta perquè `db/operations.ts` la reutilitzi.
- `db/operations.ts` (`detectaCandidatsRecurrents`): torna a limitar el motor de detecció per patrons **només a compte corrent** (com abans de la primera versió de la 3.5). Per a cada targeta amb `diaLiquidacio` configurat, s'hi afegeix (com a molt) un únic candidat agregat amb concepte fix `"Liquidació estimada de targeta"` (no depèn de l'àlies, perquè la clau de "ja decidit" no es desvinculi si l'usuari el renomena) i `periodicitat='mensual'`. La funció accepta ara un paràmetre opcional `avui` (per defecte la data real), passat també a `detectaRecurrents` per a la part de compte corrent, perquè tots dos càlculs siguin testejables de manera determinista.
- Cap canvi de frontend: `RecurrentsCandidatsList`/`RecurrentsList` ja mostraven qualsevol candidat de manera genèrica (concepte, compte, import, rang al `title` de "Detecció"), i ja marquen "aprox." per defecte quan `importMinCents !== importMaxCents` (sempre cert per a una estimació agregada).

Tests: `recurrenceDetection.test.ts` substitueix els 6 tests de `properaDataLiquidacio` per 8 de `estimaLiquidacioTargeta` (mitjana de 3 cicles, mínim de 2, `null` amb menys d'1, `null` sense moviments, inclusivitat dels límits de cicle, suma amb signe d'una devolució, clamp de fi de mes curt, comportament per defecte amb la data real) — 26 tests en total. `operations.test.ts`: nou bloc de 4 tests per al comportament agregat (crea un únic candidat amb prou història, no en crea cap sense `diaLiquidacio`, no torna a sortir un cop confirmat, no afecta la detecció per patrons de compte corrent) — 82 tests, 208 en total backend.

Validat contra l'històric real (només lectura, sense tocar cap servidor en marxa, script esborrat en acabar): les 3 targetes reals ara mostren cadascuna **un únic** candidat agregat (abans: desenes de candidats per comerç individual) — p. ex. una amb mitjana -783€/mes sobre 3 cicles amb confiança 100%; els 9 candidats de compte corrent (Nòmina, Netflix, Som Energia, etc.) es mantenen intactes.

### 2026-07-12 — Sub-fase 3.5: recurrents de targeta

Cinquena sub-fase de la Fase 3 (especificacio.md 3.2.1, 4.1): el motor de detecció ja analitza també moviments de targeta (abans exclosos explícitament des de la 3.3), i la seva "propera data prevista" reflecteix quan afecta realment la tresoreria — la propera liquidació al compte corrent, no la propera data de càrrec a la targeta mateixa.

Abans d'implementar es va confirmar el criteri exacte per calcular la propera liquidació: el primer `diaLiquidacio` de mes que sigui igual o posterior a la data del proper càrrec (si el dia de liquidació d'aquest mes ja ha passat, es passa al mes següent).

- `lib/recurrenceDetection.ts`: nova `properaDataLiquidacio(dataCarrec, diaLiquidacio)`, pura — clampa el dia al final de mes si cal (mateix criteri que `afegeixMesos`).
- `db/operations.ts` (`detectaCandidatsRecurrents`): ja no filtra per `tipus === 'corrent'` — analitza moviments de qualsevol compte (com que `AccountType` només és `corrent`/`targeta`, deixa de caldre cap filtre per tipus). Per a un candidat el compte del qual és una targeta **amb liquidació configurada** (`compteLiquidacioId` + `diaLiquidacio`), es recalcula `dataPrevista` amb `properaDataLiquidacio`; una targeta sense liquidació configurada manté el comportament antic (data del proper càrrec a la targeta) — no hi ha prou informació per calcular-ne la liquidació real. El `compteId` del candidat es manté el de la targeta.
- Cap canvi de frontend calia: la UI ja mostrava qualsevol tipus de compte de manera genèrica (`compteAlias.get(c.compteId)`).

Tests: 6 nous a `recurrenceDetection.test.ts` per `properaDataLiquidacio` (mateix mes, el mateix dia del càrrec compta, canvi de mes, canvi d'any, clamp de mes curt, clamp en canviar de mes) — 24 tests en total. A `operations.test.ts`: nou bloc de 4 tests per al comportament de liquidació (amb/sense `compteLiquidacioId`/`diaLiquidacio` configurats, i que no afecta un candidat de compte corrent), construïts amb dates relatives a "ara" (no fixes de 2026) perquè siguin deterministes independentment de quin dia real s'executi la suite; 2 tests antics actualitzats (l'antic "excludes targeta movements" ara verifica el contrari). 206 tests backend en total.

Validat contra l'històric real (només lectura, `DatabaseSync` readOnly, sense tocar cap servidor en marxa, script esborrat en acabar): **17 candidats detectats** (abans 0 de targeta), incloent-hi patrons setmanals/mensuals reals de supermercats i botigues (BON AREA, LIDL, forn, SUPERMERCAT BON PREU) amb la data de liquidació correctament calculada — p. ex. un càrrec cru del 12/07 amb liquidació el dia 5 salta correctament a l'agost (ja que el 5 de juliol ja havia passat).

### 2026-07-12 — Bug: el requadre d'edició de Referència es veia tallat

L'usuari va detectar que, en editar el camp Referència, el requadre no es veia sencer. Causa: un `<input>` HTML és `content-box` per defecte, així que `width: '100%'` fet servir sense `boxSizing: 'border-box'` es sumava al padding/border propis de l'input, sobreeixint de la cel·la — que té `overflow: hidden` (via `amplaFixa`) — i tallant visualment el requadre. Afectava per igual el camp Concepte, encara que no s'hagués reportat.

- `lib/recurrentsTable.ts`: nou `inputCompletCella` (`{ width: '100%', boxSizing: 'border-box' }`), font única per a qualsevol input que hagi d'omplir tota la cel·la.
- Aplicat als camps Concepte i Referència a `RecurrentsList.tsx`, `RecurrentsCandidatsList.tsx` i `RecurrentManualForm.tsx` (6 llocs en total).

`tsc -b`/`oxlint`/`vite build` nets.

### 2026-07-12 — Recurrents: tercer ajust, Referència a 125px

`lib/recurrentsTable.ts`: `cellReferencia` de 110px a 125px (les altres columnes sense canvis respecte a l'entrada anterior).

### 2026-07-12 — Moviments: filtre per Transferències internes, i vista per defecte dels últims 60 dies

Dues millores demanades a la pàgina de Moviments:

- **Filtre "TI"**: nou desplegable (Totes / Només TI / Sense TI) que filtra pel booleà `esTransferenciaInterna` — abans la columna TI es podia marcar/desmarcar però no es podia filtrar.
- **Vista per defecte dels últims 60 dies**: `dataDes` ja no comença buit (mostrant tot l'històric) sinó `avui() - 60 dies`; nou desplegable "Interval" amb els presets Últims 15/30/60/90 dies (60 per defecte) que, en triar-lo, recalcula `dataDes` a `avui() - N dies` i buida `dataFins` (sense límit superior). Els camps "Des de"/"Fins a" continuen disponibles per a un rang personalitzat, independent del desplegable.
- `lib/dates.ts`: nova `faDiesAbans(iso, dies)` — mateix criteri que `avui()` (getters locals, no `toISOString()`, per evitar el bug de fus horari ja documentat). 3 tests nous (36 tests frontend en total).

`tsc -b`/`oxlint`/`vite build` nets. Sense verificació clic a clic en un navegador real (no hi ha eina de navegador disponible en aquesta sessió).

### 2026-07-12 — Recurrents: segon ajust de mides de columna + requadre de Referència a amplada completa

Segon ajust d'amplada sobre `lib/recurrentsTable.ts`, demanat directament en píxels: Data/Data fi a 125px, Categoria a 175px, Referència a 110px (Compte/Periodicitat/Import/Origen sense canvis).

- `import/RecurrentsList.tsx` i `import/RecurrentsCandidatsList.tsx`: el requadre d'edició de Referència tenia una amplada fixa de 80px que ja no s'ajustava a la nova amplada de columna — canviat a `width: '100%'` (mateix criteri que Concepte i que ja feia servir `RecurrentManualForm`), així sempre omple la cel·la independentment de futurs ajustos d'amplada.

`tsc -b`/`oxlint`/`vite build` nets.

### 2026-07-12 — Recurrents: mides de columna ajustades i el formulari manual també en taula

Ajustos concrets d'amplada demanats per l'usuari sobre `lib/recurrentsTable.ts` (font única de les tres seccions):

- Compte, Periodicitat, Import i Origen/Detecció: es mantenen a la mida actual.
- Data i Data fi: +20% (95px -> 114px).
- Categoria: +25% (120px -> 150px).
- Referència: +20% (90px -> 108px).
- Concepte: sense amplada fixa (abans tenia un `maxWidth: 220` que la limitava) — ara absorbeix tot l'espai que deixen lliure la resta de columnes fixes, com demanava l'usuari ("mida variable en funció de les altres columnes").

`import/RecurrentManualForm.tsx` (formulari d'afegir un recurrent manualment) es converteix en una taula d'una sola fila amb exactament les mateixes columnes i amplades que `RecurrentsList`/`RecurrentsCandidatsList` (Compte, Periodicitat, Data, Data fi, Concepte, Import, Categoria, Referència), en lloc de la fila d'etiquetes en línia que tenia abans. La columna "Origen" hi mostra el text fix "Manual" (informatiu, no editable, ja que un recurrent creat des d'aquest formulari sempre té `origen=manual`).

`tsc -b`/`oxlint`/`vite build` nets.

### 2026-07-12 — Recurrents: Periodicitat després de Compte, i amplades de columna equivalents entre taules

- `lib/recurrentsTable.ts` (nou): estils de columna compartits (`cellCompte`, `cellPeriodicitat`, `cellData`, `cellConcepte`, `cellImport`, `cellCategoria`, `cellOrigen`, `cellReferencia`, `cellAccions`) amb amplada fixa (`width`/`minWidth`/`maxWidth`), mateix patró `amplaFixa` que ja fa servir `MovimentsList.tsx`. Font única perquè `RecurrentsList` i `RecurrentsCandidatsList` no puguin divergir en amplada columna a columna.
- Ordre de columnes a totes dues taules: Compte, **Periodicitat**, Data, Data fi, Concepte, Import, Categoria, Origen/Detecció, Referència, accions (abans Periodicitat anava després d'Import).

`tsc -b`/`oxlint`/`vite build` nets.

### 2026-07-12 — Dates dels recurrents en format dd/mm/aaaa (spec secció 2)

Les dates de text pla a les taules de recurrents es mostraven en format ISO (`2026-08-05`) en lloc de la convenció espanyola (`05/08/2026`) que ja fa servir la resta de l'aplicació (`formatDateEs`, `lib/dates.ts`) — un descuit d'aquesta funcionalitat nova, no un canvi de comportament nou.

- `import/RecurrentsList.tsx`: columnes "Data" i "Data fi" de la fila de només lectura.
- `import/RecurrentsImportWizard.tsx`: columna "Venciment" de la previsualització abans de confirmar.
- Els `<input type="date">` (formularis d'edició/candidats/creació des de Moviments) no es toquen — el seu `value` ha de seguir sent ISO (`yyyy-mm-dd`) per l'estàndard HTML; el navegador ja mostra el selector de data en el format local de l'usuari automàticament.

`tsc -b`/`oxlint`/`vite build` nets.

### 2026-07-12 — Bug: alguns candidats mostraven una data passada com a "propera"

L'usuari va detectar que la "propera data prevista" d'alguns candidats era anterior a avui. Causa: `analitzaGrup` calculava la propera ocurrència com "última ocurrència real + 1 període", sense tenir en compte si feia temps que no arribaven moviments nous d'aquest concepte — si l'última ocurrència era, per exemple, de fa 4 mesos, "+1 mes" seguia quedant al passat.

- `lib/recurrenceDetection.ts`: nova `properaOcurrencia(ultimaData, periodicitat, avui)` — avança període a període (no només un cop) fins que la data ja no queda en el passat respecte a `avui`. `detectaRecurrents` accepta ara un segon paràmetre opcional `avui` (per defecte la data real, `isoAvui()`), pensat perquè els tests puguin fixar una data de referència determinista en lloc de dependre del rellotge real.
- Tests existents a `recurrenceDetection.test.ts` actualitzats per fixar `avui` a una data anterior a totes les dates sintètiques (`AVUI = '2000-01-01'`), evitant que passin a dependre silenciosament de la data real del sistema; 4 tests nous específics per a aquest comportament (avança un sol període quan ja és futur, avança diversos períodes quan fa mesos, i el paràmetre per defecte amb la data real). 195 tests backend en total.
- Verificat també per HTTP contra un servidor i dades temporals: 3 moviments mensuals de gener-març reproduïen exactament el bug (candidat amb propera data a l'abril, ja passada avui); amb la correcció surt a l'agost.
- **Limitació explícita**: això només afecta candidats detectats (recalculats a cada crida). Un recurrent ja confirmat amb una `dataPrevista` desfasada no es corregeix sol — veure "Pendent".

### 2026-07-12 — Candidats i confirmats ordenats per compte, amb el mateix format de columnes

Feedback de l'usuari: els candidats detectats (targetes independents amb etiquetes en línia) i els recurrents confirmats (taula) no compartien format, i cap dels dos estava ordenat per compte.

- `import/RecurrentsList.tsx`: ordenació ara per (àlies del compte, data prevista) en lloc de només data prevista.
- `import/RecurrentsCandidatsList.tsx`: reescrit com a taula amb exactament les mateixes columnes que `RecurrentsList` (Compte, Data, Data fi, Concepte, Import, Periodicitat, Categoria, Referència, accions), mateixa ordenació per (compte, data). La columna "Origen" es substitueix per "Detecció" (nombre d'ocurrències i confiança, amb el rang d'import complet en el `title`) ja que un candidat encara no té un origen persistit. S'hi afegeix també un camp de Referència (abans no existia per a candidats) perquè es pugui omplir abans de confirmar, aprofitant que `confirmaCandidatRecurrent` ja acceptava aquest camp.
- Seguit immediat: l'usuari ha demanat que la columna "Compte" sigui la primera (abans anava després de l'import) a totes dues taules — ja aplicat a la llista de dalt.

`tsc -b`/`oxlint`/`vite build` nets. Sense verificació clic a clic en un navegador real (no hi ha eina de navegador disponible en aquesta sessió).

### 2026-07-12 — Crear un recurrent directament des de la pàgina de Moviments

L'usuari va demanar poder crear un recurrent sense haver de canviar de pestanya quan veu un càrrec/ingrés recurrent a la llista de Moviments.

- `views/MovimentsList.tsx`: nou botó "R" a la columna d'accions (al costat de "X" d'eliminar; `cellElimina` passa de 28 a 52px per encabir-los tots dos), que obre una fila de formulari inline sota el moviment — mateix patró ja existent per a "afegeix una regla de categorització" (`obreFormRegla`/`tancaFormRegla`). El formulari es preomple amb les dades del moviment (compte, concepte, import, data, categoria) i permet corregir periodicitat (per defecte "mensual"), import/aproximat, data prevista, data de finalització opcional, categoria i referència abans de desar amb `creaRecurrentManual` (ja existent des de la 3.1, reaprofitat tal qual).
- No calen canvis de backend — és només un altre punt d'entrada cap a la mateixa operació que ja fa servir el formulari manual de la pestanya "Recurrents".

`tsc -b`/`oxlint`/`vite build` nets. Sense verificació clic a clic en un navegador real (no hi ha eina de navegador disponible en aquesta sessió).

### 2026-07-12 — Recurrents: indicador d'import aproximat, data de finalització opcional, i presentació a tota l'amplada

Feedback de l'usuari gestionant recurrents: calia distingir un import cert (factura, ingrés fix) d'un d'estimat (patró detectat amb variació entre ocurrències), poder marcar una data de finalització opcional, i la pàgina hauria d'aprofitar l'amplada del monitor amb la mateixa mida de font que Moviments (que anava amb `fontSize: '0.9em'` en lloc dels `12` que fa servir `MovimentsList.tsx`, i limitada als mateixos 1000px que la resta de pestanyes).

- **Migració `006_recurrents_aproximat_data_fi.sql`**: dues columnes noves a `recurrents`, `import_aproximat INTEGER NOT NULL DEFAULT 0` i `data_fi TEXT` (opcional).
- **`db/types.ts`**: `Recurrent.importAproximat: boolean` i `Recurrent.dataFi?: string`.
- **`db/operations.ts`**: `DadesRecurrent` (creació/confirmació) accepta ara `importAproximat` (per defecte `false`) i `dataFi`; `actualitzaRecurrent` els pot corregir tots dos (`dataFi: null` l'esborra); `exportaCopiaSeguretat`/`importaCopiaSeguretat` actualitzats per no perdre'ls en una còpia de seguretat. Les factures importades (3.2) sempre queden com a import cert (`importAproximat=false`) — són valors ja coneguts, mai una estimació.
- **Frontend**: `RecurrentsCandidatsList` marca la casella "aprox." per defecte quan el candidat detectat té `importMinCents !== importMaxCents` (rang variable), però l'usuari la pot desmarcar/marcar abans de confirmar; `RecurrentManualForm` i `RecurrentsList` (edició in-line) hi afegeixen els mateixos dos camps. La llista mostra l'import amb un prefix "≈" quan és aproximat.
- **Presentació**: `App.tsx` treu el límit de 1000px també per a la pestanya "Recurrents" (`amplariMaxima`, com ja feia "Moviments"); totes les taules i formularis de recurrents passen de `fontSize: '0.9em'` a `fontSize: 12`, igual que `MovimentsList.tsx`.

3 tests nous a `operations.test.ts` (191 en total): valors per defecte, creació amb els camps nous, actualització i esborrat de `dataFi` amb `null`. Verificat també per HTTP contra un servidor i dades temporals (crear amb `importAproximat`/`dataFi`, PATCH per netejar `dataFi` i desmarcar `importAproximat`). `tsc -b`/`oxlint`/`vite build` nets a totes dues bandes.

### 2026-07-12 — Bug: un candidat ignorat apareixia a la llista de "Recurrents confirmats"

L'usuari va detectar que, en ignorar un candidat detectat, aquest apareixia igualment a la llista de "Recurrents confirmats" — quan hauria de quedar invisible (l'`estat='ignorat'` només ha d'evitar que el motor de detecció el torni a suggerir, com ja fan les transferències internes descartades, mai mostrar-se enlloc de la UI).

Causa: `ignoraCandidatRecurrent` (3.4) sí que desa la fila amb `estat='ignorat'` correctament, però `RecurrentsManager.tsx` passava tots els resultats de `listRecurrents()` (confirmats **i** ignorats) directament a `RecurrentsList`, que no filtrava per `estat` — el backend sempre ha estat correcte, el bug era només de presentació al frontend.

Fix: `views/RecurrentsManager.tsx` filtra ara `recurrents.filter((r) => r.estat === 'confirmat')` abans de passar-los a `RecurrentsList`. La fila ignorada segueix existint a la base de dades (necessari per no tornar-la a suggerir) però ja no es mostra enlloc — mateix comportament que una transferència descartada. No hi ha (encara) cap manera de desfer un "ignorar" des de la UI; si cal, s'hauria d'eliminar directament de la base de dades o afegir-hi una funcionalitat pròpia.

### 2026-07-12 — Sub-fase 3.4: pantalla de revisió/confirmació unificada de recurrents

Quarta i última sub-fase (per ara) de la Fase 3: pantalla que tanca el cicle — candidats detectats (3.3), compromisos manuals/importats (3.1/3.2) —, amb accions de confirmar (amb correccions), ignorar, editar i eliminar (especificacio.md 4.1.5).

Backend:

- `db/operations.ts`: `creaRecurrentManual` refactoritzat sobre un helper compartit `inserirRecurrent(dades, origen, estat)`; noves `confirmaCandidatRecurrent` (origen='detectat', estat='confirmat' — l'usuari pot haver corregit periodicitat/import/data/categoria abans de confirmar; la confiança i el rang d'import del candidat no es persisteixen, són només senyals de revisió) i `ignoraCandidatRecurrent` (origen='detectat', estat='ignorat', sense necessitat de cap correcció). Nova `actualitzaRecurrent(id, dades parcials)` per corregir qualsevol recurrent ja existent (manual, importat o confirmat), recalculant `concepteNormalitzat` si el concepte canvia.
- `routes.ts`: `POST /api/recurrents/candidats/confirma`, `POST /api/recurrents/candidats/ignora`, `PATCH /api/recurrents/:id`.

Frontend — nova pestanya **"Recurrents"** (abans la importació/llistat de compromisos vivia sota "Importar"; decisió presa sense preguntar explícitament, veure "Pendent"):

- `views/RecurrentsManager.tsx`: composa les quatre peces i en centralitza el `refresh` (recarrega tant `listRecurrents` com `detectaCandidatsRecurrents` després de qualsevol acció).
- `import/RecurrentsCandidatsList.tsx` (nou): un bloc per candidat amb ocurrències/rang/confiança, i un mini-formulari per corregir concepte/periodicitat/import/data/categoria abans de "Confirmar", o "Ignorar" directament amb els valors detectats.
- `import/RecurrentManualForm.tsx` (nou): formulari per afegir un recurrent que el motor no ha vist (spec 4.1.5), reaprofitant `creaRecurrentManual` (ja existent des de la 3.1, mai exposat abans a la UI).
- `import/RecurrentsList.tsx`: ampliat amb edició in-line (periodicitat, import, data, categoria, referència, concepte) via `actualitzaRecurrent`, a més de l'eliminació que ja tenia.
- `lib/periodicitat.ts` (nou): etiquetes i llistes ordenades de periodicitats, compartides pels tres formularis.
- Els imports d'euros a cèntims es fan amb `<input type="number">` (valor sempre amb punt decimal segons l'estàndard HTML, independent de la configuració regional del navegador) — primera vegada que la UI necessita convertir un import introduït a mà, no un de parsejat.

Verificació: 15 tests backend nous (188 en total): `confirmaCandidatRecurrent`/`ignoraCandidatRecurrent` (creació, correccions, que deixin de sortir com a candidat, error de compte inexistent) i `actualitzaRecurrent` (actualitza camps i `concepteNormalitzat`, esborra un camp opcional amb `null`, error de recurrent/categoria inexistent). `tsc -b`/`oxlint`/`vite build` nets a totes dues bandes. Flux sencer verificat per HTTP contra un servidor i dades temporals: sembrar moviments mensuals reals via `/importacio/confirma`, veure el candidat a `/recurrents/candidats`, confirmar-lo amb un import corregit i comprovar que desapareix de candidats i apareix a `/recurrents`, editar-lo per PATCH, sembrar un segon patró i ignorar-lo (desapareix de candidats però queda desat amb `estat=ignorat`), i crear-ne un de manual.

### 2026-07-12 — Sub-fase 3.3: motor de detecció de periodicitat

Tercera sub-fase de la Fase 3: motor pur de detecció de recurrents sobre l'històric real (especificacio.md 4.1), sense persistència ni UI encara (arriben a la 3.4). Abans d'implementar es van preguntar tres decisions que afectaven directament la qualitat de la detecció:

- **Mínim d'ocurrències per proposar un candidat**: 3 per a periodicitats curtes (setmanal..trimestral), només 2 per a semestral/anual (amb poc històric és possible que encara no n'hi hagi una tercera).
- **Tolerància d'import per agrupar rebuts variables**: ±15%, tal com suggereix l'especificació.
- **Abast**: només moviments de compte corrent per ara; els de targeta queden fora fins que la 3.5 resolgui com relacionar-los amb la data de liquidació real (si no, la data prevista d'un candidat de targeta seria enganyosa).

Implementació:

- `lib/concept.ts`: `normalizeConceptForRecurrence` (spec 4.1.1) — a més de la normalització de deduplicació, elimina també seqüències de 4+ dígits (números de referència/rebut variables: "RECIBO ENDESA REF 0012345" i "...0012399" agrupen igual), deliberadament **no** reutilitzada per `normalizeConceptForDedup` (col·lapsar-hi referències trencaria la unicitat del hash d'un moviment).
- `lib/recurrenceDetection.ts` (`detectaRecurrents`, pura, sense IO): agrupa per (compte, concepte normalitzat per a recurrència, signe); com a criteri secundari (spec 4.1.2), descarta de cada grup les ocurrències l'import de les quals s'allunya més del ±15% de la mediana (probablement un moviment no relacionat amb el mateix concepte); calcula els intervals entre les ocurrències restants i els classifica amb tolerància (setmanal 7±2, mensual 30±4, bimestral 60±6, trimestral 91±7, semestral 182±10, anual 365±15 — només setmanal i mensual venien fixades a l'especificació, la resta és una extrapolació d'aquesta sub-fase, ajustable); calcula la propera data prevista afegint mesos de calendari (preservant el dia del mes, clampat al final de mes si cal — p. ex. 31/01 + 1 mes -> 28/02) o dies (setmanal); confiança 0-100 combinant nombre d'ocurrències i regularitat dels intervals (heurística v1, documentada com a tal).
- `db/operations.ts` (`detectaCandidatsRecurrents`): només moviments de comptes de tipus corrent, exclosos `esTransferenciaInterna` i `movimentOrigenId` (contrapartides de liquidació — cap dels dos és consum real); un candidat no es torna a mostrar si ja hi ha un recurrent confirmat o ignorat pel mateix (compte, concepte, signe) — comparació recalculant `normalizeConceptForRecurrence` sobre el `concepte` cru de cada recurrent existent, no sobre el seu `concepteNormalitzat` desat (aquest ve de la normalització de deduplicació, més estricta, de la 3.1/3.2, i no coincidiria).
- `routes.ts`: `GET /api/recurrents/candidats` — recalcula en cada crida, no persisteix res.

**Validació contra l'històric real** (lectura només, seguint el mateix mètode que altres bugs d'aquest projecte: script propi amb `DatabaseSync(..., {readOnly: true})` contra `dades/finances.db`, sense tocar cap servidor en marxa ni escriure res, esborrat en acabar): sobre 544 moviments de compte corrent (exclosos transferències/contrapartides), **23 candidats detectats**, incloent-hi subministraments reals (Som Energia, GURBTEC Telecom), assegurances (Securitas Direct), una quota de finançament (RCI Banque), comissions bancàries recurrents, i Netflix (detectat, tot i que com dos patrons separats perquè el concepte varia entre "Pago en Netflix.com" i "Pago en NETFLIX.COM MADRID ES" — la normalització difusa actual només elimina números, no unifica variants textuals del comerç; limitació coneguda, a revisar si cal). Cap "NÒMINA" ni "HIPOTECA"/"LLOGUER" explícits en aquest històric concret — el candidat d'import més alt i regular (~1.117-1.248€/mes, confiança 88) sembla un ingrés recurrent d'empresa, però la classificació de què és "nòmina" o "lloguer" és cosa de l'usuari a la pantalla de revisió (3.4), no de l'algorisme.

Tests: 14 a `recurrenceDetection.test.ts` (nòmina/lloguer sintètics, rebut variable, agrupació per referència, setmanal, anual amb 2 ocurrències, mínim d'ocurrències, exclusió d'un import outlier, intervals irregulars sense classificar, comptes diferents no es barregen, ingrés/despesa amb el mateix concepte no es barregen, imports a zero ignorats, clamp de fi de mes, ordre de sortida), 4 a `concept.test.ts`, 7 a `operations.test.ts` (inclou el cas real de conciliar la normalització estricta desada amb la difusa recalculada). 179 tests backend en total.

### 2026-07-12 — Sub-fase 3.2: importació de compromisos confirmats (Excel)

Segona sub-fase de la Fase 3: flux complet d'importació del format acordat a especificacio.md §4.2 (Data de venciment / Concepte / Import obligatoris, Categoria / Referència opcionals), un compte per importació, amb previsualització abans de confirmar — mateix patró UX que la importació bancària (3.1).

Backend:
- `parsers/recurrentsFile.ts`: `parseRecurrentsFile` reaprofita `locateColumns`/`cellToText` de `tableUtils.ts` (detecció de capçalera per text, tolerant a un preàmbul de files, com la resta de parsers) i `parseFlexibleDate`/`parseAmountToCents` ja existents. Files en blanc s'ignoren; files no interpretables (data o import invàlids, concepte buit) es reporten com a avís sense aturar la resta del lot — mateixa filosofia que `extractMovimentsFromTable`.
- `dedup/recurrents.ts`: `splitNousRecurrentsIDuplicats`, mateixa política que `splitNousIDuplicats` (spec 3.3): dedup només contra ids d'una importació anterior del mateix compte, mai dins del mateix lot — dues factures coincidentment idèntiques (mateixa data/import/concepte) al mateix fitxer reben un sufix `-2`/`-3` en lloc de descartar-se.
- `db/operations.ts`: `importaRecurrents(compteId, parsed)` — valida el compte, aplica el dedup, resol `categoriaNom` a `categoriaId` per coincidència de nom insensible a majúscules (sense match, es queda sense categoria, no és un error), insereix amb `periodicitat='unica'`, `origen='importat'`, `estat='confirmat'`. Backup abans d'escriure, no toca la base de dades si tot són duplicats.
- `routes.ts`: `POST /api/recurrents/importacio/previsualitza` (multipart, només parseja), `POST /api/recurrents/importacio/confirma` (`{compteId, recurrents}` → `{nous, duplicats}`).
- Decisió d'abast: **no s'ha creat cap concepte de "lot"/desfer** per a aquesta importació (a diferència de la bancària) — cada fila és un `recurrent` independent, ja eliminable individualment des de la 3.1. Es pot revisar si l'ús real ho demana.

Frontend:
- `import/RecurrentsImportWizard.tsx`: selecció de compte (desplegable d'existents, sense opció de crear-ne un de nou — un compromís sempre és sobre un compte ja existent), input de fitxer, taula de previsualització (primeres 15 files) amb avisos, botó de confirmació i resum final.
- `import/RecurrentsList.tsx`: llistat de consulta dels recurrents ja confirmats (manuals o importats) amb eliminació individual — no és encara la pantalla de revisió de candidats detectats (això és 3.4); només tanca el cicle de "veure què s'ha importat".
- Totes dues muntades a la pestanya "Importar" existent, sota la importació bancària.
- `api/types.ts`/`api/client.ts`: tipus i funcions per a tot l'anterior; `Backup` (frontend) ara inclou `recurrents` — s'havia quedat curt a la 3.1 perquè aquella sub-fase no tocava cap tipus de frontend.

Verificació: 22 tests backend nous (153 en total: 8 a `recurrentsFile.test.ts`, 6 a `dedup/recurrents.test.ts`, 8 a `operations.test.ts`), `tsc -b`/`oxlint`/`vite build` nets a totes dues bandes, i flux sencer verificat per HTTP (previsualitzar + confirmar + reimportar per comprovar el dedup + error de compte inexistent + inclusió a `/api/backup`) amb un `.xlsx` real generat amb la mateixa llibreria `xlsx`, contra un servidor i dades temporals. **Sense verificació clic a clic en un navegador real** (no hi ha eina de navegador disponible en aquesta sessió).

### 2026-07-12 — Sub-fase 3.1: model de dades unificat de recurrents (backend)

Primera sub-fase de la Fase 3 implementada, seguint el pla acordat a l'entrada anterior. Abans d'escriure codi es van preguntar explícitament tres decisions de disseny que afectaven l'esquema:

- **Deduplicació dels compromisos importats**: igual que els moviments bancaris, id determinista = hash(compte, data de venciment, import, concepte normalitzat) — `computeRecurrentHash` a `lib/hash.ts` (seed propi, mai col·lideix amb `computeMovimentHash`/`computeContrapartidaId`). Reimportar el mateix fitxer de factures no duplicarà files (la lògica d'importació pròpiament dita és de la sub-fase 3.2; aquesta sub-fase només deixa la funció de hash preparada).
- **Relació amb la detecció automàtica (3.3)**: els compromisos manuals/importats NO alimenten el motor de detecció de patrons — són sempre entrades independents/soltes. Més senzill i predictible.
- **Fi de vigència d'un recurrent confirmat**: eliminació directa (sense soft-delete), coherent amb la resta de l'app.

Implementació:

- `backend/src/db/migrations/005_recurrents.sql`: taula `recurrents` (`compte_id`, `concepte`, `concepte_normalitzat`, `periodicitat`, `import_cents`, `data_prevista`, `categoria_id`, `referencia`, `origen`, `estat`) + índexs per compte/data/categoria. Cap `CHECK` constraint a l'esquema (coherent amb la resta de taules: la validació de valors permesos viu als tipus TS, no a SQLite).
- `db/types.ts`: `Recurrent` + tipus literals `PeriodicitatRecurrent` (inclou `unica`, per a un venciment puntual no repetitiu), `OrigenRecurrent` (`detectat`/`manual`/`importat`), `EstatRecurrent` (`confirmat`/`ignorat` — `suggerit` mai es persisteix; un candidat detectat i encara no revisat es recalcularà en calent a la sub-fase 3.3/3.4).
- `db/operations.ts`: `listRecurrents`, `creaRecurrentManual` (origen sempre `manual`, estat sempre `confirmat`; valida que el compte i, si s'indica, la categoria existeixin), `eliminaRecurrent`. Integrat a `exportaCopiaSeguretat`/`importaCopiaSeguretat` (amb `?? []` per compatibilitat amb còpies antigues) i a `reinicialitzaBaseDades` (neteja `recurrents` en el reset complet). **No** s'ha tocat `eliminaTotsElsMoviments`: els recurrents no deriven dels moviments, així que eliminar-los tots no n'ha d'esborrar cap.
- `routes.ts`: `GET/POST /api/recurrents`, `DELETE /api/recurrents/:id`.
- Tests nous: 6 a `hash.test.ts` (`computeRecurrentHash`) + 9 a `operations.test.ts` (creació manual, `unica` amb categoria/referència, validacions, eliminació, roundtrip de còpia de seguretat, `reinicialitzaBaseDades`, `eliminaTotsElsMoviments` sense efecte) — 131 tests backend en total. Verificat també amb `tsc -b` i, manualment, arrencant el servidor contra una base de dades temporal i exercint els tres endpoints nous per HTTP (crear, llistar, esborrar, error de compte/categoria inexistents, inclusió a `/api/backup`).
- **Sense UI encara** — aquesta sub-fase és només model + API. La pantalla per crear/veure recurrents arriba amb les sub-fases 3.2 (importació) i 3.4 (revisió/confirmació).

### 2026-07-12 — Fase 3 (recurrents): pla de sub-fases acordat i documentat a `especificacio.md`

L'usuari ha confirmat iniciar la Fase 3 i ha demanat fer-ho per sub-fases, més una necessitat nova no prevista a l'especificació original: per a alguns comptes cal poder introduir ingressos/despeses **ja confirmats** (import i data de venciment coneguts amb certesa, p. ex. factures de proveïdor), no només recurrents detectats per patró.

- Model proposat: unificar-ho amb l'entitat `recurrents` — un compromís pot tenir `origen` detectat/manual/importat i `periodicitat` que inclou «única» (venciment puntual no repetitiu). Els d'origen manual/importat entren directament com a confirmats.
- Format d'importació acordat amb l'usuari (preguntat explícitament): Excel (.xlsx), **un compte per importació** (com la importació bancària, no una columna de compte per fila). Columnes: Data de venciment, Concepte, Import (amb signe), Categoria (opcional), Referència (opcional).
- `especificacio.md` actualitzat: nova secció **4.2 Compromisos confirmats (importació de factures amb venciment conegut)** (l'antiga 4.2 "Motor de previsió" passa a ser 4.3); punt 3 de "Pla de fases" (secció 6) desglossat en sub-fases 3.1 a 3.6.
- Sub-fases acordades: 3.1 model de dades unificat, 3.2 importació de compromisos confirmats, 3.3 motor de detecció de periodicitat, 3.4 pantalla de revisió/confirmació unificada, 3.5 exclusions (transferències internes, contrapartides de liquidació) i cas de targetes, 3.6 disseny de la conciliació compromís↔moviment real (implementació ajornada a Fase 4).
- Cap línia de codi escrita encara; aquesta entrada només documenta l'acord de planificació. Following-up: atacar la 3.1.

### 2026-07-12 — Presentació a Moviments: les transferències internes ja no es mostren atenuades; la columna Liquidació s'atenua llevat de les marcades (i les contrapartides)

L'usuari va demanar dos ajustos visuals a la taula de Moviments, sense canvis de dades ni de lògica:

- Les files marcades com a transferència interna es mostraven amb `opacity: 0.6` (tota la fila en gris). Ara es mostren igual que la resta de moviments — l'usuari ho considerava massa atenuat per a un moviment normal i vàlid, no una anomalia.
- La columna "Liquidació" es mostra ara atenuada (`opacity: 0.5`) per defecte (cel·les buides i el selector "marca com a liquidació" d'un càrrec de compte corrent), **llevat** de: (a) les files que ja tenen una liquidació de targeta marcada (`m.esLiquidacioTargetaId`), i (b) les contrapartides automàtiques d'una liquidació (`m.movimentOrigenId`, el moviment de targeta generat automàticament) — totes dues es mostren amb opacitat normal, ja que representen una liquidació efectivament marcada (des de banda i banda de la relació origen/contrapartida).

`frontend/src/views/MovimentsList.tsx`: eliminat l'`style` condicional de la `<tr>` basat en `esTransferenciaInterna`; afegit `opacity: 0.5` condicional a la `<td>` de la columna Liquidació (atenuada llevat que `m.esLiquidacioTargetaId` o `m.movimentOrigenId` sigui present).

### 2026-07-11 — Bug de zona horària: les dates d'ING sortien un dia enrere (+ migració de l'històric)

L'usuari va observar una discrepància entre la data d'un extracte d'ING que importava i la data que sortia a la pàgina de Moviments (sempre un dia abans). Reproduït i confirmat amb una prova aïllada usant `xlsx` (la mateixa llibreria i configuració `cellDates:true` que fa servir `excelTable.ts`) en aquest mateix procés (Europe/Madrid): una cel·la de data real d'Excel es descodifica com un `Date` ancorat a la **mitjanit local** de la màquina que llegeix, no a la mitjanit UTC — `isoFromUTCDate` (ara `isoFromDateCell`) llegia els components amb `getUTC*`, que per a qualsevol fus per davant d'UTC (Madrid, sempre +1/+2) dona sistemàticament el dia anterior. Només ING es veu afectat: és l'únic banc el fitxer del qual arriba com a cel·la de data real d'Excel (BBVA i la resta fan servir text).

- `backend/src/lib/dates.ts`: `isoFromUTCDate` renombrada a `isoFromDateCell` i canviada per llegir amb `getFullYear`/`getMonth`/`getDate` (locals) en lloc de `getUTC*`. Com que la codificació i la descodificació passen pel mateix procés/màquina, els getters locals són correctes independentment de en quin fus horari s'executi el servidor.
- Tests actualitzats (`dates.test.ts`, `ing.test.ts`): les fixtures que simulaven una cel·la de data real ara construeixen el `Date` amb el constructor local (`new Date(y, m, d)`) en lloc de `Date.UTC(...)`, reflectint el comportament real de SheetJS.
- **Migració de l'històric**: el bug feia temps que hi era, així que **tots** els moviments d'ING ja importats (710, als 4 comptes ING-ES/ING-CC/ING-TG-JN/ING-TG-JA) tenien la data un dia enrere. Com que l'`id` de cada moviment és un hash que inclou la data, corregir només la data sense regenerar l'id hauria trencat la protecció de duplicats en reimportacions futures que se solapin amb aquest període. Es va escriure i executar un script de migració (`migrate-ing-dates.mts`, esborrat després d'aplicar-se — no forma part permanent del codi):
  - Pas 1: per a cada moviment real (no contrapartida) d'un compte ING, suma un dia a la data i recalcula l'id (`computeMovimentHash`). Com que diversos moviments legítimament idèntics dins del mateix lot poden compartir el mateix hash "pelat" (veure l'entrada següent sobre deduplicació), es reagrupen pel nou hash i se'ls reaplica el mateix conveni de sufix (`hash`, `hash-2`, `hash-3`...) ordenat per `seq`, evitant col·lisions de clau primària.
  - Pas 2: qualsevol contrapartida de liquidació (a qualsevol compte, no només ING, ja que l'origen i la targeta poden ser de bancs diferents) l'origen de la qual canviï d'id, recalcula la seva pròpia id (`computeContrapartidaId`) i data per seguir l'origen.
  - Pas 3/4: aplica els canvis i corregeix qualsevol referència penjada a l'id antic (`moviment_origen_id`, `transferencies_descartades`), a tota la base de dades.
  - Verificat primer contra una còpia (`VACUUM INTO`, per capturar correctament el WAL pendent) abans de tocar el fitxer real; comparat abans/després: mateix nombre total de moviments (1116), tots els ids distints, cap referència penjada, comptes no-ING totalment intactes (mateixos ids), i categoria/transferència/lot/seq preservats per a cada moviment migrat.
  - Còpia de seguretat manual presa abans de migrar (`dades/backups/finances-2026-07-11T19-58-36-944Z-premigraciodates.db`), a més de les automàtiques de l'aplicació.
  - Verificat després amb el servidor real (només peticions GET, sense escriure res): les dates carregades ja surten corregides.
  - **Efecte secundari positiu**: com que ara l'id del moviment de DIFERENTIA INNOVATION SL (20/02/2026, veure entrada de deduplicació) queda corregit a la data i l'id que un reimport fresc calcularia per a la primera ocurrència, **no cal eliminar-lo abans de reimportar** — reimportar el fitxer original reconeixerà la primera ocurrència com a duplicat (correcte) i afegirà les 2 que faltaven.
- `tsc -b`, `oxlint`, `vite build` i tots els tests nets a totes dues bandes.

### 2026-07-11 — La deduplicació ja no descarta moviments legítimament idèntics dins del mateix lot

L'usuari va detectar que 3 moviments reals amb la mateixa data, concepte i import (DIFERENTIA INNOVATION SL, 12,75€, 20/02/2026 -- típic de targeta, sense columna de saldo per distingir-los) només se'n va registrar un. Causa: l'id determinista (`hash(banc, compte, data, import, concepte, saldo posterior)`) surt idèntic per als tres, i `splitNousIDuplicats` descartava el 2n i 3r com a "duplicats" encara que fossin del mateix fitxer d'importació (era una limitació ja documentada al codi i a `especificacio.md` 3.3). L'usuari va demanar explícitament que, de cara a futures importacions, **la deduplicació no s'apliqui mai dins del mateix document**, només contra moviments d'una importació anterior.

- `backend/src/dedup/index.ts`: `splitNousIDuplicats` ja no manté un `seenInBatch` que descarta repeticions dins del lot. En canvi, cada hash repetit dins del mateix lot rep un sufix determinista segons l'ordre d'aparició al fitxer (`hash`, `hash-2`, `hash-3`...) -- necessari perquè `moviments.id` és clau primària: sense sufix, inserir dos moviments amb el mateix id faria fallar tot el lot per violació de clau primària. El primer manté el hash net (compatibilitat amb dades ja importades abans d'aquest canvi). Com que el sufix és determinista per ordre d'aparició, una reimportació íntegra del mateix fitxer torna a produir els mateixos ids sufixats i reconeix tot el grup com a ja existent, no només el primer.
- `backend/src/lib/hash.ts`: comentari actualitzat (la col·lisió del hash ja no és una "limitació residual" que perd dades, es resol al pas de deduplicació).
- `especificacio.md` 3.3: reescrit per reflectir que la deduplicació només compara contra importacions anteriors.
- Tests actualitzats a `dedup/index.test.ts`: substituït el test que documentava el comportament antic per dos de nous (tres moviments idèntics del mateix lot es mantenen tots tres, amb ids `hash`/`hash-2`/`hash-3`; una reimportació íntegra del mateix grup es reconeix sencera com a duplicada). 116 tests backend (abans 115).
- **Pendent d'acció de l'usuari**: aquest fix només evita el problema en futures importacions -- no recupera sol els 2 moviments que ja falten (com que el seu id ja existeix a la base de dades des de la importació original, reimportar el mateix fitxer els seguiria descartant). L'usuari eliminarà el moviment actual d'aquell dia/import/concepte i reimportarà el fitxer original de l'extracte perquè els 3 es carreguin correctament amb la lògica ja corregida.
- `tsc -b`, `oxlint` i `vite build` nets a totes dues bandes.

### 2026-07-11 — Segona correcció de l'ordre de moviments del mateix dia al saldo de targeta (lots d'una sola data)

L'usuari va detectar un altre cas del mateix problema (ING-TG-JA, 27/11/2025): el moviment de -63,15€ mostrava un saldo de -195,92 en lloc d'un valor petit i coherent. Investigant amb una consulta de només lectura, la causa era diferent de l'anterior: aquest lot d'importació conté **una sola data** (4 moviments, tots del 27/11 -- probablement una reimportació parcial on la deduplicació va descartar totes les files excepte les d'aquell dia). `inferDireccioLot` necessita com a mínim dues dates diferents dins del mateix lot per deduir la direcció (comparant el seq de la data més antiga contra el de la més recent); amb una sola data no hi ha cap senyal, i requeia sempre en "ascendent per defecte" — incorrecte per a aquest compte, el conveni real del qual (confirmat amb la resta del seu historial) és descendent.

- `frontend/src/lib/balance.ts`: `inferDireccioLot` renombrada a `inferDireccio` i ara retorna `0` (sense senyal) en lloc de forçar `1` quan el lot té una sola data. `creaSaldoAcumulatPerMoviment` agrupa els lots, calcula un vot (+1/-1) per cada lot amb senyal propi, i els lots sense senyal fan servir el vot majoritari de la resta de lots del mateix compte com a direcció per defecte (el conveni d'un fitxer és una propietat del banc/compte, no d'un lot concret aïllat).
- Arran d'això es va detectar un problema més profund: l'ordre de **visualització** a la taula (`MovimentsList.tsx`, comparador de `filtrats`) desempatava els moviments del mateix dia amb `seq` cru, independent d'aquesta lògica de direcció per lot -- així que, encara corregint el valor del saldo, la fila es podia seguir mostrant en una posició que no hi correspondria (els saldos tornarien a semblar desordenats llegint la columna de dalt a baix). S'ha extret `ordenaMovimentsTargeta` (únic lloc on es calcula aquest ordre) i s'ha exposat una nova `creaRangCronologicPerMoviment`, que la taula fa servir ara (`rangCronologicTargetaPerMoviment`, mateix patró que `saldoAcumulatTargetaPerMoviment`) per ordenar les files de targeta del mateix dia exactament amb el mateix criteri amb què s'ha calculat el seu saldo. La contrapartida automàtica d'una liquidació manté el seu propi mecanisme (situar-se just per sobre del càrrec que l'origina, veure l'entrada anterior), ara implementat com `clauOrdre(m)`: si `m` és una contrapartida, pren la clau del càrrec que l'origina (recursivament) per a totes les comparacions -- necessari per mantenir la transitivitat del comparador (un intent més senzill que usés el propi rang de la contrapartida en lloc del rang "prestat" del càrrec tornava a introduir el mateix bug de no-transitivitat que la correcció anterior ja havia resolt).
- Tests nous a `balance.test.ts`: reproducció exacta del bug real (lot d'una sola data que manlleva la direcció descendent de la resta del compte), un cas de control (cap lot amb senyal enlloc, es manté ascendent per defecte) i una comprovació que `creaRangCronologicPerMoviment` coincideix exactament amb l'ordre que fa servir `creaSaldoAcumulatPerMoviment`. 33 tests frontend (abans 30).
- Verificat contra les dades reals (només lectura, `dades/finances.db`, mai escrit): amb l'historial complet del compte ING-TG-JA carregat (tal com ho fa l'aplicació real, sense cap filtre de data en la consulta), el moviment de -63,15€ ara mostra saldo -63,15 (el primer del dia, com esperava l'usuari) en lloc de -194,92.
- **Seguiment**: després d'aquest fix l'usuari va confirmar que el valor de saldo ja sortia bé, però l'ordre de les files seguia "invertit" (el darrer moviment cronològic del dia hauria de sortir com a primera fila, i sortia com a última). Causa: el desempat per `rangCronologicTargetaPerMoviment` no es multiplicava per `dir` (asc/desc), a diferència del desempat pla per `seq` que ja hi havia abans (deliberadament fix, independent de `dir`, perquè per a comptes corrent l'ordre de visualització no altera cap valor mostrat). Amb targetes això ja no és cert: si el desempat es queda sempre "més antic primer" independentment de si la taula està ordenada per data ascendent o descendent, en ordenar per data descendent (la per defecte, més recent a dalt) es veu un patró en dents de serra -- les dates es succeeixen de més recent a més antiga, però dins de cada dia l'ordre va a l'inrevés. Ara `comparaParella` multiplica aquest desempat per `dir`, perquè la lectura sigui consistent en tota la taula (també dins d'un mateix dia); la relació de parella contrapartida↔càrrec es manté fixa, no es veu afectada. Verificat amb una simulació aïllada del comparador amb dades reals.

- `tsc -b`, `oxlint` i `vite build` nets.

### 2026-07-11 — Exportar els moviments mostrats a Excel (.xlsx), amb el mateix format que la pantalla

L'usuari ha demanat poder exportar els moviments de la pàgina de Moviments a una fulla d'Excel real (ja existia "Exportar CSV", però demanava explícitament un .xlsx binari amb els imports com a números, no com a text), i després que reproduís el mateix format que es veu a pantalla — la graella amb una columna Import/Saldo per cada compte seleccionat, no la llista plana d'una sola columna "Compte" que ja feia servir el CSV.

- Nova dependència de frontend: `xlsx` (SheetJS Community Edition, ^0.20.3).
- `frontend/src/views/MovimentsList.tsx`: nou botó "Exportar Excel" al costat d'"Exportar CSV". `exportaExcel()` reprodueix la graella tal com es veu a pantalla: Data, Concepte, Categoria, TI (Sí/No), Liquidació (només si hi ha targetes seleccionades, amb `liquidacioText(m)` — versió en text pla de `cellaLiquidacio`) i, per cada compte seleccionat, dues columnes (`{alias} - Import`, `{alias} - Saldo`) amb la mateixa lògica que la taula (`saldoPropiCents` per al propi compte, `consultaSaldoPerCompte` per als altres), amb els imports/saldos com a números (cèntims / 100) en lloc de text formatat. Les capçaleres de columna es mostren en un sol nivell (`"{alias} - Import"`) en lloc de les dues files amb cel·les combinades de la taula, per mantenir cada columna amb una capçalera única (més útil per filtrar/sumar a Excel). La llibreria es carrega amb `import('xlsx')` dinàmic (només en clicar el botó): és pesada (~330kB) i bundlar-la sempre hauria doblat la mida del chunk principal (590kB → 923kB); amb l'import dinàmic queda en un chunk separat que només es descarrega quan cal.
- L'exportació CSV es manté sense canvis (llista plana, una columna "Compte"). Extreta `saldoPropiCents(m)` (compartida per `exportaCSV` i `exportaExcel`): per a targetes, usa `saldoAcumulatTargetaPerMoviment` (el deute acumulat, ja que `saldoPosteriorCents` hi és sempre null) — de pas corregeix que l'exportació CSV de moviments de targeta sempre havia sortit amb la columna Saldo buida.
- Verificat generant un .xlsx real (incloent-hi cel·les buides intercalades amb números, com fa la graella real quan un compte no és el propi de la fila) amb les mateixes crides (`aoa_to_sheet`/`book_new`/`book_append_sheet`) i llegint-lo de nou (`XLSX.read` sobre el buffer) per confirmar que els números, els buits i els accents es conserven correctament.
- `tsc -b`, `oxlint`, `vite build` i els 30 tests frontend nets (sense tests nous: no hi ha tests de component per a `MovimentsList.tsx`).

### 2026-07-11 — Descartar un suggeriment de transferència interna

L'usuari ha demanat poder eliminar/descartar un suggeriment de transferència interna (falsa alarma: dos moviments de comptes propis que coincideixen per import/data però que no són realment una transferència). Com que el suggeriment es recalcula cada vegada amb una heurística sense estat (`suggereixTransferenciesInternes`, mateix import en valor absolut i signe oposat, ±2 dies), calia persistir el descart perquè no tornés a aparèixer en refrescar.

- Migració 004: taula `transferencies_descartades (id, moviment_a_id, moviment_b_id)` — `id` és una clau determinista sense ordre (`[a,b].sort().join(':')`) perquè descartar dues vegades la mateixa parella (en qualsevol ordre d'`a`/`b`) sigui idempotent (`INSERT OR IGNORE`).
- `backend/src/db/operations.ts`: nova `descartaTransferencia(suggeriment)`; `suggereixTransferencies()` filtra els suggeriments que coincideixin amb una parella descartada; nova `listTransferenciesDescartades()`. Neteja en cascada: `eliminaMoviment` i `undoLot` esborren les entrades que referencien els moviments eliminats; `reinicialitzaBaseDades` i `eliminaTotsElsMoviments` netegen tota la taula. Backup (`exportaCopiaSeguretat`/`importaCopiaSeguretat`) ampliat amb `transferenciesDescartades` (amb fallback `?? []` per còpies antigues).
- `backend/src/routes.ts`: nova ruta `POST /transferencies/descarta`.
- `frontend/src/views/MovimentsList.tsx`: nou botó "Descartar" al costat de "Confirmar" a cada línia del banner de suggeriments.
- Tests nous a `operations.test.ts` (descartar, idempotència, parelles no relacionades no afectades, `confirmaTransferencia` segueix funcionant, neteja en cascada des d'`eliminaMoviment` i `undoLot`, neteja completa des de `reinicialitzaBaseDades`). 115 tests backend (abans 109); 30 frontend (sense canvis, no hi ha tests de component per a `MovimentsList.tsx`). `tsc -b`, `oxlint` i `vite build` nets a totes dues bandes.
- Verificat manualment via l'API en dades temporals (no `finances.db` real): suggeriment detectat, descartat, deixa d'aparèixer, descartar-lo dues vegades no falla, i els moviments continuen sense marcar com a transferència interna.

### 2026-07-11 — La contrapartida d'una liquidació es mostra just per sobre del càrrec que l'origina

L'usuari ha demanat que el nou moviment que es crea en marcar una liquidació de targeta (la contrapartida automàtica) quedi just per sobre, a la taula, del càrrec de compte corrent que la va originar, i que això tingui en compte els saldos.

Abans, dins d'un mateix dia, l'ordre de visualització sempre desempatava per `seq` ascendent (ordre d'inserció); com que la contrapartida s'assigna un `seq` nou en el moment de marcar (sempre més alt que el del càrrec, importat abans), sortia per sota seu.

Un primer intent (desempatar només el parell càrrec/contrapartida per `movimentOrigenId`, mantenint `seq` per a la resta) no funcionava quan hi havia més moviments aquell mateix dia: l'usuari ho va detectar amb la liquidació de 50€ de l'11/12/2025, on la contrapartida acabava al final de tot el dia en lloc de just per sobre del càrrec. Causa: un comparador que només desempata un parell concret deixa de ser transitiu quan hi ha un tercer element (el seu `seq`, molt alt, el situa per sota de tercers moviments amb qui mai es compara directament amb aquesta regla), i `Array.sort` no garanteix cap resultat concret quan el comparador no és transitiu.

- `frontend/src/views/MovimentsList.tsx`: al comparador de `filtrats`, `seqEfectiu(m)` — la contrapartida pren com a seq efectiu el del càrrec que l'origina (no el seu propi, irrellevant) per a totes les comparacions; així es comporta, davant de tercers moviments del dia, exactament com si estigués a la posició del càrrec. `comparaParella(a, b)` compara primer per aquest seq efectiu i només desempata explícitament (contrapartida abans que el càrrec) quan tots dos hi coincideixen. Verificat amb un script aïllat que replica l'escenari real (3 moviments el mateix dia + la contrapartida): resultat correcte.
- Els saldos no necessiten cap canvi: als comptes seleccionats diferents del propi, `creaConsultaSaldo` agrupa per data (no per aquest ordre visual, és order-independent); a la columna del propi compte, `saldoAcumulatTargetaPerMoviment`/`creaSaldoAcumulatPerMoviment` calculen a partir de `seq`/lot, no de l'ordre de `filtrats` — reordenar aquí no els desquadra.
- `tsc -b`, `oxlint`, `vite build` i els 30 tests frontend nets (no calen tests nous: no hi ha tests de component per a `MovimentsList.tsx`, només de les funcions de `lib/`). No verificat interactivament al navegador (sense eina de navegador disponible en aquesta sessió).

### 2026-07-11 — Eliminar un únic moviment (amb confirmació)

L'usuari ha demanat poder eliminar un moviment concret (no tot un lot d'importació) amb confirmació prèvia, i que els saldos reflecteixin la baixa. Pel saldo de compte corrent no cal cap recàlcul: `saldoPosteriorCents` és un valor real de l'extracte bancari, propi de cada moviment restant, independent dels que s'esborrin. Pel saldo de targeta (deute acumulat, purament calculat al frontend a partir dels moviments carregats) tampoc cal cap canvi específic: en tornar a demanar els moviments després d'esborrar, `creaSaldoAcumulatPerMoviment` ja recalcula sobre la llista actualitzada.

- `backend/src/db/operations.ts`: nova `eliminaMoviment(id)` — si el moviment eliminat és un càrrec de compte corrent marcat com a liquidació de targeta, elimina també la seva contrapartida virtual (altrament quedaria un crèdit fantasma orfe a la targeta); si és la pròpia contrapartida, restaura l'origen a l'estat de no liquidat. Les transferències internes no necessiten cap neteja en cascada (el flag és independent a cada costat, sense punter a la parella).
- `backend/src/routes.ts`: nova ruta `DELETE /moviments/:id`.
- `frontend/src/api/client.ts`: nova `eliminaMoviment(id)`.
- `frontend/src/views/MovimentsList.tsx`: nova columna d'acció (botó "X") a cada fila, amb `confirm()` del navegador (mateix patró que la resta de l'app) abans de cridar l'API i refrescar la llista.
- Tests nous a `operations.test.ts` (moviment normal, id inexistent, cascada en tots dos sentits amb la contrapartida). 109 tests backend (abans 105); `tsc -b`, `oxlint` i `vite build` nets a totes dues bandes.
- Verificat manualment via l'API en dades temporals (no `finances.db` real): marcatge d'una liquidació, eliminació del càrrec confirmant que la contrapartida desapareix en cascada, i que eliminar un id inexistent retorna 400.

### 2026-07-11 — Correcció de l'ordre de moviments del mateix dia al saldo acumulat de targeta

L'usuari va detectar, validant la funcionalitat anterior (saldo a la columna pròpia de targeta), que els saldos de 3 moviments del mateix dia (30/11/2025, compte ING-TG-JN) sortien desordenats. Es va investigar amb una consulta de només lectura contra `dades/finances.db` (mai escrita): `creaSaldoAcumulatPerMoviment` desempatava moviments del mateix dia per `seq` ascendent, assumint que `seq` (ordre d'inserció a la importació) reflecteix l'ordre cronològic. Però `seq` només reflecteix l'ordre de les files al fitxer d'origen, i aquest ordre **no és consistent**: es va confirmar amb dades reals que el lot d'ING-TG-JN llista tot el fitxer de més recent a més antic (48 files, tendència consistent), mentre que BBVA-TG-JN té un lot ascendent i un altre descendent pel mateix compte — no hi ha cap conveni fix per banc, ni tan sols per compte.

- `frontend/src/lib/balance.ts`: `MovimentAcumulat` ara inclou `lotImportacioId`. Nova `inferDireccioLot(moviments)`: per a un lot d'importació, compara el `seq` mitjà dels moviments de la data més antiga contra els de la data més recent d'aquell mateix lot; si puja amb la data és ascendent, si baixa és descendent (una sola data al lot no dona senyal i es tracta com a ascendent per defecte). `creaSaldoAcumulatPerMoviment` agrupa els moviments per lot, infereix la direcció de cadascun, i l'aplica només per desempatar moviments del mateix dia **dins del mateix lot**; un empat de dia entre moviments de lots diferents (rar, sense cap senyal fiable) cau de nou a `seq` ascendent tal com abans.
- Tests nous a `balance.test.ts` reproduint l'escenari real exacte (27-30/11/2025, ING-TG-JN, valors -6,25/-10,39/-111,48/-90,39/-60,39 confirmats amb una execució de només lectura de la funció real contra `finances.db`) i un cas amb dos lots del mateix compte amb direccions oposades. 30 tests frontend (abans 28); `tsc -b`, `oxlint` i `vite build` nets.
- No verificat interactivament al navegador (sense eina de navegador disponible en aquesta sessió) — verificat via tests automàtics i una execució directa de la funció contra les dades reals en mode només lectura.

### 2026-07-11 — Saldo (deute acumulat) a la columna pròpia dels moviments de targeta

L'usuari ha demanat poder veure el saldo als moviments de targeta. La columna "Saldo" ja calculava correctament el deute acumulat per a targetes quan es mostrava la columna d'un *altre* compte seleccionat (via `creaConsultaSaldo`), però a la columna del propi compte es llegia directament `m.saldoPosteriorCents`, que els parsers de targeta (BBVA, ING) mai omplen (les targetes no porten saldo a l'extracte) — així que la cel·la sempre mostrava "—".

Durant el disseny, l'usuari va assenyalar que la data de liquidació no sempre coincideix amb el tall real de facturació (p. ex. es liquida el dia 5 però el darrer càrrec inclòs és del 26 del mes anterior; els càrrecs del 27 al 4 encara no estan liquidats). Es va verificar (i deixar documentat amb un test) que això **no afecta** el càlcul de saldo acumulat: com que és una suma pura d'imports, la contrapartida de liquidació cancel·la exactament l'import liquidat, independentment del desfase entre tall i data de liquidació — el residu que queda després de la contrapartida és automàticament els càrrecs encara no liquidats. En canvi, es va detectar que la comprovació de **quadratura** existent (`marcaLiquidacioTargeta`, 2026-07-08) sí que té aquest problema: calcula l'import esperat sumant els moviments de targeta entre la data de l'anterior liquidació i la data de la liquidació actual (dia 5 a dia 5) en lloc dels talls reals de facturació, cosa que pot generar una diferència de quadratura falsa cada mes. **Queda pendent com a tema separat** (necessita decidir com modelar el dia de tall real, p. ex. un camp configurable per targeta); no s'ha tocat en aquest canvi.

- `frontend/src/lib/balance.ts`: nova `creaSaldoAcumulatPerMoviment(moviments)` — deute acumulat d'un compte targeta immediatament després de cada moviment concret (ordenat per `dataOperacio` + `seq`), a diferència de `creaConsultaSaldo` que només resol "saldo vigent en una data" i no distingeix moviments del mateix dia.
- `frontend/src/views/MovimentsList.tsx`: la cel·la de Saldo del propi compte ara usa aquest càlcul quan `c.tipus === 'targeta'` (abans, `m.saldoPosteriorCents` directament); capçalera "Saldo" amb tooltip aclaridor per a columnes de targeta ("Deute acumulat... No és un saldo disponible").
- Tests nous a `frontend/src/lib/balance.test.ts` (accumulació cronològica, independència de l'ordre d'entrada, i un test explícit que reprodueix l'escenari de desfase liquidació/tall real confirmant que el residu post-contrapartida és correcte). 28 tests frontend (abans 25); `tsc -b`, `oxlint` i `vite build` nets.
- No verificat interactivament al navegador (sense eina de navegador disponible en aquesta sessió) — només typecheck, lint, build i tests automàtics.

### 2026-07-11 — Revertida la funcionalitat de liquidacions directes de targeta

L'usuari ha demanat tornar a la versió anterior a GitHub. S'ha desfet amb `git revert` (no `reset`) la funcionalitat de "liquidació directa" (retirades d'efectiu que es cobren directament al compte corrent) introduïda el 2026-07-10, mantenint l'historial intacte. Es reverteixen els 3 commits: `9dde33c` (backend), `f322fef` (frontend), `9327523` (documentació). Torna a haver-hi 105 tests backend (abans 126) i 25 frontend; `tsc -b` i tests nets a totes dues bandes després del revert. El buit de les retirades d'efectiu (detectat en validació) continua obert — pendent de decidir si es reimplementa més endavant.

### 2026-07-08 — Contrapartida automàtica de liquidacions de targeta (tanca un buit detectat en validar la Fase 2)

En validar la Fase 2, l'usuari va detectar que el deute de les targetes creix indefinidament: l'extracte de la targeta mai inclou la seva pròpia liquidació mensual (només apareix com un càrrec al compte corrent), així que marcar-la com a simple "transferència interna" (ja existent) no n'hi ha prou — cal una contrapartida que realment cancel·li el deute acumulat. Vegeu especificacio.md 3.2.1 (reescrita) per al disseny complet.

- `backend/src/db/migrations/003_liquidacio_targeta.sql`: afegeix `es_liquidacio_targeta_id` i `moviment_origen_id` a `moviments`, i la taula `regles_liquidacio` (patró de concepte → compte de targeta, per detectar automàticament quina liquidació és de quina targeta).
- `backend/src/lib/hash.ts`: nova `computeContrapartidaId(movimentOrigenId)` (cyrb53 amb seed diferent de `computeMovimentHash`) — id determinista de la contrapartida, idempotent davant reimportacions.
- `backend/src/lib/liquidacioTargeta.ts` (nou): `pickTargetaLiquidacio`, mateixa lògica de substring que `pickCategoriaId` però sense prioritat.
- `backend/src/db/operations.ts`:
  - `marcaLiquidacioTargeta(movimentCorrentId, targetaCompteId)`: valida que l'origen sigui un compte corrent i el destí una targeta; marca el càrrec (`esLiquidacioTargetaId` + `esTransferenciaInterna=true`); crea el moviment virtual a la targeta (import positiu = valor absolut del càrrec, mateixa data, concepte "Liquidació rebuda (contrapartida automàtica)", `esTransferenciaInterna=true`, `movimentOrigenId`, i **el mateix `lotImportacioId` que el càrrec real** — decisió clau: així `undoLot` ja elimina la contrapartida en cascada quan es desfà el lot del càrrec, sense cap canvi a `undoLot`); calcula i retorna la quadratura (suma dels moviments reals de la targeta des de l'anterior liquidació, comparada amb l'import liquidat).
  - `desmarcaLiquidacioTargeta`: elimina la contrapartida i neteja el marcatge.
  - `suggereixLiquidacionsTargeta`: proposa, pels càrrecs de compte corrent encara sense marcar, quina targeta els correspon segons `regles_liquidacio`.
  - `listReglesLiquidacio`/`createReglaLiquidacio`/`deleteReglaLiquidacio`: CRUD de les regles; `eliminaCompte` esborra en cascada les regles que apuntin al compte eliminat.
  - Còpia de seguretat (`exportaCopiaSeguretat`/`importaCopiaSeguretat`) ampliada amb `reglesLiquidacio` i els dos camps nous de `Moviment` (amb fallback `?? []` per còpies antigues sense el camp).
- `backend/src/routes.ts`: noves rutes `GET/POST /liquidacions/regles`, `DELETE /liquidacions/regles/:id`, `GET /liquidacions/suggeriments`, `POST /liquidacions/marca`, `POST /liquidacions/desmarca`.
- `frontend/src/views/MovimentsList.tsx`: nova columna "Liquidació" (només visible si hi ha alguna targeta) — marca/desmarca manual per fila, més un banner de "Liquidacions de targeta suggerides" (com el de transferències internes) amb confirmació. Si la quadratura no coincideix, avís no bloquejant amb la diferència.
- `frontend/src/views/AccountsManager.tsx`: nova secció "Regles de liquidació de targeta" (patró + selector de targeta) per configurar els patrons.
- Tests nous: `backend/src/db/operations.test.ts` (marcatge/desmarcatge, quadratura correcta/incorrecta, quadratura només des de l'anterior liquidació, idempotència de l'id, validacions, cascada via `undoLot`, cascada d'`eliminaCompte`), `backend/src/lib/hash.test.ts` i `backend/src/lib/liquidacioTargeta.test.ts` (nous). 105 tests backend (abans 86), 25 frontend, `tsc -b`/`oxlint`/`vite build` nets a totes dues bandes.
- Verificat manualment via API real (curl) contra una base de dades temporal: importació de moviments de targeta + càrrec de liquidació al corrent, detecció per regla, marcatge (contrapartida amb import positiu correcte, quadratura 0 quan quadra), deute de la targeta tornant exactament a 0, i `undoLot` del lot del corrent eliminant la contrapartida alhora que el càrrec. No verificat interactivament al navegador.

### 2026-07-08 — Edició de regles de categorització (patró i categoria) + ordre i format de la llista

L'usuari va demanar poder editar una regla existent (canviar el patró i/o la categoria) en lloc de només poder-la esborrar i recrear, i que la llista de regles es mostrés ordenada per categoria amb la categoria abans que el patró.

- `backend/src/db/operations.ts`: nova `actualitzaRegla(id, { patro?, categoriaId? })` — actualitza només els camps presents; valida (igual que `createRegla`) que `categoriaId`, si es dona, apunti a una categoria existent.
- `backend/src/routes.ts`: nova ruta `PATCH /regles/:id`.
- `frontend/src/api/client.ts`: nova `actualitzaRegla(id, data)`.
- `frontend/src/views/CategoriesManager.tsx`: cada regla de la llista té ara un botó "Edita" que la converteix en un selector de categoria + un input de patró editables in-line (mateix patró que l'edició de categories); la llista es mostra ordenada per nom de categoria i, dins de cada categoria, per patró (`reglesOrdenades`, purament de visualització — no toca `prioritat`, que continua determinant quina regla guanya en cas de conflicte). El format de cada línia també es va canviar abans a "Categoria ← patró" (categoria primer).
- Tests nous a `backend/src/db/operations.test.ts` (`actualitzaRegla`): 86 tests backend (abans 84), 25 frontend, `tsc -b`/`oxlint`/`vite build` nets a totes dues bandes.

### 2026-07-08 — Afegir una regla de categorització des de la mateixa pàgina de Moviments

L'usuari va demanar poder crear una regla de categorització automàtica sense haver de sortir de la pestanya de Moviments: en un moviment concret, un botó "+regla" que proposi una regla amb el mateix concepte (editable) i l'opció d'aplicar-la de seguida.

- `frontend/src/views/MovimentsList.tsx`: cada fila té ara un botó "+regla" al costat del selector de categoria. En clicar-lo, es desplega una fila addicional amb un formulari (patró de text preomplert amb `concepteNormalitzat` del moviment — el mateix camp que `pickCategoriaId` compara al backend — i editable, i un selector de categoria preomplert amb la del moviment o la primera disponible). Dos botons: "Desa la regla" (només la crea) i "Desa i aplica als moviments sense categoria" (la crea i tot seguit crida `aplicaReglesAMovimentsSenseCategoria()`, igual que el botó equivalent de la pestanya Categories). Reutilitza `createRegla`/`aplicaReglesAMovimentsSenseCategoria` ja existents — sense endpoints nous.
- `MovimentsList` passa a rebre `regles` (per calcular la `prioritat` de la regla nova, igual que `CategoriesManager`) i `onChanged` (per refrescar l'estat global — categories/regles — de `App.tsx` en crear-se una regla, a banda de refrescar els seus propis moviments).
- Sense canvis de backend (reutilitza rutes existents). `tsc -b`, `oxlint` i `vite build` nets; sense tests nous (la lògica de creació/aplicació de regles ja està coberta al backend i des de `CategoriesManager`).

### 2026-07-08 — A la taula de Moviments, les cel·les de Saldo sense import mostren el saldo vigent (carry-forward)

L'usuari va demanar que, a la pestanya de Moviments, totes les columnes de Saldo apareguin plenes a cada fila encara que aquell compte no hagi tingut cap moviment aquell dia — mostrant el darrer saldo conegut en lloc de deixar la cel·la buida (la columna d'Import, en canvi, es manté buida: no hi ha hagut cap moviment real).

- `frontend/src/lib/balance.ts`: nova funció `creaConsultaSaldo(moviments, tipus)`, que retorna una funció `data -> saldo | null`. Precalcula un "punt de control" de saldo per cada data amb activitat d'un compte (reutilitzant la mateixa reconstrucció cronològica que ja feia servir `saldoEnData` internament) i després resol qualsevol data per cerca binària — molt més barat que cridar `saldoEnData` un cop per fila i per compte, ja que evitaria re-escanejar tot l'historial del compte a cada cel·la. Coherent amb `saldoEnData` per construcció (mateix algorisme de reconstrucció cronològica), i verificat amb tests que comparen totes dues funcions sobre el mateix conjunt de dates, incloent dates sense moviment.
- `frontend/src/views/MovimentsList.tsx`: per cada compte seleccionat es construeix una d'aquestes consultes (memoritzada, a partir de tots els moviments del compte, no només els filtrats — el saldo mostrat ha de reflectir l'historial real, independentment dels filtres de data/categoria/text actius). A la cel·la de Saldo d'un compte sense moviment aquella fila, s'hi mostra ara el resultat d'aquesta consulta (en gris, per distingir-lo visualment d'un saldo real d'aquell dia); si encara no hi ha cap saldo conegut per aquell compte en aquella data (abans del seu primer moviment), la cel·la es manté buida.
- Tests nous a `frontend/src/lib/balance.test.ts` (`creaConsultaSaldo`): 25 tests frontend (abans 22), `tsc -b` i `vite build` nets. Sense canvis de backend.

### 2026-07-08 — Edició completa de comptes, ordre manual i agrupació per entitat

L'usuari va demanar tres canvis a la configuració dels comptes: un camp per definir el seu ordre a la pestanya de Moviments, poder editar totes les dades de cada compte (no només l'àlies) i poder agrupar-los (p. ex. "Família", "Empresa").

- `backend/src/db/migrations/002_comptes_ordre_grup.sql`: nova migració que afegeix `ordre INTEGER` i `grup TEXT` a `comptes`, i inicialitza `ordre` amb el `rowid` perquè els comptes existents no canviïn d'ordre visual en aplicar-la.
- `backend/src/db/types.ts`: `Compte` incorpora `ordre?: number` i `grup?: string`.
- `backend/src/db/operations.ts`:
  - `listComptes()` ara ordena per `ordre` (nulls al final) i després per `alias` — aquest ordre es propaga a totes les pestanyes que fan servir la llista compartida de comptes des d'`App.tsx` (Moviments inclòs, via `CompteSelector`).
  - `createCompte()` assigna automàticament el següent `ordre` disponible (`MAX(ordre)+1`) perquè els comptes nous sempre acabin al final sense que l'usuari l'hagi de fixar a mà.
  - `renombraCompte()` (només canviava l'àlies) se substitueix per `actualitzaCompte()`, que permet editar qualsevol subconjunt de camps (àlies, banc, tipus, número, compte de liquidació, dia de liquidació, ordre, grup) en una sola crida; valida que `compteLiquidacioId` apunti a un compte existent i que `diaLiquidacio` estigui entre 1 i 31.
  - `exportaCopiaSeguretat()`/`importaCopiaSeguretat()` inclouen ara `ordre` i `grup` a la còpia de seguretat JSON.
- `backend/src/routes.ts`: `PATCH /comptes/:id` accepta ara tots els camps editables (abans només `alias`) i respon 400 si `actualitzaCompte()` llança un error de validació.
- `frontend/src/api/types.ts` i `client.ts`: `Compte` amb `ordre`/`grup`; `renombraCompte()` se substitueix per `actualitzaCompte(compteId, data)`.
- `frontend/src/views/AccountsManager.tsx`: reescrit — els comptes es mostren agrupats per `grup` (secció "(Sense grup)" sempre al final), cada fila té un botó "Edita" que desplega un formulari amb tots els camps (àlies, banc, tipus, número, grup amb autocompletar dels grups existents, ordre, i — només per a targetes — compte de liquidació i dia de liquidació).
- Tests nous a `backend/src/db/operations.test.ts` (`actualitzaCompte`, ordre de `listComptes()`): 84 tests backend (abans 80), 22 frontend, `tsc -b` net a totes dues bandes.

### 2026-07-07 — Còpia de seguretat del `.db` a petició (a més de les automàtiques)

L'usuari va demanar poder disparar manualment una còpia de seguretat del fitxer de dades, del mateix tipus que les que ja es feien automàticament abans de cada importació/operació destructiva.

- `backend/src/db/backupFile.ts`: sense canvis de lògica — `backupDbFile()` ja feia exactament això; només calia exposar-lo.
- `backend/src/routes.ts`: nova ruta `POST /manteniment/backups` que crida `backupDbFile()` i retorna la còpia acabada de crear (o `null` si encara no existeix cap base de dades).
- `frontend/src/api/client.ts`: nova funció `creaCopiaSeguretatDb()`.
- `frontend/src/views/Maintenance.tsx`: la secció "Restaurar una còpia de seguretat automàtica" es renombra a "Còpies de seguretat automàtiques" i afegeix un botó "Fes una còpia de seguretat ara" a sobre de la taula existent; en crear-se, refresca la llista i mostra un missatge amb la data.
- Sense taula/tests nous al backend (reutilitza `backupDbFile`, ja cobert per `backupFile.test.ts`); `tsc -b` net i tots els tests (80 backend, 22 frontend) continuen passant.

### 2026-07-07 — Eliminada la pestanya "Saldos a una data"

A petició de l'usuari. `frontend/src/views/BalanceAtDate.tsx` eliminat (sense cap altre ús ni test propi); `frontend/src/App.tsx` treu `'saldos'` de `Pestanya`/`PESTANYES` i la crida corresponent. `lib/balance.ts` es manté, ja que `Dashboard.tsx` encara el fa servir. Sense canvis de backend. `tsc -b` net i els 22 tests de frontend continuen passant.

### 2026-07-07 — La pestanya "Còpia de seguretat" (JSON) s'integra a "Manteniment"

A petició de l'usuari, s'elimina la pestanya independent "Còpia de seguretat" de la navegació principal: el seu contingut (exportar/importar totes les dades en un fitxer JSON) ara viu com una secció més dins de "Manteniment", junt amb la restauració de còpies automàtiques del `.db` i les zones de perill. Motiu: totes tres coses són operacions de manteniment/recuperació de dades, i tenir-les en una única pestanya és més coherent que repartir-les en dues.

- `frontend/src/views/Backup.tsx`: eliminat. El seu contingut (`esBackupValid`, l'exportació i la importació de JSON) es mou a un nou component `CopiaSeguretatJSON` dins de `frontend/src/views/Maintenance.tsx`, renderitzat entre `RestauraCopies` i els blocs `ZonaPerill`.
- `frontend/src/App.tsx`: treu `'backup'` de `Pestanya` i de `PESTANYES`, i la crida a `<Backup onImported={refresh} />`.
- Sense canvis d'API ni de backend — és una reorganització purament de navegació/UI. `tsc -b` net i els 22 tests de frontend continuen passant.

### 2026-07-06 — Manteniment: restaurar una còpia de seguretat automàtica

L'usuari va preguntar com recuperar una còpia automàtica del `.db` (les que `backupDbFile()` fa soles abans de cada importació/operació destructiva) — fins ara calia aturar el servidor i copiar el fitxer a mà, sense cap suport a la UI. Afegit:

- `backend/src/db/backupFile.ts`: `listBackupFiles()` (llista `dades/backups/`, més recent primer, amb data i mida) i `restoreBackup(filename)` (substitueix `finances.db` pel fitxer triat). `restoreBackup` primer fa una còpia de seguretat de l'estat actual (per si cal desfer la restauració), tanca la connexió, elimina els sidecars `-wal`/`-shm` obsolets (pertanyen al fitxer que s'està substituint, no al restaurat) i reobre la BD. Valida el nom de fitxer (sense `..`, `/`, `\`) per evitar path traversal des de la ruta de l'API.
- `backend/src/routes.ts`: `GET /manteniment/backups`, `POST /manteniment/backups/:filename/restaura`.
- `frontend/src/views/Maintenance.tsx`: nova secció "Restaurar una còpia de seguretat automàtica" (component `RestauraCopies`) amb una taula (data, mida) i un botó "Restaura" per fila, amb `confirm()` explícit abans d'executar.
- Nous tests a `backupFile.test.ts` (llistat buit/amb contingut, restauració amb còpia de seguretat prèvia real, rebuig de noms de fitxer no vàlids o inexistents) — backend a 80 tests.

### 2026-07-06 — Bug real (post-migració): "Aplica les regles" no funcionava per a una regla amb categoria òrfena

**Reportat per l'usuari mentre provava l'app real** (`npm start` contra les dades migrades): va crear la categoria "Ajuntament" i la regla "Recibo AJ. CASTELLOLI", i en prémer "Aplica les regles" no semblava fer res.

Causa arrel: la regla es va crear amb un `categoriaId` que no corresponia a cap categoria existent (una categoria òrfena — l'usuari confirma que no havia esborrat cap categoria, així que l'origen exacte al formulari del frontend no s'ha pogut reproduir del tot, però `createRegla`/`setMovimentCategoria` mai validaven que la categoria existís abans de desar-la). `aplicaReglesAMovimentsSenseCategoria()` sí que va trobar i actualitzar els 5 moviments que contenien "Recibo AJ. CASTELLOLI", però els va deixar amb un `categoriaId` que no apareix a `categories` — a la UI això es veu idèntic a "sense categoria", d'aquí la percepció que "no ha funcionat".

Correccions:
- `backend/src/db/operations.ts`: `createRegla` i `setMovimentCategoria` ara validen (`existeixCategoria`) que la categoria referenciada existeixi abans de desar, i llencen un error clar en cas contrari — tanca la classe de bug sencera, independentment de com s'arribés a l'estat anterior. Nous tests de regressió a `operations.test.ts`.
- `backend/src/routes.ts`: `POST /regles` i `PATCH /moviments/:id` ara atrapen aquest error i el retornen com a 400 amb missatge, en lloc de deixar-lo pujar com a 500 sense format.
- `frontend/src/views/CategoriesManager.tsx`: dos arranjaments defensius al formulari de regles nou, encara que no s'hagi pogut confirmar que siguin la causa exacta d'aquest cas concret: (1) `novaCategoriaRegla` (l'estat del `<select>` de categoria) ara es re-sincronitza per `useEffect` quan la categoria seleccionada ja no existeix a la llista o encara no se n'ha seleccionat cap vàlida — abans només s'inicialitzava un cop amb `useState`, i podia quedar apuntant a un id obsolet sense que el desplegable ho reflectís visualment; (2) errors de `createRegla` ara es mostren a l'usuari en lloc de perdre's com a promesa rebutjada sense gestionar. A més, `categoriaNom()` ara mostra "⚠ categoria inexistent (id)" en lloc de l'id pelat, perquè una regla òrfena futura sigui visible d'un cop d'ull.
- **Dades reals reparades**: els 5 moviments "Recibo AJ. CASTELLOLI" reassignats a "Ajuntament" (la categoria correcta) via `PATCH /api/moviments/:id`, i la regla òrfena esborrada. Verificat que ja no queda cap moviment amb aquesta categoria inexistent i que `POST /api/regles/aplica` torna a funcionar net (0 actualitzacions, ja no hi ha res pendent de categoritzar amb les regles actuals).

### 2026-07-06 — Migració d'arquitectura: de Dexie/IndexedDB a backend Node + SQLite

A petició explícita de l'usuari (especificació actualitzada, seccions 1/2/pla de fases), tot el que abans vivia al navegador via Dexie passa a un backend Node/TypeScript/Express local amb SQLite en un fitxer. **Aquesta migració encara no ha estat validada per l'usuari — no s'ha d'iniciar la Fase 3 fins que ho confirmi.**

Canvis:
- **Monorepo amb npm workspaces** (`backend/`, `frontend/`), arrel amb `npm start` (build del frontend + arrencada del backend), `npm run dev` (backend i frontend en mode desenvolupament, via `concurrently`), `npm test` (tots dos workspaces).
- **`backend/`**: nou. `db/migrations/001_init.sql` (esquema equivalent al de Dexie: `comptes`, `categories`, `regles`, `lots`, `moviments` + índexs), `db/client.ts` (`node:sqlite` `DatabaseSync`, runner de migracions fet a mà versionat per nom de fitxer, WAL mode), `db/operations.ts` (port 1:1 de l'antic `db/operations.ts` de Dexie a SQL preparat), `db/backupFile.ts` (còpia automàtica de `finances.db` — amb checkpoint de WAL previ — abans de cada importació i operació destructiva, retenint les 20 més recents), `routes.ts` + `server.ts` (API REST a `/api/*`, servint el frontend ja compilat, obrint el navegador en arrencar), `migrateFromJson.ts` (script d'un sol ús). Parsers, dedup i el subconjunt de `lib/` necessari per parsejar es van copiar del frontend (mateixa lògica, sense canvis de comportament) i adaptats perquè `importFile.ts` rebi `{name, buffer: ArrayBuffer}` en lloc d'un `File` del DOM.
- **`frontend/`**: eliminats `db/` (Dexie), `parsers/`, `dedup/`, i les utilitats de `lib/` que ja no calen al navegador (`categorization.ts`, `concept.ts`, `hash.ts`, `encoding.ts`, `internalTransfers.ts`); `numbers.ts`/`dates.ts` retallats a només les funcions de visualització. Nou `api/` (`types.ts` amb les formes de dades, `client.ts` amb totes les crides `fetch` — mateixos noms de funció que l'antic `db/operations.ts` per minimitzar canvis a les vistes). Totes les vistes/components adaptats als nous imports; `ImportWizard.tsx`/`ManualMapping.tsx` reescrits perquè el parseig (automàtic i manual) es faci via `POST /api/importacio/previsualitza`/`previsualitza-manual` en lloc de cridar els parsers localment.
- **Decisions tècniques** (justificades a la secció Arquitectura): `node:sqlite` en lloc de `better-sqlite3` (sense compilació nativa), migracions SQL fetes a mà en lloc d'un ORM, sense paquet compartit entre backend i frontend (còpies trimmed en lloc de tooling de monorepo addicional), `esTransferenciaInterna`/altres booleans com a INTEGER 0/1 amb mapeig manual a les interfícies camelCase.
- **`localStorage`**: només es manté per a `useCompteSeleccio` (preferència d'interfície: quins comptes estan seleccionats), tal com demanava l'usuari explícitament.

**Migració de dades real**: `migrateFromJson.ts` executat contra la còpia de seguretat JSON real de l'usuari (`gesfam-copia-seguretat.json`: 4 comptes, 266 moviments, 4 lots, 23 categories, 15 regles). Verificat camp a camp contra l'original — 0 diferències reals (l'única discrepància aparent, `esTransferenciaInterna` explícit a `false` enlloc d'absent, és una normalització esperada: SQL no té concepte de "columna absent", i semànticament `undefined`/`false` són equivalents aquí). Carregat a `dades/finances.db` real (fora de git, com sempre).

**Verificació end-to-end**: `npm start` real contra les dades migrades — index.html servit correctament, els 4 comptes i 266 moviments reals accessibles via `/api/comptes`/`/api/moviments`; import/undo/eliminar-compte de prova via HTTP confirmant que `backupDbFile()` es dispara (fitxers a `dades/backups/`); reinici complet del servidor confirmant que les dades hi són intactes (criteri d'acceptació: "les dades sobreviuen a reiniciar el servidor"). Pendent: prova manual en navegador per part de l'usuari (aquesta verificació ha estat via `curl`/tests automatitzats, no clic a clic a la UI).

### 2026-07-06 — Format d'imports consistent a tota l'aplicació
A petició de l'usuari, tots els camps d'import/saldo de la UI (no només la taula de Moviments, que ja ho tenia) ara mostren el format amb separador de milers, sense el símbol "€", i alineats a la dreta: previsualització de `ImportWizard.tsx`, columna Saldo i Total de `Dashboard.tsx` i `BalanceAtDate.tsx`, imports de "Transferències internes suggerides" i taula de `Summary.tsx` (Ingressos/Despeses). L'exportació a CSV de `MovimentsList.tsx` es manté amb el símbol "€", ja que és un fitxer per a consum extern, no un camp de la interfície.

### 2026-07-06 — "Resum mensual" generalitzat a "Resums" (mensual/anual/interval)
A petició de l'usuari, la pestanya "Resum mensual" passa a dir-se "Resums" i ara admet tres modes (selector per ràdio buttons): mensual (com abans), anual, i un interval de dates lliure (camps "des de"/"fins a"). `src/lib/monthlySummary.ts` renombrat a `src/lib/summary.ts`: `ResumMes`/camp `mes` generalitzats a `ResumPeriode`/camp `periode`; nova lògica compartida (`acumula`, `resumPerClau`) reutilitzada per `resumPerMesICategoria`, la nova `resumPerAnyICategoria` (agrupa per any) i la nova `resumInterval` (un sol bloc per a un rang de dates arbitrari, amb els límits opcionals per a rangs oberts). `src/views/MonthlySummary.tsx` renombrat a `src/views/Summary.tsx`, amb el selector de mode i l'etiqueta de cada bloc adaptada (per l'interval, "Del dd/mm/aaaa al dd/mm/aaaa"). Manté l'ordenació alfabètica de categories (canvi anterior). Tests migrats i ampliats a `src/lib/summary.test.ts` (9 tests, incloent-hi `resumPerAnyICategoria` i `resumInterval`).

### 2026-07-06 — Resum mensual ordenat per categoria
`src/views/MonthlySummary.tsx`: dins de cada bloc mensual, les files ara es mostren ordenades alfabèticament pel nom de la categoria, amb "Sense categoria" sempre al final (és un calaix de sastre, no una categoria real). Abans seguien l'ordre d'iteració de `Object.entries`, essencialment arbitrari.

### 2026-07-06 — Correcció definitiva: saldos incorrectes per ordre de moviments del mateix dia
El fix del fus horari (entrada anterior) no resolia el problema del tot: l'usuari va confirmar que persistia i que tenia a veure amb l'ordre de moviments d'una mateixa data. Causa arrel real: les dades ja importades **abans** que existís el camp `seq` (durant les proves de la Fase 2) només tenen un `seq` "millor esforç" assignat per la migració v2→v3, que per a moviments del mateix dia **i del mateix lot** cau en l'ordre arbitrari que retorna IndexedDB — no el fitxer real. Aquest `seq` no fiable feia que `saldoEnData` triés el moviment equivocat com a "últim del dia" en reconstruir el saldo.

Solució (`src/lib/balance.ts`, nova funció `ordenaCronologicament`): en lloc de confiar en `seq`, es reconstrueix l'ordre cronològic real a partir de les pròpies dades — per a qualsevol moviment, `saldoPosteriorCents - importCents` és el saldo immediatament ANTERIOR a aplicar-lo, que ha de coincidir exactament amb el `saldoPosteriorCents` del moviment immediatament anterior. Encadenant aquesta coincidència (agrupant per data, que sempre és fiable) es recupera l'ordre real independentment de `seq`, fins i tot per a dades ja importades abans d'aquest camp existir — sense necessitat de cap altra migració. `seq` només s'utilitza com a últim recurs quan la cadena no es pot resoldre (buit del tot, primer moviment de la història sense saldo anterior conegut, o duplicats amb saldos incoherents).

Verificat empíricament amb els fitxers reals de `Samples/`: es van escombrar (invertir) els valors de `seq` de 132 moviments reals en 49 grups del mateix dia, simulant exactament la migració deficient, i els saldos calculats (`saldoActualCompte`) van sortir **idèntics** abans i després — confirmant que el càlcul ja no depèn de `seq` quan la cadena de saldos és reconstruïble (el cas normal per a Sabadell/BBVA/ING-compte/OpenBank). Nous tests a `src/lib/balance.test.ts`: reconstrucció amb `seq` completament escombrat dins un mateix dia, i ancoratge correcte del primer moviment d'un dia al saldo de tancament del dia anterior.

### 2026-07-06 — Correcció: saldos incorrectes al Panell general i a Saldos a una data (bug de fus horari)
**Bug reportat per l'usuari**: els saldos del Panell general i de Saldos a una data no coincidien amb la realitat, mentre que la pàgina de Moviments sí. Causa arrel: `Dashboard.tsx` i `BalanceAtDate.tsx` calculaven "avui" amb `new Date().toISOString().slice(0, 10)` — però `toISOString()` sempre retorna hora UTC, i Espanya va per davant d'UTC (CET/CEST). Durant les primeres hores de la matinada (entre mitjanit i la 1-2h, segons horari d'estiu/hivern), aquesta expressió retornava la data d'**ahir**, excloent silenciosament els moviments importats avui mateix del càlcul de saldo (que filtra "fins avui"). La pàgina de Moviments no té aquest problema perquè no aplica cap tall per data per defecte.

Afegida `avui()` a `src/lib/dates.ts`, que fa servir els getters locals de `Date` (`getFullYear`/`getMonth`/`getDate`) en lloc d'UTC. Reemplaçades les implementacions locals duplicades a `Dashboard.tsx` i `BalanceAtDate.tsx`, i també els usos merament cosmètics (noms de fitxer) a `Backup.tsx`, `Maintenance.tsx` i `MovimentsList.tsx`, per consistència. Nou test de regressió a `src/lib/dates.test.ts` que fixa `process.env.TZ = 'Europe/Madrid'` i una hora del sistema que travessa la frontera UTC/local, verificant que `avui()` retorna la data local i no la UTC.

### 2026-07-06 — Més ajustos de format a Moviments + categories editables i ordenades
`src/views/MovimentsList.tsx`: el bloc "Transferències internes suggerides" ara fa servir `font-size: 12px` (la mateixa que la taula); els imports (tant a la taula com als suggeriments) es mostren en vermell quan són negatius (`colorImport`); la columna Saldo es mostra en negreta. `listCategories()` a `src/db/operations.ts` ara retorna les categories ordenades alfabèticament (`localeCompare` sense argument de locale explícit, pel mateix motiu que `centsToEs`: no dependre de dades ICU que poden no estar completes) — aquest ordre es propaga automàticament a tots els llocs que consumeixen la llista de categories (selector de Moviments, filtre, `CategoriesManager`, `MonthlySummary`). Nova operació `renombraCategoria`; `CategoriesManager.tsx` permet editar el nom d'una categoria amb el mateix patró d'edició inline que `AccountsManager.tsx`. Nous tests: ordre alfabètic de `listCategories` i `renombraCategoria`.

### 2026-07-06 — Gestió de comptes: editar àlies i eliminar (si no tenen moviments)
Nova pestanya "Comptes" (`src/views/AccountsManager.tsx`): taula amb tots els comptes (àlies editable inline, banc, tipus, número, recompte de moviments) i un botó "Elimina" desactivat mentre el compte tingui algun moviment associat. Noves operacions a `src/db/operations.ts`: `renombraCompte`, `countMovimentsCompte`, `eliminaCompte` (torna a comprovar el recompte de moviments dins la mateixa transacció abans d'esborrar, i elimina també els lots d'importació propis del compte, que quedarien orfes). Extret `bankLabel` (abans privat a `ImportWizard.tsx`) a `src/lib/bankLabel.ts` per reutilitzar-lo sense duplicar-lo. Nous tests a `src/db/operations.test.ts`: reanomenar, eliminar un compte buit (incloent-hi el seu lot orfe), i rebuig d'eliminar un compte amb moviments.

### 2026-07-06 — Columna Categoria un 50% més ampla
`src/views/MovimentsList.tsx`: `cellCategoria` de 90px a 135px (90 × 1,5).

### 2026-07-06 — Amplada fixa a les columnes Data, Categoria, TI, Import i Saldo
`src/views/MovimentsList.tsx`: aquestes cinc columnes ara tenen `width = minWidth = maxWidth` (helper `amplaFixa`, `box-sizing: border-box` + `overflow: hidden`) calculades pel contingut més ample que hi pot aparèixer a 12px de font — Data 80px (“06/07/2026”), Categoria 90px, TI 28px (només la casella), Import/Saldo 80px (“-12.345,67”). Concepte i les capçaleres de compte segueixen sense amplada fixa (Concepte ja tenia `maxWidth` amb ajust de línia des del canvi anterior).

### 2026-07-06 — Ajustos de format a la taula de Moviments + correcció del separador de milers
A petició de l'usuari: la pestanya Moviments ja no queda limitada als 1000px del contenidor de l'app (`App.tsx` fa `maxWidth: 'none'` només per a aquesta pestanya, ja que necessita tot l'ample de pantalla per les columnes per compte). A `MovimentsList.tsx`: la columna Concepte ara embolica el text (en lloc de `nowrap`) amb un ample màxim de 220px per mostrar-se en ~2 línies i alliberar espai horitzontal; Categoria més estreta (`maxWidth: 90`); "Transf. interna" rebatejada a "TI" amb l'amplada mínima possible (`width: 1` + `text-align: center`, el truc estàndard perquè una `<td>` s'encongeixi al contingut mínim); Import i Saldo ara sense símbol `€` (usant el nou segon paràmetre `ambSimbol` de `centsToEs`), alineats a la dreta amb `font-variant-numeric: tabular-nums`.

**Bug detectat de pas**: `centsToEs` feia servir `Number.toLocaleString('es-ES')` per al separador de milers, però això depèn que el motor JS tingui les dades ICU completes per a aquesta configuració regional — els builds de Node amb "small-icu" (com el d'aquest entorn de test) retornen els dígits sense agrupar per a qualsevol configuració regional que no sigui en-US, cosa que ho feia trencar silenciosament (sense error, simplement sense punts de miler). Substituït per un agrupament manual per regex (`agrupaMilers`) sense dependència de `Intl`, determinista en qualsevol entorn. Detectat gràcies a un test nou (`centsToEs` amb un import de 4 xifres), abans no n'hi havia cap que cobrís aquest cas.

### 2026-07-06 — Redisseny de la taula de Moviments (columnes per compte)
A petició de l'usuari, `src/views/MovimentsList.tsx` ja no té una columna "Compte" repetida per fila: ara les columnes comunes són Data, Concepte, Categoria i Transf. interna, i cada compte seleccionat té el seu propi parell de columnes Import/Saldo (capçalera de dues files amb `colSpan`/`rowSpan`), deixant en blanc les columnes dels altres comptes en cada fila. Això permet comparar visualment quin compte va tenir moviment cada dia i com evoluciona el seu saldo en paral·lel. Taula amb `font-size: 12px`, `white-space: nowrap` i embolicada en un contenidor amb `overflow-x: auto` per a la barra de desplaçament horitzontal. S'ha simplificat `CampOrdre` a només `dataOperacio`/`concepteOriginal` (l'ordenació per import ja no té sentit com a columna única, ara que Import és una columna per compte). L'exportació a CSV manté el format anterior (una fila per moviment amb columna "Compte"), ja que és per a consum extern, no per a la vista de comparació en pantalla.

### 2026-07-06 — Manteniment: eliminar només els moviments
Afegida una segona acció al menú de manteniment: `eliminaTotsElsMoviments()` (`src/db/operations.ts`) esborra tots els moviments i els lots d'importació associats (els lots queden orfes/sense sentit sense els seus moviments), però manté intactes comptes, categories i regles — permet reimportar els extractes des de zero sense haver de reconfigurar comptes ni regles de categorització. `src/views/Maintenance.tsx` refactoritzat amb un component reutilitzable `ZonaPerill` (frase de confirmació + `confirm()` del navegador) per no duplicar la UI entre aquesta acció i la reinicialització completa; cadascuna té la seva pròpia frase de confirmació ("ESBORRA MOVIMENTS" vs. "ESBORRA-HO TOT") per evitar confusions entre totes dues. Nous tests a `src/db/operations.test.ts`: neteja selectiva i reimportació posterior sense bloqueig per deduplicació.

### 2026-07-06 — Correcció: ordenació cronològica del llistat de moviments
**Bug reportat per l'usuari**: la llista de moviments no sempre estava ordenada cronològicament; quan la data coincidia, l'ordre resultant era incorrecte. Causa arrel: IndexedDB no garanteix retornar les files en l'ordre en què es van inserir, així que ordenar només per `dataOperacio` deixava els moviments del mateix dia en un ordre arbitrari (per hash de `id`, no per l'ordre del fitxer importat) — i el mateix problema afectava silenciosament `saldoEnData` (podia triar el saldo posterior d'un moviment que no era realment l'últim del dia).

Afegit el camp `Moviment.seq` (enter estrictament creixent, assignat a `commitImport` seguint l'ordre del fitxer parsejat). Bump de l'esquema Dexie a la versió 3, amb migració que assigna `seq` (millor esforç) a moviments ja existents. Actualitzats `lib/balance.ts` (`saldoEnData` ara desempata per `seq`) i `views/MovimentsList.tsx` (l'ordenació per data, import o concepte desempata sempre per `seq` ascendent, independentment de la direcció d'ordenació — el desempat mai s'inverteix). Fitxers afectats: `src/db/types.ts`, `src/db/schema.ts`, `src/db/operations.ts`, `src/lib/balance.ts`, `src/views/MovimentsList.tsx`. Nous tests: cas de desempat a `src/lib/balance.test.ts`, assignació de `seq` en `commitImport` i migració real v2→v3 a `src/db/operations.test.ts`/`src/db/schema.test.ts`.

### 2026-07-06 — Menú de manteniment
Afegit `src/views/Maintenance.tsx` (pestanya "Manteniment"): reinicialitza tota la base de dades (esborra comptes/moviments/lots/regles i reseeda categories per defecte) amb doble confirmació (frase exacta "ESBORRA-HO TOT" + `confirm()` del navegador) i opció d'exportar còpia de seguretat abans. Nova funció `reinicialitzaBaseDades()` a `src/db/operations.ts`, exportada `DEFAULT_CATEGORIES` des de `schema.ts`. Nou test `src/db/operations.test.ts`. Eliminada la dependència `papaparse` (mai es va arribar a fer servir cap parser CSV genèric).

### 2026-07-06 — Fase 2: consulta
Implementades totes les vistes de consulta de l'especificació (secció 3.5): selector global de comptes persistit (`useCompteSeleccio`, `CompteSelector`), panell general amb gràfic d'evolució (Recharts), vista de saldos a una data, llistat de moviments filtrable/ordenable/exportable a CSV, resum mensual per categoria, gestor de categories i regles de categorització automàtica, detector heurístic de transferències internes (suggeriment, no automàtic), i còpia de seguretat JSON (exportar/importar). Bump de l'esquema Dexie a la versió 2 (`categories`, `regles`, `categoriaId` a `Moviment`).

**Bug detectat i corregit durant la verificació**: les categories per defecte no es creaven mai en una base de dades nova, perquè `.upgrade()` de Dexie només s'executa en migrar una BD *existent*, no en crear-ne una de nova (Dexie salta directament a l'esquema més recent). Corregit afegint un handler de l'esdeveniment `populate` de Dexie a `schema.ts`. Afegit `fake-indexeddb` com a dev dependency i `src/db/schema.test.ts` com a test de regressió.

Verificat amb un script d'integració puntual contra els 7 fitxers reals de `Samples/`: categorització automàtica, detecció de transferències (31 suggeriments trobats, incloent-hi positius certs verificables pels noms dels titulars i algun fals positiu esperat per coincidència d'import), resum mensual, i roundtrip exacte d'exportar/importar còpia de seguretat.

### 2026-07-06 — Fase 1: esquelet i ingesta (commit `b4be46e`)
Projecte Vite+React+TS creat des de zero. Implementats:
- Parser Norma 43 (`src/parsers/norma43.ts`) per a Sabadell i BBVA, amb offsets validats contra l'especificació oficial AEB/CECA i contrastats amb fitxers reals (checksums de saldo quadrant exactament).
- Parsers de taula per a ING (compte i targeta), BBVA (targeta) i OpenBank (compte), amb detecció de banc per capçalera (mai per posició fixa) i extracció del número de compte/targeta de les metadades del fitxer.
- Deduplicació determinista per hash (`src/dedup/`).
- Assistent de mapatge manual de columnes com a alternativa quan falla la detecció automàtica.
- Esquema Dexie (`Compte`, `Moviment`, `LotImportacio`) i operacions bàsiques (`src/db/operations.ts`): important amb dedup, desfer lot.
- UI mínima: assistent d'importació amb previsualització i resum, llistat de lots amb "desfer".
- 45 tests unitaris inicials + verificació d'integració amb fitxers reals de tots els bancs (incloent-hi BBVA, ampliat respecte a l'especificació original a petició explícita, atès que l'usuari va aportar fitxers reals d'aquest banc).
- `xlsx` instal·lat des del CDN de SheetJS en lloc de npm per evitar vulnerabilitats sense pedaç conegudes al paquet publicat a npm.
- `Samples/` (fitxers reals de l'usuari) afegit a `.gitignore` per no exposar dades bancàries personals al repositori.
- Repositori pujat a `https://github.com/iogurtungue/gesfam`.
