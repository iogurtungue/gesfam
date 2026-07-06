# Especificació de projecte: Centralitzador d'extractes bancaris amb previsió de tresoreria

> Document destinat a Claude Code. Conté els requisits funcionals, l'arquitectura proposada, el model de dades i el pla de fases. Les decisions ja preses estan marcades com a **[DECIDIT]**; els punts que requereixen confirmació de l'usuari, com a **[OBERT]**.

## 1. Context i objectiu

L'usuari treballa amb tres bancs espanyols: **Banc Sabadell**, **ING (España)** i **OpenBank**. Vol una aplicació d'ús estrictament personal que:

1. **Centralitzi els moviments bancaris** dels tres bancs, importats manualment mitjançant els fitxers d'extracte (CSV/Excel) que cada banc permet descarregar.
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

- Cada targeta es modela com un **compte de tipus «targeta de crèdit»**, vinculat opcionalment al compte corrent on es liquida.
- El «saldo» d'una targeta de crèdit és el **deute pendent acumulat** del període, no un saldo disponible; les vistes ho han d'etiquetar clarament per no confondre'l amb els saldos de compte.
- **Evitar el doble còmput**: la liquidació mensual de la targeta apareix com un càrrec únic al compte corrent («liquidación tarjeta…») i, alhora, els moviments detallats apareixen a l'extracte de la targeta. Cal detectar (o permetre marcar) el càrrec de liquidació com a **transferència interna targeta→compte**, de manera que a efectes d'agregats i de previsió la despesa es compti una sola vegada (pel detall de targeta, que és més ric per a categories i recurrents).
- La deduplicació (3.3) s'aplica igualment als moviments de targeta; com que sovint no hi ha columna de saldo, el hash es calcula sense aquest camp i cal documentar la limitació amb compres idèntiques el mateix dia.
- A la previsió (secció 4), els recurrents detectats en targeta es projecten segons la data de **liquidació al compte corrent** (configurable per targeta: dia del mes de càrrec), que és quan afecten realment la tresoreria.

### 3.3 Deduplicació

Cada moviment rep un identificador determinista: hash de `(banc, compte, data operació, import, concepte normalitzat, saldo posterior)`. En reimportar un extracte que se solapa amb un d'anterior (cas habitual: l'usuari descarrega sempre «últims 90 dies»), els moviments ja existents s'ignoren silenciosament. Cal contemplar el cas de **dos moviments legítimament idèntics el mateix dia** (mateix import i concepte): el saldo posterior al hash ho resol en la majoria de casos; documentar la limitació residual.

### 3.4 Model de dades

- **Compte**: id, banc (sabadell | ing | openbank | altre), **tipus (compte corrent | targeta de crèdit)**, àlies definit per l'usuari, IBAN o últims 4 dígits opcionals, saldo actual conegut i data d'aquest saldo; per a targetes: compte corrent de liquidació vinculat i dia del mes de liquidació.
- **Moviment**: id (hash), compteId, dataOperació, dataValor, concepte original, concepte normalitzat, import (positiu = ingrés, negatiu = càrrec), saldo posterior si es coneix, categoria, lotImportació, marca de recurrència (vegeu funcionalitat 2).
- **LotImportació**: id, data, fitxer d'origen, banc, nombre de moviments, per poder desfer una importació sencera.
- **Categoria**: llista editable amb categories predefinides raonables (habitatge, subministraments, alimentació, transport, nòmina, impostos, oci, transferències internes…). Categorització per **regles** definibles per l'usuari («si el concepte conté ENDESA → subministraments») que s'apliquen automàticament en importar.
- **Transferències internes**: detectar (o permetre marcar) moviments entre els comptes propis perquè no comptin com a ingrés/despesa real en agregats ni en la previsió.

### 3.5 Vistes de consulta

- **Selector de comptes global**: totes les vistes de consulta han de disposar d'un selector multi-compte persistent que permeti visualitzar **un compte, una combinació lliure de comptes o tots alhora** (comptes corrents i targetes). La selecció s'aplica coherentment a tota la vista (saldos, gràfics, llistats) i es recorda entre sessions.
- **Panell general**: saldo per compte i saldo total consolidat de la selecció activa, data de l'últim moviment importat per compte (amb avís si un compte fa massa dies que no s'actualitza), gràfic d'evolució del saldo consolidat.
- **Vista de saldos a una data**: a partir de la selecció de comptes, poder consultar la **foto dels saldos en un moment determinat** — un selector de data que mostri el saldo que tenia cada compte seleccionat aquell dia (reconstruït a partir dels moviments) i el total consolidat, per comparar la posició de tresoreria entre dates.
- **Llistat de moviments**: taula unificada amb filtres per compte, rang de dates, categoria, text del concepte i tipus (ingrés/càrrec); ordenable; exportable a CSV.
- **Resum mensual**: ingressos vs despeses per mes i per categoria, respectant la selecció de comptes activa.

## 4. Funcionalitat 2 — Detecció de recurrents i previsió

### 4.1 Detecció de moviments recurrents

Algorisme sobre l'històric (mínim recomanat: 3-6 mesos de dades; avisar l'usuari si n'hi ha menys):

1. **Normalització del concepte**: majúscules, eliminació de números variables (dates, referències, números de rebut), col·lapse d'espais. Objectiu: que «RECIBO ENDESA REF 0012345» i «RECIBO ENDESA REF 0012399» agrupin junts.
2. **Agrupació** per (concepte normalitzat, signe de l'import) i, com a criteri secundari, per import similar (tolerància configurable, p. ex. ±15% per a rebuts variables com la llum).
3. **Anàlisi de periodicitat**: calcular els intervals entre ocurrències i classificar-los amb tolerància: setmanal (7±2 dies), mensual (30±4), bimestral, trimestral, semestral, anual. Contemplar el patró «mateix dia del mes» amb desplaçament per caps de setmana.
4. **Resultat per patró**: periodicitat, import estimat (mediana; per a imports variables, mediana + rang), propera data prevista, confiança (nombre d'ocurrències i regularitat).
5. **Revisió per l'usuari**: pantalla on confirmar, corregir (periodicitat o import), ignorar o afegir manualment recurrents que l'algorisme no ha vist (p. ex. un rebut anual amb una sola ocurrència a l'històric). **La confirmació de l'usuari mana sempre sobre la detecció automàtica.**

### 4.2 Motor de previsió

- Punt de partida: saldo consolidat actual (i per compte).
- Projecció dia a dia fins a l'horitzó triat (30 / 60 / 90 dies, i camp lliure): a cada data prevista d'un recurrent confirmat, aplicar-ne l'import estimat.
- **[OBERT]** Despesa no recurrent: oferir com a opció activable afegir una estimació de despesa difusa diària (mitjana de la despesa no recurrent dels últims N mesos), mostrada com a banda d'incertesa al gràfic, no com a línia única. Confirmar amb l'usuari si ho vol a la v1 o a una fase posterior.
- **Sortides**: gràfic de saldo projectat (línia de saldo cert-a-avui + projecció, amb banda optimista/pessimista si s'activa la despesa difusa), taula cronològica dels moviments previstos, i **alertes**: dates en què el saldo projectat (total o d'un compte) baixa d'un llindar configurable o es fa negatiu.
- **Simulació manual** (desitjable, fase 2): afegir moviments hipotètics puntuals («i si pago 3.000 € el dia 15?») i veure l'efecte sobre la corba.

## 5. Fora d'abast (v1)

Multiusuari i autenticació; connexió automàtica amb bancs; app mòbil nativa; gestió d'inversions o productes que no siguin comptes corrents; sincronització al núvol. No implementar res d'això encara que sigui fàcil: mantenir el projecte petit.

## 6. Pla de fases proposat per a Claude Code

1. **Fase 1 — Esquelet i ingesta**: monorepo amb backend Node+TS (Express/Fastify, better-sqlite3, esquema SQLite amb migracions) i frontend Vite+React+TS; arrencada unificada amb `npm start`; importador amb detecció de banc + mapatge manual (parseig al backend), deduplicació, previsualització i resum d'importació, desfer lot, còpia automàtica del `.db` abans d'importar. *Criteri d'acceptació*: importar dos extractes solapats de cada banc real sense duplicats ni files perdudes, i verificar que les dades persisteixen després de reiniciar servidor i navegador.
2. **Fase 2 — Consulta**: panell general, selector multi-compte, vista de saldos a una data, llistat filtrable, resum mensual, regles de categorització, transferències internes, exportació/importació JSON. *Criteri*: retrobar qualsevol moviment en <10 segons amb els filtres.
3. **Fase 3 — Recurrents**: detecció, pantalla de revisió/confirmació, recurrents manuals. *Criteri*: detectar correctament nòmina, hipoteca/lloguer i 3+ subministraments de l'històric real de l'usuari.
4. **Fase 4 — Previsió**: motor de projecció, gràfic, taula, alertes de llindar. *Criteri*: la previsió a 30 dies quadra amb el que l'usuari espera manualment (±revisió conjunta).
5. **Fase 5 (opcional)**: parser Norma 43, simulacions, despesa difusa, exportacions addicionals.

Desenvolupar **fase per fase**, validant amb l'usuari abans de passar a la següent. Escriure tests unitaris com a mínim per als parsers, la deduplicació i la detecció de periodicitat (són el cor del sistema i els punts més fràgils).

## 7. Material que aportarà l'usuari

- Un fitxer d'extracte real (o anonimitzat: es poden alterar imports i conceptes mantenint l'estructura) de **cada un dels tres bancs**, imprescindible abans d'implementar cada parser.
- Un fitxer d'extracte de **cada targeta de crèdit** que vulgui incloure, més el dia de liquidació mensual de cada targeta.
- Confirmació dels punts **[OBERT]**.
- Llindar d'alerta de saldo mínim desitjat.
- Requisit previ a la màquina: tenir **Node.js** (versió LTS) instal·lat.
