// WLO Metadaten-Agent - Central Configuration
// VERSION: 2.0.0 — Direct Web Component Integration + FastAPI Backend

const WLO_CONFIG = {
    // Metadata Agent FastAPI Backend
    api: {
        url: 'https://metadata-agent-api.vercel.app',
        localUrl: 'http://localhost:8000',
        description: 'Metadata Agent FastAPI Backend'
    },

    // WLO Repository
    repository: {
        url: 'https://repository.staging.openeduhub.net',
        description: 'OpenEduHub Staging Repository'
    },

    // Guest Credentials (for anonymous uploads)
    guest: {
        inboxId: '21144164-30c0-4c01-ae16-264452197063',
        username: 'WLO-Upload',
        password: 'wlo#upload!20'
    },

    // Web Component Settings
    webcomponent: {
        layout: 'plugin',
        theme: 'edu-sharing',
        highlightAi: false
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
