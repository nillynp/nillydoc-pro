/* ============================================================================
 * NillyDoc Pro v1.3 — Acrobat-Style Minimal PDF Studio
 * created by Nilly graphics (Sotiris Christos) — https://nillygraphics.com/
 * 100% Offline Client-Side Engine (pdf.js + pdf-lib) · Desktop & Mobile PWA
 * Features: Continuous Virtualized Multi-Page Scroll, Cross-Span Greek Ctrl+F
 * Search with Auto-Scroll, WYSIWYG Direct Inline Text & PDF Text Editing
 * ============================================================================ */

(function () {
  'use strict';

  const BRAND_AUTHOR = 'Nilly graphics (Sotiris Christos)';
  const BRAND_PRODUCER = 'NillyDoc Pro — created by Nilly graphics (Sotiris Christos) — https://nillygraphics.com/';
  const REF_PAGE_WIDTH = 794;
  const LS_THEME = 'nillydoc_theme';
  const LS_SIGNS = 'nillydoc_saved_signs';

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js';
  }

  const urlParams = new URLSearchParams(window.location.search);
  const DESKTOP_MODE = urlParams.get('desktop') === '1';
  const SESSION_TOKEN = urlParams.get('t') || '';

  // ==========================================================================
  // APPLICATION STATE
  // ==========================================================================
  const state = {
    pdfBytes: null,          // Uint8Array (always pass .slice() to pdf.js!)
    pdfDoc: null,
    fileName: 'document.pdf',
    hasDiskPath: false,
    pageCount: 0,
    currentPage: 1,          // 1-based page closest to viewport center
    zoom: 1,
    fitWidth: true,
    pageBaseW: 595.28,
    pageBaseH: 841.89,

    // Continuous multi-page views array (indexed 0..pageCount-1)
    pageViews: [],
    pageObserver: null,
    scrollSyncLock: false,

    // Active editing tool & formatting
    tool: 'select',
    color: '#DC2626',
    strokeSize: 16,
    textBold: true,
    textBg: false,
    watermark: null,         // { text, color, opacity, style }
    pageNumbers: null,       // { pos, fmt }
    docMeta: { title: '', author: BRAND_AUTHOR },

    // Per-page annotations & undo/redo
    annotations: [],         // Array<Array<Anno>>
    undoStack: [],
    redoStack: [],
    selectedPageIdx: -1,
    selectedId: null,
    activeNoteId: null,
    pendingStamp: null,
    pendingSignSrc: null,
    pendingImgSrc: null,

    // Active WYSIWYG inline text editor on page
    inlineEditor: null,      // { el, pageIdx, existingId, x, y, size, color, bold, bg, coverBox }

    // Pointer interaction
    dragging: false,
    dragPageIdx: -1,
    dragMode: null,          // 'draw' | 'move' | 'resize'
    draftAnno: null,
    dragStartNorm: null,
    dragOrigSnapshot: null,

    // Pan ergonomics
    spaceDown: false,
    panActive: false,
    panStart: null,

    // Cross-span Greek-aware Search
    searchIndexCache: new Map(), // pageNum -> { fullNorm, charBoxes }
    searchMatches: [],           // Array<{ page, boxes: [{x,y,w,h}] }>
    searchIdx: -1,
    searchVersion: 0,

    // Multi-Image -> PDF Queue
    imgQueue: [],
    imgSizePreset: 'medium',
    imgLayout: 'a4p',

    // Modal selections
    saveMode: 'vector',
    expScope: 'current',
    expFmt: 'png',
    expDpi: 300,
    wmColor: '#64748B',
    wmStyle: 'diag',
    pnPos: 'center',
    pnFmt: 'of',

    // Signature pad
    signInk: '#111827',
    signDrawing: false,
    signHasInk: false,
    signLastPt: null,

    promptCallback: null,
    imgCache: new Map(),
    dirty: false
  };

  // ==========================================================================
  // DOM REFERENCES
  // ==========================================================================
  const $ = (id) => document.getElementById(id);
  const el = {
    btnToggleThumbs: $('btnToggleThumbs'),
    btnCloseThumbs: $('btnCloseThumbs'),
    docFileName: $('docFileName'),
    navControls: $('navControls'),
    btnPrevPage: $('btnPrevPage'),
    btnNextPage: $('btnNextPage'),
    inpPageNum: $('inpPageNum'),
    lblPageTotal: $('lblPageTotal'),
    btnZoomOut: $('btnZoomOut'),
    btnZoomIn: $('btnZoomIn'),
    btnZoomFit: $('btnZoomFit'),
    lblZoom: $('lblZoom'),
    btnOpenPdf: $('btnOpenPdf'),
    btnImgsToPdf: $('btnImgsToPdf'),
    btnMergePdf: $('btnMergePdf'),
    btnSplitPdf: $('btnSplitPdf'),
    btnSearchToggle: $('btnSearchToggle'),
    btnToggleComments: $('btnToggleComments'),
    btnCloseComments: $('btnCloseComments'),
    badgeComments: $('badgeComments'),
    moreMenuWrap: $('moreMenuWrap'),
    btnMoreMenu: $('btnMoreMenu'),
    moreMenu: $('moreMenu'),
    btnWatermarkOpen: $('btnWatermarkOpen'),
    btnPageNumsOpen: $('btnPageNumsOpen'),
    btnExportImgsOpen: $('btnExportImgsOpen'),
    btnDocInfoOpen: $('btnDocInfoOpen'),
    btnSaveOpen: $('btnSaveOpen'),
    btnThemeToggle: $('btnThemeToggle'),

    searchBar: $('searchBar'),
    inpSearch: $('inpSearch'),
    lblSearchCount: $('lblSearchCount'),
    btnSearchPrev: $('btnSearchPrev'),
    btnSearchNext: $('btnSearchNext'),
    btnSearchClose: $('btnSearchClose'),

    toolStrip: $('toolStrip'),
    inkPalette: $('inkPalette'),
    selStrokeSize: $('selStrokeSize'),
    btnTextBold: $('btnTextBold'),
    btnTextBg: $('btnTextBg'),
    btnUndo: $('btnUndo'),
    btnRedo: $('btnRedo'),
    btnDelSelected: $('btnDelSelected'),
    btnExportPng: $('btnExportPng'),
    btnPrint: $('btnPrint'),

    dropTarget: $('dropTarget'),
    thumbRail: $('thumbRail'),
    btnAddBlankPage: $('btnAddBlankPage'),
    thumbList: $('thumbList'),
    deskViewport: $('deskViewport'),
    emptyState: $('emptyState'),
    btnEmptyOpenPdf: $('btnEmptyOpenPdf'),
    btnEmptyImgsPdf: $('btnEmptyImgsPdf'),
    btnEmptyBlank: $('btnEmptyBlank'),
    stageWrap: $('stageWrap'),
    pagesContainer: $('pagesContainer'),
    commentsRail: $('commentsRail'),
    commentsList: $('commentsList'),
    statusText: $('statusText'),

    fileOpenPdf: $('fileOpenPdf'),
    fileMergePdf: $('fileMergePdf'),
    fileImgsToPdf: $('fileImgsToPdf'),
    fileInsertImg: $('fileInsertImg'),
    fileSignImg: $('fileSignImg'),

    modalImgPdf: $('modalImgPdf'),
    lblImgPdfMeta: $('lblImgPdfMeta'),
    btnAddMoreImgs: $('btnAddMoreImgs'),
    btnClearImgs: $('btnClearImgs'),
    imgQueueList: $('imgQueueList'),
    imgSizeGrid: $('imgSizeGrid'),
    imgLayoutRow: $('imgLayoutRow'),
    btnBuildImgPdf: $('btnBuildImgPdf'),

    modalSave: $('modalSave'),
    lblSaveMeta: $('lblSaveMeta'),
    inpSaveName: $('inpSaveName'),
    pdfSaveSizeGrid: $('pdfSaveSizeGrid'),
    chkEmbedNotes: $('chkEmbedNotes'),
    btnSaveAsDesktop: $('btnSaveAsDesktop'),
    btnConfirmSave: $('btnConfirmSave'),

    modalSign: $('modalSign'),
    signCanvas: $('signCanvas'),
    signInks: $('signInks'),
    btnUploadSign: $('btnUploadSign'),
    btnClearSign: $('btnClearSign'),
    savedSignsRow: $('savedSignsRow'),
    btnApplySign: $('btnApplySign'),

    modalStamp: $('modalStamp'),
    stampGrid: $('stampGrid'),
    inpCustomStamp: $('inpCustomStamp'),
    btnUseCustomStamp: $('btnUseCustomStamp'),

    modalSplit: $('modalSplit'),
    lblSplitMeta: $('lblSplitMeta'),
    inpSplitRange: $('inpSplitRange'),
    btnConfirmSplit: $('btnConfirmSplit'),

    modalPrompt: $('modalPrompt'),
    lblPromptTitle: $('lblPromptTitle'),
    txtPromptInput: $('txtPromptInput'),
    btnPromptOk: $('btnPromptOk'),

    modalWatermark: $('modalWatermark'),
    inpWmText: $('inpWmText'),
    wmColors: $('wmColors'),
    rngWmOpacity: $('rngWmOpacity'),
    lblWmOpacity: $('lblWmOpacity'),
    wmStyleRow: $('wmStyleRow'),
    btnClearWatermark: $('btnClearWatermark'),
    btnApplyWatermark: $('btnApplyWatermark'),

    modalPageNums: $('modalPageNums'),
    pnPosRow: $('pnPosRow'),
    pnFmtRow: $('pnFmtRow'),
    btnClearPageNums: $('btnClearPageNums'),
    btnApplyPageNums: $('btnApplyPageNums'),

    modalExportImgs: $('modalExportImgs'),
    lblExportImgsMeta: $('lblExportImgsMeta'),
    expScopeRow: $('expScopeRow'),
    expFmtRow: $('expFmtRow'),
    expDpiRow: $('expDpiRow'),
    btnConfirmExportImgs: $('btnConfirmExportImgs'),

    modalDocInfo: $('modalDocInfo'),
    docSpecsGrid: $('docSpecsGrid'),
    inpMetaTitle: $('inpMetaTitle'),
    inpMetaAuthor: $('inpMetaAuthor'),
    btnSaveDocMeta: $('btnSaveDocMeta'),

    toast: $('toast')
  };

  // ==========================================================================
  // UTILITIES
  // ==========================================================================
  let toastTimer = null;
  function showToast(msg, ms = 2800) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), ms);
  }

  function setStatus(msg) {
    if (el.statusText) el.statusText.textContent = msg;
  }

  function uid() {
    return 'a_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  }

  function formatBytes(bytes) {
    if (!bytes || bytes < 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(2) + ' MB';
  }

  // Greek accent-insensitive AND final-sigma (ς -> σ) normalized string!
  function normalizeGreek(str) {
    return String(str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/ς/g, 'σ');
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function ensurePdfExt(name) {
    const clean = (name || 'document.pdf').trim().replace(/[<>:"/\\|?*]+/g, '_');
    return /\.pdf$/i.test(clean) ? clean : clean + '.pdf';
  }

  function getCachedImage(src) {
    if (state.imgCache.has(src)) return state.imgCache.get(src);
    const img = new Image();
    img.src = src;
    img.onload = () => redrawVisibleAnnotations();
    state.imgCache.set(src, img);
    return img;
  }

  function loadImageAsync(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function openModal(m) { m.hidden = false; }
  function closeModal(m) { m.hidden = true; }
  function clonePageAnnos(arr) { return JSON.parse(JSON.stringify(arr || [])); }

  function pushUndo(pageIdx) {
    if (!state.undoStack[pageIdx]) state.undoStack[pageIdx] = [];
    state.undoStack[pageIdx].push(clonePageAnnos(state.annotations[pageIdx]));
    if (state.undoStack[pageIdx].length > 50) state.undoStack[pageIdx].shift();
    state.redoStack[pageIdx] = [];
    state.dirty = true;
    updateUndoButtons();
  }

  function updateUndoButtons() {
    const idx = state.currentPage - 1;
    const canUndo = state.undoStack[idx] && state.undoStack[idx].length > 0;
    const canRedo = state.redoStack[idx] && state.redoStack[idx].length > 0;
    el.btnUndo.disabled = !canUndo;
    el.btnRedo.disabled = !canRedo;
    el.btnUndo.style.opacity = canUndo ? '1' : '0.35';
    el.btnRedo.style.opacity = canRedo ? '1' : '0.35';
  }

  function applyTheme(theme) {
    const t = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'light' ? '#FFFFFF' : '#16171A');
    try { localStorage.setItem(LS_THEME, t); } catch (_) {}
  }

  function stampPdfMetadata(pdfLibDoc) {
    try {
      if (state.docMeta && state.docMeta.title) pdfLibDoc.setTitle(state.docMeta.title);
      pdfLibDoc.setAuthor((state.docMeta && state.docMeta.author) || BRAND_AUTHOR);
      pdfLibDoc.setCreator(BRAND_PRODUCER);
      pdfLibDoc.setProducer(BRAND_PRODUCER);
    } catch (_) {}
  }

  // ==========================================================================
  // PDF LOADING & CONTINUOUS VIRTUALIZED MULTI-PAGE RENDERER
  // ==========================================================================
  async function loadPdfBytes(bytes, fileName, options = {}) {
    if (!window.pdfjsLib) {
      showToast('Σφάλμα: Δεν φορτώθηκε η μηχανή pdf.js');
      return;
    }
    commitInlineEditor(false);
    try {
      setStatus('Φόρτωση PDF…');
      const copy = new Uint8Array(bytes);
      const loadingTask = window.pdfjsLib.getDocument({ isEvalSupported: false, data: copy.slice() });
      const doc = await loadingTask.promise;

      state.pdfBytes = copy;
      state.pdfDoc = doc;
      state.fileName = ensurePdfExt(fileName || state.fileName);
      state.hasDiskPath = !!options.hasDiskPath;
      state.pageCount = doc.numPages;
      state.currentPage = clamp(options.keepPage || 1, 1, doc.numPages);
      state.selectedId = null;
      state.selectedPageIdx = -1;
      state.searchIndexCache.clear();
      state.searchMatches = [];
      state.searchIdx = -1;
      el.lblSearchCount.textContent = '';

      if (!options.keepAnnotations) {
        state.annotations = Array.from({ length: doc.numPages }, () => []);
        state.undoStack = Array.from({ length: doc.numPages }, () => []);
        state.redoStack = Array.from({ length: doc.numPages }, () => []);
        state.watermark = null;
        state.pageNumbers = null;
        state.dirty = !!options.markDirty;
      }

      try {
        const meta = await doc.getMetadata();
        const info = (meta && meta.info) || {};
        state.docMeta = {
          title: info.Title || state.fileName.replace(/\.pdf$/i, ''),
          author: info.Author || BRAND_AUTHOR
        };
      } catch (_) {
        state.docMeta = { title: state.fileName.replace(/\.pdf$/i, ''), author: BRAND_AUTHOR };
      }

      el.emptyState.hidden = true;
      el.stageWrap.hidden = false;
      el.navControls.hidden = false;
      el.toolStrip.hidden = false;
      el.btnSearchToggle.hidden = false;
      el.btnToggleComments.hidden = false;
      el.moreMenuWrap.hidden = false;
      el.btnSaveOpen.hidden = false;
      el.btnDelSelected.hidden = true;

      if (window.innerWidth > 960 && state.pageCount > 1) {
        el.thumbRail.hidden = false;
      }

      el.docFileName.textContent = state.fileName;
      el.docFileName.title = state.fileName;
      document.title = state.fileName + ' — NillyDoc Pro';
      el.lblPageTotal.textContent = String(state.pageCount);
      el.inpPageNum.max = String(state.pageCount);
      el.inpPageNum.value = String(state.currentPage);

      await buildAllPageStages(true);
      if (state.currentPage > 1) {
        goToPage(state.currentPage, false);
      } else {
        el.deskViewport.scrollTop = 0;
      }
      buildThumbnails();
      refreshCommentsUI();
      updateUndoButtons();
      setStatus(`${state.fileName} · ${state.pageCount} σελ. · ${formatBytes(state.pdfBytes.byteLength)} · 100% τοπικά`);
    } catch (err) {
      console.error('loadPdfBytes error:', err);
      showToast('Αδυναμία ανοίγματος PDF (ίσως είναι προστατευμένο ή κατεστραμμένο).');
      setStatus('Σφάλμα φόρτωσης PDF');
    }
  }

  async function createBlankA4Pdf() {
    const doc = await window.PDFLib.PDFDocument.create();
    doc.addPage([595.28, 841.89]);
    stampPdfMetadata(doc);
    const bytes = await doc.save();
    await loadPdfBytes(bytes, 'NillyDoc_A4.pdf', { hasDiskPath: false, markDirty: true });
    showToast('Δημιουργήθηκε κενό έγγραφο A4');
  }

  function computeAutoFitZoom(baseW, baseH) {
    const isMob = window.innerWidth <= 820;
    const pad = isMob ? 22 : 64;
    const availW = Math.max(280, el.deskViewport.clientWidth - pad);
    if (isMob) {
      return clamp(availW / baseW, 0.35, 2.0);
    }
    const availH = Math.max(360, el.deskViewport.clientHeight - 56);
    const fitPage = Math.min(availW / baseW, availH / baseH);
    return clamp(Math.max(fitPage, Math.min(availW / baseW, 1.05)), 0.45, 1.35);
  }

  async function buildAllPageStages(recalcFit = true) {
    if (!state.pdfDoc) return;
    if (state.pageObserver) {
      state.pageObserver.disconnect();
      state.pageObserver = null;
    }

    // Read page 1 dimensions immediately; read individual page dims for <= 30 pages
    const firstPage = await state.pdfDoc.getPage(1);
    const vp1 = firstPage.getViewport({ scale: 1 });
    state.pageBaseW = vp1.width;
    state.pageBaseH = vp1.height;

    if (state.fitWidth || recalcFit) {
      if (state.fitWidth) {
        state.zoom = computeAutoFitZoom(vp1.width, vp1.height);
      }
    }
    el.lblZoom.textContent = Math.round(state.zoom * 100) + '%';

    el.pagesContainer.innerHTML = '';
    state.pageViews = [];

    for (let p = 1; p <= state.pageCount; p++) {
      let bw = vp1.width, bh = vp1.height;
      if (p > 1 && state.pageCount <= 30) {
        try {
          const pg = await state.pdfDoc.getPage(p);
          const v = pg.getViewport({ scale: 1 });
          bw = v.width; bh = v.height;
        } catch (_) {}
      }

      const stage = document.createElement('div');
      stage.className = 'page-stage';
      stage.dataset.page = String(p);

      const pdfCanvas = document.createElement('canvas');
      pdfCanvas.className = 'pdf-canvas';
      const annoCanvas = document.createElement('canvas');
      annoCanvas.className = 'anno-canvas';
      const textLayer = document.createElement('div');
      textLayer.className = 'text-layer';
      const pinLayer = document.createElement('div');
      pinLayer.className = 'pin-layer';

      stage.appendChild(pdfCanvas);
      stage.appendChild(annoCanvas);
      stage.appendChild(textLayer);
      stage.appendChild(pinLayer);

      if (state.pageCount > 1) {
        const badge = document.createElement('span');
        badge.className = 'page-badge';
        badge.textContent = `${p} / ${state.pageCount}`;
        stage.appendChild(badge);
      }

      const view = {
        pageNum: p,
        pageIdx: p - 1,
        stageEl: stage,
        pdfCanvas,
        annoCanvas,
        textLayer,
        pinLayer,
        baseW: bw,
        baseH: bh,
        stageW: Math.round(bw * state.zoom),
        stageH: Math.round(bh * state.zoom),
        renderedZoom: 0,
        renderTask: null
      };

      stage.style.width = view.stageW + 'px';
      stage.style.height = view.stageH + 'px';

      wireStagePointerEvents(view);
      el.pagesContainer.appendChild(stage);
      state.pageViews.push(view);
    }

    applyToolClassesToAllPages();

    // Virtualized IntersectionObserver renders visible + nearby pages seamlessly as you scroll!
    state.pageObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const p = Number(entry.target.dataset.page);
        if (entry.isIntersecting) {
          ensurePageRendered(p);
        }
      }
    }, { root: el.deskViewport, rootMargin: '900px 0px' });

    state.pageViews.forEach((v) => state.pageObserver.observe(v.stageEl));

    // Render initial currentPage + next page immediately
    await ensurePageRendered(state.currentPage);
    if (state.currentPage < state.pageCount) ensurePageRendered(state.currentPage + 1);
  }

  async function ensurePageRendered(pageNum) {
    const view = state.pageViews[pageNum - 1];
    if (!view || !state.pdfDoc) return;

    const targetZoom = state.zoom;
    if (Math.abs(view.renderedZoom - targetZoom) < 0.002 && view.pdfCanvas.width > 0) {
      drawAnnotationsForPage(view.pageIdx);
      renderNotePinsForPage(view.pageIdx);
      return;
    }

    if (view.renderTask) {
      try { view.renderTask.cancel(); } catch (_) {}
      view.renderTask = null;
    }

    const page = await state.pdfDoc.getPage(pageNum);
    const vp1 = page.getViewport({ scale: 1 });
    view.baseW = vp1.width;
    view.baseH = vp1.height;

    const dpr = Math.min(window.devicePixelRatio || 1, 2.2);
    const cssVp = page.getViewport({ scale: targetZoom });
    const renderVp = page.getViewport({ scale: targetZoom * dpr });

    view.stageW = Math.round(cssVp.width);
    view.stageH = Math.round(cssVp.height);
    view.stageEl.style.width = view.stageW + 'px';
    view.stageEl.style.height = view.stageH + 'px';

    view.pdfCanvas.width = Math.round(renderVp.width);
    view.pdfCanvas.height = Math.round(renderVp.height);
    view.annoCanvas.width = Math.round(renderVp.width);
    view.annoCanvas.height = Math.round(renderVp.height);

    const ctx = view.pdfCanvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, view.pdfCanvas.width, view.pdfCanvas.height);

    const task = page.render({ canvasContext: ctx, viewport: renderVp });
    view.renderTask = task;
    try {
      await task.promise;
      view.renderedZoom = targetZoom;
    } catch (e) {
      if (e && e.name !== 'RenderingCancelledException') console.error(e);
      return;
    }
    view.renderTask = null;

    drawAnnotationsForPage(view.pageIdx);
    renderNotePinsForPage(view.pageIdx);
    renderTextLayerForPage(view, page, cssVp);

    // Memory hygiene for huge 50+ page PDFs: release far-away offscreen canvases (> 8 pages away)
    if (state.pageCount > 24) {
      for (const other of state.pageViews) {
        if (Math.abs(other.pageNum - state.currentPage) > 8 && other.renderedZoom > 0) {
          other.pdfCanvas.width = 0;
          other.pdfCanvas.height = 0;
          other.annoCanvas.width = 0;
          other.annoCanvas.height = 0;
          other.textLayer.innerHTML = '';
          other.renderedZoom = 0;
        }
      }
    }
  }

  function rescaleAllPagesForZoom(newZoom) {
    if (!state.pdfDoc || !state.pageViews.length) return;
    commitInlineEditor(true);
    const desk = el.deskViewport;
    const prevScrollRatio = desk.scrollHeight > desk.clientHeight
      ? desk.scrollTop / (desk.scrollHeight - desk.clientHeight)
      : 0;

    state.zoom = clamp(newZoom, 0.35, 3.0);
    el.lblZoom.textContent = Math.round(state.zoom * 100) + '%';

    for (const v of state.pageViews) {
      v.stageW = Math.round(v.baseW * state.zoom);
      v.stageH = Math.round(v.baseH * state.zoom);
      v.stageEl.style.width = v.stageW + 'px';
      v.stageEl.style.height = v.stageH + 'px';
      v.renderedZoom = 0;
    }

    if (desk.scrollHeight > desk.clientHeight) {
      desk.scrollTop = prevScrollRatio * (desk.scrollHeight - desk.clientHeight);
    }

    // Re-render currently visible pages immediately!
    const top = desk.scrollTop - 400;
    const bot = desk.scrollTop + desk.clientHeight + 500;
    for (const v of state.pageViews) {
      const ot = getStageTopInDesk(v);
      if (ot + v.stageH >= top && ot <= bot) {
        ensurePageRendered(v.pageNum);
      }
    }
  }

  // Native Selectable + Click-to-Edit PDF Text Layer
  async function renderTextLayerForPage(view, page, cssVp) {
    view.textLayer.innerHTML = '';
    try {
      const tc = await page.getTextContent();
      const frag = document.createDocumentFragment();
      const measureCtx = document.createElement('canvas').getContext('2d');

      for (const it of tc.items) {
        if (!it.str) continue;
        const tx = window.pdfjsLib.Util.transform(cssVp.transform, it.transform);
        const fontH = Math.hypot(tx[2], tx[3]);
        if (fontH < 2) continue;
        const angle = Math.atan2(tx[1], tx[0]);
        const span = document.createElement('span');
        span.textContent = it.str;
        const leftPx = tx[4];
        const topPx = tx[5] - fontH * 0.88;
        const targetW = (it.width || 0) * cssVp.scale;

        span.style.left = leftPx + 'px';
        span.style.top = topPx + 'px';
        span.style.fontSize = fontH + 'px';
        span.style.fontFamily = 'sans-serif';

        // Store normalized PDF box on dataset for instant Acrobat-style click-to-edit!
        span.dataset.nx = (leftPx / cssVp.width).toFixed(5);
        span.dataset.ny = (topPx / cssVp.height).toFixed(5);
        span.dataset.nw = ((targetW || fontH * it.str.length * 0.55) / cssVp.width).toFixed(5);
        span.dataset.nh = ((fontH * 1.18) / cssVp.height).toFixed(5);
        span.dataset.fs = String(Math.round((fontH / cssVp.width) * REF_PAGE_WIDTH));

        let transformStr = '';
        if (Math.abs(angle) > 0.01) transformStr += `rotate(${angle}rad) `;
        if (targetW > 1) {
          measureCtx.font = `${fontH}px sans-serif`;
          const natW = measureCtx.measureText(it.str).width || targetW;
          const sx = clamp(targetW / natW, 0.35, 3.0);
          transformStr += `scaleX(${sx.toFixed(3)})`;
        }
        if (transformStr) span.style.transform = transformStr.trim();
        frag.appendChild(span);
      }
      view.textLayer.appendChild(frag);
    } catch (_) {}
  }

  function applyToolClassesToAllPages() {
    for (const v of state.pageViews) {
      v.annoCanvas.classList.remove('drawing-mode', 'text-mode', 'move-mode');
      if (state.tool === 'select') v.annoCanvas.classList.add('move-mode');
      else if (state.tool === 'text' || state.tool === 'note') v.annoCanvas.classList.add('text-mode');
      else v.annoCanvas.classList.add('drawing-mode');

      v.textLayer.classList.toggle('selectable', state.tool === 'select');
      v.textLayer.classList.toggle('text-edit-mode', state.tool === 'text');
    }
  }

  function getStageTopInDesk(view) {
    return view.stageEl.getBoundingClientRect().top - el.deskViewport.getBoundingClientRect().top + el.deskViewport.scrollTop;
  }

  // Update currentPage automatically while user scrolls continuously!
  function syncCurrentPageFromScroll() {
    if (state.scrollSyncLock || !state.pageViews.length) return;
    const desk = el.deskViewport;
    const midY = desk.scrollTop + desk.clientHeight * 0.42;
    let bestPage = state.currentPage;
    let bestDist = Infinity;

    for (const v of state.pageViews) {
      const center = getStageTopInDesk(v) + v.stageH / 2;
      const dist = Math.abs(center - midY);
      if (dist < bestDist) {
        bestDist = dist;
        bestPage = v.pageNum;
      }
    }

    if (bestPage !== state.currentPage) {
      state.currentPage = bestPage;
      el.inpPageNum.value = String(bestPage);
      const v = state.pageViews[bestPage - 1];
      if (v) { state.pageBaseW = v.baseW; state.pageBaseH = v.baseH; }
      highlightActiveThumb(bestPage);
      updateUndoButtons();
    }
  }

  function highlightActiveThumb(pageNum) {
    el.thumbList.querySelectorAll('.thumb-item').forEach((node) => {
      const active = Number(node.dataset.page) === pageNum;
      node.classList.toggle('active', active);
    });
  }

  function goToPage(num, smooth = true) {
    if (!state.pdfDoc || !state.pageViews.length) return;
    const p = clamp(Math.round(num), 1, state.pageCount);
    const view = state.pageViews[p - 1];
    if (!view) return;
    state.currentPage = p;
    state.pageBaseW = view.baseW;
    state.pageBaseH = view.baseH;
    el.inpPageNum.value = String(p);
    highlightActiveThumb(p);
    updateUndoButtons();

    state.scrollSyncLock = true;
    const topTarget = Math.max(0, getStageTopInDesk(view) - 16);
    el.deskViewport.scrollTo({ top: topTarget, behavior: smooth ? 'smooth' : 'auto' });
    ensurePageRendered(p);
    setTimeout(() => { state.scrollSyncLock = false; }, smooth ? 350 : 60);
  }

  // ==========================================================================
  // THUMBNAILS & PAGE MANAGEMENT (Rotate, Delete, Reorder, Duplicate, Add)
  // ==========================================================================
  async function buildThumbnails() {
    el.thumbList.innerHTML = '';
    if (!state.pdfDoc) return;

    for (let p = 1; p <= state.pageCount; p++) {
      const item = document.createElement('div');
      item.className = 'thumb-item' + (p === state.currentPage ? ' active' : '');
      item.dataset.page = String(p);

      const wrap = document.createElement('div');
      wrap.className = 'thumb-canvas-wrap';
      const cv = document.createElement('canvas');
      wrap.appendChild(cv);

      const meta = document.createElement('div');
      meta.className = 'thumb-meta';
      meta.innerHTML = `
        <span>${p}</span>
        <div class="thumb-tools">
          <button class="thumb-act" data-act="up" title="Μετακίνηση πάνω">↑</button>
          <button class="thumb-act" data-act="down" title="Μετακίνηση κάτω">↓</button>
          <button class="thumb-act" data-act="rot" title="Περιστροφή 90°">↻</button>
          <button class="thumb-act" data-act="dup" title="Αντιγραφή σελίδας">⧉</button>
          <button class="thumb-act del" data-act="del" title="Διαγραφή σελίδας">✕</button>
        </div>
      `;

      item.appendChild(wrap);
      item.appendChild(meta);

      item.addEventListener('click', (e) => {
        const actBtn = e.target.closest('.thumb-act');
        if (actBtn) {
          e.stopPropagation();
          handlePageAction(p, actBtn.dataset.act);
          return;
        }
        goToPage(p, true);
        if (window.innerWidth <= 820) el.thumbRail.hidden = true;
      });

      el.thumbList.appendChild(item);
      renderThumbCanvas(p, cv);
    }
  }

  async function renderThumbCanvas(pageNum, canvas) {
    try {
      if (!state.pdfDoc) return;
      const page = await state.pdfDoc.getPage(pageNum);
      const vp0 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: 150 / vp0.width });
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
    } catch (_) {}
  }

  async function handlePageAction(pageNum, act) {
    commitInlineEditor(true);
    const idx = pageNum - 1;
    if (!state.pdfBytes) return;

    try {
      let bytes = state.pdfBytes;
      if (act === 'rot' && state.annotations[idx] && state.annotations[idx].length > 0) {
        bytes = await buildVectorPdfBytes({ onlyPageIdx: idx, embedNotes: false });
        state.annotations[idx] = [];
        state.undoStack[idx] = [];
        state.redoStack[idx] = [];
      }

      const srcDoc = await window.PDFLib.PDFDocument.load(bytes);
      const n = srcDoc.getPageCount();

      if (act === 'rot') {
        const pg = srcDoc.getPage(idx);
        const cur = pg.getRotation().angle || 0;
        pg.setRotation(window.PDFLib.degrees((cur + 90) % 360));
        stampPdfMetadata(srcDoc);
        const out = await srcDoc.save();
        await loadPdfBytes(out, state.fileName, { hasDiskPath: state.hasDiskPath, keepPage: pageNum, keepAnnotations: true, markDirty: true });
        showToast(`Περιστροφή σελίδας ${pageNum} (+90°)`);
        return;
      }

      if (act === 'del') {
        if (n <= 1) { showToast('Δεν μπορείς να διαγράψεις τη μοναδική σελίδα.'); return; }
        srcDoc.removePage(idx);
        state.annotations.splice(idx, 1);
        state.undoStack.splice(idx, 1);
        state.redoStack.splice(idx, 1);
        const newPage = clamp(state.currentPage > pageNum ? state.currentPage - 1 : state.currentPage, 1, n - 1);
        stampPdfMetadata(srcDoc);
        const out = await srcDoc.save();
        await loadPdfBytes(out, state.fileName, { hasDiskPath: state.hasDiskPath, keepPage: newPage, keepAnnotations: true, markDirty: true });
        showToast(`Διαγράφηκε η σελίδα ${pageNum}`);
        return;
      }

      if (act === 'up' || act === 'down') {
        const target = act === 'up' ? idx - 1 : idx + 1;
        if (target < 0 || target >= n) return;
        const order = Array.from({ length: n }, (_, i) => i);
        [order[idx], order[target]] = [order[target], order[idx]];

        const outDoc = await window.PDFLib.PDFDocument.create();
        const copied = await outDoc.copyPages(srcDoc, order);
        copied.forEach((p) => outDoc.addPage(p));
        stampPdfMetadata(outDoc);

        [state.annotations[idx], state.annotations[target]] = [state.annotations[target], state.annotations[idx]];
        [state.undoStack[idx], state.undoStack[target]] = [state.undoStack[target], state.undoStack[idx]];
        [state.redoStack[idx], state.redoStack[target]] = [state.redoStack[target], state.redoStack[idx]];

        const out = await outDoc.save();
        await loadPdfBytes(out, state.fileName, { hasDiskPath: state.hasDiskPath, keepPage: target + 1, keepAnnotations: true, markDirty: true });
        return;
      }

      if (act === 'dup') {
        const outDoc = await window.PDFLib.PDFDocument.create();
        const order = [];
        for (let i = 0; i < n; i++) { order.push(i); if (i === idx) order.push(i); }
        const copied = await outDoc.copyPages(srcDoc, order);
        copied.forEach((p) => outDoc.addPage(p));
        stampPdfMetadata(outDoc);

        state.annotations.splice(idx + 1, 0, clonePageAnnos(state.annotations[idx]));
        state.undoStack.splice(idx + 1, 0, []);
        state.redoStack.splice(idx + 1, 0, []);

        const out = await outDoc.save();
        await loadPdfBytes(out, state.fileName, { hasDiskPath: state.hasDiskPath, keepPage: pageNum + 1, keepAnnotations: true, markDirty: true });
        showToast(`Αντιγράφηκε η σελίδα ${pageNum}`);
      }
    } catch (err) {
      console.error('Page action failed:', err);
      showToast('Σφάλμα κατά την αλλαγή σελίδας.');
    }
  }

  async function addBlankPage() {
    commitInlineEditor(true);
    if (!state.pdfBytes) { await createBlankA4Pdf(); return; }
    const doc = await window.PDFLib.PDFDocument.load(state.pdfBytes);
    doc.addPage([595.28, 841.89]);
    stampPdfMetadata(doc);
    state.annotations.push([]);
    state.undoStack.push([]);
    state.redoStack.push([]);
    const out = await doc.save();
    await loadPdfBytes(out, state.fileName, { hasDiskPath: state.hasDiskPath, keepPage: doc.getPageCount(), keepAnnotations: true, markDirty: true });
    showToast('Προστέθηκε κενή σελίδα A4');
  }

  async function mergePdfFiles(files) {
    commitInlineEditor(true);
    if (!files || !files.length || !state.pdfBytes) return;
    try {
      setStatus('Ένωση PDF…');
      const baseDoc = await window.PDFLib.PDFDocument.load(state.pdfBytes);
      let added = 0;
      for (const f of files) {
        const other = await window.PDFLib.PDFDocument.load(await f.arrayBuffer());
        const copied = await baseDoc.copyPages(other, other.getPageIndices());
        copied.forEach((p) => {
          baseDoc.addPage(p);
          state.annotations.push([]);
          state.undoStack.push([]);
          state.redoStack.push([]);
          added++;
        });
      }
      stampPdfMetadata(baseDoc);
      const out = await baseDoc.save();
      await loadPdfBytes(out, state.fileName, { hasDiskPath: state.hasDiskPath, keepPage: state.currentPage, keepAnnotations: true, markDirty: true });
      showToast(`Ενώθηκαν +${added} σελίδες στο PDF`);
    } catch (err) {
      console.error('Merge failed:', err);
      showToast('Αδυναμία ένωσης του PDF.');
    }
  }

  function parsePageRanges(expr, maxPage) {
    const out = [], seen = new Set();
    for (const part of String(expr || '').split(/[,;\s]+/).filter(Boolean)) {
      const m = part.match(/^(\d+)(?:-(\d+))?$/);
      if (!m) continue;
      let a = parseInt(m[1], 10), b = m[2] ? parseInt(m[2], 10) : a;
      if (a > b) [a, b] = [b, a];
      for (let p = Math.max(1, a); p <= Math.min(maxPage, b); p++) {
        if (!seen.has(p)) { seen.add(p); out.push(p - 1); }
      }
    }
    return out;
  }

  async function splitAndDownload() {
    commitInlineEditor(true);
    if (!state.pdfBytes) return;
    const indices = parsePageRanges(el.inpSplitRange.value, state.pageCount);
    if (!indices.length) { showToast('Δώσε έγκυρες σελίδες, π.χ. 1-3, 5'); return; }
    try {
      const bakedBytes = await buildVectorPdfBytes({ embedNotes: false });
      const src = await window.PDFLib.PDFDocument.load(bakedBytes);
      const outDoc = await window.PDFLib.PDFDocument.create();
      const copied = await outDoc.copyPages(src, indices);
      copied.forEach((p) => outDoc.addPage(p));
      stampPdfMetadata(outDoc);
      const bytes = await outDoc.save();
      closeModal(el.modalSplit);
      await deliverOutputBytes(bytes, `${state.fileName.replace(/\.pdf$/i, '')}_pages.pdf`, true);
      showToast(`Εξήχθησαν ${indices.length} σελίδες (${formatBytes(bytes.byteLength)})`);
    } catch (err) {
      console.error('Split failed:', err);
      showToast('Σφάλμα κατά την εξαγωγή σελίδων.');
    }
  }

  // ==========================================================================
  // ANNOTATIONS RENDERER (Unicode Greek, Bold, Cover Mask, Search Highlights)
  // ==========================================================================
  function getPageAnnos(pageIdx = state.currentPage - 1) {
    if (!state.annotations[pageIdx]) state.annotations[pageIdx] = [];
    return state.annotations[pageIdx];
  }

  function measureAnnoBox(ctx, a, W, H) {
    const sf = W / REF_PAGE_WIDTH;
    if (a.type === 'text') {
      const fs = (a.size || 16) * sf;
      const weight = a.bold === false ? '400' : '600';
      ctx.save();
      ctx.font = `${weight} ${fs}px "Segoe UI", -apple-system, Arial, sans-serif`;
      const lines = String(a.text || '').split('\n');
      let maxW = 36 * sf;
      for (const ln of lines) maxW = Math.max(maxW, ctx.measureText(ln).width);
      ctx.restore();
      const lh = fs * 1.28;
      let bx = a.x * W, by = a.y * H;
      let bw = maxW + 10 * sf, bh = Math.max(lh, lines.length * lh) + 4 * sf;
      if (a.coverBox) {
        const cx = a.coverBox.x * W, cy = a.coverBox.y * H;
        const cw = a.coverBox.w * W, ch = a.coverBox.h * H;
        const rX = Math.max(bx + bw, cx + cw), rY = Math.max(by + bh, cy + ch);
        bx = Math.min(bx, cx); by = Math.min(by, cy);
        bw = rX - bx; bh = rY - by;
      }
      return { x: bx, y: by, w: bw, h: bh };
    }
    if (a.type === 'stamp') {
      return { x: a.x * W, y: a.y * H, w: (a.w || 0.24) * W, h: (a.h || 0.068) * H };
    }
    if (['whiteout', 'rect', 'highlight', 'sign', 'image'].includes(a.type)) {
      return {
        x: Math.min(a.x, a.x + a.w) * W,
        y: Math.min(a.y, a.y + a.h) * H,
        w: Math.max(8, Math.abs(a.w) * W),
        h: Math.max(8, Math.abs(a.h) * H)
      };
    }
    if (a.type === 'arrow') {
      const x1 = a.x1 * W, y1 = a.y1 * H, x2 = a.x2 * W, y2 = a.y2 * H;
      return {
        x: Math.min(x1, x2) - 8 * sf, y: Math.min(y1, y2) - 8 * sf,
        w: Math.abs(x2 - x1) + 16 * sf, h: Math.abs(y2 - y1) + 16 * sf
      };
    }
    if (a.type === 'pen' && a.pts && a.pts.length) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const pt of a.pts) {
        minX = Math.min(minX, pt[0] * W); minY = Math.min(minY, pt[1] * H);
        maxX = Math.max(maxX, pt[0] * W); maxY = Math.max(maxY, pt[1] * H);
      }
      const pad = 8 * sf;
      return { x: minX - pad, y: minY - pad, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 };
    }
    return { x: 0, y: 0, w: 0, h: 0 };
  }

  function renderAnnoListToContext(ctx, W, H, list, opts = {}) {
    const sf = W / REF_PAGE_WIDTH;

    for (const a of list) {
      if (opts.hideId && a.id === opts.hideId) continue;
      if (a.type === 'note') {
        if (opts.embedNotes) drawEmbeddedStickyNote(ctx, a, W, H, sf);
        continue;
      }

      ctx.save();
      if (a.type === 'whiteout') {
        const bx = Math.min(a.x, a.x + a.w) * W, by = Math.min(a.y, a.y + a.h) * H;
        ctx.fillStyle = a.color === '#111827' ? '#111827' : '#FFFFFF';
        ctx.fillRect(bx, by, Math.abs(a.w) * W, Math.abs(a.h) * H);
      } else if (a.type === 'highlight') {
        const bx = Math.min(a.x, a.x + a.w) * W, by = Math.min(a.y, a.y + a.h) * H;
        ctx.globalAlpha = 0.34;
        ctx.fillStyle = a.color || '#EAB308';
        ctx.fillRect(bx, by, Math.abs(a.w) * W, Math.abs(a.h) * H);
      } else if (a.type === 'rect') {
        const bx = Math.min(a.x, a.x + a.w) * W, by = Math.min(a.y, a.y + a.h) * H;
        ctx.strokeStyle = a.color || '#DC2626';
        ctx.lineWidth = Math.max(1.5, (a.stroke || 3) * sf);
        ctx.strokeRect(bx, by, Math.abs(a.w) * W, Math.abs(a.h) * H);
      } else if (a.type === 'arrow') {
        const x1 = a.x1 * W, y1 = a.y1 * H, x2 = a.x2 * W, y2 = a.y2 * H;
        const lw = Math.max(2, (a.stroke || 3) * sf);
        ctx.strokeStyle = a.color || '#DC2626';
        ctx.fillStyle = a.color || '#DC2626';
        ctx.lineWidth = lw; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const head = Math.max(11 * sf, lw * 4.2);
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6.5), y2 - head * Math.sin(angle - Math.PI / 6.5));
        ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6.5), y2 - head * Math.sin(angle + Math.PI / 6.5));
        ctx.closePath(); ctx.fill();
      } else if (a.type === 'pen' && a.pts && a.pts.length > 1) {
        ctx.strokeStyle = a.color || '#DC2626';
        ctx.lineWidth = Math.max(1.5, (a.stroke || 3) * sf);
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(a.pts[0][0] * W, a.pts[0][1] * H);
        for (let i = 1; i < a.pts.length; i++) ctx.lineTo(a.pts[i][0] * W, a.pts[i][1] * H);
        ctx.stroke();
      } else if (a.type === 'text') {
        const fs = (a.size || 16) * sf;
        const weight = a.bold === false ? '400' : '600';
        ctx.font = `${weight} ${fs}px "Segoe UI", -apple-system, Arial, sans-serif`;
        ctx.textBaseline = 'top';
        const lines = String(a.text || '').split('\n');
        const lh = fs * 1.28;

        // First mask original PDF text box cleanly if edited in place!
        if (a.coverBox) {
          ctx.fillStyle = a.bg || '#FFFFFF';
          const pad = 2.5 * sf;
          ctx.fillRect(a.coverBox.x * W - pad, a.coverBox.y * H - pad, a.coverBox.w * W + pad * 2, a.coverBox.h * H + pad * 2);
        }
        // Optional backdrop behind typed text
        if (a.bg) {
          let maxW = 20 * sf;
          for (const ln of lines) maxW = Math.max(maxW, ctx.measureText(ln).width);
          ctx.fillStyle = a.bg;
          ctx.fillRect(a.x * W - 2 * sf, a.y * H - 1 * sf, maxW + 10 * sf, lines.length * lh + 4 * sf);
        }
        ctx.fillStyle = a.color || '#111827';
        lines.forEach((ln, i) => ctx.fillText(ln, a.x * W + 2 * sf, a.y * H + i * lh + 1 * sf));
      } else if (a.type === 'stamp') {
        const bx = a.x * W, by = a.y * H;
        const bw = (a.w || 0.24) * W, bh = (a.h || 0.068) * H;
        const col = a.color || '#059669';
        ctx.translate(bx + bw / 2, by + bh / 2);
        ctx.rotate(-0.075);
        ctx.strokeStyle = col; ctx.fillStyle = col;
        ctx.lineWidth = Math.max(2, 2.8 * sf); ctx.globalAlpha = 0.88;
        ctx.strokeRect(-bw / 2, -bh / 2, bw, bh);
        ctx.lineWidth = Math.max(1, 1 * sf);
        ctx.strokeRect(-bw / 2 + 3.5 * sf, -bh / 2 + 3.5 * sf, bw - 7 * sf, bh - 7 * sf);
        const fontPx = Math.min(bh * 0.46, (bw * 0.84) / Math.max(4, String(a.text || '').length * 0.65));
        ctx.font = `800 ${fontPx}px "Segoe UI", Arial, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(a.text || '').toUpperCase(), 0, 1 * sf);
      } else if ((a.type === 'sign' || a.type === 'image') && a.src) {
        const img = opts.preloadedImages ? opts.preloadedImages.get(a.src) : getCachedImage(a.src);
        if (img && img.complete && img.naturalWidth > 0) {
          const bx = Math.min(a.x, a.x + a.w) * W, by = Math.min(a.y, a.y + a.h) * H;
          ctx.drawImage(img, bx, by, Math.abs(a.w) * W, Math.abs(a.h) * H);
        }
      }
      ctx.restore();
    }

    if (state.watermark && state.watermark.text) {
      drawDocumentWatermark(ctx, W, H, sf, state.watermark);
    }
    if (state.pageNumbers && opts.pageNum) {
      drawDocumentPageNumber(ctx, W, H, sf, state.pageNumbers, opts.pageNum, opts.pageCount || state.pageCount);
    }

    // Crisp multi-span search highlights for THIS page!
    if (opts.drawSearch && state.searchMatches.length && opts.pageNum) {
      state.searchMatches.forEach((m, i) => {
        if (m.page !== opts.pageNum) return;
        const isActive = i === state.searchIdx;
        ctx.save();
        ctx.fillStyle = isActive ? 'rgba(249, 115, 22, 0.48)' : 'rgba(250, 204, 21, 0.36)';
        ctx.strokeStyle = isActive ? '#EA580C' : 'transparent';
        ctx.lineWidth = 2 * sf;
        for (const box of m.boxes) {
          const rx = box.x * W - 1.5 * sf, ry = box.y * H - 1 * sf;
          const rw = box.w * W + 3 * sf, rh = box.h * H + 2 * sf;
          ctx.fillRect(rx, ry, rw, rh);
          if (isActive) ctx.strokeRect(rx, ry, rw, rh);
        }
        ctx.restore();
      });
    }

    if (opts.selectedId) {
      const sel = list.find((item) => item.id === opts.selectedId && item.type !== 'note');
      if (sel) {
        const box = measureAnnoBox(ctx, sel, W, H);
        ctx.save();
        ctx.strokeStyle = '#2563EB';
        ctx.lineWidth = Math.max(1.5, 1.8 * sf);
        ctx.setLineDash([6 * sf, 4 * sf]);
        ctx.strokeRect(box.x - 3 * sf, box.y - 3 * sf, box.w + 6 * sf, box.h + 6 * sf);
        ctx.setLineDash([]);
        if (isResizable(sel)) {
          const hs = 11 * sf;
          ctx.fillStyle = '#2563EB'; ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 1.6 * sf;
          ctx.fillRect(box.x + box.w + 3 * sf - hs / 2, box.y + box.h + 3 * sf - hs / 2, hs, hs);
          ctx.strokeRect(box.x + box.w + 3 * sf - hs / 2, box.y + box.h + 3 * sf - hs / 2, hs, hs);
        }
        ctx.restore();
      }
    }
  }

  function drawEmbeddedStickyNote(ctx, note, W, H, sf) {
    const px = clamp(note.x * W, 12 * sf, W - 210 * sf);
    const py = clamp(note.y * H, 12 * sf, H - 70 * sf);
    const maxW = 196 * sf, fs = 11.5 * sf;
    ctx.save();
    ctx.font = `500 ${fs}px "Segoe UI", Arial, sans-serif`;
    const lines = []; let cur = '';
    for (const w of String(note.text || '').split(/\s+/)) {
      const test = cur ? cur + ' ' + w : w;
      if (ctx.measureText(test).width > maxW - 16 * sf && cur) { lines.push(cur); cur = w; }
      else cur = test;
    }
    if (cur) lines.push(cur);
    const bh = Math.max(30 * sf, lines.length * (fs * 1.35) + 14 * sf);
    ctx.fillStyle = '#FEF3C7'; ctx.strokeStyle = '#D97706'; ctx.lineWidth = 1.5 * sf;
    ctx.fillRect(px, py, maxW, bh); ctx.strokeRect(px, py, maxW, bh);
    ctx.fillStyle = '#111827'; ctx.textBaseline = 'top';
    lines.forEach((ln, i) => ctx.fillText(ln, px + 8 * sf, py + 7 * sf + i * fs * 1.35));
    ctx.restore();
  }

  function drawDocumentWatermark(ctx, W, H, sf, wm) {
    ctx.save();
    ctx.globalAlpha = clamp((wm.opacity || 18) / 100, 0.05, 0.65);
    ctx.fillStyle = wm.color || '#64748B';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const txt = String(wm.text || '');
    if (wm.style === 'tile') {
      ctx.font = `700 ${22 * sf}px "Segoe UI", Arial, sans-serif`;
      const stepX = Math.max(220 * sf, ctx.measureText(txt).width + 72 * sf), stepY = 150 * sf;
      ctx.translate(W / 2, H / 2); ctx.rotate(-Math.PI / 5);
      for (let y = -H; y <= H; y += stepY) for (let x = -W; x <= W; x += stepX) ctx.fillText(txt, x, y);
    } else {
      const targetW = W * (wm.style === 'diag' ? 0.92 : 0.80);
      let fs = 54 * sf;
      ctx.font = `800 ${fs}px "Segoe UI", Arial, sans-serif`;
      const measured = ctx.measureText(txt).width || 1;
      if (measured > targetW) {
        fs = Math.max(14 * sf, fs * (targetW / measured));
        ctx.font = `800 ${fs}px "Segoe UI", Arial, sans-serif`;
      }
      ctx.translate(W / 2, H / 2);
      if (wm.style === 'diag') ctx.rotate(-Math.PI / 4.5);
      ctx.fillText(txt, 0, 0);
    }
    ctx.restore();
  }

  function drawDocumentPageNumber(ctx, W, H, sf, pn, pageNum, pageCount) {
    const label = pn.fmt === 'num' ? String(pageNum) : `${pageNum} / ${pageCount}`;
    const marginX = 36 * sf, y = H - 24 * sf;
    ctx.save();
    ctx.font = `600 ${12 * sf}px "Segoe UI", Arial, sans-serif`;
    ctx.fillStyle = '#475569'; ctx.textBaseline = 'middle';
    ctx.textAlign = pn.pos === 'left' ? 'left' : (pn.pos === 'right' ? 'right' : 'center');
    ctx.fillText(label, pn.pos === 'left' ? marginX : (pn.pos === 'right' ? W - marginX : W / 2), y);
    ctx.restore();
  }

  function isResizable(a) {
    return ['text', 'whiteout', 'rect', 'highlight', 'sign', 'image', 'stamp'].includes(a.type);
  }

  function drawAnnotationsForPage(pageIdx) {
    const view = state.pageViews[pageIdx];
    if (!view || !view.annoCanvas.width) return;
    const ctx = view.annoCanvas.getContext('2d');
    ctx.clearRect(0, 0, view.annoCanvas.width, view.annoCanvas.height);

    const list = getPageAnnos(pageIdx).slice();
    if (state.draftAnno && state.dragPageIdx === pageIdx) list.push(state.draftAnno);
    renderAnnoListToContext(ctx, view.annoCanvas.width, view.annoCanvas.height, list, {
      selectedId: state.selectedPageIdx === pageIdx ? state.selectedId : null,
      hideId: (state.inlineEditor && state.inlineEditor.pageIdx === pageIdx) ? state.inlineEditor.existingId : null,
      drawSearch: true,
      embedNotes: false,
      pageNum: pageIdx + 1,
      pageCount: state.pageCount
    });
  }

  function redrawVisibleAnnotations() {
    for (const v of state.pageViews) {
      if (v.renderedZoom > 0) drawAnnotationsForPage(v.pageIdx);
    }
  }

  // ==========================================================================
  // WYSIWYG DIRECT INLINE TEXT EDITOR (Acrobat Pro Direct Edit Experience!)
  // ==========================================================================
  function samplePageBgColor(view, nx, ny) {
    try {
      const cv = view.pdfCanvas;
      if (!cv.width || !cv.height) return '#FFFFFF';
      const px = clamp(Math.floor(nx * cv.width) - 2, 0, cv.width - 1);
      const py = clamp(Math.floor(ny * cv.height) - 2, 0, cv.height - 1);
      const d = cv.getContext('2d').getImageData(px, py, 1, 1).data;
      // If sampled pixel is very dark (e.g. hit an ink edge), default cleanly to white paper
      if (d[0] + d[1] + d[2] < 160) return '#FFFFFF';
      return '#' + [d[0], d[1], d[2]].map((c) => c.toString(16).padStart(2, '0')).join('');
    } catch (_) {
      return '#FFFFFF';
    }
  }

  function openInlineEditor(opts) {
    commitInlineEditor(true);
    const view = state.pageViews[opts.pageIdx];
    if (!view) return;

    const ta = document.createElement('textarea');
    ta.className = 'inline-editor';
    ta.value = opts.initialText || '';
    ta.placeholder = 'Γράψε κείμενο… (Enter = OK)';
    ta.rows = Math.max(1, (opts.initialText || '').split('\n').length);

    const sf = view.stageW / REF_PAGE_WIDTH;
    const size = opts.size || state.strokeSize;
    const color = opts.color || state.color;
    const bold = opts.bold !== undefined ? opts.bold : state.textBold;
    const bg = opts.bg !== undefined ? opts.bg : (state.textBg ? '#FFFFFF' : null);

    ta.style.left = (opts.x * 100) + '%';
    ta.style.top = (opts.y * 100) + '%';
    ta.style.fontSize = Math.max(10, size * sf) + 'px';
    ta.style.fontWeight = bold ? '600' : '400';
    ta.style.color = color;
    ta.style.background = bg || 'rgba(255, 255, 255, 0.92)';

    const autoSize = () => {
      const lines = (ta.value || ta.placeholder).split('\n');
      const longest = Math.max(8, ...lines.map((l) => l.length));
      ta.style.width = Math.min(view.stageW - opts.x * view.stageW - 6, Math.max(110, longest * size * sf * 0.68 + 26)) + 'px';
      ta.style.height = 'auto';
      ta.style.height = Math.max(26, ta.scrollHeight + 2) + 'px';
    };

    ta.addEventListener('input', autoSize);
    ta.addEventListener('pointerdown', (e) => e.stopPropagation());
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        commitInlineEditor(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        commitInlineEditor(false);
      }
    });

    view.stageEl.appendChild(ta);
    state.inlineEditor = {
      el: ta,
      pageIdx: opts.pageIdx,
      existingId: opts.existingId || null,
      x: opts.x,
      y: opts.y,
      size,
      color,
      bold,
      bg,
      coverBox: opts.coverBox || null
    };

    if (opts.existingId) drawAnnotationsForPage(opts.pageIdx);
    autoSize();
    setTimeout(() => {
      ta.focus();
      if (opts.initialText) ta.select();
    }, 10);
  }

  function commitInlineEditor(save = true) {
    const ed = state.inlineEditor;
    if (!ed) return;
    const val = ed.el.value.trim();
    ed.el.remove();
    state.inlineEditor = null;

    if (save) {
      const list = getPageAnnos(ed.pageIdx);
      if (ed.existingId) {
        const idx = list.findIndex((x) => x.id === ed.existingId);
        if (idx >= 0) {
          pushUndo(ed.pageIdx);
          if (!val) {
            list.splice(idx, 1);
            if (state.selectedId === ed.existingId) { state.selectedId = null; el.btnDelSelected.hidden = true; }
          } else {
            list[idx].text = val;
            list[idx].size = ed.size;
            list[idx].color = ed.color;
            list[idx].bold = ed.bold;
            list[idx].bg = ed.bg;
          }
        }
      } else if (val) {
        pushUndo(ed.pageIdx);
        const item = {
          id: uid(),
          type: 'text',
          x: ed.x,
          y: ed.y,
          text: val,
          color: ed.color,
          size: ed.size,
          bold: ed.bold,
          bg: ed.bg,
          coverBox: ed.coverBox
        };
        list.push(item);
        state.selectedPageIdx = ed.pageIdx;
        state.selectedId = item.id;
        el.btnDelSelected.hidden = false;
      }
    }
    drawAnnotationsForPage(ed.pageIdx);
  }

  // ==========================================================================
  // STICKY NOTES & COMMENTS DRAWER
  // ==========================================================================
  function renderNotePinsForPage(pageIdx) {
    const view = state.pageViews[pageIdx];
    if (!view) return;
    view.pinLayer.innerHTML = '';
    const notes = getPageAnnos(pageIdx).filter((a) => a.type === 'note');
    notes.forEach((note, idx) => {
      const pin = document.createElement('button');
      pin.className = 'note-pin' + (note.id === state.activeNoteId ? ' active' : '');
      pin.style.left = (note.x * 100) + '%';
      pin.style.top = (note.y * 100) + '%';
      pin.textContent = String(idx + 1);
      pin.title = note.text;
      pin.addEventListener('click', (e) => {
        e.stopPropagation();
        state.activeNoteId = note.id;
        el.commentsRail.hidden = false;
        renderNotePinsForPage(pageIdx);
        refreshCommentsUI();
      });
      view.pinLayer.appendChild(pin);
    });
  }

  function refreshCommentsUI() {
    const all = [];
    for (let p = 0; p < state.annotations.length; p++) {
      for (const a of (state.annotations[p] || [])) {
        if (a.type === 'note') all.push({ page: p + 1, note: a });
      }
    }
    el.badgeComments.textContent = String(all.length);
    el.badgeComments.hidden = all.length === 0;

    if (!all.length) {
      el.commentsList.innerHTML = '<div class="comment-empty">Δεν υπάρχουν ακόμα σχόλια.<br>Επίλεξε <strong>Σχόλιο (N)</strong> και κάνε κλικ πάνω στη σελίδα.</div>';
      return;
    }

    el.commentsList.innerHTML = '';
    all.forEach(({ page, note }) => {
      const card = document.createElement('div');
      card.className = 'comment-card' + (note.id === state.activeNoteId ? ' active' : '');
      card.innerHTML = `
        <div class="comment-card-head">
          <span class="comment-page-tag">Σελίδα ${page}</span>
          <span>${note.created || ''}</span>
        </div>
        <div class="comment-body"></div>
        <div class="comment-card-acts">
          <button class="text-btn xs" data-act="edit">Επεξεργασία</button>
          <button class="text-btn xs" data-act="del" style="color:var(--danger)">Διαγραφή</button>
        </div>
      `;
      card.querySelector('.comment-body').textContent = note.text;
      card.addEventListener('click', (e) => {
        const act = e.target.closest('button')?.dataset?.act;
        if (act === 'edit') {
          e.stopPropagation();
          askPrompt('Επεξεργασία Σχολίου', note.text, (val) => {
            pushUndo(page - 1);
            note.text = val;
            refreshCommentsUI();
            renderNotePinsForPage(page - 1);
          });
          return;
        }
        if (act === 'del') {
          e.stopPropagation();
          pushUndo(page - 1);
          state.annotations[page - 1] = state.annotations[page - 1].filter((x) => x.id !== note.id);
          if (state.activeNoteId === note.id) state.activeNoteId = null;
          refreshCommentsUI();
          renderNotePinsForPage(page - 1);
          showToast('Διαγράφηκε το σχόλιο');
          return;
        }
        state.activeNoteId = note.id;
        goToPage(page, true);
        renderNotePinsForPage(page - 1);
        refreshCommentsUI();
      });
      el.commentsList.appendChild(card);
    });
  }

  // ==========================================================================
  // PER-PAGE POINTER INTERACTION (Select, Inline Edit, Draw, Move, Resize)
  // ==========================================================================
  function getNormPoint(view, e) {
    const rect = view.annoCanvas.getBoundingClientRect();
    return {
      x: clamp((e.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((e.clientY - rect.top) / rect.height, 0, 1)
    };
  }

  function hitTestResizeHandle(view, nx, ny, a) {
    if (!a || !isResizable(a)) return false;
    const cv = view.annoCanvas;
    const box = measureAnnoBox(cv.getContext('2d'), a, cv.width, cv.height);
    const px = nx * cv.width, py = ny * cv.height;
    const tol = Math.max(18, (cv.width / REF_PAGE_WIDTH) * 18);
    return Math.abs(px - (box.x + box.w)) <= tol && Math.abs(py - (box.y + box.h)) <= tol;
  }

  function hitTestAnno(view, nx, ny) {
    const cv = view.annoCanvas;
    const ctx = cv.getContext('2d');
    const px = nx * cv.width, py = ny * cv.height;
    const list = getPageAnnos(view.pageIdx);
    const pad = Math.max(8, (cv.width / REF_PAGE_WIDTH) * 8);
    for (let i = list.length - 1; i >= 0; i--) {
      const a = list[i];
      if (a.type === 'note') continue;
      const b = measureAnnoBox(ctx, a, cv.width, cv.height);
      if (px >= b.x - pad && px <= b.x + b.w + pad && py >= b.y - pad && py <= b.y + b.h + pad) return a;
    }
    return null;
  }

  function setTool(toolName) {
    commitInlineEditor(true);
    state.tool = toolName;
    el.toolStrip.querySelectorAll('.tool-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tool === toolName);
    });
    applyToolClassesToAllPages();

    if (toolName !== 'select') {
      const prevIdx = state.selectedPageIdx;
      state.selectedId = null;
      state.selectedPageIdx = -1;
      el.btnDelSelected.hidden = true;
      if (prevIdx >= 0) drawAnnotationsForPage(prevIdx);
    }

    if (toolName === 'sign') openSignModal();
    else if (toolName === 'stamp') openModal(el.modalStamp);
    else if (toolName === 'image') { el.fileInsertImg.value = ''; el.fileInsertImg.click(); }
    else if (toolName === 'text') showToast('Κάνε κλικ σε υπάρχον κείμενο για επεξεργασία ή σε κενό σημείο για νέο κείμενο', 2600);
  }

  function askPrompt(title, initialVal, cb) {
    el.lblPromptTitle.textContent = title;
    el.txtPromptInput.value = initialVal || '';
    state.promptCallback = cb;
    openModal(el.modalPrompt);
    setTimeout(() => { el.txtPromptInput.focus(); el.txtPromptInput.select(); }, 30);
  }

  function wireStagePointerEvents(view) {
    const stage = view.stageEl;

    stage.addEventListener('pointerdown', (e) => {
      if (!state.pdfDoc) return;
      if (e.target && e.target.closest && (e.target.closest('.note-pin') || e.target.closest('.inline-editor'))) return;
      if (state.spaceDown || e.button === 1) return;
      if (e.button && e.button !== 0) return;

      // Commit any open inline editor cleanly when clicking elsewhere on page
      if (state.inlineEditor) {
        commitInlineEditor(true);
        if (state.tool === 'select') return;
      }

      const pageIdx = view.pageIdx;
      state.currentPage = view.pageNum;
      el.inpPageNum.value = String(view.pageNum);
      highlightActiveThumb(view.pageNum);
      const pt = getNormPoint(view, e);

      if (state.tool === 'select') {
        const prevSelPage = state.selectedPageIdx;
        const currentSel = prevSelPage === pageIdx ? getPageAnnos(pageIdx).find((x) => x.id === state.selectedId) : null;
        if (currentSel && hitTestResizeHandle(view, pt.x, pt.y, currentSel)) {
          e.preventDefault();
          state.dragging = true;
          state.dragPageIdx = pageIdx;
          state.dragMode = 'resize';
          state.dragStartNorm = pt;
          state.dragOrigSnapshot = JSON.parse(JSON.stringify(currentSel));
          pushUndo(pageIdx);
          try { stage.setPointerCapture(e.pointerId); } catch (_) {}
          return;
        }

        const hit = hitTestAnno(view, pt.x, pt.y);
        state.selectedId = hit ? hit.id : null;
        state.selectedPageIdx = hit ? pageIdx : -1;
        el.btnDelSelected.hidden = !hit;
        if (prevSelPage >= 0 && prevSelPage !== pageIdx) drawAnnotationsForPage(prevSelPage);
        drawAnnotationsForPage(pageIdx);

        if (hit) {
          e.preventDefault();
          try { window.getSelection().removeAllRanges(); } catch (_) {}
          // Alt+Drag clones annotation cleanly (Illustrator/Acrobat workflow!)
          let targetAnno = hit;
          pushUndo(pageIdx);
          if (e.altKey) {
            const clone = JSON.parse(JSON.stringify(hit));
            clone.id = uid();
            getPageAnnos(pageIdx).push(clone);
            state.selectedId = clone.id;
            targetAnno = clone;
          }
          state.dragging = true;
          state.dragPageIdx = pageIdx;
          state.dragMode = 'move';
          state.dragStartNorm = pt;
          state.dragOrigSnapshot = JSON.parse(JSON.stringify(targetAnno));
          try { stage.setPointerCapture(e.pointerId); } catch (_) {}
        }
        return;
      }

      if (state.tool === 'text') {
        e.preventDefault();
        // 1. Check if clicking an existing placed text annotation -> edit inline immediately!
        const hitAnno = hitTestAnno(view, pt.x, pt.y);
        if (hitAnno && hitAnno.type === 'text') {
          openInlineEditor({
            pageIdx,
            existingId: hitAnno.id,
            initialText: hitAnno.text,
            x: hitAnno.x,
            y: hitAnno.y,
            size: hitAnno.size,
            color: hitAnno.color,
            bold: hitAnno.bold,
            bg: hitAnno.bg,
            coverBox: hitAnno.coverBox
          });
          return;
        }

        // 2. Acrobat Pro Magic: Click ANY existing PDF text span -> edit IN-PLACE with auto-sampled background cover!
        const pdfSpan = e.target && e.target.closest && e.target.closest('.text-layer span');
        if (pdfSpan && pdfSpan.textContent && pdfSpan.textContent.trim()) {
          const nx = parseFloat(pdfSpan.dataset.nx) || pt.x;
          const ny = parseFloat(pdfSpan.dataset.ny) || pt.y;
          const nw = parseFloat(pdfSpan.dataset.nw) || 0.12;
          const nh = parseFloat(pdfSpan.dataset.nh) || 0.025;
          const estFs = clamp(parseInt(pdfSpan.dataset.fs, 10) || state.strokeSize, 9, 64);
          const sampledBg = samplePageBgColor(view, nx, ny);
          openInlineEditor({
            pageIdx,
            initialText: pdfSpan.textContent,
            x: nx,
            y: ny,
            size: estFs,
            color: '#111827',
            bold: false,
            bg: sampledBg,
            coverBox: { x: nx, y: ny, w: nw, h: nh }
          });
          return;
        }

        // 3. Otherwise open crisp WYSIWYG inline text box right where user clicked!
        openInlineEditor({
          pageIdx,
          initialText: '',
          x: pt.x,
          y: pt.y,
          size: state.strokeSize,
          color: state.color,
          bold: state.textBold,
          bg: state.textBg ? '#FFFFFF' : null
        });
        return;
      }

      if (state.tool === 'note') {
        e.preventDefault();
        askPrompt('Νέο Σχόλιο (Sticky Note)', '', (val) => {
          pushUndo(pageIdx);
          const timeStr = new Date().toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' });
          const note = { id: uid(), type: 'note', x: pt.x, y: pt.y, text: val, created: timeStr };
          getPageAnnos(pageIdx).push(note);
          state.activeNoteId = note.id;
          if (window.innerWidth > 820) el.commentsRail.hidden = false;
          renderNotePinsForPage(pageIdx);
          refreshCommentsUI();
          showToast('Προστέθηκε σχόλιο στη σελίδα ' + (pageIdx + 1));
        });
        return;
      }

      if (state.tool === 'stamp' && state.pendingStamp) {
        e.preventDefault();
        pushUndo(pageIdx);
        const item = {
          id: uid(), type: 'stamp',
          x: clamp(pt.x - 0.12, 0.01, 0.74), y: clamp(pt.y - 0.034, 0.01, 0.92),
          w: 0.24, h: 0.068,
          text: state.pendingStamp.text, color: state.pendingStamp.color
        };
        getPageAnnos(pageIdx).push(item);
        setTool('select');
        state.selectedPageIdx = pageIdx;
        state.selectedId = item.id;
        el.btnDelSelected.hidden = false;
        drawAnnotationsForPage(pageIdx);
        return;
      }

      if (state.tool === 'sign' && state.pendingSignSrc) {
        e.preventDefault();
        placeImageOverlay(state.pendingSignSrc, 'sign', pt.x, pt.y, 0.24, pageIdx);
        return;
      }

      if (state.tool === 'image' && state.pendingImgSrc) {
        e.preventDefault();
        placeImageOverlay(state.pendingImgSrc, 'image', pt.x, pt.y, 0.30, pageIdx);
        return;
      }

      // Drag-drawing tools: whiteout, highlight, rect, arrow, pen
      e.preventDefault();
      state.dragging = true;
      state.dragPageIdx = pageIdx;
      state.dragMode = 'draw';
      const strokeW = Math.max(2, Math.round(state.strokeSize / 5));

      if (state.tool === 'pen') {
        state.draftAnno = { id: uid(), type: 'pen', color: state.color, stroke: strokeW, pts: [[pt.x, pt.y]] };
      } else if (state.tool === 'arrow') {
        state.draftAnno = { id: uid(), type: 'arrow', color: state.color, stroke: strokeW, x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y };
      } else {
        state.draftAnno = {
          id: uid(), type: state.tool,
          color: state.tool === 'whiteout' ? '#FFFFFF' : (state.tool === 'highlight' && state.color === '#DC2626' ? '#EAB308' : state.color),
          stroke: strokeW, x: pt.x, y: pt.y, w: 0, h: 0
        };
      }
      try { stage.setPointerCapture(e.pointerId); } catch (_) {}
      drawAnnotationsForPage(pageIdx);
    });

    stage.addEventListener('pointermove', (e) => {
      if (!state.dragging || state.dragPageIdx !== view.pageIdx) return;
      const pt = getNormPoint(view, e);

      if (state.dragMode === 'draw' && state.draftAnno) {
        if (state.draftAnno.type === 'pen') state.draftAnno.pts.push([pt.x, pt.y]);
        else if (state.draftAnno.type === 'arrow') { state.draftAnno.x2 = pt.x; state.draftAnno.y2 = pt.y; }
        else { state.draftAnno.w = pt.x - state.draftAnno.x; state.draftAnno.h = pt.y - state.draftAnno.y; }
        drawAnnotationsForPage(view.pageIdx);
        return;
      }

      const sel = getPageAnnos(view.pageIdx).find((x) => x.id === state.selectedId);
      if (!sel || !state.dragOrigSnapshot) return;
      const dx = pt.x - state.dragStartNorm.x;
      const dy = pt.y - state.dragStartNorm.y;

      if (state.dragMode === 'move') {
        if (sel.type === 'pen') {
          sel.pts = state.dragOrigSnapshot.pts.map(([px, py]) => [px + dx, py + dy]);
        } else if (sel.type === 'arrow') {
          sel.x1 = state.dragOrigSnapshot.x1 + dx; sel.y1 = state.dragOrigSnapshot.y1 + dy;
          sel.x2 = state.dragOrigSnapshot.x2 + dx; sel.y2 = state.dragOrigSnapshot.y2 + dy;
        } else {
          sel.x = state.dragOrigSnapshot.x + dx; sel.y = state.dragOrigSnapshot.y + dy;
        }
        drawAnnotationsForPage(view.pageIdx);
      } else if (state.dragMode === 'resize') {
        const orig = state.dragOrigSnapshot;
        if (sel.type === 'text') {
          const deltaPx = (dx + dy) * REF_PAGE_WIDTH * 0.45;
          sel.size = clamp(Math.round((orig.size || 16) + deltaPx), 8, 96);
        } else {
          const newW = Math.max(0.03, orig.w + dx);
          if (sel.type === 'sign' || sel.type === 'image') {
            sel.w = newW; sel.h = Math.max(0.02, newW * (orig.h / (orig.w || 0.01)));
          } else {
            sel.w = newW; sel.h = Math.max(0.015, orig.h + dy);
          }
        }
        drawAnnotationsForPage(view.pageIdx);
      }
    });

    const endPtr = (e) => {
      if (!state.dragging || state.dragPageIdx !== view.pageIdx) return;
      state.dragging = false;
      try { stage.releasePointerCapture(e.pointerId); } catch (_) {}

      if (state.dragMode === 'draw' && state.draftAnno) {
        const d = state.draftAnno;
        state.draftAnno = null;
        let valid = true;
        if (d.type === 'pen') valid = d.pts.length > 2;
        else if (d.type === 'arrow') valid = Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > 0.012;
        else {
          if (d.w < 0) { d.x += d.w; d.w = Math.abs(d.w); }
          if (d.h < 0) { d.y += d.h; d.h = Math.abs(d.h); }
          valid = d.w > 0.008 && d.h > 0.006;
        }
        if (valid) {
          pushUndo(view.pageIdx);
          getPageAnnos(view.pageIdx).push(d);
        }
        drawAnnotationsForPage(view.pageIdx);
      }
      state.dragMode = null;
      state.dragPageIdx = -1;
      state.dragOrigSnapshot = null;
    };
    stage.addEventListener('pointerup', endPtr);
    stage.addEventListener('pointercancel', endPtr);

    stage.addEventListener('dblclick', (e) => {
      if (!state.pdfDoc) return;
      const pt = getNormPoint(view, e);
      const hit = hitTestAnno(view, pt.x, pt.y);
      if (hit && hit.type === 'text') {
        openInlineEditor({
          pageIdx: view.pageIdx, existingId: hit.id, initialText: hit.text,
          x: hit.x, y: hit.y, size: hit.size, color: hit.color, bold: hit.bold, bg: hit.bg, coverBox: hit.coverBox
        });
      } else if (hit && hit.type === 'stamp') {
        askPrompt('Επεξεργασία Σφραγίδας', hit.text, (val) => {
          pushUndo(view.pageIdx);
          hit.text = val;
          drawAnnotationsForPage(view.pageIdx);
        });
      }
    });
  }

  async function placeImageOverlay(src, type, cx, cy, defaultW, pageIdx = state.currentPage - 1) {
    try {
      const img = await loadImageAsync(src);
      state.imgCache.set(src, img);
      const view = state.pageViews[pageIdx] || { baseW: state.pageBaseW, baseH: state.pageBaseH };
      const pageRatio = view.baseW / (view.baseH || 1);
      const w = defaultW;
      const h = w * (img.naturalHeight / (img.naturalWidth || 1)) * pageRatio;
      const item = {
        id: uid(), type, src,
        x: clamp(cx - w / 2, 0.01, 1 - w - 0.01),
        y: clamp(cy - h / 2, 0.01, 1 - h - 0.01),
        w, h
      };
      pushUndo(pageIdx);
      getPageAnnos(pageIdx).push(item);
      setTool('select');
      state.selectedPageIdx = pageIdx;
      state.selectedId = item.id;
      el.btnDelSelected.hidden = false;
      drawAnnotationsForPage(pageIdx);
      showToast('Σύρε για μετακίνηση ή τη γωνία για αλλαγή μεγέθους');
    } catch (_) {
      showToast('Αδυναμία φόρτωσης εικόνας.');
    }
  }

  function deleteSelected() {
    if (!state.selectedId || state.selectedPageIdx < 0) return;
    const idx = state.selectedPageIdx;
    pushUndo(idx);
    state.annotations[idx] = getPageAnnos(idx).filter((a) => a.id !== state.selectedId);
    state.selectedId = null;
    state.selectedPageIdx = -1;
    el.btnDelSelected.hidden = true;
    drawAnnotationsForPage(idx);
  }

  function undo() {
    commitInlineEditor(false);
    const idx = state.currentPage - 1;
    const stack = state.undoStack[idx];
    if (!stack || !stack.length) return;
    if (!state.redoStack[idx]) state.redoStack[idx] = [];
    state.redoStack[idx].push(clonePageAnnos(state.annotations[idx]));
    state.annotations[idx] = stack.pop();
    state.selectedId = null; state.selectedPageIdx = -1;
    el.btnDelSelected.hidden = true;
    drawAnnotationsForPage(idx);
    renderNotePinsForPage(idx);
    refreshCommentsUI();
    updateUndoButtons();
  }

  function redo() {
    commitInlineEditor(false);
    const idx = state.currentPage - 1;
    const stack = state.redoStack[idx];
    if (!stack || !stack.length) return;
    state.undoStack[idx].push(clonePageAnnos(state.annotations[idx]));
    state.annotations[idx] = stack.pop();
    state.selectedId = null; state.selectedPageIdx = -1;
    el.btnDelSelected.hidden = true;
    drawAnnotationsForPage(idx);
    renderNotePinsForPage(idx);
    refreshCommentsUI();
    updateUndoButtons();
  }

  // ==========================================================================
  // BULLETPROOF CROSS-SPAN GREEK CTRL+F SEARCH WITH AUTO-SCROLL TO MATCH!
  // ==========================================================================
  async function getPageSearchIndex(pageNum) {
    if (state.searchIndexCache.has(pageNum)) return state.searchIndexCache.get(pageNum);
    const page = await state.pdfDoc.getPage(pageNum);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();

    let fullNorm = '';
    const charBoxes = []; // 1 normalized box per char in fullNorm

    let prevRight = null, prevY = null;
    for (const it of tc.items) {
      if (!it.str) continue;
      const tx = window.pdfjsLib.Util.transform(vp.transform, it.transform);
      const fontH = Math.hypot(tx[2], tx[3]) || 12;
      const x = tx[4] / vp.width;
      const y = (tx[5] - fontH * 0.9) / vp.height;
      const w = (it.width || fontH * it.str.length * 0.5) / vp.width;
      const h = (fontH * 1.15) / vp.height;

      // Insert virtual space between items on new lines or wide horizontal gaps (preserves multi-word phrases!)
      if (fullNorm.length > 0 && !fullNorm.endsWith(' ')) {
        const newLine = prevY !== null && Math.abs(y - prevY) > h * 0.6;
        const wideGap = prevRight !== null && (x - prevRight) > (fontH / vp.width) * 0.22;
        if (newLine || wideGap) {
          fullNorm += ' ';
          charBoxes.push(null);
        }
      }

      const norm = normalizeGreek(it.str);
      const len = norm.length || 1;
      for (let ci = 0; ci < norm.length; ci++) {
        fullNorm += norm[ci];
        charBoxes.push({
          x: x + (w * ci) / len,
          y,
          w: Math.max(w / len, 0.004),
          h
        });
      }
      prevRight = x + w;
      prevY = y;
    }

    const entry = { fullNorm, charBoxes };
    state.searchIndexCache.set(pageNum, entry);
    return entry;
  }

  function mergeMatchBoxes(rawBoxes) {
    const valid = rawBoxes.filter(Boolean);
    if (!valid.length) return [];
    const merged = [{ ...valid[0] }];
    for (let i = 1; i < valid.length; i++) {
      const b = valid[i];
      const last = merged[merged.length - 1];
      if (Math.abs(b.y - last.y) <= Math.max(b.h, last.h) * 0.6) {
        const minX = Math.min(last.x, b.x);
        const maxX = Math.max(last.x + last.w, b.x + b.w);
        const minY = Math.min(last.y, b.y);
        const maxY = Math.max(last.y + last.h, b.y + b.h);
        last.x = minX; last.y = minY; last.w = maxX - minX; last.h = maxY - minY;
      } else {
        merged.push({ ...b });
      }
    }
    return merged;
  }

  async function runSearch(query) {
    const myVer = ++state.searchVersion;
    const q = normalizeGreek(query).replace(/\s+/g, ' ').trim();
    state.searchMatches = [];
    state.searchIdx = -1;

    if (!q || !state.pdfDoc) {
      el.lblSearchCount.textContent = '';
      redrawVisibleAnnotations();
      return;
    }

    el.lblSearchCount.textContent = 'Αναζήτηση…';
    const matches = [];
    for (let p = 1; p <= state.pageCount; p++) {
      if (myVer !== state.searchVersion) return; // superseded by newer typing!
      const idx = await getPageSearchIndex(p);
      let pos = 0;
      while ((pos = idx.fullNorm.indexOf(q, pos)) !== -1) {
        const boxes = mergeMatchBoxes(idx.charBoxes.slice(pos, pos + q.length));
        if (boxes.length) matches.push({ page: p, boxes });
        pos += Math.max(1, q.length);
      }
    }

    if (myVer !== state.searchVersion) return;
    state.searchMatches = matches;

    if (!matches.length) {
      el.lblSearchCount.textContent = '0 αποτελέσματα';
      redrawVisibleAnnotations();
      return;
    }

    // Prefer first match on or after current page
    let startIdx = matches.findIndex((m) => m.page >= state.currentPage);
    if (startIdx < 0) startIdx = 0;
    state.searchIdx = startIdx;
    await jumpToSearchMatch();
  }

  async function jumpToSearchMatch() {
    if (!state.searchMatches.length || state.searchIdx < 0) return;
    const m = state.searchMatches[state.searchIdx];
    el.lblSearchCount.textContent = `${state.searchIdx + 1} / ${state.searchMatches.length} · Σελ. ${m.page}`;

    const view = state.pageViews[m.page - 1];
    if (!view) return;

    state.currentPage = m.page;
    el.inpPageNum.value = String(m.page);
    highlightActiveThumb(m.page);

    // Smoothly scroll the exact matched word straight into the middle of the viewport!
    const box = m.boxes[0];
    const matchAbsY = getStageTopInDesk(view) + (box ? box.y * view.stageH : 0);
    const targetTop = Math.max(0, matchAbsY - el.deskViewport.clientHeight * 0.42);
    state.scrollSyncLock = true;
    el.deskViewport.scrollTo({ top: targetTop, behavior: 'smooth' });
    await ensurePageRendered(m.page);
    redrawVisibleAnnotations();
    setTimeout(() => { state.scrollSyncLock = false; }, 380);
  }

  // ==========================================================================
  // SIGNATURE PAD & SAVED SIGNATURES
  // ==========================================================================
  function openSignModal() { openModal(el.modalSign); clearSignPad(); renderSavedSigns(); }
  function clearSignPad() {
    el.signCanvas.getContext('2d').clearRect(0, 0, el.signCanvas.width, el.signCanvas.height);
    state.signHasInk = false;
  }
  function getSavedSigns() { try { return JSON.parse(localStorage.getItem(LS_SIGNS) || '[]'); } catch (_) { return []; } }
  function saveSignToStorage(url) {
    try { localStorage.setItem(LS_SIGNS, JSON.stringify([url, ...getSavedSigns().filter((s) => s !== url)].slice(0, 4))); } catch (_) {}
  }
  function renderSavedSigns() {
    el.savedSignsRow.innerHTML = '';
    getSavedSigns().forEach((src, i) => {
      const chip = document.createElement('div');
      chip.className = 'saved-sign-chip';
      chip.innerHTML = `<img src="${src}" alt="Υπογραφή" /><button class="saved-sign-del" title="Διαγραφή">✕</button>`;
      chip.addEventListener('click', (e) => {
        if (e.target.closest('.saved-sign-del')) {
          try { localStorage.setItem(LS_SIGNS, JSON.stringify(getSavedSigns().filter((_, idx) => idx !== i))); } catch (_) {}
          renderSavedSigns(); return;
        }
        state.pendingSignSrc = src;
        closeModal(el.modalSign);
        placeImageOverlay(src, 'sign', 0.5, 0.72, 0.24, state.currentPage - 1);
      });
      el.savedSignsRow.appendChild(chip);
    });
  }

  function cropSignatureCanvas(cv) {
    const { width, height } = cv;
    const data = cv.getContext('2d').getImageData(0, 0, width, height).data;
    let minX = width, minY = height, maxX = 0, maxY = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 12) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX <= minX || maxY <= minY) return null;
    const pad = 10, sx = Math.max(0, minX - pad), sy = Math.max(0, minY - pad);
    const sw = Math.min(width - sx, maxX - minX + pad * 2), sh = Math.min(height - sy, maxY - minY + pad * 2);
    const out = document.createElement('canvas');
    out.width = sw; out.height = sh;
    out.getContext('2d').drawImage(cv, sx, sy, sw, sh, 0, 0, sw, sh);
    return out.toDataURL('image/png');
  }

  // ==========================================================================
  // MULTI-IMAGE -> PDF WITH SIMULTANEOUS RESIZE
  // ==========================================================================
  const IMG_PRESETS = {
    small: { maxDim: 1200, quality: 0.72, bpp: 0.14 },
    medium: { maxDim: 1920, quality: 0.84, bpp: 0.23 },
    large: { maxDim: 3000, quality: 0.94, bpp: 0.38 },
    original: { maxDim: 0, quality: 0.98, bpp: 1.00 }
  };

  async function enqueueImagesForPdf(files) {
    const imgs = Array.from(files || []).filter((f) => /^image\//i.test(f.type) || /\.(jpe?g|png|webp|bmp|gif)$/i.test(f.name));
    if (!imgs.length) return;
    for (const file of imgs) {
      const url = URL.createObjectURL(file);
      try {
        const img = await loadImageAsync(url);
        state.imgQueue.push({ id: uid(), file, name: file.name, url, w: img.naturalWidth, h: img.naturalHeight, size: file.size });
      } catch (_) { URL.revokeObjectURL(url); }
    }
    renderImgQueue();
    openModal(el.modalImgPdf);
  }

  function estimatePresetBytes(presetKey) {
    const p = IMG_PRESETS[presetKey];
    let total = 18000;
    for (const item of state.imgQueue) {
      if (presetKey === 'original') total += item.size;
      else {
        const scale = p.maxDim > 0 ? Math.min(1, p.maxDim / Math.max(item.w, item.h)) : 1;
        total += Math.min(item.size, Math.max(25000, Math.round(item.w * scale) * Math.round(item.h * scale) * p.bpp));
      }
    }
    return total;
  }

  function renderImgQueue() {
    el.imgQueueList.innerHTML = '';
    const count = state.imgQueue.length;
    el.lblImgPdfMeta.textContent = count
      ? `${count} ${count === 1 ? 'εικόνα έτοιμη' : 'εικόνες έτοιμες'} — διάλεξε μέγεθος εξαγωγής:`
      : 'Πρόσθεσε εικόνες (JPG, PNG, WebP) για μετατροπή σε 1 PDF';
    el.btnBuildImgPdf.disabled = count === 0;

    state.imgQueue.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'img-row';
      row.innerHTML = `
        <img src="${item.url}" alt="" />
        <div class="img-row-info"><div class="img-row-name"></div><div class="img-row-dim">${item.w} × ${item.h} px · ${formatBytes(item.size)}</div></div>
        <div class="img-row-acts">
          <button class="icon-btn xs" data-act="up" title="Πάνω">↑</button>
          <button class="icon-btn xs" data-act="down" title="Κάτω">↓</button>
          <button class="icon-btn xs danger" data-act="del" title="Αφαίρεση">✕</button>
        </div>
      `;
      row.querySelector('.img-row-name').textContent = `${idx + 1}. ${item.name}`;
      row.addEventListener('click', (e) => {
        const act = e.target.closest('button')?.dataset?.act;
        if (!act) return;
        if (act === 'del') { URL.revokeObjectURL(item.url); state.imgQueue.splice(idx, 1); }
        else if (act === 'up' && idx > 0) [state.imgQueue[idx - 1], state.imgQueue[idx]] = [state.imgQueue[idx], state.imgQueue[idx - 1]];
        else if (act === 'down' && idx < state.imgQueue.length - 1) [state.imgQueue[idx + 1], state.imgQueue[idx]] = [state.imgQueue[idx], state.imgQueue[idx + 1]];
        renderImgQueue();
      });
      el.imgQueueList.appendChild(row);
    });

    ['small', 'medium', 'large', 'original'].forEach((k) => {
      const tag = el.imgSizeGrid.querySelector(`.est-tag[data-est="${k}"]`);
      if (tag) tag.textContent = count ? '~' + formatBytes(estimatePresetBytes(k)) : '~';
    });
  }

  async function buildPdfFromImageQueue() {
    if (!state.imgQueue.length) return;
    const preset = IMG_PRESETS[state.imgSizePreset] || IMG_PRESETS.medium;
    const layout = state.imgLayout;
    const origLabel = el.btnBuildImgPdf.textContent;
    el.btnBuildImgPdf.disabled = true;

    try {
      const pdfDoc = await window.PDFLib.PDFDocument.create();
      stampPdfMetadata(pdfDoc);

      for (let i = 0; i < state.imgQueue.length; i++) {
        const item = state.imgQueue[i];
        el.btnBuildImgPdf.textContent = `Εικόνα ${i + 1}/${state.imgQueue.length}…`;
        const img = await loadImageAsync(item.url);
        let tw = img.naturalWidth, th = img.naturalHeight, embeddedImg;

        if (state.imgSizePreset === 'original' && /^image\/(jpeg|jpg|png)$/i.test(item.file.type)) {
          const raw = new Uint8Array(await item.file.arrayBuffer());
          embeddedImg = /png$/i.test(item.file.type) ? await pdfDoc.embedPng(raw) : await pdfDoc.embedJpg(raw);
        } else {
          if (preset.maxDim > 0 && Math.max(tw, th) > preset.maxDim) {
            const s = preset.maxDim / Math.max(tw, th);
            tw = Math.max(1, Math.round(tw * s)); th = Math.max(1, Math.round(th * s));
          }
          const cv = document.createElement('canvas'); cv.width = tw; cv.height = th;
          const ctx = cv.getContext('2d', { alpha: false });
          ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, tw, th);
          ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, tw, th);
          const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', preset.quality));
          embeddedImg = await pdfDoc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
        }

        const iw = embeddedImg.width, ih = embeddedImg.height;
        let pw, ph, dw, dh, dx, dy;
        if (layout === 'fit') {
          const s = Math.min(1, 842 / Math.max(iw, ih));
          pw = Math.max(72, iw * s); ph = Math.max(72, ih * s);
          dw = pw; dh = ph; dx = 0; dy = 0;
        } else {
          pw = layout === 'a4l' ? 841.89 : 595.28; ph = layout === 'a4l' ? 595.28 : 841.89;
          const ratio = Math.min((pw - 40) / iw, (ph - 40) / ih);
          dw = iw * ratio; dh = ih * ratio; dx = (pw - dw) / 2; dy = (ph - dh) / 2;
        }
        pdfDoc.addPage([pw, ph]).drawImage(embeddedImg, { x: dx, y: dy, width: dw, height: dh });
      }

      const outBytes = await pdfDoc.save();
      const totalImgs = state.imgQueue.length;
      const baseName = state.imgQueue[0].name.replace(/\.[^.]+$/, '') + (totalImgs > 1 ? `_${totalImgs}imgs.pdf` : '.pdf');
      state.imgQueue.forEach((x) => URL.revokeObjectURL(x.url));
      state.imgQueue = [];
      closeModal(el.modalImgPdf);

      await loadPdfBytes(outBytes, baseName, { hasDiskPath: false, markDirty: true });
      showToast(`Έτοιμο PDF (${totalImgs} εικόνες · ${formatBytes(outBytes.byteLength)})`, 3600);
    } catch (err) {
      console.error('Images->PDF failed:', err);
      showToast('Σφάλμα κατά τη δημιουργία PDF από εικόνες.');
    } finally {
      el.btnBuildImgPdf.disabled = false;
      el.btnBuildImgPdf.textContent = origLabel;
    }
  }

  // ==========================================================================
  // SMART SAVE, COMPRESS, EXPORT IMAGES & PREPRESS INSPECTOR
  // ==========================================================================
  async function preloadAnnoImages(list) {
    const map = new Map();
    for (const a of list) {
      if ((a.type === 'sign' || a.type === 'image') && a.src && !map.has(a.src)) {
        try { map.set(a.src, await loadImageAsync(a.src)); } catch (_) {}
      }
    }
    return map;
  }

  async function buildVectorPdfBytes(opts = {}) {
    commitInlineEditor(true);
    const pdfDoc = await window.PDFLib.PDFDocument.load(state.pdfBytes);
    stampPdfMetadata(pdfDoc);
    const pages = pdfDoc.getPages();

    for (let i = 0; i < pages.length; i++) {
      if (opts.onlyPageIdx !== undefined && opts.onlyPageIdx !== i) continue;
      const list = state.annotations[i] || [];
      const hasDrawable = list.some((a) => a.type !== 'note' || opts.embedNotes)
        || !!(state.watermark && state.watermark.text) || !!state.pageNumbers;
      if (!hasDrawable) continue;

      const pg = pages[i];
      const { width, height } = pg.getSize();
      const rot = (pg.getRotation().angle || 0) % 360;
      const swapped = rot === 90 || rot === 270;
      const visW = swapped ? height : width, visH = swapped ? width : height;

      const scale = 2.5;
      const cv = document.createElement('canvas');
      cv.width = Math.round(visW * scale); cv.height = Math.round(visH * scale);
      const preloaded = await preloadAnnoImages(list);
      renderAnnoListToContext(cv.getContext('2d'), cv.width, cv.height, list, {
        embedNotes: !!opts.embedNotes, preloadedImages: preloaded, pageNum: i + 1, pageCount: pages.length
      });

      let finalCv = cv;
      if (rot !== 0) {
        finalCv = document.createElement('canvas');
        finalCv.width = Math.round(width * scale); finalCv.height = Math.round(height * scale);
        const rctx = finalCv.getContext('2d');
        rctx.translate(finalCv.width / 2, finalCv.height / 2);
        rctx.rotate((-rot * Math.PI) / 180);
        rctx.drawImage(cv, -cv.width / 2, -cv.height / 2);
      }

      const blob = await new Promise((r) => finalCv.toBlob(r, 'image/png'));
      const embedded = await pdfDoc.embedPng(new Uint8Array(await blob.arrayBuffer()));
      pg.drawImage(embedded, { x: 0, y: 0, width, height });
    }
    return await pdfDoc.save();
  }

  async function buildCompressedPdfBytes(mode, embedNotes) {
    commitInlineEditor(true);
    const cfg = { small: { dpi: 110, quality: 0.72 }, medium: { dpi: 150, quality: 0.82 }, large: { dpi: 240, quality: 0.90 } }[mode] || { dpi: 150, quality: 0.82 };
    const scale = cfg.dpi / 72;
    const outDoc = await window.PDFLib.PDFDocument.create();
    stampPdfMetadata(outDoc);

    for (let p = 1; p <= state.pageCount; p++) {
      el.btnConfirmSave.textContent = `Συμπίεση ${p}/${state.pageCount}…`;
      const page = await state.pdfDoc.getPage(p);
      const vp1 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale });
      const cv = document.createElement('canvas');
      cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      const ctx = cv.getContext('2d', { alpha: false });
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;

      const list = state.annotations[p - 1] || [];
      if (list.length || (state.watermark && state.watermark.text) || state.pageNumbers) {
        renderAnnoListToContext(ctx, cv.width, cv.height, list, {
          embedNotes, preloadedImages: await preloadAnnoImages(list), pageNum: p, pageCount: state.pageCount
        });
      }
      const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', cfg.quality));
      const img = await outDoc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      outDoc.addPage([vp1.width, vp1.height]).drawImage(img, { x: 0, y: 0, width: vp1.width, height: vp1.height });
    }
    return await outDoc.save();
  }

  async function deliverOutputBytes(bytes, fileName, forceSaveAs = false) {
    const safeName = ensurePdfExt(fileName);
    if (DESKTOP_MODE && SESSION_TOKEN) {
      const ep = (!forceSaveAs && state.hasDiskPath)
        ? `/api/save?t=${encodeURIComponent(SESSION_TOKEN)}`
        : `/api/saveas?t=${encodeURIComponent(SESSION_TOKEN)}&name=${encodeURIComponent(safeName)}`;
      const resp = await fetch(ep, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: bytes });
      if (!resp.ok) {
        const msg = await resp.text();
        if (resp.status === 204 || msg === 'CANCELLED') return false;
        throw new Error(msg || 'Save API error');
      }
      const savedName = resp.headers.get('X-Saved-Name');
      if (savedName) {
        state.fileName = decodeURIComponent(savedName);
        el.docFileName.textContent = state.fileName;
        state.hasDiskPath = true;
      }
      state.dirty = false;
      return true;
    }

    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = document.createElement('a'); a.href = url; a.download = safeName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    state.dirty = false;
    return true;
  }

  async function executeSave(forceSaveAs = false) {
    if (!state.pdfBytes) return;
    const origSize = state.pdfBytes.byteLength;
    const targetName = ensurePdfExt(el.inpSaveName.value || state.fileName);
    const embedNotes = !!el.chkEmbedNotes.checked;
    const origLabel = el.btnConfirmSave.textContent;
    el.btnConfirmSave.disabled = true; el.btnSaveAsDesktop.disabled = true;
    el.btnConfirmSave.textContent = 'Αποθήκευση…';
    try {
      const outBytes = state.saveMode === 'vector'
        ? await buildVectorPdfBytes({ embedNotes })
        : await buildCompressedPdfBytes(state.saveMode, embedNotes);
      if (await deliverOutputBytes(outBytes, targetName, forceSaveAs)) {
        closeModal(el.modalSave);
        const msg = state.saveMode === 'vector'
          ? `Αποθηκεύτηκε: ${targetName} (${formatBytes(outBytes.byteLength)})`
          : `Αποθηκεύτηκε: ${targetName} (${formatBytes(origSize)} → ${formatBytes(outBytes.byteLength)})`;
        showToast(msg, 3600); setStatus(msg);
      }
    } catch (err) {
      console.error('Save error:', err);
      showToast('Σφάλμα κατά την αποθήκευση PDF.');
    } finally {
      el.btnConfirmSave.disabled = false; el.btnSaveAsDesktop.disabled = false;
      el.btnConfirmSave.textContent = origLabel;
    }
  }

  async function exportPagesToImages(scope = 'current', fmt = 'png', dpi = 300) {
    commitInlineEditor(true);
    if (!state.pdfDoc) return;
    const pages = scope === 'all' ? Array.from({ length: state.pageCount }, (_, i) => i + 1) : [state.currentPage];
    const scale = clamp(dpi / 72, 1.0, 4.2);
    const mime = fmt === 'jpeg' ? 'image/jpeg' : 'image/png', ext = fmt === 'jpeg' ? 'jpg' : 'png';
    const base = state.fileName.replace(/\.pdf$/i, '');
    try {
      for (const p of pages) {
        const page = await state.pdfDoc.getPage(p);
        const vp = page.getViewport({ scale });
        const cv = document.createElement('canvas');
        cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
        const ctx = cv.getContext('2d', { alpha: false });
        ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, cv.width, cv.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const list = state.annotations[p - 1] || [];
        if (list.length || (state.watermark && state.watermark.text) || state.pageNumbers) {
          renderAnnoListToContext(ctx, cv.width, cv.height, list, {
            preloadedImages: await preloadAnnoImages(list), pageNum: p, pageCount: state.pageCount
          });
        }
        const a = document.createElement('a'); a.href = cv.toDataURL(mime, 0.92); a.download = `${base}_p${p}.${ext}`;
        document.body.appendChild(a); a.click(); a.remove();
        if (pages.length > 1) await new Promise((r) => setTimeout(r, 180));
      }
      showToast(pages.length > 1 ? `Εξήχθησαν ${pages.length} σελίδες (${ext.toUpperCase()} ${dpi} DPI)` : `Εξήχθη η σελίδα ${state.currentPage} (${ext.toUpperCase()})`);
    } catch (_) { showToast('Σφάλμα εξαγωγής εικόνας.'); }
  }

  function detectPaperFormat(wMm, hMm) {
    const lo = Math.min(wMm, hMm), hi = Math.max(wMm, hMm);
    const orient = wMm > hMm + 2 ? 'Οριζόντιο' : (hMm > wMm + 2 ? 'Κάθετο' : 'Τετράγωνο');
    for (const [name, pw, ph] of [['A3', 297, 420], ['A4', 210, 297], ['A5', 148, 210], ['A6', 105, 148], ['B5', 176, 250], ['US Letter', 215.9, 279.4]]) {
      if (Math.abs(lo - pw) <= 2.5 && Math.abs(hi - ph) <= 2.5) return `${name} · ${orient}`;
    }
    return `Custom · ${orient}`;
  }

  function openDocInfoModal() {
    if (!state.pdfDoc) return;
    const wMm = (state.pageBaseW * 25.4) / 72, hMm = (state.pageBaseH * 25.4) / 72;
    let totalAnnos = 0, totalNotes = 0;
    for (const list of state.annotations) for (const a of (list || [])) { if (a.type === 'note') totalNotes++; else totalAnnos++; }
    el.docSpecsGrid.innerHTML = `
      <div class="spec-box"><span>Διαστάσεις (mm)</span><strong>${wMm.toFixed(1)} × ${hMm.toFixed(1)} mm</strong></div>
      <div class="spec-box"><span>Μορφή / Προσανατολισμός</span><strong>${detectPaperFormat(wMm, hMm)}</strong></div>
      <div class="spec-box"><span>Εκατοστά (cm) &amp; Points</span><strong>${(wMm / 10).toFixed(1)} × ${(hMm / 10).toFixed(1)} cm · ${Math.round(state.pageBaseW)}×${Math.round(state.pageBaseH)} pt</strong></div>
      <div class="spec-box"><span>Αρχείο &amp; Σελίδες</span><strong>${state.pageCount} σελ. · ${formatBytes(state.pdfBytes.byteLength)}</strong></div>
      <div class="spec-box"><span>Επεξεργασίες / Σχόλια</span><strong>${totalAnnos} σημάνσεις · ${totalNotes} σχόλια</strong></div>
      <div class="spec-box"><span>Υδατογράφημα / Αρίθμηση</span><strong>${state.watermark ? 'Ενεργό' : 'Όχι'} / ${state.pageNumbers ? 'Ενεργή' : 'Όχι'}</strong></div>
    `;
    el.inpMetaTitle.value = (state.docMeta && state.docMeta.title) || '';
    el.inpMetaAuthor.value = (state.docMeta && state.docMeta.author) || BRAND_AUTHOR;
    openModal(el.modalDocInfo);
  }

  // ==========================================================================
  // DESKTOP LOOPBACK BRIDGE
  // ==========================================================================
  async function initDesktopBridge() {
    if (!DESKTOP_MODE || !SESSION_TOKEN) return;
    el.btnSaveAsDesktop.hidden = false;
    const ping = () => fetch(`/api/heartbeat?t=${encodeURIComponent(SESSION_TOKEN)}`, { method: 'POST', keepalive: true }).catch(() => {});
    ping(); setInterval(ping, 2500);
    window.addEventListener('beforeunload', () => { try { navigator.sendBeacon(`/api/bye?t=${encodeURIComponent(SESSION_TOKEN)}`); } catch (_) {} });
    try {
      const resp = await fetch(`/api/file?t=${encodeURIComponent(SESSION_TOKEN)}`);
      if (resp.status === 200) {
        const buf = await resp.arrayBuffer();
        const name = decodeURIComponent(resp.headers.get('X-File-Name') || 'document.pdf');
        if (buf.byteLength > 0) await loadPdfBytes(new Uint8Array(buf), name, { hasDiskPath: true });
      }
    } catch (_) {}
  }

  // ==========================================================================
  // EVENT WIRING
  // ==========================================================================
  function bindEvents() {
    try { applyTheme(localStorage.getItem(LS_THEME) || 'dark'); } catch (_) { applyTheme('dark'); }
    el.btnThemeToggle.addEventListener('click', () => applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light'));

    el.btnToggleThumbs.addEventListener('click', () => {
      if (!state.pdfDoc) return;
      el.thumbRail.hidden = !el.thumbRail.hidden;
      if (state.fitWidth) setTimeout(() => rescaleAllPagesForZoom(computeAutoFitZoom(state.pageBaseW, state.pageBaseH)), 60);
    });
    el.btnCloseThumbs.addEventListener('click', () => { el.thumbRail.hidden = true; });
    el.btnToggleComments.addEventListener('click', () => {
      el.commentsRail.hidden = !el.commentsRail.hidden;
      if (state.fitWidth) setTimeout(() => rescaleAllPagesForZoom(computeAutoFitZoom(state.pageBaseW, state.pageBaseH)), 60);
    });
    el.btnCloseComments.addEventListener('click', () => { el.commentsRail.hidden = true; });

    // Continuous scroll tracker!
    let scrollRaf = 0;
    el.deskViewport.addEventListener('scroll', () => {
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        syncCurrentPageFromScroll();
      });
    }, { passive: true });

    // Nav & Zoom
    el.btnPrevPage.addEventListener('click', () => goToPage(state.currentPage - 1, true));
    el.btnNextPage.addEventListener('click', () => goToPage(state.currentPage + 1, true));
    el.inpPageNum.addEventListener('change', () => goToPage(parseInt(el.inpPageNum.value, 10) || 1, true));
    el.btnZoomOut.addEventListener('click', () => { state.fitWidth = false; rescaleAllPagesForZoom(state.zoom - 0.15); });
    el.btnZoomIn.addEventListener('click', () => { state.fitWidth = false; rescaleAllPagesForZoom(state.zoom + 0.15); });
    el.btnZoomFit.addEventListener('click', () => { state.fitWidth = true; rescaleAllPagesForZoom(computeAutoFitZoom(state.pageBaseW, state.pageBaseH)); });

    let rzTimer = null;
    window.addEventListener('resize', () => {
      if (!state.pdfDoc || !state.fitWidth) return;
      clearTimeout(rzTimer);
      rzTimer = setTimeout(() => rescaleAllPagesForZoom(computeAutoFitZoom(state.pageBaseW, state.pageBaseH)), 120);
    });

    const triggerOpenPdf = () => { el.fileOpenPdf.value = ''; el.fileOpenPdf.click(); };
    const triggerImgsPdf = () => { el.fileImgsToPdf.value = ''; el.fileImgsToPdf.click(); };
    el.btnOpenPdf.addEventListener('click', triggerOpenPdf);
    el.btnEmptyOpenPdf.addEventListener('click', triggerOpenPdf);
    el.btnImgsToPdf.addEventListener('click', () => { if (state.imgQueue.length) openModal(el.modalImgPdf); else triggerImgsPdf(); });
    el.btnEmptyImgsPdf.addEventListener('click', triggerImgsPdf);
    el.btnEmptyBlank.addEventListener('click', createBlankA4Pdf);
    el.btnAddBlankPage.addEventListener('click', addBlankPage);

    const closeMoreMenu = () => { if (el.moreMenu) el.moreMenu.hidden = true; };
    el.btnMoreMenu.addEventListener('click', (e) => { e.stopPropagation(); el.moreMenu.hidden = !el.moreMenu.hidden; });
    document.addEventListener('click', (e) => { if (!el.moreMenu.hidden && !el.moreMenuWrap.contains(e.target)) closeMoreMenu(); });

    el.btnMergePdf.addEventListener('click', () => { closeMoreMenu(); el.fileMergePdf.value = ''; el.fileMergePdf.click(); });
    el.btnSplitPdf.addEventListener('click', () => {
      closeMoreMenu(); if (!state.pdfDoc) return;
      el.lblSplitMeta.textContent = `Έγγραφο ${state.pageCount} σελίδων — γράψε ποιες θες να εξάγεις`;
      el.inpSplitRange.value = state.pageCount > 1 ? `1-${state.pageCount}` : '1';
      openModal(el.modalSplit);
    });
    const mMerge = $('btnMobileMerge'), mSplit = $('btnMobileSplit');
    if (mMerge) mMerge.addEventListener('click', () => { el.thumbRail.hidden = true; el.btnMergePdf.click(); });
    if (mSplit) mSplit.addEventListener('click', () => { el.thumbRail.hidden = true; el.btnSplitPdf.click(); });
    el.btnConfirmSplit.addEventListener('click', splitAndDownload);

    el.btnWatermarkOpen.addEventListener('click', () => {
      closeMoreMenu(); if (!state.pdfDoc) return;
      if (state.watermark) { el.inpWmText.value = state.watermark.text; el.rngWmOpacity.value = String(state.watermark.opacity); el.lblWmOpacity.textContent = state.watermark.opacity + '%'; }
      openModal(el.modalWatermark);
    });
    el.btnPageNumsOpen.addEventListener('click', () => { closeMoreMenu(); if (state.pdfDoc) openModal(el.modalPageNums); });
    el.btnExportImgsOpen.addEventListener('click', () => {
      closeMoreMenu(); if (!state.pdfDoc) return;
      el.lblExportImgsMeta.textContent = `Σύνολο ${state.pageCount} ${state.pageCount === 1 ? 'σελίδα' : 'σελίδες'} — διάλεξε μορφή & DPI`;
      openModal(el.modalExportImgs);
    });
    el.btnDocInfoOpen.addEventListener('click', () => { closeMoreMenu(); openDocInfoModal(); });

    el.fileOpenPdf.addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (f) await loadPdfBytes(new Uint8Array(await f.arrayBuffer()), f.name, { hasDiskPath: false });
    });
    el.fileMergePdf.addEventListener('change', (e) => mergePdfFiles(Array.from(e.target.files || [])));
    el.fileImgsToPdf.addEventListener('change', (e) => enqueueImagesForPdf(e.target.files));
    el.fileInsertImg.addEventListener('change', (e) => {
      const f = e.target.files[0]; if (!f) { setTool('select'); return; }
      const r = new FileReader(); r.onload = () => { state.pendingImgSrc = r.result; placeImageOverlay(r.result, 'image', 0.5, 0.45, 0.32, state.currentPage - 1); };
      r.readAsDataURL(f);
    });

    // Global Drag & Drop
    let dragC = 0;
    window.addEventListener('dragenter', (e) => { e.preventDefault(); dragC++; el.dropTarget.classList.add('drop-active'); });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('dragleave', () => { dragC = Math.max(0, dragC - 1); if (dragC === 0) el.dropTarget.classList.remove('drop-active'); });
    window.addEventListener('drop', async (e) => {
      e.preventDefault(); dragC = 0; el.dropTarget.classList.remove('drop-active');
      const files = Array.from(e.dataTransfer?.files || []); if (!files.length) return;
      const pdfs = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
      const imgs = files.filter((f) => /^image\//i.test(f.type) || /\.(jpe?g|png|webp|bmp)$/i.test(f.name));
      if (imgs.length) await enqueueImagesForPdf(imgs);
      else if (pdfs.length) {
        await loadPdfBytes(new Uint8Array(await pdfs[0].arrayBuffer()), pdfs[0].name, { hasDiskPath: false });
        if (pdfs.length > 1) await mergePdfFiles(pdfs.slice(1));
      }
    });

    // Tool strip, Ink, Size, Bold (B), Backdrop (BG)
    el.toolStrip.querySelectorAll('.tool-btn').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
    el.inkPalette.querySelectorAll('.ink-dot').forEach((dot) => {
      dot.addEventListener('click', () => {
        state.color = dot.dataset.color;
        el.inkPalette.querySelectorAll('.ink-dot').forEach((d) => d.classList.toggle('active', d === dot));
        if (state.inlineEditor) { state.inlineEditor.color = state.color; state.inlineEditor.el.style.color = state.color; }
        if (state.selectedId && state.selectedPageIdx >= 0) {
          const sel = getPageAnnos(state.selectedPageIdx).find((x) => x.id === state.selectedId);
          if (sel && sel.color !== undefined) { pushUndo(state.selectedPageIdx); sel.color = state.color; drawAnnotationsForPage(state.selectedPageIdx); }
        }
      });
    });
    el.selStrokeSize.addEventListener('change', () => {
      state.strokeSize = parseInt(el.selStrokeSize.value, 10) || 16;
      if (state.inlineEditor) {
        const v = state.pageViews[state.inlineEditor.pageIdx];
        state.inlineEditor.size = state.strokeSize;
        if (v) state.inlineEditor.el.style.fontSize = Math.max(10, state.strokeSize * (v.stageW / REF_PAGE_WIDTH)) + 'px';
      }
      if (state.selectedId && state.selectedPageIdx >= 0) {
        const sel = getPageAnnos(state.selectedPageIdx).find((x) => x.id === state.selectedId);
        if (sel && sel.type === 'text') { pushUndo(state.selectedPageIdx); sel.size = state.strokeSize; drawAnnotationsForPage(state.selectedPageIdx); }
      }
    });
    el.btnTextBold.addEventListener('click', () => {
      state.textBold = !state.textBold;
      el.btnTextBold.classList.toggle('active', state.textBold);
      if (state.inlineEditor) { state.inlineEditor.bold = state.textBold; state.inlineEditor.el.style.fontWeight = state.textBold ? '600' : '400'; }
      if (state.selectedId && state.selectedPageIdx >= 0) {
        const sel = getPageAnnos(state.selectedPageIdx).find((x) => x.id === state.selectedId);
        if (sel && sel.type === 'text') { pushUndo(state.selectedPageIdx); sel.bold = state.textBold; drawAnnotationsForPage(state.selectedPageIdx); }
      }
    });
    el.btnTextBg.addEventListener('click', () => {
      state.textBg = !state.textBg;
      el.btnTextBg.classList.toggle('active', state.textBg);
      if (state.inlineEditor) { state.inlineEditor.bg = state.textBg ? '#FFFFFF' : null; state.inlineEditor.el.style.background = state.textBg ? '#FFFFFF' : 'rgba(255,255,255,0.92)'; }
      if (state.selectedId && state.selectedPageIdx >= 0) {
        const sel = getPageAnnos(state.selectedPageIdx).find((x) => x.id === state.selectedId);
        if (sel && sel.type === 'text') { pushUndo(state.selectedPageIdx); sel.bg = state.textBg ? '#FFFFFF' : null; drawAnnotationsForPage(state.selectedPageIdx); }
      }
    });

    el.btnUndo.addEventListener('click', undo);
    el.btnRedo.addEventListener('click', redo);
    el.btnDelSelected.addEventListener('click', deleteSelected);
    el.btnExportPng.addEventListener('click', () => exportPagesToImages('current', 'png', 220));
    el.btnPrint.addEventListener('click', async () => {
      // Ensure all pages are rendered before native browser Print!
      for (let p = 1; p <= state.pageCount; p++) await ensurePageRendered(p);
      window.print();
    });

    // Ctrl + Mouse Wheel Smooth Zoom (plain wheel scrolls seamlessly through ALL pages!)
    el.deskViewport.addEventListener('wheel', (e) => {
      if (!state.pdfDoc || (!e.ctrlKey && !e.metaKey)) return;
      e.preventDefault();
      state.fitWidth = false;
      rescaleAllPagesForZoom(state.zoom + (e.deltaY < 0 ? 0.12 : -0.12));
    }, { passive: false });

    // Space+Drag or Middle-Mouse Hand Pan
    el.deskViewport.addEventListener('pointerdown', (e) => {
      if (!state.pdfDoc) return;
      if (state.spaceDown || e.button === 1) {
        e.preventDefault();
        state.panActive = true;
        state.panStart = { x: e.clientX, y: e.clientY, sl: el.deskViewport.scrollLeft, st: el.deskViewport.scrollTop };
        el.deskViewport.classList.add('panning-active');
        try { el.deskViewport.setPointerCapture(e.pointerId); } catch (_) {}
      }
    });
    el.deskViewport.addEventListener('pointermove', (e) => {
      if (!state.panActive || !state.panStart) return;
      el.deskViewport.scrollLeft = state.panStart.sl - (e.clientX - state.panStart.x);
      el.deskViewport.scrollTop = state.panStart.st - (e.clientY - state.panStart.y);
    });
    const endPan = (e) => {
      if (!state.panActive) return;
      state.panActive = false; state.panStart = null;
      el.deskViewport.classList.remove('panning-active');
      try { el.deskViewport.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    el.deskViewport.addEventListener('pointerup', endPan);
    el.deskViewport.addEventListener('pointercancel', endPan);

    // Direct Ctrl+V Clipboard Image Paste
    window.addEventListener('paste', async (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const it = Array.from(e.clipboardData?.items || []).find((x) => x.type && x.type.startsWith('image/'));
      if (!it) return;
      const blob = it.getAsFile(); if (!blob) return;
      e.preventDefault();
      if (!state.pdfDoc) { await enqueueImagesForPdf([new File([blob], `clipboard_${Date.now()}.png`, { type: blob.type || 'image/png' })]); return; }
      const r = new FileReader();
      r.onload = () => { placeImageOverlay(r.result, 'image', 0.5, 0.45, 0.36, state.currentPage - 1); showToast('Επικολλήθηκε εικόνα από το πρόχειρο (Ctrl+V)'); };
      r.readAsDataURL(blob);
    });

    // Search bar (Ctrl+F)
    const openSearchBar = () => {
      if (!state.pdfDoc) return;
      el.searchBar.hidden = false;
      el.inpSearch.focus();
      el.inpSearch.select();
      if (el.inpSearch.value.trim()) runSearch(el.inpSearch.value);
    };
    el.btnSearchToggle.addEventListener('click', () => {
      if (el.searchBar.hidden) openSearchBar();
      else el.btnSearchClose.click();
    });
    el.btnSearchClose.addEventListener('click', () => {
      el.searchBar.hidden = true;
      state.searchMatches = []; state.searchIdx = -1;
      el.lblSearchCount.textContent = '';
      redrawVisibleAnnotations();
    });
    let searchDebounce = null;
    el.inpSearch.addEventListener('input', () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => runSearch(el.inpSearch.value), 160);
    });
    el.inpSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!state.searchMatches.length) { runSearch(el.inpSearch.value); return; }
        state.searchIdx = (state.searchIdx + (e.shiftKey ? -1 : 1) + state.searchMatches.length) % state.searchMatches.length;
        jumpToSearchMatch();
      } else if (e.key === 'Escape') {
        el.btnSearchClose.click();
      }
    });
    el.btnSearchNext.addEventListener('click', () => {
      if (!state.searchMatches.length) return;
      state.searchIdx = (state.searchIdx + 1) % state.searchMatches.length;
      jumpToSearchMatch();
    });
    el.btnSearchPrev.addEventListener('click', () => {
      if (!state.searchMatches.length) return;
      state.searchIdx = (state.searchIdx - 1 + state.searchMatches.length) % state.searchMatches.length;
      jumpToSearchMatch();
    });

    // Modals wiring
    el.btnAddMoreImgs.addEventListener('click', triggerImgsPdf);
    el.btnClearImgs.addEventListener('click', () => { state.imgQueue.forEach((x) => URL.revokeObjectURL(x.url)); state.imgQueue = []; renderImgQueue(); });
    el.imgSizeGrid.querySelectorAll('.size-card').forEach((c) => c.addEventListener('click', () => {
      state.imgSizePreset = c.dataset.size;
      el.imgSizeGrid.querySelectorAll('.size-card').forEach((x) => x.classList.toggle('active', x === c));
    }));
    el.imgLayoutRow.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => {
      state.imgLayout = b.dataset.layout;
      el.imgLayoutRow.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
    }));
    el.btnBuildImgPdf.addEventListener('click', buildPdfFromImageQueue);

    el.btnSaveOpen.addEventListener('click', () => {
      commitInlineEditor(true); if (!state.pdfBytes) return;
      el.inpSaveName.value = state.fileName;
      el.lblSaveMeta.textContent = `Τρέχον μέγεθος: ${formatBytes(state.pdfBytes.byteLength)} · ${state.pageCount} σελίδες`;
      el.btnSaveAsDesktop.hidden = !DESKTOP_MODE;
      openModal(el.modalSave);
    });
    el.pdfSaveSizeGrid.querySelectorAll('.size-card').forEach((c) => c.addEventListener('click', () => {
      state.saveMode = c.dataset.mode;
      el.pdfSaveSizeGrid.querySelectorAll('.size-card').forEach((x) => x.classList.toggle('active', x === c));
    }));
    el.btnConfirmSave.addEventListener('click', () => executeSave(false));
    el.btnSaveAsDesktop.addEventListener('click', () => executeSave(true));

    // Signature pad
    const sCtx = el.signCanvas.getContext('2d');
    const getSignPt = (e) => {
      const r = el.signCanvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (el.signCanvas.width / r.width), y: (e.clientY - r.top) * (el.signCanvas.height / r.height) };
    };
    el.signCanvas.addEventListener('pointerdown', (e) => { state.signDrawing = true; state.signHasInk = true; state.signLastPt = getSignPt(e); el.signCanvas.setPointerCapture(e.pointerId); });
    el.signCanvas.addEventListener('pointermove', (e) => {
      if (!state.signDrawing || !state.signLastPt) return;
      const pt = getSignPt(e);
      sCtx.strokeStyle = state.signInk; sCtx.lineWidth = 3.2; sCtx.lineCap = 'round'; sCtx.lineJoin = 'round';
      sCtx.beginPath(); sCtx.moveTo(state.signLastPt.x, state.signLastPt.y); sCtx.lineTo(pt.x, pt.y); sCtx.stroke();
      state.signLastPt = pt;
    });
    const endSign = () => { state.signDrawing = false; state.signLastPt = null; };
    el.signCanvas.addEventListener('pointerup', endSign);
    el.signCanvas.addEventListener('pointercancel', endSign);
    el.signInks.querySelectorAll('.ink-dot').forEach((d) => d.addEventListener('click', () => {
      state.signInk = d.dataset.color;
      el.signInks.querySelectorAll('.ink-dot').forEach((x) => x.classList.toggle('active', x === d));
    }));
    el.btnClearSign.addEventListener('click', clearSignPad);
    el.btnUploadSign.addEventListener('click', () => { el.fileSignImg.value = ''; el.fileSignImg.click(); });
    el.fileSignImg.addEventListener('change', (e) => {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader(); r.onload = () => { saveSignToStorage(r.result); closeModal(el.modalSign); placeImageOverlay(r.result, 'sign', 0.5, 0.72, 0.24, state.currentPage - 1); };
      r.readAsDataURL(f);
    });
    el.btnApplySign.addEventListener('click', () => {
      const png = cropSignatureCanvas(el.signCanvas); if (!png) { showToast('Σχεδίασε πρώτα την υπογραφή σου.'); return; }
      saveSignToStorage(png); closeModal(el.modalSign); placeImageOverlay(png, 'sign', 0.5, 0.72, 0.24, state.currentPage - 1);
    });

    el.stampGrid.querySelectorAll('.stamp-opt').forEach((b) => b.addEventListener('click', () => {
      state.pendingStamp = { text: b.dataset.text, color: b.dataset.color };
      closeModal(el.modalStamp); showToast('Κάνε κλικ στη σελίδα για να βάλεις τη σφραγίδα');
    }));
    el.btnUseCustomStamp.addEventListener('click', () => {
      const txt = el.inpCustomStamp.value.trim(); if (!txt) return;
      state.pendingStamp = { text: txt, color: state.color };
      closeModal(el.modalStamp); showToast('Κάνε κλικ στη σελίδα για να βάλεις τη σφραγίδα');
    });

    const commitPrompt = () => {
      const val = el.txtPromptInput.value.trim(); closeModal(el.modalPrompt);
      if (val && typeof state.promptCallback === 'function') state.promptCallback(val);
      state.promptCallback = null;
    };
    el.btnPromptOk.addEventListener('click', commitPrompt);
    el.txtPromptInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitPrompt(); } });

    el.wmColors.querySelectorAll('.ink-dot').forEach((d) => d.addEventListener('click', () => {
      state.wmColor = d.dataset.color;
      el.wmColors.querySelectorAll('.ink-dot').forEach((x) => x.classList.toggle('active', x === d));
    }));
    el.rngWmOpacity.addEventListener('input', () => { el.lblWmOpacity.textContent = el.rngWmOpacity.value + '%'; });
    el.wmStyleRow.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => {
      state.wmStyle = b.dataset.wmstyle;
      el.wmStyleRow.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
    }));
    el.btnApplyWatermark.addEventListener('click', () => {
      const text = el.inpWmText.value.trim(); if (!text) { showToast('Γράψε κείμενο για το υδατογράφημα.'); return; }
      state.watermark = { text, color: state.wmColor, opacity: parseInt(el.rngWmOpacity.value, 10) || 18, style: state.wmStyle };
      state.dirty = true; closeModal(el.modalWatermark); redrawVisibleAnnotations();
      showToast('Εφαρμόστηκε υδατογράφημα σε όλες τις σελίδες');
    });
    el.btnClearWatermark.addEventListener('click', () => { state.watermark = null; closeModal(el.modalWatermark); redrawVisibleAnnotations(); showToast('Αφαιρέθηκε το υδατογράφημα'); });

    el.pnPosRow.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => {
      state.pnPos = b.dataset.pos; el.pnPosRow.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
    }));
    el.pnFmtRow.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => {
      state.pnFmt = b.dataset.fmt; el.pnFmtRow.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
    }));
    el.btnApplyPageNums.addEventListener('click', () => {
      state.pageNumbers = { pos: state.pnPos, fmt: state.pnFmt }; state.dirty = true;
      closeModal(el.modalPageNums); redrawVisibleAnnotations(); showToast('Ενεργοποιήθηκε αρίθμηση σε όλες τις σελίδες');
    });
    el.btnClearPageNums.addEventListener('click', () => { state.pageNumbers = null; closeModal(el.modalPageNums); redrawVisibleAnnotations(); showToast('Αφαιρέθηκε η αρίθμηση σελίδων'); });

    el.expScopeRow.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => { state.expScope = b.dataset.scope; el.expScopeRow.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b)); }));
    el.expFmtRow.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => { state.expFmt = b.dataset.fmt; el.expFmtRow.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b)); }));
    el.expDpiRow.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => { state.expDpi = parseInt(b.dataset.dpi, 10) || 300; el.expDpiRow.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b)); }));
    el.btnConfirmExportImgs.addEventListener('click', async () => { closeModal(el.modalExportImgs); await exportPagesToImages(state.expScope, state.expFmt, state.expDpi); });

    el.btnSaveDocMeta.addEventListener('click', () => {
      state.docMeta = { title: el.inpMetaTitle.value.trim(), author: el.inpMetaAuthor.value.trim() || BRAND_AUTHOR };
      state.dirty = true; closeModal(el.modalDocInfo); showToast('Ενημερώθηκαν τα μεταδεδομένα (θα γραφτούν στην Αποθήκευση)');
    });

    document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal($(b.dataset.close))));
    document.querySelectorAll('.modal-backdrop').forEach((bd) => bd.addEventListener('click', (e) => { if (e.target === bd) closeModal(bd); }));

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space' && state.spaceDown) { state.spaceDown = false; el.deskViewport.classList.remove('panning'); }
    });
    window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });

    // Global Keyboard Shortcuts (capture phase + e.code so Ctrl+F/S/O/Z work on BOTH Greek & English keyboards!)
    window.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const mod = e.ctrlKey || e.metaKey;
      const k = (e.key || '').toLowerCase();

      if (mod && (e.code === 'KeyF' || k === 'f')) {
        e.preventDefault();
        openSearchBar();
        return;
      }
      if (e.key === 'F3' && state.pdfDoc) {
        e.preventDefault();
        if (el.searchBar.hidden) openSearchBar();
        else if (state.searchMatches.length) {
          state.searchIdx = (state.searchIdx + (e.shiftKey ? -1 : 1) + state.searchMatches.length) % state.searchMatches.length;
          jumpToSearchMatch();
        }
        return;
      }
      if (mod && (e.code === 'KeyS' || k === 's')) {
        e.preventDefault();
        if (state.pdfBytes) el.btnSaveOpen.click();
        return;
      }
      if (mod && (e.code === 'KeyO' || k === 'o')) {
        e.preventDefault(); triggerOpenPdf(); return;
      }
      if (mod && (e.code === 'KeyD' || k === 'd')) {
        e.preventDefault(); if (state.pdfDoc) openDocInfoModal(); return;
      }
      if (mod && (e.code === 'Digit0' || e.code === 'Numpad0' || k === '0')) {
        e.preventDefault(); if (state.pdfDoc) { state.fitWidth = true; rescaleAllPagesForZoom(computeAutoFitZoom(state.pageBaseW, state.pageBaseH)); } return;
      }
      if (mod && (e.code === 'Digit1' || e.code === 'Numpad1' || k === '1')) {
        e.preventDefault(); if (state.pdfDoc) { state.fitWidth = false; rescaleAllPagesForZoom(1.0); } return;
      }
      if (mod && (e.code === 'KeyZ' || k === 'z') && !typing) {
        e.preventDefault(); if (e.shiftKey) redo(); else undo(); return;
      }
      if (mod && (e.code === 'KeyY' || k === 'y') && !typing) {
        e.preventDefault(); redo(); return;
      }
      if (e.key === 'Escape') {
        commitInlineEditor(false);
        closeMoreMenu();
        document.querySelectorAll('.modal-backdrop:not([hidden])').forEach((m) => closeModal(m));
        if (!el.searchBar.hidden) el.btnSearchClose.click();
        setTool('select');
        return;
      }

      if (typing || !state.pdfDoc) return;

      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault(); state.spaceDown = true; el.deskViewport.classList.add('panning'); return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selectedId) { e.preventDefault(); deleteSelected(); }
      } else if (e.key === 'PageDown') {
        e.preventDefault(); goToPage(state.currentPage + 1, true);
      } else if (e.key === 'PageUp') {
        e.preventDefault(); goToPage(state.currentPage - 1, true);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault(); el.deskViewport.scrollBy({ top: 120, behavior: 'smooth' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault(); el.deskViewport.scrollBy({ top: -120, behavior: 'smooth' });
      } else if (e.key === 'Home') {
        e.preventDefault(); goToPage(1, true);
      } else if (e.key === 'End') {
        e.preventDefault(); goToPage(state.pageCount, true);
      } else if (!mod && !e.altKey) {
        const mapped = {
          KeyV: 'select', KeyT: 'text', KeyW: 'whiteout', KeyN: 'note',
          KeyH: 'highlight', KeyP: 'pen', KeyA: 'arrow', KeyR: 'rect',
          KeyS: 'sign', KeyM: 'stamp', KeyI: 'image'
        }[e.code];
        if (mapped) setTool(mapped);
      }
    }, true);
  }

  bindEvents();
  initDesktopBridge();
})();
