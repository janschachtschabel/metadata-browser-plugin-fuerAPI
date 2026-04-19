// WLO Metadaten-Agent - Options/Login Script
// VERSION: 8.0.0 — XSS-safe rendering, validated URL overrides, timed fetches.

console.log('🔧 Options page v8 loaded');

let REPOSITORY_URL = WLO_CONFIG.getRepositoryUrl();

const ALLOWED_REPO_HOSTS = new Set([
    'repository.staging.openeduhub.net',
    'redaktion.openeduhub.net'
]);
const ALLOWED_API_HOSTS = new Set(['metadata-agent-api.vercel.app']);
const SESSION_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8 hours

const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const loginStatus = document.getElementById('login-status');
const usernameDisplay = document.getElementById('username-display');
const permissionsBox = document.getElementById('permissions-box');
const permissionsList = document.getElementById('permissions-list');

const repositoryUrlInput = document.getElementById('repository-url');
const saveRepoUrlBtn = document.getElementById('save-repo-url-btn');
const resetRepoUrlBtn = document.getElementById('reset-repo-url-btn');
const apiUrlInput = document.getElementById('api-url');
const saveApiUrlBtn = document.getElementById('save-api-url-btn');
const resetApiUrlBtn = document.getElementById('reset-api-url-btn');

const errorBox = document.getElementById('error-box');
const errorMessage = document.getElementById('error-message');
const successBox = document.getElementById('success-box');
const successMessage = document.getElementById('success-message');

document.addEventListener('DOMContentLoaded', async () => {
    await loadSession();
    await loadConfigSettings();
    setupEventListeners();
});

function setupEventListeners() {
    loginForm.addEventListener('submit', handleLogin);
    logoutBtn.addEventListener('click', handleLogout);
    saveRepoUrlBtn.addEventListener('click', handleSaveRepositoryUrl);
    resetRepoUrlBtn.addEventListener('click', handleResetRepositoryUrl);
    saveApiUrlBtn?.addEventListener('click', handleSaveApiUrl);
    resetApiUrlBtn?.addEventListener('click', handleResetApiUrl);
}

function sanitizeOrigin(rawUrl, allowedHosts) {
    if (typeof rawUrl !== 'string') return null;
    try {
        const u = new URL(rawUrl);
        if (u.protocol !== 'https:') return null;
        if (!allowedHosts.has(u.hostname)) return null;
        return u.origin;
    } catch { return null; }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function loadSession() {
    try {
        const { wloSession } = await chrome.storage.local.get('wloSession');
        if (!wloSession || !wloSession.isValidLogin) return;
        if (typeof wloSession.expiresAt === 'number' && wloSession.expiresAt < Date.now()) {
            await chrome.storage.local.remove('wloSession');
            return;
        }
        displayLoginStatus(wloSession);
    } catch (error) {
        console.error('❌ Failed to load session:', error?.message || error);
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    if (!username || !password) {
        showError('Bitte Benutzername und Passwort eingeben');
        return;
    }

    const btnText = loginBtn.querySelector('.btn-text');
    const btnIcon = loginBtn.querySelector('.btn-icon');
    loginBtn.disabled = true;
    if (btnIcon) btnIcon.textContent = '⏳';
    if (btnText) btnText.textContent = 'Anmelden...';

    try {
        const authHeader = 'Basic ' + btoa(username + ':' + password);

        const response = await fetchWithTimeout(
            `${REPOSITORY_URL}/edu-sharing/rest/authentication/v1/validateSession`,
            { method: 'GET', headers: { 'Authorization': authHeader, 'Accept': 'application/json' }, credentials: 'include' }
        );
        if (!response.ok) throw new Error('Login fehlgeschlagen: ' + response.status);

        const sessionData = await response.json();

        if (sessionData.isGuest || sessionData.statusCode === 'GUEST') {
            throw new Error('Gast-Login ist nicht erlaubt. Bitte mit deinem WLO-Account anmelden.');
        }
        if (!sessionData.isValidLogin || sessionData.statusCode !== 'OK') {
            throw new Error('Login fehlgeschlagen: Ungültige Credentials');
        }

        const hasCreatePermission = Array.isArray(sessionData.toolPermissions)
            && sessionData.toolPermissions.includes('TOOLPERMISSION_CREATE_ELEMENTS_FILES');
        if (!hasCreatePermission) {
            throw new Error('Dein Account hat keine Berechtigung zum Erstellen von Inhalten');
        }

        const homeResponse = await fetchWithTimeout(
            `${REPOSITORY_URL}/edu-sharing/rest/node/v1/nodes/-home-/-inbox-/metadata`,
            { headers: { 'Authorization': authHeader, 'Accept': 'application/json' }, credentials: 'include' }
        );
        if (!homeResponse.ok) throw new Error('Konnte User Home nicht abrufen');

        const homeData = await homeResponse.json();
        const userHomeId = typeof homeData?.node?.ref?.id === 'string' ? homeData.node.ref.id : null;
        if (!userHomeId) throw new Error('User Home ID nicht gefunden');

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
        showSuccess('Erfolgreich angemeldet als ' + sessionToSave.authorityName);
        displayLoginStatus(sessionToSave);
    } catch (error) {
        console.error('❌ Login failed:', error?.message || error);
        showError(error?.message || 'Login fehlgeschlagen');
    } finally {
        loginBtn.disabled = false;
        if (btnIcon) btnIcon.textContent = '🔓';
        if (btnText) btnText.textContent = 'Anmelden';
    }
}

async function handleLogout() {
    try {
        const { wloSession } = await chrome.storage.local.get('wloSession');
        if (wloSession?.authHeader) {
            try {
                await fetchWithTimeout(
                    `${REPOSITORY_URL}/edu-sharing/rest/authentication/v1/destroySession`,
                    { headers: { 'Authorization': wloSession.authHeader }, credentials: 'include' }
                );
            } catch (e) { /* ignore server-side failure */ }
        }

        await chrome.storage.local.remove('wloSession');

        loginStatus.classList.add('hidden');
        logoutBtn.classList.add('hidden');
        loginForm.classList.remove('hidden');
        permissionsBox.classList.add('hidden');

        showSuccess('Erfolgreich abgemeldet');
    } catch (error) {
        console.error('❌ Logout failed:', error?.message || error);
        showError('Abmelden fehlgeschlagen');
    }
}

function displayLoginStatus(session) {
    usernameDisplay.textContent = session.authorityName || session.username;
    loginStatus.classList.remove('hidden');
    logoutBtn.classList.remove('hidden');
    loginForm.classList.add('hidden');

    const perms = Array.isArray(session.toolPermissions) ? session.toolPermissions : [];
    if (perms.length > 0) {
        permissionsBox.classList.remove('hidden');
        // XSS-safe: textContent per <li>, no innerHTML.
        permissionsList.replaceChildren(...perms.map(p => {
            const li = document.createElement('li');
            li.textContent = String(p);
            return li;
        }));
    } else {
        permissionsBox.classList.add('hidden');
        permissionsList.replaceChildren();
    }
}

function showError(message) {
    errorMessage.textContent = message;
    errorBox.classList.remove('hidden');
    successBox.classList.add('hidden');
    setTimeout(() => errorBox.classList.add('hidden'), 5000);
}

function showSuccess(message) {
    successMessage.textContent = message;
    successBox.classList.remove('hidden');
    errorBox.classList.add('hidden');
    setTimeout(() => successBox.classList.add('hidden'), 3000);
}

// ============================================================================
// CONFIG MANAGEMENT
// ============================================================================

async function loadConfigSettings() {
    try {
        const { customRepositoryUrl, customApiUrl } = await chrome.storage.local.get([
            'customRepositoryUrl',
            'customApiUrl'
        ]);

        const safeRepo = sanitizeOrigin(customRepositoryUrl, ALLOWED_REPO_HOSTS);
        repositoryUrlInput.value = safeRepo || WLO_CONFIG.getRepositoryUrl();
        if (safeRepo) REPOSITORY_URL = safeRepo;

        if (apiUrlInput) {
            const safeApi = sanitizeOrigin(customApiUrl, ALLOWED_API_HOSTS);
            apiUrlInput.value = safeApi || WLO_CONFIG.getApiUrl();
        }
    } catch (error) {
        console.error('❌ Failed to load config settings:', error?.message || error);
    }
}

async function handleSaveRepositoryUrl() {
    const raw = repositoryUrlInput.value.trim();
    if (!raw) { showError('Bitte gib eine Repository-URL ein'); return; }
    const safe = sanitizeOrigin(raw, ALLOWED_REPO_HOSTS);
    if (!safe) {
        showError('Nur erlaubte WLO-Hosts (https) sind zugelassen.');
        return;
    }
    try {
        await chrome.storage.local.set({ customRepositoryUrl: safe });
        REPOSITORY_URL = safe;
        repositoryUrlInput.value = safe;
        showSuccess('Repository-URL gespeichert!');
    } catch (error) {
        console.error('❌ Failed to save repository URL:', error?.message || error);
        showError('Fehler beim Speichern der URL');
    }
}

async function handleResetRepositoryUrl() {
    try {
        await chrome.storage.local.remove('customRepositoryUrl');
        const defaultUrl = WLO_CONFIG.getRepositoryUrl();
        repositoryUrlInput.value = defaultUrl;
        REPOSITORY_URL = defaultUrl;
        showSuccess('Repository-URL zurückgesetzt!');
    } catch (error) {
        console.error('❌ Failed to reset repository URL:', error?.message || error);
        showError('Fehler beim Zurücksetzen der URL');
    }
}

async function handleSaveApiUrl() {
    const raw = apiUrlInput.value.trim();
    if (!raw) { showError('Bitte gib eine API-URL ein'); return; }
    const safe = sanitizeOrigin(raw, ALLOWED_API_HOSTS);
    if (!safe) {
        showError('Nur erlaubte API-Hosts (https) sind zugelassen.');
        return;
    }
    try {
        await chrome.storage.local.set({ customApiUrl: safe });
        apiUrlInput.value = safe;
        showSuccess('API-URL gespeichert!');
    } catch (error) {
        console.error('❌ Failed to save API URL:', error?.message || error);
        showError('Fehler beim Speichern');
    }
}

async function handleResetApiUrl() {
    try {
        await chrome.storage.local.remove('customApiUrl');
        const defaultUrl = WLO_CONFIG.getApiUrl();
        if (apiUrlInput) apiUrlInput.value = defaultUrl;
        showSuccess('API-URL zurückgesetzt!');
    } catch (error) {
        console.error('❌ Failed to reset API URL:', error?.message || error);
        showError('Fehler beim Zurücksetzen');
    }
}

console.log('✅ Options script v8 initialized');
