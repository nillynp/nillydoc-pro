/* ============================================================================
 * NillyDoc Pro — Acrobat-Style Minimal PDF Studio
 * created by Nilly graphics (Sotiris Christos) — https://nillygraphics.com/
 * 100% Offline Client-Side Engine (pdf.js + pdf-lib) · Desktop & Mobile PWA
 * ============================================================================ */

(function () {
  'use strict';

  const BRAND_AUTHOR = 'Nilly graphics (Sotiris Christos)';
  const BRAND_PRODUCER = 'NillyDoc Pro — created by Nilly graphics (Sotiris Christos) — https://nillygraphics.com/';
  const REF_PAGE_WIDTH = 794; // Reference px width for consistent font/stroke sizing
  const LS_THEME = 'nillydoc_theme';
  const LS_SIGNS = 'nillydoc_saved_signs';

  // Configure offline local pdf.js worker (0 external requests)
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js';
  }

  // Desktop loopback bridge params (?desktop=1&t=TOKEN)
  const urlParams = new URLSearchParams(window.location.search);
  const DESKTOP_MODE = urlParams.get('desktop') === '1';
  const SESSION_TOKEN = urlParams.get('t') || '';

  // ==========================================================================
  // APPLICATION STATE
  // ==========================================================================
  const state = {
    pdfBytes: null,          // Uint8Array (always clone via .slice() for pdf.js!)
    pdfDoc: null,            // pdf.js PDFDocumentProxy
    fileName: 'document.pdf',
    hasDiskPath: false,      // True when opened from a real Windows disk path
    pageCount: 0,
    currentPage: 1,          // 1-based
    zoom: 1,
    fitWidth: true,
    renderTask: null,
    pageBaseW: 595.28,       // PDF points at scale 1
    pageBaseH: 841.89,
    stageW: 595,             // CSS px width
    stageH: 842,             // CSS px height

    tool: 'select',
    color: '#DC2626',
    strokeSize: 16,
    textBg: false,           // Opaque white mask behind text (Acrobat cover+replace)
    watermark: null,         // { text, color, opacity, style } applied to ALL pages
    pageNumbers: null,       // { pos: 'left'|'center'|'right', fmt: 'of'|'num' } applied to ALL pages
    docMeta: { title: '', author: BRAND_AUTHOR },
    annotations: [],         // Array<Array<Anno>> indexed by 0..(pageCount-1)
    undoStack: [],           // Per-page undo snapshots
    redoStack: [],           // Per-page redo snapshots
    selectedId: null,
    activeNoteId: null,
    pendingStamp: null,      // { text, color }
    pendingSignSrc: null,    // DataURL
    pendingImgSrc: null,     // DataURL + aspect

    // Pan & Zoom ergonomics (Space+Drag / Middle-Click)
    spaceDown: false,
    panActive: false,
    panStart: null,

    // Export Images modal choices
    expScope: 'current',
    expFmt: 'png',
    expDpi: 300,

    // Watermark modal choices
    wmColor: '#64748B',
    wmStyle: 'diag',

    // Page numbers modal choices
    pnPos: 'center',
    pnFmt: 'of',

    // Pointer interaction
    dragging: false,
    dragMode: null,          // 'draw' | 'move' | 'resize'
    draftAnno: null,
    dragStartNorm: null,
    dragOrigSnapshot: null,

    // Search
    textCache: new Map(),    // pageNum -> Array<{ str, normStr, box }>
    searchMatches: [],       // Array<{ page, box }>
    searchIdx: -1,

    // Multi-Image -> PDF Queue
    imgQueue: [],            // Array<{ id, file, name, url, w, h, size }>
    imgSizePreset: 'medium',
    imgLayout: 'a4p',

    // Save modal
    saveMode: 'vector',

    // Signature pad
    signInk: '#111827',
    signDrawing: false,
    signHasInk: false,
    signLastPt: null,

    // Prompt callback
    promptCallback: null,
    imgCache: new Map(),     // src -> HTMLImageElement
    dirty: false
  };

  // ==========================================================================
  // DOM REFERENCES
  // ==========================================================================
  const $ = (id) => document.getElementById(id);
  const el = {
    btnToggleThumbs: $('btnToggleThumbs'),
    btnCloseThumbs: $('btnCloseThumbs'),
    btnHomeLogo: $('btnHomeLogo'),
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
    pageStage: $('pageStage'),
    pdfCanvas: $('pdfCanvas'),
    annoCanvas: $('annoCanvas'),
    textLayer: $('textLayer'),
    pinLayer: $('pinLayer'),
    commentsRail: $('commentsRail'),
    commentsList: $('commentsList'),
    statusText: $('statusText'),

    fileOpenPdf: $('fileOpenPdf'),
    fileMergePdf: $('fileMergePdf'),
    fileImgsToPdf: $('fileImgsToPdf'),
    fileInsertImg: $('fileInsertImg'),
    fileSignImg: $('fileSignImg'),

    // Modals
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

  function normalizeGreek(str) {
    return String(str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
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
    img.onload = () => drawAnnotations();
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

  function openModal(modalEl) {
    modalEl.hidden = false;
  }

  function closeModal(modalEl) {
    modalEl.hidden = true;
  }

  function clonePageAnnos(arr) {
    return JSON.parse(JSON.stringify(arr || []));
  }

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

  // ==========================================================================
  // THEME PERSISTENCE
  // ==========================================================================
  function applyTheme(theme) {
    const t = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'light' ? '#FFFFFF' : '#16171A');
    try { localStorage.setItem(LS_THEME, t); } catch (_) {}
  }

  // ==========================================================================
  // PDF LOADING & RENDERING
  // ==========================================================================
  async function loadPdfBytes(bytes, fileName, options = {}) {
    if (!window.pdfjsLib) {
      showToast('Σφάλμα: Δεν φορτώθηκε η μηχανή pdf.js');
      return;
    }
    try {
      setStatus('Φόρτωση PDF…');
      const copy = new Uint8Array(bytes);
      // ALWAYS pass a fresh slice so pdf.js worker transfer never detaches state.pdfBytes!
      const loadingTask = window.pdfjsLib.getDocument({ isEvalSupported: false, data: copy.slice() });
      const doc = await loadingTask.promise;

      state.pdfBytes = copy;
      state.pdfDoc = doc;
      state.fileName = ensurePdfExt(fileName || state.fileName);
      state.hasDiskPath = !!options.hasDiskPath;
      state.pageCount = doc.numPages;
      state.currentPage = clamp(options.keepPage || 1, 1, doc.numPages);
      state.selectedId = null;
      state.textCache.clear();
      state.searchMatches = [];
      state.searchIdx = -1;

      if (!options.keepAnnotations) {
        state.annotations = Array.from({ length: doc.numPages }, () => []);
        state.undoStack = Array.from({ length: doc.numPages }, () => []);
        state.redoStack = Array.from({ length: doc.numPages }, () => []);
        state.watermark = null;
        state.pageNumbers = null;
        state.dirty = !!options.markDirty;
      }

      // Extract existing PDF metadata for Prepress Inspector
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

      // Reveal editor UI
      el.emptyState.hidden = true;
      el.stageWrap.hidden = false;
      el.navControls.hidden = false;
      el.toolStrip.hidden = false;
      el.btnSearchToggle.hidden = false;
      el.btnToggleComments.hidden = false;
      el.moreMenuWrap.hidden = false;
      el.btnSaveOpen.hidden = false;

      if (window.innerWidth > 960 && state.pageCount > 1) {
        el.thumbRail.hidden = false;
      }

      el.docFileName.textContent = state.fileName;
      el.docFileName.title = state.fileName;
      document.title = state.fileName + ' — NillyDoc Pro';
      el.lblPageTotal.textContent = String(state.pageCount);
      el.inpPageNum.max = String(state.pageCount);

      await renderCurrentPage(true);
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

  function stampPdfMetadata(pdfLibDoc) {
    try {
      if (state.docMeta && state.docMeta.title) pdfLibDoc.setTitle(state.docMeta.title);
      pdfLibDoc.setAuthor((state.docMeta && state.docMeta.author) || BRAND_AUTHOR);
      pdfLibDoc.setCreator(BRAND_PRODUCER);
      pdfLibDoc.setProducer(BRAND_PRODUCER);
    } catch (_) {}
  }

  async function renderCurrentPage(recalcFit = false) {
    if (!state.pdfDoc) return;

    if (state.renderTask) {
      try { state.renderTask.cancel(); } catch (_) {}
      state.renderTask = null;
    }

    const page = await state.pdfDoc.getPage(state.currentPage);
    const baseVp = page.getViewport({ scale: 1 });
    state.pageBaseW = baseVp.width;
    state.pageBaseH = baseVp.height;

    if (state.fitWidth || recalcFit) {
      if (state.fitWidth) {
        const isMob = window.innerWidth <= 820;
        const pad = isMob ? 22 : 64;
        const availW = Math.max(280, el.deskViewport.clientWidth - pad);
        if (isMob) {
          state.zoom = clamp(availW / baseVp.width, 0.35, 2.0);
        } else {
          const availH = Math.max(360, el.deskViewport.clientHeight - 56);
          const fitPage = Math.min(availW / baseVp.width, availH / baseVp.height);
          // Comfortable prepress fit: shows whole page cleanly (capped at 1.25x for crisp editorial margins)
          state.zoom = clamp(Math.max(fitPage, Math.min(availW / baseVp.width, 1.0)), 0.45, 1.35);
        }
      }
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const cssVp = page.getViewport({ scale: state.zoom });
    const renderVp = page.getViewport({ scale: state.zoom * dpr });

    state.stageW = Math.round(cssVp.width);
    state.stageH = Math.round(cssVp.height);

    el.pageStage.style.width = state.stageW + 'px';
    el.pageStage.style.height = state.stageH + 'px';

    el.pdfCanvas.width = Math.round(renderVp.width);
    el.pdfCanvas.height = Math.round(renderVp.height);
    el.annoCanvas.width = Math.round(renderVp.width);
    el.annoCanvas.height = Math.round(renderVp.height);

    const ctx = el.pdfCanvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, el.pdfCanvas.width, el.pdfCanvas.height);

    const task = page.render({ canvasContext: ctx, viewport: renderVp });
    state.renderTask = task;
    try {
      await task.promise;
    } catch (e) {
      if (e && e.name !== 'RenderingCancelledException') console.error(e);
    }
    state.renderTask = null;

    el.inpPageNum.value = String(state.currentPage);
    el.lblZoom.textContent = Math.round(state.zoom * 100) + '%';

    // Update active thumbnail highlight
    el.thumbList.querySelectorAll('.thumb-item').forEach((node) => {
      node.classList.toggle('active', Number(node.dataset.page) === state.currentPage);
    });

    drawAnnotations();
    renderNotePins();
    renderTextLayer(page, cssVp);
    updateUndoButtons();
  }

  // Native Acrobat-Style Selectable PDF Text Layer (drag-select & Ctrl+C copy!)
  async function renderTextLayer(page, cssVp) {
    if (!el.textLayer) return;
    el.textLayer.innerHTML = '';
    el.textLayer.classList.toggle('selectable', state.tool === 'select');
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
        span.style.left = tx[4] + 'px';
        span.style.top = (tx[5] - fontH * 0.88) + 'px';
        span.style.fontSize = fontH + 'px';
        span.style.fontFamily = 'sans-serif';

        const targetW = (it.width || 0) * cssVp.scale;
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
      el.textLayer.appendChild(frag);
    } catch (_) {}
  }

  // ==========================================================================
  // THUMBNAILS & PAGE MANAGEMENT (Rotate, Delete, Reorder, Duplicate, Add)
  // ==========================================================================
  async function buildThumbnails() {
    el.thumbList.innerHTML = '';
    if (!state.pdfDoc) return;

    const total = state.pageCount;
    for (let p = 1; p <= total; p++) {
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
        goToPage(p);
        if (window.innerWidth <= 820) el.thumbRail.hidden = true;
      });

      el.thumbList.appendChild(item);

      // Render lightweight thumbnail asynchronously
      renderThumbCanvas(p, cv);
    }
  }

  async function renderThumbCanvas(pageNum, canvas) {
    try {
      if (!state.pdfDoc) return;
      const page = await state.pdfDoc.getPage(pageNum);
      const vp0 = page.getViewport({ scale: 1 });
      const scale = 150 / vp0.width;
      const vp = page.getViewport({ scale });
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
    } catch (_) {}
  }

  async function handlePageAction(pageNum, act) {
    const idx = pageNum - 1;
    if (!state.pdfBytes) return;

    try {
      let bytes = state.pdfBytes;
      // If rotating a page with annotations, bake that page's overlay first so it rotates cleanly!
      if (act === 'rot' && state.annotations[idx] && state.annotations[idx].length > 0) {
        bytes = await buildVectorPdfBytes({ onlyPageIdx: idx, embedNotes: false });
        state.annotations[idx] = [];
        state.undoStack[idx] = [];
        state.redoStack[idx] = [];
      }

      const srcDoc = await window.PDFLib.PDFDocument.load(bytes);
      const n = srcDoc.getPageCount();
      let newPage = state.currentPage;

      if (act === 'rot') {
        const pg = srcDoc.getPage(idx);
        const cur = pg.getRotation().angle || 0;
        pg.setRotation(window.PDFLib.degrees((cur + 90) % 360));
        stampPdfMetadata(srcDoc);
        const out = await srcDoc.save();
        await loadPdfBytes(out, state.fileName, {
          hasDiskPath: state.hasDiskPath,
          keepPage: pageNum,
          keepAnnotations: true,
          markDirty: true
        });
        showToast(`Περιστροφή σελίδας ${pageNum} (+90°)`);
        return;
      }

      if (act === 'del') {
        if (n <= 1) {
          showToast('Δεν μπορείς να διαγράψεις τη μοναδική σελίδα.');
          return;
        }
        srcDoc.removePage(idx);
        state.annotations.splice(idx, 1);
        state.undoStack.splice(idx, 1);
        state.redoStack.splice(idx, 1);
        newPage = clamp(state.currentPage > pageNum ? state.currentPage - 1 : state.currentPage, 1, n - 1);
        stampPdfMetadata(srcDoc);
        const out = await srcDoc.save();
        await loadPdfBytes(out, state.fileName, {
          hasDiskPath: state.hasDiskPath,
          keepPage: newPage,
          keepAnnotations: true,
          markDirty: true
        });
        showToast(`Διαγράφηκε η σελίδα ${pageNum}`);
        return;
      }

      if (act === 'up' || act === 'down') {
        const target = act === 'up' ? idx - 1 : idx + 1;
        if (target < 0 || target >= n) return;
        const order = Array.from({ length: n }, (_, i) => i);
        const tmp = order[idx];
        order[idx] = order[target];
        order[target] = tmp;

        const outDoc = await window.PDFLib.PDFDocument.create();
        const copied = await outDoc.copyPages(srcDoc, order);
        copied.forEach((p) => outDoc.addPage(p));
        stampPdfMetadata(outDoc);

        const tmpA = state.annotations[idx];
        state.annotations[idx] = state.annotations[target];
        state.annotations[target] = tmpA;
        const tmpU = state.undoStack[idx];
        state.undoStack[idx] = state.undoStack[target];
        state.undoStack[target] = tmpU;
        const tmpR = state.redoStack[idx];
        state.redoStack[idx] = state.redoStack[target];
        state.redoStack[target] = tmpR;

        const out = await outDoc.save();
        await loadPdfBytes(out, state.fileName, {
          hasDiskPath: state.hasDiskPath,
          keepPage: target + 1,
          keepAnnotations: true,
          markDirty: true
        });
        return;
      }

      if (act === 'dup') {
        const outDoc = await window.PDFLib.PDFDocument.create();
        const order = [];
        for (let i = 0; i < n; i++) {
          order.push(i);
          if (i === idx) order.push(i);
        }
        const copied = await outDoc.copyPages(srcDoc, order);
        copied.forEach((p) => outDoc.addPage(p));
        stampPdfMetadata(outDoc);

        state.annotations.splice(idx + 1, 0, clonePageAnnos(state.annotations[idx]));
        state.undoStack.splice(idx + 1, 0, []);
        state.redoStack.splice(idx + 1, 0, []);

        const out = await outDoc.save();
        await loadPdfBytes(out, state.fileName, {
          hasDiskPath: state.hasDiskPath,
          keepPage: pageNum + 1,
          keepAnnotations: true,
          markDirty: true
        });
        showToast(`Αντιγράφηκε η σελίδα ${pageNum}`);
      }
    } catch (err) {
      console.error('Page action failed:', err);
      showToast('Σφάλμα κατά την αλλαγή σελίδας.');
    }
  }

  async function addBlankPage() {
    if (!state.pdfBytes) {
      await createBlankA4Pdf();
      return;
    }
    const doc = await window.PDFLib.PDFDocument.load(state.pdfBytes);
    doc.addPage([595.28, 841.89]);
    stampPdfMetadata(doc);
    state.annotations.push([]);
    state.undoStack.push([]);
    state.redoStack.push([]);
    const out = await doc.save();
    await loadPdfBytes(out, state.fileName, {
      hasDiskPath: state.hasDiskPath,
      keepPage: doc.getPageCount(),
      keepAnnotations: true,
      markDirty: true
    });
    showToast('Προστέθηκε κενή σελίδα A4');
  }

  async function mergePdfFiles(files) {
    if (!files || !files.length || !state.pdfBytes) return;
    try {
      setStatus('Ένωση PDF…');
      const baseDoc = await window.PDFLib.PDFDocument.load(state.pdfBytes);
      let addedPages = 0;
      for (const f of files) {
        const buf = await f.arrayBuffer();
        const other = await window.PDFLib.PDFDocument.load(buf);
        const indices = other.getPageIndices();
        const copied = await baseDoc.copyPages(other, indices);
        copied.forEach((p) => {
          baseDoc.addPage(p);
          state.annotations.push([]);
          state.undoStack.push([]);
          state.redoStack.push([]);
          addedPages++;
        });
      }
      stampPdfMetadata(baseDoc);
      const out = await baseDoc.save();
      await loadPdfBytes(out, state.fileName, {
        hasDiskPath: state.hasDiskPath,
        keepPage: state.currentPage,
        keepAnnotations: true,
        markDirty: true
      });
      showToast(`Ενώθηκαν +${addedPages} σελίδες στο PDF`);
    } catch (err) {
      console.error('Merge failed:', err);
      showToast('Αδυναμία ένωσης του PDF.');
    }
  }

  function parsePageRanges(expr, maxPage) {
    const out = [];
    const seen = new Set();
    const parts = String(expr || '').split(/[,;\s]+/).filter(Boolean);
    for (const part of parts) {
      const m = part.match(/^(\d+)(?:-(\d+))?$/);
      if (!m) continue;
      let a = parseInt(m[1], 10);
      let b = m[2] ? parseInt(m[2], 10) : a;
      if (a > b) { const t = a; a = b; b = t; }
      for (let p = Math.max(1, a); p <= Math.min(maxPage, b); p++) {
        if (!seen.has(p)) { seen.add(p); out.push(p - 1); }
      }
    }
    return out;
  }

  async function splitAndDownload() {
    if (!state.pdfBytes) return;
    const indices = parsePageRanges(el.inpSplitRange.value, state.pageCount);
    if (!indices.length) {
      showToast('Δώσε έγκυρες σελίδες, π.χ. 1-3, 5');
      return;
    }
    try {
      const bakedBytes = await buildVectorPdfBytes({ embedNotes: false });
      const src = await window.PDFLib.PDFDocument.load(bakedBytes);
      const outDoc = await window.PDFLib.PDFDocument.create();
      const copied = await outDoc.copyPages(src, indices);
      copied.forEach((p) => outDoc.addPage(p));
      stampPdfMetadata(outDoc);
      const bytes = await outDoc.save();
      const base = state.fileName.replace(/\.pdf$/i, '');
      const outName = `${base}_pages.pdf`;
      closeModal(el.modalSplit);
      await deliverOutputBytes(bytes, outName, true);
      showToast(`Εξήχθησαν ${indices.length} σελίδες (${formatBytes(bytes.byteLength)})`);
    } catch (err) {
      console.error('Split failed:', err);
      showToast('Σφάλμα κατά την εξαγωγή σελίδων.');
    }
  }

  function goToPage(num) {
    if (!state.pdfDoc) return;
    const clamped = clamp(Math.round(num), 1, state.pageCount);
    if (clamped === state.currentPage) return;
    state.currentPage = clamped;
    state.selectedId = null;
    el.btnDelSelected.hidden = true;
    renderCurrentPage(false);
    refreshCommentsUI();
  }

  // ==========================================================================
  // ANNOTATIONS ENGINE (100% Unicode Greek + High-DPI Render for Screen & PDF)
  // ==========================================================================
  function getPageAnnos(pageIdx = state.currentPage - 1) {
    if (!state.annotations[pageIdx]) state.annotations[pageIdx] = [];
    return state.annotations[pageIdx];
  }

  function measureAnnoBox(ctx, a, W, H) {
    const sf = W / REF_PAGE_WIDTH;
    if (a.type === 'text') {
      const fs = (a.size || 16) * sf;
      ctx.save();
      ctx.font = `600 ${fs}px "Segoe UI", -apple-system, Arial, sans-serif`;
      const lines = String(a.text || '').split('\n');
      let maxW = 40 * sf;
      for (const ln of lines) maxW = Math.max(maxW, ctx.measureText(ln).width);
      ctx.restore();
      const lh = fs * 1.28;
      return {
        x: a.x * W,
        y: a.y * H,
        w: maxW + 10 * sf,
        h: Math.max(lh, lines.length * lh) + 4 * sf
      };
    }
    if (a.type === 'stamp') {
      const w = (a.w || 0.24) * W;
      const h = (a.h || 0.068) * H;
      return { x: a.x * W, y: a.y * H, w, h };
    }
    if (a.type === 'whiteout' || a.type === 'rect' || a.type === 'highlight' || a.type === 'sign' || a.type === 'image') {
      const x = Math.min(a.x, a.x + a.w) * W;
      const y = Math.min(a.y, a.y + a.h) * H;
      const w = Math.abs(a.w) * W;
      const h = Math.abs(a.h) * H;
      return { x, y, w: Math.max(w, 8), h: Math.max(h, 8) };
    }
    if (a.type === 'arrow') {
      const x1 = a.x1 * W, y1 = a.y1 * H, x2 = a.x2 * W, y2 = a.y2 * H;
      return {
        x: Math.min(x1, x2) - 8 * sf,
        y: Math.min(y1, y2) - 8 * sf,
        w: Math.abs(x2 - x1) + 16 * sf,
        h: Math.abs(y2 - y1) + 16 * sf
      };
    }
    if (a.type === 'pen' && a.pts && a.pts.length) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const pt of a.pts) {
        minX = Math.min(minX, pt[0] * W);
        minY = Math.min(minY, pt[1] * H);
        maxX = Math.max(maxX, pt[0] * W);
        maxY = Math.max(maxY, pt[1] * H);
      }
      const pad = 8 * sf;
      return { x: minX - pad, y: minY - pad, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 };
    }
    return { x: 0, y: 0, w: 0, h: 0 };
  }

  function renderAnnoListToContext(ctx, W, H, list, opts = {}) {
    const sf = W / REF_PAGE_WIDTH;

    for (const a of list) {
      if (a.type === 'note') {
        if (opts.embedNotes) {
          drawEmbeddedStickyNote(ctx, a, W, H, sf);
        }
        continue;
      }

      ctx.save();
      if (a.type === 'whiteout') {
        const bx = Math.min(a.x, a.x + a.w) * W;
        const by = Math.min(a.y, a.y + a.h) * H;
        const bw = Math.abs(a.w) * W;
        const bh = Math.abs(a.h) * H;
        ctx.fillStyle = a.color === '#111827' ? '#111827' : '#FFFFFF';
        ctx.fillRect(bx, by, bw, bh);
      } else if (a.type === 'highlight') {
        const bx = Math.min(a.x, a.x + a.w) * W;
        const by = Math.min(a.y, a.y + a.h) * H;
        const bw = Math.abs(a.w) * W;
        const bh = Math.abs(a.h) * H;
        ctx.globalAlpha = 0.34;
        ctx.fillStyle = a.color || '#EAB308';
        ctx.fillRect(bx, by, bw, bh);
      } else if (a.type === 'rect') {
        const bx = Math.min(a.x, a.x + a.w) * W;
        const by = Math.min(a.y, a.y + a.h) * H;
        const bw = Math.abs(a.w) * W;
        const bh = Math.abs(a.h) * H;
        ctx.strokeStyle = a.color || '#DC2626';
        ctx.lineWidth = Math.max(1.5, (a.stroke || 3) * sf);
        ctx.strokeRect(bx, by, bw, bh);
      } else if (a.type === 'arrow') {
        const x1 = a.x1 * W, y1 = a.y1 * H, x2 = a.x2 * W, y2 = a.y2 * H;
        const lw = Math.max(2, (a.stroke || 3) * sf);
        ctx.strokeStyle = a.color || '#DC2626';
        ctx.fillStyle = a.color || '#DC2626';
        ctx.lineWidth = lw;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        const angle = Math.atan2(y2 - y1, x2 - x1);
        const head = Math.max(11 * sf, lw * 4.2);
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6.5), y2 - head * Math.sin(angle - Math.PI / 6.5));
        ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6.5), y2 - head * Math.sin(angle + Math.PI / 6.5));
        ctx.closePath();
        ctx.fill();
      } else if (a.type === 'pen' && a.pts && a.pts.length > 1) {
        ctx.strokeStyle = a.color || '#DC2626';
        ctx.lineWidth = Math.max(1.5, (a.stroke || 3) * sf);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(a.pts[0][0] * W, a.pts[0][1] * H);
        for (let i = 1; i < a.pts.length; i++) {
          ctx.lineTo(a.pts[i][0] * W, a.pts[i][1] * H);
        }
        ctx.stroke();
      } else if (a.type === 'text') {
        const fs = (a.size || 16) * sf;
        ctx.font = `600 ${fs}px "Segoe UI", -apple-system, Arial, sans-serif`;
        ctx.textBaseline = 'top';
        const lines = String(a.text || '').split('\n');
        const lh = fs * 1.28;
        if (a.bg) {
          let maxW = 20 * sf;
          for (const ln of lines) maxW = Math.max(maxW, ctx.measureText(ln).width);
          ctx.fillStyle = a.bg;
          ctx.fillRect(a.x * W - 2 * sf, a.y * H - 1 * sf, maxW + 12 * sf, lines.length * lh + 6 * sf);
        }
        ctx.fillStyle = a.color || '#111827';
        lines.forEach((ln, i) => {
          ctx.fillText(ln, a.x * W + 3 * sf, a.y * H + i * lh + 2 * sf);
        });
      } else if (a.type === 'stamp') {
        const bx = a.x * W, by = a.y * H;
        const bw = (a.w || 0.24) * W, bh = (a.h || 0.068) * H;
        const col = a.color || '#059669';
        ctx.translate(bx + bw / 2, by + bh / 2);
        ctx.rotate(-0.075);
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        ctx.lineWidth = Math.max(2, 2.8 * sf);
        ctx.globalAlpha = 0.88;
        ctx.strokeRect(-bw / 2, -bh / 2, bw, bh);
        ctx.lineWidth = Math.max(1, 1 * sf);
        ctx.strokeRect(-bw / 2 + 3.5 * sf, -bh / 2 + 3.5 * sf, bw - 7 * sf, bh - 7 * sf);
        const fontPx = Math.min(bh * 0.46, (bw * 0.84) / Math.max(4, String(a.text || '').length * 0.65));
        ctx.font = `800 ${fontPx}px "Segoe UI", Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(a.text || '').toUpperCase(), 0, 1 * sf);
      } else if ((a.type === 'sign' || a.type === 'image') && a.src) {
        const img = opts.preloadedImages ? opts.preloadedImages.get(a.src) : getCachedImage(a.src);
        if (img && img.complete && img.naturalWidth > 0) {
          const bx = Math.min(a.x, a.x + a.w) * W;
          const by = Math.min(a.y, a.y + a.h) * H;
          const bw = Math.abs(a.w) * W;
          const bh = Math.abs(a.h) * H;
          ctx.drawImage(img, bx, by, bw, bh);
        }
      }
      ctx.restore();
    }

    // Draw Document-wide Watermark (all pages)
    if (state.watermark && state.watermark.text) {
      drawDocumentWatermark(ctx, W, H, sf, state.watermark);
    }

    // Draw Document-wide Page Numbers (all pages)
    if (state.pageNumbers && opts.pageNum) {
      drawDocumentPageNumber(ctx, W, H, sf, state.pageNumbers, opts.pageNum, opts.pageCount || state.pageCount);
    }

    // Draw search highlights on screen
    if (opts.drawSearch && state.searchMatches.length) {
      state.searchMatches.forEach((m, i) => {
        if (m.page !== state.currentPage) return;
        ctx.save();
        ctx.fillStyle = i === state.searchIdx ? 'rgba(245, 158, 11, 0.55)' : 'rgba(250, 204, 21, 0.30)';
        ctx.strokeStyle = i === state.searchIdx ? '#D97706' : 'transparent';
        ctx.lineWidth = 2 * sf;
        const rx = m.box.x * W, ry = m.box.y * H, rw = m.box.w * W, rh = m.box.h * H;
        ctx.fillRect(rx, ry, rw, rh);
        if (i === state.searchIdx) ctx.strokeRect(rx, ry, rw, rh);
        ctx.restore();
      });
    }

    // Draw selection frame + bottom-right resize handle
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
          ctx.fillStyle = '#2563EB';
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 1.6 * sf;
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
    const maxW = 196 * sf;
    const fs = 11.5 * sf;
    ctx.save();
    ctx.font = `500 ${fs}px "Segoe UI", Arial, sans-serif`;
    const words = String(note.text || '').split(/\s+/);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w;
      if (ctx.measureText(test).width > maxW - 16 * sf && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);
    const bh = Math.max(30 * sf, lines.length * (fs * 1.35) + 14 * sf);
    ctx.fillStyle = '#FEF3C7';
    ctx.strokeStyle = '#D97706';
    ctx.lineWidth = 1.5 * sf;
    ctx.fillRect(px, py, maxW, bh);
    ctx.strokeRect(px, py, maxW, bh);
    ctx.fillStyle = '#111827';
    ctx.textBaseline = 'top';
    lines.forEach((ln, i) => ctx.fillText(ln, px + 8 * sf, py + 7 * sf + i * fs * 1.35));
    ctx.restore();
  }

  function drawDocumentWatermark(ctx, W, H, sf, wm) {
    ctx.save();
    ctx.globalAlpha = clamp((wm.opacity || 18) / 100, 0.05, 0.65);
    ctx.fillStyle = wm.color || '#64748B';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const txt = String(wm.text || '');

    if (wm.style === 'tile') {
      const fs = 22 * sf;
      ctx.font = `700 ${fs}px "Segoe UI", Arial, sans-serif`;
      const stepX = Math.max(220 * sf, ctx.measureText(txt).width + 72 * sf);
      const stepY = 150 * sf;
      ctx.translate(W / 2, H / 2);
      ctx.rotate(-Math.PI / 5);
      for (let y = -H; y <= H; y += stepY) {
        for (let x = -W; x <= W; x += stepX) {
          ctx.fillText(txt, x, y);
        }
      }
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
    const fs = 12 * sf;
    const marginX = 36 * sf;
    const y = H - 24 * sf;
    ctx.save();
    ctx.font = `600 ${fs}px "Segoe UI", Arial, sans-serif`;
    ctx.fillStyle = '#475569';
    ctx.textBaseline = 'middle';
    if (pn.pos === 'left') {
      ctx.textAlign = 'left';
      ctx.fillText(label, marginX, y);
    } else if (pn.pos === 'right') {
      ctx.textAlign = 'right';
      ctx.fillText(label, W - marginX, y);
    } else {
      ctx.textAlign = 'center';
      ctx.fillText(label, W / 2, y);
    }
    ctx.restore();
  }

  function isResizable(a) {
    return ['whiteout', 'rect', 'highlight', 'sign', 'image', 'stamp'].includes(a.type);
  }

  function drawAnnotations() {
    const cv = el.annoCanvas;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!state.pdfDoc) return;

    const list = getPageAnnos().slice();
    if (state.draftAnno) list.push(state.draftAnno);
    renderAnnoListToContext(ctx, cv.width, cv.height, list, {
      selectedId: state.selectedId,
      drawSearch: true,
      embedNotes: false,
      pageNum: state.currentPage,
      pageCount: state.pageCount
    });
  }

  // ==========================================================================
  // STICKY NOTES & COMMENTS DRAWER
  // ==========================================================================
  function renderNotePins() {
    el.pinLayer.innerHTML = '';
    if (!state.pdfDoc) return;
    const notes = getPageAnnos().filter((a) => a.type === 'note');
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
        renderNotePins();
        refreshCommentsUI();
      });
      el.pinLayer.appendChild(pin);
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
            renderNotePins();
          });
          return;
        }
        if (act === 'del') {
          e.stopPropagation();
          pushUndo(page - 1);
          state.annotations[page - 1] = state.annotations[page - 1].filter((x) => x.id !== note.id);
          if (state.activeNoteId === note.id) state.activeNoteId = null;
          refreshCommentsUI();
          renderNotePins();
          showToast('Διαγράφηκε το σχόλιο');
          return;
        }
        state.activeNoteId = note.id;
        if (state.currentPage !== page) goToPage(page);
        else { renderNotePins(); refreshCommentsUI(); }
      });

      el.commentsList.appendChild(card);
    });
  }

  // ==========================================================================
  // POINTER INTERACTION (Unified Mouse, Stylus & Touch)
  // ==========================================================================
  function getNormPoint(e) {
    const rect = el.annoCanvas.getBoundingClientRect();
    return {
      x: clamp((e.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((e.clientY - rect.top) / rect.height, 0, 1)
    };
  }

  function hitTestResizeHandle(nx, ny, a) {
    if (!a || !isResizable(a)) return false;
    const cv = el.annoCanvas;
    const ctx = cv.getContext('2d');
    const box = measureAnnoBox(ctx, a, cv.width, cv.height);
    const px = nx * cv.width, py = ny * cv.height;
    const hx = box.x + box.w, hy = box.y + box.h;
    const tol = Math.max(18, (cv.width / REF_PAGE_WIDTH) * 18);
    return Math.abs(px - hx) <= tol && Math.abs(py - hy) <= tol;
  }

  function hitTestAnno(nx, ny) {
    const cv = el.annoCanvas;
    const ctx = cv.getContext('2d');
    const px = nx * cv.width, py = ny * cv.height;
    const list = getPageAnnos();
    const pad = Math.max(8, (cv.width / REF_PAGE_WIDTH) * 8);

    for (let i = list.length - 1; i >= 0; i--) {
      const a = list[i];
      if (a.type === 'note') continue;
      const b = measureAnnoBox(ctx, a, cv.width, cv.height);
      if (px >= b.x - pad && px <= b.x + b.w + pad && py >= b.y - pad && py <= b.y + b.h + pad) {
        return a;
      }
    }
    return null;
  }

  function setTool(toolName) {
    state.tool = toolName;
    el.toolStrip.querySelectorAll('.tool-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tool === toolName);
    });

    el.annoCanvas.classList.remove('drawing-mode', 'text-mode', 'move-mode');
    if (toolName === 'select') el.annoCanvas.classList.add('move-mode');
    else if (toolName === 'text' || toolName === 'note') el.annoCanvas.classList.add('text-mode');
    else el.annoCanvas.classList.add('drawing-mode');

    if (el.textLayer) {
      el.textLayer.classList.toggle('selectable', toolName === 'select');
    }

    if (toolName !== 'select') {
      state.selectedId = null;
      el.btnDelSelected.hidden = true;
      drawAnnotations();
    }

    if (toolName === 'sign') {
      openSignModal();
    } else if (toolName === 'stamp') {
      openModal(el.modalStamp);
    } else if (toolName === 'image') {
      el.fileInsertImg.value = '';
      el.fileInsertImg.click();
    }
  }

  function askPrompt(title, initialVal, cb) {
    el.lblPromptTitle.textContent = title;
    el.txtPromptInput.value = initialVal || '';
    state.promptCallback = cb;
    openModal(el.modalPrompt);
    setTimeout(() => {
      el.txtPromptInput.focus();
      el.txtPromptInput.select();
    }, 30);
  }

  function onStagePointerDown(e) {
    if (!state.pdfDoc) return;
    if (e.target && e.target.closest && e.target.closest('.note-pin')) return;
    if (state.spaceDown || e.button === 1) return; // Handled by desk hand-pan
    if (e.button && e.button !== 0) return;

    const pt = getNormPoint(e);
    const pageIdx = state.currentPage - 1;

    if (state.tool === 'select') {
      const currentSel = getPageAnnos().find((x) => x.id === state.selectedId);
      if (currentSel && hitTestResizeHandle(pt.x, pt.y, currentSel)) {
        e.preventDefault();
        state.dragging = true;
        state.dragMode = 'resize';
        state.dragStartNorm = pt;
        state.dragOrigSnapshot = JSON.parse(JSON.stringify(currentSel));
        pushUndo(pageIdx);
        try { el.pageStage.setPointerCapture(e.pointerId); } catch (_) {}
        return;
      }

      const hit = hitTestAnno(pt.x, pt.y);
      state.selectedId = hit ? hit.id : null;
      el.btnDelSelected.hidden = !hit;
      drawAnnotations();

      if (hit) {
        e.preventDefault();
        try { window.getSelection().removeAllRanges(); } catch (_) {}
        state.dragging = true;
        state.dragMode = 'move';
        state.dragStartNorm = pt;
        state.dragOrigSnapshot = JSON.parse(JSON.stringify(hit));
        pushUndo(pageIdx);
        try { el.pageStage.setPointerCapture(e.pointerId); } catch (_) {}
      }
      // If no annotation hit, let browser natively select & copy PDF text from #textLayer!
      return;
    }

    if (state.tool === 'text') {
      askPrompt('Προσθήκη Κειμένου (Ελληνικά & Αγγλικά)', '', (val) => {
        pushUndo(pageIdx);
        const item = {
          id: uid(),
          type: 'text',
          x: pt.x,
          y: pt.y,
          text: val,
          color: state.color,
          size: state.strokeSize,
          bg: state.textBg ? '#FFFFFF' : null
        };
        getPageAnnos().push(item);
        setTool('select');
        state.selectedId = item.id;
        el.btnDelSelected.hidden = false;
        drawAnnotations();
      });
      return;
    }

    if (state.tool === 'note') {
      askPrompt('Νέο Σχόλιο (Sticky Note)', '', (val) => {
        pushUndo(pageIdx);
        const now = new Date();
        const timeStr = now.toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' });
        const note = {
          id: uid(),
          type: 'note',
          x: pt.x,
          y: pt.y,
          text: val,
          created: timeStr
        };
        getPageAnnos().push(note);
        state.activeNoteId = note.id;
        if (window.innerWidth > 820) el.commentsRail.hidden = false;
        renderNotePins();
        refreshCommentsUI();
        showToast('Προστέθηκε σχόλιο στη σελίδα ' + state.currentPage);
      });
      return;
    }

    if (state.tool === 'stamp' && state.pendingStamp) {
      pushUndo(pageIdx);
      const item = {
        id: uid(),
        type: 'stamp',
        x: clamp(pt.x - 0.12, 0.01, 0.74),
        y: clamp(pt.y - 0.034, 0.01, 0.92),
        w: 0.24,
        h: 0.068,
        text: state.pendingStamp.text,
        color: state.pendingStamp.color
      };
      getPageAnnos().push(item);
      setTool('select');
      state.selectedId = item.id;
      el.btnDelSelected.hidden = false;
      drawAnnotations();
      return;
    }

    if (state.tool === 'sign' && state.pendingSignSrc) {
      placeImageOverlay(state.pendingSignSrc, 'sign', pt.x, pt.y, 0.24);
      return;
    }

    if (state.tool === 'image' && state.pendingImgSrc) {
      placeImageOverlay(state.pendingImgSrc, 'image', pt.x, pt.y, 0.30);
      return;
    }

    // Drag-drawing tools: whiteout, highlight, rect, arrow, pen
    state.dragging = true;
    state.dragMode = 'draw';
    const strokeW = Math.max(2, Math.round(state.strokeSize / 5));

    if (state.tool === 'pen') {
      state.draftAnno = {
        id: uid(),
        type: 'pen',
        color: state.color,
        stroke: strokeW,
        pts: [[pt.x, pt.y]]
      };
    } else if (state.tool === 'arrow') {
      state.draftAnno = {
        id: uid(),
        type: 'arrow',
        color: state.color,
        stroke: strokeW,
        x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y
      };
    } else {
      state.draftAnno = {
        id: uid(),
        type: state.tool, // whiteout | highlight | rect
        color: state.tool === 'whiteout' ? '#FFFFFF' : (state.tool === 'highlight' && state.color === '#DC2626' ? '#EAB308' : state.color),
        stroke: strokeW,
        x: pt.x, y: pt.y, w: 0, h: 0
      };
    }

    try { el.pageStage.setPointerCapture(e.pointerId); } catch (_) {}
    drawAnnotations();
  }

  function onStagePointerMove(e) {
    if (!state.dragging) return;
    const pt = getNormPoint(e);

    if (state.dragMode === 'draw' && state.draftAnno) {
      if (state.draftAnno.type === 'pen') {
        state.draftAnno.pts.push([pt.x, pt.y]);
      } else if (state.draftAnno.type === 'arrow') {
        state.draftAnno.x2 = pt.x;
        state.draftAnno.y2 = pt.y;
      } else {
        state.draftAnno.w = pt.x - state.draftAnno.x;
        state.draftAnno.h = pt.y - state.draftAnno.y;
      }
      drawAnnotations();
      return;
    }

    const sel = getPageAnnos().find((x) => x.id === state.selectedId);
    if (!sel || !state.dragOrigSnapshot) return;
    const dx = pt.x - state.dragStartNorm.x;
    const dy = pt.y - state.dragStartNorm.y;

    if (state.dragMode === 'move') {
      if (sel.type === 'pen') {
        sel.pts = state.dragOrigSnapshot.pts.map(([px, py]) => [px + dx, py + dy]);
      } else if (sel.type === 'arrow') {
        sel.x1 = state.dragOrigSnapshot.x1 + dx;
        sel.y1 = state.dragOrigSnapshot.y1 + dy;
        sel.x2 = state.dragOrigSnapshot.x2 + dx;
        sel.y2 = state.dragOrigSnapshot.y2 + dy;
      } else {
        sel.x = state.dragOrigSnapshot.x + dx;
        sel.y = state.dragOrigSnapshot.y + dy;
      }
      drawAnnotations();
    } else if (state.dragMode === 'resize') {
      const orig = state.dragOrigSnapshot;
      const newW = Math.max(0.03, orig.w + dx);
      if (sel.type === 'sign' || sel.type === 'image') {
        const aspect = orig.h / (orig.w || 0.01);
        sel.w = newW;
        sel.h = Math.max(0.02, newW * aspect);
      } else {
        sel.w = newW;
        sel.h = Math.max(0.015, orig.h + dy);
      }
      drawAnnotations();
    }
  }

  function onStagePointerUp(e) {
    if (!state.dragging) return;
    state.dragging = false;
    try { el.pageStage.releasePointerCapture(e.pointerId); } catch (_) {}

    if (state.dragMode === 'draw' && state.draftAnno) {
      const d = state.draftAnno;
      state.draftAnno = null;
      const pageIdx = state.currentPage - 1;
      let valid = true;

      if (d.type === 'pen') valid = d.pts.length > 2;
      else if (d.type === 'arrow') valid = Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > 0.012;
      else {
        if (d.w < 0) { d.x += d.w; d.w = Math.abs(d.w); }
        if (d.h < 0) { d.y += d.h; d.h = Math.abs(d.h); }
        valid = d.w > 0.008 && d.h > 0.006;
      }

      if (valid) {
        pushUndo(pageIdx);
        getPageAnnos().push(d);
      }
      drawAnnotations();
    }

    state.dragMode = null;
    state.dragOrigSnapshot = null;
  }

  function onStageDblClick(e) {
    if (!state.pdfDoc) return;
    const pt = getNormPoint(e);
    const hit = hitTestAnno(pt.x, pt.y);
    if (!hit) return;
    if (hit.type === 'text' || hit.type === 'stamp') {
      askPrompt(hit.type === 'stamp' ? 'Επεξεργασία Σφραγίδας' : 'Επεξεργασία Κειμένου', hit.text, (val) => {
        pushUndo(state.currentPage - 1);
        hit.text = val;
        drawAnnotations();
      });
    }
  }

  async function placeImageOverlay(src, type, cx, cy, defaultW) {
    try {
      const img = await loadImageAsync(src);
      state.imgCache.set(src, img);
      const pageRatio = state.pageBaseW / (state.pageBaseH || 1);
      const imgRatio = img.naturalHeight / (img.naturalWidth || 1);
      const w = defaultW;
      const h = w * imgRatio * pageRatio;
      const item = {
        id: uid(),
        type,
        src,
        x: clamp(cx - w / 2, 0.01, 1 - w - 0.01),
        y: clamp(cy - h / 2, 0.01, 1 - h - 0.01),
        w,
        h
      };
      pushUndo(state.currentPage - 1);
      getPageAnnos().push(item);
      setTool('select');
      state.selectedId = item.id;
      el.btnDelSelected.hidden = false;
      drawAnnotations();
      showToast('Σύρε για μετακίνηση ή τη γωνία για αλλαγή μεγέθους');
    } catch (_) {
      showToast('Αδυναμία φόρτωσης εικόνας.');
    }
  }

  function deleteSelected() {
    if (!state.selectedId) return;
    const idx = state.currentPage - 1;
    pushUndo(idx);
    state.annotations[idx] = getPageAnnos().filter((a) => a.id !== state.selectedId);
    state.selectedId = null;
    el.btnDelSelected.hidden = true;
    drawAnnotations();
  }

  function undo() {
    const idx = state.currentPage - 1;
    const stack = state.undoStack[idx];
    if (!stack || !stack.length) return;
    if (!state.redoStack[idx]) state.redoStack[idx] = [];
    state.redoStack[idx].push(clonePageAnnos(state.annotations[idx]));
    state.annotations[idx] = stack.pop();
    state.selectedId = null;
    el.btnDelSelected.hidden = true;
    drawAnnotations();
    renderNotePins();
    refreshCommentsUI();
    updateUndoButtons();
  }

  function redo() {
    const idx = state.currentPage - 1;
    const stack = state.redoStack[idx];
    if (!stack || !stack.length) return;
    state.undoStack[idx].push(clonePageAnnos(state.annotations[idx]));
    state.annotations[idx] = stack.pop();
    state.selectedId = null;
    el.btnDelSelected.hidden = true;
    drawAnnotations();
    renderNotePins();
    refreshCommentsUI();
    updateUndoButtons();
  }

  // ==========================================================================
  // FULL-TEXT SEARCH (Greek Accent-Insensitive!)
  // ==========================================================================
  async function runSearch(query) {
    const q = normalizeGreek(query).trim();
    state.searchMatches = [];
    state.searchIdx = -1;
    if (!q || !state.pdfDoc) {
      el.lblSearchCount.textContent = '';
      drawAnnotations();
      return;
    }

    for (let p = 1; p <= state.pageCount; p++) {
      let items = state.textCache.get(p);
      if (!items) {
        const page = await state.pdfDoc.getPage(p);
        const vp = page.getViewport({ scale: 1 });
        const tc = await page.getTextContent();
        items = tc.items.map((it) => {
          const tx = window.pdfjsLib.Util.transform(vp.transform, it.transform);
          const fontH = Math.hypot(tx[2], tx[3]) || 12;
          const x = tx[4] / vp.width;
          const y = (tx[5] - fontH) / vp.height;
          const w = (it.width || fontH * it.str.length * 0.5) / vp.width;
          const h = (fontH * 1.15) / vp.height;
          return { normStr: normalizeGreek(it.str), box: { x, y, w, h } };
        });
        state.textCache.set(p, items);
      }
      for (const it of items) {
        if (it.normStr.includes(q)) {
          state.searchMatches.push({ page: p, box: it.box });
        }
      }
    }

    if (!state.searchMatches.length) {
      el.lblSearchCount.textContent = '0 αποτελέσματα';
      drawAnnotations();
      return;
    }

    state.searchIdx = 0;
    jumpToSearchMatch();
  }

  function jumpToSearchMatch() {
    if (!state.searchMatches.length) return;
    const m = state.searchMatches[state.searchIdx];
    el.lblSearchCount.textContent = `${state.searchIdx + 1} / ${state.searchMatches.length}`;
    if (m.page !== state.currentPage) goToPage(m.page);
    else drawAnnotations();
  }

  // ==========================================================================
  // SIGNATURE PAD & SAVED SIGNATURES
  // ==========================================================================
  function openSignModal() {
    openModal(el.modalSign);
    clearSignPad();
    renderSavedSigns();
  }

  function clearSignPad() {
    const ctx = el.signCanvas.getContext('2d');
    ctx.clearRect(0, 0, el.signCanvas.width, el.signCanvas.height);
    state.signHasInk = false;
  }

  function getSavedSigns() {
    try {
      const raw = localStorage.getItem(LS_SIGNS);
      return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
  }

  function saveSignToStorage(dataUrl) {
    try {
      const list = getSavedSigns().filter((s) => s !== dataUrl);
      list.unshift(dataUrl);
      localStorage.setItem(LS_SIGNS, JSON.stringify(list.slice(0, 4)));
    } catch (_) {}
  }

  function renderSavedSigns() {
    const list = getSavedSigns();
    el.savedSignsRow.innerHTML = '';
    list.forEach((src, i) => {
      const chip = document.createElement('div');
      chip.className = 'saved-sign-chip';
      chip.innerHTML = `<img src="${src}" alt="Υπογραφή" /><button class="saved-sign-del" title="Διαγραφή">✕</button>`;
      chip.addEventListener('click', (e) => {
        if (e.target.closest('.saved-sign-del')) {
          const next = getSavedSigns().filter((_, idx) => idx !== i);
          try { localStorage.setItem(LS_SIGNS, JSON.stringify(next)); } catch (_) {}
          renderSavedSigns();
          return;
        }
        state.pendingSignSrc = src;
        closeModal(el.modalSign);
        placeImageOverlay(src, 'sign', 0.5, 0.72, 0.24);
      });
      el.savedSignsRow.appendChild(chip);
    });
  }

  function cropSignatureCanvas(cv) {
    const ctx = cv.getContext('2d');
    const { width, height } = cv;
    const data = ctx.getImageData(0, 0, width, height).data;
    let minX = width, minY = height, maxX = 0, maxY = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 12) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX <= minX || maxY <= minY) return null;
    const pad = 10;
    const sx = Math.max(0, minX - pad), sy = Math.max(0, minY - pad);
    const sw = Math.min(width - sx, maxX - minX + pad * 2);
    const sh = Math.min(height - sy, maxY - minY + pad * 2);
    const out = document.createElement('canvas');
    out.width = sw;
    out.height = sh;
    out.getContext('2d').drawImage(cv, sx, sy, sw, sh, 0, 0, sw, sh);
    return out.toDataURL('image/png');
  }

  // ==========================================================================
  // MULTI-IMAGE -> PDF WITH SIMULTANEOUS RESIZE (Small / Medium / Large / Orig)
  // ==========================================================================
  const IMG_PRESETS = {
    small:    { maxDim: 1200, quality: 0.72, bpp: 0.14 },
    medium:   { maxDim: 1920, quality: 0.84, bpp: 0.23 },
    large:    { maxDim: 3000, quality: 0.94, bpp: 0.38 },
    original: { maxDim: 0,    quality: 0.98, bpp: 1.00 }
  };

  async function enqueueImagesForPdf(files) {
    const imgs = Array.from(files || []).filter((f) => /^image\//i.test(f.type) || /\.(jpe?g|png|webp|bmp|gif)$/i.test(f.name));
    if (!imgs.length) return;

    for (const file of imgs) {
      const url = URL.createObjectURL(file);
      try {
        const img = await loadImageAsync(url);
        state.imgQueue.push({
          id: uid(),
          file,
          name: file.name,
          url,
          w: img.naturalWidth,
          h: img.naturalHeight,
          size: file.size
        });
      } catch (_) {
        URL.revokeObjectURL(url);
      }
    }

    renderImgQueue();
    openModal(el.modalImgPdf);
  }

  function estimatePresetBytes(presetKey) {
    const p = IMG_PRESETS[presetKey];
    let total = 18000;
    for (const item of state.imgQueue) {
      if (presetKey === 'original') {
        total += item.size;
      } else {
        const scale = p.maxDim > 0 ? Math.min(1, p.maxDim / Math.max(item.w, item.h)) : 1;
        const tw = Math.round(item.w * scale);
        const th = Math.round(item.h * scale);
        const est = Math.min(item.size, Math.max(25000, tw * th * p.bpp));
        total += est;
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
        <div class="img-row-info">
          <div class="img-row-name"></div>
          <div class="img-row-dim">${item.w} × ${item.h} px · ${formatBytes(item.size)}</div>
        </div>
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
        if (act === 'del') {
          URL.revokeObjectURL(item.url);
          state.imgQueue.splice(idx, 1);
        } else if (act === 'up' && idx > 0) {
          [state.imgQueue[idx - 1], state.imgQueue[idx]] = [state.imgQueue[idx], state.imgQueue[idx - 1]];
        } else if (act === 'down' && idx < state.imgQueue.length - 1) {
          [state.imgQueue[idx + 1], state.imgQueue[idx]] = [state.imgQueue[idx], state.imgQueue[idx + 1]];
        }
        renderImgQueue();
      });
      el.imgQueueList.appendChild(row);
    });

    // Update live estimated MB per size preset!
    ['small', 'medium', 'large', 'original'].forEach((key) => {
      const tag = el.imgSizeGrid.querySelector(`.est-tag[data-est="${key}"]`);
      if (tag) tag.textContent = count ? '~' + formatBytes(estimatePresetBytes(key)) : '~';
    });
  }

  async function buildPdfFromImageQueue() {
    if (!state.imgQueue.length) return;
    const preset = IMG_PRESETS[state.imgSizePreset] || IMG_PRESETS.medium;
    const layout = state.imgLayout;
    const origBtnText = el.btnBuildImgPdf.textContent;
    el.btnBuildImgPdf.disabled = true;
    el.btnBuildImgPdf.textContent = 'Επεξεργασία…';

    try {
      const pdfDoc = await window.PDFLib.PDFDocument.create();
      stampPdfMetadata(pdfDoc);

      for (let i = 0; i < state.imgQueue.length; i++) {
        const item = state.imgQueue[i];
        el.btnBuildImgPdf.textContent = `Εικόνα ${i + 1}/${state.imgQueue.length}…`;

        const img = await loadImageAsync(item.url);
        let tw = img.naturalWidth;
        let th = img.naturalHeight;

        let embeddedImg;
        if (state.imgSizePreset === 'original' && (/^image\/(jpeg|jpg|png)$/i.test(item.file.type))) {
          const raw = new Uint8Array(await item.file.arrayBuffer());
          embeddedImg = /png$/i.test(item.file.type)
            ? await pdfDoc.embedPng(raw)
            : await pdfDoc.embedJpg(raw);
        } else {
          if (preset.maxDim > 0 && Math.max(tw, th) > preset.maxDim) {
            const scale = preset.maxDim / Math.max(tw, th);
            tw = Math.max(1, Math.round(tw * scale));
            th = Math.max(1, Math.round(th * scale));
          }
          const cv = document.createElement('canvas');
          cv.width = tw;
          cv.height = th;
          const ctx = cv.getContext('2d', { alpha: false });
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, tw, th);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, tw, th);

          const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', preset.quality));
          const jpgBytes = new Uint8Array(await blob.arrayBuffer());
          embeddedImg = await pdfDoc.embedJpg(jpgBytes);
        }

        const imgW = embeddedImg.width;
        const imgH = embeddedImg.height;
        let pageW, pageH, drawW, drawH, drawX, drawY;

        if (layout === 'fit') {
          const maxPt = 842;
          const s = Math.min(1, maxPt / Math.max(imgW, imgH));
          pageW = Math.max(72, imgW * s);
          pageH = Math.max(72, imgH * s);
          drawW = pageW;
          drawH = pageH;
          drawX = 0;
          drawY = 0;
        } else {
          pageW = layout === 'a4l' ? 841.89 : 595.28;
          pageH = layout === 'a4l' ? 595.28 : 841.89;
          const margin = 20;
          const maxW = pageW - margin * 2;
          const maxH = pageH - margin * 2;
          const ratio = Math.min(maxW / imgW, maxH / imgH);
          drawW = imgW * ratio;
          drawH = imgH * ratio;
          drawX = (pageW - drawW) / 2;
          drawY = (pageH - drawH) / 2;
        }

        const page = pdfDoc.addPage([pageW, pageH]);
        page.drawImage(embeddedImg, { x: drawX, y: drawY, width: drawW, height: drawH });
      }

      const outBytes = await pdfDoc.save();
      const totalImgs = state.imgQueue.length;
      const baseName = state.imgQueue[0].name.replace(/\.[^.]+$/, '') + (totalImgs > 1 ? `_${totalImgs}imgs.pdf` : '.pdf');

      // Clean up preview URLs
      state.imgQueue.forEach((x) => URL.revokeObjectURL(x.url));
      state.imgQueue = [];
      closeModal(el.modalImgPdf);

      await loadPdfBytes(outBytes, baseName, { hasDiskPath: false, markDirty: true });
      const labelMap = { small: 'Small', medium: 'Medium', large: 'Large', original: 'Original' };
      showToast(`Έτοιμο PDF (${totalImgs} εικόνες · ${labelMap[state.imgSizePreset]} · ${formatBytes(outBytes.byteLength)})`, 3800);
    } catch (err) {
      console.error('Images->PDF failed:', err);
      showToast('Σφάλμα κατά τη δημιουργία PDF από εικόνες.');
    } finally {
      el.btnBuildImgPdf.disabled = false;
      el.btnBuildImgPdf.textContent = origBtnText;
    }
  }

  // ==========================================================================
  // SMART SAVE & COMPRESS PDF (Original Vector / Small / Medium / Large)
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
    const pdfDoc = await window.PDFLib.PDFDocument.load(state.pdfBytes);
    stampPdfMetadata(pdfDoc);
    const pages = pdfDoc.getPages();

    for (let i = 0; i < pages.length; i++) {
      if (opts.onlyPageIdx !== undefined && opts.onlyPageIdx !== i) continue;
      const list = state.annotations[i] || [];
      const hasDrawable = list.some((a) => a.type !== 'note' || opts.embedNotes)
        || !!(state.watermark && state.watermark.text)
        || !!state.pageNumbers;
      if (!hasDrawable) continue;

      const pg = pages[i];
      const { width, height } = pg.getSize();
      const rot = (pg.getRotation().angle || 0) % 360;
      const swapped = rot === 90 || rot === 270;
      const visW = swapped ? height : width;
      const visH = swapped ? width : height;

      // Render crisp 2.5x transparent overlay PNG (100% lossless Greek UTF-8 + signatures + watermark + page nums!)
      const scale = 2.5;
      const cv = document.createElement('canvas');
      cv.width = Math.round(visW * scale);
      cv.height = Math.round(visH * scale);
      const ctx = cv.getContext('2d');
      const preloaded = await preloadAnnoImages(list);
      renderAnnoListToContext(ctx, cv.width, cv.height, list, {
        embedNotes: !!opts.embedNotes,
        preloadedImages: preloaded,
        pageNum: i + 1,
        pageCount: pages.length
      });

      // Counter-rotate overlay if underlying PDF page has a /Rotate entry
      let finalCanvas = cv;
      if (rot !== 0) {
        finalCanvas = document.createElement('canvas');
        finalCanvas.width = Math.round(width * scale);
        finalCanvas.height = Math.round(height * scale);
        const rctx = finalCanvas.getContext('2d');
        rctx.translate(finalCanvas.width / 2, finalCanvas.height / 2);
        rctx.rotate((-rot * Math.PI) / 180);
        rctx.drawImage(cv, -cv.width / 2, -cv.height / 2);
      }

      const blob = await new Promise((res) => finalCanvas.toBlob(res, 'image/png'));
      const pngBytes = new Uint8Array(await blob.arrayBuffer());
      const embedded = await pdfDoc.embedPng(pngBytes);
      pg.drawImage(embedded, { x: 0, y: 0, width, height });
    }

    return await pdfDoc.save();
  }

  async function buildCompressedPdfBytes(mode, embedNotes) {
    const presets = {
      small:  { dpi: 110, quality: 0.72 },
      medium: { dpi: 150, quality: 0.82 },
      large:  { dpi: 240, quality: 0.90 }
    };
    const cfg = presets[mode] || presets.medium;
    const scale = cfg.dpi / 72;

    const outDoc = await window.PDFLib.PDFDocument.create();
    stampPdfMetadata(outDoc);

    for (let p = 1; p <= state.pageCount; p++) {
      el.btnConfirmSave.textContent = `Συμπίεση ${p}/${state.pageCount}…`;
      const page = await state.pdfDoc.getPage(p);
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale });

      const cv = document.createElement('canvas');
      cv.width = Math.round(vp.width);
      cv.height = Math.round(vp.height);
      const ctx = cv.getContext('2d', { alpha: false });
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;

      const list = state.annotations[p - 1] || [];
      if (list.length || (state.watermark && state.watermark.text) || state.pageNumbers) {
        const preloaded = await preloadAnnoImages(list);
        renderAnnoListToContext(ctx, cv.width, cv.height, list, {
          embedNotes,
          preloadedImages: preloaded,
          pageNum: p,
          pageCount: state.pageCount
        });
      }

      const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', cfg.quality));
      const jpgBytes = new Uint8Array(await blob.arrayBuffer());
      const img = await outDoc.embedJpg(jpgBytes);
      const outPage = outDoc.addPage([vp1.width, vp1.height]);
      outPage.drawImage(img, { x: 0, y: 0, width: vp1.width, height: vp1.height });
    }

    return await outDoc.save();
  }

  async function deliverOutputBytes(bytes, fileName, forceSaveAs = false) {
    const safeName = ensurePdfExt(fileName);

    if (DESKTOP_MODE && SESSION_TOKEN) {
      const endpoint = (!forceSaveAs && state.hasDiskPath)
        ? `/api/save?t=${encodeURIComponent(SESSION_TOKEN)}`
        : `/api/saveas?t=${encodeURIComponent(SESSION_TOKEN)}&name=${encodeURIComponent(safeName)}`;

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/pdf' },
        body: bytes
      });
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

    // Standard Web / Mobile PWA instant local download
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeName;
    document.body.appendChild(a);
    a.click();
    a.remove();
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
    el.btnConfirmSave.disabled = true;
    el.btnSaveAsDesktop.disabled = true;
    el.btnConfirmSave.textContent = 'Αποθήκευση…';

    try {
      const outBytes = state.saveMode === 'vector'
        ? await buildVectorPdfBytes({ embedNotes })
        : await buildCompressedPdfBytes(state.saveMode, embedNotes);

      const saved = await deliverOutputBytes(outBytes, targetName, forceSaveAs);
      if (saved) {
        closeModal(el.modalSave);
        const diffMsg = state.saveMode === 'vector'
          ? `Αποθηκεύτηκε: ${targetName} (${formatBytes(outBytes.byteLength)})`
          : `Αποθηκεύτηκε: ${targetName} (${formatBytes(origSize)} → ${formatBytes(outBytes.byteLength)})`;
        showToast(diffMsg, 3600);
        setStatus(diffMsg);
      }
    } catch (err) {
      console.error('Save error:', err);
      showToast('Σφάλμα κατά την αποθήκευση PDF.');
    } finally {
      el.btnConfirmSave.disabled = false;
      el.btnSaveAsDesktop.disabled = false;
      el.btnConfirmSave.textContent = origLabel;
    }
  }

  // Export 1 or All pages as crisp 150/300-DPI PNG or JPG
  async function exportPagesToImages(scope = 'current', fmt = 'png', dpi = 300) {
    if (!state.pdfDoc) return;
    const pages = scope === 'all'
      ? Array.from({ length: state.pageCount }, (_, i) => i + 1)
      : [state.currentPage];
    const scale = clamp(dpi / 72, 1.0, 4.2);
    const mime = fmt === 'jpeg' ? 'image/jpeg' : 'image/png';
    const ext = fmt === 'jpeg' ? 'jpg' : 'png';
    const base = state.fileName.replace(/\.pdf$/i, '');

    try {
      for (const p of pages) {
        const page = await state.pdfDoc.getPage(p);
        const vp = page.getViewport({ scale });
        const cv = document.createElement('canvas');
        cv.width = Math.round(vp.width);
        cv.height = Math.round(vp.height);
        const ctx = cv.getContext('2d', { alpha: false });
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, cv.width, cv.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;

        const list = state.annotations[p - 1] || [];
        if (list.length || (state.watermark && state.watermark.text) || state.pageNumbers) {
          const preloaded = await preloadAnnoImages(list);
          renderAnnoListToContext(ctx, cv.width, cv.height, list, {
            preloadedImages: preloaded,
            pageNum: p,
            pageCount: state.pageCount
          });
        }

        const url = cv.toDataURL(mime, 0.92);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${base}_p${p}.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        if (pages.length > 1) await new Promise((r) => setTimeout(r, 180));
      }
      showToast(pages.length > 1
        ? `Εξήχθησαν ${pages.length} σελίδες σε ${ext.toUpperCase()} (${dpi} DPI)`
        : `Εξήχθη η σελίδα ${state.currentPage} σε ${ext.toUpperCase()} (${dpi} DPI)`);
    } catch (_) {
      showToast('Σφάλμα εξαγωγής εικόνας.');
    }
  }

  function exportCurrentPagePng() {
    exportPagesToImages('current', 'png', 220);
  }

  // Prepress Paper Format Detector (mm / cm / pt)
  function detectPaperFormat(wMm, hMm) {
    const lo = Math.min(wMm, hMm), hi = Math.max(wMm, hMm);
    const orient = wMm > hMm + 2 ? 'Οριζόντιο' : (hMm > wMm + 2 ? 'Κάθετο' : 'Τετράγωνο');
    const presets = [
      ['A3', 297, 420], ['A4', 210, 297], ['A5', 148, 210],
      ['A6', 105, 148], ['B5', 176, 250], ['US Letter', 215.9, 279.4], ['Tabloid', 279.4, 431.8]
    ];
    for (const [name, pw, ph] of presets) {
      if (Math.abs(lo - pw) <= 2.5 && Math.abs(hi - ph) <= 2.5) return `${name} · ${orient}`;
    }
    return `Custom · ${orient}`;
  }

  function openDocInfoModal() {
    if (!state.pdfDoc) return;
    const wMm = (state.pageBaseW * 25.4) / 72;
    const hMm = (state.pageBaseH * 25.4) / 72;
    const formatLbl = detectPaperFormat(wMm, hMm);
    let totalAnnos = 0, totalNotes = 0;
    for (const list of state.annotations) {
      for (const a of (list || [])) {
        if (a.type === 'note') totalNotes++; else totalAnnos++;
      }
    }
    el.docSpecsGrid.innerHTML = `
      <div class="spec-box"><span>Διαστάσεις (mm)</span><strong>${wMm.toFixed(1)} × ${hMm.toFixed(1)} mm</strong></div>
      <div class="spec-box"><span>Μορφή / Προσανατολισμός</span><strong>${formatLbl}</strong></div>
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
  // DESKTOP LOOPBACK BRIDGE (Windows Native Default .PDF Host)
  // ==========================================================================
  async function initDesktopBridge() {
    if (!DESKTOP_MODE || !SESSION_TOKEN) return;
    el.btnSaveAsDesktop.hidden = false;

    // Lightweight heartbeat so NillyDocPro.exe exits cleanly to 0 MB RAM on window close
    const ping = () => fetch(`/api/heartbeat?t=${encodeURIComponent(SESSION_TOKEN)}`, { method: 'POST', keepalive: true }).catch(() => {});
    ping();
    setInterval(ping, 2500);
    window.addEventListener('beforeunload', () => {
      try { navigator.sendBeacon(`/api/bye?t=${encodeURIComponent(SESSION_TOKEN)}`); } catch (_) {}
    });

    // Auto-open double-clicked Windows .pdf file if passed via CLI
    try {
      const resp = await fetch(`/api/file?t=${encodeURIComponent(SESSION_TOKEN)}`);
      if (resp.status === 200) {
        const buf = await resp.arrayBuffer();
        const rawName = resp.headers.get('X-File-Name') || 'document.pdf';
        const decodedName = decodeURIComponent(rawName);
        if (buf.byteLength > 0) {
          await loadPdfBytes(new Uint8Array(buf), decodedName, { hasDiskPath: true });
        }
      }
    } catch (err) {
      console.warn('Desktop initial file check:', err);
    }
  }

  // ==========================================================================
  // EVENT WIRING
  // ==========================================================================
  function bindEvents() {
    // Theme toggle
    try { applyTheme(localStorage.getItem(LS_THEME) || 'dark'); } catch (_) { applyTheme('dark'); }
    el.btnThemeToggle.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      applyTheme(cur === 'light' ? 'dark' : 'light');
    });

    // Sidebar rails
    el.btnToggleThumbs.addEventListener('click', () => {
      if (!state.pdfDoc) return;
      el.thumbRail.hidden = !el.thumbRail.hidden;
      if (state.fitWidth) setTimeout(() => renderCurrentPage(true), 60);
    });
    el.btnCloseThumbs.addEventListener('click', () => { el.thumbRail.hidden = true; });
    el.btnToggleComments.addEventListener('click', () => {
      el.commentsRail.hidden = !el.commentsRail.hidden;
      if (state.fitWidth) setTimeout(() => renderCurrentPage(true), 60);
    });
    el.btnCloseComments.addEventListener('click', () => { el.commentsRail.hidden = true; });

    // Page nav & Zoom
    el.btnPrevPage.addEventListener('click', () => goToPage(state.currentPage - 1));
    el.btnNextPage.addEventListener('click', () => goToPage(state.currentPage + 1));
    el.inpPageNum.addEventListener('change', () => goToPage(parseInt(el.inpPageNum.value, 10) || 1));
    el.btnZoomOut.addEventListener('click', () => {
      state.fitWidth = false;
      state.zoom = clamp(state.zoom - 0.15, 0.35, 3.0);
      renderCurrentPage(false);
    });
    el.btnZoomIn.addEventListener('click', () => {
      state.fitWidth = false;
      state.zoom = clamp(state.zoom + 0.15, 0.35, 3.0);
      renderCurrentPage(false);
    });
    el.btnZoomFit.addEventListener('click', () => {
      state.fitWidth = true;
      renderCurrentPage(true);
    });

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      if (!state.pdfDoc || !state.fitWidth) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => renderCurrentPage(true), 120);
    });

    // Open / Merge / Images->PDF / Blank
    const triggerOpenPdf = () => { el.fileOpenPdf.value = ''; el.fileOpenPdf.click(); };
    const triggerImgsPdf = () => { el.fileImgsToPdf.value = ''; el.fileImgsToPdf.click(); };
    el.btnOpenPdf.addEventListener('click', triggerOpenPdf);
    el.btnEmptyOpenPdf.addEventListener('click', triggerOpenPdf);
    el.btnImgsToPdf.addEventListener('click', () => {
      if (state.imgQueue.length) openModal(el.modalImgPdf);
      else triggerImgsPdf();
    });
    el.btnEmptyImgsPdf.addEventListener('click', triggerImgsPdf);
    el.btnEmptyBlank.addEventListener('click', createBlankA4Pdf);
    el.btnAddBlankPage.addEventListener('click', addBlankPage);
    // More Studio Tools Popover (...)
    const closeMoreMenu = () => { if (el.moreMenu) el.moreMenu.hidden = true; };
    el.btnMoreMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      el.moreMenu.hidden = !el.moreMenu.hidden;
    });
    document.addEventListener('click', (e) => {
      if (!el.moreMenu.hidden && !el.moreMenuWrap.contains(e.target)) closeMoreMenu();
    });

    el.btnMergePdf.addEventListener('click', () => { closeMoreMenu(); el.fileMergePdf.value = ''; el.fileMergePdf.click(); });
    el.btnSplitPdf.addEventListener('click', () => {
      closeMoreMenu();
      if (!state.pdfDoc) return;
      el.lblSplitMeta.textContent = `Έγγραφο ${state.pageCount} σελίδων — γράψε ποιες θες να εξάγεις`;
      el.inpSplitRange.value = state.pageCount > 1 ? `1-${state.pageCount}` : '1';
      openModal(el.modalSplit);
    });
    el.btnWatermarkOpen.addEventListener('click', () => {
      closeMoreMenu();
      if (!state.pdfDoc) return;
      if (state.watermark) {
        el.inpWmText.value = state.watermark.text;
        el.rngWmOpacity.value = String(state.watermark.opacity);
        el.lblWmOpacity.textContent = state.watermark.opacity + '%';
      }
      openModal(el.modalWatermark);
    });
    el.btnPageNumsOpen.addEventListener('click', () => {
      closeMoreMenu();
      if (!state.pdfDoc) return;
      openModal(el.modalPageNums);
    });
    el.btnExportImgsOpen.addEventListener('click', () => {
      closeMoreMenu();
      if (!state.pdfDoc) return;
      el.lblExportImgsMeta.textContent = `Σύνολο ${state.pageCount} ${state.pageCount === 1 ? 'σελίδα' : 'σελίδες'} — διάλεξε μορφή & DPI`;
      openModal(el.modalExportImgs);
    });
    el.btnDocInfoOpen.addEventListener('click', () => {
      closeMoreMenu();
      openDocInfoModal();
    });
    const mMerge = $('btnMobileMerge');
    const mSplit = $('btnMobileSplit');
    if (mMerge) mMerge.addEventListener('click', () => { el.thumbRail.hidden = true; el.btnMergePdf.click(); });
    if (mSplit) mSplit.addEventListener('click', () => { el.thumbRail.hidden = true; el.btnSplitPdf.click(); });
    el.btnConfirmSplit.addEventListener('click', splitAndDownload);

    el.fileOpenPdf.addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      await loadPdfBytes(new Uint8Array(await f.arrayBuffer()), f.name, { hasDiskPath: false });
    });
    el.fileMergePdf.addEventListener('change', (e) => mergePdfFiles(Array.from(e.target.files || [])));
    el.fileImgsToPdf.addEventListener('change', (e) => enqueueImagesForPdf(e.target.files));

    el.fileInsertImg.addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) { setTool('select'); return; }
      const reader = new FileReader();
      reader.onload = () => {
        state.pendingImgSrc = reader.result;
        placeImageOverlay(reader.result, 'image', 0.5, 0.45, 0.32);
      };
      reader.readAsDataURL(f);
    });

    // Global Drag & Drop (PDF or Multiple Images!)
    let dragCounter = 0;
    window.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      el.dropTarget.classList.add('drop-active');
    });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('dragleave', () => {
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) el.dropTarget.classList.remove('drop-active');
    });
    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      dragCounter = 0;
      el.dropTarget.classList.remove('drop-active');
      const files = Array.from(e.dataTransfer?.files || []);
      if (!files.length) return;
      const pdfs = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
      const imgs = files.filter((f) => /^image\//i.test(f.type) || /\.(jpe?g|png|webp|bmp)$/i.test(f.name));
      if (imgs.length) {
        await enqueueImagesForPdf(imgs);
      } else if (pdfs.length) {
        await loadPdfBytes(new Uint8Array(await pdfs[0].arrayBuffer()), pdfs[0].name, { hasDiskPath: false });
        if (pdfs.length > 1) await mergePdfFiles(pdfs.slice(1));
      }
    });

    // Tool strip buttons
    el.toolStrip.querySelectorAll('.tool-btn').forEach((btn) => {
      btn.addEventListener('click', () => setTool(btn.dataset.tool));
    });

    // Ink palette & size
    el.inkPalette.querySelectorAll('.ink-dot').forEach((dot) => {
      dot.addEventListener('click', () => {
        state.color = dot.dataset.color;
        el.inkPalette.querySelectorAll('.ink-dot').forEach((d) => d.classList.toggle('active', d === dot));
        if (state.selectedId) {
          const sel = getPageAnnos().find((x) => x.id === state.selectedId);
          if (sel && sel.color !== undefined) {
            pushUndo(state.currentPage - 1);
            sel.color = state.color;
            drawAnnotations();
          }
        }
      });
    });

    el.selStrokeSize.addEventListener('change', () => {
      state.strokeSize = parseInt(el.selStrokeSize.value, 10) || 16;
      if (state.selectedId) {
        const sel = getPageAnnos().find((x) => x.id === state.selectedId);
        if (sel && sel.type === 'text') {
          pushUndo(state.currentPage - 1);
          sel.size = state.strokeSize;
          drawAnnotations();
        }
      }
    });

    el.btnTextBg.addEventListener('click', () => {
      state.textBg = !state.textBg;
      el.btnTextBg.classList.toggle('active', state.textBg);
      if (state.selectedId) {
        const sel = getPageAnnos().find((x) => x.id === state.selectedId);
        if (sel && sel.type === 'text') {
          pushUndo(state.currentPage - 1);
          sel.bg = state.textBg ? '#FFFFFF' : null;
          drawAnnotations();
        }
      }
      showToast(state.textBg ? 'Λευκό φόντο κειμένου: ΕΝΕΡΓΟ (καλύπτει παλιό κείμενο)' : 'Λευκό φόντο κειμένου: ΑΝΕΝΕΡΓΟ', 2200);
    });

    el.btnUndo.addEventListener('click', undo);
    el.btnRedo.addEventListener('click', redo);
    el.btnDelSelected.addEventListener('click', deleteSelected);
    el.btnExportPng.addEventListener('click', exportCurrentPagePng);
    el.btnPrint.addEventListener('click', () => window.print());

    // Unified Stage pointer listeners (coexists cleanly with native PDF #textLayer copy!)
    el.pageStage.addEventListener('pointerdown', onStagePointerDown);
    el.pageStage.addEventListener('pointermove', onStagePointerMove);
    el.pageStage.addEventListener('pointerup', onStagePointerUp);
    el.pageStage.addEventListener('pointercancel', onStagePointerUp);
    el.pageStage.addEventListener('dblclick', onStageDblClick);

    // Designer Ergonomics: Ctrl + Mouse Wheel Smooth Zoom
    el.deskViewport.addEventListener('wheel', (e) => {
      if (!state.pdfDoc || (!e.ctrlKey && !e.metaKey)) return;
      e.preventDefault();
      state.fitWidth = false;
      const step = e.deltaY < 0 ? 0.12 : -0.12;
      state.zoom = clamp(state.zoom + step, 0.35, 3.0);
      renderCurrentPage(false);
    }, { passive: false });

    // Designer Ergonomics: Space+Drag or Middle-Mouse Hand Pan
    el.deskViewport.addEventListener('pointerdown', (e) => {
      if (!state.pdfDoc) return;
      if (state.spaceDown || e.button === 1) {
        e.preventDefault();
        state.panActive = true;
        state.panStart = {
          x: e.clientX,
          y: e.clientY,
          sl: el.deskViewport.scrollLeft,
          st: el.deskViewport.scrollTop
        };
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
      state.panActive = false;
      state.panStart = null;
      el.deskViewport.classList.remove('panning-active');
      try { el.deskViewport.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    el.deskViewport.addEventListener('pointerup', endPan);
    el.deskViewport.addEventListener('pointercancel', endPan);

    // Direct Ctrl+V Clipboard Image Paste (works straight from Nilly QuickSnap Ctrl+Alt+S!)
    window.addEventListener('paste', async (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const items = Array.from(e.clipboardData?.items || []);
      const imgItem = items.find((it) => it.type && it.type.startsWith('image/'));
      if (!imgItem) return;
      const blob = imgItem.getAsFile();
      if (!blob) return;
      e.preventDefault();
      if (!state.pdfDoc) {
        const f = new File([blob], `clipboard_${Date.now()}.png`, { type: blob.type || 'image/png' });
        await enqueueImagesForPdf([f]);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        placeImageOverlay(reader.result, 'image', 0.5, 0.45, 0.36);
        showToast('Επικολλήθηκε εικόνα από το πρόχειρο (Ctrl+V)');
      };
      reader.readAsDataURL(blob);
    });

    // Search bar
    el.btnSearchToggle.addEventListener('click', () => {
      el.searchBar.hidden = !el.searchBar.hidden;
      if (!el.searchBar.hidden) el.inpSearch.focus();
      else { state.searchMatches = []; drawAnnotations(); }
    });
    el.btnSearchClose.addEventListener('click', () => {
      el.searchBar.hidden = true;
      state.searchMatches = [];
      el.lblSearchCount.textContent = '';
      drawAnnotations();
    });
    let searchDebounce = null;
    el.inpSearch.addEventListener('input', () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => runSearch(el.inpSearch.value), 180);
    });
    el.inpSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && state.searchMatches.length) {
        state.searchIdx = (state.searchIdx + (e.shiftKey ? -1 : 1) + state.searchMatches.length) % state.searchMatches.length;
        jumpToSearchMatch();
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

    // Multi-Image -> PDF modal
    el.btnAddMoreImgs.addEventListener('click', triggerImgsPdf);
    el.btnClearImgs.addEventListener('click', () => {
      state.imgQueue.forEach((x) => URL.revokeObjectURL(x.url));
      state.imgQueue = [];
      renderImgQueue();
    });
    el.imgSizeGrid.querySelectorAll('.size-card').forEach((card) => {
      card.addEventListener('click', () => {
        state.imgSizePreset = card.dataset.size;
        el.imgSizeGrid.querySelectorAll('.size-card').forEach((c) => c.classList.toggle('active', c === card));
      });
    });
    el.imgLayoutRow.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.imgLayout = btn.dataset.layout;
        el.imgLayoutRow.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });
    el.btnBuildImgPdf.addEventListener('click', buildPdfFromImageQueue);

    // Save & Compress modal
    el.btnSaveOpen.addEventListener('click', () => {
      if (!state.pdfBytes) return;
      el.inpSaveName.value = state.fileName;
      el.lblSaveMeta.textContent = `Τρέχον μέγεθος: ${formatBytes(state.pdfBytes.byteLength)} · ${state.pageCount} σελίδες`;
      el.btnSaveAsDesktop.hidden = !DESKTOP_MODE;
      openModal(el.modalSave);
    });
    el.pdfSaveSizeGrid.querySelectorAll('.size-card').forEach((card) => {
      card.addEventListener('click', () => {
        state.saveMode = card.dataset.mode;
        el.pdfSaveSizeGrid.querySelectorAll('.size-card').forEach((c) => c.classList.toggle('active', c === card));
      });
    });
    el.btnConfirmSave.addEventListener('click', () => executeSave(false));
    el.btnSaveAsDesktop.addEventListener('click', () => executeSave(true));

    // Signature pad drawing
    const sCtx = el.signCanvas.getContext('2d');
    const getSignPt = (e) => {
      const r = el.signCanvas.getBoundingClientRect();
      return {
        x: (e.clientX - r.left) * (el.signCanvas.width / r.width),
        y: (e.clientY - r.top) * (el.signCanvas.height / r.height)
      };
    };
    el.signCanvas.addEventListener('pointerdown', (e) => {
      state.signDrawing = true;
      state.signHasInk = true;
      state.signLastPt = getSignPt(e);
      el.signCanvas.setPointerCapture(e.pointerId);
    });
    el.signCanvas.addEventListener('pointermove', (e) => {
      if (!state.signDrawing || !state.signLastPt) return;
      const pt = getSignPt(e);
      sCtx.strokeStyle = state.signInk;
      sCtx.lineWidth = 3.2;
      sCtx.lineCap = 'round';
      sCtx.lineJoin = 'round';
      sCtx.beginPath();
      sCtx.moveTo(state.signLastPt.x, state.signLastPt.y);
      sCtx.lineTo(pt.x, pt.y);
      sCtx.stroke();
      state.signLastPt = pt;
    });
    const endSign = () => { state.signDrawing = false; state.signLastPt = null; };
    el.signCanvas.addEventListener('pointerup', endSign);
    el.signCanvas.addEventListener('pointercancel', endSign);

    el.signInks.querySelectorAll('.ink-dot').forEach((dot) => {
      dot.addEventListener('click', () => {
        state.signInk = dot.dataset.color;
        el.signInks.querySelectorAll('.ink-dot').forEach((d) => d.classList.toggle('active', d === dot));
      });
    });
    el.btnClearSign.addEventListener('click', clearSignPad);
    el.btnUploadSign.addEventListener('click', () => { el.fileSignImg.value = ''; el.fileSignImg.click(); });
    el.fileSignImg.addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        saveSignToStorage(reader.result);
        closeModal(el.modalSign);
        placeImageOverlay(reader.result, 'sign', 0.5, 0.72, 0.24);
      };
      reader.readAsDataURL(f);
    });
    el.btnApplySign.addEventListener('click', () => {
      const png = cropSignatureCanvas(el.signCanvas);
      if (!png) { showToast('Σχεδίασε πρώτα την υπογραφή σου.'); return; }
      saveSignToStorage(png);
      closeModal(el.modalSign);
      placeImageOverlay(png, 'sign', 0.5, 0.72, 0.24);
    });

    // Stamps modal
    el.stampGrid.querySelectorAll('.stamp-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.pendingStamp = { text: btn.dataset.text, color: btn.dataset.color };
        closeModal(el.modalStamp);
        showToast('Κάνε κλικ στη σελίδα για να βάλεις τη σφραγίδα');
      });
    });
    el.btnUseCustomStamp.addEventListener('click', () => {
      const txt = el.inpCustomStamp.value.trim();
      if (!txt) return;
      state.pendingStamp = { text: txt, color: state.color };
      closeModal(el.modalStamp);
      showToast('Κάνε κλικ στη σελίδα για να βάλεις τη σφραγίδα');
    });

    // Prompt modal
    const commitPrompt = () => {
      const val = el.txtPromptInput.value.trim();
      closeModal(el.modalPrompt);
      if (val && typeof state.promptCallback === 'function') {
        state.promptCallback(val);
      }
      state.promptCallback = null;
    };
    el.btnPromptOk.addEventListener('click', commitPrompt);
    el.txtPromptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        commitPrompt();
      }
    });

    // Watermark modal (All pages)
    el.wmColors.querySelectorAll('.ink-dot').forEach((dot) => {
      dot.addEventListener('click', () => {
        state.wmColor = dot.dataset.color;
        el.wmColors.querySelectorAll('.ink-dot').forEach((d) => d.classList.toggle('active', d === dot));
      });
    });
    el.rngWmOpacity.addEventListener('input', () => {
      el.lblWmOpacity.textContent = el.rngWmOpacity.value + '%';
    });
    el.wmStyleRow.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.wmStyle = btn.dataset.wmstyle;
        el.wmStyleRow.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });
    el.btnApplyWatermark.addEventListener('click', () => {
      const text = el.inpWmText.value.trim();
      if (!text) { showToast('Γράψε κείμενο για το υδατογράφημα.'); return; }
      state.watermark = {
        text,
        color: state.wmColor,
        opacity: parseInt(el.rngWmOpacity.value, 10) || 18,
        style: state.wmStyle
      };
      state.dirty = true;
      closeModal(el.modalWatermark);
      drawAnnotations();
      showToast('Εφαρμόστηκε υδατογράφημα σε όλες τις σελίδες');
    });
    el.btnClearWatermark.addEventListener('click', () => {
      state.watermark = null;
      closeModal(el.modalWatermark);
      drawAnnotations();
      showToast('Αφαιρέθηκε το υδατογράφημα');
    });

    // Page Numbers modal (All pages)
    el.pnPosRow.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.pnPos = btn.dataset.pos;
        el.pnPosRow.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });
    el.pnFmtRow.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.pnFmt = btn.dataset.fmt;
        el.pnFmtRow.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });
    el.btnApplyPageNums.addEventListener('click', () => {
      state.pageNumbers = { pos: state.pnPos, fmt: state.pnFmt };
      state.dirty = true;
      closeModal(el.modalPageNums);
      drawAnnotations();
      showToast('Ενεργοποιήθηκε αρίθμηση σε όλες τις σελίδες');
    });
    el.btnClearPageNums.addEventListener('click', () => {
      state.pageNumbers = null;
      closeModal(el.modalPageNums);
      drawAnnotations();
      showToast('Αφαιρέθηκε η αρίθμηση σελίδων');
    });

    // Export Images modal (PNG / JPG · 150 / 300 DPI · Current / All)
    el.expScopeRow.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.expScope = btn.dataset.scope;
        el.expScopeRow.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });
    el.expFmtRow.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.expFmt = btn.dataset.fmt;
        el.expFmtRow.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });
    el.expDpiRow.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.expDpi = parseInt(btn.dataset.dpi, 10) || 300;
        el.expDpiRow.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });
    el.btnConfirmExportImgs.addEventListener('click', async () => {
      closeModal(el.modalExportImgs);
      await exportPagesToImages(state.expScope, state.expFmt, state.expDpi);
    });

    // Prepress Document Properties modal (Ctrl+D)
    el.btnSaveDocMeta.addEventListener('click', () => {
      state.docMeta = {
        title: el.inpMetaTitle.value.trim(),
        author: el.inpMetaAuthor.value.trim() || BRAND_AUTHOR
      };
      state.dirty = true;
      closeModal(el.modalDocInfo);
      showToast('Ενημερώθηκαν τα μεταδεδομένα (θα γραφτούν στην Αποθήκευση)');
    });

    // Generic modal close buttons & backdrop click
    document.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => closeModal($(btn.dataset.close)));
    });
    document.querySelectorAll('.modal-backdrop').forEach((bd) => {
      bd.addEventListener('click', (e) => {
        if (e.target === bd) closeModal(bd);
      });
    });

    // Spacebar release ends Hand Pan mode
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space' && state.spaceDown) {
        state.spaceDown = false;
        el.deskViewport.classList.remove('panning');
      }
    });

    // Protect unsaved work on accidental tab/window close
    window.addEventListener('beforeunload', (e) => {
      if (state.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    // Global Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (state.pdfBytes) el.btnSaveOpen.click();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        triggerOpenPdf();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        if (state.pdfDoc) openDocInfoModal();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        if (state.pdfDoc) { state.fitWidth = true; renderCurrentPage(true); }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '1') {
        e.preventDefault();
        if (state.pdfDoc) { state.fitWidth = false; state.zoom = 1.0; renderCurrentPage(false); }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        if (state.pdfDoc) {
          el.searchBar.hidden = false;
          el.inpSearch.focus();
          el.inpSearch.select();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !typing) {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === 'Escape') {
        closeMoreMenu();
        document.querySelectorAll('.modal-backdrop:not([hidden])').forEach((m) => closeModal(m));
        if (!el.searchBar.hidden) el.btnSearchClose.click();
        setTool('select');
        return;
      }

      if (typing || !state.pdfDoc) return;

      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        state.spaceDown = true;
        el.deskViewport.classList.add('panning');
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selectedId) { e.preventDefault(); deleteSelected(); }
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        goToPage(state.currentPage + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        goToPage(state.currentPage - 1);
      } else {
        const keyMap = {
          v: 'select', t: 'text', w: 'whiteout', n: 'note', h: 'highlight',
          p: 'pen', a: 'arrow', r: 'rect', s: 'sign', m: 'stamp', i: 'image'
        };
        const mapped = keyMap[e.key.toLowerCase()];
        if (mapped) setTool(mapped);
      }
    });
  }

  // ==========================================================================
  // BOOT
  // ==========================================================================
  bindEvents();
  initDesktopBridge();
})();
