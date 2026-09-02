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

## Mobile-Update
- Dashboard: Geldfluss sitzt jetzt als normale Karte neben den Budget-Töpfen. Darunter steht nur noch „Letzte Buchungen“.
- PWA/App-Icon: `manifest.json` startet mit `/?view=addExpense`, dadurch öffnet die installierte App direkt die Eingabeseite.
- Handy-Ansicht: In „Schnell eintragen“ steht oben eine kompakte Budgetübersicht; danach direkt Topf, Betrag, Datum, Notiz.

## Sparkasse Umsatzwecker Import

Money kann ein eigenes IMAP-Postfach regelmäßig nach Sparkassen-Umsatzwecker-Mails prüfen und erkannte Geldausgänge automatisch als Ausgaben eintragen.

Empfohlenes Postfach:

```text
umsatzwecker@dnd-tools.de
```

Konfiguration über Umgebungsvariablen, siehe `.env.example`. Das Passwort gehört ausschließlich auf den Server und niemals ins Repository.

Beispiel:

```bash
export SPARKASSE_MAIL_ENABLED=true
export SPARKASSE_IMAP_HOST=mail.dnd-tools.de
export SPARKASSE_IMAP_PORT=993
export SPARKASSE_IMAP_SECURE=true
export SPARKASSE_IMAP_USER=umsatzwecker@dnd-tools.de
export SPARKASSE_IMAP_PASS='DEIN_PASSWORT'
export SPARKASSE_POLL_INTERVAL_MS=180000
npm start
```

Bekannte Händler werden automatisch zugeordnet, u. a. HIT/Rewe/Lidl/Aldi/Kaufland/Edeka zu `Essen / Mealprep` und Aral/Shell/Jet/Esso zu `Tanken`. Nicht erkannte Händler landen in `Freie Verwendung`.

Der Import schützt über die Mail-Message-ID vor Doppelimporten. Die letzten Importversuche sind unter `/api/mail-import-log` sichtbar.

Wichtig: Das genaue Format der Sparkassen-Umsatzwecker-Mail muss einmal mit einer echten Mail getestet werden. Der Parser ist absichtlich tolerant gebaut, aber Händlername und Buchungsart können je nach Sparkasse anders formuliert sein.
