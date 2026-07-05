# Budget Master

Private, lokale Budget-Webapp ohne Abo. Läuft mit Node/Express und speichert alles in `data.json`.

## Start

```bash
npm install
npm start
```

Danach im Browser öffnen:

```text
http://127.0.0.1:9999
```

## Diese Version

- Komplett neues, schlichtes App-Design ohne Neon-/KI-Look
- Nur noch Budget-Töpfe: keine Ausgabeart, keine freien Tags
- Neuer Standard-Topf `Freie Verwendung` für Steam, Döner, Spiele, spontane Käufe usw.
- Zweck einer Ausgabe wird nur in der Notiz gespeichert
- Budget-Töpfe werden vom nicht verplanten Guthaben reserviert
- Nicht verplantes Guthaben per Auge ein-/ausblendbar
- Geldbudget, Einheitenbudget und Spar-/Notfalltopf
- Wochen-/Abschnittslogik: Überziehung reduziert die restlichen Abschnitte
- Aufrunden von Ausgaben optional
- Saubere Monatsübersicht mit Budget, Ausgaben, Differenz und Nutzung
- CSV-Export
- Separater, druckfreundlicher Monatsbericht als PDF ohne App-Navigation und ohne Löschbuttons

## Datenmodell grob

- `income`: Basis-Nettoeinkommen
- `fixedCosts`: nicht kündbare Fixkosten
- `cancelableCosts`: kündbare Kosten
- `budgetBuckets`: Essen, Tanken, Friseur, Freie Verwendung usw.
- `expenses`: alle Ausgaben sind einem Budget-Topf zugeordnet
- `extraIncome`: Plusgeld in einzelnen Monaten
- `settings`: Anzeige-/Rundungsoptionen
