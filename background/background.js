// WLO Metadaten-Agent - Background Service Worker
// VERSION: 9.0.0 — Hardened: on-demand content script injection, fetch timeouts,
//                   response validation, secure session storage, no cached credentials.

console.log('🚀 WLO Background Service Worker v9 loaded');

importScripts('../config.js');

// ===========================================================================
// CONFIGURATION
// ===========================================================================

const API_URL_DEFAULT = WLO_CONFIG.getApiUrl();
const REPO_URL_DEFAULT = WLO_CONFIG.getRepositoryUrl();
const DEFAULT_TIMEOUT_MS = WLO_CONFIG.network?.defaultTimeoutMs ?? 20000;
const UPLOAD_TIMEOUT_MS = WLO_CONFIG.network?.uploadTimeoutMs ?? 60000;
const MAX_QUEUE_SIZE = 100;
const MAX_HISTORY_SIZE = 100;

// Only https + known hosts are accepted for custom overrides
const ALLOWED_API_HOSTS = new Set(['metadata-agent-api.vercel.app']);
const ALLOWED_REPO_HOSTS = new Set([
    'repository.staging.openeduhub.net',
    'redaktion.openeduhub.net'
]);

let API_URL = API_URL_DEFAULT;
let REPOSITORY_URL = REPO_URL_DEFAULT;

function sanitizeUrl(rawUrl, allowedHosts) {
    try {
        const u = new URL(rawUrl);
        if (u.protocol !== 'https:') return null;
        if (!allowedHosts.has(u.hostname)) return null;
        return u.origin;
    } catch {
        return null;
    }
}

(async () => {
    try {
        const { customApiUrl, customRepositoryUrl } = await chrome.storage.local.get(['customApiUrl', 'customRepositoryUrl']);
        const safeApi = customApiUrl ? sanitizeUrl(customApiUrl, ALLOWED_API_HOSTS) : null;
        const safeRepo = customRepositoryUrl ? sanitizeUrl(customRepositoryUrl, ALLOWED_REPO_HOSTS) : null;
        if (safeApi) { API_URL = safeApi; console.log('🔧 Custom API URL:', safeApi); }
        if (safeRepo) { REPOSITORY_URL = safeRepo; console.log('🔧 Custom Repository URL:', safeRepo); }
    } catch (e) { /* storage not available */ }
})();

// ===========================================================================
// FETCH WITH TIMEOUT + BASIC VALIDATION
// ===========================================================================

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('TIMEOUT')), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function safeJson(response) {
    try {
        return await response.json();
    } catch (e) {
        throw new Error(`Invalid JSON response (${response.status}): ${e?.message || e}`);
    }
}

// ===========================================================================
// SIDEBAR MANAGEMENT
// ===========================================================================

chrome.action.onClicked.addListener(async (tab) => {
    try {
        await chrome.sidePanel.setOptions({ tabId: tab.id, path: 'sidebar/sidebar.html', enabled: true });
        await chrome.sidePanel.open({ tabId: tab.id });
    } catch (error) {
        console.error('❌ Failed to open sidebar:', error);
        try { await chrome.sidePanel.open({ windowId: tab.windowId }); } catch { /* ignore */ }
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

function isAllowedUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return false;
    try {
        const u = new URL(rawUrl);
        return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
        return false;
    }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    let url = '';
    let title = '';

    if (info.menuItemId === 'add-page-to-queue') { url = tab.url; title = tab.title || tab.url; }
    else if (info.menuItemId === 'add-link-to-queue') { url = info.linkUrl; title = info.linkUrl; }

    if (!isAllowedUrl(url)) return;

    try {
        const { queue = [] } = await chrome.storage.local.get('queue');
        if (queue.some(item => item.url === url)) {
            chrome.notifications.create({ type: 'basic', iconUrl: 'icons/128.png', title: 'Bereits vorgemerkt', message: 'Diese Seite ist bereits in der Merkliste' });
            return;
        }

        let pageData = { url, title, html: '', text: '', metadata: {} };
        try {
            const extracted = await extractPageDataFromTab(tab.id);
            if (extracted) pageData = extracted;
        } catch (e) { /* extraction optional */ }

        queue.push({
            id: generateId(),
            url: pageData.url || url,
            title: pageData.title || title,
            timestamp: Date.now(),
            favicon: sanitizeFaviconUrl(tab.favIconUrl),
            metadata: pageData,
            extractedContent: { html: pageData.html || '', text: pageData.formattedText || pageData.mainContent || pageData.text || '' }
        });

        if (queue.length > MAX_QUEUE_SIZE) queue.splice(0, queue.length - MAX_QUEUE_SIZE);
        await chrome.storage.local.set({ queue });

        chrome.action.setBadgeText({ text: queue.length.toString() });
        chrome.action.setBadgeBackgroundColor({ color: '#003B7C' });
        chrome.notifications.create({ type: 'basic', iconUrl: 'icons/128.png', title: 'Zur Merkliste hinzugefügt', message: title });

        try { if (chrome.sidePanel?.open) await chrome.sidePanel.open({ windowId: tab.windowId }); } catch { /* ignore */ }
    } catch (error) {
        console.error('❌ Failed to add to queue:', error);
    }
});

function sanitizeFaviconUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return '';
    try {
        const u = new URL(rawUrl);
        if (u.protocol === 'https:' || u.protocol === 'http:') return u.href;
        return '';
    } catch {
        return '';
    }
}

// ===========================================================================
// ON-DEMAND CONTENT SCRIPT INJECTION
// ===========================================================================

async function extractPageDataFromTab(tabId) {
    if (typeof tabId !== 'number') throw new Error('NO_TAB_ID');
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content/content.js']
        });
        const result = results?.[0]?.result;
        if (!result || typeof result !== 'object') throw new Error('EMPTY_EXTRACTION');
        return result;
    } catch (e) {
        throw new Error(e?.message || 'EXTRACTION_FAILED');
    }
}

// ===========================================================================
// METADATA HELPERS (flat format from FastAPI)
// ===========================================================================

function ensureArray(value, defaultValue = []) {
    if (Array.isArray(value)) return value.length > 0 ? value : defaultValue;
    if (value === null || value === undefined || value === '') return defaultValue;
    return [value];
}

function flattenValue(item) {
    if (item === null || item === undefined) return null;
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') return item;
    if (typeof item === 'object') {
        if ('uri' in item) return item.uri;
        if ('name' in item) return item.name;
        if ('label' in item) return item.label;
        if ('@value' in item) return item['@value'];
        if ('value' in item) return item.value;
        return JSON.stringify(item);
    }
    return String(item);
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

const ESSENTIAL_FIELDS = ['cclom:title', 'cclom:general_description', 'cclom:general_keyword', 'ccm:wwwurl', 'cclom:general_language'];

function isInternalKey(key) {
    if (key.startsWith('_')) return true;
    if (['contextName', 'schemaVersion', 'metadataset', 'language', 'exportedAt', 'processing'].includes(key)) return true;
    if (key.startsWith('virtual:') || key.startsWith('schema:') || key.startsWith('sys:') || key.startsWith('preview:')) return true;
    return false;
}

function buildAdditionalMetadata(metadata, repoFieldIds = null) {
    const result = {};

    for (const [key, value] of Object.entries(metadata)) {
        if (isInternalKey(key)) continue;
        if (ESSENTIAL_FIELDS.includes(key)) continue;
        if (key === 'ccm:linktype') continue;
        if (repoFieldIds && !repoFieldIds.has(key)) continue;

        const fieldValue = getFieldValue(metadata, key);
        if (fieldValue === null || fieldValue === undefined) continue;

        const arr = ensureArray(fieldValue);
        const flattened = [];
        for (const item of arr) {
            if (item === null || item === undefined || item === '') continue;
            const flat = flattenValue(item);
            if (flat !== null && flat !== undefined) flattened.push(flat);
        }
        if (flattened.length > 0) result[key] = flattened;
    }

    applyLicenseTransform(result, metadata);
    transformAuthorToVcard(result);
    extractGeoCoordinates(result, metadata);

    return result;
}

const VALID_LICENSE_KEYS = new Set([
    'NONE', 'CC_0', 'CC0', 'CC_BY', 'CC BY', 'CC_BY_SA', 'CC BY-SA',
    'CC_BY_ND', 'CC BY-ND', 'CC_BY_NC', 'CC BY-NC',
    'CC_BY_NC_SA', 'CC BY-NC-SA', 'CC_BY_NC_ND', 'CC BY-NC-ND',
    'PDM', 'CUSTOM', 'SCHULFUNK', 'UNTERRICHTS_UND_LEHRMEDIEN',
    'COPYRIGHT_FREE', 'COPYRIGHT_LICENSE'
]);

function applyLicenseTransform(result, originalMetadata) {
    const customLicense = getSingleValue(originalMetadata, 'ccm:custom_license');
    if (customLicense && typeof customLicense === 'string') {
        if (customLicense.includes('/')) {
            const token = customLicense.substring(customLicense.lastIndexOf('/') + 1);
            if (token) {
                if (token.endsWith('_40')) {
                    result['ccm:commonlicense_key'] = [token.slice(0, -3)];
                    result['ccm:commonlicense_cc_version'] = ['4.0'];
                } else if (token === 'OTHER') {
                    result['ccm:commonlicense_key'] = ['CUSTOM'];
                } else if (VALID_LICENSE_KEYS.has(token)) {
                    result['ccm:commonlicense_key'] = [token];
                }
            }
            delete result['ccm:custom_license'];
        } else if (!result['ccm:commonlicense_key']) {
            result['ccm:commonlicense_key'] = ['CUSTOM'];
        }
    }

    if (result['ccm:commonlicense_key']?.length) {
        const key = String(result['ccm:commonlicense_key'][0]).trim();
        if (!VALID_LICENSE_KEYS.has(key)) {
            console.warn(`⚠️ Invalid license key removed: ${key.substring(0, 80)}`);
            delete result['ccm:commonlicense_key'];
            delete result['ccm:commonlicense_cc_version'];
        }
    }

    if (result['ccm:commonlicense_key']?.length && !result['ccm:commonlicense_cc_version']) {
        const key = String(result['ccm:commonlicense_key'][0]);
        if (key.startsWith('CC')) result['ccm:commonlicense_cc_version'] = ['4.0'];
    }

    if (!result['ccm:commonlicense_key']) {
        result['ccm:commonlicense_key'] = ['COPYRIGHT_FREE'];
        console.log('📜 Default license: COPYRIGHT_FREE');
    }

    return result;
}

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
    }
}

function extractGeoCoordinates(result, metadata) {
    const locations = metadata['schema:location'];
    if (Array.isArray(locations)) {
        for (const loc of locations) {
            if (loc && typeof loc === 'object' && loc.geo && typeof loc.geo === 'object') {
                const lat = loc.geo.latitude;
                const lon = loc.geo.longitude;
                if (lat != null && lon != null) {
                    result['cm:latitude'] = [String(lat)];
                    result['cm:longitude'] = [String(lon)];
                    return;
                }
            }
        }
    }

    const geo = metadata['schema:geo'];
    if (geo && typeof geo === 'object') {
        const lat = geo.latitude;
        const lon = geo.longitude;
        if (lat != null && lon != null) {
            result['cm:latitude'] = [String(lat)];
            result['cm:longitude'] = [String(lon)];
        }
    }
}

// ===========================================================================
// FETCH REPO FIELD IDS FROM API (validated)
// ===========================================================================

const FIELD_ID_PATTERN = /^[a-z][a-z0-9:_-]*$/i;

async function fetchRepoFieldIds(metadata) {
    const context = typeof metadata.contextName === 'string' ? metadata.contextName : 'default';
    const version = typeof metadata.schemaVersion === 'string' ? metadata.schemaVersion : 'latest';
    const schemaFile = typeof metadata.metadataset === 'string' ? metadata.metadataset : null;

    const fieldIds = new Set();

    async function loadSchema(path) {
        try {
            const resp = await fetchWithTimeout(`${API_URL}${path}`, {}, DEFAULT_TIMEOUT_MS);
            if (!resp.ok) return;
            const schema = await safeJson(resp);
            if (!schema || !Array.isArray(schema.fields)) return;
            for (const field of schema.fields) {
                if (!field || typeof field !== 'object') continue;
                if (field.system?.repo_field !== true) continue;
                const id = field.system?.path || field.id;
                if (typeof id !== 'string' || !FIELD_ID_PATTERN.test(id)) continue;
                fieldIds.add(id);
            }
        } catch (e) {
            console.warn(`⚠️ Failed to load schema ${path}:`, e?.message || e);
        }
    }

    await loadSchema(`/info/schema/${encodeURIComponent(context)}/${encodeURIComponent(version)}/core.json`);
    if (schemaFile && /^[a-z0-9._-]+$/i.test(schemaFile)) {
        await loadSchema(`/info/schema/${encodeURIComponent(context)}/${encodeURIComponent(version)}/${schemaFile}`);
    }

    console.log(`📋 Repo fields from schema: ${fieldIds.size} fields`);
    return fieldIds.size > 0 ? fieldIds : null;
}

// ===========================================================================
// SET METADATA WITH FIELD-BY-FIELD FALLBACK
// ===========================================================================

async function setMetadataWithFallback(nodeId, metadataToSet, authHeader) {
    const metadataUrl = `${REPOSITORY_URL}/edu-sharing/rest/node/v1/nodes/-home-/${nodeId}/metadata?versionComment=METADATA_UPDATE&obeyMds=false`;
    const fieldCount = Object.keys(metadataToSet).length;

    const bulkResp = await fetchWithTimeout(metadataUrl, {
        method: 'POST',
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(metadataToSet)
    }, UPLOAD_TIMEOUT_MS);

    if (bulkResp.ok) return { success: true, fields_written: fieldCount, fields_skipped: 0, field_errors: [] };

    console.warn(`⚠️ Bulk metadata update failed (${bulkResp.status}), retrying field-by-field...`);
    let fieldsWritten = 0;
    let fieldsSkipped = 0;
    const fieldErrors = [];

    for (const [fieldId, fieldValue] of Object.entries(metadataToSet)) {
        try {
            const singleResp = await fetchWithTimeout(metadataUrl, {
                method: 'POST',
                headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ [fieldId]: fieldValue })
            }, UPLOAD_TIMEOUT_MS);

            if (singleResp.ok) {
                fieldsWritten++;
            } else {
                fieldsSkipped++;
                const errText = (await singleResp.text().catch(() => '')).substring(0, 200);
                fieldErrors.push({ field_id: fieldId, error: `HTTP ${singleResp.status}: ${errText}` });
            }
        } catch (e) {
            fieldsSkipped++;
            fieldErrors.push({ field_id: fieldId, error: String(e?.message || e) });
        }
    }

    return { success: fieldsWritten > 0, fields_written: fieldsWritten, fields_skipped: fieldsSkipped, field_errors: fieldErrors };
}

// ===========================================================================
// COLLECTIONS
// ===========================================================================

function extractCollectionIds(metadata) {
    const ids = [];
    const primary = metadata['virtual:collection_id_primary'];
    if (primary) ids.push(extractIdFromUrl(primary));

    const additional = metadata['ccm:collection_id'];
    if (Array.isArray(additional)) {
        for (const coll of additional) ids.push(extractIdFromUrl(coll));
    }
    return ids.filter(id => typeof id === 'string' && /^[a-z0-9-]+$/i.test(id));
}

function extractIdFromUrl(value) {
    if (typeof value === 'string' && value.includes('/')) return value.split('/').pop();
    return value ? String(value) : '';
}

async function setCollections(nodeId, collectionIds, authHeader) {
    for (const collectionId of collectionIds) {
        try {
            const resp = await fetchWithTimeout(
                `${REPOSITORY_URL}/edu-sharing/rest/collection/v1/collections/-home-/${collectionId}/references/${nodeId}`,
                {
                    method: 'PUT',
                    headers: { 'Authorization': authHeader, 'Accept': 'application/json' },
                    credentials: 'include'
                }
            );
            if (!resp.ok) console.warn(`⚠️ Collection ${collectionId} failed: ${resp.status}`);
        } catch (e) {
            console.warn(`⚠️ Collection ${collectionId} error:`, e?.message || e);
        }
    }
}

// ===========================================================================
// REVIEW WORKFLOW
// ===========================================================================

async function startWorkflow(nodeId, authHeader) {
    try {
        const resp = await fetchWithTimeout(
            `${REPOSITORY_URL}/edu-sharing/rest/node/v1/nodes/-home-/${nodeId}/workflow`,
            {
                method: 'PUT',
                headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    receiver: [{ authorityName: 'GROUP_ORG_WLO-Uploadmanager' }],
                    comment: 'Upload via Browser Plugin',
                    status: '200_tocheck',
                    logLevel: 'info'
                })
            }
        );
        if (!resp.ok) console.warn(`⚠️ Workflow failed: ${resp.status}`);
    } catch (e) {
        console.warn('⚠️ Workflow error:', e?.message || e);
    }
}

// ===========================================================================
// EXTENDED TYPE MAPPING
// ===========================================================================

const EXTENDED_TYPE_TO_NEW_LRT = {
    'http://w3id.org/openeduhub/vocabs/contentTypes/event': 'http://w3id.org/openeduhub/vocabs/new_lrt/955590ae-5f06-4513-98e9-91dfa8d5a05e',
    'http://w3id.org/openeduhub/vocabs/contentTypes/source': 'http://w3id.org/openeduhub/vocabs/new_lrt/3869b453-d3c1-4b34-8f25-9127e9d68766',
    'http://w3id.org/openeduhub/vocabs/contentTypes/education_offer': 'http://w3id.org/openeduhub/vocabs/new_lrt/03ab835b-c39c-48d1-b5af-7611de2f6464',
    'http://w3id.org/openeduhub/vocabs/contentTypes/tool_service': 'http://w3id.org/openeduhub/vocabs/new_lrt/cefccf75-cba3-427d-9a0f-35b4fedcbba1',
    'http://w3id.org/openeduhub/vocabs/contentTypes/didactic_concepts': 'http://w3id.org/openeduhub/vocabs/new_lrt/0a79a1d0-583b-47ce-86a7-517ab352d796',
    'http://w3id.org/openeduhub/vocabs/contentTypes/learning_material': 'http://w3id.org/openeduhub/vocabs/new_lrt/1846d876-d8fd-476a-b540-b8ffd713fedb',
};

async function writeExtendedFields(nodeId, metadata, authHeader) {
    try {
        const extendedFields = {};
        const typeUri = metadata?.metadataset_uri;
        if (typeUri) extendedFields['ccm:oeh_extendedType'] = [typeUri];
        if (typeUri && EXTENDED_TYPE_TO_NEW_LRT[typeUri]) {
            extendedFields['ccm:oeh_lrt'] = [EXTENDED_TYPE_TO_NEW_LRT[typeUri]];
        }

        const excludedKeys = new Set(['contextName', 'schemaVersion', 'metadataset', 'metadataset_uri', 'language', 'exportedAt', 'processing', '_origins', '_source_text', 'preview_image_url']);
        const dataDict = {};
        for (const [k, v] of Object.entries(metadata)) {
            if (!excludedKeys.has(k) && v !== null && v !== undefined && v !== '') dataDict[k] = v;
        }
        if (Object.keys(dataDict).length > 0) extendedFields['ccm:oeh_extendedData'] = [JSON.stringify(dataDict)];

        const sourceText = metadata?._source_text;
        if (sourceText) extendedFields['ccm:oeh_extendedText'] = [sourceText];

        if (Object.keys(extendedFields).length === 0) return;

        const endpoint = `${REPOSITORY_URL}/edu-sharing/rest/node/v1/nodes/-home-/${nodeId}/metadata?versionComment=EXTENDED_DATA&obeyMds=false`;

        const resp = await fetchWithTimeout(endpoint, {
            method: 'POST',
            headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(extendedFields)
        }, UPLOAD_TIMEOUT_MS);

        if (resp.ok) return;

        console.warn(`⚠️ Extended fields write failed: ${resp.status}`);
        for (const [fieldId, fieldValue] of Object.entries(extendedFields)) {
            try {
                await fetchWithTimeout(endpoint, {
                    method: 'POST',
                    headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ [fieldId]: fieldValue })
                }, UPLOAD_TIMEOUT_MS);
            } catch (e) {
                console.warn(`   ❌ ${fieldId}: ${e?.message || e}`);
            }
        }
    } catch (e) {
        console.warn('⚠️ Extended fields error:', e?.message || e);
    }
}

// ===========================================================================
// ASPECTS
// ===========================================================================

async function ensureAspects(nodeId, metadata, authHeader) {
    const extraAspects = [];

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

    if (metadata['cm:author'] && (Array.isArray(metadata['cm:author']) ? metadata['cm:author'].length > 0 : true)) {
        extraAspects.push('cm:author');
    }

    if (extraAspects.length === 0) return;

    try {
        const metaResp = await fetchWithTimeout(
            `${REPOSITORY_URL}/edu-sharing/rest/node/v1/nodes/-home-/${nodeId}/metadata?propertyFilter=-all-`,
            { headers: { 'Authorization': authHeader, 'Accept': 'application/json' }, credentials: 'include' }
        );
        let currentAspects = [];
        if (metaResp.ok) {
            const data = await safeJson(metaResp).catch(() => ({}));
            if (Array.isArray(data?.node?.aspects)) currentAspects = data.node.aspects;
        }

        const newAspects = extraAspects.filter(a => !currentAspects.includes(a));
        if (newAspects.length === 0) return;

        const fullList = [...currentAspects, ...newAspects];
        await fetchWithTimeout(
            `${REPOSITORY_URL}/edu-sharing/rest/node/v1/nodes/-home-/${nodeId}/aspects`,
            {
                method: 'PUT',
                headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(fullList)
            }
        );
    } catch (e) {
        console.warn('⚠️ Aspect update error:', e?.message || e);
    }
}

// ===========================================================================
// DUPLICATE CHECK
// ===========================================================================

async function checkDuplicate(url, authHeader) {
    try {
        const searchResponse = await fetchWithTimeout(
            `${REPOSITORY_URL}/edu-sharing/rest/search/v1/queries/-home-/mds_oeh/ngsearch?contentType=FILES&maxItems=10&skipCount=0&propertyFilter=ccm:wwwurl`,
            {
                method: 'POST',
                headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ criteria: [{ property: 'ccm:wwwurl', values: [url] }] })
            }
        );

        if (!searchResponse.ok) return null;
        const searchData = await safeJson(searchResponse).catch(() => null);
        if (!searchData || !Array.isArray(searchData.nodes)) return null;

        for (const node of searchData.nodes) {
            if (!node || typeof node !== 'object') continue;
            const nodeUrl = node.properties?.['ccm:wwwurl']?.[0];
            const nodeId = node.ref?.id;
            const title = typeof node.title === 'string' ? node.title : '';
            if (typeof nodeId !== 'string' || !nodeId) continue;
            if (typeof nodeUrl !== 'string' || !nodeUrl) continue;
            if (nodeUrl.toLowerCase() === url.toLowerCase()) {
                return { id: nodeId, title, url: nodeUrl };
            }
        }
        return null;
    } catch (error) {
        console.error('❌ Duplicate check error:', error?.message || error);
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
    if (!authHeader) throw new Error('SESSION_EXPIRED');
    if (!userHomeId) throw new Error('User Home ID nicht gefunden');

    const url = getSingleValue(metadata, 'ccm:wwwurl');
    if (!url) throw new Error('URL fehlt in Metadaten');

    const repoFieldIds = await fetchRepoFieldIds(metadata);

    const existingNode = await checkDuplicate(url, authHeader);
    if (existingNode) {
        return { success: false, error: 'duplicate', message: 'URL bereits im Repository.', existingNode };
    }

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

    const createResponse = await fetchWithTimeout(
        `${REPOSITORY_URL}/edu-sharing/rest/node/v1/nodes/-home-/${userHomeId}/children?type=ccm:io&renameIfExists=true&versionComment=MAIN_FILE_UPLOAD`,
        {
            method: 'POST',
            headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(createPayload)
        },
        UPLOAD_TIMEOUT_MS
    );

    if (!createResponse.ok) {
        const errorText = (await createResponse.text().catch(() => '')).substring(0, 200);
        throw new Error(`Create node failed: ${createResponse.status} - ${errorText}`);
    }

    const createData = await safeJson(createResponse);
    const nodeId = createData?.node?.ref?.id;
    if (typeof nodeId !== 'string' || !nodeId) throw new Error('Invalid create response: no node id');

    await ensureAspects(nodeId, metadata, authHeader);

    const metadataToSet = buildAdditionalMetadata(metadata, repoFieldIds);
    let metaResult = { fields_written: 0, fields_skipped: 0, field_errors: [] };
    if (Object.keys(metadataToSet).length > 0) {
        metaResult = await setMetadataWithFallback(nodeId, metadataToSet, authHeader);
    }

    const collectionIds = extractCollectionIds(metadata);
    if (collectionIds.length > 0) await setCollections(nodeId, collectionIds, authHeader);

    await writeExtendedFields(nodeId, metadata, authHeader);
    await startWorkflow(nodeId, authHeader);

    const repoUrl = `${REPOSITORY_URL}/edu-sharing/components/render/${nodeId}`;
    return {
        success: true, nodeId, mode: 'user', title: titleArray[0], repoUrl, repositoryUrl: repoUrl,
        fields_written: metaResult.fields_written, fields_skipped: metaResult.fields_skipped
    };
}

// ===========================================================================
// UPLOAD: GUEST MODE — delegated to API /upload (server-side credentials)
// ===========================================================================

async function uploadAsGuest(metadata, previewUrl) {
    console.log('🔓 Uploading as Guest via API /upload...');

    const url = getSingleValue(metadata, 'ccm:wwwurl');
    if (!url) throw new Error('URL fehlt in Metadaten');

    const sourceText = metadata?._source_text || undefined;

    const uploadBody = {
        metadata,
        repository: 'staging',
        check_duplicates: true,
        start_workflow: true,
        write_extended_data: true,
        extended_text: sourceText
    };

    if (typeof previewUrl === 'string' && /^https?:\/\//.test(previewUrl)) {
        uploadBody.preview_url = previewUrl;
        uploadBody.screenshot_method = 'pageshot';
    }

    const response = await fetchWithTimeout(`${API_URL}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(uploadBody)
    }, UPLOAD_TIMEOUT_MS);

    if (!response.ok) {
        const errorText = (await response.text().catch(() => '')).substring(0, 300);
        throw new Error(`API upload failed: ${response.status} - ${errorText}`);
    }

    const result = await safeJson(response);
    if (!result || typeof result !== 'object') throw new Error('Upload: invalid API response');

    if (result.duplicate) {
        return {
            success: false,
            error: 'duplicate',
            message: (typeof result.error === 'string' ? result.error : null) || 'URL bereits im Repository.',
            existingNode: result.node ? {
                id: typeof result.node.nodeId === 'string' ? result.node.nodeId : '',
                title: typeof result.node.title === 'string' ? result.node.title : '',
                url: typeof result.node.wwwurl === 'string' ? result.node.wwwurl : ''
            } : null
        };
    }

    if (!result.success) throw new Error(typeof result.error === 'string' ? result.error : 'Upload fehlgeschlagen');

    const nodeId = typeof result.node?.nodeId === 'string' ? result.node.nodeId : null;
    const title = (typeof result.node?.title === 'string' && result.node.title) ||
                  getSingleValue(metadata, 'cclom:title') || 'Untitled';
    const repoUrl = (typeof result.node?.repositoryUrl === 'string' && result.node.repositoryUrl)
        || (nodeId ? `${REPOSITORY_URL}/edu-sharing/components/render/${nodeId}` : null);

    return {
        success: true, nodeId, mode: 'guest', title, repoUrl, repositoryUrl: repoUrl,
        message: 'Zur Prüfung eingereicht!',
        fields_written: result.fields_written,
        fields_skipped: result.fields_skipped
    };
}

// ===========================================================================
// SAVE HANDLER
// ===========================================================================

async function handleSaveMetadata(metadata, previewUrl) {
    try {
        if (!metadata || typeof metadata !== 'object') throw new Error('INVALID_METADATA');
        const { wloSession } = await chrome.storage.local.get('wloSession');
        const isUserMode = wloSession && wloSession.isValidLogin && wloSession.authHeader && !wloSession.isGuest;
        if (isUserMode) return await uploadAsUser(metadata, wloSession);
        return await uploadAsGuest(metadata, previewUrl);
    } catch (error) {
        console.error('❌ Save failed:', error?.message || error);
        throw error;
    }
}

// ===========================================================================
// SCREENSHOT (user mode only)
// ===========================================================================

async function captureVisibleTab() {
    try {
        return await chrome.tabs.captureVisibleTab(null, { format: 'png', quality: 90 });
    } catch (e) {
        console.warn('⚠️ captureVisibleTab failed:', e?.message || e);
        return null;
    }
}

async function uploadPreviewImage(nodeId, dataUrl, authHeader) {
    if (!nodeId || !dataUrl || !authHeader) return false;
    try {
        const resp = await fetch(dataUrl);
        const blob = await resp.blob();
        const uploadUrl = `${REPOSITORY_URL}/edu-sharing/rest/node/v1/nodes/-home-/${nodeId}/preview?mimetype=image/png&createVersion=true`;
        const formData = new FormData();
        formData.append('image', blob, 'screenshot.png');

        const uploadResp = await fetchWithTimeout(uploadUrl, {
            method: 'POST',
            headers: { 'Authorization': authHeader },
            credentials: 'include',
            body: formData
        }, UPLOAD_TIMEOUT_MS);

        return uploadResp.ok;
    } catch (e) {
        console.warn('⚠️ Preview upload error:', e?.message || e);
        return false;
    }
}

// ===========================================================================
// HELPERS
// ===========================================================================

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
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

const ALLOWED_ACTIONS = new Set([
    'saveMetadata', 'warenkorb.addItem', 'warenkorb.prefetchSearch',
    'tabs.getActive', 'tabs.extractPageData', 'tabs.captureScreenshot', 'tabs.uploadPreview',
    'queue.get', 'queue.add', 'queue.remove', 'queue.clear', 'queue.search', 'queue.export',
    'pendingItems.add', 'pendingItems.get', 'pendingItems.clear',
    'history.get', 'history.add', 'history.stats', 'history.search', 'history.export', 'history.clear',
    'storage.info'
]);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object' || typeof message.action !== 'string') {
        sendResponse({ success: false, error: 'INVALID_MESSAGE' });
        return false;
    }
    if (!ALLOWED_ACTIONS.has(message.action)) {
        sendResponse({ success: false, error: 'UNKNOWN_ACTION' });
        return false;
    }

    if (message.action === 'saveMetadata') {
        handleSaveMetadata(message.metadata, message.previewUrl)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error?.message || 'UPLOAD_FAILED' }));
        return true;
    }

    if (message.action === 'warenkorb.addItem') {
        return false; // sidebar handles it
    }

    if (message.action === 'warenkorb.prefetchSearch') {
        const query = typeof message.query === 'string' ? message.query.trim() : '';
        if (!query) { sendResponse({ nodes: [] }); return true; }

        const searchUrl = 'https://redaktion.openeduhub.net/edu-sharing/rest/search/v1/queries/-home-/mds_oeh/ngsearch'
            + '?contentType=FILES&maxItems=50&skipCount=0&propertyFilter=-all-';

        fetchWithTimeout(searchUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ criteria: [{ property: 'ngsearchword', values: [query] }] })
        })
            .then(r => r.ok ? safeJson(r) : Promise.reject(new Error(`HTTP ${r.status}`)))
            .then(data => {
                const rawNodes = Array.isArray(data?.nodes) ? data.nodes : [];
                const nodes = rawNodes.map(n => ({
                    id: typeof n?.ref?.id === 'string' ? n.ref.id : '',
                    title: (Array.isArray(n?.properties?.['cclom:title']) && n.properties['cclom:title'][0]) || (typeof n?.name === 'string' ? n.name : ''),
                    publisher: (Array.isArray(n?.properties?.['ccm:oeh_publisher_combined']) && n.properties['ccm:oeh_publisher_combined'][0]) || '',
                    wwwurl: (Array.isArray(n?.properties?.['ccm:wwwurl']) && n.properties['ccm:wwwurl'][0]) || ''
                })).filter(n => n.id);
                sendResponse({ nodes });
            })
            .catch(err => {
                console.warn('🛒 Prefetch failed:', err?.message || err);
                sendResponse({ nodes: [] });
            });
        return true;
    }

    const handleAsync = async () => {
        try {
            switch (message.action) {
                case 'tabs.getActive': {
                    const tab = await getActiveNormalTab();
                    if (!tab) return { success: false, error: 'NO_ACTIVE_TAB' };
                    const { id, url, title, favIconUrl } = tab;
                    return { success: true, tab: { id, url, title, favIconUrl: sanitizeFaviconUrl(favIconUrl) } };
                }

                case 'tabs.extractPageData': {
                    let targetTabId = typeof message.tabId === 'number' ? message.tabId : null;
                    if (!targetTabId) {
                        const tab = await getActiveNormalTab();
                        if (!tab) return { success: false, error: 'NO_ACTIVE_TAB' };
                        targetTabId = tab.id;
                    }
                    try {
                        const pageData = await extractPageDataFromTab(targetTabId);
                        return { success: true, data: pageData };
                    } catch (e) {
                        return { success: false, error: e?.message || 'EXTRACTION_FAILED' };
                    }
                }

                case 'tabs.captureScreenshot': {
                    const dataUrl = await captureVisibleTab();
                    return dataUrl ? { success: true, dataUrl } : { success: false, error: 'CAPTURE_FAILED' };
                }

                case 'tabs.uploadPreview': {
                    const { nodeId, screenshotDataUrl } = message;
                    // authHeader comes from session — never from the caller
                    const { wloSession } = await chrome.storage.local.get('wloSession');
                    const authHeader = wloSession?.isValidLogin && wloSession?.authHeader ? wloSession.authHeader : null;
                    if (!authHeader) return { success: false, error: 'NOT_LOGGED_IN' };
                    const ok = await uploadPreviewImage(nodeId, screenshotDataUrl, authHeader);
                    return { success: ok };
                }

                case 'queue.get': {
                    const { queue = [] } = await chrome.storage.local.get('queue');
                    return { success: true, data: queue, queue };
                }
                case 'queue.add': {
                    const data = message.data;
                    if (!data || typeof data !== 'object' || !isAllowedUrl(data.url)) {
                        return { success: false, error: 'INVALID_DATA' };
                    }
                    const { queue = [] } = await chrome.storage.local.get('queue');
                    const newItem = {
                        id: typeof data.id === 'string' ? data.id : generateId(),
                        url: data.url,
                        title: typeof data.title === 'string' ? data.title : data.url,
                        favicon: sanitizeFaviconUrl(data.favicon),
                        timestamp: typeof data.timestamp === 'number' ? data.timestamp : Date.now(),
                        metadata: data.metadata && typeof data.metadata === 'object' ? data.metadata : {},
                        extractedContent: data.extractedContent && typeof data.extractedContent === 'object' ? data.extractedContent : {}
                    };
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
                    const q = typeof message.query === 'string' ? message.query.toLowerCase() : '';
                    if (!q) return { success: true, data: queue };
                    return { success: true, data: queue.filter(item => item.title?.toLowerCase().includes(q) || item.url?.toLowerCase().includes(q)) };
                }
                case 'queue.export': {
                    const { queue = [] } = await chrome.storage.local.get('queue');
                    return { success: true, data: queue };
                }

                case 'pendingItems.add': {
                    const item = message.item;
                    if (!item || typeof item !== 'object') return { success: false, error: 'INVALID_ITEM' };
                    const { wkPendingItems = [] } = await chrome.storage.local.get('wkPendingItems');
                    const sanitized = {
                        id: typeof item.id === 'string' ? item.id : generateId(),
                        nodeId: typeof item.nodeId === 'string' && /^[a-z0-9-]+$/i.test(item.nodeId) ? item.nodeId : '',
                        title: typeof item.title === 'string' ? item.title.slice(0, 500) : '',
                        url: typeof item.url === 'string' && /^https?:\/\//.test(item.url) ? item.url : '',
                        type: typeof item.type === 'string' ? item.type.slice(0, 100) : '',
                        typeId: typeof item.typeId === 'string' ? item.typeId.slice(0, 50) : '',
                        thumbnail: typeof item.thumbnail === 'string' && /^https?:\/\//.test(item.thumbnail) ? item.thumbnail : '',
                        author: typeof item.author === 'string' ? item.author.slice(0, 200) : '',
                        description: typeof item.description === 'string' ? item.description.slice(0, 2000) : '',
                        source: 'wlo-overlay',
                        timestamp: Date.now()
                    };
                    wkPendingItems.push(sanitized);
                    if (wkPendingItems.length > 200) wkPendingItems.splice(0, wkPendingItems.length - 200);
                    await chrome.storage.local.set({ wkPendingItems });
                    return { success: true };
                }
                case 'pendingItems.get': {
                    const { wkPendingItems = [] } = await chrome.storage.local.get('wkPendingItems');
                    return { success: true, data: wkPendingItems };
                }
                case 'pendingItems.clear': {
                    await chrome.storage.local.set({ wkPendingItems: [] });
                    return { success: true };
                }

                case 'history.get': {
                    const { history = [] } = await chrome.storage.local.get('history');
                    return { success: true, data: history };
                }
                case 'history.add': {
                    const { history = [] } = await chrome.storage.local.get('history');
                    const data = message.data || {};
                    const newItem = {
                        id: generateId(),
                        url: typeof data.url === 'string' ? data.url : '',
                        title: typeof data.title === 'string' ? data.title : '',
                        favicon: sanitizeFaviconUrl(data.favicon),
                        status: data.status === 'success' || data.status === 'error' ? data.status : 'error',
                        isDuplicate: Boolean(data.isDuplicate),
                        repoUrl: sanitizeRepoUrl(data.repoUrl),
                        timestamp: typeof data.timestamp === 'number' ? data.timestamp : Date.now()
                    };
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
                    const q = typeof message.query === 'string' ? message.query.toLowerCase() : '';
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
                    return { success: false, error: 'UNKNOWN_ACTION' };
            }
        } catch (error) {
            console.error('❌ Message handler error:', error?.message || error);
            return { success: false, error: error?.message || 'INTERNAL_ERROR' };
        }
    };

    handleAsync().then(sendResponse);
    return true;
});

function sanitizeRepoUrl(raw) {
    if (typeof raw !== 'string') return '';
    try {
        const u = new URL(raw);
        if (u.protocol !== 'https:') return '';
        if (!ALLOWED_REPO_HOSTS.has(u.hostname)) return '';
        return u.href;
    } catch {
        return '';
    }
}

console.log('✅ Background Service Worker v9 initialized');
