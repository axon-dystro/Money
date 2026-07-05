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

## Neu in dieser Version

- Moderne Dashboard-Oberfläche
- Budget-Töpfe statt nur einfache Tags
- Reservierte Budgets werden direkt vom frei verfügbaren Geld abgezogen
- Freies Guthaben per Auge ein-/ausblendbar
- Geldbudget, Einheitenbudget und Spar-/Notfalltopf
- Automatische Wochen-/Abschnittslogik: Überziehung einer Woche reduziert die restlichen Wochen
- Freie Ausgaben wie Steam/Restaurant gehen nicht aus Budget-Töpfen raus
- Ausgaben können automatisch aufgerundet werden
- Monatsreport mit Prozent-/Differenzanzeige
- CSV-Export
- PDF über Drucken/Speichern als PDF

## Datenmodell grob

- `income`: Basis-Nettoeinkommen
- `fixedCosts`: nicht kündbare Fixkosten
- `cancelableCosts`: kündbare Kosten
- `budgetBuckets`: Essen, Tanken, Friseur, Notfall usw.
- `expenses`: alle Ausgaben, entweder `budget` oder `free`
- `extraIncome`: Plusgeld in einzelnen Monaten
- `settings`: Anzeige-/Rundungsoptionen
