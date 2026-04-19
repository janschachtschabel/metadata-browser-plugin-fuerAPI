// Exposes the API URL to the embedded Angular web component.
// Must run AFTER config.js and BEFORE webcomponent scripts bootstrap.
window.__ENV = { agentUrl: WLO_CONFIG.api.url };
