# ESTAT.md

Aquest fitxer es manté actualitzat segons les instruccions de `CLAUDE.md`. Conté la situació actual del projecte i l'historial cronològic invers de canvis.

## 1. Situació actual

### Què és el projecte

Aplicació web local (Vite + React + TypeScript) per centralitzar moviments bancaris de Banc Sabadell, BBVA, ING i OpenBank, importats manualment des de fitxers d'extracte, amb persistència 100% local (IndexedDB via Dexie). Especificació completa a `especificacio.md`. Sense backend, sense autenticació, sense sortida de dades de la màquina de l'usuari.

### Fases completades

**Fase 1 — Esquelet i ingesta**: parsers per banc, deduplicació, previsualització/resum d'importació, desfer lot.
**Fase 2 — Consulta**: selector global de comptes, panell general, saldos a una data, llistat filtrable, resum mensual, categories i regles, transferències internes, còpia de seguretat JSON, i menú de manteniment (eliminar només els moviments, o reinicialitzar la base de dades sencera).

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

```
src/
  lib/            Utilitats pures i testejades (sense dependència de Dexie/React)
    numbers.ts       parseAmountToCents (tolerant a coma/punt decimal), centsToEs (format espanyol)
    dates.ts         parseFlexibleDate, parseNorma43Date, formatDateEs (dd/mm/aaaa)
    concept.ts       normalizeConceptForDedup
    hash.ts          computeMovimentHash (cyrb53) — id determinista del moviment (spec 3.3)
    encoding.ts      decodeBuffer (UTF-8 amb fallback a Windows-1252)
    categorization.ts   pickCategoriaId (motor de regles "si conté X → categoria Y")
    internalTransfers.ts  suggereixTransferenciesInternes (heurística d'aparellament)
    balance.ts       saldoEnData (reconstrucció de saldo a una data)
    summary.ts       resumPerMesICategoria, resumPerAnyICategoria, resumInterval

  parsers/        Lectura i interpretació de fitxers bancaris (independent de Dexie)
    types.ts         RawTable/RawCell, ParsedMoviment, ParsedAccountInfo, ParseResult
    fileKind.ts      Detecta el format real del fitxer per bytes (norma43/excel/html/unknown)
    excelTable.ts    Lector Excel (SheetJS) → RawTable, amb cellDates:true
    htmlTable.ts     Lector de taules HTML mal formades (OpenBank) → RawTable, sense DOM parser
    tableUtils.ts    locateColumns (capçalera tolerant, no per posició), extractMovimentsFromTable,
                     findLabeledValue (extreu número de compte/targeta de les metadades del fitxer)
    norma43.ts       Parser Norma 43 (registres 11/22/23/24/33/88)
    banks/           Parsers específics per format de taula (ing.ts, bbva.ts, openbank.ts)
    detectBank.ts    Combina els detectors de capçalera dels bancs de taula
    columnMapping.ts Mapatge manual de columnes (fallback quan falla la detecció automàtica)
    importFile.ts    Orquestrador: File → detecta format → parseja → ParseResult[]

  dedup/index.ts   splitNousIDuplicats (deduplicació per hash determinista, spec 3.3)

  db/
    types.ts         Compte, Moviment (inclou `seq`, ordre d'inserció per desempatar
                     moviments del mateix dia), LotImportacio, Categoria, ReglaCategoritzacio
    schema.ts        Dexie (versió 3). Seeding de categories via l'esdeveniment 'populate'
                     (NO via .upgrade(), que no s'executa en una BD nova — vegeu historial)
    operations.ts    Totes les operacions CRUD + lògica de negoci sobre Dexie:
                     importació/dedup/undo, categories/regles, transferències internes,
                     saldo a una data, còpia de seguretat, reinicialització

  hooks/useCompteSeleccio.ts   Selecció global de comptes, persistida a localStorage

  components/CompteSelector.tsx   Selector de comptes compartit per totes les vistes

  views/           Una vista per pestanya de l'app
    Dashboard.tsx, BalanceAtDate.tsx, MovimentsList.tsx, Summary.tsx,
    CategoriesManager.tsx, AccountsManager.tsx, Backup.tsx, Maintenance.tsx

  import/          Flux d'importació (independent de la navegació per pestanyes)
    ImportWizard.tsx, ManualMapping.tsx, LotsList.tsx

  App.tsx          Navegació per pestanyes + estat global (comptes/lots/categories/regles)
```

**Principi de disseny clau**: els parsers (`src/parsers/`) mai depenen de Dexie ni de React — reben bytes/RawTable i retornen `ParseResult` pla. Tota la lògica de negoci amb efectes (BD, categorització automàtica, dedup) viu a `src/db/operations.ts`. Això permet testejar els parsers amb fixtures sintètiques sense IndexedDB, i testejar `operations.ts` amb `fake-indexeddb` quan cal.

### Decisions preses (no reobrir sense motiu)

- **Unitats monetàries**: sempre cèntims enters (`importCents`, `saldoPosteriorCents`), mai float en euros, per evitar errors d'arrodoniment als hash de deduplicació i sumes. La conversió a text només passa a la UI (`centsToEs`).
- **Deduplicació**: id = hash(banc, compteId, dataOperació, import, concepte normalitzat, saldo posterior). Limitació documentada (spec 3.3): dos moviments idèntics el mateix dia amb el mateix saldo posterior col·lideixen; es tracta com a duplicat.
- **Targetes de crèdit**: no tenen columna de saldo a l'origen, així que el "saldo" mostrat és el deute acumulat dels moviments importats (suma de `importCents`), no un saldo bancari verificat. Etiquetat com a tal a la UI (spec 3.2.1).
- **Transferències internes**: mai es marquen automàticament. Hi ha un detector heurístic (`suggereixTransferenciesInternes`) que proposa parelles (mateix import, signe oposat, comptes diferents, ±2 dies) però requereix confirmació explícita de l'usuari — validat amb dades reals que produeix tant positius certs com falsos positius plausibles.
- **Categories/regles**: aplicades automàticament en importar (moviments nous), mai sobreescriuen una categoria ja assignada manualment. Hi ha un botó per reaplicar regles només als moviments sense categoria.
- **Número de compte per deduplicar entre sessions**: els bancs de taula (ING/BBVA-targeta/OpenBank) no posen el número de compte a la capçalera de moviments — es va afegir `findLabeledValue` per extreure'l de les metadades del fitxer (p. ex. "Número de cuenta:"), imprescindible perquè l'app reconegui "aquest fitxer ja és d'aquest compte" entre importacions separades.
- **xlsx via CDN de SheetJS, no npm**: la versió publicada a npm té vulnerabilitats conegudes sense pedaç (prototip pollution, ReDoS) perquè SheetJS distribueix les versions corregides des del seu propi CDN. `package.json` apunta a `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.
- **`Samples/` mai es commiteja**: conté fitxers reals d'extractes bancaris de l'usuari (dades personals/financeres). Exclòs via `.gitignore`.
- **`Moviment.seq`**: IndexedDB no garanteix retornar les files en ordre d'inserció, així que `dataOperacio` per si sola no basta per ordenar cronològicament una llista — cal un desempat explícit per a moviments del mateix dia. `commitImport` assigna `seq` estrictament creixent seguint l'ordre del fitxer parsejat (mai l'ordre de retorn de la BD). El llistat de moviments (`views/MovimentsList.tsx`) fa servir `seq` directament com a desempat. **`seq` NO és fiable per a dades migrades des d'abans que existís aquest camp** (backfill "millor esforç", vegeu historial) — per això `lib/balance.ts` (`saldoEnData`) reconstrueix l'ordre cronològic real a partir de la cadena de saldos (`saldoPosteriorCents`/`importCents` de cada moviment), i només recorre a `seq` com a últim recurs quan la cadena no es pot resoldre (buit, primer moviment de la història, duplicats ambigus).

### Estat de les proves

91 tests (Vitest), tots passant. `npm run build` i `npx tsc -b --noEmit` nets. Cobertura:
- Parsers (Norma 43 amb fixtures sintètiques que repliquen l'estructura validada, ING/BBVA/OpenBank amb `RawTable` sintètics).
- Deduplicació (col·lisions, mateix moviment en comptes diferents, límit documentat).
- Utilitats de `lib/` (números, dates, concepte, hash, categorització, transferències, saldo, resum mensual).
- `db/schema.test.ts` i `db/operations.test.ts` amb `fake-indexeddb` (dev dependency): regressió del bug de seeding de categories, de `reinicialitzaBaseDades`, de `eliminaTotsElsMoviments`, de l'assignació de `seq` a `commitImport`, i de la migració real v2→v3 (simulant un usuari amb dades ja existents).

A més de les proves unitàries, cada fase s'ha verificat amb un script d'integració puntual (no committed) que importa els fitxers reals de `Samples/` dues vegades seguides via `fake-indexeddb`, confirmant 0 duplicats/0 files perdudes en la reimportació — el criteri d'acceptació explícit de la Fase 1.

### Pendent / coses obertes

- **[OBERT] de l'especificació, sense confirmar encara**: despesa difusa a la previsió (fase 4) i llindar d'alerta de saldo mínim.
- **Fase 3 (recurrents) i Fase 4 (previsió)**: no iniciades.
- **Fase 5 (opcional)**: simulacions manuals, exportacions addicionals — no iniciades.
- El bundle de producció supera els 500 kB (principalment per `xlsx` i `recharts`); Vite ho avisa en el build però no s'ha considerat necessari fer code-splitting per a una app d'ús personal.
- No hi ha commit ni push de la Fase 2, del menú de manteniment, ni de la correcció d'ordenació encara (últim commit: `b4be46e`, només Fase 1).
- Si l'usuari ja té dades reals importades al navegador (versió Fase 2 sense `seq`), la migració a la versió 3 assigna un `seq` d'ordre "millor esforç" (per data, després per data d'importació del lot) a les dades antigues, ja que l'ordre original exacte del fitxer no es pot recuperar retroactivament; les importacions noves sí que tindran l'ordre exacte del fitxer.

## 2. Historial de canvis

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
