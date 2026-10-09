# bomkeeper.dev – Landingpage

Statische Seite ohne Build-Schritt und ohne JavaScript. Schriften liegen lokal unter `fonts/`. Die Warteliste wird ueber die eigene Azure Functions API verarbeitet; Azure Table Storage speichert die Anmeldungen und Azure Communication Services versendet die Double-Opt-in-E-Mails.

Die Infrastruktur inklusive der bestehenden Static Web App wird unter [`../infrastructure/`](../infrastructure/README.md) mit Terraform verwaltet. API, Tests und Wartungsbefehle stehen unter [`../api/`](../api/README.md).

| Datei | Zweck |
| --- | --- |
| `index.html` | Landingpage |
| `imprint.html`, `privacy.html` | **Vorlagen** für Impressum und Datenschutz – vor dem Livegang ausfüllen und prüfen lassen |
| `404.html` | Fehlerseite |
| `staticwebapp.config.json` | Azure Static Web Apps: Sicherheits-Header, Caching, 404 |
| `favicon.svg`, `robots.txt`, `sitemap.xml` | Icon und Suchmaschinen |
| `.github/workflows/deploy-website.yml` | Automatisches Deployment bei jedem Push |

## Vor dem Livegang ersetzen

Suche nach `[` in allen HTML-Dateien:

- `[PRICE]` – Preis im Cloud-Tarif
- `florian.lenz@neocentric.de` – Kontaktadresse
- Die verlinkte Datenschutzerklaerung um Warteliste, Azure-Dienste, Einwilligung und Loeschfristen erweitern.
- Platzhalter in `imprint.html` und `privacy.html`

## Empfohlen: Azure Static Web Apps (Free)

`.dev`-Domains funktionieren in Browsern **nur mit HTTPS** (die Endung ist HSTS-preloaded). Static Web Apps liefert dafür kostenlos ein Zertifikat für die eigene Domain, auch für die Apex-Domain `bomkeeper.dev`. Blob Storage kann das nur zusammen mit Azure Front Door (kostenpflichtig, siehe unten).

### Variante A: per CLI aus dem Projekt-Root

Zuerst die Terraform-Infrastruktur uebernehmen bzw. bereitstellen und die E-Mail-Domain verifizieren, siehe Infrastruktur-README. Danach Website **und API gemeinsam** deployen:

```bash
cd api
npm ci
npm test
cd ..
npx --yes @azure/static-web-apps-cli@2.0.10 deploy ./website \
  --api-location ./api --api-language node --api-version 22 \
  --env production --app-name bomkeeper-web --resource-group rg-bomkeeper-web
```

Nicht mit `sudo` ausfuehren. Der Command deployt keine Infrastruktur. Ohne
konfigurierte API-Einstellungen und verifizierten E-Mail-Absender nimmt das
Formular keine Anmeldungen entgegen.

### Variante B: automatisch per GitHub Actions

1. `website/`, `api/` und `.github/` muessen im Repo-Root liegen; Infrastruktur vorher mit Terraform bereitstellen.
2. Den Deployment-Token der Static Web App als Repository-Secret `AZURE_STATIC_WEB_APPS_API_TOKEN` hinterlegen.
3. Jeder Push auf `main`, der Website, API oder Workflow aendert, testet die API und deployt Website und API.

### Eigene Domain bomkeeper.dev

Im Portal: Static Web App → **Custom domains** → **+ Add**.

- **Apex (`bomkeeper.dev`):** TXT-Eintrag zur Validierung, danach ein `ALIAS`/`ANAME`-Eintrag auf die `*.azurestaticapps.net`-Adresse. Unterstützt dein DNS-Anbieter das nicht, die Zone nach Azure DNS umziehen oder notfalls einen `A`-Eintrag auf die `stableInboundIP` setzen.
- **`www.bomkeeper.dev`:** `CNAME` auf die `*.azurestaticapps.net`-Adresse. Beide Domains sind in Terraform als eigene Domainbindungen enthalten; eine Weiterleitung beim Registrar ist nicht erforderlich.

Anleitungen: [Apex-Domain](https://learn.microsoft.com/azure/static-web-apps/apex-domain-external) · [www-Subdomain](https://learn.microsoft.com/azure/static-web-apps/custom-domain-external)

## Alternative: Blob Storage (Static Website)

Funktioniert, aber: keine eigenen HTTP-Header (die Sicherheits-Header aus `staticwebapp.config.json` greifen nicht) und **kein HTTPS mit eigener Domain** ohne Azure Front Door. Für `bomkeeper.dev` daher nur mit Front Door sinnvoll.

```bash
az storage account create -n <name> -g rg-bomkeeper-web -l westeurope --sku Standard_LRS --kind StorageV2
az storage blob service-properties update --account-name <name> --static-website \
  --index-document index.html --404-document 404.html --auth-mode login
az storage blob upload-batch --account-name <name> -s . -d '$web' --overwrite --auth-mode login
```

## Lizenzen

Instrument Sans und JetBrains Mono stehen unter der SIL Open Font License 1.1 (siehe `fonts/`).
