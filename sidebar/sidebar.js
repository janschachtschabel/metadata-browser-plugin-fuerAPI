// WLO Metadaten-Agent - Sidebar Script
// VERSION: 7.0.0 — Direct Web Component Integration (no iframe)
console.log('🎨 Sidebar v7 loaded (direct web component)');

let REPOSITORY_URL = WLO_CONFIG.getRepositoryUrl();
let API_URL = WLO_CONFIG.getApiUrl();

const ALLOWED_API_HOSTS = new Set(['metadata-agent-api.vercel.app']);
const ALLOWED_REPO_HOSTS = new Set([
    'repository.staging.openeduhub.net',
    'redaktion.openeduhub.net'
]);

function sanitizeOrigin(rawUrl, allowedHosts) {
    if (typeof rawUrl !== 'string') return null;
    try {
        const u = new URL(rawUrl);
        if (u.protocol !== 'https:') return null;
        if (!allowedHosts.has(u.hostname)) return null;
        return u.origin;
    } catch {
        return null;
    }
}

// Custom URLs aus Options-Seite laden (überschreibt Config-Defaults, nur whitelisted Hosts)
async function loadCustomUrls() {
    try {
        const { customApiUrl, customRepositoryUrl } = await chrome.storage.local.get(['customApiUrl', 'customRepositoryUrl']);
        const safeApi = customApiUrl ? sanitizeOrigin(customApiUrl, ALLOWED_API_HOSTS) : null;
        const safeRepo = customRepositoryUrl ? sanitizeOrigin(customRepositoryUrl, ALLOWED_REPO_HOSTS) : null;
        if (safeApi) {
            API_URL = safeApi;
            window.__ENV = { agentUrl: safeApi };
        }
        if (safeRepo) REPOSITORY_URL = safeRepo;
    } catch (e) { /* storage not available */ }
}
loadCustomUrls();

// ============================================================================
// DOM ELEMENTS
// ============================================================================

const mainView = document.getElementById('main-view');
const queueView = document.getElementById('queue-view');
const historyView = document.getElementById('history-view');
const warenkorbView = document.getElementById('warenkorb-view');
const canvasView = document.getElementById('canvas-view');
const loggedInState = document.getElementById('logged-in-state');
const guestState = document.getElementById('guest-state');
const userNameDisplay = document.getElementById('user-name-display');
const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const logoutBtn = document.getElementById('logout-btn');
const startLoggedBtn = document.getElementById('start-logged-btn');
const startGuestBtn = document.getElementById('start-guest-btn');
const addCurrentPageBtn = document.getElementById('add-current-page-btn');
const addCurrentPageFilledBtn = document.getElementById('add-current-page-filled-btn');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');
const metadataCanvas = document.getElementById('metadata-canvas');

let currentCanvasItem = null;
let lastExtractedUrl = null;
let extractCounter = 0;
let screenshotDataUrl = null;

// ============================================================================
// LOADING HELPERS
// ============================================================================

function showLoading(message = 'Laden...') {
    if (loadingText) loadingText.textContent = message;
    loadingOverlay?.classList.remove('hidden');
}

function hideLoading() {
    loadingOverlay?.classList.add('hidden');
}

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Initializing sidebar v7...');
    await loadUserSession();
    setupEventListeners();
    setupWebComponentListeners();
    loadQueue();
    loadHistory();
    updateQueueBadge();

    // Initialize Warenkorb
    warenkorbInstance = new Warenkorb();
    warenkorbInstance.init();
});

// ============================================================================
// WEB COMPONENT EVENT BRIDGE
// ============================================================================

function setupWebComponentListeners() {
    if (!metadataCanvas) {
        console.error('❌ metadata-agent-canvas element not found');
        return;
    }

    // Listen for metadataSubmit — user clicked "Upload" in web component
    metadataCanvas.addEventListener('metadataSubmit', (event) => {
        console.log('📤 metadataSubmit received from web component');
        const metadata = event.detail;
        handleCanvasSaveMetadata(metadata);
    });

    // Listen for metadataChange — metadata was updated (for live preview etc.)
    metadataCanvas.addEventListener('metadataChange', (event) => {
        // Can be used for auto-save, preview, etc.
        console.log('📝 metadataChange from web component');
    });

    // Listen for reloadFromPage — user clicked "Webseite" button to re-extract from current tab
    const handlePageReload = () => {
        console.log('🔄 reloadFromPage: re-extracting data from current browser tab');
        handleOpenCanvas();
    };
    metadataCanvas.addEventListener('reloadFromPage', handlePageReload);
    metadataCanvas.addEventListener('reloadfrompage', handlePageReload);

    console.log('✅ Web component event listeners set up');
}

function feedDataToCanvas(text, url) {
    if (!metadataCanvas) return;

    // Set @Input properties programmatically (Angular may not read HTML attributes reliably)
    metadataCanvas.apiUrl = API_URL;
    metadataCanvas.layout = 'plugin';
    metadataCanvas.highlightAi = false;

    // Pass captured screenshot as preview image to the web component
    if (screenshotDataUrl) {
        metadataCanvas.previewImage = screenshotDataUrl;
        console.log('📸 Preview image set on web component');
    }

    // Determine if this is a new URL (reset fields) or same URL (keep fields)
    const isNewUrl = !lastExtractedUrl || lastExtractedUrl !== url;
    lastExtractedUrl = url;

    // Use CustomEvent to trigger extraction — this is caught by @HostListener
    // inside Angular's zone, bypassing all property-setter timing issues.
    // This is equivalent to how postMessage worked in the old iframe-based plugin.
    if (text && text.trim().length > 50) {
        metadataCanvas.dispatchEvent(new CustomEvent('plugin-extract', {
            detail: { text, url: '', inputMode: 'text', reset: isNewUrl }
        }));
        console.log('📦 Fed DOM text via event:', { textLength: text.length, url, reset: isNewUrl });
    } else if (url) {
        metadataCanvas.dispatchEvent(new CustomEvent('plugin-extract', {
            detail: { text: '', url, inputMode: 'url', reset: isNewUrl }
        }));
        console.log('📦 Fallback URL via event:', { url, textLength: text?.length || 0, reset: isNewUrl });
    }
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

function setupEventListeners() {
    // Auth
    loginForm.addEventListener('submit', handleLogin);
    logoutBtn.addEventListener('click', handleLogout);

    // Start actions
    startLoggedBtn.addEventListener('click', handleOpenCanvas);
    startGuestBtn.addEventListener('click', handleOpenCanvas);

    // Queue
    addCurrentPageBtn.addEventListener('click', handleAddCurrentPage);
    addCurrentPageFilledBtn.addEventListener('click', handleAddCurrentPage);

    // Nav tabs
    document.querySelectorAll('.nav-tab').forEach(btn => {
        btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    // Canvas back
    document.getElementById('canvas-back-btn')?.addEventListener('click', closeCanvas);

    // Queue & History controls
    setupQueueEventListeners();
    setupHistoryEventListeners();
}

// ============================================================================
// VIEW SWITCHING
// ============================================================================

function switchView(viewName) {
    console.log('📍 Switch to:', viewName);

    if (viewName !== 'canvas') {
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.view === viewName);
        });
    }

    mainView.classList.remove('active');
    queueView.classList.remove('active');
    historyView.classList.remove('active');
    warenkorbView?.classList.remove('active');
    canvasView?.classList.remove('active');

    if (viewName === 'main') mainView.classList.add('active');
    else if (viewName === 'queue') { queueView.classList.add('active'); loadQueue(); }
    else if (viewName === 'history') { historyView.classList.add('active'); loadHistory(); }
    else if (viewName === 'warenkorb') warenkorbView?.classList.add('active');
    else if (viewName === 'canvas') canvasView?.classList.add('active');
}

// ============================================================================
// AUTH — LOGIN / LOGOUT
// ============================================================================

async function loadUserSession() {
    try {
        const { wloSession } = await chrome.storage.local.get('wloSession');
        if (!wloSession || !wloSession.isValidLogin || wloSession.isGuest) {
            showGuestState();
            return;
        }
        if (typeof wloSession.expiresAt === 'number' && wloSession.expiresAt < Date.now()) {
            await chrome.storage.local.remove('wloSession');
            showGuestState();
            return;
        }
        showLoggedInState(wloSession);
    } catch (error) {
        console.error('❌ Load session failed:', error?.message || error);
        showGuestState();
    }
}

function showLoggedInState(session) {
    userNameDisplay.textContent = session.authorityName;
    loggedInState.classList.remove('hidden');
    guestState.classList.add('hidden');
}

function showGuestState() {
    loggedInState.classList.add('hidden');
    guestState.classList.remove('hidden');
}

const SESSION_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8 hours inactivity

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    if (!username || !password) { alert('Bitte Benutzername und Passwort eingeben'); return; }

    showLoading('Anmelden...');
    try {
        const authHeader = 'Basic ' + btoa(username + ':' + password);

        const response = await fetchWithTimeout(
            `${REPOSITORY_URL}/edu-sharing/rest/authentication/v1/validateSession`,
            { method: 'GET', headers: { 'Authorization': authHeader, 'Accept': 'application/json' }, credentials: 'include' }
        );
        if (!response.ok) throw new Error('Login fehlgeschlagen: ' + response.status);

        const sessionData = await response.json();
        if (sessionData.isGuest || sessionData.statusCode === 'GUEST') throw new Error('Gast-Login ist nicht erlaubt.');
        if (!sessionData.isValidLogin || sessionData.statusCode !== 'OK') throw new Error('Ungültige Anmeldedaten');

        const hasCreatePermission = Array.isArray(sessionData.toolPermissions)
            && sessionData.toolPermissions.includes('TOOLPERMISSION_CREATE_ELEMENTS_FILES');
        if (!hasCreatePermission) throw new Error('Keine Berechtigung zum Erstellen von Inhalten');

        const homeResponse = await fetchWithTimeout(
            `${REPOSITORY_URL}/edu-sharing/rest/node/v1/nodes/-home-/-inbox-/metadata`,
            { headers: { 'Authorization': authHeader, 'Accept': 'application/json' }, credentials: 'include' }
        );
        if (!homeResponse.ok) throw new Error('Konnte User Home nicht abrufen');
        const homeData = await homeResponse.json();
        const userHomeId = typeof homeData?.node?.ref?.id === 'string' ? homeData.node.ref.id : null;
        if (!userHomeId) throw new Error('User Home ID nicht gefunden');

        // Store only the minimum needed: display name, home id, permission list (array of strings only),
        // authHeader, and a session expiry timestamp.
        const allowedPermissionPattern = /^[A-Z0-9_]+$/;
        const filteredPermissions = Array.isArray(sessionData.toolPermissions)
            ? sessionData.toolPermissions.filter(p => typeof p === 'string' && allowedPermissionPattern.test(p))
            : [];

        const now = Date.now();
        const sessionToSave = {
            username,
            authorityName: typeof sessionData.authorityName === 'string' ? sessionData.authorityName : username,
            toolPermissions: filteredPermissions,
            isValidLogin: true,
            isGuest: false,
            userHomeId,
            authHeader,
            loginTime: now,
            expiresAt: now + SESSION_TIMEOUT_MS
        };
        await chrome.storage.local.set({ wloSession: sessionToSave });

        passwordInput.value = '';
        showLoggedInState(sessionToSave);
    } catch (error) {
        console.error('❌ Login failed:', error?.message || error);
        alert('Login fehlgeschlagen:\n\n' + (error?.message || 'Unbekannter Fehler'));
    } finally {
        hideLoading();
    }
}

async function handleLogout() {
    try {
        const { wloSession } = await chrome.storage.local.get('wloSession');
        if (wloSession?.authHeader) {
            try {
                await fetch(`${REPOSITORY_URL}/edu-sharing/rest/authentication/v1/destroySession`,
                    { headers: { 'Authorization': wloSession.authHeader }, credentials: 'include' });
            } catch (e) { /* ignore */ }
        }
        await chrome.storage.local.remove('wloSession');
        showGuestState();
        usernameInput.value = '';
        passwordInput.value = '';
        console.log('✅ Logged out');
    } catch (error) {
        console.error('❌ Logout failed:', error);
    }
}

// ============================================================================
// OPEN CANVAS — Extract page data & feed to web component
// ============================================================================

async function handleOpenCanvas() {
    console.log('🎨 Opening Canvas for current page...');
    try {
        const activeTabResponse = await chrome.runtime.sendMessage({ action: 'tabs.getActive' });
        if (!activeTabResponse?.success || !activeTabResponse.tab) {
            alert('Kein aktiver Tab gefunden.\n\nBitte öffne zuerst eine Webseite.');
            return;
        }

        const tab = activeTabResponse.tab;
        if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:')) {
            alert('Canvas kann auf dieser Seite nicht geöffnet werden.\n\nBitte öffne eine normale Webseite.');
            return;
        }

        showLoading('Seite wird analysiert...');

        // Extract page data via on-demand content script injection
        let pageData = null;
        try {
            const extractResponse = await chrome.runtime.sendMessage({ action: 'tabs.extractPageData', tabId: tab.id });
            if (extractResponse?.success && extractResponse.data) {
                pageData = extractResponse.data;
            }
        } catch (e) {
            console.warn('⚠️ Content script extraction failed:', e?.message || e);
        }

        // Capture screenshot while the page is still visible (before switching to canvas)
        try {
            const screenshotResp = await chrome.runtime.sendMessage({ action: 'tabs.captureScreenshot' });
            if (screenshotResp?.success && screenshotResp.dataUrl) {
                screenshotDataUrl = screenshotResp.dataUrl;
                console.log('📸 Screenshot captured:', Math.round(screenshotDataUrl.length / 1024), 'KB');
            } else {
                screenshotDataUrl = null;
                console.warn('⚠️ Screenshot capture failed');
            }
        } catch (e) {
            screenshotDataUrl = null;
            console.warn('⚠️ Screenshot capture error:', e);
        }

        hideLoading();

        const tempItem = {
            id: 'temp-' + Date.now(),
            url: pageData?.url || tab.url,
            title: pageData?.title || tab.title,
            favicon: safeImageUrl(tab.favIconUrl),
            timestamp: Date.now(),
            metadata: pageData || {},
            extractedContent: {
                html: pageData?.html || '',
                text: pageData?.formattedText || pageData?.mainContent || pageData?.text || ''
            }
        };

        openCanvasForItem(tempItem);

    } catch (error) {
        hideLoading();
        console.error('❌ Failed to open Canvas:', error);
        alert('Canvas konnte nicht geöffnet werden.\n\n' + error.message);
    }
}

function openCanvasForItem(item) {
    console.log('🎨 Opening Canvas for:', item.title);
    currentCanvasItem = item;

    // Update title
    const canvasTitleEl = document.getElementById('canvas-page-title');
    if (canvasTitleEl) canvasTitleEl.textContent = item.title || 'Seite erschließen';

    // Hide header for direct starts (more space)
    const canvasHeader = document.querySelector('.canvas-header');
    if (item.id?.startsWith('temp-')) {
        canvasHeader?.classList.add('hidden');
    } else {
        canvasHeader?.classList.remove('hidden');
    }

    // Switch to canvas view
    switchView('canvas');

    // Build formatted text
    let formattedText = '';
    if (item.extractedContent?.text && item.extractedContent.text.length > 100) {
        formattedText = item.extractedContent.text;
    } else if (item.metadata?.formattedText && item.metadata.formattedText.length > 100) {
        formattedText = item.metadata.formattedText;
    } else if (item.metadata && typeof item.metadata === 'object') {
        formattedText = buildFormattedTextFromMetadata(item.metadata);
    } else {
        formattedText = item.extractedContent?.text || item.metadata?.mainContent || '';
    }

    // Feed data directly to the web component (no postMessage needed!)
    feedDataToCanvas(formattedText, item.url);
}

function closeCanvas() {
    console.log('🔙 Closing Canvas');
    currentCanvasItem = null;
    screenshotDataUrl = null;
    switchView('main');
}

// ============================================================================
// HANDLE SAVE — Web component emits metadataSubmit, plugin uploads
// ============================================================================

async function handleCanvasSaveMetadata(rawMetadata) {
    console.log('💾 Saving metadata from web component...', rawMetadata);

    // The web component emits: { contextName, schemaVersion, metadataset, metadataset_uri, metadata: {...}, _origins, _source_text }
    // The plugin upload expects flat keys like cclom:title at the top level.
    // Unwrap if the actual field values are nested inside a 'metadata' property,
    // but preserve header fields needed for extended data (metadataset_uri, _source_text, etc.)
    let metadata = rawMetadata;
    if (rawMetadata && rawMetadata.metadata && typeof rawMetadata.metadata === 'object') {
        metadata = { ...rawMetadata.metadata };
        // Preserve header fields needed for extended data and schema resolution
        const headerFields = ['contextName', 'schemaVersion', 'metadataset', 'metadataset_uri', '_origins', '_source_text'];
        for (const key of headerFields) {
            if (rawMetadata[key] !== undefined) {
                metadata[key] = rawMetadata[key];
            }
        }
        // Preserve the source URL from the current item if not in metadata
        if (!metadata['ccm:wwwurl'] && currentCanvasItem?.url) {
            metadata['ccm:wwwurl'] = currentCanvasItem.url;
        }
    }

    try {
        showLoading('Metadaten werden gespeichert...');

        // Send to background for repository upload
        // Include previewUrl for guest mode (API captures screenshot server-side)
        const previewUrl = getMetadataValue(metadata, 'ccm:wwwurl') || currentCanvasItem?.url || null;
        const response = await chrome.runtime.sendMessage({
            action: 'saveMetadata',
            metadata: metadata,
            previewUrl: previewUrl
        });

        hideLoading();

        if (response.success) {
            console.log('✅ Metadata saved:', response);

            const urlValue = getMetadataValue(metadata, 'ccm:wwwurl') || currentCanvasItem?.url;
            const titleValue = getMetadataValue(metadata, 'cclom:title') || currentCanvasItem?.title || 'Unbekannt';
            const nodeId = response.nodeId || response.node?.ref?.id;
            const repoUrl = nodeId ? `${REPOSITORY_URL}/edu-sharing/components/render/${nodeId}` : null;
            const favicon = await getFaviconForHistory();

            // Upload screenshot as preview image (non-blocking).
            // Background pulls authHeader from the stored session — we never forward it.
            if (screenshotDataUrl && nodeId) {
                chrome.runtime.sendMessage({
                    action: 'tabs.uploadPreview',
                    nodeId,
                    screenshotDataUrl
                }).catch(e => console.warn('⚠️ Preview upload error:', e?.message || e));
            }

            // Add to history
            await chrome.runtime.sendMessage({
                action: 'history.add',
                data: { url: urlValue, title: titleValue, favicon, nodeId, repoUrl, status: 'success', metadata, timestamp: Date.now() }
            });

            // Remove from queue
            if (currentCanvasItem?.id && !currentCanvasItem.id.startsWith('temp-')) {
                await chrome.runtime.sendMessage({ action: 'queue.remove', id: currentCanvasItem.id });
            }

            showSuccessModal(response);
            closeCanvas();
            switchView('history');

        } else if (response.error === 'duplicate' && response.existingNode) {
            showDuplicateModal(response.existingNode);

            const urlValue = getMetadataValue(metadata, 'ccm:wwwurl') || currentCanvasItem?.url || response.existingNode.url;
            const titleValue = getMetadataValue(metadata, 'cclom:title') || currentCanvasItem?.title || 'Unbekannt';
            const favicon = await getFaviconForHistory();

            await chrome.runtime.sendMessage({
                action: 'history.add',
                data: { url: urlValue, title: titleValue, favicon, nodeId: response.existingNode.id,
                    repoUrl: `${REPOSITORY_URL}/edu-sharing/components/render/${response.existingNode.id}`,
                    status: 'duplicate', isDuplicate: true, metadata, timestamp: Date.now() }
            });
            closeCanvas();
            switchView('history');

        } else {
            alert(`Fehler beim Speichern:\n\n${response.error || 'Unbekannter Fehler'}`);
        }

    } catch (error) {
        hideLoading();
        console.error('❌ Save error:', error);
        alert(`Fehler beim Speichern:\n\n${error.message}`);
    }
}

// ============================================================================
// HELPER: Extract values from metadata (flat format from FastAPI)
// ============================================================================

function getMetadataValue(metadata, key) {
    const val = metadata[key];
    if (Array.isArray(val)) return val[0] || null;
    if (val && typeof val === 'object' && 'value' in val) {
        const v = val.value;
        return Array.isArray(v) ? v[0] : v;
    }
    return val || null;
}

async function getFaviconForHistory() {
    let favicon = currentCanvasItem?.favicon || '';
    if (!favicon) {
        try {
            const resp = await chrome.runtime.sendMessage({ action: 'tabs.getActive' });
            if (resp?.success && resp.tab?.favIconUrl) favicon = resp.tab.favIconUrl;
        } catch (e) { /* ignore */ }
    }
    return favicon;
}

// ============================================================================
// SAFE URL HELPERS & RENDERING
// ============================================================================

function safeImageUrl(raw) {
    if (typeof raw !== 'string' || !raw) return '';
    if (raw.startsWith('data:image/')) return raw; // data URLs for images are safe for <img src>
    try {
        const u = new URL(raw);
        if (u.protocol === 'https:' || u.protocol === 'http:') return u.href;
    } catch { /* fall through */ }
    return '';
}

function safeLinkUrl(raw) {
    if (typeof raw !== 'string' || !raw) return '';
    try {
        const u = new URL(raw);
        if (u.protocol === 'https:' || u.protocol === 'http:') return u.href;
    } catch { /* fall through */ }
    return '';
}

function iconBtn(action, id, titleAttr, iconName) {
    const btn = document.createElement('button');
    btn.className = 'icon-btn';
    btn.dataset.action = action;
    btn.dataset.id = id;
    btn.title = titleAttr;
    const icon = document.createElement('span');
    icon.className = 'material-icons';
    icon.textContent = iconName;
    btn.appendChild(icon);
    return btn;
}

function faviconElement(favUrl, fallbackIcon) {
    const safe = safeImageUrl(favUrl);
    if (safe) {
        const img = document.createElement('img');
        img.src = safe;
        img.className = 'item-favicon';
        img.alt = '';
        img.addEventListener('error', () => { img.style.display = 'none'; });
        return img;
    }
    const span = document.createElement('span');
    span.className = 'material-icons item-favicon';
    span.style.fontSize = '32px';
    span.style.color = 'var(--md-sys-color-primary,#003B7C)';
    span.textContent = fallbackIcon;
    return span;
}

function renderQueueCard(item) {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.dataset.id = item.id;

    card.appendChild(faviconElement(item.favicon, 'bookmark'));

    const content = document.createElement('div');
    content.className = 'item-content';

    const titleEl = document.createElement('div');
    titleEl.className = 'item-title';
    titleEl.textContent = item.title || '';

    const urlEl = document.createElement('div');
    urlEl.className = 'item-url';
    urlEl.textContent = item.url || '';

    const metaEl = document.createElement('div');
    metaEl.className = 'item-meta';
    metaEl.textContent = formatDate(item.timestamp);

    content.append(titleEl, urlEl, metaEl);
    card.appendChild(content);

    const actions = document.createElement('div');
    actions.className = 'item-actions';
    actions.append(
        iconBtn('process', item.id, 'Erschließen', 'play_arrow'),
        iconBtn('open', item.id, 'Öffnen', 'open_in_new'),
        iconBtn('delete', item.id, 'Entfernen', 'delete')
    );
    card.appendChild(actions);
    return card;
}

function renderHistoryCard(item) {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.dataset.id = item.id;

    const fallbackIcon = 'description';
    card.appendChild(faviconElement(item.favicon, fallbackIcon));

    const content = document.createElement('div');
    content.className = 'item-content';

    const titleEl = document.createElement('div');
    titleEl.className = 'item-title';
    titleEl.textContent = item.title || '';

    const urlEl = document.createElement('div');
    urlEl.className = 'item-url';
    urlEl.textContent = item.url || '';

    const metaEl = document.createElement('div');
    metaEl.className = 'item-meta';

    const statusSpan = document.createElement('span');
    const statusClass = item.isDuplicate ? 'duplicate' : (item.status === 'success' ? 'success' : 'error');
    statusSpan.className = `item-status status-${statusClass}`;
    const statusIconName = item.status === 'success' ? 'check_circle' : (item.isDuplicate ? 'content_copy' : 'error');
    const statusIcon = document.createElement('span');
    statusIcon.className = 'material-icons';
    statusIcon.style.fontSize = '16px';
    statusIcon.textContent = statusIconName;
    const statusText = document.createElement('span');
    statusText.textContent = item.isDuplicate ? 'Duplikat' : (item.status === 'success' ? 'Erfolgreich' : 'Fehler');
    statusSpan.append(statusIcon, statusText);

    const dateSpan = document.createElement('span');
    dateSpan.textContent = formatDate(item.timestamp);

    metaEl.append(statusSpan, dateSpan);
    content.append(titleEl, urlEl, metaEl);

    const safeRepoUrl = safeLinkUrl(item.repoUrl);
    if (safeRepoUrl) {
        const link = document.createElement('a');
        link.href = safeRepoUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.className = 'btn-text';
        link.style.cssText = 'font-size:12px;padding:4px 8px;margin-top:4px;';
        const linkIcon = document.createElement('span');
        linkIcon.className = 'material-icons';
        linkIcon.style.fontSize = '16px';
        linkIcon.textContent = 'open_in_new';
        const linkText = document.createElement('span');
        linkText.textContent = 'Im Repository öffnen';
        link.append(linkIcon, linkText);
        content.appendChild(link);
    }

    card.appendChild(content);

    const actions = document.createElement('div');
    actions.className = 'item-actions';
    actions.appendChild(iconBtn('delete', item.id, 'Entfernen', 'delete'));
    card.appendChild(actions);

    return card;
}

// ============================================================================
// QUEUE MANAGEMENT
// ============================================================================

let queueSearchTimeout;

async function loadQueue(searchQuery = '') {
    try {
        const response = searchQuery
            ? await chrome.runtime.sendMessage({ action: 'queue.search', query: searchQuery.toLowerCase() })
            : await chrome.runtime.sendMessage({ action: 'queue.get' });

        if (!response.success) return;

        const queue = response.data || response.queue || [];
        const queueList = document.getElementById('queue-list');
        const queueEmpty = document.getElementById('queue-empty');
        const queueContent = document.getElementById('queue-content');
        const queueBadge = document.getElementById('queue-badge');

        // Update badge
        if (queueBadge) {
            if (queue.length > 0) { queueBadge.textContent = queue.length; queueBadge.classList.remove('hidden'); }
            else { queueBadge.classList.add('hidden'); }
        }

        if (queue.length === 0) {
            queueEmpty.classList.remove('hidden');
            queueContent?.classList.add('hidden');
            return;
        }

        queueEmpty.classList.add('hidden');
        queueContent?.classList.remove('hidden');

        queueList.replaceChildren(...queue.map(item => renderQueueCard(item)));
        queueList.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', handleQueueItemAction);
        });

    } catch (error) {
        console.error('❌ Load queue error:', error);
    }
}

async function handleQueueItemAction(e) {
    const action = e.currentTarget.dataset.action;
    const itemId = e.currentTarget.dataset.id;
    const response = await chrome.runtime.sendMessage({ action: 'queue.get' });
    const item = response.data?.find(i => i.id === itemId);
    if (!item) return;

    if (action === 'open') chrome.tabs.create({ url: item.url });
    else if (action === 'process') openCanvasForItem(item);
    else if (action === 'delete') {
        await chrome.runtime.sendMessage({ action: 'queue.remove', id: itemId });
        loadQueue();
    }
}

async function handleAddCurrentPage() {
    try {
        showLoading('Metadaten werden extrahiert...');
        const activeTabResponse = await chrome.runtime.sendMessage({ action: 'tabs.getActive' });
        if (!activeTabResponse?.success || !activeTabResponse.tab) throw new Error('Keine aktive Seite gefunden');

        const tab = activeTabResponse.tab;
        if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) throw new Error('Diese Seite kann nicht hinzugefügt werden');

        let pageData = null;
        try {
            const extractResponse = await chrome.runtime.sendMessage({ action: 'tabs.extractPageData', tabId: tab.id });
            if (extractResponse?.success && extractResponse.data) pageData = extractResponse.data;
        } catch (e) { console.warn('⚠️ Extraction failed, using basic data'); }

        const resp = await chrome.runtime.sendMessage({
            action: 'queue.add',
            data: {
                url: pageData?.url || tab.url,
                title: pageData?.title || tab.title || tab.url,
                favicon: tab.favIconUrl || '',
                timestamp: Date.now(),
                metadata: pageData || {},
                extractedContent: { html: pageData?.html || '', text: pageData?.formattedText || pageData?.mainContent || '' }
            }
        });

        if (resp.success) { updateQueueBadge(); switchView('queue'); }
        else throw new Error(resp.error || 'Konnte Seite nicht hinzufügen');
    } catch (error) {
        console.error('❌ Add page error:', error);
        alert('Fehler:\n\n' + error.message);
    } finally {
        hideLoading();
    }
}

async function updateQueueBadge() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'queue.get' });
        if (response.success && response.data) {
            const badge = document.getElementById('queue-badge');
            if (response.data.length > 0) { badge.textContent = response.data.length; badge.classList.remove('hidden'); }
            else badge.classList.add('hidden');
        }
    } catch (e) { /* ignore */ }
}

function setupQueueEventListeners() {
    document.getElementById('queue-search')?.addEventListener('input', (e) => {
        clearTimeout(queueSearchTimeout);
        queueSearchTimeout = setTimeout(() => loadQueue(e.target.value), 300);
    });
    document.getElementById('queue-export-btn')?.addEventListener('click', async () => {
        const response = await chrome.runtime.sendMessage({ action: 'queue.export' });
        if (response.success) downloadJSON(response.data, `wlo-merkliste-${Date.now()}.json`);
    });
    document.getElementById('queue-clear-btn')?.addEventListener('click', async () => {
        if (!confirm('Wirklich alle Einträge löschen?')) return;
        await chrome.runtime.sendMessage({ action: 'queue.clear' });
        loadQueue();
        updateQueueBadge();
    });
}

// ============================================================================
// HISTORY MANAGEMENT
// ============================================================================

let historySearchTimeout;

async function loadHistory(searchQuery = '') {
    try {
        const response = searchQuery
            ? await chrome.runtime.sendMessage({ action: 'history.search', query: searchQuery })
            : await chrome.runtime.sendMessage({ action: 'history.get' });

        if (!response.success) return;

        const history = response.data || [];
        const historyList = document.getElementById('history-list');
        const historyEmpty = document.getElementById('history-empty');
        const historyContent = document.getElementById('history-content');

        if (history.length === 0) {
            historyEmpty.classList.remove('hidden');
            historyContent?.classList.add('hidden');
            return;
        }

        historyEmpty.classList.add('hidden');
        historyContent?.classList.remove('hidden');

        historyList.replaceChildren(...history.map(item => renderHistoryCard(item)));
        historyList.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const itemId = e.currentTarget.dataset.id;
                const { history: current = [] } = await chrome.storage.local.get('history');
                const filtered = current.filter(i => i.id !== itemId);
                await chrome.storage.local.set({ history: filtered });
                loadHistory();
            });
        });

        loadHistoryStats();
    } catch (error) {
        console.error('❌ Load history error:', error);
    }
}

async function loadHistoryStats() {
    const response = await chrome.runtime.sendMessage({ action: 'history.stats' });
    if (!response.success) return;
    const stats = response.data || {};
    const statsRow = document.getElementById('history-stats');
    if (!statsRow) return;

    const makeCard = (value, label) => {
        const card = document.createElement('div');
        card.className = 'stat-card';
        const v = document.createElement('div');
        v.className = 'stat-value';
        v.textContent = String(Number(value) || 0);
        const l = document.createElement('div');
        l.className = 'stat-label';
        l.textContent = label;
        card.append(v, l);
        return card;
    };

    statsRow.replaceChildren(
        makeCard(stats.total, 'Gesamt'),
        makeCard(stats.success, 'Erfolgreich'),
        makeCard(stats.duplicates, 'Duplikate'),
        makeCard(stats.errors, 'Fehler')
    );
}

function setupHistoryEventListeners() {
    document.getElementById('history-search')?.addEventListener('input', (e) => {
        clearTimeout(historySearchTimeout);
        historySearchTimeout = setTimeout(() => loadHistory(e.target.value), 300);
    });
    document.getElementById('history-export-btn')?.addEventListener('click', async () => {
        const response = await chrome.runtime.sendMessage({ action: 'history.export' });
        if (response.success) downloadJSON(response.data, `wlo-verlauf-${Date.now()}.json`);
    });
    document.getElementById('history-clear-btn')?.addEventListener('click', async () => {
        if (!confirm('Wirklich den gesamten Verlauf löschen?')) return;
        await chrome.runtime.sendMessage({ action: 'history.clear' });
        loadHistory();
    });
}

// ============================================================================
// SUCCESS & ERROR MODALS
// ============================================================================

function buildStaticModalFromTemplate(templateHtml) {
    const modal = document.createElement('div');
    modal.className = 'success-modal-overlay';
    const range = document.createRange();
    range.selectNode(document.body);
    modal.appendChild(range.createContextualFragment(templateHtml));
    return modal;
}

function showSuccessModal(response) {
    if (!response || typeof response.nodeId !== 'string' || !response.nodeId) return;
    const nodeId = response.nodeId;
    const mode = response.mode === 'user' ? 'user' : 'guest';
    const nodeUrl = `${REPOSITORY_URL}/edu-sharing/components/render/${encodeURIComponent(nodeId)}`;
    const modeText = mode === 'user' ? 'Benutzer-Upload' : 'Gast-Upload (Prüfung erforderlich)';
    const subtitle = mode === 'user' ? 'Ins Repository hochgeladen' : 'Zur Prüfung eingereicht';

    const modal = buildStaticModalFromTemplate(`
        <div class="success-modal">
            <button class="modal-close-x">✕</button>
            <div class="modal-icon success">✓</div>
            <h2 class="modal-title">Erfolgreich gespeichert!</h2>
            <p class="modal-subtitle"></p>
            <div class="modal-badge"></div>
            <div class="modal-buttons">
                <button class="btn btn-primary modal-view-btn">
                    <span class="material-icons">open_in_new</span>
                    <span>Im Repository ansehen</span>
                </button>
                <button class="btn btn-secondary modal-close-btn">
                    <span class="material-icons">check</span>
                    <span>Fertig</span>
                </button>
            </div>
        </div>
    `);
    modal.querySelector('.modal-subtitle').textContent = subtitle;
    modal.querySelector('.modal-badge').textContent = `${mode === 'user' ? '🔐' : '🔓'} ${modeText}`;

    document.body.appendChild(modal);
    modal.querySelector('.modal-close-x').addEventListener('click', () => modal.remove());
    modal.querySelector('.modal-close-btn').addEventListener('click', () => modal.remove());
    modal.querySelector('.modal-view-btn').addEventListener('click', () => { window.open(nodeUrl, '_blank', 'noopener,noreferrer'); modal.remove(); });
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

function showDuplicateModal(existingNode) {
    if (!existingNode || typeof existingNode.id !== 'string' || !existingNode.id) return;
    const nodeUrl = `${REPOSITORY_URL}/edu-sharing/components/render/${encodeURIComponent(existingNode.id)}`;

    const modal = buildStaticModalFromTemplate(`
        <div class="success-modal">
            <button class="modal-close-x">✕</button>
            <div class="modal-icon warning">⚠</div>
            <h2 class="modal-title">Duplikat gefunden</h2>
            <p class="modal-subtitle">Diese URL ist bereits im Repository</p>
            <div class="modal-info">
                <div class="info-label">Titel</div>
                <div class="info-value"></div>
            </div>
            <div class="modal-buttons">
                <button class="btn btn-primary modal-view-btn">
                    <span class="material-icons">open_in_new</span>
                    <span>Im Repository ansehen</span>
                </button>
                <button class="btn btn-secondary modal-close-btn">
                    <span class="material-icons">close</span>
                    <span>Schließen</span>
                </button>
            </div>
        </div>
    `);
    modal.querySelector('.info-value').textContent = typeof existingNode.title === 'string' ? existingNode.title : 'Unbekannt';

    document.body.appendChild(modal);
    modal.querySelector('.modal-close-x').addEventListener('click', () => modal.remove());
    modal.querySelector('.modal-close-btn').addEventListener('click', () => modal.remove());
    modal.querySelector('.modal-view-btn').addEventListener('click', () => { window.open(nodeUrl, '_blank', 'noopener,noreferrer'); modal.remove(); });
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return 'Gerade eben';
    if (diffMins < 60) return `vor ${diffMins} Min.`;
    if (diffHours < 24) return `vor ${diffHours} Std.`;
    if (diffDays < 7) return `vor ${diffDays} Tag${diffDays > 1 ? 'en' : ''}`;
    return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// ============================================================================
// BUILD FORMATTED TEXT FROM METADATA (reused from old plugin)
// ============================================================================

function buildFormattedTextFromMetadata(data) {
    if (!data || typeof data !== 'object') return '';
    let text = '';
    text += '=== GRUNDINFORMATIONEN ===\n';
    if (data.url) text += `URL: ${data.url}\n`;
    if (data.title) text += `Titel: ${data.title}\n`;
    if (data.canonical?.url) text += `Canonical URL: ${data.canonical.url}\n`;
    text += '\n';
    if (data.meta && Object.values(data.meta).some(v => v)) {
        text += '=== META-TAGS ===\n';
        if (data.meta.description) text += `description: ${data.meta.description}\n`;
        if (data.meta.keywords) text += `keywords: ${data.meta.keywords}\n`;
        if (data.meta.author) text += `author: ${data.meta.author}\n`;
        if (data.meta.language) text += `Sprache: ${data.meta.language}\n`;
        text += '\n';
    }
    if (data.openGraph && Object.values(data.openGraph).some(v => v)) {
        text += '=== OPEN GRAPH ===\n';
        if (data.openGraph.title) text += `og:title: ${data.openGraph.title}\n`;
        if (data.openGraph.description) text += `og:description: ${data.openGraph.description}\n`;
        if (data.openGraph.type) text += `og:type: ${data.openGraph.type}\n`;
        text += '\n';
    }
    if (data.dublinCore && Object.values(data.dublinCore).some(v => v)) {
        text += '=== DUBLIN CORE ===\n';
        for (const [key, val] of Object.entries(data.dublinCore)) { if (val) text += `DC.${key}: ${val}\n`; }
        text += '\n';
    }
    if (data.structuredData && data.structuredData.length > 0) {
        text += '=== SCHEMA.ORG JSON-LD ===\n';
        data.structuredData.forEach((schema, i) => {
            text += `Schema ${i + 1} (@type: ${schema['@type'] || 'unknown'}):\n`;
            text += JSON.stringify(schema, null, 2).substring(0, 1000) + '\n';
        });
        text += '\n';
    }
    text += '=== HAUPTINHALT ===\n';
    text += (data.mainContent || '');
    return text;
}

console.log('✅ Sidebar v7 script initialized');
