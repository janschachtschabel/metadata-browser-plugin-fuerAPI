// WLO Metadaten-Agent - Options/Login Script
// VERSION: 7.0.0
console.log('🔧 Options page v7 loaded');

// Use central configuration (can be overridden via chrome.storage)
let REPOSITORY_URL = WLO_CONFIG.getRepositoryUrl();

// DOM Elements - Login
const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const loginStatus = document.getElementById('login-status');
const usernameDisplay = document.getElementById('username-display');
const permissionsBox = document.getElementById('permissions-box');
const permissionsList = document.getElementById('permissions-list');

// DOM Elements - Config
const repositoryUrlInput = document.getElementById('repository-url');
const saveRepoUrlBtn = document.getElementById('save-repo-url-btn');
const resetRepoUrlBtn = document.getElementById('reset-repo-url-btn');
const apiUrlInput = document.getElementById('api-url');
const saveApiUrlBtn = document.getElementById('save-api-url-btn');
const resetApiUrlBtn = document.getElementById('reset-api-url-btn');

// DOM Elements - Messages
const errorBox = document.getElementById('error-box');
const errorMessage = document.getElementById('error-message');
const successBox = document.getElementById('success-box');
const successMessage = document.getElementById('success-message');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Initializing options page...');
    await loadSession();
    await loadConfigSettings();
    setupEventListeners();
});

// Setup Event Listeners
function setupEventListeners() {
    // Login
    loginForm.addEventListener('submit', handleLogin);
    logoutBtn.addEventListener('click', handleLogout);
    
    // Config
    saveRepoUrlBtn.addEventListener('click', handleSaveRepositoryUrl);
    resetRepoUrlBtn.addEventListener('click', handleResetRepositoryUrl);
    saveApiUrlBtn?.addEventListener('click', handleSaveApiUrl);
    resetApiUrlBtn?.addEventListener('click', handleResetApiUrl);
}

// Load existing session from storage
async function loadSession() {
    try {
        const { wloSession } = await chrome.storage.local.get('wloSession');
        
        if (wloSession && wloSession.isValidLogin) {
            console.log('✅ Found existing session:', wloSession.authorityName);
            displayLoginStatus(wloSession);
        } else {
            console.log('ℹ️ No active session');
        }
    } catch (error) {
        console.error('❌ Failed to load session:', error);
    }
}

// Handle Login
async function handleLogin(e) {
    e.preventDefault();
    
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    
    if (!username || !password) {
        showError('Bitte Benutzername und Passwort eingeben');
        return;
    }
    
    // Show loading state
    loginBtn.disabled = true;
    loginBtn.innerHTML = '<span class="btn-icon">⏳</span><span class="btn-text">Anmelden...</span>';
    
    try {
        console.log('🔐 Attempting login for user:', username);
        
        // Create Basic Auth header
        const authHeader = 'Basic ' + btoa(username + ':' + password);
        
        // Validate session with WLO
        const response = await fetch(
            `${REPOSITORY_URL}/edu-sharing/rest/authentication/v1/validateSession`,
            {
                method: 'GET',
                headers: {
                    'Authorization': authHeader,
                    'Accept': 'application/json'
                },
                credentials: 'include'
            }
        );
        
        if (!response.ok) {
            throw new Error('Login fehlgeschlagen: ' + response.status);
        }
        
        const sessionData = await response.json();
        
        console.log('📦 Session data:', sessionData);
        
        // Check if it's a valid user login (not guest)
        if (sessionData.isGuest || sessionData.statusCode === 'GUEST') {
            throw new Error('Gast-Login ist nicht erlaubt. Bitte mit deinem WLO-Account anmelden.');
        }
        
        if (!sessionData.isValidLogin || sessionData.statusCode !== 'OK') {
            throw new Error('Login fehlgeschlagen: Ungültige Credentials');
        }
        
        // Check for create permission
        const hasCreatePermission = sessionData.toolPermissions?.includes('TOOLPERMISSION_CREATE_ELEMENTS_FILES');
        if (!hasCreatePermission) {
            throw new Error('Dein Account hat keine Berechtigung zum Erstellen von Inhalten');
        }
        
        // Get User Home ID
        const homeResponse = await fetch(
            `${REPOSITORY_URL}/edu-sharing/rest/node/v1/nodes/-home-/-inbox-/metadata`,
            {
                headers: {
                    'Authorization': authHeader,
                    'Accept': 'application/json'
                },
                credentials: 'include'
            }
        );
        
        if (!homeResponse.ok) {
            throw new Error('Konnte User Home nicht abrufen');
        }
        
        const homeData = await homeResponse.json();
        const userHomeId = homeData.node?.ref?.id;
        
        if (!userHomeId) {
            throw new Error('User Home ID nicht gefunden');
        }
        
        console.log('✅ User Home ID:', userHomeId);
        
        // Save session to storage
        const sessionToSave = {
            ...sessionData,
            username: username,
            authHeader: authHeader,
            userHomeId: userHomeId,
            loginTime: new Date().toISOString()
        };
        
        await chrome.storage.local.set({ wloSession: sessionToSave });
        
        console.log('✅ Login successful!');
        
        // Clear form
        passwordInput.value = '';
        
        // Show success
        showSuccess('Erfolgreich angemeldet als ' + sessionData.authorityName);
        
        // Display login status
        displayLoginStatus(sessionToSave);
        
    } catch (error) {
        console.error('❌ Login failed:', error);
        showError(error.message || 'Login fehlgeschlagen');
    } finally {
        // Reset button
        loginBtn.disabled = false;
        loginBtn.innerHTML = '<span class="btn-icon">🔓</span><span class="btn-text">Anmelden</span>';
    }
}

// Handle Logout
async function handleLogout() {
    try {
        console.log('🔒 Logging out...');
        
        // Get session
        const { wloSession } = await chrome.storage.local.get('wloSession');
        
        if (wloSession && wloSession.authHeader) {
            // Call destroy session endpoint
            try {
                await fetch(
                    `${REPOSITORY_URL}/edu-sharing/rest/authentication/v1/destroySession`,
                    {
                        headers: {
                            'Authorization': wloSession.authHeader
                        },
                        credentials: 'include'
                    }
                );
            } catch (e) {
                console.warn('⚠️ Failed to destroy session on server:', e);
            }
        }
        
        // Clear storage
        await chrome.storage.local.remove('wloSession');
        
        console.log('✅ Logged out successfully');
        
        // Reset UI
        loginStatus.classList.add('hidden');
        logoutBtn.classList.add('hidden');
        loginForm.classList.remove('hidden');
        permissionsBox.classList.add('hidden');
        
        showSuccess('Erfolgreich abgemeldet');
        
    } catch (error) {
        console.error('❌ Logout failed:', error);
        showError('Abmelden fehlgeschlagen');
    }
}

// Display Login Status
function displayLoginStatus(session) {
    usernameDisplay.textContent = session.authorityName || session.username;
    loginStatus.classList.remove('hidden');
    logoutBtn.classList.remove('hidden');
    loginForm.classList.add('hidden');
    
    // Show permissions
    if (session.toolPermissions && session.toolPermissions.length > 0) {
        permissionsBox.classList.remove('hidden');
        permissionsList.innerHTML = session.toolPermissions
            .map(perm => `<li>${perm}</li>`)
            .join('');
    }
}

// Show Error
function showError(message) {
    errorMessage.textContent = message;
    errorBox.classList.remove('hidden');
    successBox.classList.add('hidden');
    
    setTimeout(() => {
        errorBox.classList.add('hidden');
    }, 5000);
}

// Show Success
function showSuccess(message) {
    successMessage.textContent = message;
    successBox.classList.remove('hidden');
    errorBox.classList.add('hidden');
    
    setTimeout(() => {
        successBox.classList.add('hidden');
    }, 3000);
}

// ============================================================================
// CONFIG MANAGEMENT
// ============================================================================

// Load config settings from storage
async function loadConfigSettings() {
    try {
        const { customRepositoryUrl, customApiUrl } = await chrome.storage.local.get([
            'customRepositoryUrl',
            'customApiUrl'
        ]);
        
        // Repository URL
        if (customRepositoryUrl) {
            repositoryUrlInput.value = customRepositoryUrl;
            REPOSITORY_URL = customRepositoryUrl;
        } else {
            repositoryUrlInput.value = WLO_CONFIG.getRepositoryUrl();
        }
        
        // API URL
        if (apiUrlInput) {
            apiUrlInput.value = customApiUrl || WLO_CONFIG.getApiUrl();
        }
        
        console.log('✅ Config loaded:', { repository: REPOSITORY_URL, api: apiUrlInput?.value });
    } catch (error) {
        console.error('❌ Failed to load config settings:', error);
    }
}

// Handle Save Repository URL
async function handleSaveRepositoryUrl() {
    try {
        const url = repositoryUrlInput.value.trim();
        
        if (!url) {
            showError('Bitte gib eine Repository-URL ein');
            return;
        }
        
        // Validate URL format
        try {
            new URL(url);
        } catch (e) {
            showError('Ungültige URL. Bitte verwende das Format: https://...');
            return;
        }
        
        await chrome.storage.local.set({ customRepositoryUrl: url });
        REPOSITORY_URL = url;
        
        console.log('✅ Repository URL saved:', url);
        showSuccess('Repository-URL gespeichert!');
        
    } catch (error) {
        console.error('❌ Failed to save repository URL:', error);
        showError('Fehler beim Speichern der URL');
    }
}

// Handle Reset Repository URL
async function handleResetRepositoryUrl() {
    try {
        await chrome.storage.local.remove('customRepositoryUrl');
        
        const defaultUrl = WLO_CONFIG.getRepositoryUrl();
        repositoryUrlInput.value = defaultUrl;
        REPOSITORY_URL = defaultUrl;
        
        console.log('✅ Repository URL reset to default:', defaultUrl);
        showSuccess('Repository-URL zurückgesetzt!');
        
    } catch (error) {
        console.error('❌ Failed to reset repository URL:', error);
        showError('Fehler beim Zurücksetzen der URL');
    }
}

// Handle Save API URL
async function handleSaveApiUrl() {
    try {
        const url = apiUrlInput.value.trim();
        if (!url) { showError('Bitte gib eine API-URL ein'); return; }
        try { new URL(url); } catch (e) { showError('Ungültige URL'); return; }
        await chrome.storage.local.set({ customApiUrl: url });
        console.log('✅ API URL saved:', url);
        showSuccess('API-URL gespeichert!');
    } catch (error) {
        console.error('❌ Failed to save API URL:', error);
        showError('Fehler beim Speichern');
    }
}

// Handle Reset API URL
async function handleResetApiUrl() {
    try {
        await chrome.storage.local.remove('customApiUrl');
        const defaultUrl = WLO_CONFIG.getApiUrl();
        if (apiUrlInput) apiUrlInput.value = defaultUrl;
        console.log('✅ API URL reset:', defaultUrl);
        showSuccess('API-URL zurückgesetzt!');
    } catch (error) {
        console.error('❌ Failed to reset API URL:', error);
        showError('Fehler beim Zurücksetzen');
    }
}

console.log('✅ Options script v7 initialized');
