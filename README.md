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
