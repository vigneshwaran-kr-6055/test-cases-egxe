/**
 * history.js
 * Renders the History tab for generated, reviewed, and summarised test cases.
 * Reads entries from localStorage keys:
 *   tca_gen_history  – generated test cases
 *   tca_rev_history  – reviewed / analysed test cases
 *   tca_sum_history  – test case summaries
 */

'use strict';

(function () {

    /* ─────────────────────────────────────────────
       Constants
    ───────────────────────────────────────────── */
    const GEN_KEY = 'tca_gen_history';
    const REV_KEY = 'tca_rev_history';
    const SUM_KEY = 'tca_sum_history';
    const PAGE_SIZE = 5;

    /* ─────────────────────────────────────────────
       Pagination state (current page per category)
    ───────────────────────────────────────────── */
    var pageState = { generated: 1, reviewed: 1, summarised: 1 };

    /* ─────────────────────────────────────────────
       Helpers
    ───────────────────────────────────────────── */
    function esc(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatDate(iso) {
        try {
            return new Date(iso).toLocaleString(undefined, {
                year: 'numeric', month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit',
            });
        } catch (e) { return iso; }
    }

    function loadHistory(key) {
        try { return JSON.parse(localStorage.getItem(key) || '[]'); }
        catch (e) { return []; }
    }

    function saveHistory(key, entries) {
        try { localStorage.setItem(key, JSON.stringify(entries)); } catch (e) { /* quota */ }
    }

    /* ─────────────────────────────────────────────
       CSV export helper (mirrors generator logic)
    ───────────────────────────────────────────── */
    function exportGenCsv(entry) {
        const tcs    = entry.testCases || [];
        const header = ['Test Case ID', 'Use Case Ref', 'Test Case', 'Precondition', 'Steps', 'Expected Results', 'Severity', 'Type'];
        const rows   = tcs.map(function (tc) {
            return [
                tc.id,
                tc.ucRef,
                tc.title,
                Array.isArray(tc.description) ? tc.description.join(' | ') : String(tc.description || ''),
                Array.isArray(tc.steps)        ? tc.steps.join(' | ')       : String(tc.steps || ''),
                tc.expectedResult || '',
                tc.severity,
                tc.type,
            ];
        });
        const csv = [header, ...rows]
            .map(function (row) {
                return row.map(function (cell) { return '"' + String(cell).replace(/"/g, '""') + '"'; }).join(',');
            })
            .join('\r\n');
        downloadFile(csv, 'text/csv;charset=utf-8;', entry.fileName.replace(/\.[^.]+$/, '') + '-test-cases.csv');
    }

    function downloadFile(content, mimeType, fileName) {
        var blob = new Blob([content], { type: mimeType });
        var url  = URL.createObjectURL(blob);
        var a    = document.createElement('a');
        a.href     = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
    }

    /* ─────────────────────────────────────────────
       Modal helpers
    ───────────────────────────────────────────── */
    function openModal(titleText, bodyHtml) {
        var overlay = document.getElementById('hist-modal-overlay');
        var title   = document.getElementById('hist-modal-title');
        var body    = document.getElementById('hist-modal-body');
        title.textContent = titleText;
        body.innerHTML    = bodyHtml;
        overlay.hidden    = false;
        document.body.classList.add('hist-modal-open');
        overlay.focus();
    }

    function closeModal() {
        var overlay = document.getElementById('hist-modal-overlay');
        overlay.hidden = true;
        document.body.classList.remove('hist-modal-open');
        var body = document.getElementById('hist-modal-body');
        body.innerHTML = '';
    }

    /* ─────────────────────────────────────────────
       Build modal content for generated entry
    ───────────────────────────────────────────── */
    function buildGenDetailHtml(entry) {
        var tcs  = entry.testCases || [];
        var sum  = entry.summary   || {};
        var bySev  = sum.bySeverity || {};
        var byType = sum.byType     || {};

        var html = '';

        // Summary chips
        html += '<div class="hist-detail-summary">';
        html += '<div class="hist-stat-row">';
        html += '<div class="hist-stat-chip"><div class="num">' + esc(sum.total || tcs.length) + '</div><div class="lbl">Total</div></div>';
        html += '<div class="hist-stat-chip" style="border-top:3px solid #3d0000"><div class="num" style="color:#3d0000">' + esc(bySev.showstopper || 0) + '</div><div class="lbl">Showstopper</div></div>';
        html += '<div class="hist-stat-chip" style="border-top:3px solid #b71c1c"><div class="num" style="color:#b71c1c">' + esc(bySev.critical    || 0) + '</div><div class="lbl">Critical</div></div>';
        html += '<div class="hist-stat-chip" style="border-top:3px solid #e65100"><div class="num" style="color:#e65100">' + esc(bySev.major       || 0) + '</div><div class="lbl">Major</div></div>';
        html += '<div class="hist-stat-chip" style="border-top:3px solid #f9a825"><div class="num" style="color:#f9a825">' + esc(bySev.minor       || 0) + '</div><div class="lbl">Minor</div></div>';
        html += '</div>';
        html += '<div class="hist-stat-row" style="margin-top:10px;">';
        html += '<div class="hist-stat-chip" style="border-top:3px solid #1a73e8"><div class="num" style="color:#1a73e8">' + esc(byType.functional           || 0) + '</div><div class="lbl">Functional</div></div>';
        html += '<div class="hist-stat-chip" style="border-top:3px solid #2e7d32"><div class="num" style="color:#2e7d32">' + esc(byType['non-functional']    || 0) + '</div><div class="lbl">Non-functional</div></div>';
        html += '<div class="hist-stat-chip" style="border-top:3px solid #6a1b9a"><div class="num" style="color:#6a1b9a">' + esc(byType.ui                   || 0) + '</div><div class="lbl">UI</div></div>';
        html += '<div class="hist-stat-chip" style="border-top:3px solid #e65100"><div class="num" style="color:#e65100">' + esc(byType.privacy              || 0) + '</div><div class="lbl">Privacy</div></div>';
        html += '<div class="hist-stat-chip" style="border-top:3px solid #c62828"><div class="num" style="color:#c62828">' + esc(byType.security             || 0) + '</div><div class="lbl">Security</div></div>';
        html += '</div>';
        html += '</div>';

        // Table
        html += '<div class="hist-table-wrapper"><table class="hist-detail-table"><thead><tr>';
        ['Test Case ID','Use Case Ref','Test Case','Precondition','Steps','Expected Results','Severity','Type']
            .forEach(function (h) { html += '<th>' + esc(h) + '</th>'; });
        html += '</tr></thead><tbody>';

        var limit = Math.min(tcs.length, 200);
        for (var i = 0; i < limit; i++) {
            var tc = tcs[i];
            var stepsHtml = Array.isArray(tc.steps) && tc.steps.length
                ? '<ol class="tc-list">' + tc.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>'
                : esc(String(tc.steps || ''));
            var descHtml = Array.isArray(tc.description)
                ? tc.description.map(function (d) { return esc(d); }).join(' ')
                : esc(String(tc.description || ''));
            html += '<tr>';
            html += '<td>' + esc(tc.id)                         + '</td>';
            html += '<td>' + esc(tc.ucRef || '')                + '</td>';
            html += '<td>' + esc(tc.title || '')                + '</td>';
            html += '<td>' + descHtml                           + '</td>';
            html += '<td>' + stepsHtml                          + '</td>';
            html += '<td>' + esc(tc.expectedResult || '')       + '</td>';
            html += '<td><span class="badge-severity sev-'  + esc(tc.severity) + '">' + esc(tc.severity) + '</span></td>';
            html += '<td><span class="badge-type type-'     + esc(tc.type)     + '">' + esc(tc.type)     + '</span></td>';
            html += '</tr>';
        }
        if (tcs.length > limit) {
            html += '<tr><td colspan="8" style="text-align:center;color:#888;padding:10px">… ' + (tcs.length - limit) + ' more rows not shown</td></tr>';
        }
        html += '</tbody></table></div>';

        return html;
    }

    /* ─────────────────────────────────────────────
       Build modal content for reviewed entry
    ───────────────────────────────────────────── */
    function buildRevDetailHtml(entry) {
        var html = '';

        // Feature summary
        if (entry.featureSummary) {
            html += '<div class="hist-feature-summary"><strong>Feature Overview</strong><div class="hist-feature-text">' + entry.featureSummary + '</div></div>';
        }

        // Summary chips
        var missing = function (checks) {
            return (checks || []).filter(function (x) { return !x.covered && !x.notApplicable; }).length;
        };
        html += '<div class="hist-detail-summary">';
        html += '<div class="hist-stat-row">';
        html += '<div class="hist-stat-chip"><div class="num">' + esc(entry.totalRows || 0) + '</div><div class="lbl">Total test cases</div></div>';
        html += '<div class="hist-stat-chip"><div class="num">' + esc((entry.features || []).length || '—') + '</div><div class="lbl">Features detected</div></div>';
        html += '<div class="hist-stat-chip" style="border-top:3px solid #e53935"><div class="num" style="color:#e53935">' + esc(missing(entry.functional))  + '</div><div class="lbl">Functional gaps</div></div>';
        html += '<div class="hist-stat-chip" style="border-top:3px solid #fb8c00"><div class="num" style="color:#fb8c00">' + esc(missing(entry.privacy))     + '</div><div class="lbl">Privacy gaps</div></div>';
        html += '<div class="hist-stat-chip" style="border-top:3px solid #8e24aa"><div class="num" style="color:#8e24aa">' + esc(missing(entry.security))    + '</div><div class="lbl">Security gaps</div></div>';
        html += '<div class="hist-stat-chip" style="border-top:3px solid #00897b"><div class="num" style="color:#00897b">' + esc(missing(entry.performance)) + '</div><div class="lbl">Performance gaps</div></div>';
        if (entry.compatibility) html += '<div class="hist-stat-chip" style="border-top:3px solid #0277bd"><div class="num" style="color:#0277bd">' + esc(missing(entry.compatibility)) + '</div><div class="lbl">Compatibility gaps</div></div>';
        html += '</div>';
        html += '</div>';

        // Features
        if (entry.features && entry.features.length) {
            html += '<div class="hist-features-section"><strong>Detected Features</strong><div class="hist-feature-tags">';
            entry.features.forEach(function (f) {
                html += '<span class="feature-tag">' + esc(f) + '</span>';
            });
            html += '</div></div>';
        }

        // Gap sections
        var gapSections = [
            { label: '⚙️ Functional Test Gaps',     checks: entry.functional    },
            { label: '🔒 Privacy Test Gaps',         checks: entry.privacy       },
            { label: '🛡 Security Test Gaps',        checks: entry.security      },
            { label: '⚡ Performance Test Gaps',     checks: entry.performance   },
            { label: '🌐 Compatibility Test Gaps',   checks: entry.compatibility },
        ];
        gapSections.forEach(function (gs) {
            if (!gs.checks) return; // skip compatibility section for old history entries
            html += '<div class="hist-gap-section">';
            html += '<h3 class="hist-gap-title">' + esc(gs.label) + '</h3>';
            var checks  = gs.checks || [];
            var missList = checks.filter(function (c) { return !c.covered && !c.notApplicable; });
            var covList  = checks.filter(function (c) { return  c.covered && !c.notApplicable; });
            if (!missList.length) {
                html += '<div class="hist-no-gaps">✅ No obvious gaps detected.</div>';
            } else {
                html += '<ul class="hist-gap-list">';
                missList.forEach(function (c) {
                    html += '<li class="hist-gap-item"><span class="icon-mark">❌</span><span>' + esc(c.label) + '</span>';
                    html += '<span class="severity-badge severity-' + esc(c.severity) + '">' + esc(c.severity) + '</span></li>';
                });
                html += '</ul>';
            }
            if (covList.length) {
                html += '<ul class="hist-gap-list hist-covered-list">';
                covList.forEach(function (c) {
                    html += '<li class="hist-ok-item"><span class="icon-mark">✅</span><span>' + esc(c.label) + '</span></li>';
                });
                html += '</ul>';
            }
            html += '</div>';
        });

        // Parsed test cases table
        if (entry.headers && entry.rows) {
            html += '<div class="hist-table-wrapper" style="margin-top:20px"><strong>Parsed Test Cases</strong><table class="hist-detail-table" style="margin-top:10px"><thead><tr>';
            entry.headers.forEach(function (h) { html += '<th>' + esc(h) + '</th>'; });
            html += '</tr></thead><tbody>';
            var limit = Math.min(entry.rows.length, 200);
            for (var i = 0; i < limit; i++) {
                var row = entry.rows[i];
                html += '<tr>';
                entry.headers.forEach(function (h) {
                    html += '<td>' + esc(row[h] !== null && row[h] !== undefined ? row[h] : '') + '</td>';
                });
                html += '</tr>';
            }
            if (entry.rows.length > limit) {
                html += '<tr><td colspan="' + entry.headers.length + '" style="text-align:center;color:#888;padding:10px">… ' + (entry.rows.length - limit) + ' more rows not shown</td></tr>';
            }
            html += '</tbody></table></div>';
        }

        return html;
    }

    /* ─────────────────────────────────────────────
       Render a history list (generated or reviewed)
    ───────────────────────────────────────────── */
    function renderHistoryList(containerEl, entries, type) {
        containerEl.innerHTML = '';

        if (!entries.length) {
            var emptyMsg = 'No history yet. ';
            if (type === 'generated') {
                emptyMsg += 'Generate test cases from the ⚡ Generator tab to see entries here.';
            } else if (type === 'summarised') {
                emptyMsg += 'Summarise test cases from the 📋 Summary tab to see entries here.';
            } else {
                emptyMsg += 'Analyse test cases from the 🔍 Reviewer tab to see entries here.';
            }
            containerEl.innerHTML = '<p class="hist-empty">' + emptyMsg + '</p>';
            return;
        }

        var totalPages = Math.ceil(entries.length / PAGE_SIZE);
        var currentPage = pageState[type] || 1;
        if (currentPage > totalPages || currentPage < 1) currentPage = Math.max(1, totalPages);
        pageState[type] = currentPage;

        var start = (currentPage - 1) * PAGE_SIZE;
        var pageEntries = entries.slice(start, start + PAGE_SIZE);

        pageEntries.forEach(function (entry, idx) {
            var card = document.createElement('div');
            card.className = 'hist-entry-card';
            card.setAttribute('data-id', entry.id);

            var metaHtml = '';
            if (type === 'generated') {
                var s = entry.summary || {};
                metaHtml = '<span class="hist-meta-badge">' + esc(s.total || (entry.testCases || []).length) + ' test cases</span>';
            } else if (type === 'summarised') {
                metaHtml = '<span class="hist-meta-badge">' + esc(entry.totalRows || 0) + ' test cases</span>';
                if (entry.model) {
                    metaHtml += '<span class="hist-meta-badge" style="background:var(--status-info-bg);color:var(--status-info-color)">' + esc(entry.model) + '</span>';
                }
                if ((entry.useCases || []).length) {
                    metaHtml += '<span class="hist-meta-badge">' + esc(entry.useCases.length) + ' use case(s)</span>';
                }
            } else {
                var gapCount = ['functional','privacy','security','performance','compatibility'].reduce(function (acc, k) {
                    return acc + (entry[k] || []).filter(function (c) { return !c.covered && !c.notApplicable; }).length;
                }, 0);
                metaHtml = '<span class="hist-meta-badge">' + esc(entry.totalRows) + ' rows</span>'
                         + '<span class="hist-meta-badge hist-badge-gap">' + esc(gapCount) + ' gap(s)</span>';
            }

            var fileIcon = type === 'generated' ? '⚡' : type === 'summarised' ? '📋' : '🔍';

            card.innerHTML =
                '<div class="hist-entry-left">' +
                    '<span class="hist-file-icon">' + fileIcon + '</span>' +
                    '<div class="hist-entry-info">' +
                        '<div class="hist-entry-name">' + esc(entry.fileName) + '</div>' +
                        '<div class="hist-entry-date">' + esc(formatDate(entry.timestamp)) + '</div>' +
                        '<div class="hist-entry-meta">' + metaHtml + '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="hist-entry-actions">' +
                    '<button class="hist-btn hist-btn-view"  aria-label="View details">👁 View</button>' +
                    (type === 'generated'
                        ? '<button class="hist-btn hist-btn-export" aria-label="Export CSV">⬇ Export CSV</button>'
                        : '') +
                    '<button class="hist-btn hist-btn-delete" aria-label="Delete entry">🗑</button>' +
                '</div>';

            // View button
            card.querySelector('.hist-btn-view').addEventListener('click', function () {
                var prefix = type === 'generated' ? '⚡ Generated: ' : type === 'summarised' ? '📋 Summary: ' : '🔍 Reviewed: ';
                var title  = prefix + entry.fileName + '  ·  ' + formatDate(entry.timestamp);
                var html   = type === 'generated'
                    ? buildGenDetailHtml(entry)
                    : type === 'summarised'
                        ? buildSumDetailHtml(entry)
                        : buildRevDetailHtml(entry);
                openModal(title, html);
            });

            // Export button (generated only)
            var exportBtn = card.querySelector('.hist-btn-export');
            if (exportBtn) {
                exportBtn.addEventListener('click', function () { exportGenCsv(entry); });
            }

            // Delete button
            card.querySelector('.hist-btn-delete').addEventListener('click', function () {
                var key = type === 'generated' ? GEN_KEY : type === 'summarised' ? SUM_KEY : REV_KEY;
                var all = loadHistory(key);
                var idx = all.findIndex(function (e) { return e.id === entry.id; });
                if (idx !== -1) all.splice(idx, 1);
                saveHistory(key, all);
                // Adjust page if current page is now out of range
                var newTotalPages = Math.ceil(all.length / PAGE_SIZE);
                if (newTotalPages === 0 || pageState[type] > newTotalPages) pageState[type] = Math.max(1, newTotalPages);
                renderHistory();
            });

            containerEl.appendChild(card);
        });

        // Render pagination controls if more than one page
        if (totalPages > 1) {
            var nav = document.createElement('div');
            nav.className = 'hist-pagination';

            var prevBtn = document.createElement('button');
            prevBtn.className = 'hist-page-btn hist-page-arrow';
            prevBtn.textContent = '‹';
            prevBtn.disabled = currentPage === 1;
            prevBtn.setAttribute('aria-label', 'Previous page');
            prevBtn.addEventListener('click', function () {
                pageState[type] = currentPage - 1;
                renderHistory();
            });
            nav.appendChild(prevBtn);

            for (var p = 1; p <= totalPages; p++) {
                (function (pageNum) {
                    var btn = document.createElement('button');
                    btn.className = 'hist-page-btn' + (pageNum === currentPage ? ' hist-page-btn-active' : '');
                    btn.textContent = pageNum;
                    btn.setAttribute('aria-label', 'Page ' + pageNum);
                    btn.addEventListener('click', function () {
                        pageState[type] = pageNum;
                        renderHistory();
                    });
                    nav.appendChild(btn);
                }(p));
            }

            var nextBtn = document.createElement('button');
            nextBtn.className = 'hist-page-btn hist-page-arrow';
            nextBtn.textContent = '›';
            nextBtn.disabled = currentPage === totalPages;
            nextBtn.setAttribute('aria-label', 'Next page');
            nextBtn.addEventListener('click', function () {
                pageState[type] = currentPage + 1;
                renderHistory();
            });
            nav.appendChild(nextBtn);

            containerEl.appendChild(nav);
        }
    }

    /* ─────────────────────────────────────────────
       Build modal content for summarised entry
    ───────────────────────────────────────────── */
    function buildSumDetailHtml(entry) {
        var html = '';

        // File metadata line
        if (entry.model) {
            html += '<div style="margin:0 0 18px;font-size:0.88rem;color:var(--text-secondary)">Generated with: <strong>' + esc(entry.model) + '</strong></div>';
        }

        // Feature narrative (the main content)
        if (entry.summaryHtml) {
            html += '<div class="hist-sum-content">' + entry.summaryHtml + '</div>';
        }

        return html;
    }

    /* ─────────────────────────────────────────────
       Main render
    ───────────────────────────────────────────── */
    function renderHistory() {
        var genContainer = document.getElementById('hist-gen-list');
        var revContainer = document.getElementById('hist-rev-list');
        var sumContainer = document.getElementById('hist-sum-list');
        if (!genContainer || !revContainer) return;

        var genEntries = loadHistory(GEN_KEY);
        var revEntries = loadHistory(REV_KEY);
        var sumEntries = loadHistory(SUM_KEY);

        document.getElementById('hist-gen-count').textContent = genEntries.length
            ? '(' + genEntries.length + ')'
            : '';
        document.getElementById('hist-rev-count').textContent = revEntries.length
            ? '(' + revEntries.length + ')'
            : '';
        var sumCountEl = document.getElementById('hist-sum-count');
        if (sumCountEl) {
            sumCountEl.textContent = sumEntries.length ? '(' + sumEntries.length + ')' : '';
        }

        renderHistoryList(genContainer, genEntries, 'generated');
        renderHistoryList(revContainer, revEntries, 'reviewed');
        if (sumContainer) renderHistoryList(sumContainer, sumEntries, 'summarised');
    }

    /* ─────────────────────────────────────────────
       Init
    ───────────────────────────────────────────── */
    function init() {
        renderHistory();

        // Clear all buttons
        var clearGenBtn = document.getElementById('hist-clear-gen');
        if (clearGenBtn) {
            clearGenBtn.addEventListener('click', function () {
                if (confirm('Clear all generated test case history?')) {
                    try { localStorage.removeItem(GEN_KEY); } catch (e) { /* blocked in third-party iframe */ }
                    pageState.generated = 1;
                    renderHistory();
                }
            });
        }

        var clearRevBtn = document.getElementById('hist-clear-rev');
        if (clearRevBtn) {
            clearRevBtn.addEventListener('click', function () {
                if (confirm('Clear all reviewed test case history?')) {
                    try { localStorage.removeItem(REV_KEY); } catch (e) { /* blocked in third-party iframe */ }
                    pageState.reviewed = 1;
                    renderHistory();
                }
            });
        }

        var clearSumBtn = document.getElementById('hist-clear-sum');
        if (clearSumBtn) {
            clearSumBtn.addEventListener('click', function () {
                if (confirm('Clear all test case summary history?')) {
                    try { localStorage.removeItem(SUM_KEY); } catch (e) { /* blocked in third-party iframe */ }
                    pageState.summarised = 1;
                    renderHistory();
                }
            });
        }

        // Modal close
        var closeBtn    = document.getElementById('hist-modal-close');
        var overlay     = document.getElementById('hist-modal-overlay');
        if (closeBtn) closeBtn.addEventListener('click', closeModal);
        if (overlay) {
            overlay.addEventListener('click', function (e) {
                if (e.target === overlay) closeModal();
            });
            overlay.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') closeModal();
            });
        }

        // Listen for history updates from generator / summary (same page)
        window.addEventListener('tca-history-updated', function () { renderHistory(); });

        // Listen for history updates from reviewer iframe
        window.addEventListener('message', function (e) {
            if (e.origin !== window.location.origin) return;
            if (e.data && e.data.type === 'tca-history-updated') renderHistory();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
