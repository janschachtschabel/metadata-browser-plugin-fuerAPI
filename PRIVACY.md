# Datenschutzerklärung · WLO Metadaten-Agent

**Stand:** 2026-04-19

Diese Browser-Extension unterstützt Lehrkräfte und Redakteur:innen bei der
Erschließung von Bildungsinhalten für WirLernenOnline (WLO).
Diese Erklärung beschreibt, welche Daten die Extension verarbeitet, wohin
sie übermittelt werden und wie lange sie gespeichert sind.

---

## Verantwortlich

Siehe Angaben auf https://wirlernenonline.de/impressum/.

## Welche Daten werden verarbeitet?

### 1. Inhalte der aktuell aktiven Seite (on-demand)

Wenn Sie im Sidepanel auf **„Seite erschließen"** oder im Kontextmenü auf
**„Zur Merkliste hinzufügen"** klicken, liest die Extension einmalig die
folgenden Daten der gerade aktiven Seite aus:

- URL und Seitentitel
- Meta-Tags (`description`, `keywords`, `author`, Open Graph, Twitter Card,
  Dublin Core, LRMI)
- Sichtbarer Hauptinhalt (`<main>`, `<article>`, bis zu 5 000 Zeichen)
- Eingebettete strukturierte Daten (`application/ld+json`)
- Lizenzhinweise, Bilder, Tags, Sprach- und Canonical-URL-Angaben

Diese Daten werden an das Backend (`https://metadata-agent-api.vercel.app`)
gesendet, um daraus automatisch Vorschläge für WLO-Metadaten zu erzeugen.
Ein Seitenscan findet **niemals automatisch im Hintergrund** statt; er wird
ausschließlich durch Ihre Aktion ausgelöst.

### 2. Merkliste und Verlauf

Seiten, die Sie aktiv in die Merkliste aufnehmen oder erfolgreich
hochladen, speichert die Extension lokal in `chrome.storage.local`
(maximal 100 Einträge pro Liste). Diese Daten verlassen Ihren Computer nur,
wenn Sie einen Upload auslösen.

### 3. Anmeldedaten (optional)

Die Anmeldung an das edu-sharing-Repository ist optional. Wenn Sie sich
anmelden, speichert die Extension:

- Benutzername und Authority-Name
- Ihr Basic-Auth-Header (`chrome.storage.local`, extension-scoped)
- Ihren User-Home-ID und die Liste Ihrer Tool-Permissions

Der Header wird beim Logout und nach spätestens **8 Stunden Inaktivität**
gelöscht. Die Extension übermittelt den Header ausschließlich an den
konfigurierten Repository-Host. Gast-Uploads erfordern keine Anmeldung und
laufen server-seitig über das WLO-Backend.

### 4. Screenshots

Beim Upload kann ein Screenshot der aktuellen Seite erstellt werden
(`chrome.tabs.captureVisibleTab`). Dieser wird ausschließlich als
Vorschaubild an den edu-sharing-Node gehängt.

### 5. Warenkorb-Pendenzen

Wenn Sie auf einer WLO-Suchseite ein Ergebnis zur Merkliste hinzufügen und
das Sidepanel noch nicht geöffnet ist, wird das Element vorübergehend in
`chrome.storage.local` (Schlüssel `wkPendingItems`, max. 200 Einträge)
zwischengespeichert und beim nächsten Öffnen des Sidepanels importiert.

---

## Wohin werden Daten gesendet?

Die Extension kontaktiert **ausschließlich** folgende Hosts (im Code per
Whitelist erzwungen):

| Host | Zweck |
|---|---|
| `metadata-agent-api.vercel.app` | KI-gestützte Metadaten-Extraktion + Gast-Upload |
| `repository.staging.openeduhub.net` | User-Login-Upload, Duplikatprüfung, Preview |
| `redaktion.openeduhub.net` | Warenkorb-Suche (öffentliche ngsearch-API) |

**Andere Hosts werden nicht kontaktiert.** Auch eine eigene API-URL in den
Einstellungen wird nur akzeptiert, wenn sie zu obiger Whitelist passt.

### Warum steht im Manifest `host_permissions: https://*/*` ?

Die Extension ist dafür gedacht, **die gerade von Ihnen geöffnete Seite**
(z. B. Blog-Artikel, Bildungsmaterial, News-Artikel) für die
Metadaten-Erfassung auszulesen. Damit sie nicht nur auf wenigen WLO-Domains,
sondern auf jeder beliebigen Bildungsquelle funktioniert, muss Chrome ihr
prinzipiell erlauben, Inhalte aus solchen Seiten zu extrahieren. Dies
geschieht:

- **nur HTTPS**, kein Klartext-HTTP
- **nur nach aktivem Klick** auf „Erschließen" bzw. auf das Kontextmenü
- **nur die aktuelle Seite** — keine Hintergrund-Überwachung, kein Crawling
- **einmalig on-demand** via `chrome.scripting.executeScript` — die Extension
  hat keine persistent laufenden Content-Scripts auf Fremdseiten (außer dem
  Warenkorb-Overlay auf `suche.wirlernenonline.de`).

Technisch erforderlich, weil Chromes `activeTab`-Permission nicht auf
Sidepanel-Interaktionen angewendet wird.

## Was wird NICHT gesammelt?

- Keine Analytik, kein Tracking, keine Drittanbieter-Telemetrie.
- Keine automatische Seitenanalyse ohne aktive Nutzer-Aktion.
- Keine Übertragung an Server außerhalb der obigen Liste.
- Kein remote-gehosteter Code (alle Skripte sind Teil des Extension-Pakets).

## Speicherdauer

- Merkliste & Verlauf: lokal, bis Sie sie löschen (max. 100 Einträge).
- Session-Header: maximal 8 Stunden oder bis zum Logout.
- Warenkorb-Pendenzen: bis zum nächsten Sidepanel-Import.
- Server-seitige Uploads: gemäß der Nutzungsbedingungen des WLO-Repositorys.

## Ihre Rechte

Sie können jederzeit:

- Merkliste, Verlauf, Warenkorb und Session in den Einstellungen löschen.
- Die Extension deinstallieren (entfernt alle lokalen Daten).
- Auskunft / Löschung Ihrer im edu-sharing-Repository gespeicherten Uploads
  direkt bei WLO beantragen.

## Kontakt

Fragen zum Datenschutz oder zur Extension: Siehe https://wirlernenonline.de/kontakt/.
