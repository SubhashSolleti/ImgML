/**
 * ImgML — Frontend Application Logic
 *
 * Handles drag & drop, file upload, progress tracking,
 * image preview rendering grouped by PDF, and ZIP downloads.
 */

(function () {
    'use strict';

    // --- DOM Elements ---
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

    // --- State ---
    let selectedFiles = [];
    let currentSessionId = null;

    // --- Utility Functions ---
    function formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function show(el) {
        el.classList.remove('hidden');
    }

    function hide(el) {
        el.classList.add('hidden');
    }

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
            // Avoid duplicates
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

        // Attach remove handlers
        fileItems.querySelectorAll('.file-remove').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                removeFile(parseInt(btn.dataset.index));
            });
        });
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // --- Upload & Extraction ---
    extractBtn.addEventListener('click', async () => {
        if (selectedFiles.length === 0) return;

        // Switch to progress view
        hide(uploadSection);
        hide(resultsSection);
        show(progressSection);

        progressFill.style.width = '0%';
        progressText.textContent = 'Uploading files...';

        // Build FormData
        const formData = new FormData();
        for (const file of selectedFiles) {
            formData.append('files', file);
        }

        try {
            // Animate progress indeterminately
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

            // Complete progress
            progressFill.style.width = '100%';
            progressText.textContent = 'Extraction complete!';

            await new Promise((r) => setTimeout(r, 500));

            // Show results
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

    // --- Results Display ---
    function showResults(data) {
        hide(progressSection);
        show(resultsSection);

        const count = data.total_images;
        const paperCount = data.papers ? data.papers.length : 0;
        resultsSummary.textContent = `Found ${count} image${count !== 1 ? 's' : ''} across ${paperCount} PDF${paperCount !== 1 ? 's' : ''}`;

        // Show errors if any
        if (data.errors && data.errors.length > 0) {
            show(errorsContainer);
            errorsContainer.innerHTML = data.errors
                .map((e) => `<p>⚠ ${escapeHtml(e)}</p>`)
                .join('');
        } else {
            hide(errorsContainer);
        }

        // Render grouped image results
        imageGrid.innerHTML = '';

        if (data.papers && data.papers.length > 0) {
            data.papers.forEach((paper) => {
                // Paper group container
                const group = document.createElement('div');
                group.className = 'paper-group';

                // Paper header with name and individual download button
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

                // Image grid for this paper
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

                imageGrid.appendChild(group);
            });

            // Enable "Download All" button
            downloadAllBtn.onclick = () => {
                window.location.href = data.download_all_url;
            };

            // Enable "Download Each" — staggered individual ZIP downloads
            downloadEachBtn.onclick = () => {
                const downloadablePapers = data.papers.filter(p => p.download_url && p.image_count > 0);
                downloadablePapers.forEach((paper, idx) => {
                    setTimeout(() => {
                        const a = document.createElement('a');
                        a.href = paper.download_url;
                        a.download = '';
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                    }, idx * 500);  // 500ms stagger to avoid browser blocking
                });
            };

            // Only show bulk download buttons if more than one paper
            if (paperCount > 1) {
                show(downloadAllBtn);
                show(downloadEachBtn);
            } else {
                hide(downloadAllBtn);
                hide(downloadEachBtn);
            }
        } else {
            imageGrid.innerHTML = `
                <div style="text-align: center; padding: 40px; color: var(--text-muted);">
                    <p>No images were found in the uploaded PDFs.</p>
                </div>
            `;
        }
    }

    // --- New Extraction ---
    newExtractionBtn.addEventListener('click', () => {
        // Clean up server-side session
        if (currentSessionId) {
            fetch(`/cleanup/${currentSessionId}`, { method: 'POST' }).catch(() => { });
            currentSessionId = null;
        }

        // Reset state
        selectedFiles = [];
        renderFileList();
        imageGrid.innerHTML = '';
        hide(errorsContainer);

        // Switch views
        hide(resultsSection);
        hide(progressSection);
        show(uploadSection);
    });
})();
