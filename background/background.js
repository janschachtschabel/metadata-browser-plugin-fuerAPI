// WLO Metadaten-Agent - Background Service Worker
// VERSION: 8.0.0 — Aligned with API upload logic: repo_field filtering, field-by-field fallback, guest via API
// Upload logic handles flat metadata format from FastAPI/web component
console.log('🚀 WLO Background Service Worker v8 loaded');

// ===========================================================================
// CONFIGURATION
// ===========================================================================

const API_URL = 'https://metadata-agent-api.vercel.app';
const REPOSITORY_URL = 'https://repository.staging.openeduhub.net';

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

// Flatten complex objects to simple values (aligned with API _flatten_value)
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

// Fields that are set during node creation (not in metadata update)
const ESSENTIAL_FIELDS = ['cclom:title', 'cclom:general_description', 'cclom:general_keyword', 'ccm:wwwurl', 'cclom:general_language'];

// Internal/meta keys to skip (aligned with API _normalize_for_repo)
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

        // If repo_field IDs provided, only include whitelisted fields (aligned with API)
        if (repoFieldIds && !repoFieldIds.has(key)) continue;

        const fieldValue = getFieldValue(metadata, key);
        if (fieldValue === null || fieldValue === undefined) continue;

        // Normalize to array and flatten complex objects (aligned with API _normalize_for_repo)
        const arr = ensureArray(fieldValue);
        const flattened = [];
        for (const item of arr) {
            if (item === null || item === undefined || item === '') continue;
            const flat = flattenValue(item);
            if (flat !== null && flat !== undefined) flattened.push(flat);
        }
        if (flattened.length > 0) {
            result[key] = flattened;
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

// Valid edu-sharing license keys
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
        // Only transform if it looks like a URI (contains '/')
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
            // Remove the URI (it was transformed)
            delete result['ccm:custom_license'];
        } else {
            // Plain text → keep as custom license, set key to CUSTOM
            if (!result['ccm:commonlicense_key']) {
                result['ccm:commonlicense_key'] = ['CUSTOM'];
            }
        }
    }

    // Validate ccm:commonlicense_key against known keys
    if (result['ccm:commonlicense_key']?.length) {
        const key = String(result['ccm:commonlicense_key'][0]).trim();
        if (!VALID_LICENSE_KEYS.has(key)) {
            console.warn(`⚠️ Invalid license key removed: ${key.substring(0, 80)}`);
            delete result['ccm:commonlicense_key'];
            delete result['ccm:commonlicense_cc_version'];
        }
    }

    // Default CC version only for CC-type licenses
    if (result['ccm:commonlicense_key']?.length && !result['ccm:commonlicense_cc_version']) {
        const key = String(result['ccm:commonlicense_key'][0]);
        if (key.startsWith('CC')) {
            result['ccm:commonlicense_cc_version'] = ['4.0'];
        }
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
// FETCH REPO FIELD IDS FROM API (aligned with API get_repo_fields)
// ===========================================================================

async function fetchRepoFieldIds(metadata) {
    const context = metadata.contextName || 'default';
    const version = metadata.schemaVersion || 'latest';
    const schemaFile = metadata.metadataset || null;

    const fieldIds = new Set();

    // Always load core.json fields
    try {
        const coreResp = await fetch(`${API_URL}/info/schema/${context}/${version}/core.json`);
        if (coreResp.ok) {
            const coreSchema = await coreResp.json();
            for (const field of (coreSchema.fields || [])) {
                if (field.system?.repo_field) {
                    const id = field.system?.path || field.id;
                    if (id) fieldIds.add(id);
                }
            }
        }
    } catch (e) {
        console.warn('⚠️ Failed to load core.json repo fields:', e);
    }

    // Load special schema fields (e.g. event.json)
    if (schemaFile) {
        try {
            const schemaResp = await fetch(`${API_URL}/info/schema/${context}/${version}/${schemaFile}`);
            if (schemaResp.ok) {
                const schema = await schemaResp.json();
                for (const field of (schema.fields || [])) {
                    if (field.system?.repo_field) {
                        const id = field.system?.path || field.id;
                        if (id) fieldIds.add(id);
                    }
                }
            }
        } catch (e) {
            console.warn(`⚠️ Failed to load ${schemaFile} repo fields:`, e);
        }
    }

    console.log(`📋 Repo fields from schema: ${fieldIds.size} fields`);
    return fieldIds.size > 0 ? fieldIds : null;
}

// ===========================================================================
// SET METADATA WITH FIELD-BY-FIELD FALLBACK (aligned with API _set_metadata)
// ===========================================================================

async function setMetadataWithFallback(nodeId, metadataToSet, authHeader) {
    const metadataUrl = `${REPOSITORY_URL}/edu-sharing/rest/node/v1/nodes/-home-/${nodeId}/metadata?versionComment=METADATA_UPDATE&obeyMds=false`;
    const fieldCount = Object.keys(metadataToSet).length;

    // Strategy 1: Bulk update
    const bulkResp = await fetch(metadataUrl, {
        method: 'POST',
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(metadataToSet)
    });

    if (bulkResp.ok) {
        console.log(`✅ Bulk metadata update succeeded: ${fieldCount} fields`);
        return { success: true, fields_written: fieldCount, fields_skipped: 0, field_errors: [] };
    }

    // Strategy 2: Field-by-field fallback
    console.warn(`⚠️ Bulk metadata update failed (${bulkResp.status}), retrying field-by-field...`);
    let fieldsWritten = 0;
    let fieldsSkipped = 0;
    const fieldErrors = [];

    for (const [fieldId, fieldValue] of Object.entries(metadataToSet)) {
        try {
            const singleResp = await fetch(metadataUrl, {
                method: 'POST',
                headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ [fieldId]: fieldValue })
            });

            if (singleResp.ok) {
                fieldsWritten++;
            } else {
                fieldsSkipped++;
                const errText = (await singleResp.text()).substring(0, 200);
                fieldErrors.push({ field_id: fieldId, error: `HTTP ${singleResp.status}: ${errText}` });
                console.log(`   ❌ ${fieldId}: ${singleResp.status}`);
            }
        } catch (e) {
            fieldsSkipped++;
            fieldErrors.push({ field_id: fieldId, error: String(e) });
            console.log(`   ❌ ${fieldId}: ${e}`);
        }
    }

    console.log(`📊 Field-by-field result: ${fieldsWritten} written, ${fieldsSkipped} failed`);
    return { success: fieldsWritten > 0, fields_written: fieldsWritten, fields_skipped: fieldsSkipped, field_errors: fieldErrors };
}

// ===========================================================================
// COLLECTION SUPPORT (aligned with API _set_collections)
// ===========================================================================

function extractCollectionIds(metadata) {
    const ids = [];

    const primary = metadata['virtual:collection_id_primary'];
    if (primary) ids.push(extractIdFromUrl(primary));

    const additional = metadata['ccm:collection_id'];
    if (Array.isArray(additional)) {
        for (const coll of additional) ids.push(extractIdFromUrl(coll));
    }

    return ids.filter(Boolean);
}

function extractIdFromUrl(value) {
    if (typeof value === 'string' && value.includes('/')) return value.split('/').pop();
    return value ? String(value) : '';
}

async function setCollections(nodeId, collectionIds, authHeader) {
    for (const collectionId of collectionIds) {
        try {
            const resp = await fetch(
                `${REPOSITORY_URL}/edu-sharing/rest/collection/v1/collections/-home-/${collectionId}/references/${nodeId}`,
                {
                    method: 'PUT',
                    headers: { 'Authorization': authHeader, 'Accept': 'application/json' },
                    credentials: 'include'
                }
            );
            if (resp.ok) console.log(`📂 Added to collection: ${collectionId}`);
            else console.warn(`⚠️ Collection ${collectionId} failed: ${resp.status}`);
        } catch (e) {
            console.warn(`⚠️ Collection ${collectionId} error:`, e);
        }
    }
}

// ===========================================================================
// START REVIEW WORKFLOW (aligned with API _start_workflow)
// ===========================================================================

async function startWorkflow(nodeId, authHeader) {
    try {
        const resp = await fetch(
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
        if (resp.ok) console.log('🚀 Workflow started');
        else console.warn(`⚠️ Workflow failed: ${resp.status}`);
    } catch (e) {
        console.warn('⚠️ Workflow error:', e);
    }
}

// ===========================================================================
// WRITE EXTENDED FIELDS (ccm:oeh_extendedType, ccm:oeh_extendedData, ccm:oeh_extendedText)
// ===========================================================================

async function writeExtendedFields(nodeId, metadata, authHeader) {
    try {
        const extendedFields = {};

        // 1. ccm:oeh_extendedType — resolve URI from metadataset_uri (set by web component export)
        const typeUri = metadata?.metadataset_uri;
        if (typeUri) {
            extendedFields['ccm:oeh_extendedType'] = [typeUri];
        }

        // 2. ccm:oeh_extendedData — full metadata as JSON string
        const excludedKeys = new Set(['contextName', 'schemaVersion', 'metadataset', 'metadataset_uri', 'language', 'exportedAt', 'processing', '_origins', '_source_text', 'preview_image_url']);
        const dataDict = {};
        for (const [k, v] of Object.entries(metadata)) {
            if (!excludedKeys.has(k) && v !== null && v !== undefined && v !== '') {
                dataDict[k] = v;
            }
        }
        if (Object.keys(dataDict).length > 0) {
            extendedFields['ccm:oeh_extendedData'] = [JSON.stringify(dataDict)];
        }

        // 3. ccm:oeh_extendedText — raw source text before extraction
        const sourceText = metadata?._source_text;
        if (sourceText) {
            extendedFields['ccm:oeh_extendedText'] = [sourceText];
        }

        if (Object.keys(extendedFields).length === 0) {
            console.log('⚠️ No extended fields to write');
            return;
        }

        const resp = await fetch(
            `${REPOSITORY_URL}/edu-sharing/rest/node/v1/nodes/-home-/${nodeId}/metadata?versionComment=EXTENDED_DATA&obeyMds=false`,
            {
                method: 'POST',
                headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(extendedFields)
            }
        );

        if (resp.ok || resp.status === 200 || resp.status === 201) {
            console.log(`✅ Extended fields written: ${Object.keys(extendedFields).join(', ')}`);
        } else {
            console.warn(`⚠️ Extended fields write failed: ${resp.status}`);
            // Fallback: write field-by-field
            for (const [fieldId, fieldValue] of Object.entries(extendedFields)) {
                try {
                    const singleResp = await fetch(
                        `${REPOSITORY_URL}/edu-sharing/rest/node/v1/nodes/-home-/${nodeId}/metadata?versionComment=EXTENDED_DATA&obeyMds=false`,
                        {
                            method: 'POST',
                            headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json' },
                            credentials: 'include',
                            body: JSON.stringify({ [fieldId]: fieldValue })
                        }
                    );
                    if (singleResp.ok) console.log(`   ✅ ${fieldId}`);
                    else console.warn(`   ❌ ${fieldId}: ${singleResp.status}`);
                } catch (e) {
                    console.warn(`   ❌ ${fieldId}: ${e.message}`);
                }
            }
        }
    } catch (e) {
        console.warn('⚠️ Extended fields error:', e);
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
// UPLOAD: USER MODE (aligned with API: repo_field filtering, fallback, collections)
// ===========================================================================

async function uploadAsUser(metadata, session) {
    console.log('🔐 Uploading as User:', session.authorityName);

    const authHeader = session.authHeader;
    const userHomeId = session.userHomeId;
    if (!userHomeId) throw new Error('User Home ID nicht gefunden');

    const url = getSingleValue(metadata, 'ccm:wwwurl');
    if (!url) throw new Error('URL fehlt in Metadaten');

    // 0. Fetch repo_field IDs from API schema (aligned with API get_repo_fields)
    const repoFieldIds = await fetchRepoFieldIds(metadata);

    // 1. Duplicate check
    const existingNode = await checkDuplicate(url, authHeader);
    if (existingNode) {
        return { success: false, error: 'duplicate', message: 'URL bereits im Repository.', existingNode };
    }

    // 2. Create node (5 essential fields only, aligned with API)
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

    // 4. Set metadata with repo_field filtering + field-by-field fallback
    const metadataToSet = buildAdditionalMetadata(metadata, repoFieldIds);
    let metaResult = { fields_written: 0, fields_skipped: 0, field_errors: [] };
    if (Object.keys(metadataToSet).length > 0) {
        metaResult = await setMetadataWithFallback(nodeId, metadataToSet, authHeader);
    }

    // 5. Set collections if present
    const collectionIds = extractCollectionIds(metadata);
    if (collectionIds.length > 0) {
        await setCollections(nodeId, collectionIds, authHeader);
    }

    // 6. Write extended data fields (ccm:oeh_extendedType, ccm:oeh_extendedData, ccm:oeh_extendedText)
    await writeExtendedFields(nodeId, metadata, authHeader);

    // 7. Start review workflow (aligned with API)
    await startWorkflow(nodeId, authHeader);

    const repoUrl = `${REPOSITORY_URL}/edu-sharing/components/render/${nodeId}`;
    return {
        success: true, nodeId, mode: 'user', title: titleArray[0], repoUrl, repositoryUrl: repoUrl,
        fields_written: metaResult.fields_written, fields_skipped: metaResult.fields_skipped
    };
}

// ===========================================================================
// UPLOAD: GUEST MODE — Delegate to API /upload (ensures identical logic)
// ===========================================================================

async function uploadAsGuest(metadata, previewUrl) {
    console.log('🔓 Uploading as Guest via API /upload...');

    const url = getSingleValue(metadata, 'ccm:wwwurl');
    if (!url) throw new Error('URL fehlt in Metadaten');

    // Extract _source_text from metadata (added by web component export) for extended data
    const sourceText = metadata?._source_text || undefined;

    // Delegate entire upload to API — ensures identical processing
    // (repo_field filtering, transforms, field-by-field fallback, workflow)
    const uploadBody = {
        metadata: metadata,
        repository: 'staging',
        check_duplicates: true,
        start_workflow: true,
        write_extended_data: true,
        extended_text: sourceText
    };

    // Pass preview URL for server-side screenshot capture (guest has no direct repo access)
    if (previewUrl) {
        uploadBody.preview_url = previewUrl;
        uploadBody.screenshot_method = 'pageshot';
        console.log('📸 Guest mode: passing preview_url to API for screenshot:', previewUrl);
    }

    const response = await fetch(`${API_URL}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(uploadBody)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API upload failed: ${response.status} - ${errorText.substring(0, 300)}`);
    }

    const result = await response.json();
    console.log('📡 API /upload response:', result);

    // Map API response to plugin format
    if (result.duplicate) {
        return {
            success: false,
            error: 'duplicate',
            message: result.error || 'URL bereits im Repository.',
            existingNode: result.node ? {
                id: result.node.nodeId,
                title: result.node.title,
                url: result.node.wwwurl
            } : null
        };
    }

    if (!result.success) {
        throw new Error(result.error || 'Upload fehlgeschlagen');
    }

    const nodeId = result.node?.nodeId;
    const title = result.node?.title || getSingleValue(metadata, 'cclom:title') || 'Untitled';
    const repoUrl = result.node?.repositoryUrl || (nodeId ? `${REPOSITORY_URL}/edu-sharing/components/render/${nodeId}` : null);

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
    console.log('💾 Starting metadata save...');
    try {
        const { wloSession } = await chrome.storage.local.get('wloSession');
        const isUserMode = wloSession && wloSession.isValidLogin && !wloSession.isGuest;
        console.log(`📋 Mode: ${isUserMode ? 'User' : 'Guest'}`);

        if (isUserMode) return await uploadAsUser(metadata, wloSession);
        else return await uploadAsGuest(metadata, previewUrl);
    } catch (error) {
        console.error('❌ Save failed:', error);
        throw error;
    }
}

// ===========================================================================
// SCREENSHOT: Capture visible tab & upload as preview
// ===========================================================================

async function captureVisibleTab() {
    try {
        const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png', quality: 90 });
        console.log('📸 Tab screenshot captured:', Math.round(dataUrl.length / 1024), 'KB');
        return dataUrl;
    } catch (e) {
        console.warn('⚠️ captureVisibleTab failed:', e);
        return null;
    }
}

async function uploadPreviewImage(nodeId, dataUrl, authHeader) {
    if (!nodeId || !dataUrl) return false;
    try {
        // Convert data URL to Blob
        const resp = await fetch(dataUrl);
        const blob = await resp.blob();

        const uploadUrl = `${REPOSITORY_URL}/edu-sharing/rest/node/v1/nodes/-home-/${nodeId}/preview?mimetype=image/png&createVersion=true`;

        const formData = new FormData();
        formData.append('image', blob, 'screenshot.png');

        const uploadResp = await fetch(uploadUrl, {
            method: 'POST',
            headers: { 'Authorization': authHeader },
            credentials: 'include',
            body: formData
        });

        if (uploadResp.ok || uploadResp.status === 200 || uploadResp.status === 204) {
            console.log('✅ Preview image uploaded to node', nodeId);
            return true;
        } else {
            console.warn('⚠️ Preview upload failed:', uploadResp.status);
            return false;
        }
    } catch (e) {
        console.warn('⚠️ Preview upload error:', e);
        return false;
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
        handleSaveMetadata(message.metadata, message.previewUrl)
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

                case 'tabs.captureScreenshot': {
                    const dataUrl = await captureVisibleTab();
                    return dataUrl ? { success: true, dataUrl } : { success: false, error: 'CAPTURE_FAILED' };
                }

                case 'tabs.uploadPreview': {
                    const { nodeId, screenshotDataUrl, authHeader } = message;
                    const ok = await uploadPreviewImage(nodeId, screenshotDataUrl, authHeader);
                    return { success: ok };
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

console.log('✅ Background Service Worker v8 initialized');
