// WLO Metadaten-Agent - Background Service Worker
// VERSION: 7.1.0 — VCARD author, obeyMds=false, geo extraction, aspects
// Upload logic handles flat metadata format from FastAPI/web component
console.log('🚀 WLO Background Service Worker v7 loaded');

// ===========================================================================
// CONFIGURATION
// ===========================================================================

const REPOSITORY_URL = 'https://repository.staging.openeduhub.net';
const GUEST_INBOX_ID = '21144164-30c0-4c01-ae16-264452197063';
const GUEST_CREDENTIALS = {
    username: 'WLO-Upload',
    password: 'wlo#upload!20'
};

const MAX_QUEUE_SIZE = 100;
const MAX_HISTORY_SIZE = 100;

// ===========================================================================
// SIDEBAR MANAGEMENT
// ===========================================================================

chrome.action.onClicked.addListener(async (tab) => {
    try {
        await chrome.sidePanel.setOptions({ tabId: tab.id, path: 'sidebar/sidebar.html', enabled: true });
        await chrome.sidePanel.open({ tabId: tab.id });
    } catch (error) {
        console.error('❌ Failed to open sidebar:', error);
        try { await chrome.sidePanel.open({ windowId: tab.windowId }); } catch (e) { /* ignore */ }
    }
});

// ===========================================================================
// CONTEXT MENU
// ===========================================================================

chrome.runtime.onInstalled.addListener(() => {
    console.log('🔧 Extension installed/updated');
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

    chrome.contextMenus.create({ id: 'add-to-queue', title: 'Zur Merkliste hinzufügen', contexts: ['all'] });
    chrome.contextMenus.create({ id: 'add-page-to-queue', title: 'Diese Seite', parentId: 'add-to-queue', contexts: ['all'] });
    chrome.contextMenus.create({ id: 'add-link-to-queue', title: 'Diesen Link', parentId: 'add-to-queue', contexts: ['link'] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    let url = '';
    let title = '';

    if (info.menuItemId === 'add-page-to-queue') { url = tab.url; title = tab.title || tab.url; }
    else if (info.menuItemId === 'add-link-to-queue') { url = info.linkUrl; title = info.linkUrl; }

    if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return;

    try {
        const { queue = [] } = await chrome.storage.local.get('queue');
        if (queue.some(item => item.url === url)) {
            chrome.notifications.create({ type: 'basic', iconUrl: 'icons/128.png', title: 'Bereits vorgemerkt', message: 'Diese Seite ist bereits in der Merkliste' });
            return;
        }

        let pageData = { url, title, html: '', text: '', metadata: {} };
        try {
            const extracted = await chrome.tabs.sendMessage(tab.id, { action: 'extractPageData' });
            if (extracted) pageData = extracted;
        } catch (e) { /* content script not loaded */ }

        queue.push({
            id: generateId(),
            url: pageData.url || url,
            title: pageData.title || title,
            timestamp: Date.now(),
            favicon: tab.favIconUrl || '',
            metadata: pageData,
            extractedContent: { html: pageData.html || '', text: pageData.formattedText || pageData.mainContent || pageData.text || '' }
        });

        if (queue.length > MAX_QUEUE_SIZE) queue.splice(0, queue.length - MAX_QUEUE_SIZE);
        await chrome.storage.local.set({ queue });

        chrome.action.setBadgeText({ text: queue.length.toString() });
        chrome.action.setBadgeBackgroundColor({ color: '#003B7C' });
        chrome.notifications.create({ type: 'basic', iconUrl: 'icons/128.png', title: 'Zur Merkliste hinzugefügt', message: title });

        try { if (chrome.sidePanel?.open) await chrome.sidePanel.open({ windowId: tab.windowId }); } catch (e) { /* ignore */ }
    } catch (error) {
        console.error('❌ Failed to add to queue:', error);
    }
});

// ===========================================================================
// METADATA HELPERS (flat format from FastAPI)
// ===========================================================================

function ensureArray(value, defaultValue = []) {
    if (Array.isArray(value)) return value.length > 0 ? value : defaultValue;
    if (value === null || value === undefined || value === '') return defaultValue;
    return [value];
}

function getFieldValue(metadata, key) {
    const val = metadata[key];
    if (val === null || val === undefined) return null;
    if (Array.isArray(val)) return val;
    if (typeof val === 'object' && 'value' in val) return val.value;
    return val;
}

function getSingleValue(metadata, key) {
    const val = getFieldValue(metadata, key);
    if (Array.isArray(val)) return val.length > 0 ? val[0] : null;
    return val;
}

// Fields that are set during node creation (not in metadata update)
const ESSENTIAL_FIELDS = ['cclom:title', 'cclom:general_description', 'cclom:general_keyword', 'ccm:wwwurl', 'cclom:general_language'];

// Internal/meta keys to skip
function isInternalKey(key) {
    if (key.startsWith('_')) return true;
    if (['contextName', 'schemaVersion', 'metadataset', 'language', 'exportedAt', 'processing'].includes(key)) return true;
    if (key.startsWith('virtual:') || key.startsWith('sys:') || key.startsWith('preview:')) return true;
    return false;
}

function buildAdditionalMetadata(metadata) {
    const result = {};

    for (const [key, value] of Object.entries(metadata)) {
        if (isInternalKey(key)) continue;
        if (ESSENTIAL_FIELDS.includes(key)) continue;
        if (key === 'ccm:linktype') continue;

        const fieldValue = getFieldValue(metadata, key);
        if (fieldValue === null || fieldValue === undefined) continue;

        // Normalize to array for edu-sharing API
        const normalized = ensureArray(fieldValue);
        if (normalized.length > 0) {
            result[key] = normalized;
        }
    }

    // Handle license transform
    applyLicenseTransform(result, metadata);

    // Transform cm:author → ccm:lifecyclecontributer_author (VCARD format)
    transformAuthorToVcard(result);

    // Extract geo coordinates from schema:location / schema:geo
    extractGeoCoordinates(result, metadata);

    return result;
}

function applyLicenseTransform(result, originalMetadata) {
    const customLicense = getSingleValue(originalMetadata, 'ccm:custom_license');
    if (customLicense && typeof customLicense === 'string') {
        const token = customLicense.substring(customLicense.lastIndexOf('/') + 1);
        if (token) {
            if (token.endsWith('_40')) {
                result['ccm:commonlicense_key'] = [token.slice(0, -3)];
                result['ccm:commonlicense_cc_version'] = ['4.0'];
            } else if (token === 'OTHER') {
                result['ccm:commonlicense_key'] = ['CUSTOM'];
            } else {
                result['ccm:commonlicense_key'] = [token];
            }
        }
        delete result['ccm:custom_license'];
    }

    if (result['ccm:commonlicense_key'] && !result['ccm:commonlicense_cc_version']) {
        result['ccm:commonlicense_cc_version'] = ['4.0'];
    }

    return result;
}

// ===========================================================================
// VCARD AUTHOR TRANSFORM
// ===========================================================================

function transformAuthorToVcard(result) {
    const authors = result['cm:author'];
    if (!authors || authors.length === 0) return;

    const vcards = [];
    for (const author of authors) {
        const name = String(author).trim();
        if (!name) continue;
        const parts = name.split(' ');
        let vcard;
        if (parts.length >= 2) {
            const last = parts[parts.length - 1];
            const first = parts.slice(0, -1).join(' ');
            vcard = `BEGIN:VCARD\nFN:${name}\nN:${last};${first}\nVERSION:3.0\nEND:VCARD`;
        } else {
            vcard = `BEGIN:VCARD\nFN:${name}\nN:${name}\nVERSION:3.0\nEND:VCARD`;
        }
        vcards.push(vcard);
    }

    if (vcards.length > 0) {
        delete result['cm:author'];
        result['ccm:lifecyclecontributer_author'] = vcards;
        console.log(`👤 Author VCARD: ${vcards.length} entries`);
    }
}

// ===========================================================================
// GEO COORDINATE EXTRACTION
// ===========================================================================

function extractGeoCoordinates(result, metadata) {
    // Source 1: schema:location[].geo.latitude/longitude
    const locations = metadata['schema:location'];
    if (Array.isArray(locations)) {
        for (const loc of locations) {
            if (loc && typeof loc === 'object' && loc.geo && typeof loc.geo === 'object') {
                const lat = loc.geo.latitude;
                const lon = loc.geo.longitude;
                if (lat != null && lon != null) {
                    result['cm:latitude'] = [String(lat)];
                    result['cm:longitude'] = [String(lon)];
                    console.log(`📍 Geo (location): ${lat}, ${lon}`);
                    return;
                }
            }
        }
    }

    // Source 2: schema:geo (organization top-level)
    const geo = metadata['schema:geo'];
    if (geo && typeof geo === 'object') {
        const lat = geo.latitude;
        const lon = geo.longitude;
        if (lat != null && lon != null) {
            result['cm:latitude'] = [String(lat)];
            result['cm:longitude'] = [String(lon)];
            console.log(`📍 Geo (top-level): ${lat}, ${lon}`);
        }
    }
}

// ===========================================================================
// ENSURE ASPECTS
// ===========================================================================

async function ensureAspects(nodeId, metadata, authHeader) {
    const extraAspects = [];

    // cm:geographic for geo fields
    let hasGeo = false;
    const locations = metadata['schema:location'];
    if (Array.isArray(locations)) {
        hasGeo = locations.some(l => l && typeof l === 'object' && l.geo && typeof l.geo === 'object');
    }
    if (!hasGeo && metadata['schema:geo'] && typeof metadata['schema:geo'] === 'object') {
        const g = metadata['schema:geo'];
        if (g.latitude != null && g.longitude != null) hasGeo = true;
    }
    if (hasGeo) extraAspects.push('cm:geographic');

    // cm:author for VCARD
    if (metadata['cm:author'] && (Array.isArray(metadata['cm:author']) ? metadata['cm:author'].length > 0 : true)) {
        extraAspects.push('cm:author');
    }

    if (extraAspects.length === 0) return;

    try {
        // Read current aspects
        const metaResp = await fetch(
            `${REPOSITORY_URL}/edu-sharing/rest/node/v1/nodes/-home-/${nodeId}/metadata?propertyFilter=-all-`,
            { headers: { 'Authorization': authHeader, 'Accept': 'application/json' }, credentials: 'include' }
        );
        let currentAspects = [];
        if (metaResp.ok) {
            const data = await metaResp.json();
            currentAspects = data.node?.aspects || [];
        }

        const newAspects = extraAspects.filter(a => !currentAspects.includes(a));
        if (newAspects.length === 0) return;

        const fullList = [...currentAspects, ...newAspects];
        const resp = await fetch(
            `${REPOSITORY_URL}/edu-sharing/rest/node/v1/nodes/-home-/${nodeId}/aspects`,
            {
                method: 'PUT',
                headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(fullList)
            }
        );
        if (resp.ok) console.log(`🔧 Aspects added: ${newAspects.join(', ')}`);
        else console.warn(`⚠️ Aspects failed: ${resp.status}`);
    } catch (e) {
        console.warn('⚠️ Aspect update error:', e);
    }
}

// ===========================================================================
// DUPLICATE CHECK
// ===========================================================================

async function checkDuplicate(url, authHeader) {
    try {
        const searchResponse = await fetch(
            `${REPOSITORY_URL}/edu-sharing/rest/search/v1/queries/-home-/mds_oeh/ngsearch?contentType=FILES&maxItems=10&skipCount=0&propertyFilter=ccm:wwwurl`,
            {
                method: 'POST',
                headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ criteria: [{ property: 'ccm:wwwurl', values: [url] }] })
            }
        );

        if (!searchResponse.ok) return null;
        const searchData = await searchResponse.json();

        if (searchData.nodes && searchData.nodes.length > 0) {
            for (const node of searchData.nodes) {
                const nodeUrl = node.properties?.['ccm:wwwurl']?.[0];
                if (nodeUrl && nodeUrl.toLowerCase() === url.toLowerCase()) {
                    return { id: node.ref.id, title: node.title, url: nodeUrl };
                }
            }
        }
        return null;
    } catch (error) {
        console.error('❌ Duplicate check error:', error);
        return null;
    }
}

// ===========================================================================
// UPLOAD: USER MODE
// ===========================================================================

async function uploadAsUser(metadata, session) {
    console.log('🔐 Uploading as User:', session.authorityName);

    const authHeader = session.authHeader;
    const userHomeId = session.userHomeId;
    if (!userHomeId) throw new Error('User Home ID nicht gefunden');

    const url = getSingleValue(metadata, 'ccm:wwwurl');
    if (!url) throw new Error('URL fehlt in Metadaten');

    // 1. Duplicate check
    const existingNode = await checkDuplicate(url, authHeader);
    if (existingNode) {
        return { success: false, error: 'duplicate', message: 'URL bereits im Repository.', existingNode };
    }

    // 2. Create node
    const titleArray = ensureArray(getFieldValue(metadata, 'cclom:title'), ['Untitled']);
    const createPayload = {
        'ccm:wwwurl': ensureArray(url),
        'ccm:linktype': ['USER_GENERATED'],
        'cclom:title': titleArray
    };
    const descArray = ensureArray(getFieldValue(metadata, 'cclom:general_description'));
    if (descArray.length > 0) createPayload['cclom:general_description'] = descArray;
    const kwArray = ensureArray(getFieldValue(metadata, 'cclom:general_keyword'));
    if (kwArray.length > 0) createPayload['cclom:general_keyword'] = kwArray;
    const langArray = ensureArray(getFieldValue(metadata, 'cclom:general_language'), ['de']);
    if (langArray.length > 0) createPayload['cclom:general_language'] = langArray;

    const createResponse = await fetch(
        `${REPOSITORY_URL}/edu-sharing/rest/node/v1/nodes/-home-/${userHomeId}/children?type=ccm:io&renameIfExists=true&versionComment=MAIN_FILE_UPLOAD`,
        {
            method: 'POST',
            headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(createPayload)
        }
    );

    if (!createResponse.ok) {
        const errorText = await createResponse.text();
        throw new Error(`Create node failed: ${createResponse.status} - ${errorText.substring(0, 200)}`);
    }

    const createData = await createResponse.json();
    const nodeId = createData.node.ref.id;
    console.log('✅ Node created:', nodeId);

    // 3. Ensure aspects for special fields
    await ensureAspects(nodeId, metadata, authHeader);

    // 4. Set additional metadata (with obeyMds=false)
    const metadataToSet = buildAdditionalMetadata(metadata);
    if (Object.keys(metadataToSet).length > 0) {
        const metaResponse = await fetch(
            `${REPOSITORY_URL}/edu-sharing/rest/node/v1/nodes/-home-/${nodeId}/metadata?versionComment=METADATA_UPDATE&obeyMds=false`,
            {
                method: 'POST',
                headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(metadataToSet)
            }
        );
        if (!metaResponse.ok) console.warn('⚠️ Set metadata failed, but node was created');
        else console.log('✅ Metadata set');
    }

    const repoUrl = `${REPOSITORY_URL}/edu-sharing/components/render/${nodeId}`;
    return { success: true, nodeId, mode: 'user', title: titleArray[0], repoUrl, repositoryUrl: repoUrl };
}

// ===========================================================================
// UPLOAD: GUEST MODE
// ===========================================================================

async function uploadAsGuest(metadata) {
    console.log('🔓 Uploading as Guest...');

    const authHeader = 'Basic ' + btoa(GUEST_CREDENTIALS.username + ':' + GUEST_CREDENTIALS.password);

    const url = getSingleValue(metadata, 'ccm:wwwurl');
    if (!url) throw new Error('URL fehlt in Metadaten');

    // 1. Duplicate check
    const existingNode = await checkDuplicate(url, authHeader);
    if (existingNode) {
        return { success: false, error: 'duplicate', message: 'URL bereits im Repository.', existingNode };
    }

    // 2. Create node
    const titleArray = ensureArray(getFieldValue(metadata, 'cclom:title'), ['Untitled']);
    const essentialFields = {
        'cclom:title': titleArray,
        'cclom:general_description': ensureArray(getFieldValue(metadata, 'cclom:general_description')),
        'cclom:general_keyword': ensureArray(getFieldValue(metadata, 'cclom:general_keyword')),
        'ccm:wwwurl': ensureArray(url),
        'cclom:general_language': ensureArray(getFieldValue(metadata, 'cclom:general_language'), ['de_DE'])
    };

    const createResponse = await fetch(
        `${REPOSITORY_URL}/edu-sharing/rest/node/v1/nodes/-home-/${GUEST_INBOX_ID}/children?type=ccm:io&renameIfExists=true&versionComment=MAIN_FILE_UPLOAD`,
        {
            method: 'POST',
            headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(essentialFields)
        }
    );

    if (!createResponse.ok) {
        const errorText = await createResponse.text();
        throw new Error(`Create node failed: ${createResponse.status} - ${errorText.substring(0, 200)}`);
    }

    const createData = await createResponse.json();
    const nodeId = createData.node.ref.id;
    console.log('✅ Node created:', nodeId);

    // 3. Ensure aspects for special fields
    await ensureAspects(nodeId, metadata, authHeader);

    // 4. Set additional metadata (with obeyMds=false)
    const metadataToSet = buildAdditionalMetadata(metadata);
    if (Object.keys(metadataToSet).length > 0) {
        const metaResponse = await fetch(
            `${REPOSITORY_URL}/edu-sharing/rest/node/v1/nodes/-home-/${nodeId}/metadata?versionComment=METADATA_UPDATE&obeyMds=false`,
            {
                method: 'POST',
                headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(metadataToSet)
            }
        );
        if (!metaResponse.ok) console.warn('⚠️ Set metadata failed, but node was created');
        else console.log('✅ Metadata set');
    }

    // 5. Start workflow
    const workflowPayload = {
        receiver: [{ authorityName: 'GROUP_ORG_WLO-Uploadmanager' }],
        comment: 'Upload via Browser Extension (Guest)',
        status: '200_tocheck'
    };
    try {
        await fetch(
            `${REPOSITORY_URL}/edu-sharing/rest/node/v1/nodes/-home-/${nodeId}/workflow`,
            {
                method: 'PUT',
                headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(workflowPayload)
            }
        );
        console.log('✅ Workflow started');
    } catch (e) {
        console.warn('⚠️ Workflow start failed:', e);
    }

    return { success: true, nodeId, mode: 'guest', title: titleArray[0], message: 'Zur Prüfung eingereicht!' };
}

// ===========================================================================
// SAVE HANDLER
// ===========================================================================

async function handleSaveMetadata(metadata) {
    console.log('💾 Starting metadata save...');
    try {
        const { wloSession } = await chrome.storage.local.get('wloSession');
        const isUserMode = wloSession && wloSession.isValidLogin && !wloSession.isGuest;
        console.log(`📋 Mode: ${isUserMode ? 'User' : 'Guest'}`);

        if (isUserMode) return await uploadAsUser(metadata, wloSession);
        else return await uploadAsGuest(metadata);
    } catch (error) {
        console.error('❌ Save failed:', error);
        throw error;
    }
}

// ===========================================================================
// HELPERS
// ===========================================================================

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

async function getActiveNormalTab() {
    const normalTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true, windowType: 'normal' }).catch(() => []);
    let tab = normalTabs?.[0];
    if (!tab) {
        const allTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
        tab = allTabs?.find(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://')) || null;
    }
    return tab || null;
}

// ===========================================================================
// MESSAGE HANDLERS
// ===========================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Save metadata (async)
    if (message.action === 'saveMetadata') {
        handleSaveMetadata(message.metadata)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    // Warenkorb: addItem is handled directly by sidebar listener
    // (chrome.runtime.sendMessage from content scripts reaches all extension pages)
    if (message.action === 'warenkorb.addItem') {
        return false; // Let the sidebar handle it
    }

    // Warenkorb: prefetch search results so content script can map card titles → nodeIds
    if (message.action === 'warenkorb.prefetchSearch') {
        const query = message.query;
        if (!query) { sendResponse({ nodes: [] }); return true; }

        const repoUrl = 'https://redaktion.openeduhub.net/edu-sharing/rest';
        const searchUrl = `${repoUrl}/search/v1/queries/-home-/mds_oeh/ngsearch`
            + `?contentType=FILES&maxItems=50&skipCount=0&propertyFilter=-all-`;

        fetch(searchUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ criteria: [{ property: 'ngsearchword', values: [query] }] })
        })
        .then(r => r.ok ? r.json() : Promise.reject(r.status))
        .then(data => {
            const nodes = (data.nodes || []).map(n => ({
                id: n.ref?.id || '',
                title: (n.properties?.['cclom:title'] || [])[0] || n.name || '',
                publisher: (n.properties?.['ccm:oeh_publisher_combined'] || [])[0] || '',
                wwwurl: (n.properties?.['ccm:wwwurl'] || [])[0] || ''
            }));
            console.log('🛒 Prefetch:', nodes.length, 'nodes for query:', query);
            sendResponse({ nodes });
        })
        .catch(err => {
            console.warn('🛒 Prefetch failed:', err);
            sendResponse({ nodes: [] });
        });
        return true; // keep channel open for async
    }

    const handleAsync = async () => {
        try {
            switch (message.action) {
                case 'tabs.getActive': {
                    const tab = await getActiveNormalTab();
                    if (!tab) return { success: false, error: 'NO_ACTIVE_TAB' };
                    const { id, url, title, favIconUrl } = tab;
                    return { success: true, tab: { id, url, title, favIconUrl } };
                }

                case 'tabs.extractPageData': {
                    let targetTabId = message.tabId;
                    if (!targetTabId) {
                        const tab = await getActiveNormalTab();
                        if (!tab) return { success: false, error: 'NO_ACTIVE_TAB' };
                        targetTabId = tab.id;
                    }
                    try {
                        const pageData = await chrome.tabs.sendMessage(targetTabId, { action: 'extractPageData' });
                        return { success: true, data: pageData };
                    } catch (e) {
                        return { success: false, error: e?.message || 'EXTRACTION_FAILED' };
                    }
                }

                // Queue operations
                case 'queue.get': {
                    const { queue = [] } = await chrome.storage.local.get('queue');
                    return { success: true, data: queue, queue };
                }
                case 'queue.add': {
                    const { queue = [] } = await chrome.storage.local.get('queue');
                    const newItem = { id: message.data.id || generateId(), ...message.data, timestamp: message.data.timestamp || Date.now() };
                    queue.push(newItem);
                    if (queue.length > MAX_QUEUE_SIZE) queue.splice(0, queue.length - MAX_QUEUE_SIZE);
                    await chrome.storage.local.set({ queue });
                    chrome.action.setBadgeText({ text: queue.length.toString() });
                    chrome.action.setBadgeBackgroundColor({ color: '#003B7C' });
                    return { success: true, data: newItem };
                }
                case 'queue.remove': {
                    const { queue = [] } = await chrome.storage.local.get('queue');
                    const filtered = queue.filter(item => item.id !== message.id);
                    await chrome.storage.local.set({ queue: filtered });
                    chrome.action.setBadgeText({ text: filtered.length > 0 ? filtered.length.toString() : '' });
                    return { success: true };
                }
                case 'queue.clear': {
                    await chrome.storage.local.set({ queue: [] });
                    chrome.action.setBadgeText({ text: '' });
                    return { success: true };
                }
                case 'queue.search': {
                    const { queue = [] } = await chrome.storage.local.get('queue');
                    const q = (message.query || '').toLowerCase();
                    if (!q) return { success: true, data: queue };
                    return { success: true, data: queue.filter(item => item.title?.toLowerCase().includes(q) || item.url?.toLowerCase().includes(q)) };
                }
                case 'queue.export': {
                    const { queue = [] } = await chrome.storage.local.get('queue');
                    return { success: true, data: queue };
                }

                // History operations
                case 'history.get': {
                    const { history = [] } = await chrome.storage.local.get('history');
                    return { success: true, data: history };
                }
                case 'history.add': {
                    const { history = [] } = await chrome.storage.local.get('history');
                    const newItem = { id: generateId(), ...message.data, timestamp: message.data.timestamp || Date.now() };
                    history.unshift(newItem);
                    if (history.length > MAX_HISTORY_SIZE) history.splice(MAX_HISTORY_SIZE);
                    await chrome.storage.local.set({ history });
                    return { success: true, data: newItem };
                }
                case 'history.stats': {
                    const { history = [] } = await chrome.storage.local.get('history');
                    return {
                        success: true,
                        data: {
                            total: history.length,
                            success: history.filter(i => i.status === 'success').length,
                            duplicates: history.filter(i => i.isDuplicate || i.status === 'duplicate').length,
                            errors: history.filter(i => i.status === 'error').length
                        }
                    };
                }
                case 'history.search': {
                    const { history = [] } = await chrome.storage.local.get('history');
                    const q = (message.query || '').toLowerCase();
                    if (!q) return { success: true, data: history };
                    return { success: true, data: history.filter(i => i.title?.toLowerCase().includes(q) || i.url?.toLowerCase().includes(q)) };
                }
                case 'history.export': {
                    const { history = [] } = await chrome.storage.local.get('history');
                    return { success: true, data: history };
                }
                case 'history.clear': {
                    await chrome.storage.local.set({ history: [] });
                    return { success: true };
                }

                case 'storage.info': {
                    const { queue = [], history = [] } = await chrome.storage.local.get(['queue', 'history']);
                    return {
                        success: true,
                        data: {
                            queue: { count: queue.length, limit: MAX_QUEUE_SIZE, percentage: Math.round((queue.length / MAX_QUEUE_SIZE) * 100) },
                            history: { count: history.length, limit: MAX_HISTORY_SIZE, percentage: Math.round((history.length / MAX_HISTORY_SIZE) * 100) }
                        }
                    };
                }

                default:
                    return { success: false, error: 'Unknown action: ' + message.action };
            }
        } catch (error) {
            console.error('❌ Message handler error:', error);
            return { success: false, error: error.message };
        }
    };

    handleAsync().then(sendResponse);
    return true;
});

console.log('✅ Background Service Worker v7 initialized');
