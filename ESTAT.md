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
    client.ts        getDb() — obre/crea dades/finances.db (node:sqlite DatabaseSync), aplica
                      migracions pendents (versionades per nom de fitxer, taula _migrations),
                      WAL mode. DB_PATH/DADES_DIR overridables per GESFAM_DB_PATH/GESFAM_DADES_DIR
                      (tests fan servir ':memory:')
    backupFile.ts     backupDbFile() — checkpoint WAL + còpia timestampada a dades/backups/,
                      reté només les N més recents. Cridada abans de commitImport, eliminaCompte,
                      importaCopiaSeguretat, reinicialitzaBaseDades, eliminaTotsElsMoviments
    types.ts          Compte, Moviment (amb `seq`), LotImportacio, Categoria, ReglaCategoritzacio
                      (interfícies camelCase; mapeig manual a/des de columnes snake_case)
    operations.ts     Tota la lògica de negoci sobre SQLite: importació/dedup/undo,
                      categories/regles, transferències internes, còpia de seguretat,
                      reinicialització — equivalent 1:1 al `db/operations.ts` de Dexie de l'antiga
                      arquitectura, ara amb SQL preparat en lloc de crides a Dexie

  lib/              Utilitats pures i testejades (numbers, dates, concept, hash, encoding,
                     categorization, internalTransfers) — subconjunt "de backend" (parseig/dedup)
                     de les utilitats originals

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
  views/            Dashboard.tsx, BalanceAtDate.tsx, MovimentsList.tsx, Summary.tsx,
                    CategoriesManager.tsx, AccountsManager.tsx, Backup.tsx, Maintenance.tsx
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
- **Transferències internes**: mai es marquen automàticament. Hi ha un detector heurístic (`suggereixTransferenciesInternes`) que proposa parelles (mateix import, signe oposat, comptes diferents, ±2 dies) però requereix confirmació explícita de l'usuari — validat amb dades reals que produeix tant positius certs com falsos positius plausibles.
- **Categories/regles**: aplicades automàticament en importar (moviments nous), mai sobreescriuen una categoria ja assignada manualment. Hi ha un botó per reaplicar regles només als moviments sense categoria.
- **Número de compte per deduplicar entre sessions**: els bancs de taula (ING/BBVA-targeta/OpenBank) no posen el número de compte a la capçalera de moviments — es va afegir `findLabeledValue` per extreure'l de les metadades del fitxer (p. ex. "Número de cuenta:"), imprescindible perquè l'app reconegui "aquest fitxer ja és d'aquest compte" entre importacions separades.
- **xlsx via CDN de SheetJS, no npm** (backend): la versió publicada a npm té vulnerabilitats conegudes sense pedaç (prototip pollution, ReDoS) perquè SheetJS distribueix les versions corregides des del seu propi CDN. `backend/package.json` apunta a `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.
- **`Samples/` i `dades/` mai es commitegen**: `Samples/` conté fitxers reals d'extractes bancaris de l'usuari; `dades/` conté el `finances.db` real i les seves còpies de seguretat. Totes dues exclosos via `.gitignore`.
- **`Moviment.seq`**: cap font de dades (abans IndexedDB, ara SQL sense `ORDER BY` explícit) garanteix retornar les files en ordre d'inserció, així que `dataOperacio` per si sola no basta per ordenar cronològicament una llista — cal un desempat explícit per a moviments del mateix dia. `commitImport` assigna `seq` estrictament creixent seguint l'ordre del fitxer parsejat (mai l'ordre de retorn de la BD). El llistat de moviments (`views/MovimentsList.tsx`) fa servir `seq` directament com a desempat. `lib/balance.ts` (`saldoEnData`, frontend) reconstrueix igualment l'ordre cronològic real a partir de la cadena de saldos (`saldoPosteriorCents`/`importCents` de cada moviment) per no dependre només de `seq` en dades antigues, i només hi recorre com a últim recurs quan la cadena no es pot resoldre (buit, primer moviment de la història, duplicats ambigus).

### Estat de les proves

Backend: 73 tests (Vitest) — parsers, dedup, `lib/`, `db/operations.ts` contra SQLite en memòria (`GESFAM_DB_PATH=':memory:'`), `db/client.ts` (migracions) i `db/backupFile.ts` (còpia + retenció). Frontend: 22 tests — `lib/balance.ts`, `lib/summary.ts`, `lib/dates.ts`, `lib/numbers.ts` (només lògica de visualització, ja no hi ha res a testejar amb `fake-indexeddb`). `npx tsc -b` net a totes dues bandes, `npm run build` (frontend) i `oxlint` (frontend) nets.

Verificació addicional (no automatitzada, feta manualment durant la migració d'arquitectura, vegeu historial): migració de la còpia de seguretat JSON real de l'usuari (4 comptes, 266 moviments, 4 lots, 23 categories, 15 regles) a SQLite amb comparació camp a camp — 0 diferències reals; arrencada de `npm start` real contra `dades/finances.db` migrat, import/undo/eliminar compte de prova via HTTP (confirmant que `backupDbFile()` es dispara), i reinici del servidor confirmant que les dades hi són intactes.

### Pendent / coses obertes

- **[OBERT] de l'especificació, sense confirmar encara**: despesa difusa a la previsió (fase 4) i llindar d'alerta de saldo mínim.
- **Migració d'arquitectura pendent de validació de l'usuari** (vegeu criteri d'acceptació a l'historial) — **no s'ha d'iniciar la Fase 3 fins que l'usuari ho confirmi**.
- **Fase 3 (recurrents) i Fase 4 (previsió)**: no iniciades.
- **Fase 5 (opcional)**: simulacions manuals, exportacions addicionals — no iniciades.
- El bundle de producció del frontend supera els 500 kB (principalment `recharts`); Vite ho avisa en el build però no s'ha considerat necessari fer code-splitting per a una app d'ús personal.
- Verificació manual en navegador (clic a clic) de la migració encara pendent per part de l'usuari — la verificació feta fins ara ha estat via API (curl) i tests automatitzats, no interacció real amb la UI.
- Cap canvi d'aquesta migració s'ha commitejat ni pujat encara (últim commit `2b68f78`, Fase 2 + correccions).

## 2. Historial de canvis

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
