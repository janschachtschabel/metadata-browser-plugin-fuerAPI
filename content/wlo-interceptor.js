// WLO Search API Interceptor — runs in MAIN world (page context)
// Intercepts fetch/XHR responses from the edu-sharing search API
// to capture nodeIds, titles, publishers for all search results.
// Communicates with the content script (wlo-overlay.js) via postMessage.

(function() {
  'use strict';

  const origFetch = window.fetch;

  window.fetch = function(...args) {
    return origFetch.apply(this, args).then(response => {
      try {
        const url = (typeof args[0] === 'string') ? args[0] : args[0]?.url || '';
        // Only intercept search API responses (ngsearch endpoint)
        if (url.includes('/search/') && url.includes('ngsearch')) {
          const clone = response.clone();
          clone.json().then(data => {
            if (Array.isArray(data.nodes) && data.nodes.length > 0) {
              const nodes = data.nodes.map(n => ({
                id: n.ref?.id || '',
                title: (n.properties?.['cclom:title'] || [])[0] || n.name || '',
                publisher: (n.properties?.['ccm:oeh_publisher_combined'] || [])[0] || '',
                wwwurl: (n.properties?.['ccm:wwwurl'] || [])[0] || ''
              })).filter(n => n.id);

              if (nodes.length > 0) {
                window.postMessage({
                  type: 'WK_SEARCH_NODES',
                  nodes: nodes
                }, '*');
              }
            }
          }).catch(() => {});
        }
      } catch (e) {
        // Never break the page
      }
      return response;
    });
  };

  // Also intercept XMLHttpRequest (some Angular apps use XHR)
  const origXHROpen = XMLHttpRequest.prototype.open;
  const origXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._wkUrl = url;
    return origXHROpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function(...args) {
    if (this._wkUrl && this._wkUrl.includes('/search/') && this._wkUrl.includes('ngsearch')) {
      this.addEventListener('load', function() {
        try {
          const data = JSON.parse(this.responseText);
          if (Array.isArray(data.nodes) && data.nodes.length > 0) {
            const nodes = data.nodes.map(n => ({
              id: n.ref?.id || '',
              title: (n.properties?.['cclom:title'] || [])[0] || n.name || '',
              publisher: (n.properties?.['ccm:oeh_publisher_combined'] || [])[0] || '',
              wwwurl: (n.properties?.['ccm:wwwurl'] || [])[0] || ''
            })).filter(n => n.id);

            if (nodes.length > 0) {
              window.postMessage({
                type: 'WK_SEARCH_NODES',
                nodes: nodes
              }, '*');
            }
          }
        } catch (e) {}
      });
    }
    return origXHRSend.apply(this, args);
  };
})();
