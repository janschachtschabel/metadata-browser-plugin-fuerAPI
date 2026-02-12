// WLO Metadaten-Agent - Content Script
// VERSION: 7.0.0 — Page Data Extraction Only (no iframe injection)
console.log('🔧 WLO Content Script v7 loaded');

// Listen for messages from background/sidebar
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractPageData') {
        console.log('🔍 Extracting page data...');
        try {
            const pageData = extractPageData();
            sendResponse(pageData);
        } catch (error) {
            console.error('❌ Extraction failed:', error);
            sendResponse({
                url: window.location.href,
                title: document.title,
                html: '',
                text: '',
                metadata: {}
            });
        }
        return true;
    }
});

// ===========================================================================
// EXTRACT PAGE DATA
// ===========================================================================

function extractPageData() {
    const data = {
        url: window.location.href,
        title: document.title || '',

        meta: {
            description: getMetaContent('description'),
            keywords: getMetaContent('keywords'),
            author: getMetaContent('author'),
            language: document.documentElement.lang || getMetaContent('language'),
            copyright: getMetaContent('copyright')
        },

        openGraph: {
            title: getMetaContent('og:title'),
            description: getMetaContent('og:description'),
            image: getMetaContent('og:image'),
            type: getMetaContent('og:type'),
            locale: getMetaContent('og:locale'),
            siteName: getMetaContent('og:site_name')
        },

        twitter: {
            card: getMetaContent('twitter:card'),
            title: getMetaContent('twitter:title'),
            description: getMetaContent('twitter:description'),
            image: getMetaContent('twitter:image')
        },

        dublinCore: {
            title: getMetaContent('DC.title'),
            creator: getMetaContent('DC.creator'),
            subject: getMetaContent('DC.subject'),
            description: getMetaContent('DC.description'),
            date: getMetaContent('DC.date'),
            type: getMetaContent('DC.type'),
            format: getMetaContent('DC.format'),
            language: getMetaContent('DC.language'),
            rights: getMetaContent('DC.rights')
        },

        lrmi: {
            educationalUse: getMetaContent('lrmi:educationalUse'),
            educationalLevel: getMetaContent('lrmi:educationalLevel'),
            learningResourceType: getMetaContent('lrmi:learningResourceType'),
            timeRequired: getMetaContent('lrmi:timeRequired')
        },

        structuredData: extractStructuredData(),
        license: extractLicenseInfo(),
        images: extractImages(),
        semantic: extractSemanticHTML(),
        breadcrumbs: extractBreadcrumbs(),
        tags: extractTags(),
        canonical: extractCanonicalURL(),
        alternateLanguages: extractAlternateLanguages(),
        mainContent: extractMainContent(),
        html: extractMainHTML()
    };

    try {
        data.formattedText = buildFormattedText(data);
    } catch (e) {
        console.warn('⚠️ Could not build formatted text:', e);
    }

    return data;
}

// ===========================================================================
// HELPERS
// ===========================================================================

function getMetaContent(name) {
    const meta = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
    return meta ? meta.getAttribute('content') : null;
}

function extractLicenseInfo() {
    const licenseLink = document.querySelector('[rel="license"]');
    if (licenseLink) return { source: 'link[rel=license]', url: licenseLink.href, text: licenseLink.textContent?.trim() };

    const dcRights = getMetaContent('DC.rights');
    if (dcRights) return { source: 'meta[DC.rights]', text: dcRights };

    const copyright = getMetaContent('copyright');
    if (copyright) return { source: 'meta[copyright]', text: copyright };

    const ccMatch = document.body.textContent.match(/CC (BY|BY-SA|BY-NC|BY-ND|BY-NC-SA|BY-NC-ND|0) (\d\.\d)/i);
    if (ccMatch) return { source: 'body-text', text: ccMatch[0] };

    return null;
}

function extractImages() {
    const images = {};
    const ogImage = getMetaContent('og:image');
    if (ogImage) images.ogImage = { source: 'og:image', url: ogImage };
    const twitterImage = getMetaContent('twitter:image');
    if (twitterImage) images.twitterImage = { source: 'twitter:image', url: twitterImage };
    const favicon = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
    if (favicon) images.favicon = { source: 'link[rel=icon]', url: favicon.href };
    const mainImages = Array.from(document.querySelectorAll('article img, main img, [role="main"] img'));
    if (mainImages.length > 0) {
        const largest = mainImages.sort((a, b) => (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight))[0];
        if (largest?.src) images.heroImage = { source: 'largest-content-image', url: largest.src, alt: largest.alt || '' };
    }
    return Object.keys(images).length > 0 ? images : null;
}

function extractSemanticHTML() {
    const semantic = {};
    const article = document.querySelector('article');
    if (article) {
        const time = article.querySelector('time[datetime]');
        if (time) semantic.publishDate = { source: 'article > time[datetime]', datetime: time.getAttribute('datetime'), text: time.textContent?.trim() };
        const author = article.querySelector('address, [rel="author"], .author');
        if (author) semantic.author = { source: 'article > ' + author.tagName.toLowerCase(), text: author.textContent?.trim() };
        const footer = article.querySelector('footer');
        if (footer && footer.textContent.match(/lizenz|license|cc by/i)) semantic.footerLicense = { source: 'article > footer', text: footer.textContent?.trim().substring(0, 500) };
    }
    return Object.keys(semantic).length > 0 ? semantic : null;
}

function extractBreadcrumbs() {
    const breadcrumbs = [];
    const selectors = ['[aria-label="breadcrumb"] a', '[aria-label="Breadcrumb"] a', '.breadcrumb a', '.breadcrumbs a', 'nav[aria-label*="bread" i] a'];
    for (const selector of selectors) {
        const links = document.querySelectorAll(selector);
        if (links.length > 0) {
            links.forEach(link => { const text = link.textContent?.trim(); if (text) breadcrumbs.push({ text, href: link.href }); });
            break;
        }
    }
    return breadcrumbs.length > 0 ? { source: 'nav[breadcrumb]', items: breadcrumbs } : null;
}

function extractTags() {
    const tags = [];
    document.querySelectorAll('a[rel="tag"], [rel="category"]').forEach(link => { const t = link.textContent?.trim(); if (t) tags.push(t); });
    document.querySelectorAll('meta[property="article:tag"]').forEach(meta => { const c = meta.getAttribute('content'); if (c) tags.push(c); });
    document.querySelectorAll('.tags a, .tag-list a, .post-tags a').forEach(link => { const t = link.textContent?.trim(); if (t && !tags.includes(t)) tags.push(t); });
    return tags.length > 0 ? { source: 'rel=tag, meta, .tags', items: tags } : null;
}

function extractCanonicalURL() {
    const canonical = document.querySelector('link[rel="canonical"]');
    return canonical ? { source: 'link[rel=canonical]', url: canonical.href } : null;
}

function extractAlternateLanguages() {
    const alternates = [];
    document.querySelectorAll('link[rel="alternate"][hreflang]').forEach(link => {
        const hreflang = link.getAttribute('hreflang');
        if (hreflang && link.href) alternates.push({ language: hreflang, url: link.href });
    });
    return alternates.length > 0 ? { source: 'link[rel=alternate][hreflang]', items: alternates } : null;
}

function extractMainContent() {
    for (const selector of ['main', 'article', '[role="main"]', '.main-content', '#content']) {
        const el = document.querySelector(selector);
        if (el) return (el.innerText || el.textContent).substring(0, 5000);
    }
    return document.body.innerText.substring(0, 5000);
}

function extractMainHTML() {
    for (const selector of ['main', 'article', '[role="main"]']) {
        const el = document.querySelector(selector);
        if (el) return el.innerHTML.substring(0, 10000);
    }
    return '';
}

function extractStructuredData() {
    const data = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
        try { data.push(JSON.parse(script.textContent)); } catch (e) { /* skip */ }
    });
    return data;
}

function buildFormattedText(data) {
    let text = '';
    text += '=== GRUNDINFORMATIONEN ===\n';
    text += `URL: ${data.url}\n`;
    text += `Titel: ${data.title}\n`;
    if (data.canonical?.url) text += `Canonical URL: ${data.canonical.url}\n`;
    text += '\n';

    if (data.meta && Object.values(data.meta).some(v => v)) {
        text += '=== META-TAGS ===\n';
        if (data.meta.description) text += `description: ${data.meta.description}\n`;
        if (data.meta.keywords) text += `keywords: ${data.meta.keywords}\n`;
        if (data.meta.author) text += `author: ${data.meta.author}\n`;
        if (data.meta.language) text += `Sprache: ${data.meta.language}\n`;
        if (data.meta.copyright) text += `copyright: ${data.meta.copyright}\n`;
        text += '\n';
    }

    if (data.openGraph && Object.values(data.openGraph).some(v => v)) {
        text += '=== OPEN GRAPH ===\n';
        if (data.openGraph.title) text += `og:title: ${data.openGraph.title}\n`;
        if (data.openGraph.description) text += `og:description: ${data.openGraph.description}\n`;
        if (data.openGraph.type) text += `og:type: ${data.openGraph.type}\n`;
        if (data.openGraph.siteName) text += `og:site_name: ${data.openGraph.siteName}\n`;
        text += '\n';
    }

    if (data.twitter && Object.values(data.twitter).some(v => v)) {
        text += '=== TWITTER CARDS ===\n';
        for (const [k, v] of Object.entries(data.twitter)) { if (v) text += `twitter:${k}: ${v}\n`; }
        text += '\n';
    }

    if (data.dublinCore && Object.values(data.dublinCore).some(v => v)) {
        text += '=== DUBLIN CORE ===\n';
        for (const [k, v] of Object.entries(data.dublinCore)) { if (v) text += `DC.${k}: ${v}\n`; }
        text += '\n';
    }

    if (data.lrmi && Object.values(data.lrmi).some(v => v)) {
        text += '=== LRMI ===\n';
        for (const [k, v] of Object.entries(data.lrmi)) { if (v) text += `lrmi:${k}: ${v}\n`; }
        text += '\n';
    }

    if (data.license) {
        const header = data.license.source === 'meta[copyright]' ? 'COPYRIGHT' : 'LIZENZ';
        text += `=== ${header} ===\n`;
        text += `Quelle (${data.license.source}): ${data.license.text || data.license.url}\n`;
        if (data.license.url && data.license.text) text += `Link: ${data.license.url}\n`;
        text += '\n';
    }

    if (data.images) {
        text += '=== BILDER ===\n';
        if (data.images.ogImage) text += `Vorschaubild: ${data.images.ogImage.url}\n`;
        if (data.images.heroImage) text += `Hero-Bild: ${data.images.heroImage.url}\n`;
        text += '\n';
    }

    if (data.breadcrumbs) {
        text += '=== NAVIGATION ===\n';
        data.breadcrumbs.items.forEach((c, i) => { text += `  ${i + 1}. ${c.text}\n`; });
        text += '\n';
    }

    if (data.tags) {
        text += '=== TAGS ===\n';
        text += `Tags: ${data.tags.items.join(', ')}\n\n`;
    }

    if (data.semantic) {
        text += '=== SEMANTISCHE DATEN ===\n';
        if (data.semantic.publishDate) text += `Veröffentlichung: ${data.semantic.publishDate.datetime || data.semantic.publishDate.text}\n`;
        if (data.semantic.author) text += `Autor: ${data.semantic.author.text}\n`;
        text += '\n';
    }

    if (data.structuredData?.length > 0) {
        text += '=== SCHEMA.ORG JSON-LD ===\n';
        data.structuredData.forEach((s, i) => {
            text += `Schema ${i + 1} (@type: ${s['@type'] || 'unknown'}):\n`;
            text += JSON.stringify(s, null, 2).substring(0, 1000) + '\n';
        });
        text += '\n';
    }

    text += '=== HAUPTINHALT ===\n';
    text += data.mainContent || '';
    return text;
}
