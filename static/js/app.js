/**
 * ImgML — Frontend Application Logic
 *
 * Handles:
 * 1. Tab switching between Upload PDFs and arXiv Search
 * 2. Drag & drop / file upload, progress, image preview, ZIP downloads
 * 3. arXiv search, paper selection, extraction, and results display
 */

(function () {
    'use strict';

    // ============================================================
    // DOM Elements — Upload Tab
    // ============================================================
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const fileList = document.getElementById('file-list');
    const fileItems = document.getElementById('file-items');
    const extractBtn = document.getElementById('extract-btn');

    const uploadSection = document.getElementById('upload-section');
    const progressSection = document.getElementById('progress-section');
    const progressText = document.getElementById('progress-text');
    const progressFill = document.getElementById('progress-fill');

    const resultsSection = document.getElementById('results-section');
    const resultsSummary = document.getElementById('results-summary');
    const errorsContainer = document.getElementById('errors-container');
    const imageGrid = document.getElementById('image-grid');
    const downloadAllBtn = document.getElementById('download-btn');
    const downloadEachBtn = document.getElementById('download-each-btn');
    const newExtractionBtn = document.getElementById('new-extraction-btn');

    // ============================================================
    // DOM Elements — arXiv Tab
    // ============================================================
    const arxivQuery = document.getElementById('arxiv-query');
    const arxivSort = document.getElementById('arxiv-sort');
    const arxivSearchBtn = document.getElementById('arxiv-search-btn');
    const arxivSearchSection = document.getElementById('arxiv-search-section');
    const arxivSearching = document.getElementById('arxiv-searching');
    const arxivSearchStatus = document.getElementById('arxiv-search-status');
    const arxivResultsSection = document.getElementById('arxiv-results-section');
    const arxivResultsCount = document.getElementById('arxiv-results-count');
    const arxivSelectedCount = document.getElementById('arxiv-selected-count');
    const arxivSelectAllBtn = document.getElementById('arxiv-select-all');
    const arxivExtractBtn = document.getElementById('arxiv-extract-btn');
    const arxivPapersList = document.getElementById('arxiv-papers-list');
    const arxivLoadMoreWrap = document.getElementById('arxiv-load-more-wrap');
    const arxivLoadMoreBtn = document.getElementById('arxiv-load-more');

    const arxivExtractProgress = document.getElementById('arxiv-extract-progress');
    const arxivExtractStatus = document.getElementById('arxiv-extract-status');
    const arxivProgressFill = document.getElementById('arxiv-progress-fill');

    const arxivExtractionResults = document.getElementById('arxiv-extraction-results');
    const arxivExtractSummary = document.getElementById('arxiv-extract-summary');
    const arxivDownloadAll = document.getElementById('arxiv-download-all');
    const arxivDownloadEach = document.getElementById('arxiv-download-each');
    const arxivNewSearch = document.getElementById('arxiv-new-search');
    const arxivExtractErrors = document.getElementById('arxiv-extract-errors');
    const arxivExtractGrid = document.getElementById('arxiv-extract-grid');

    // ============================================================
    // State
    // ============================================================
    let selectedFiles = [];
    let currentSessionId = null;
    let arxivSelectedPapers = new Map(); // arxiv_id => paper data
    let arxivCurrentQuery = '';
    let arxivCurrentStart = 0;
    let arxivTotalResults = 0;
    let arxivSessionId = null;

    // ============================================================
    // Utility Functions
    // ============================================================
    function formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function show(el) { el.classList.remove('hidden'); }
    function hide(el) { el.classList.add('hidden'); }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ============================================================
    // Tab Navigation
    // ============================================================
    document.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;

            // Update button states
            document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');

            // Update content visibility
            document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
            document.getElementById('tab-' + tab).classList.add('active');
        });
    });

    // ============================================================
    // UPLOAD TAB — Drag & Drop, File Management, Extraction
    // ============================================================

    // --- Drag & Drop ---
    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');

        const files = Array.from(e.dataTransfer.files).filter(
            (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
        );

        if (files.length > 0) {
            addFiles(files);
        }
    });

    fileInput.addEventListener('change', () => {
        const files = Array.from(fileInput.files);
        if (files.length > 0) {
            addFiles(files);
        }
        fileInput.value = '';
    });

    // --- File Management ---
    function addFiles(files) {
        for (const file of files) {
            const exists = selectedFiles.some(
                (f) => f.name === file.name && f.size === file.size
            );
            if (!exists) {
                selectedFiles.push(file);
            }
        }
        renderFileList();
    }

    function removeFile(index) {
        selectedFiles.splice(index, 1);
        renderFileList();
    }

    function renderFileList() {
        if (selectedFiles.length === 0) {
            hide(fileList);
            return;
        }

        show(fileList);
        fileItems.innerHTML = '';

        selectedFiles.forEach((file, idx) => {
            const li = document.createElement('li');
            li.innerHTML = `
                <span class="file-name">
                    <span class="pdf-icon">PDF</span>
                    ${escapeHtml(file.name)}
                </span>
                <span class="file-size">${formatFileSize(file.size)}</span>
                <button class="file-remove" data-index="${idx}" title="Remove">&times;</button>
            `;
            fileItems.appendChild(li);
        });

        fileItems.querySelectorAll('.file-remove').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                removeFile(parseInt(btn.dataset.index));
            });
        });
    }

    // --- Upload & Extraction ---
    extractBtn.addEventListener('click', async () => {
        if (selectedFiles.length === 0) return;

        hide(uploadSection);
        hide(resultsSection);
        show(progressSection);

        progressFill.style.width = '0%';
        progressText.textContent = 'Uploading files...';

        const formData = new FormData();
        for (const file of selectedFiles) {
            formData.append('files', file);
        }

        try {
            let progress = 0;
            const progressInterval = setInterval(() => {
                if (progress < 85) {
                    progress += Math.random() * 8;
                    progressFill.style.width = Math.min(progress, 85) + '%';
                }
            }, 300);

            progressText.textContent = `Processing ${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''}...`;

            const response = await fetch('/upload', {
                method: 'POST',
                body: formData,
            });

            clearInterval(progressInterval);

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Upload failed');
            }

            const data = await response.json();

            progressFill.style.width = '100%';
            progressText.textContent = 'Extraction complete!';

            await new Promise((r) => setTimeout(r, 500));

            currentSessionId = data.session_id;
            showResults(data);
        } catch (error) {
            progressFill.style.width = '100%';
            progressFill.style.background = 'linear-gradient(135deg, #f87171, #dc2626)';
            progressText.textContent = `Error: ${error.message}`;

            setTimeout(() => {
                hide(progressSection);
                show(uploadSection);
                progressFill.style.background = '';
            }, 3000);
        }
    });

    // --- Results Display (shared between Upload and arXiv) ---
    function showResults(data, containerOverrides) {
        const containers = containerOverrides || {
            section: resultsSection,
            progressSection: progressSection,
            summary: resultsSummary,
            errors: errorsContainer,
            grid: imageGrid,
            downloadAll: downloadAllBtn,
            downloadEach: downloadEachBtn,
        };

        hide(containers.progressSection);
        show(containers.section);

        const count = data.total_images;
        const paperCount = data.papers ? data.papers.length : 0;
        containers.summary.textContent = `Found ${count} image${count !== 1 ? 's' : ''} across ${paperCount} PDF${paperCount !== 1 ? 's' : ''}`;

        // Show errors if any
        if (data.errors && data.errors.length > 0) {
            show(containers.errors);
            containers.errors.innerHTML = data.errors
                .map((e) => `<p>⚠ ${escapeHtml(e)}</p>`)
                .join('');
        } else {
            hide(containers.errors);
        }

        // Render grouped image results
        containers.grid.innerHTML = '';

        if (data.papers && data.papers.length > 0) {
            data.papers.forEach((paper) => {
                const group = document.createElement('div');
                group.className = 'paper-group';

                const header = document.createElement('div');
                header.className = 'paper-group-header';

                const titleArea = document.createElement('div');
                titleArea.className = 'paper-group-title';
                titleArea.innerHTML = `
                    <span class="paper-pdf-badge">PDF</span>
                    <h3>${escapeHtml(paper.paper_name)}</h3>
                    <span class="paper-img-count">${paper.image_count} image${paper.image_count !== 1 ? 's' : ''}</span>
                `;

                header.appendChild(titleArea);

                if (paper.download_url && paper.image_count > 0) {
                    const dlBtn = document.createElement('button');
                    dlBtn.className = 'btn btn-sm btn-outline';
                    dlBtn.innerHTML = `
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        Download ZIP
                    `;
                    dlBtn.onclick = () => {
                        window.location.href = paper.download_url;
                    };
                    header.appendChild(dlBtn);
                }

                group.appendChild(header);

                if (paper.images && paper.images.length > 0) {
                    const grid = document.createElement('div');
                    grid.className = 'paper-image-grid';

                    paper.images.forEach((img) => {
                        const card = document.createElement('div');
                        card.className = 'image-card';
                        card.innerHTML = `
                            <div class="image-card-thumb">
                                <img src="/thumbnail/${data.session_id}/${encodeURIComponent(img.paper_key)}/${encodeURIComponent(img.filename)}"
                                     alt="${escapeHtml(img.label)}"
                                     loading="lazy">
                            </div>
                            <div class="image-card-info">
                                <div class="image-card-label" title="${escapeHtml(img.filename)}">${escapeHtml(img.label)}</div>
                                <div class="image-card-meta">
                                    <span>${img.width}×${img.height}</span>
                                    <span>Page ${img.page}</span>
                                </div>
                            </div>
                        `;
                        grid.appendChild(card);
                    });

                    group.appendChild(grid);
                } else {
                    const empty = document.createElement('div');
                    empty.className = 'paper-empty';
                    empty.textContent = 'No images found in this paper.';
                    group.appendChild(empty);
                }

                containers.grid.appendChild(group);
            });

            // Download All
            containers.downloadAll.onclick = () => {
                window.location.href = data.download_all_url;
            };

            // Download Each — staggered individual ZIP downloads
            containers.downloadEach.onclick = () => {
                const downloadablePapers = data.papers.filter(p => p.download_url && p.image_count > 0);
                downloadablePapers.forEach((paper, idx) => {
                    setTimeout(() => {
                        const a = document.createElement('a');
                        a.href = paper.download_url;
                        a.download = '';
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                    }, idx * 500);
                });
            };

            if (paperCount > 1) {
                show(containers.downloadAll);
                show(containers.downloadEach);
            } else {
                hide(containers.downloadAll);
                hide(containers.downloadEach);
            }
        } else {
            containers.grid.innerHTML = `
                <div style="text-align: center; padding: 40px; color: var(--text-muted);">
                    <p>No images were found in the uploaded PDFs.</p>
                </div>
            `;
        }
    }

    // --- New Extraction ---
    newExtractionBtn.addEventListener('click', () => {
        if (currentSessionId) {
            fetch(`/cleanup/${currentSessionId}`, { method: 'POST' }).catch(() => { });
            currentSessionId = null;
        }

        selectedFiles = [];
        renderFileList();
        imageGrid.innerHTML = '';
        hide(errorsContainer);

        hide(resultsSection);
        hide(progressSection);
        show(uploadSection);
    });


    // ============================================================
    // ARXIV TAB — Search, Selection, Extraction
    // ============================================================

    // --- Search ---
    arxivSearchBtn.addEventListener('click', () => performArxivSearch(true));

    arxivQuery.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            performArxivSearch(true);
        }
    });

    async function performArxivSearch(isNewSearch) {
        const query = arxivQuery.value.trim();
        if (!query) return;

        if (isNewSearch) {
            arxivCurrentQuery = query;
            arxivCurrentStart = 0;
            arxivPapersList.innerHTML = '';
            arxivSelectedPapers.clear();
            updateSelectionUI();
        }

        // Show searching indicator
        show(arxivSearching);
        hide(arxivResultsSection);
        hide(arxivExtractionResults);
        hide(arxivExtractProgress);
        arxivSearchStatus.textContent = 'Querying the arXiv database...';

        const sort = arxivSort.value;
        const size = 50;

        try {
            const url = `/arxiv/search?q=${encodeURIComponent(arxivCurrentQuery)}&start=${arxivCurrentStart}&size=${size}&sort=${sort}`;
            const response = await fetch(url);

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Search failed');
            }

            const data = await response.json();
            arxivTotalResults = data.total_results;

            hide(arxivSearching);
            show(arxivResultsSection);

            // Update results count
            const endIndex = Math.min(arxivCurrentStart + data.papers.length, arxivTotalResults);
            arxivResultsCount.textContent = `Showing ${arxivCurrentStart + 1}–${endIndex} of ${arxivTotalResults.toLocaleString()} results for "${escapeHtml(arxivCurrentQuery)}"`;

            // Render papers
            renderArxivPapers(data.papers);

            // Update pagination
            arxivCurrentStart += data.papers.length;
            if (arxivCurrentStart < arxivTotalResults && data.papers.length === size) {
                show(arxivLoadMoreWrap);
            } else {
                hide(arxivLoadMoreWrap);
            }

        } catch (error) {
            hide(arxivSearching);
            show(arxivResultsSection);
            arxivResultsCount.textContent = `Error: ${error.message}`;
            hide(arxivLoadMoreWrap);
        }
    }

    function renderArxivPapers(papers) {
        papers.forEach((paper) => {
            const card = document.createElement('div');
            card.className = 'arxiv-paper-card';
            card.dataset.arxivId = paper.arxiv_id;

            if (arxivSelectedPapers.has(paper.arxiv_id)) {
                card.classList.add('selected');
            }

            // Authors (show max 5)
            const authorStr = paper.authors.length > 5
                ? paper.authors.slice(0, 5).join(', ') + ` +${paper.authors.length - 5} more`
                : paper.authors.join(', ');

            // Categories
            const catHtml = paper.categories.slice(0, 4).map((cat) => {
                const isPrimary = cat === paper.primary_category;
                return `<span class="arxiv-cat-badge${isPrimary ? ' primary' : ''}">${escapeHtml(cat)}</span>`;
            }).join('');

            card.innerHTML = `
                <div class="arxiv-paper-top">
                    <div class="arxiv-checkbox">
                        <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="20 6 9 17 4 12"/>
                        </svg>
                    </div>
                    <div class="arxiv-paper-body">
                        <div class="arxiv-paper-title">${escapeHtml(paper.title)}</div>
                        <div class="arxiv-paper-authors">${escapeHtml(authorStr)}</div>
                        <div class="arxiv-paper-meta">
                            <span class="arxiv-paper-id">${escapeHtml(paper.arxiv_id)}</span>
                            <span class="arxiv-paper-date">Published: ${paper.published}</span>
                            ${paper.comment ? `<span class="arxiv-paper-date">${escapeHtml(paper.comment.substring(0, 60))}</span>` : ''}
                        </div>
                        <div class="arxiv-categories">${catHtml}</div>
                        ${paper.abstract ? `
                            <div class="arxiv-abstract">
                                <div class="arxiv-abstract-text">${escapeHtml(paper.abstract)}</div>
                                <button class="abstract-toggle" onclick="event.stopPropagation(); this.parentElement.classList.toggle('expanded'); this.textContent = this.parentElement.classList.contains('expanded') ? 'Show less' : 'Show more'">Show more</button>
                            </div>
                        ` : ''}
                        <div class="arxiv-paper-links">
                            <a href="${paper.abs_url}" target="_blank" rel="noopener" class="arxiv-link" onclick="event.stopPropagation()">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                                Abstract
                            </a>
                            <a href="${paper.pdf_url}" target="_blank" rel="noopener" class="arxiv-link" onclick="event.stopPropagation()">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                PDF
                            </a>
                        </div>
                    </div>
                </div>
            `;

            // Toggle selection on click
            card.addEventListener('click', () => {
                const id = paper.arxiv_id;
                if (arxivSelectedPapers.has(id)) {
                    arxivSelectedPapers.delete(id);
                    card.classList.remove('selected');
                } else {
                    if (arxivSelectedPapers.size >= 50) {
                        // Flash the limit warning
                        arxivSelectedCount.textContent = 'Max 50 papers!';
                        arxivSelectedCount.style.color = 'var(--error)';
                        setTimeout(() => {
                            arxivSelectedCount.style.color = '';
                            updateSelectionUI();
                        }, 1500);
                        return;
                    }
                    arxivSelectedPapers.set(id, {
                        arxiv_id: id,
                        title: paper.title,
                    });
                    card.classList.add('selected');
                }
                updateSelectionUI();
            });

            arxivPapersList.appendChild(card);
        });
    }

    function updateSelectionUI() {
        const count = arxivSelectedPapers.size;
        arxivSelectedCount.textContent = `${count} selected`;
        arxivExtractBtn.disabled = count === 0;

        if (count === 0) {
            arxivSelectAllBtn.textContent = 'Select All';
        } else {
            arxivSelectAllBtn.textContent = 'Deselect All';
        }
    }

    // --- Select / Deselect All ---
    arxivSelectAllBtn.addEventListener('click', () => {
        const cards = arxivPapersList.querySelectorAll('.arxiv-paper-card');

        if (arxivSelectedPapers.size > 0) {
            // Deselect all
            arxivSelectedPapers.clear();
            cards.forEach((c) => c.classList.remove('selected'));
        } else {
            // Select all visible (up to 50)
            let count = 0;
            cards.forEach((card) => {
                if (count >= 50) return;
                const id = card.dataset.arxivId;
                const titleEl = card.querySelector('.arxiv-paper-title');
                arxivSelectedPapers.set(id, {
                    arxiv_id: id,
                    title: titleEl ? titleEl.textContent : id,
                });
                card.classList.add('selected');
                count++;
            });
        }
        updateSelectionUI();
    });

    // --- Load More ---
    arxivLoadMoreBtn.addEventListener('click', () => {
        performArxivSearch(false);
    });

    // --- Extract Selected ---
    arxivExtractBtn.addEventListener('click', async () => {
        if (arxivSelectedPapers.size === 0) return;

        // Switch to progress view
        hide(arxivResultsSection);
        hide(arxivSearchSection);
        show(arxivExtractProgress);
        hide(arxivExtractionResults);

        arxivProgressFill.style.width = '0%';
        arxivExtractStatus.textContent = `Downloading ${arxivSelectedPapers.size} paper${arxivSelectedPapers.size > 1 ? 's' : ''} from arXiv...`;

        try {
            let progress = 0;
            const progressInterval = setInterval(() => {
                if (progress < 80) {
                    progress += Math.random() * 3;
                    arxivProgressFill.style.width = Math.min(progress, 80) + '%';
                }
                // Update status text based on progress
                if (progress > 20 && progress < 50) {
                    arxivExtractStatus.textContent = 'Downloading PDFs and extracting images...';
                } else if (progress > 50) {
                    arxivExtractStatus.textContent = 'Creating ZIP archives...';
                }
            }, 500);

            const papersToExtract = Array.from(arxivSelectedPapers.values());

            const response = await fetch('/arxiv/extract', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ papers: papersToExtract }),
            });

            clearInterval(progressInterval);

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Extraction failed');
            }

            const data = await response.json();

            arxivProgressFill.style.width = '100%';
            arxivExtractStatus.textContent = 'Extraction complete!';

            await new Promise((r) => setTimeout(r, 500));

            arxivSessionId = data.session_id;

            // Show extraction results using shared renderer
            showResults(data, {
                section: arxivExtractionResults,
                progressSection: arxivExtractProgress,
                summary: arxivExtractSummary,
                errors: arxivExtractErrors,
                grid: arxivExtractGrid,
                downloadAll: arxivDownloadAll,
                downloadEach: arxivDownloadEach,
            });

        } catch (error) {
            arxivProgressFill.style.width = '100%';
            arxivProgressFill.style.background = 'linear-gradient(135deg, #f87171, #dc2626)';
            arxivExtractStatus.textContent = `Error: ${error.message}`;

            setTimeout(() => {
                hide(arxivExtractProgress);
                show(arxivSearchSection);
                show(arxivResultsSection);
                arxivProgressFill.style.background = '';
            }, 4000);
        }
    });

    // --- New Search (from results) ---
    arxivNewSearch.addEventListener('click', () => {
        if (arxivSessionId) {
            fetch(`/cleanup/${arxivSessionId}`, { method: 'POST' }).catch(() => { });
            arxivSessionId = null;
        }

        arxivSelectedPapers.clear();
        arxivPapersList.innerHTML = '';
        arxivExtractGrid.innerHTML = '';
        updateSelectionUI();

        hide(arxivExtractionResults);
        hide(arxivExtractProgress);
        hide(arxivResultsSection);
        show(arxivSearchSection);

        arxivQuery.value = '';
        arxivQuery.focus();
    });

})();
