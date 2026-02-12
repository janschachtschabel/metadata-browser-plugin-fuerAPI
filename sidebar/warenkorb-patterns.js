/**
 * Ablaufmuster für Unterrichtseinheiten
 * Jedes Muster definiert Phasen mit typischen Inhaltstypen für die WLO-Suche
 */

const WK_PATTERNS = {
  frontalunterricht: {
    id: 'frontalunterricht',
    name: 'Frontalunterricht',
    description: 'Klassischer lehrerzentrierter Unterricht',
    phases: [
      { id: 'einstieg', name: 'Einstieg', description: 'Motivation, Vorwissen aktivieren', duration: '10 min', icon: 'flag', contentTypes: ['video', 'image', 'simulation'] },
      { id: 'erarbeitung', name: 'Erarbeitung', description: 'Neuer Stoff wird präsentiert', duration: '20 min', icon: 'menu_book', contentTypes: ['video', 'text', 'lesson_plan'] },
      { id: 'sicherung', name: 'Sicherung', description: 'Zusammenfassung, Wiederholung', duration: '10 min', icon: 'edit_note', contentTypes: ['worksheet', 'text'] },
      { id: 'uebung', name: 'Übung', description: 'Anwendung und Vertiefung', duration: '15 min', icon: 'edit', contentTypes: ['worksheet', 'game', 'tool'] },
      { id: 'abschluss', name: 'Abschluss', description: 'Reflexion, Ausblick', duration: '5 min', icon: 'sports_score', contentTypes: ['game'] }
    ]
  },

  problemorientiert: {
    id: 'problemorientiert',
    name: 'Problemorientiertes Lernen',
    description: 'Lernen durch Lösen authentischer Probleme',
    phases: [
      { id: 'problemstellung', name: 'Problemstellung', description: 'Authentisches Problem präsentieren', duration: '10 min', icon: 'help_outline', contentTypes: ['video', 'image'] },
      { id: 'hypothesen', name: 'Hypothesenbildung', description: 'Vermutungen und Lösungsideen sammeln', duration: '10 min', icon: 'lightbulb', contentTypes: ['tool', 'text'] },
      { id: 'recherche', name: 'Recherche & Erarbeitung', description: 'Informationen sammeln und auswerten', duration: '25 min', icon: 'search', contentTypes: ['text', 'video', 'simulation'] },
      { id: 'loesung', name: 'Lösungsentwicklung', description: 'Lösungsansätze erarbeiten', duration: '15 min', icon: 'build', contentTypes: ['tool', 'worksheet'] },
      { id: 'praesentation', name: 'Präsentation', description: 'Ergebnisse vorstellen und diskutieren', duration: '15 min', icon: 'present_to_all', contentTypes: ['tool'] },
      { id: 'reflexion', name: 'Reflexion', description: 'Lernprozess reflektieren', duration: '5 min', icon: 'psychology', contentTypes: ['worksheet'] }
    ]
  },

  stationenlernen: {
    id: 'stationenlernen',
    name: 'Stationenlernen',
    description: 'Selbstständiges Arbeiten an verschiedenen Stationen',
    phases: [
      { id: 'einfuehrung', name: 'Einführung', description: 'Stationen und Regeln erklären', duration: '10 min', icon: 'assignment', contentTypes: ['text'] },
      { id: 'station1', name: 'Station 1', description: 'Erste Lernstation', duration: '15 min', icon: 'looks_one', contentTypes: ['video', 'worksheet'] },
      { id: 'station2', name: 'Station 2', description: 'Zweite Lernstation', duration: '15 min', icon: 'looks_two', contentTypes: ['simulation', 'tool'] },
      { id: 'station3', name: 'Station 3', description: 'Dritte Lernstation', duration: '15 min', icon: 'looks_3', contentTypes: ['worksheet', 'game'] },
      { id: 'station4', name: 'Station 4', description: 'Vierte Lernstation (optional)', duration: '15 min', icon: 'looks_4', contentTypes: ['text', 'audio'] },
      { id: 'auswertung', name: 'Auswertung', description: 'Ergebnisse zusammentragen', duration: '10 min', icon: 'assessment', contentTypes: ['tool'] }
    ]
  },

  flippedClassroom: {
    id: 'flippedClassroom',
    name: 'Flipped Classroom',
    description: 'Theorie zuhause, Anwendung im Unterricht',
    phases: [
      { id: 'vorbereitung', name: 'Vorbereitung (zuhause)', description: 'Video/Material zur Vorbereitung', duration: 'variabel', icon: 'home', contentTypes: ['video', 'text', 'audio'] },
      { id: 'aktivierung', name: 'Aktivierung', description: 'Vorwissen prüfen, Fragen klären', duration: '10 min', icon: 'quiz', contentTypes: ['game', 'tool'] },
      { id: 'vertiefung', name: 'Vertiefung', description: 'Intensive Übungen und Anwendung', duration: '30 min', icon: 'fitness_center', contentTypes: ['worksheet', 'simulation', 'tool'] },
      { id: 'projektarbeit', name: 'Projektarbeit', description: 'Komplexe Aufgaben bearbeiten', duration: '20 min', icon: 'construction', contentTypes: ['tool', 'worksheet'] },
      { id: 'feedback', name: 'Feedback', description: 'Individuelle Rückmeldung', duration: '10 min', icon: 'forum', contentTypes: ['tool'] }
    ]
  },

  direkteInstruktion: {
    id: 'direkteInstruktion',
    name: 'Direkte Instruktion',
    description: 'Strukturierte, kleinschrittige Vermittlung',
    phases: [
      { id: 'review', name: 'Review', description: 'Wiederholung des Vorwissens', duration: '5 min', icon: 'replay', contentTypes: ['game'] },
      { id: 'praesentation', name: 'Präsentation', description: 'Neuer Stoff in kleinen Schritten', duration: '15 min', icon: 'slideshow', contentTypes: ['video', 'text'] },
      { id: 'gefuehrteUebung', name: 'Geführte Übung', description: 'Gemeinsames Üben mit Anleitung', duration: '15 min', icon: 'groups', contentTypes: ['worksheet', 'simulation'] },
      { id: 'selbststaendigeUebung', name: 'Selbstständige Übung', description: 'Eigenständiges Üben', duration: '20 min', icon: 'person', contentTypes: ['worksheet', 'game', 'tool'] },
      { id: 'zusammenfassung', name: 'Zusammenfassung', description: 'Wichtigste Punkte wiederholen', duration: '5 min', icon: 'summarize', contentTypes: ['text'] }
    ]
  },

  kooperativesLernen: {
    id: 'kooperativesLernen',
    name: 'Kooperatives Lernen',
    description: 'Lernen in strukturierten Gruppen',
    phases: [
      { id: 'think', name: 'Think (Einzelarbeit)', description: 'Individuelles Nachdenken', duration: '5 min', icon: 'psychology', contentTypes: ['text', 'image'] },
      { id: 'pair', name: 'Pair (Partnerarbeit)', description: 'Austausch mit Partner', duration: '10 min', icon: 'people', contentTypes: ['worksheet'] },
      { id: 'share', name: 'Share (Plenum)', description: 'Ergebnisse im Plenum teilen', duration: '10 min', icon: 'record_voice_over', contentTypes: ['tool'] },
      { id: 'gruppenarbeit', name: 'Gruppenarbeit', description: 'Vertiefende Gruppenaufgabe', duration: '20 min', icon: 'diversity_3', contentTypes: ['worksheet', 'simulation', 'tool'] },
      { id: 'galerie', name: 'Galeriegang', description: 'Ergebnisse präsentieren und bewerten', duration: '15 min', icon: 'gallery_thumbnail', contentTypes: ['tool'] }
    ]
  },

  forschendesLernen: {
    id: 'forschendesLernen',
    name: 'Forschendes Lernen',
    description: 'Wissenschaftliches Arbeiten und Entdecken',
    phases: [
      { id: 'frage', name: 'Forschungsfrage', description: 'Frage oder Phänomen identifizieren', duration: '10 min', icon: 'science', contentTypes: ['video', 'image'] },
      { id: 'planung', name: 'Planung', description: 'Untersuchung planen', duration: '10 min', icon: 'checklist', contentTypes: ['text', 'worksheet'] },
      { id: 'durchfuehrung', name: 'Durchführung', description: 'Experiment/Recherche durchführen', duration: '25 min', icon: 'biotech', contentTypes: ['simulation', 'tool', 'video'] },
      { id: 'auswertung', name: 'Auswertung', description: 'Daten analysieren', duration: '15 min', icon: 'analytics', contentTypes: ['tool', 'worksheet'] },
      { id: 'dokumentation', name: 'Dokumentation', description: 'Ergebnisse festhalten', duration: '10 min', icon: 'description', contentTypes: ['tool', 'text'] }
    ]
  }
};

/**
 * Content-Type-Mapping für WLO-Suche
 * Maps readable IDs to WLO oeh_lrt vocabulary URIs and display info
 */
const WK_CONTENT_TYPES = {
  video:       { label: 'Video',          icon: 'videocam',       color: '#e53935', lrt: '38774279-af36-4ec2-8e70-811d5a51a6a1' },
  audio:       { label: 'Audio',          icon: 'headphones',     color: '#8e24aa', lrt: '39197d6f-dfb1-4e82-92e5-79f906e9d2a9' },
  image:       { label: 'Bild',           icon: 'image',          color: '#43a047', lrt: 'b8fb5fb2-d8bf-4bbe-ab68-358b65a26bed' },
  text:        { label: 'Text',           icon: 'article',        color: '#1e88e5', lrt: 'c77df53a-2611-4029-9712-f9c0eeb032a3' },
  worksheet:   { label: 'Arbeitsblatt',   icon: 'assignment',     color: '#fb8c00', lrt: 'c8e52242-361b-4a2a-b95d-25e516b28b45' },
  tool:        { label: 'Werkzeug',       icon: 'build',          color: '#546e7a', lrt: '05aa0f49-7e1b-498b-a7d5-c5fc8e73b2e2' },
  simulation:  { label: 'Simulation',     icon: 'science',        color: '#00897b', lrt: 'ffe4d8e8-3cfd-4e9a-b025-83f129eb5c9d' },
  game:        { label: 'Spiel/Quiz',     icon: 'sports_esports', color: '#d81b60', lrt: 'ded96854-280a-45ac-ad3a-f5b9b8dd0a03' },
  lesson_plan: { label: 'Unterrichtsbaustein', icon: 'school',    color: '#5c6bc0', lrt: '8526273b-2b21-46f2-ac8d-bbf362c8a690' }
};

/**
 * Fächer (Discipline) — WLO Vocabulary URIs for ccm:taxonid
 * Subset of most common school subjects for the dropdown
 */
const WK_DISCIPLINES = [
  { uri: '', label: 'Alle Fächer' },
  { uri: 'http://w3id.org/openeduhub/vocabs/discipline/720', label: 'Allgemein' },
  { uri: 'http://w3id.org/openeduhub/vocabs/discipline/080', label: 'Biologie' },
  { uri: 'http://w3id.org/openeduhub/vocabs/discipline/100', label: 'Chemie' },
  { uri: 'http://w3id.org/openeduhub/vocabs/discipline/120', label: 'Deutsch' },
  { uri: 'http://w3id.org/openeduhub/vocabs/discipline/28002', label: 'Deutsch als Zweitsprache' },
  { uri: 'http://w3id.org/openeduhub/vocabs/discipline/20001', label: 'Englisch' },
  { uri: 'http://w3id.org/openeduhub/vocabs/discipline/160', label: 'Ethik' },
  { uri: 'http://w3id.org/openeduhub/vocabs/discipline/20002', label: 'Französisch' },
  { uri: 'http://w3id.org/openeduhub/vocabs/discipline/220', label: 'Geografie' },
  { uri: 'http://w3id.org/openeduhub/vocabs/discipline/240', label: 'Geschichte' },
  { uri: 'http://w3id.org/openeduhub/vocabs/discipline/320', label: 'Informatik' },
  { uri: 'http://w3id.org/openeduhub/vocabs/discipline/060', label: 'Kunst' },
  { uri: 'http://w3id.org/openeduhub/vocabs/discipline/380', label: 'Mathematik' },
  { uri: 'http://w3id.org/openeduhub/vocabs/discipline/420', label: 'Musik' },
  { uri: 'http://w3id.org/openeduhub/vocabs/discipline/460', label: 'Physik' },
  { uri: 'http://w3id.org/openeduhub/vocabs/discipline/480', label: 'Politik' },
  { uri: 'http://w3id.org/openeduhub/vocabs/discipline/520', label: 'Religion' },
  { uri: 'http://w3id.org/openeduhub/vocabs/discipline/600', label: 'Sport' }
];

/**
 * Bildungsstufen (Educational Context) — WLO Vocabulary URIs for ccm:educationalcontext
 */
const WK_EDU_CONTEXTS = [
  { uri: '', label: 'Alle Stufen' },
  { uri: 'http://w3id.org/openeduhub/vocabs/educationalContext/elementarbereich', label: 'Elementarbereich' },
  { uri: 'http://w3id.org/openeduhub/vocabs/educationalContext/grundschule', label: 'Primarstufe' },
  { uri: 'http://w3id.org/openeduhub/vocabs/educationalContext/sekundarstufe_1', label: 'Sekundarstufe I' },
  { uri: 'http://w3id.org/openeduhub/vocabs/educationalContext/sekundarstufe_2', label: 'Sekundarstufe II' },
  { uri: 'http://w3id.org/openeduhub/vocabs/educationalContext/berufliche_bildung', label: 'Berufliche Bildung' },
  { uri: 'http://w3id.org/openeduhub/vocabs/educationalContext/hochschule', label: 'Hochschule' },
  { uri: 'http://w3id.org/openeduhub/vocabs/educationalContext/erwachsenenbildung', label: 'Erwachsenenbildung' },
  { uri: 'http://w3id.org/openeduhub/vocabs/educationalContext/foerderschule', label: 'Förderschule' },
  { uri: 'http://w3id.org/openeduhub/vocabs/educationalContext/fortbildung', label: 'Fortbildung' }
];

/**
 * Binnendifferenzierung - Optionen für verschiedene Lernbedarfe
 */
const WK_DIFFERENTIATION = {
  leistung: {
    label: 'Leistungsniveau',
    options: [
      { id: 'basis', name: 'Basis', hint: 'Grundlegende Aufgaben, mehr Hilfestellung', icon: 'trending_down' },
      { id: 'standard', name: 'Standard', hint: 'Regelanforderungen', icon: 'trending_flat' },
      { id: 'erweitert', name: 'Erweitert', hint: 'Vertiefende, komplexere Aufgaben', icon: 'trending_up' }
    ]
  },
  foerderbedarf: {
    label: 'Förderbedarf',
    options: [
      { id: 'lrs', name: 'LRS', hint: 'Lese-Rechtschreib-Schwäche: Vorlesefunktion, visuelle Unterstützung' },
      { id: 'dyskalkulie', name: 'Dyskalkulie', hint: 'Rechenschwäche: Visualisierungen, Handlungsmaterial' },
      { id: 'adhs', name: 'ADHS', hint: 'Klare Struktur, kürzere Einheiten, Bewegungspausen' },
      { id: 'hochbegabung', name: 'Hochbegabung', hint: 'Enrichment, komplexere Aufgaben' },
      { id: 'daz', name: 'DaZ', hint: 'Deutsch als Zweitsprache: Sprachentlastung, Wortschatzarbeit' }
    ]
  }
};
