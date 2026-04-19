// WLO Warenkorb Overlay - Content Script
// Injects cart icons on WLO search result tiles on suche.wirlernenonline.de
// Communicates with sidebar via chrome.runtime messaging

(function() {
  'use strict';

  const WLO_HOSTS = ['suche.wirlernenonline.de', 'wirlernenonline.de'];
  if (!WLO_HOSTS.some(h => location.hostname.includes(h))) return;

  console.log('🛒 WLO Warenkorb Overlay loaded');

  // =========================================================================
  // SEARCH RESULTS CACHE — prefetch nodeIds from the search API
  // =========================================================================

  let searchNodesCache = [];  // [{id, title, publisher, wwwurl}, ...]

  // Listen for intercepted search results from wlo-interceptor.js (MAIN world).
  // The interceptor overrides fetch/XHR in the page context and catches all
  // edu-sharing ngsearch API responses — giving us the EXACT data that
  // suche.wirlernenonline.de received, including all nodeIds.
  window.addEventListener('message', (event) => {
    // Only accept messages from this window (same origin, same frame).
    if (event.source !== window || event.origin !== location.origin) return;
    if (!event.data || event.data.type !== 'WK_SEARCH_NODES' || !Array.isArray(event.data.nodes)) return;

    const existingIds = new Set(searchNodesCache.map(n => n.id));
    const newNodes = event.data.nodes.filter(n => n && typeof n.id === 'string' && n.id && !existingIds.has(n.id));
    searchNodesCache = [...searchNodesCache, ...newNodes];
  });

  /**
   * Match a scraped card title against a cached API title.
   * Handles truncation: if scraped title ends with '…' or '...', compare only the prefix.
   */
  function cacheTitleMatch(scrapedTitle, apiTitle) {
    if (!scrapedTitle || !apiTitle) return false;
    const s = scrapedTitle.replace(/\.{3}$/, '').replace(/…$/, '').toLowerCase().trim();
    const a = apiTitle.toLowerCase().trim();
    if (s === a) return true;
    if (s.length >= 4 && a.startsWith(s)) return true;
    if (a.length >= 4 && s.startsWith(a)) return true;
    return false;
  }

  /**
   * Look up nodeId from the prefetch cache by matching title + publisher.
   */
  function lookupNodeIdFromCache(title, publisher) {
    if (searchNodesCache.length === 0 || !title) return null;

    // Best: title + publisher match
    if (publisher) {
      const match = searchNodesCache.find(n =>
        cacheTitleMatch(title, n.title) &&
        n.publisher.toLowerCase().trim() === publisher.toLowerCase().trim()
      );
      if (match) return match;
    }

    // Fallback: title match only
    const match = searchNodesCache.find(n => cacheTitleMatch(title, n.title));
    return match || null;
  }

  // =========================================================================
  // STYLES
  // =========================================================================

  function injectStyles() {
    if (document.getElementById('wk-overlay-styles')) return;
    const style = document.createElement('style');
    style.id = 'wk-overlay-styles';
    style.textContent = `
      .wk-overlay-btn {
        position: absolute !important;
        top: 8px !important;
        right: 8px !important;
        width: 36px !important;
        height: 36px !important;
        background: #003B7C !important;
        color: white !important;
        border: 2px solid white !important;
        border-radius: 50% !important;
        cursor: pointer !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        font-size: 20px !important;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3) !important;
        opacity: 0 !important;
        transform: scale(0.7) !important;
        transition: opacity 0.2s ease, transform 0.2s ease, background 0.2s ease !important;
        z-index: 10000 !important;
        padding: 0 !important;
        margin: 0 !important;
        line-height: 1 !important;
        font-family: 'Material Icons', 'Material Symbols Outlined', sans-serif !important;
      }
      .wk-overlay-btn:hover {
        background: #004a99 !important;
        transform: scale(1.1) !important;
        opacity: 1 !important;
      }
      .wk-overlay-btn.wk-added {
        background: #2e7d32 !important;
        opacity: 1 !important;
        transform: scale(1) !important;
      }
      .wk-overlay-parent {
        position: relative !important;
      }
      .wk-overlay-parent:hover .wk-overlay-btn {
        opacity: 1 !important;
        transform: scale(1) !important;
      }

      .wk-overlay-toast {
        position: fixed !important;
        bottom: 20px !important;
        right: 20px !important;
        background: #1e293b !important;
        color: white !important;
        padding: 12px 20px !important;
        border-radius: 8px !important;
        font-size: 14px !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important;
        z-index: 100000 !important;
        opacity: 0 !important;
        transform: translateY(10px) !important;
        transition: opacity 0.25s ease, transform 0.25s ease !important;
        pointer-events: none !important;
      }
      .wk-overlay-toast.show {
        opacity: 1 !important;
        transform: translateY(0) !important;
      }
    `;
    document.head.appendChild(style);
  }

  // =========================================================================
  // CARD DETECTION
  // =========================================================================

  // WLO search uses Angular Material cards. These selectors cover the known layouts.
  const CARD_SELECTORS = [
    'app-search-card',                       // <app-search-card> custom element
    'mat-card.search-card',                  // Angular Material card
    '.card-content-container',               // Container inside card
    '[class*="search-card"]',                // Any element with search-card class
    '.cdk-drag',                             // CDK draggable items
    'mat-card',                              // Generic mat-card
    '.mdc-card',                             // MDC card
    'a[href*="/search/de/detail/"]'          // Direct links to detail pages
  ];

  function findCards() {
    for (const selector of CARD_SELECTORS) {
      const cards = document.querySelectorAll(selector);
      if (cards.length > 0) return Array.from(cards);
    }
    // Fallback: look for any element that looks like a result card
    return Array.from(document.querySelectorAll('[class*="card"], [class*="result"], [class*="item"]'))
      .filter(el => {
        const hasImage = el.querySelector('img');
        const hasTitle = el.querySelector('h1, h2, h3, h4, h5, [class*="title"]');
        return hasImage && hasTitle && el.offsetHeight > 50 && el.offsetWidth > 100;
      });
  }

  // =========================================================================
  // DATA EXTRACTION FROM CARD
  // =========================================================================

  function extractCardData(card) {
    // Title
    const titleEl = card.querySelector(
      'h1, h2, h3, h4, h5, [class*="title"], [class*="Title"], mat-card-title, .mat-mdc-card-title'
    );
    const title = titleEl?.textContent?.trim() || '';

    // Publisher / Bezugsquelle — extract BEFORE nodeId so cache lookup can use it
    const publisherEl = card.querySelector(
      '[class*="source"], [class*="publisher"], [class*="organization"], [class*="Provider"], [class*="provider"]'
    );
    let publisher = publisherEl?.textContent?.trim() || '';
    // Fallback: look for small/muted text elements before the title
    if (!publisher && titleEl) {
      const smallEls = card.querySelectorAll('span, div, small');
      for (const el of smallEls) {
        const style = window.getComputedStyle(el);
        const text = el.textContent?.trim() || '';
        // Publisher is typically short, gray text above the title
        if (text && text.length > 1 && text.length < 40
            && text !== title && !text.includes('OER')
            && (style.color?.includes('128') || style.color?.includes('148') || style.color?.includes('rgb(100') || style.color?.includes('rgb(107') || style.color?.includes('rgb(117') || style.fontSize === '12px' || style.fontSize === '11px')
            && el.compareDocumentPosition(titleEl) & Node.DOCUMENT_POSITION_FOLLOWING) {
          publisher = text;
          break;
        }
      }
    }

    // URL & Node ID extraction
    const linkEl = card.querySelector('a[href*="/detail/"]') || card.querySelector('a[href*="/search/"]') || card.closest('a');
    let url = linkEl?.href || '';
    // If relative, make absolute
    if (url && !url.startsWith('http')) {
      url = new URL(url, location.origin).href;
    }
    // Extract node ID — try multiple strategies
    let nodeId = '';

    // Strategy 0: Look up from prefetch cache (most reliable, instant)
    const cacheHit = lookupNodeIdFromCache(title, publisher);
    if (cacheHit) {
      nodeId = cacheHit.id;
      if (!url && cacheHit.wwwurl) url = cacheHit.wwwurl;
      console.log('🛒 NodeId from cache:', nodeId, 'for:', title);
    }

    // Strategy 1: detail link in href (pattern: /detail/{uuid})
    if (!nodeId) {
      const detailMatch = url.match(/\/detail\/([a-f0-9-]{36})/i);
      if (detailMatch) {
        nodeId = detailMatch[1];
      }
    }

    // Strategy 2: render link (pattern: /render/{uuid} or /components/render/{uuid})
    if (!nodeId) {
      const renderLink = card.querySelector('a[href*="/render/"]');
      const renderHref = renderLink?.href || '';
      const renderMatch = renderHref.match(/\/(?:components\/)?render\/([a-f0-9-]{36})/i);
      if (renderMatch) nodeId = renderMatch[1];
    }

    // Strategy 3: Any <a> tag inside the card with a UUID in the href
    if (!nodeId) {
      const allLinks = card.querySelectorAll('a[href]');
      for (const link of allLinks) {
        const href = link.href || '';
        const uuidMatch = href.match(/\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
        if (uuidMatch) { nodeId = uuidMatch[1]; break; }
      }
    }

    // Strategy 4: data-* attributes on the card or its children
    if (!nodeId) {
      const dataId = card.dataset?.id || card.dataset?.nodeId || card.dataset?.nodeRef ||
                     card.getAttribute('data-id') || card.getAttribute('data-node-id');
      if (dataId && /^[a-f0-9-]{36}$/i.test(dataId)) nodeId = dataId;
    }

    // Thumbnail
    const imgEl = card.querySelector('img');
    const thumbnail = imgEl?.src || '';

    // Strategy 5: nodeId from thumbnail preview URL (pattern: nodeId=UUID or /preview/{uuid})
    if (!nodeId && thumbnail) {
      const thumbMatch = thumbnail.match(/nodeId[=\/]([a-f0-9-]{36})/i) ||
                         thumbnail.match(/\/preview.*?([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
      if (thumbMatch) nodeId = thumbMatch[1];
    }

    // Description
    const descEl = card.querySelector(
      '[class*="description"], [class*="Description"], [class*="subtitle"], mat-card-subtitle, p'
    );
    const description = descEl?.textContent?.trim()?.substring(0, 200) || '';

    // Type badge
    const typeEl = card.querySelector(
      '[class*="type"], [class*="badge"], [class*="chip"], mat-chip'
    );
    const type = typeEl?.textContent?.trim() || 'Material';

    return {
      id: nodeId || ('wlo-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6)),
      nodeId: nodeId || '',
      title: title || 'Unbenannter Inhalt',
      description,
      url,
      thumbnail,
      publisher: publisher || '',
      type,
      typeId: guessTypeId(type),
      source: 'wlo-overlay',
      needsEnrichment: true
    };
  }

  // =========================================================================
  // NODEID EXTRACTION VIA CARD CLICK
  // When nodeId can't be found from the card DOM directly, we click the card
  // to open the WLO detail popup, extract the nodeId from the "Alle Details"
  // link (which points to /components/render/{nodeId}), then close the popup.
  // =========================================================================

  async function extractNodeIdViaClick(card) {
    return new Promise((resolve) => {
      let resolved = false;

      const finish = (result) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        clearInterval(pollInterval);
        // Brief delay to ensure popup is fully rendered before we close it
        setTimeout(() => closeDetailPopup(), 50);
        resolve(result);
      };

      // Timeout after 4 seconds
      const timeout = setTimeout(() => {
        console.warn('🔍 NodeId extraction timed out');
        finish({ nodeId: '', originalUrl: '' });
      }, 4000);

      // Poll for popup content every 200ms
      const pollInterval = setInterval(() => {
        if (resolved) return;

        // Strategy A: Check if URL changed to include nodeId (Angular route)
        const urlMatch = location.href.match(/\/detail\/([a-f0-9-]{36})/i);
        if (urlMatch) {
          finish({ nodeId: urlMatch[1], originalUrl: '' });
          return;
        }

        // Strategy B: Look for render/detail links inside CDK overlay (popup)
        const overlaySelectors = [
          '.cdk-overlay-container a[href]',
          '[class*="overlay"] a[href]',
          '[class*="modal"] a[href]',
          '[class*="dialog"] a[href]',
          '[class*="detail"] a[href]'
        ];
        const overlayLinks = document.querySelectorAll(overlaySelectors.join(','));

        let foundNodeId = '';
        let foundOriginalUrl = '';

        for (const link of overlayLinks) {
          const href = link.href || '';
          // Match: /components/render/{uuid} or /render/{uuid}
          const renderMatch = href.match(/\/(?:components\/)?render\/([a-f0-9-]{36})/i);
          if (renderMatch) {
            foundNodeId = renderMatch[1];
            continue;
          }
          // Match: /detail/{uuid}
          const detailMatch = href.match(/\/detail\/([a-f0-9-]{36})/i);
          if (detailMatch && !foundNodeId) {
            foundNodeId = detailMatch[1];
            continue;
          }
          // Collect original URL ("Zur Originalseite" link — external, not edu-sharing)
          if (href && !href.includes('/render/') && !href.includes('/edu-sharing/')
              && !href.includes('wirlernenonline.de') && !href.includes('/detail/')
              && href.startsWith('http')) {
            foundOriginalUrl = href;
          }
        }

        if (foundNodeId) {
          console.log('🔍 Found nodeId in popup:', foundNodeId, 'originalUrl:', foundOriginalUrl);
          finish({ nodeId: foundNodeId, originalUrl: foundOriginalUrl });
        }
      }, 200);

      // Find the clickable element in the card (title, image, or card itself)
      // Prefer the title or a link, since clicking the image might not open the detail
      const clickTarget = card.querySelector(
        'a[href], [class*="title"] a, mat-card-title a, h1 a, h2 a, h3 a, h4 a, h5 a'
      ) || card.querySelector(
        '[class*="title"], mat-card-title, .mat-mdc-card-title, h1, h2, h3, h4, h5'
      ) || card;

      console.log('🔍 Clicking card element to open popup:', clickTarget.tagName, clickTarget.className);
      clickTarget.click();
    });
  }

  function closeDetailPopup() {
    // Strategy 1: Click the CDK overlay backdrop (most reliable for Angular Material modals)
    const backdrop = document.querySelector('.cdk-overlay-backdrop');
    if (backdrop) {
      backdrop.click();
      return;
    }

    // Strategy 2: Press Escape (works for most popups/dialogs)
    document.body.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true
    }));

    // Strategy 3: Look for explicit close/back buttons
    const closeBtn = document.querySelector(
      '.cdk-overlay-container [class*="close"],' +
      '.cdk-overlay-container [mat-icon-button],' +
      '.cdk-overlay-container button[aria-label*="close" i],' +
      '.cdk-overlay-container button[aria-label*="schließen" i],' +
      '.cdk-overlay-container button[aria-label*="zurück" i]'
    );
    if (closeBtn) closeBtn.click();

    // Strategy 4: If URL changed to detail route, go back
    if (location.href.match(/\/detail\/[a-f0-9-]{36}/i)) {
      history.back();
    }
  }

  function guessTypeId(typeLabel) {
    const lower = (typeLabel || '').toLowerCase();
    if (lower.includes('video')) return 'video';
    if (lower.includes('audio')) return 'audio';
    if (lower.includes('bild') || lower.includes('image')) return 'image';
    if (lower.includes('arbeitsblatt') || lower.includes('worksheet')) return 'worksheet';
    if (lower.includes('werkzeug') || lower.includes('tool')) return 'tool';
    if (lower.includes('simulation')) return 'simulation';
    if (lower.includes('spiel') || lower.includes('quiz') || lower.includes('game')) return 'game';
    return 'text';
  }

  // =========================================================================
  // OVERLAY INJECTION
  // =========================================================================

  function injectOverlayButtons() {
    const cards = findCards();
    let injected = 0;

    cards.forEach(card => {
      // Skip if already has overlay
      if (card.querySelector('.wk-overlay-btn')) return;
      // Skip very small elements (likely not real cards)
      if (card.offsetHeight < 40) return;

      // Make card position:relative for absolute overlay
      card.classList.add('wk-overlay-parent');

      const btn = document.createElement('button');
      btn.className = 'wk-overlay-btn';
      btn.innerHTML = '🛒';
      btn.title = 'In Warenkorb legen';
      btn.setAttribute('data-wk-overlay', 'true');

      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const data = extractCardData(card);
        if (!data.title || data.title === 'Unbenannter Inhalt') {
          showOverlayToast('Konnte keine Daten aus der Kachel lesen');
          return;
        }

        // If no nodeId found from DOM, try extracting via card click popup
        if (!data.nodeId) {
          showOverlayToast('🔍 Lade Details…');
          try {
            const result = await extractNodeIdViaClick(card);
            if (result.nodeId) {
              data.nodeId = result.nodeId;
              data.id = result.nodeId;
              if (result.originalUrl) data.url = result.originalUrl;
              console.log('🛒 NodeId extracted via click:', result.nodeId);
            }
          } catch (err) {
            console.warn('🛒 Click-to-extract failed:', err);
          }
        }

        // Send to sidebar via background script
        chrome.runtime.sendMessage({
          action: 'warenkorb.addItem',
          item: data
        }, (response) => {
          if (chrome.runtime.lastError) {
            // Sidebar might not be open - store in queue
            storeForLater(data);
            showOverlayToast('📋 Gespeichert – öffne den Warenkorb-Tab');
          } else {
            btn.innerHTML = '✓';
            btn.classList.add('wk-added');
            showOverlayToast(`✓ "${data.title}" hinzugefügt`);
            setTimeout(() => {
              btn.innerHTML = '🛒';
              btn.classList.remove('wk-added');
            }, 2000);
          }
        });
      });

      card.appendChild(btn);
      injected++;
    });

    if (injected > 0) {
      console.log(`🛒 ${injected} Warenkorb-Buttons injiziert`);
    }
  }

  // =========================================================================
  // QUEUE FOR OFFLINE ADDING
  // =========================================================================

  function storeForLater(item) {
    // Queue the item in the extension's chrome.storage (background) — NOT in page-scoped
    // localStorage, which would let page scripts read/modify the cart.
    try {
      chrome.runtime.sendMessage({ action: 'pendingItems.add', item });
    } catch (e) {
      console.warn('WK overlay: could not store item', e);
    }
  }

  // =========================================================================
  // TOAST
  // =========================================================================

  function showOverlayToast(message) {
    let toast = document.querySelector('.wk-overlay-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'wk-overlay-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.remove('show');
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }

  // =========================================================================
  // OBSERVER - Re-inject on dynamic page updates (SPA navigation)
  // =========================================================================

  function startObserver() {
    let debounceTimer = null;
    const observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        injectOverlayButtons();
      }, 500);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // =========================================================================
  // INIT
  // =========================================================================

  function init() {
    injectStyles();

    // Delay initial injection to let Angular render
    // Note: nodeId cache is populated automatically by wlo-interceptor.js
    // which intercepts the page's own search API responses via postMessage.
    setTimeout(() => {
      injectOverlayButtons();
      startObserver();
    }, 1500);

    // Also inject on URL changes (SPA navigation)
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        setTimeout(injectOverlayButtons, 1000);
      }
    }, 1000);
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
