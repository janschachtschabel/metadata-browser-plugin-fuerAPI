# WLO Metadaten-Agent — Browser Plugin

**Version:** 7.0.0  
**Browser:** Chrome, Edge (Manifest V3)  
**Kein iframe** — die Angular-Webkomponente läuft direkt in der Sidebar

---

## Features

### 🔍 KI-Erschließung
Metadaten beliebiger Bildungsressourcen per KI extrahieren, prüfen und ins WLO-Repository hochladen — als angemeldeter Nutzer oder Gast.

### 🛒 Warenkorb / Unterrichtsplanung
Materialien von [WirLernenOnline](https://suche.wirlernenonline.de) sammeln und zu einem druckbaren Unterrichtsentwurf zusammenstellen:

- **Thema, Fach, Bildungsstufe** wählen
- **Auto-Füllen** — KI-gestützte Materialsuche nach Unterrichtsphasen
- **WLO-Overlay** — 🛒-Icons direkt auf den Suchergebnis-Kacheln
- **Drag & Drop** — Materialien zwischen Phasen verschieben
- **Drucken / PDF** — fertigen Unterrichtsentwurf exportieren

### 📋 Merkliste & Verlauf
Webseiten vormerken und später erschließen. Alle Uploads werden im Verlauf gespeichert.

---

## Architektur

```
┌──────────────────────────────────────────────────────────┐
│  Browser Plugin (Manifest V3)                            │
│                                                          │
│  ┌──────────────┐  ┌─────────────────────────────────┐   │
│  │  sidebar.js   │  │  <metadata-agent-canvas>        │   │
│  │  (Event-      │←→│  Angular Web Component          │   │
│  │   Bridge)     │  │  (lokal gebündelt, kein iframe)  │   │
│  └──────┬───────┘  └──────────────┬──────────────────┘   │
│         │                         │                       │
│  ┌──────┴───────┐          ┌─────┴────────────┐         │
│  │ background.js │          │ Backend API      │         │
│  │ (Upload,Auth) │          │ (KI-Extraktion)  │         │
│  └──────┬───────┘          └─────────────────┘         │
│         │                                                │
│  ┌──────┴──────────────────────────────────────────┐     │
│  │  WLO Repository (edu-sharing REST API)          │     │
│  └─────────────────────────────────────────────────┘     │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │  WLO-Overlay + Interceptor (Content Scripts)     │    │
│  │  → 🛒 Icons auf suche.wirlernenonline.de         │    │
│  │  → Fängt Such-API-Responses für NodeId-Cache     │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │  Warenkorb (sidebar)                             │    │
│  │  → Unterrichtsphasen + Materialsammlung          │    │
│  │  → Auto-Füllen, Suche, Drag & Drop              │    │
│  │  → Druck / PDF Export                            │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

---

## Quick Start

### 1. Plugin laden (Entwicklermodus)

1. `chrome://extensions/` öffnen
2. **Entwicklermodus** aktivieren (oben rechts)
3. **Entpackte Erweiterung laden** → Ordner `metadata-browser-plugin-fuerAPI` wählen
4. Plugin-Icon erscheint in der Toolbar

### 2. Erschließung

1. Eine Webseite mit Bildungsmaterial öffnen
2. Plugin-Icon klicken → Sidebar öffnet sich
3. Optional: Mit WLO-Account anmelden (für direkten Upload)
4. **„Erschließung starten"** klicken
5. Metadaten werden per KI extrahiert und angezeigt
6. Prüfen, ergänzen, hochladen

### 3. Warenkorb

1. In der Sidebar zum **Warenkorb-Tab** (🛒) wechseln
2. **Thema**, **Fach** und **Bildungsstufe** eingeben
3. **Auto-Füllen** klickt → Materialien werden pro Phase gesucht
4. Oder: Auf [suche.wirlernenonline.de](https://suche.wirlernenonline.de) die 🛒-Icons auf den Kacheln klicken
5. Materialien per Drag & Drop zwischen Phasen verschieben
6. **Drucken / PDF** → fertigen Unterrichtsentwurf exportieren

---

## Dateistruktur

```
metadata-browser-plugin-fuerAPI/
├── manifest.json                 # Manifest V3 — Berechtigungen, Content Scripts
├── config.js                     # Zentrale Konfiguration (API, Repository, Gast)
├── build-extension.ps1           # Build-Script: Webkomponente bauen + kopieren
│
├── background/
│   └── background.js             # Service Worker: Auth, Upload (VCARD, Geo, Aspects), Queue, History
│                                # Lädt config.js via importScripts() (keine hardcoded URLs)
│
├── sidebar/
│   ├── sidebar.html              # Sidebar UI: config.js → window.__ENV → Widget-Scripts
│   ├── sidebar.js                # Event-Bridge: Web Component ↔ Plugin
│   ├── sidebar.css               # Material Design v3 Styles
│   ├── warenkorb.js              # Warenkorb-Controller (Phasen, Drag & Drop, Export)
│   ├── warenkorb-api.js          # WLO edu-sharing ngsearch API + Enrichment
│   ├── warenkorb-patterns.js     # Unterrichtsmuster, Fächer, Bildungsstufen
│   └── assets/                   # Icons, Bilder
│
├── content/
│   ├── content.js                # Page Data Extraction (Meta, OG, DC, Schema.org)
│   ├── wlo-overlay.js            # 🛒-Overlay auf WLO-Suchergebnissen
│   └── wlo-interceptor.js        # Fängt WLO-Such-API-Responses (MAIN world)
│
├── options/
│   ├── options.html              # Einstellungen: API URL, Repo URL, Login
│   ├── options.js
│   └── options.css
│
├── webcomponent/                 # Angular Build (outputHashing: none)
│   ├── main.js                   # ~1.4 MB — Angular App als Web Component
│   ├── polyfills.js
│   ├── runtime.js
│   ├── styles.css
│   └── assets/i18n/              # Übersetzungen (de, en)
│
├── icons/                        # Extension Icons (16, 32, 48, 128)
└── images/                       # WLO Logo
```

---

## Konfiguration

Zentral in `config.js` — **einzige Stelle** zum Ändern der API-URL:

```javascript
const WLO_CONFIG = {
    api: {
        url: 'https://metadata-agent-api.vercel.app',  // ← hier ändern
        localUrl: 'http://localhost:8000'
    },
    repository: {
        url: 'https://repository.staging.openeduhub.net'
    },
    guest: {
        inboxId: '...',
        username: 'WLO-Upload',
        password: '...'
    },
    webcomponent: {
        layout: 'plugin',
        theme: 'edu-sharing',
        highlightAi: false
    }
};
```

### URL-Fluss

Die API-URL fließt aus `config.js` in alle Komponenten:

```
config.js (WLO_CONFIG.api.url)
  │
  ├── sidebar.html:   window.__ENV = { agentUrl: WLO_CONFIG.api.url }
  │                  → Angular bootet mit korrekter URL (i18n, Schema)
  │
  ├── sidebar.js:    API_URL = WLO_CONFIG.getApiUrl()
  │                  → canvas.apiUrl Setter (Fallback)
  │
  └── background.js: importScripts('../config.js')
                     → API_URL für /upload, Schema-Requests
```

> **Wichtig:** `window.__ENV.agentUrl` wird **vor** den Widget-Scripts gesetzt, damit der i18n-Loader beim Angular-Boot bereits die richtige API-URL kennt. Das verhindert 404-Fehler auf localhost.

Überschreibbar via **Einstellungen** (Options-Seite) — custom URLs werden in `chrome.storage.local` gespeichert und von `sidebar.js` / `background.js` beim Start geladen.

---

## Datenfluss

### Erschließung

```
1. User klickt „Erschließung starten"
2. sidebar.js → background.js: tabs.extractPageData
3. background.js → content.js: extractPageData (Meta, OG, DC, Schema.org, Text)
4. sidebar.js: feedDataToCanvas(text, url)
   → Setzt inputMode, userText/sourceUrl auf <metadata-agent-canvas>
5. Webkomponente → Backend /generate: Text + Schema → KI-Metadaten
6. Webkomponente zeigt Ergebnisse an (editierbar)
```

### Upload

```
1. User klickt „Upload" in der Webkomponente
2. <metadata-agent-canvas> feuert 'metadataSubmit' Event
3. sidebar.js bewahrt Header-Felder (metadataset_uri, _source_text, _origins etc.)
   beim Unwrapping der verschachtelten Metadaten → nötig für Extended Data
4. sidebar.js → chrome.runtime.sendMessage({action: 'saveMetadata'})
5. background.js prüft Login-Status:
   → User-Modus: Node im User-Home erstellen
   → Gast-Modus: Node in Gast-Inbox + Workflow starten
6. Duplikat-Check (ccm:wwwurl) vor Upload
7. Node erstellen (POST .../children)
8. Aspects setzen (cm:geographic, cm:author falls nötig)
9. Metadaten schreiben (POST .../metadata?obeyMds=false)
   → VCARD-Transformation: cm:author → ccm:lifecyclecontributer_author
   → Geo-Extraktion: schema:location[].geo → cm:latitude/cm:longitude
   → Lizenz-Transformation: ccm:custom_license → ccm:commonlicense_key
10. Extended Fields schreiben (ccm:oeh_extendedType/Data/Text)
    → User-Modus: background.js schreibt direkt (writeExtendedFields)
    → Gast-Modus: API /upload schreibt (write_extended_data=true)
11. Workflow starten (nur Gast-Modus)
12. Ergebnis → Success/Duplicate Modal + History-Eintrag
```

### Upload-Transformationen (background.js)

| Funktion | Beschreibung |
|----------|-------------|
| `transformAuthorToVcard()` | `cm:author` → VCARD-Format in `ccm:lifecyclecontributer_author` |
| `extractGeoCoordinates()` | `schema:location[].geo` oder `schema:geo` → `cm:latitude`/`cm:longitude` |
| `ensureAspects()` | `cm:geographic` + `cm:author` Aspects nach Node-Erstellung setzen |
| `applyLicenseTransform()` | Lizenz-URI → `ccm:commonlicense_key` + `ccm:commonlicense_cc_version` |
| `writeExtendedFields()` | `ccm:oeh_extendedType` (Inhaltstyp-URI), `ccm:oeh_extendedData` (Metadaten-JSON), `ccm:oeh_extendedText` (Rohtext) |
| `buildAdditionalMetadata()` | Alle Felder normalisieren, Transformationen anwenden, `obeyMds=false` |

### Warenkorb — WLO-Overlay

```
1. User öffnet suche.wirlernenonline.de
2. wlo-interceptor.js (MAIN world) fängt fetch/XHR-Responses der Such-API
   → Extrahiert nodeId, Titel, Publisher, wwwurl aus den Ergebnissen
   → Sendet via postMessage an wlo-overlay.js
3. wlo-overlay.js blendet 🛒-Icons auf jeder Suchergebnis-Kachel ein
4. Klick auf 🛒 → Item wird an die aktive Warenkorb-Phase gesendet
5. warenkorb.js empfängt Item und reichert es mit Metadaten an:
   → Strategie 1: NodeId-Cache (aus Interceptor) → direkte Node-API
   → Strategie 2: Titel-Suche (ngsearch mit Scoring)
6. Angereichertes Item erscheint in der Phase mit wwwurl, Beschreibung etc.
```

---

## Warenkorb — Details

### Unterrichtsmuster

7 vordefinierte Ablaufmuster (in `warenkorb-patterns.js`):

| Muster | Phasen |
|--------|--------|
| Frontalunterricht | Einstieg → Erarbeitung → Sicherung → Transfer |
| Gruppenarbeit | Einstieg → Gruppenarbeit → Präsentation → Reflexion |
| Stationenlernen | Einstieg → Stationen → Sicherung → Reflexion |
| Flipped Classroom | Vorbereitung → Vertiefung → Anwendung → Reflexion |
| Projektarbeit | Einstieg → Planung → Durchführung → Präsentation |
| Werkstattunterricht | Einstieg → Werkstattarbeit → Austausch → Reflexion |
| Lerntheke | Einstieg → Lerntheke → Sicherung → Reflexion |

### Filter

- **Fach** — 26 Fächer mit WLO-Taxonomie-URIs (`virtual:taxonid`)
- **Bildungsstufe** — 10 Stufen mit URIs (`ccm:educationalcontext`)
- **Inhaltstyp** — pro Phase passende LRT-Typen (`ccm:oeh_lrt_aggregated`)

### Enrichment

Beim Hinzufügen eines Items wird automatisch nach vollständigen Metadaten gesucht:

1. **enrichItemByNodeIdDirect** — Node-API mit nodeId (staging + redaktion)
2. **enrichItemByNodeId** — ngsearch-Fallback mit nodeId als Keyword
3. **enrichItemByTitle** — Titel-basierte Suche mit `cleanSearchTerm()` und Multi-Strategie-Scoring

---

## Authentifizierung

| Modus | Upload-Ziel | Workflow |
|-------|-------------|----------|
| **User** | User Home-Verzeichnis | Kein Workflow nötig |
| **Gast** | Gast-Inbox | Workflow → WLO-Uploadmanager |

Login über die Sidebar oder Options-Seite. Session wird in `chrome.storage.local` gespeichert.

---

## Content Scripts

| Script | Kontext | Seiten | Zweck |
|--------|---------|--------|-------|
| `content.js` | ISOLATED | Alle URLs | Seitentext + Metadaten extrahieren |
| `wlo-interceptor.js` | MAIN | wirlernenonline.de | Such-API-Responses abfangen |
| `wlo-overlay.js` | ISOLATED | wirlernenonline.de | 🛒-Icons auf Suchergebnissen |

### wlo-interceptor.js

Läuft im **MAIN world** (Seitenkontext) und überschreibt `fetch()` sowie `XMLHttpRequest`, um die Antworten der edu-sharing ngsearch-API abzufangen. Extrahierte Nodes (nodeId, Titel, Publisher, wwwurl) werden via `postMessage` an `wlo-overlay.js` weitergegeben.

### wlo-overlay.js

Injiziert 🛒-Buttons auf jeder Suchergebnis-Kachel. Beim Klick wird das Item an die aktive Warenkorb-Phase gesendet. Nutzt einen NodeId-Cache aus den intercepteten API-Responses für schnelle und präzise Zuordnung.

---

## Webkomponente aktualisieren

### Option 1: Build-Script

```powershell
# Im Plugin-Ordner:
.\build-extension.ps1
```

Das Script:
1. Baut die Angular-Webkomponente mit `outputHashing: none`
2. Kopiert `main.js`, `polyfills.js`, `runtime.js`, `styles.css` nach `webcomponent/`
3. Kopiert i18n-Assets nach `webcomponent/assets/i18n/`

### Option 2: Manuell aus Web-Component-Projekt

```powershell
# Im metadata-agent-fuerAPI Ordner:
npx ng build --configuration extension

# Dateien kopieren:
copy dist-extension\main.js      ..\metadata-browser-plugin-fuerAPI\webcomponent\
copy dist-extension\polyfills.js  ..\metadata-browser-plugin-fuerAPI\webcomponent\
copy dist-extension\runtime.js    ..\metadata-browser-plugin-fuerAPI\webcomponent\
copy dist-extension\styles.css    ..\metadata-browser-plugin-fuerAPI\webcomponent\
copy dist-extension\assets\i18n\* ..\metadata-browser-plugin-fuerAPI\webcomponent\assets\i18n\
```

### Option 3: Aus API-Widget-Verzeichnis

Falls die API bereits aktuelle Dateien hat:

```powershell
copy ..\metadata-agent-api\src\static\widget\dist\*      webcomponent\
copy ..\metadata-agent-api\src\static\widget\assets\i18n\* webcomponent\assets\i18n\
```

Danach in `chrome://extensions/` → **Aktualisieren** klicken.

---

## Berechtigungen (Manifest V3)

| Berechtigung | Zweck |
|-------------|-------|
| `activeTab` | Aktuellen Tab auslesen |
| `scripting` | Content Script injizieren |
| `storage` | Session, Queue, History, Warenkorb speichern |
| `sidePanel` | Sidebar UI |
| `contextMenus` | Rechtsklick → „Zur Merkliste" |
| `notifications` | Feedback-Benachrichtigungen |
| `host_permissions: *` | API-Calls zu Backend + Repository |

**CSP:** `script-src 'self'; object-src 'self'` — keine externen Scripts nötig.

---

## Troubleshooting

| Problem | Lösung |
|---------|--------|
| Webkomponente leer | `chrome://extensions/` → Plugin neu laden |
| i18n-Texte fehlen | `.\build-extension.ps1` ausführen oder manuell Dateien aus `metadata-agent-api/src/static/widget/dist/` kopieren |
| i18n 404 auf localhost | `config.js` → `api.url` prüfen — `window.__ENV.agentUrl` muss vor Widget-Scripts gesetzt sein |
| API nicht erreichbar | `config.js` → `api.url` prüfen, oder Options-Seite → API URL ändern |
| Login schlägt fehl | Options → Repository URL prüfen |
| 🛒-Icons fehlen auf WLO | Seite neu laden (Content Scripts werden bei `document_idle` injiziert) |
| Warenkorb-Items ohne Metadaten | Console prüfen — Enrichment versucht staging + redaktion Server |
| Violette KI-Textfarbe | `highlight-ai="false"` in sidebar.html + `highlightAi: false` in config.js |

---

## Lizenz

Siehe [LICENSE](./LICENSE).
