# Instruccions del projecte

## Documentació de canvis (OBLIGATORI)
Mantén sempre actualitzat el fitxer `ESTAT.md` a l'arrel del projecte:

- Abans de començar qualsevol tasca, llegeix `ESTAT.md` per entendre la situació actual.
- Després de CADA canvi significatiu (crear/modificar/eliminar fitxers, 
  instal·lar dependències, canviar configuració), actualitza `ESTAT.md`.
- El fitxer ha de tenir aquesta estructura:
  1. **Situació actual**: descripció de l'estat del projecte, arquitectura, 
     decisions preses, coses pendents.
  2. **Historial de canvis**: llista cronològica inversa (el més recent a dalt) 
     amb data, descripció del canvi i fitxers afectats.
- No esborris mai entrades de l'historial; només afegeix-ne.

## Verificació de canvis de frontend/UI
No facis servir l'eina de navegador (Playwright MCP) per provar l'aplicació. Les proves manuals a la interfície les fa l'usuari.

- Verifica igualment amb `tsc -b`, `oxlint`, `npm run build` i els tests existents.
- Si cal comprovar comportament en temps d'execució (dades, càlculs, rutes), fes-ho contra una còpia temporal de `dades/finances.db` via HTTP (`curl`/script), mai amb un navegador.
- Deixa clar en el resum final quines parts encara necessiten confirmació visual de l'usuari.