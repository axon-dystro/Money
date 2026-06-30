# Budget Master

Private Budget-Web-App/PWA für Node + PM2 + Nginx. Daten liegen lokal in `data.json`.

## Installation
```bash
npm install
pm start
```

## PM2
```bash
pm2 start server.js --name budget-master
pm2 save
```

Die App lauscht nur intern auf `127.0.0.1:9999`.

## Nginx Beispiel
```nginx
server {
    listen 80;
    server_name DEINE-DOMAIN.DE;

    location / {
        proxy_pass http://127.0.0.1:9999;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Danach iPhone Safari öffnen → Teilen → Zum Home-Bildschirm.


## v6 Fix
- Server normalisiert Datumswerte jetzt auch dann, wenn Safari/Textfelder TT.MM.JJJJ schicken.
- Plusgeld wird auch erkannt, wenn alte Daten im Format TT.MM.JJJJ gespeichert wurden.
- Service Worker auf Network-First geändert, damit Safari/PWA weniger alte Dateien cached.


## v8
- Kalenderzellen wieder quadratischer.
- Tag oben links und Wochentag oben rechts sauber in den Ecken.
- Einträge bleiben mittig/sauber im Kalenderfeld.

## v10 Änderungen
- Monatsübersicht hat jetzt einen zugeklappten Bereich „Konsumkosten anzeigen/bearbeiten“.
- Konsumkosten können gelöscht und über ✎ bearbeitet werden.
- Beim Klick auf einen Kalendertag öffnet sich ein internes Popup mit allen Einträgen dieses Tages.
- Im Tages-Popup können Einträge ebenfalls gelöscht oder bearbeitet werden.
- Beim Bearbeiten sind Kategorie-Dropdown, Betrag, Datum und Notiz änderbar.
- Neuer Server-Endpunkt: `PATCH /api/expense/:id`.
