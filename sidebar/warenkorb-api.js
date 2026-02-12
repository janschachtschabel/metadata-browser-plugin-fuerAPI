/**
 * WLO (WirLernenOnline) API Integration für den Warenkorb
 * Suche und Abruf von Bildungsinhalten aus dem edu-sharing Repository
 */

const WK_API = {
  SEARCH_URL: 'https://suche.wirlernenonline.de',
  REPOSITORY: '-home-',

  // Full URI prefix for oeh_lrt vocabulary
  LRT_PREFIX: 'http://w3id.org/openeduhub/vocabs/new_lrt_aggregated/',

  /**
   * Get the REST API base URL from central config (same as rest of plugin)
   */
  getBaseUrl() {
    const repoUrl = (typeof WLO_CONFIG !== 'undefined') ? WLO_CONFIG.getRepositoryUrl() : 'https://redaktion.openeduhub.net';
    return repoUrl + '/edu-sharing/rest';
  },

  /**
   * Suche nach Bildungsinhalten
   * @param {string} query - Suchbegriff
   * @param {object} options - Filter-Optionen
   * @returns {Promise<Array>} - Suchergebnisse
   */
  async search(query, options = {}) {
    const {
      maxItems = 5,
      skipCount = 0,
      contentType = null,
      discipline = null,
      educationalContext = null
    } = options;

    // Build criteria array — search term goes here too
    const criteria = [];

    // Search keyword as ngsearchword criterion
    if (query && query.trim()) {
      criteria.push({
        property: 'ngsearchword',
        values: [query.trim()]
      });
    }

    // Content type filter (oeh_lrt) — needs full URI
    if (contentType) {
      const ct = WK_CONTENT_TYPES[contentType];
      if (ct?.lrt) {
        criteria.push({
          property: 'ccm:oeh_lrt_aggregated',
          values: [this.LRT_PREFIX + ct.lrt]
        });
      }
    }

    // Discipline filter (taxonid) — full URI from dropdown
    if (discipline) {
      criteria.push({
        property: 'virtual:taxonid',
        values: [discipline]
      });
    }

    // Educational context filter — full URI from dropdown
    if (educationalContext) {
      criteria.push({
        property: 'ccm:educationalcontext',
        values: [educationalContext]
      });
    }

    // URL: metadataset = mds_oeh, params in query string
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/search/v1/queries/${this.REPOSITORY}/mds_oeh/ngsearch`
      + `?contentType=FILES&maxItems=${maxItems}&skipCount=${skipCount}&propertyFilter=-all-`;

    console.log('🔍 WK_API.search →', { url, criteria, query });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ criteria })
      });

      console.log('🔍 WK_API response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error('🔍 WK_API error body:', errorText);
        throw new Error(`WLO API: ${response.status} ${errorText.substring(0, 200)}`);
      }

      const data = await response.json();
      const nodes = data.nodes || [];
      console.log(`🔍 WLO search "${query}" → ${nodes.length} of ${data.pagination?.total || '?'} results`);
      return this.transformResults(nodes);
    } catch (error) {
      console.error('❌ WLO Suche fehlgeschlagen:', error);
      return [];
    }
  },

  /**
   * Transformiert API-Ergebnisse in einheitliches Format
   */
  transformResults(nodes) {
    return nodes.map(node => {
      const props = node.properties || {};
      return {
        id: node.ref?.id || node.ref?.repo + '-' + Date.now(),
        title: props['cclom:title']?.[0] || props['cm:name']?.[0] || node.name || 'Unbenannt',
        description: props['cclom:general_description']?.[0] || '',
        url: props['ccm:wwwurl']?.[0] || node.content?.url || '',
        thumbnail: node.preview?.url || '',
        type: this.getResourceType(props),
        typeId: this.getResourceTypeId(props),
        license: props['ccm:commonlicense_key']?.[0] || '',
        author: props['ccm:author']?.[0] || props['cm:creator']?.[0] || '',
        keywords: props['cclom:general_keyword'] || [],
        nodeId: node.ref?.id || ''
      };
    });
  },

  /**
   * Ermittelt den Ressourcentyp als Label
   */
  getResourceType(props) {
    const lrtValues = props['ccm:oeh_lrt_aggregated'] || props['ccm:oeh_lrt'] || [];
    const lrtJoined = lrtValues.join(' ');
    for (const [key, ct] of Object.entries(WK_CONTENT_TYPES)) {
      if (ct.lrt && lrtJoined.includes(ct.lrt)) return ct.label;
    }
    // Fallback: MIME-type basiert
    const mime = props['ccm:mimetype']?.[0] || '';
    if (mime.startsWith('video/')) return 'Video';
    if (mime.startsWith('audio/')) return 'Audio';
    if (mime.startsWith('image/')) return 'Bild';
    return 'Material';
  },

  /**
   * Ermittelt den Ressourcentyp als ID
   */
  getResourceTypeId(props) {
    const lrtValues = props['ccm:oeh_lrt_aggregated'] || props['ccm:oeh_lrt'] || [];
    const lrtJoined = lrtValues.join(' ');
    for (const [key, ct] of Object.entries(WK_CONTENT_TYPES)) {
      if (ct.lrt && lrtJoined.includes(ct.lrt)) return key;
    }
    return 'text';
  },

  /**
   * Check if a scraped card title matches an API title.
   * Handles truncation (cards often cut titles with '…' or just shorter).
   */
  titlesMatch(scraped, apiTitle) {
    if (!scraped || !apiTitle) return false;
    // Only strip trailing ellipsis ('…' or '...'), keep all other characters
    const s = scraped.replace(/\.{3}$/, '').replace(/…$/, '').toLowerCase().trim();
    const a = apiTitle.toLowerCase().trim();
    if (s === a) return true;
    // Scraped title might be truncated — check if API title starts with it (min 4 chars)
    if (s.length >= 4 && a.startsWith(s)) return true;
    // API title might be shorter or scraped might include extra text
    if (a.length >= 4 && s.startsWith(a)) return true;
    return false;
  },

  /**
   * Check if the publisher from the card matches the API node's publisher.
   */
  publisherMatches(scrapedPublisher, node) {
    if (!scrapedPublisher) return false;
    const props = node.properties || {};
    const apiPublishers = props['ccm:oeh_publisher_combined'] || [];
    const sp = scrapedPublisher.toLowerCase().trim();
    return apiPublishers.some(p => p.toLowerCase().trim() === sp);
  },

  /**
   * Build enriched item object from API node, preserving overlay data as fallback.
   */
  buildEnrichedItem(item, node) {
    const props = node.properties || {};
    return {
      ...item,
      id: node.ref?.id || item.id,
      title: props['cclom:title']?.[0] || props['cm:name']?.[0] || item.title,
      description: props['cclom:general_description']?.[0] || item.description,
      url: props['ccm:wwwurl']?.[0] || node.content?.url || item.url,
      thumbnail: node.preview?.url || item.thumbnail,
      type: this.getResourceType(props) || item.type,
      typeId: this.getResourceTypeId(props) || item.typeId,
      license: props['ccm:commonlicense_key']?.[0] || item.license || '',
      author: props['ccm:author']?.[0] || props['cm:creator']?.[0] || item.author || '',
      keywords: props['cclom:general_keyword'] || item.keywords || [],
      publisher: (props['ccm:oeh_publisher_combined'] || [])[0] || item.publisher || '',
      nodeId: node.ref?.id,
      needsEnrichment: false,
      source: item.source
    };
  },

  /**
   * Fetch full metadata directly via the node REST API endpoint.
   * Most reliable method — exact node match by ID, no search needed.
   * Works without auth for publicly indexed nodes.
   */
  async enrichItemByNodeIdDirect(item) {
    if (!item.nodeId) return null;

    // Try multiple servers: the configured one and redaktion (WLO search source)
    const servers = [
      this.getBaseUrl(),
      'https://redaktion.openeduhub.net/edu-sharing/rest'
    ];
    // Deduplicate
    const uniqueServers = [...new Set(servers)];

    for (const baseUrl of uniqueServers) {
      const url = `${baseUrl}/node/v1/nodes/${this.REPOSITORY}/${item.nodeId}/metadata?propertyFilter=-all-`;
      console.log('🔍 WK_API.enrichDirect → trying:', baseUrl, 'nodeId:', item.nodeId);

      try {
        const response = await fetch(url, {
          headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) {
          console.warn('🔍 Direct node fetch failed:', response.status, 'on', baseUrl);
          continue;
        }

        const data = await response.json();
        const node = data.node || data;

        if (!node.properties && !node.ref) {
          console.warn('🔍 Direct node fetch: unexpected response format on', baseUrl);
          continue;
        }

        console.log('✅ Direct node metadata fetched from', baseUrl, ':', node.ref?.id,
          'title:', node.properties?.['cclom:title']?.[0],
          'wwwurl:', node.properties?.['ccm:wwwurl']?.[0]);
        return this.buildEnrichedItem(item, node);
      } catch (err) {
        console.warn('🔍 Direct node fetch error on', baseUrl, ':', err);
      }
    }
    return null;
  },

  /**
   * Enrich an item with full metadata using its node ID.
   * Strategy 1: Direct node API fetch (most reliable).
   * Strategy 2: Search API with nodeId as keyword (fallback).
   */
  async enrichItemByNodeId(item) {
    if (!item.nodeId) return item;

    // Strategy 1: Direct node API fetch
    const directResult = await this.enrichItemByNodeIdDirect(item);
    if (directResult) return directResult;

    // Strategy 2: Search by nodeId as keyword (fallback)
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/search/v1/queries/${this.REPOSITORY}/mds_oeh/ngsearch`
      + `?contentType=FILES&maxItems=5&skipCount=0&propertyFilter=-all-`;

    console.log('🔍 WK_API.enrich fallback → searching for nodeId:', item.nodeId);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          criteria: [{ property: 'ngsearchword', values: [item.nodeId] }]
        })
      });

      if (!response.ok) {
        console.warn('🔍 Enrichment search failed:', response.status);
        return item;
      }

      const data = await response.json();
      const nodes = data.nodes || [];
      if (nodes.length === 0) {
        console.warn('🔍 Enrichment: no results for nodeId', item.nodeId);
        return item;
      }

      // Find node with matching nodeId
      const node = nodes.find(n => n.ref?.id === item.nodeId) || nodes[0];
      if (node.ref?.id !== item.nodeId) {
        console.warn('🔍 Enrichment nodeId mismatch: requested', item.nodeId, 'got', node.ref?.id);
        return { ...item, needsEnrichment: false };
      }

      return this.buildEnrichedItem(item, node);
    } catch (err) {
      console.warn('🔍 Enrichment error:', err);
      return item;
    }
  },

  /**
   * Clean a search term for the edu-sharing ngsearch API.
   * Strips trailing ellipsis, special chars that confuse Elasticsearch
   * (colons act as field separators, brackets as grouping, etc.).
   */
  cleanSearchTerm(text) {
    return (text || '')
      .replace(/…/g, ' ')           // Unicode ellipsis
      .replace(/\.{3}/g, ' ')       // Three dots
      .replace(/[:\-–—/\\()[\]{}!@#$%^&*+=|~`<>?;""„]/g, ' ')  // Special chars → space
      .replace(/\s+/g, ' ')         // Collapse whitespace
      .trim();
  },

  /**
   * Perform a single search and try to match a candidate by title + publisher.
   * Returns the best matched node or null.
   */
  async _searchAndMatch(searchTerm, item) {
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/search/v1/queries/${this.REPOSITORY}/mds_oeh/ngsearch`
      + `?contentType=FILES&maxItems=20&skipCount=0&propertyFilter=-all-`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ criteria: [{ property: 'ngsearchword', values: [searchTerm] }] })
    });

    if (!response.ok) {
      console.warn('🔍 Search failed:', response.status, 'for:', searchTerm);
      return null;
    }

    const data = await response.json();
    const nodes = data.nodes || [];
    console.log('🔍 Search "' + searchTerm.substring(0, 40) + '…" → ' + nodes.length + ' results');
    if (nodes.length === 0) return null;

    // Score each candidate
    const scored = nodes.map(n => {
      const props = n.properties || {};
      const apiTitle = props['cclom:title']?.[0] || n.name || '';
      let score = 0;

      // Title match (required)
      if (!this.titlesMatch(item.title, apiTitle)) return { node: n, score: -1 };
      score += 10;

      // Publisher match (strong signal)
      if (item.publisher && this.publisherMatches(item.publisher, n)) {
        score += 20;
      } else if (item.publisher) {
        score -= 5;
      }

      // Exact full title match bonus
      const cleanItem = item.title.replace(/…$/, '').replace(/\.{3}$/, '').toLowerCase().trim();
      if (apiTitle.toLowerCase().trim() === cleanItem) score += 5;

      // Has wwwurl bonus
      if (props['ccm:wwwurl']?.[0]) score += 3;

      return { node: n, score };
    });

    const candidates = scored.filter(s => s.score >= 0).sort((a, b) => b.score - a.score);
    return candidates.length > 0 ? candidates[0].node : null;
  },

  /**
   * Fallback enrichment: multi-strategy search by title + publisher.
   * Strategy 1: Full cleaned title + publisher
   * Strategy 2: Full cleaned title only
   * Strategy 3: First 4-5 significant words of title
   * Strategy 4: First 3 significant words of title
   */
  async enrichItemByTitle(item) {
    if (!item.title || item.title === 'Unbenannter Inhalt') return item;

    const cleanTitle = this.cleanSearchTerm(item.title);
    const cleanPublisher = this.cleanSearchTerm(item.publisher || '');

    console.log('🔍 WK_API.enrichByTitle → title:', item.title, '→ clean:', cleanTitle,
      cleanPublisher ? '(publisher: ' + cleanPublisher + ')' : '');

    if (!cleanTitle || cleanTitle.length < 3) return item;

    try {
      let matchedNode = null;

      // Strategy 1: Full cleaned title + publisher
      if (cleanPublisher) {
        matchedNode = await this._searchAndMatch(cleanTitle + ' ' + cleanPublisher, item);
        if (matchedNode) {
          console.log('✅ Strategy 1 (title+publisher) matched');
        }
      }

      // Strategy 2: Full cleaned title only
      if (!matchedNode) {
        matchedNode = await this._searchAndMatch(cleanTitle, item);
        if (matchedNode) {
          console.log('✅ Strategy 2 (full title) matched');
        }
      }

      // Strategy 3: First 5 significant words (skip very short words)
      if (!matchedNode) {
        const words = cleanTitle.split(' ').filter(w => w.length > 2);
        if (words.length > 3) {
          const shortQuery = words.slice(0, 5).join(' ');
          matchedNode = await this._searchAndMatch(shortQuery, item);
          if (matchedNode) {
            console.log('✅ Strategy 3 (first 5 words) matched');
          }
        }
      }

      // Strategy 4: First 3 significant words (broadest search)
      if (!matchedNode) {
        const words = cleanTitle.split(' ').filter(w => w.length > 2);
        if (words.length > 2) {
          const shortQuery = words.slice(0, 3).join(' ');
          matchedNode = await this._searchAndMatch(shortQuery, item);
          if (matchedNode) {
            console.log('✅ Strategy 4 (first 3 words) matched');
          }
        }
      }

      if (!matchedNode) {
        console.warn('🔍 Title enrichment: no match after 4 strategies for "' + item.title + '"');
        return { ...item, needsEnrichment: false };
      }

      const bestTitle = matchedNode.properties?.['cclom:title']?.[0] || matchedNode.name || '';
      console.log('🔍 Title enrichment final:', bestTitle,
        'wwwurl:', matchedNode.properties?.['ccm:wwwurl']?.[0] || '(none)');
      return this.buildEnrichedItem(item, matchedNode);
    } catch (err) {
      console.warn('🔍 Title enrichment error:', err);
      return item;
    }
  },

  /**
   * Generiert die Such-URL für WLO
   */
  getSearchUrl(query = '') {
    return query
      ? `${this.SEARCH_URL}/search/de/search?q=${encodeURIComponent(query)}`
      : `${this.SEARCH_URL}/search/de/search`;
  },

  /**
   * Öffnet die WLO-Suche in einem neuen Tab
   */
  openSearch(query = '') {
    window.open(this.getSearchUrl(query), '_blank');
  }
};
