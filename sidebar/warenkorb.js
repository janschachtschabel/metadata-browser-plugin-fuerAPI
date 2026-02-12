/**
 * Pädagogischer Warenkorb - Hauptlogik
 * Integriert in das WLO Browser-Plugin als eigener Tab
 */

class Warenkorb {
  constructor() {
    this.currentPattern = null;
    this.phases = [];
    this.selectedDiff = [];
    this.metadata = { title: '', duration: '' };
    this.filters = { discipline: '', educationalContext: '' };
    this.searchResults = [];
    this.activePhaseId = null; // which phase receives items from overlay
    this.storageKey = 'wk_lesson_plan';
  }

  // =========================================================================
  // INIT
  // =========================================================================

  init() {
    this.populateDropdowns();
    this.loadFromStorage();
    this.bindEvents();
    if (!this.currentPattern) {
      this.selectPattern('frontalunterricht');
    } else {
      this.renderPhases();
    }
    this.importPendingItems();
    console.log('🛒 Warenkorb initialisiert');
  }

  /**
   * Populate Fach and Bildungsstufe dropdowns from vocabulary data
   */
  populateDropdowns() {
    const discSelect = document.getElementById('wk-filter-discipline');
    if (discSelect && typeof WK_DISCIPLINES !== 'undefined') {
      discSelect.innerHTML = WK_DISCIPLINES.map(d =>
        `<option value="${d.uri}">${d.label}</option>`
      ).join('');
    }
    const eduSelect = document.getElementById('wk-filter-educontext');
    if (eduSelect && typeof WK_EDU_CONTEXTS !== 'undefined') {
      eduSelect.innerHTML = WK_EDU_CONTEXTS.map(e =>
        `<option value="${e.uri}">${e.label}</option>`
      ).join('');
    }
  }

  /**
   * Import items that were queued by the WLO overlay while the sidebar was closed.
   */
  importPendingItems() {
    try {
      const raw = localStorage.getItem('wk_pending_items');
      if (!raw) return;
      const items = JSON.parse(raw);
      if (!Array.isArray(items) || items.length === 0) return;

      let added = 0;
      for (const item of items) {
        const target = this.phases.find(p => p.items.length < 5) || this.phases[0];
        if (target && !target.items.some(i => i.id === item.id)) {
          target.items.push(item);
          added++;
        }
      }

      localStorage.removeItem('wk_pending_items');

      if (added > 0) {
        this.renderPhases();
        this.saveToStorage();
        this.showToast(`${added} Inhalt${added > 1 ? 'e' : ''} aus WLO-Suche importiert`);
      }
    } catch (e) {
      console.warn('Warenkorb: pending import failed', e);
    }
  }

  // =========================================================================
  // PATTERN SELECTION
  // =========================================================================

  selectPattern(patternId) {
    this.currentPattern = WK_PATTERNS[patternId];
    if (!this.currentPattern) return;

    // Keep existing items if phases match, otherwise reset
    const oldPhaseMap = {};
    this.phases.forEach(p => { oldPhaseMap[p.id] = p.items || []; });

    this.phases = this.currentPattern.phases.map(phase => ({
      ...phase,
      items: oldPhaseMap[phase.id] || []
    }));

    this.renderPhases();
    this.saveToStorage();
  }

  // =========================================================================
  // RENDERING
  // =========================================================================

  renderPhases() {
    const container = document.getElementById('wk-phases');
    if (!container) return;

    // Default active phase to first if not set
    if (!this.activePhaseId && this.phases.length > 0) {
      this.activePhaseId = this.phases[0].id;
    }

    container.innerHTML = this.phases.map((phase, idx) => {
      const isActive = phase.id === this.activePhaseId;
      return `
      <div class="wk-phase expanded${isActive ? ' wk-phase-active' : ''}" data-phase-id="${phase.id}">
        <div class="wk-phase-header">
          <button class="wk-phase-target-btn${isActive ? ' active' : ''}" data-phase-id="${phase.id}" title="${isActive ? 'Zielphase (aktiv)' : 'Als Zielphase setzen'}">
            <span class="material-icons">${isActive ? 'radio_button_checked' : 'radio_button_unchecked'}</span>
          </button>
          <span class="material-icons wk-phase-icon">${phase.icon}</span>
          <div class="wk-phase-info">
            <div class="wk-phase-name">${phase.name}</div>
            <div class="wk-phase-desc">${phase.description}</div>
          </div>
          <span class="wk-phase-dur">${phase.duration}</span>
          <span class="wk-phase-count${phase.items.length ? ' has-items' : ''}">${phase.items.length}</span>
          <span class="material-icons wk-phase-toggle">expand_more</span>
        </div>
        <div class="wk-phase-body">
          <div class="wk-phase-items" data-phase-id="${phase.id}">
            ${this.renderItems(phase)}
          </div>
          <div class="wk-phase-actions">
            <div class="wk-phase-search">
              <input type="text" placeholder="${this.metadata.title ? this.escapeHtml(this.metadata.title) : 'Inhalt suchen…'}" data-phase-id="${phase.id}" class="wk-phase-search-input">
              <button class="wk-phase-search-btn" data-phase-id="${phase.id}" title="Suchen">
                <span class="material-icons">search</span>
              </button>
              <button class="wk-phase-auto-btn" data-phase-id="${phase.id}" title="Passende Inhalte automatisch suchen">
                <span class="material-icons">auto_awesome</span>
              </button>
            </div>
            <div class="wk-phase-type-chips">
              ${(phase.contentTypes || []).map(ct => {
                const info = WK_CONTENT_TYPES[ct];
                return info ? `<span class="wk-type-chip" data-type="${ct}" data-phase-id="${phase.id}" title="${info.label}">
                  <span class="material-icons" style="color:${info.color}">${info.icon}</span>
                  <span>${info.label}</span>
                </span>` : '';
              }).join('')}
            </div>
          </div>
          <div class="wk-phase-results" data-phase-id="${phase.id}"></div>
        </div>
      </div>`;
    }).join('');

    this.setupDragDrop();
  }

  renderItems(phase) {
    if (!phase.items.length) {
      return `<div class="wk-empty-phase">
        <span class="material-icons">inbox</span>
        <span>Inhalte suchen oder hierher ziehen</span>
      </div>`;
    }

    return phase.items.map((item, idx) => `
      <div class="wk-item" draggable="true" data-item-idx="${idx}" data-phase-id="${phase.id}">
        ${item.thumbnail ? `<img class="wk-item-thumb" src="${item.thumbnail}" alt="" loading="lazy">` : `<span class="material-icons wk-item-thumb-icon">${WK_CONTENT_TYPES[item.typeId]?.icon || 'description'}</span>`}
        <div class="wk-item-info">
          <div class="wk-item-title">${this.escapeHtml(item.title)}</div>
          <div class="wk-item-type">${item.type || 'Material'}</div>
        </div>
        <div class="wk-item-actions">
          ${item.url ? `<a href="${item.url}" target="_blank" class="wk-item-link" title="Öffnen"><span class="material-icons">open_in_new</span></a>` : ''}
          <button class="wk-item-remove" data-phase-id="${phase.id}" data-item-idx="${idx}" title="Entfernen">
            <span class="material-icons">close</span>
          </button>
        </div>
      </div>
    `).join('');
  }

  renderSearchResults(phaseId, results) {
    const container = document.querySelector(`.wk-phase-results[data-phase-id="${phaseId}"]`);
    if (!container) return;

    if (!results.length) {
      container.innerHTML = '<div class="wk-no-results">Keine Ergebnisse gefunden</div>';
      setTimeout(() => { container.innerHTML = ''; }, 3000);
      return;
    }

    container.innerHTML = `
      <div class="wk-results-header">
        <span>${results.length} Ergebnis${results.length > 1 ? 'se' : ''}</span>
        <button class="wk-results-close" data-phase-id="${phaseId}">
          <span class="material-icons">close</span>
        </button>
      </div>
      ${results.map((item, idx) => `
        <div class="wk-result" data-result-idx="${idx}" data-phase-id="${phaseId}">
          ${item.thumbnail ? `<img class="wk-result-thumb" src="${item.thumbnail}" alt="" loading="lazy">` : `<span class="material-icons wk-result-thumb-icon">${WK_CONTENT_TYPES[item.typeId]?.icon || 'description'}</span>`}
          <div class="wk-result-info">
            <div class="wk-result-title">${this.escapeHtml(item.title)}</div>
            <div class="wk-result-meta">${item.type}${item.author ? ' · ' + item.author : ''}</div>
          </div>
          <button class="wk-result-add" data-result-idx="${idx}" data-phase-id="${phaseId}" title="Hinzufügen">
            <span class="material-icons">add_circle</span>
          </button>
        </div>
      `).join('')}
    `;

    // Store results for adding
    this._lastResults = results;
  }

  // =========================================================================
  // SEARCH
  // =========================================================================

  /**
   * Read current filter dropdown values
   */
  getSearchFilters() {
    return {
      discipline: document.getElementById('wk-filter-discipline')?.value || '',
      educationalContext: document.getElementById('wk-filter-educontext')?.value || ''
    };
  }

  async searchForPhase(phaseId, query, contentType = null) {
    if (!query || !query.trim()) return;

    console.log('🛒 searchForPhase:', { phaseId, query, contentType });

    const resultsContainer = document.querySelector(`.wk-phase-results[data-phase-id="${phaseId}"]`);
    if (resultsContainer) {
      resultsContainer.innerHTML = '<div class="wk-searching"><div class="wk-mini-spinner"></div> Suche…</div>';
    }

    try {
      const filters = this.getSearchFilters();
      console.log('🛒 filters:', filters);
      const results = await WK_API.search(query, {
        maxItems: 5,
        contentType,
        discipline: filters.discipline || null,
        educationalContext: filters.educationalContext || null
      });
      console.log('🛒 results:', results.length, results);
      this.renderSearchResults(phaseId, results);
    } catch (err) {
      console.error('❌ searchForPhase failed:', err);
      if (resultsContainer) {
        resultsContainer.innerHTML = '<div class="wk-no-results">Suche fehlgeschlagen — siehe Konsole</div>';
      }
    }
  }

  async autoSearchForPhase(phaseId) {
    const phase = this.phases.find(p => p.id === phaseId);
    if (!phase) return;

    const topic = this.metadata.title || '';
    const searchInput = document.querySelector(`.wk-phase-search-input[data-phase-id="${phaseId}"]`);
    const query = searchInput?.value?.trim() || topic;

    if (!query) {
      this.showToast('Bitte ein Thema eingeben');
      return;
    }

    // Use first suggested content type for this phase
    const contentType = phase.contentTypes?.[0] || null;
    await this.searchForPhase(phaseId, query, contentType);
  }

  /**
   * Auto-fill ALL phases at once: up to 3 unique items per phase,
   * deduplicated across all phases. If dedup leaves a phase empty,
   * reduce items in previous phases to free up unique content.
   */
  async autoFillAll() {
    const MAX_PER_PHASE = 3;
    const topic = this.metadata.title || '';
    if (!topic) {
      this.showToast('Bitte zuerst ein Thema eingeben');
      return;
    }

    const filters = this.getSearchFilters();
    this.showToast('Suche passende Inhalte für alle Phasen…');

    // Collect existing item IDs to avoid duplicates
    const usedIds = new Set();
    for (const phase of this.phases) {
      for (const item of phase.items) usedIds.add(item.id);
    }

    // Phase → candidate items (before adding)
    const phaseResults = new Map();

    // 1) Gather candidates for each empty phase
    for (const phase of this.phases) {
      if (phase.items.length >= MAX_PER_PHASE) continue;

      const slotsNeeded = MAX_PER_PHASE - phase.items.length;
      const candidates = [];
      const types = phase.contentTypes || [null];

      for (const ct of types) {
        if (candidates.length >= slotsNeeded) break;
        try {
          const results = await WK_API.search(topic, {
            maxItems: 10,
            contentType: ct,
            discipline: filters.discipline || null,
            educationalContext: filters.educationalContext || null
          });
          for (const r of results) {
            if (candidates.length >= slotsNeeded) break;
            if (!usedIds.has(r.id)) {
              candidates.push(r);
              usedIds.add(r.id);
            }
          }
        } catch (err) {
          console.warn(`Auto-fill ${phase.name}/${ct} failed:`, err);
        }
      }

      phaseResults.set(phase.id, candidates);
    }

    // 2) Smart redistribution: if any phase got 0 candidates,
    //    try to take 1 item from a previous phase that has >1
    for (const phase of this.phases) {
      const cands = phaseResults.get(phase.id);
      if (!cands || cands.length > 0 || phase.items.length > 0) continue;

      // This phase is empty — try to steal from earlier phases
      for (const prev of this.phases) {
        if (prev.id === phase.id) break;
        const prevCands = phaseResults.get(prev.id);
        if (prevCands && prevCands.length > 1) {
          const stolen = prevCands.pop();
          cands.push(stolen);
          break;
        }
      }
    }

    // 3) Apply candidates to phases
    let totalAdded = 0;
    for (const phase of this.phases) {
      const cands = phaseResults.get(phase.id) || [];
      for (const item of cands) {
        phase.items.push(item);
        totalAdded++;
      }
      if (cands.length > 0) this.refreshPhaseItems(phase.id);
    }

    this.saveToStorage();
    this.showToast(totalAdded > 0 ? `${totalAdded} Inhalt${totalAdded > 1 ? 'e' : ''} automatisch zugeordnet` : 'Keine passenden Inhalte gefunden');
  }

  // =========================================================================
  // ITEM MANAGEMENT
  // =========================================================================

  async addItemToPhase(phaseId, item) {
    const phase = this.phases.find(p => p.id === phaseId);
    if (!phase) return;

    // Lock key: use nodeId or id to prevent duplicate async processing
    const lockKey = item.nodeId || item.id;
    if (!this._pendingIds) this._pendingIds = new Set();
    if (this._pendingIds.has(lockKey)) {
      console.log('🛒 Skipping duplicate add (already processing):', lockKey);
      return;
    }
    this._pendingIds.add(lockKey);

    try {
      // Avoid duplicates — check across ALL phases (by id AND nodeId)
      for (const p of this.phases) {
        if (p.items.some(i => i.id === item.id || (item.nodeId && i.nodeId === item.nodeId))) {
          this.showToast(p.id === phaseId ? 'Inhalt bereits in dieser Phase' : `Inhalt bereits in „${p.name}"`);
          return;
        }
      }

      // Enrich overlay items with full metadata from the API
      if (item.source === 'wlo-overlay') {
        this.showToast('Lade Metadaten…');
        try {
          if (item.nodeId) {
            item = await WK_API.enrichItemByNodeId(item);
          } else {
            item = await WK_API.enrichItemByTitle(item);
          }
          console.log('🛒 Enriched item:', item.title, '→', item.url);
        } catch (err) {
          console.warn('🛒 Enrichment failed, using original data:', err);
        }

        // Re-check duplicates after enrichment (id may have changed)
        for (const p of this.phases) {
          if (p.items.some(i => i.id === item.id || (item.nodeId && i.nodeId === item.nodeId))) {
            this.showToast(p.id === phaseId ? 'Inhalt bereits in dieser Phase' : `Inhalt bereits in „${p.name}"`);
            return;
          }
        }
      }

      phase.items.push(item);
      this.refreshPhaseItems(phaseId);
      this.saveToStorage();
      this.showToast(`"${item.title}" → ${phase.name}`);
    } finally {
      this._pendingIds.delete(lockKey);
    }
  }

  removeItemFromPhase(phaseId, itemIdx) {
    const phase = this.phases.find(p => p.id === phaseId);
    if (!phase) return;

    phase.items.splice(itemIdx, 1);
    this.refreshPhaseItems(phaseId);
    this.saveToStorage();
  }

  moveItem(fromPhaseId, itemIdx, toPhaseId) {
    const fromPhase = this.phases.find(p => p.id === fromPhaseId);
    const toPhase = this.phases.find(p => p.id === toPhaseId);
    if (!fromPhase || !toPhase) return;

    const [item] = fromPhase.items.splice(itemIdx, 1);
    toPhase.items.push(item);

    this.refreshPhaseItems(fromPhaseId);
    this.refreshPhaseItems(toPhaseId);
    this.saveToStorage();
  }

  refreshPhaseItems(phaseId) {
    const phase = this.phases.find(p => p.id === phaseId);
    const container = document.querySelector(`.wk-phase-items[data-phase-id="${phaseId}"]`);
    if (!phase || !container) return;

    container.innerHTML = this.renderItems(phase);

    // Update count badge
    const countEl = document.querySelector(`.wk-phase[data-phase-id="${phaseId}"] .wk-phase-count`);
    if (countEl) {
      countEl.textContent = phase.items.length;
      countEl.classList.toggle('has-items', phase.items.length > 0);
    }

    this.setupDragDrop();
  }

  clearAll() {
    this.phases.forEach(p => { p.items = []; });

    // Reset metadata fields (Thema/Titel, Dauer)
    this.metadata = { title: '', duration: '' };
    ['wk-meta-title', 'wk-meta-duration'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });

    // Reset filter dropdowns (Fach, Bildungsstufe)
    this.filters = { discipline: '', educationalContext: '' };
    ['wk-filter-discipline', 'wk-filter-educontext'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });

    this.renderPhases();
    this.saveToStorage();
  }

  // =========================================================================
  // DRAG & DROP
  // =========================================================================

  setupDragDrop() {
    // Draggable items
    document.querySelectorAll('.wk-item[draggable]').forEach(el => {
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/json', JSON.stringify({
          phaseId: el.dataset.phaseId,
          itemIdx: parseInt(el.dataset.itemIdx)
        }));
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', () => {
        el.classList.remove('dragging');
        document.querySelectorAll('.wk-phase.drag-over').forEach(p => p.classList.remove('drag-over'));
      });
    });

    // Drop zones (phase items containers)
    document.querySelectorAll('.wk-phase-items').forEach(zone => {
      zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.closest('.wk-phase')?.classList.add('drag-over');
      });
      zone.addEventListener('dragleave', (e) => {
        if (!zone.contains(e.relatedTarget)) {
          zone.closest('.wk-phase')?.classList.remove('drag-over');
        }
      });
      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.closest('.wk-phase')?.classList.remove('drag-over');
        try {
          const data = JSON.parse(e.dataTransfer.getData('application/json'));
          const toPhaseId = zone.dataset.phaseId;
          if (data.phaseId && data.phaseId !== toPhaseId) {
            this.moveItem(data.phaseId, data.itemIdx, toPhaseId);
          }
        } catch (err) {
          // Ignore malformed drops
        }
      });
    });
  }

  // =========================================================================
  // EVENTS
  // =========================================================================

  bindEvents() {
    const view = document.getElementById('warenkorb-view');
    if (!view) return;

    // Pattern selector
    const patternSelect = document.getElementById('wk-pattern-select');
    if (patternSelect) {
      patternSelect.addEventListener('change', (e) => {
        this.selectPattern(e.target.value);
      });
    }

    // Metadata fields (title + duration)
    ['wk-meta-title', 'wk-meta-duration'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => {
          const key = id.replace('wk-meta-', '');
          this.metadata[key] = el.value;
          this.saveToStorage();
        });
      }
    });

    // Filter dropdowns
    const discSelect = document.getElementById('wk-filter-discipline');
    if (discSelect) {
      discSelect.addEventListener('change', () => {
        this.filters.discipline = discSelect.value;
        this.saveToStorage();
      });
    }
    const eduSelect = document.getElementById('wk-filter-educontext');
    if (eduSelect) {
      eduSelect.addEventListener('change', () => {
        this.filters.educationalContext = eduSelect.value;
        this.saveToStorage();
      });
    }

    // Global search — also propagate search term to title/topic field
    const globalSearchBtn = document.getElementById('wk-global-search-btn');
    const globalSearchInput = document.getElementById('wk-global-search-input');
    const propagateSearchTerm = () => {
      const term = globalSearchInput?.value?.trim();
      if (term) {
        const titleInput = document.getElementById('wk-meta-title');
        if (titleInput && !titleInput.value.trim()) {
          titleInput.value = term;
          this.metadata.title = term;
          this.saveToStorage();
        }
      }
    };
    if (globalSearchBtn && globalSearchInput) {
      globalSearchBtn.addEventListener('click', () => {
        propagateSearchTerm();
        WK_API.openSearch(globalSearchInput.value);
      });
      globalSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          propagateSearchTerm();
          WK_API.openSearch(globalSearchInput.value);
        }
      });
    }

    // Delegated events on the view container
    view.addEventListener('click', (e) => {
      // Phase toggle arrow → only this collapses/expands
      const toggleIcon = e.target.closest('.wk-phase-toggle');
      if (toggleIcon) {
        const phaseEl = toggleIcon.closest('.wk-phase');
        phaseEl?.classList.toggle('expanded');
        e.stopPropagation();
        return;
      }

      // Phase header click → activate phase, always ensure expanded (never collapse)
      const phaseHeader = e.target.closest('.wk-phase-header');
      if (phaseHeader) {
        const phaseEl = phaseHeader.closest('.wk-phase');
        const phaseId = phaseEl?.dataset.phaseId;
        // Set active phase
        if (phaseId) {
          this.activePhaseId = phaseId;
          document.querySelectorAll('.wk-phase-target-btn').forEach(btn => {
            const isActive = btn.dataset.phaseId === phaseId;
            btn.classList.toggle('active', isActive);
            btn.querySelector('.material-icons').textContent = isActive ? 'radio_button_checked' : 'radio_button_unchecked';
          });
          document.querySelectorAll('.wk-phase').forEach(el => {
            el.classList.toggle('wk-phase-active', el.dataset.phaseId === phaseId);
          });
          this.saveToStorage();
        }
        // Always ensure expanded when clicking header (never collapse)
        if (phaseEl && !phaseEl.classList.contains('expanded')) {
          phaseEl.classList.add('expanded');
        }
        return;
      }

      // Phase search button — use input value or fall back to topic
      const searchBtn = e.target.closest('.wk-phase-search-btn');
      if (searchBtn) {
        const phaseId = searchBtn.dataset.phaseId;
        const input = document.querySelector(`.wk-phase-search-input[data-phase-id="${phaseId}"]`);
        const query = input?.value.trim() || this.metadata.title || '';
        console.log('🛒 Search btn clicked:', { phaseId, query, inputVal: input?.value, metaTitle: this.metadata.title });
        if (query) {
          this.searchForPhase(phaseId, query);
        } else {
          this.showToast('Bitte ein Thema eingeben');
        }
        return;
      }

      // Auto search button
      const autoBtn = e.target.closest('.wk-phase-auto-btn');
      if (autoBtn) {
        this.autoSearchForPhase(autoBtn.dataset.phaseId);
        return;
      }

      // Content type chip → search with that type
      const typeChip = e.target.closest('.wk-type-chip');
      if (typeChip) {
        const phaseId = typeChip.dataset.phaseId;
        const type = typeChip.dataset.type;
        const input = document.querySelector(`.wk-phase-search-input[data-phase-id="${phaseId}"]`);
        const query = input?.value.trim() || this.metadata.title || '';
        console.log('🛒 Type chip clicked:', { phaseId, type, query });
        if (query) {
          this.searchForPhase(phaseId, query, type);
        } else {
          this.showToast('Bitte ein Thema oder Suchbegriff eingeben');
        }
        return;
      }

      // Add result to phase
      const addBtn = e.target.closest('.wk-result-add');
      if (addBtn && this._lastResults) {
        const idx = parseInt(addBtn.dataset.resultIdx);
        const phaseId = addBtn.dataset.phaseId;
        if (this._lastResults[idx]) {
          this.addItemToPhase(phaseId, this._lastResults[idx]);
        }
        return;
      }

      // Close search results
      const closeResults = e.target.closest('.wk-results-close');
      if (closeResults) {
        const resultsEl = document.querySelector(`.wk-phase-results[data-phase-id="${closeResults.dataset.phaseId}"]`);
        if (resultsEl) resultsEl.innerHTML = '';
        return;
      }

      // Remove item
      const removeBtn = e.target.closest('.wk-item-remove');
      if (removeBtn) {
        this.removeItemFromPhase(removeBtn.dataset.phaseId, parseInt(removeBtn.dataset.itemIdx));
        return;
      }

      // Differentiation tags
      const diffTag = e.target.closest('.wk-diff-chip');
      if (diffTag) {
        diffTag.classList.toggle('active');
        this.updateDifferentiation();
        return;
      }
    });

    // Phase search inputs: Enter key
    view.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const input = e.target.closest('.wk-phase-search-input');
        if (input?.value.trim()) {
          this.searchForPhase(input.dataset.phaseId, input.value);
        }
      }
    });

    // Auto-fill all button
    document.getElementById('wk-autofill-btn')?.addEventListener('click', () => {
      this.autoFillAll();
    });

    // Clear button
    document.getElementById('wk-clear-btn')?.addEventListener('click', () => {
      if (confirm('Alle Inhalte aus dem Unterrichtsablauf entfernen?')) {
        this.clearAll();
      }
    });

    // Print / Export button
    document.getElementById('wk-print-btn')?.addEventListener('click', () => {
      this.exportToPrint();
    });
  }

  updateDifferentiation() {
    this.selectedDiff = [];
    document.querySelectorAll('.wk-diff-chip.active').forEach(el => {
      this.selectedDiff.push({
        id: el.dataset.diffId,
        name: el.textContent.trim(),
        hint: el.dataset.diffHint || ''
      });
    });
    this.saveToStorage();
  }

  // =========================================================================
  // TOAST NOTIFICATIONS
  // =========================================================================

  showToast(message) {
    const existing = document.querySelector('.wk-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'wk-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  // =========================================================================
  // STORAGE
  // =========================================================================

  saveToStorage() {
    try {
      const data = {
        patternId: this.currentPattern?.id || 'frontalunterricht',
        phases: this.phases.map(p => ({ id: p.id, items: p.items })),
        metadata: this.metadata,
        filters: this.filters,
        activePhaseId: this.activePhaseId,
        selectedDiff: this.selectedDiff
      };
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch (e) {
      console.warn('Warenkorb: Storage save failed', e);
    }
  }

  loadFromStorage() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;

      const data = JSON.parse(raw);

      // Restore pattern
      if (data.patternId && WK_PATTERNS[data.patternId]) {
        this.currentPattern = WK_PATTERNS[data.patternId];
        const select = document.getElementById('wk-pattern-select');
        if (select) select.value = data.patternId;

        // Restore phases with items
        const itemMap = {};
        (data.phases || []).forEach(p => { itemMap[p.id] = p.items || []; });
        this.phases = this.currentPattern.phases.map(phase => ({
          ...phase,
          items: itemMap[phase.id] || []
        }));
      }

      // Restore metadata
      if (data.metadata) {
        this.metadata = { ...this.metadata, ...data.metadata };
        ['title', 'duration'].forEach(key => {
          const el = document.getElementById(`wk-meta-${key}`);
          if (el && this.metadata[key]) el.value = this.metadata[key];
        });
      }

      // Restore filters
      if (data.filters) {
        this.filters = { ...this.filters, ...data.filters };
        const discEl = document.getElementById('wk-filter-discipline');
        if (discEl && this.filters.discipline) discEl.value = this.filters.discipline;
        const eduEl = document.getElementById('wk-filter-educontext');
        if (eduEl && this.filters.educationalContext) eduEl.value = this.filters.educationalContext;
      }

      // Restore active phase
      if (data.activePhaseId) this.activePhaseId = data.activePhaseId;

      // Restore differentiation
      this.selectedDiff = data.selectedDiff || [];
    } catch (e) {
      console.warn('Warenkorb: Storage load failed', e);
    }
  }

  // =========================================================================
  // PRINT / EXPORT
  // =========================================================================

  exportToPrint() {
    const totalItems = this.phases.reduce((sum, p) => sum + p.items.length, 0);
    const today = new Date().toLocaleDateString('de-DE', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    const html = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <title>Unterrichtsentwurf${this.metadata.title ? ' – ' + this.metadata.title : ''}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Tahoma, sans-serif; font-size: 12pt; line-height: 1.5; color: #1e293b; padding: 40px; max-width: 210mm; margin: 0 auto; }
    h1 { font-size: 22pt; margin-bottom: 6px; color: #003B7C; }
    h2 { font-size: 15pt; margin: 20px 0 10px; color: #334155; border-bottom: 2px solid #e2e8f0; padding-bottom: 4px; }
    .header { border-bottom: 3px solid #003B7C; padding-bottom: 16px; margin-bottom: 20px; }
    .meta { display: flex; flex-wrap: wrap; gap: 20px; font-size: 11pt; color: #64748b; margin-top: 10px; }
    .meta b { color: #1e293b; }
    .pattern { background: #f1f5f9; padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; }
    .pattern-name { font-weight: 600; font-size: 13pt; }
    .pattern-desc { color: #64748b; font-size: 11pt; margin-top: 2px; }
    .phase { border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 14px; page-break-inside: avoid; }
    .phase-hdr { background: #f1f5f9; padding: 10px 14px; border-radius: 8px 8px 0 0; display: flex; align-items: center; gap: 10px; }
    .phase-title { font-weight: 600; font-size: 12pt; }
    .phase-dur { margin-left: auto; font-size: 10pt; color: #64748b; background: white; padding: 3px 10px; border-radius: 4px; }
    .phase-body { padding: 12px 14px; }
    .phase-desc { color: #64748b; font-style: italic; margin-bottom: 10px; font-size: 11pt; }
    .material { display: flex; gap: 10px; padding: 8px; background: #f8fafc; border-radius: 6px; margin-bottom: 6px; align-items: flex-start; }
    .mat-preview { width: 150px; min-width: 150px; height: auto; border-radius: 4px; object-fit: cover; }
    .mat-type { background: #e2e8f0; padding: 2px 8px; border-radius: 4px; font-size: 9pt; white-space: nowrap; }
    .mat-title { font-weight: 500; font-size: 11pt; }
    .mat-desc { font-size: 9pt; color: #64748b; margin: 2px 0; line-height: 1.4; }
    .mat-url { font-size: 9pt; color: #2563eb; word-break: break-all; }
    .empty-phase { color: #94a3b8; font-style: italic; text-align: center; padding: 16px; }
    .diff { background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 14px; margin-top: 20px; }
    .diff h3 { color: #92400e; margin-bottom: 8px; }
    .diff-tag { background: #fef9c3; padding: 2px 10px; border-radius: 12px; font-size: 10pt; font-weight: 500; display: inline-block; margin: 2px 4px; }
    .footer { margin-top: 30px; padding-top: 14px; border-top: 1px solid #e2e8f0; font-size: 9pt; color: #94a3b8; text-align: center; }
    @media print { body { padding: 20px; } .phase { break-inside: avoid; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>Unterrichtsentwurf</h1>
    ${this.metadata.title ? `<div style="font-size:16pt;font-weight:600;margin:4px 0;">${this.escapeHtml(this.metadata.title)}</div>` : ''}
    <div class="meta">
      <span><b>Datum:</b> ${today}</span>
      ${this.filters.discipline ? `<span><b>Fach:</b> ${this.escapeHtml(this.getFilterLabel('discipline', this.filters.discipline))}</span>` : ''}
      ${this.filters.educationalContext ? `<span><b>Stufe:</b> ${this.escapeHtml(this.getFilterLabel('eduContext', this.filters.educationalContext))}</span>` : ''}
      ${this.metadata.duration ? `<span><b>Dauer:</b> ${this.escapeHtml(this.metadata.duration)}</span>` : ''}
      <span><b>Materialien:</b> ${totalItems}</span>
    </div>
  </div>

  <div class="pattern">
    <div class="pattern-name">${this.currentPattern.name}</div>
    <div class="pattern-desc">${this.currentPattern.description}</div>
  </div>

  <h2>Unterrichtsverlauf</h2>

  ${this.phases.map(phase => `
  <div class="phase">
    <div class="phase-hdr">
      <span class="phase-title">${phase.name}</span>
      <span class="phase-dur">${phase.duration}</span>
    </div>
    <div class="phase-body">
      <div class="phase-desc">${phase.description}</div>
      ${phase.items.length > 0 ? phase.items.map(item => {
        const displayUrl = item.url || (item.nodeId ? `https://suche.wirlernenonline.de/search/de/detail/${item.nodeId}` : '');
        return `
      <div class="material">
        ${item.thumbnail ? `<img class="mat-preview" src="${item.thumbnail}" alt="">` : ''}
        <div>
          <span class="mat-type">${item.type || 'Material'}</span>
          <div class="mat-title">${this.escapeHtml(item.title)}</div>
          ${item.description ? `<div class="mat-desc">${this.escapeHtml(item.description.substring(0, 250))}${item.description.length > 250 ? '…' : ''}</div>` : ''}
          ${displayUrl ? `<div class="mat-url"><a href="${displayUrl}" target="_blank">${displayUrl}</a></div>` : ''}
        </div>
      </div>`;
      }).join('') : '<div class="empty-phase">Noch keine Materialien zugeordnet</div>'}
    </div>
  </div>`).join('')}

  ${this.selectedDiff.length > 0 ? `
  <div class="diff">
    <h3>Binnendifferenzierung</h3>
    ${this.selectedDiff.map(d => `<span class="diff-tag">${this.escapeHtml(d.name)}</span>`).join('')}
  </div>` : ''}

  <div class="footer">
    Erstellt mit dem WLO Metadaten-Agent · Materialien von WirLernenOnline.de
  </div>
</body>
</html>`;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      setTimeout(() => printWindow.print(), 500);
    }
  }

  // =========================================================================
  // HELPERS
  // =========================================================================

  getFilterLabel(type, uri) {
    if (!uri) return '';
    if (type === 'discipline') {
      const match = (typeof WK_DISCIPLINES !== 'undefined' ? WK_DISCIPLINES : []).find(d => d.uri === uri);
      return match?.label || uri;
    }
    if (type === 'eduContext') {
      const match = (typeof WK_EDU_CONTEXTS !== 'undefined' ? WK_EDU_CONTEXTS : []).find(e => e.uri === uri);
      return match?.label || uri;
    }
    return uri;
  }

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

// Global instance
let warenkorbInstance = null;

// Listen for messages from background script (content script overlay → sidebar)
chrome.runtime?.onMessage?.addListener((message, sender, sendResponse) => {
  if (message.action === 'warenkorb.addItem' && warenkorbInstance) {
    const item = message.item;
    // Use the user-selected active phase, fall back to first phase (and activate it)
    if (!warenkorbInstance.activePhaseId && warenkorbInstance.phases.length > 0) {
      warenkorbInstance.activePhaseId = warenkorbInstance.phases[0].id;
      warenkorbInstance.renderPhases();
    }
    const targetId = warenkorbInstance.activePhaseId || warenkorbInstance.phases[0]?.id;
    if (targetId) {
      warenkorbInstance.addItemToPhase(targetId, item);
      if (typeof switchView === 'function') switchView('warenkorb');
    }
    sendResponse({ success: true });
    return true;
  }
});
