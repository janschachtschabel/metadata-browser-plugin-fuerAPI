// WLO Metadaten-Agent - Central Configuration
// VERSION: 2.1.0 — Credentials removed; guest upload runs server-side via /upload

const WLO_CONFIG = {
    api: {
        url: 'https://metadata-agent-api.vercel.app',
        localUrl: 'http://localhost:8000',
        description: 'Metadata Agent FastAPI Backend'
    },

    repository: {
        url: 'https://repository.staging.openeduhub.net',
        description: 'OpenEduHub Staging Repository'
    },

    webcomponent: {
        layout: 'plugin',
        theme: 'edu-sharing',
        highlightAi: false
    },

    network: {
        defaultTimeoutMs: 20000,
        uploadTimeoutMs: 60000
    },

    getApiUrl() {
        return this.api.url;
    },

    getRepositoryUrl() {
        return this.repository.url;
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = WLO_CONFIG;
}

console.log('🔧 WLO Config loaded:', {
    api: WLO_CONFIG.getApiUrl(),
    repository: WLO_CONFIG.getRepositoryUrl(),
    layout: WLO_CONFIG.webcomponent.layout
});
