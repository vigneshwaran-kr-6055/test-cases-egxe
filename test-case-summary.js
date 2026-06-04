/**
 * test-case-summary.js
 * Reads an uploaded test-case spreadsheet (XLSX or CSV), optionally calls an
 * AI model (OpenAI GPT-4o or Google Gemini 1.5 Pro), and produces a concise,
 * human-readable summary of the entire test suite.
 *
 * Depends on read-excel-file (v7) already loaded by the host page.
 */

'use strict';

/* ─────────────────────────────────────────────
   Standard column name mapping
   Keys are semantic field names; values are arrays of recognised header
   variants (compared case-insensitively, trimmed).
───────────────────────────────────────────── */
const SUM_COL_MAP = {
    useCase:        ['use case', 'usecase', 'use_case', 'module', 'feature', 'epic', 'user story', 'userstory'],
    testCaseId:     ['test case id', 'tc id', 'testcaseid', 'tc_id', 'test id', 'case id', 'id'],
    testCase:       ['test case', 'test name', 'title', 'scenario', 'test scenario', 'description', 'test'],
    precondition:   ['precondition', 'pre-condition', 'pre condition', 'prerequisite', 'preconditions', 'setup'],
    steps:          ['steps', 'step', 'test steps', 'test procedure', 'procedure', 'actions', 'action'],
    expectedResult: ['expected results', 'expected result', 'expected outcome', 'expected', 'outcome', 'expected behavior'],
    severity:       ['severity', 'priority', 'impact', 'risk level', 'criticality'],
    status:         ['status', 'result', 'execution status', 'test result', 'pass/fail', 'run status'],
    isAutomatable:  ['is automatable', 'automatable', 'automation', 'can automate', 'automate', 'automation feasibility'],
    bugId:          ['bug id', 'defect id', 'issue id', 'jira id', 'bug', 'defect', 'ticket', 'linked bug'],
    comments:       ['comments', 'notes', 'remarks', 'observation', 'remark'],
};

/* ─────────────────────────────────────────────
   Column detection helper
───────────────────────────────────────────── */
function detectSumColumns(headers) {
    const normalised = headers.map(h => String(h).trim().toLowerCase());
    const result = {};
    Object.entries(SUM_COL_MAP).forEach(function ([field, variants]) {
        for (var i = 0; i < variants.length; i++) {
            var idx = normalised.indexOf(variants[i]);
            if (idx !== -1) { result[field] = headers[idx]; break; }
        }
    });
    return result; // { useCase: 'Use Case', testCase: 'Test Case', … }
}

/* ─────────────────────────────────────────────
   File parsing helpers (XLSX + CSV)
───────────────────────────────────────────── */

/**
 * Mask personally identifiable information (PII) in a cell value.
 * Detected patterns are replaced with bracketed labels so that no raw
 * personal data is retained in memory, displayed in the UI, or persisted
 * to localStorage history.  Non-string values are coerced to string before
 * scanning so that numeric card/SSN values stored in XLSX cells are covered.
 *
 * Patterns covered:
 *   - Email addresses          → [EMAIL]
 *   - Credit / debit card nos. → [CARD]
 *   - US SSNs (000-00-0000)    → [SSN]
 *   - Phone numbers            → [PHONE]
 *   - IPv4 addresses           → [IP]
 *
 * @param {*} value  Cell value from the uploaded spreadsheet.
 * @returns {string|null|undefined}  The value with PII replaced, or null/undefined
 *                                   if that was the original value.
 */
function maskPii(value) {
    if (value === null || value === undefined) return value;
    var v = typeof value === 'string' ? value : String(value);
    // Email addresses (before other patterns to avoid partial matches)
    v = v.replace(/\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g, '[EMAIL]');
    // Credit / debit card numbers – standard 4-group separator format first,
    // then any run of 13-19 consecutive digits (unseparated)
    v = v.replace(/\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{1,7}\b/g, '[CARD]');
    v = v.replace(/\b\d{13,19}\b/g, '[CARD]');
    // US Social Security Numbers (000-00-0000 or 000 00 0000)
    v = v.replace(/\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/g, '[SSN]');
    // Phone numbers – N. American (000) 000-0000 / 000-000-0000 and international +XX ...
    v = v.replace(/(?:\+?(?:\d{1,3})[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g, '[PHONE]');
    // IPv4 addresses
    v = v.replace(/\b(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}\b/g, '[IP]');
    return v;
}

function sumRowsToObjects(rawRows) {
    if (!rawRows || rawRows.length < 2) return [];
    var headers = rawRows[0].map(function (h) {
        return h !== null && h !== undefined ? String(h) : '';
    });
    return rawRows.slice(1).map(function (row) {
        return Object.fromEntries(
            headers.map(function (h, i) {
                var raw = row[i] !== null && row[i] !== undefined ? row[i] : '';
                return [h, maskPii(raw)];
            })
        );
    });
}

function sumParseCSV(text) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
    if (lines.length < 2) return [];
    function splitLine(line) {
        var fields = [], cur = '', inQuote = false;
        for (var i = 0; i < line.length; i++) {
            var ch = line[i];
            if (ch === '"') {
                if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
                else inQuote = !inQuote;
            } else if (ch === ',' && !inQuote) {
                fields.push(cur); cur = '';
            } else { cur += ch; }
        }
        fields.push(cur);
        return fields;
    }
    var headers = splitLine(lines[0]);
    return lines.slice(1).map(function (line) {
        var vals = splitLine(line);
        return Object.fromEntries(
            headers.map(function (h, i) {
                return [h, maskPii(vals[i] !== null && vals[i] !== undefined ? vals[i] : '')];
            })
        );
    });
}

/* ─────────────────────────────────────────────
   Data extraction / aggregation
───────────────────────────────────────────── */
function extractSumStats(rows, cols) {
    var stats = {
        total: rows.length,
        bySeverity: {},
        byStatus:   {},
        automatable: 0,
        notAutomatable: 0,
        withBug: 0,
        useCases: [],
    };

    var ucSet = new Set();

    rows.forEach(function (row) {
        // Severity
        if (cols.severity) {
            var sev = String(row[cols.severity] || '').trim().toLowerCase() || 'unspecified';
            stats.bySeverity[sev] = (stats.bySeverity[sev] || 0) + 1;
        }
        // Status
        if (cols.status) {
            var st = String(row[cols.status] || '').trim().toLowerCase() || 'unspecified';
            stats.byStatus[st] = (stats.byStatus[st] || 0) + 1;
        }
        // Automatable
        if (cols.isAutomatable) {
            var auto = String(row[cols.isAutomatable] || '').trim().toLowerCase();
            if (/^(yes|y|true|1|automatable)$/.test(auto)) stats.automatable++;
            else if (/^(no|n|false|0|manual|not automatable)$/.test(auto)) stats.notAutomatable++;
        }
        // Bug ID
        if (cols.bugId) {
            var bug = String(row[cols.bugId] || '').trim();
            if (bug && bug !== '-' && bug !== 'n/a' && bug !== 'na') stats.withBug++;
        }
        // Use Cases
        if (cols.useCase) {
            var uc = String(row[cols.useCase] || '').trim();
            if (uc) ucSet.add(uc);
        }
    });

    stats.useCases = Array.from(ucSet);
    return stats;
}

function groupByUseCase(rows, cols) {
    var groups = new Map();
    rows.forEach(function (row) {
        var uc = cols.useCase ? String(row[cols.useCase] || '').trim() : '';
        var key = uc || '(No Use Case)';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    });
    return groups;
}

/* ─────────────────────────────────────────────
   Stop words for subject / keyword extraction
───────────────────────────────────────────── */
var SUM_STOP_WORDS = new Set([
    'the','and','that','this','with','from','into','have','been','when',
    'for','are','was','not','but','will','would','could','should','can',
    'may','after','before','while','under','also','both','via','use',
    'using','able','does','show','shows','verify','check','ensure',
    'user','users','section','option','button','action','icon','icons',
    'added','displayed','item','items','page','view','list','detail',
    'screen','panel','window','dialog','folder','folders','email','emails',
    'import','imported','export','upload','uploaded','file','files',
    'test','tests','case','cases','that','where','which','there','then',
]);

/**
 * Extract the most-frequent domain-meaningful keywords from an array of text strings.
 * Used as a universal fallback description for scenarios that do not match any of the
 * predefined theme patterns — works for any feature domain without hard-coded terms.
 *
 * Words in SUM_STOP_WORDS plus the additional QA-process stop-words below are excluded.
 * A word must appear in at least 2 scenarios to qualify (prevents single-mention noise).
 *
 * @param {string[]} texts    - Scenario / test-case text strings to analyse.
 * @param {number}   maxWords - Maximum distinct keywords to return.
 * @returns {string[]} Capitalised domain keywords sorted by descending frequency.
 */
function extractTopKeywords(texts, maxWords) {
    var qaStop = new Set([
        'able','cannot','must','given','then','when',
        'click','select','enter','type','open','close',
        'submit','save','cancel','back','next','done',
        'true','false','null','none','with','without',
        'workflow','scenario','confirm','valid',
    ]);
    var freq = {};
    texts.forEach(function (t) {
        (t.match(new RegExp('[a-zA-Z]{' + SUM_MIN_WORD_LENGTH + ',}', 'g')) || []).forEach(function (w) {
            var lw = w.toLowerCase();
            if (!SUM_STOP_WORDS.has(lw) && !qaStop.has(lw)) {
                freq[lw] = (freq[lw] || 0) + 1;
            }
        });
    });
    return Object.keys(freq)
        .filter(function (w) { return freq[w] >= SUM_MIN_KEYWORD_FREQ; })
        .sort(function (a, b) { return freq[b] - freq[a]; })
        .slice(0, maxWords)
        .map(capFirst);
}

/* ─────────────────────────────────────────────
   Theme patterns used to auto-classify scenarios
   that have no named use-case / feature assigned.
─────────────────────────────────────────────── */
var THEME_PATTERNS = [
    { key: 'auth',    label: 'Authentication & Session Management',
      re: /\b(login|log[\s\-]?in|logout|log[\s\-]?out|sign[\s\-]?in|sign[\s\-]?out|auth|session|password|credential|token|forgot|reset)/i },
    { key: 'create',  label: 'Data Creation',
      re: /\b(creat|add\b|new\b|register|submit|insert|generat)/i },
    { key: 'edit',    label: 'Editing & Updates',
      re: /\b(edit|updat|modif|chang|save|patch|renam|move)/i },
    { key: 'delete',  label: 'Deletion & Archiving',
      re: /\b(delet|remov|archiv|purg|cancel|discard)/i },
    { key: 'search',  label: 'Search & Filtering',
      re: /\b(search|filter|sort|find|query|lookup|browse)/i },
    { key: 'file',    label: 'File Management',
      re: /\b(upload|download|import|export|attachment|file|document)/i },
    { key: 'access',  label: 'Access Control',
      re: /\b(role|permission|access|admin|rbac|privilege|unauthori[sz]e|forbidden)/i },
    { key: 'notify',  label: 'Notifications & Alerts',
      re: /\b(notification|email|sms|alert|push|reminder|message)/i },
    { key: 'error',   label: 'Error & Edge Cases',
      re: /\b(invalid|negative|error|exception|boundary|edge|empty|null|overflow|validat)/i },
    { key: 'ui',      label: 'UI & UX Behaviour',
      re: /\b(ui|ux|display|visible|layout|responsive|screen|button|click|navigat|redirect)/i },
    { key: 'perf',    label: 'Performance',
      re: /\b(performance|load|stress|latency|speed|concurr|timeout)/i },
];

/**
 * Group an array of scenario name strings into themed feature blocks.
 * Returns an array in the same shape as the named-use-case `features` array.
 * Each scenario is assigned to the first matching theme (first-match wins);
 * this keeps the output clean and avoids duplicate entries across groups.
 */
function buildThemedFeatures(scenarios) {
    var grouped = {};
    var order   = [];

    scenarios.forEach(function (scenario) {
        var matched = false;
        for (var i = 0; i < THEME_PATTERNS.length; i++) {
            if (THEME_PATTERNS[i].re.test(scenario)) {
                var k = THEME_PATTERNS[i].key;
                if (!grouped[k]) { grouped[k] = { label: THEME_PATTERNS[i].label, list: [] }; order.push(k); }
                grouped[k].list.push(scenario);
                matched = true;
                break;
            }
        }
        if (!matched) {
            if (!grouped['misc']) { grouped['misc'] = { label: 'General Functionality', list: [] }; order.push('misc'); }
            grouped['misc'].list.push(scenario);
        }
    });

    return order.map(function (k) {
        var g     = grouped[k];
        var shown = g.list.slice(0, SUM_MAX_SCENARIOS_SHOWN);
        return {
            name:       g.label,
            scenarios:  shown,
            hasMore:    g.list.length > shown.length,
            extraCount: g.list.length - shown.length,
        };
    });
}

/**
 * Detect the primary subject / entity from scenario titles.
 * Prefers uppercase acronyms (e.g. EML, PST, CRM) that appear frequently,
 * then falls back to the most common meaningful noun.
 */
function detectSumSubject(scenarios) {
    var skipAcr = { UI: 1, UX: 1, ID: 1, TC: 1, OK: 1, URL: 1, API: 1, NA: 1 };
    var aFreq = {};
    scenarios.forEach(function (s) {
        (s.match(/\b[A-Z]{2,6}\b/g) || []).forEach(function (m) {
            if (!skipAcr[m]) aFreq[m] = (aFreq[m] || 0) + 1;
        });
    });
    var topAcr = Object.keys(aFreq).sort(function (a, b) { return aFreq[b] - aFreq[a]; })[0];
    if (topAcr && aFreq[topAcr] >= SUM_MIN_ACRONYM_FREQ) return topAcr;

    var wFreq = {};
    scenarios.forEach(function (s) {
        (s.match(new RegExp('[a-zA-Z]{' + SUM_MIN_WORD_LENGTH + ',}', 'g')) || []).forEach(function (w) {
            var lw = w.toLowerCase();
            if (!SUM_STOP_WORDS.has(lw)) wFreq[lw] = (wFreq[lw] || 0) + 1;
        });
    });
    var topW = Object.keys(wFreq).sort(function (a, b) { return wFreq[b] - wFreq[a]; })[0];
    return topW ? capFirst(topW) : '';
}

/**
 * Group all scenarios by theme. Returns ordered array of
 * { key, label, list[] } — full scenario list per theme (not sliced).
 */
function groupScenariosByTheme(scenarios) {
    var grouped = {}, order = [];
    scenarios.forEach(function (scenario) {
        var matched = false;
        for (var i = 0; i < THEME_PATTERNS.length; i++) {
            if (THEME_PATTERNS[i].re.test(scenario)) {
                var k = THEME_PATTERNS[i].key;
                if (!grouped[k]) { grouped[k] = { key: k, label: THEME_PATTERNS[i].label, list: [] }; order.push(k); }
                grouped[k].list.push(scenario);
                matched = true;
                break;
            }
        }
        if (!matched) {
            if (!grouped['misc']) { grouped['misc'] = { key: 'misc', label: 'General Functionality', list: [] }; order.push('misc'); }
            grouped['misc'].list.push(scenario);
        }
    });
    return order.map(function (k) { return grouped[k]; });
}

/**
 * Generate a brief one-line capability description for a theme group.
 * Returns null if nothing meaningful can be extracted.
 */
function themeCapability(key, scenarios) {
    var has = function (re) { return scenarios.some(function (x) { return re.test(x); }); };
    switch (key) {
        case 'file':
            var fParts = [];
            if (has(/drag.?and.?drop|drag/i))   fParts.push('drag-and-drop');
            if (has(/browse|browser|finder/i))  fParts.push('file browser');
            if (has(/zip|zipped/i))             fParts.push('zipped archives');
            if (has(/password/i))               fParts.push('password-protected files');
            if (has(/large|10gb/i))             fParts.push('large file handling');
            return 'Import and manage files' + (fParts.length ? ' — supports ' + fParts.join(', ') : '') + '.';
        case 'auth':
            var aParts = [];
            if (has(/password/i))   aParts.push('password-protected access');
            if (has(/session/i))    aParts.push('session handling');
            if (has(/invalid/i))    aParts.push('error messages for invalid credentials');
            return (aParts.length ? capFirst(aParts.join(', ')) : 'Authentication and session management') + '.';
        case 'edit':
            var eVerbs = [];
            if (has(/renam/i))  eVerbs.push('rename');
            if (has(/edit/i))   eVerbs.push('edit');
            if (has(/move/i))   eVerbs.push('move');
            if (has(/updat/i))  eVerbs.push('update');
            return (eVerbs.length ? capFirst(eVerbs.join(', ')) + ' items inline' : 'Edit and update items') + '.';
        case 'delete':
            var dParts = [];
            if (has(/confirm/i)) dParts.push('confirmation before deletion');
            if (has(/cancel/i))  dParts.push('cancel in-progress operations');
            if (has(/archiv/i))  dParts.push('archive support');
            return 'Delete and manage items' + (dParts.length ? ' with ' + dParts.join(', ') : '') + '.';
        case 'search':
            var sParts = [];
            if (has(/filter/i))          sParts.push('filter');
            if (has(/sort/i))            sParts.push('sort');
            if (has(/drag.?and.?drop/i)) sParts.push('drag-and-drop import');
            if (has(/invalid/i))         sParts.push('invalid file type handling');
            return 'Search' + (sParts.length ? ', ' + sParts.join(', ') : '') + ' across content.';
        case 'ui':
            var uParts = [];
            if (has(/hover/i))                uParts.push('hover actions');
            if (has(/read.?unread/i))         uParts.push('read/unread toggles');
            if (has(/right.?click|context/i)) uParts.push('right-click context menus');
            if (has(/select/i))               uParts.push('multi-select');
            return 'UI interactions: ' + (uParts.length ? uParts.join(', ') : 'visual states and layout') + '.';
        case 'create':
            var cVerbs = [];
            if (has(/reply.?all/i)) cVerbs.push('reply-all');
            else if (has(/reply/i)) cVerbs.push('reply');
            if (has(/forward/i))    cVerbs.push('forward');
            if (has(/archiv/i))     cVerbs.push('archive');
            if (has(/delet/i))      cVerbs.push('delete');
            if (has(/move/i))       cVerbs.push('move');
            if (has(/tag/i))        cVerbs.push('tag');
            return (cVerbs.length ? capFirst(cVerbs.slice(0, 5).join(', ')) + ' actions available' : 'Content actions available') + '.';
        case 'notify':
            var nParts = [];
            if (has(/inline image/i))   nParts.push('inline image rendering');
            if (has(/text selection/i)) nParts.push('text selection');
            if (has(/reply/i))          nParts.push('reply interactions');
            return (nParts.length ? capFirst(nParts.join(', ')) : 'Notifications and alerts') + '.';
        case 'error':
            var eTypes = [];
            if (has(/invalid/i))    eTypes.push('invalid input');
            if (has(/empty/i))      eTypes.push('empty states');
            if (has(/duplic/i))     eTypes.push('duplicates');
            if (has(/large|10gb/i)) eTypes.push('large files');
            return 'Edge case handling: ' + (eTypes.length ? eTypes.join(', ') : 'errors and boundary conditions') + '.';
        case 'perf':
            return 'Performance and load testing.';
        case 'misc':
        default:
            /* First try keyword extraction — works for any feature domain */
            var topKws = extractTopKeywords(scenarios, 4);
            if (topKws.length >= 1) {
                return topKws.join(', ') + '.';
            }
            /* Final hard-coded fallbacks for a small set of known misc patterns */
            var mParts = [];
            if (has(/mount/i))                mParts.push('simultaneous mounting');
            if (has(/maximum|limit|\b20\b/i)) mParts.push('item/folder limits');
            if (has(/duplic/i))               mParts.push('duplicate detection');
            if (has(/account/i))              mParts.push('account organisation');
            if (has(/delegat/i))              mParts.push('delegated accounts');
            return mParts.length ? capFirst(mParts.join(', ')) + '.' : 'General application functionality.';
    }
}

/**
 * Generate a brief user-story narrative sentence describing a feature area
 * from its use-case name and the test-scenario titles within it.
 * Used as the human-readable description beneath each feature-area heading.
 *
 * @param {string}   ucName    - The use-case / feature-area name.
 * @param {string[]} scenarios - Test-case titles that belong to this area.
 * @returns {string} A 1–2 sentence plain-language description.
 */
function generateFeatureNarrative(ucName, scenarios) {
    if (!scenarios || scenarios.length === 0) {
        return 'Validates ' + ucName.toLowerCase() + ' functionality.';
    }

    var joined = scenarios.map(function (s) { return s.toLowerCase(); }).join(' ');

    /* Detect broad coverage categories present in this area */
    var hasNeg  = /\b(invalid|error|not |cannot|unable|should not|rejected|blocked|denied|negative|no)\b/.test(joined);
    var hasPos  = /\b(success|valid|correct|able|should work|completes|can )\b/.test(joined);
    var hasBnd  = /\b(limit|maximum|minimum|empty|boundary|multiple|all accounts|all folders)\b/.test(joined);
    var hasAuth = /\b(login|log in|sign in|auth|session|password|credential|retention|device)\b/.test(joined);
    var hasFile = /\b(file|upload|download|import|export|drag|drop|attach)\b/.test(joined);

    /* Single scenario: convert directly to a "Validates that …" user-story sentence */
    if (scenarios.length === 1) {
        var sc = scenarios[0].trim().replace(/\.$/, '');
        if (!sc) { return 'Validates ' + ucName.toLowerCase() + ' functionality.'; }
        var lower = sc.charAt(0).toLowerCase() + sc.slice(1);
        return 'Validates that ' + lower + '.';
    }

    /* Multiple scenarios: synthesise a feature-level description */
    var aspects = [];
    if (hasAuth) aspects.push('authentication and session management');
    if (hasFile) aspects.push('file handling operations');

    var description = capFirst(ucName);
    if (aspects.length > 0) {
        description += ' covers ' + aspects.join(' and ');
    }
    description += ' across ' + scenarios.length + ' scenario' + (scenarios.length !== 1 ? 's' : '') + '.';

    /* Append a coverage-type note when multiple test types are present */
    var coverageNote = '';
    if (hasPos && hasNeg) { coverageNote = 'Covers both expected success paths and error/rejection scenarios.'; }
    else if (hasNeg)      { coverageNote = 'Focuses on error handling and invalid input scenarios.'; }
    else if (hasPos)      { coverageNote = 'Validates successful user workflows and expected system behaviour.'; }
    if (hasBnd) { coverageNote += (coverageNote ? ' ' : '') + 'Includes boundary and limit condition tests.'; }

    if (coverageNote) description += ' ' + coverageNote;

    return description;
}

/**
 * Convert a list of named use-case / feature-area labels into capability objects.
 * Each object contains a clean display label, a brief user-story narrative
 * description, and the list of scenario names that belong to the area.
 * Objects are sorted by test-case count (most-tested areas first) so the most
 * important areas appear at the top.  ALL areas are returned — no overflow
 * truncation — so the user always sees the full picture.
 *
 * @param {string[]} ucList    - Distinct, non-empty use-case names.
 * @param {Object}   ucCounts  - Map of { useCase: count }.
 * @param {Map}      [ucGroups] - Map returned by groupByUseCase (useCase → rows[]).
 * @param {Object}   [cols]    - Detected column map (for extracting scenario names).
 * @returns {{ label: string, description: string, scenarios: string[] }[]}
 */
function useCasesToCapabilities(ucList, ucCounts, ucGroups, cols) {
    /* Sort: highest test-case count first, then alphabetical for ties */
    var sorted = ucList.slice().sort(function (a, b) {
        var diff = (ucCounts[b] || 0) - (ucCounts[a] || 0);
        return diff !== 0 ? diff : a.localeCompare(b);
    });

    /* Return every area with a clean label, a narrative description, and scenario names */
    return sorted.map(function (uc) {
        var label = capFirst(uc);

        var scenarios = [];
        if (ucGroups && cols) {
            var groupRows = ucGroups.get(uc) || [];
            groupRows.forEach(function (r) {
                var name = (cols.testCase ? String(r[cols.testCase] || '') : '').trim();
                if (!name && cols.testCaseId) name = String(r[cols.testCaseId] || '').trim();
                if (name) scenarios.push(name);
            });
        }

        var description = generateFeatureNarrative(uc, scenarios);

        return { label: label, description: description, scenarios: scenarios };
    });
}

/* ─────────────────────────────────────────────
   Test quality analyser
   Assesses how comprehensively the uploaded test
   suite covers the key test-type dimensions
   (positive, negative, boundary, security, etc.)
   and returns a quality label with actionable
   coverage insights.
───────────────────────────────────────────── */
/**
 * Analyse the overall quality and coverage breadth of the uploaded test suite.
 *
 * @param {Object[]} rows - Parsed row objects.
 * @param {Object}   cols - Detected column map.
 * @returns {{ qualityLabel: string, qualityColor: string, score: number, insights: string[] }}
 */
function analyzeTestQuality(rows, cols) {
    /* Build a single combined text from all test-case name + steps + expected fields */
    var allText = rows.map(function (r) {
        var parts = [];
        if (cols.testCase)       parts.push(String(r[cols.testCase]       || ''));
        if (cols.steps)          parts.push(String(r[cols.steps]          || ''));
        if (cols.expectedResult) parts.push(String(r[cols.expectedResult] || ''));
        return parts.join(' ');
    }).join(' ').toLowerCase();

    /* Detect which test-type dimensions are present */
    var hasPositive    = /\b(valid|success|successful|positive|happy[- ]?path|correct|should work|verify that|able to|complete|completed)\b/.test(allText);
    var hasNegative    = /\b(invalid|negative|incorrect|wrong|bad input|fail|reject|error message|not allowed|cannot|unable|blocked|denied)\b/.test(allText);
    var hasBoundary    = /\b(boundary|limit|min\b|max\b|maximum|minimum|overflow|empty|zero|null|length|edge[- ]?case|out[\s-]of[\s-]range)\b/.test(allText);
    var hasSecurity    = /\b(sql injection|xss|csrf|unauthorized|authentication|authorization|brute[- ]?force|encrypt|token|session|privilege|injection)\b/.test(allText);
    var hasPerformance = /\b(performance|load[\s-]?test|stress[\s-]?test|latency|response[\s-]?time|concurrent|timeout|throughput|sla)\b/.test(allText);
    var hasUi          = /\b(display|visible|layout|responsive|button|navigation|screen|interface|render|style|color|font)\b/.test(allText);
    var hasAccessibility = /\b(accessibility|keyboard[\s-]?navigation|screen[\s-]?reader|aria|wcag|a11y|tab[\s-]?order|focus|contrast)\b/.test(allText);
    var hasDataIntegrity = /\b(persist|data[\s-]?integrity|consistent|accurate|data[\s-]?loss|corrupt|reload|refresh|survives)\b/.test(allText);
    var hasStateTrans  = /\b(status|workflow|state|transition|approve|reject|pending|active|inactive|draft|publish)\b/.test(allText);

    /* Score (0–9) — one point per dimension present */
    var dimensions = [hasPositive, hasNegative, hasBoundary, hasSecurity, hasPerformance,
                      hasUi, hasAccessibility, hasDataIntegrity, hasStateTrans];
    var score = dimensions.filter(Boolean).length;

    /* Quality label and colour */
    var qualityLabel, qualityColor;
    if (score >= 7)      { qualityLabel = 'Excellent Coverage'; qualityColor = '#1b5e20'; }
    else if (score >= 5) { qualityLabel = 'Good Coverage';      qualityColor = '#2e7d32'; }
    else if (score >= 3) { qualityLabel = 'Moderate Coverage';  qualityColor = '#e65100'; }
    else if (score >= 2) { qualityLabel = 'Basic Coverage';     qualityColor = '#bf360c'; }
    else                 { qualityLabel = 'Minimal Coverage';   qualityColor = '#b71c1c'; }

    /* Per-dimension coverage insights */
    var insights = [];
    if (hasPositive)      insights.push('✅ Positive / happy-path scenarios detected');
    else                  insights.push('⚠ No clear positive/happy-path tests found — add successful workflow tests');
    if (hasNegative)      insights.push('✅ Negative / error-path scenarios detected');
    else                  insights.push('⚠ No negative / invalid-input tests found — add error message and rejection tests');
    if (hasBoundary)      insights.push('✅ Boundary / edge-case tests detected');
    else                  insights.push('⚠ No boundary value tests found — add min/max/empty/null input coverage');
    if (hasSecurity)      insights.push('✅ Security-related tests detected');
    else                  insights.push('⚠ No security tests found — add authentication, authorization, and injection tests');
    if (hasPerformance)   insights.push('✅ Performance / load tests detected');
    else                  insights.push('⚠ No performance tests found — add response time, load, and timeout scenarios');
    if (hasUi)            insights.push('✅ UI / visual validation tests detected');
    if (hasAccessibility) insights.push('✅ Accessibility tests detected');
    else                  insights.push('⚠ No accessibility tests found — add keyboard navigation and ARIA checks');
    if (hasDataIntegrity) insights.push('✅ Data integrity / persistence tests detected');
    if (hasStateTrans)    insights.push('✅ State transition / workflow tests detected');

    return { qualityLabel: qualityLabel, qualityColor: qualityColor, score: score, insights: insights };
}

/* ─────────────────────────────────────────────
   Feature-flow & cross-module dependency helpers
───────────────────────────────────────────── */

/**
 * Order use-case areas by their natural position in a typical software
 * workflow.  Uses two complementary signals:
 *   1. Precondition-graph — if module B's test preconditions mention module
 *      A's keywords, A is ordered before B.
 *   2. Pattern score — common verb/noun patterns (login < create < edit <
 *      search < delete < export < error) provide a sensible default order
 *      when precondition data is absent.
 *
 * @param {string[]} ucList   - Named use-case / feature-area labels.
 * @param {Map}      ucGroups - Map returned by groupByUseCase().
 * @param {Object}   cols     - Detected column map.
 * @returns {string[]} Ordered copy of ucList (first = earliest in flow).
 */
function detectFlowOrder(ucList, ucGroups, cols) {
    if (ucList.length <= 1) return ucList.slice();

    /* Pattern-based position score (lower value = earlier in typical flow) */
    function patternScore(uc) {
        var l = uc.toLowerCase();
        if (/\b(login|log[\s\-]?in|sign[\s\-]?in|auth|authenticat)\b/.test(l)) return 0;
        if (/\b(setup|config|setting|onboard|register|install)\b/.test(l))      return 1;
        if (/\b(dashboard|home|landing|overview|main)\b/.test(l))               return 2;
        if (/\b(creat|add\b|new\b|import|upload)\b/.test(l))                   return 3;
        if (/\b(view|list|browse|read|display|show)\b/.test(l))                 return 4;
        if (/\b(edit|updat|modif|chang|renam|move)\b/.test(l))                  return 5;
        if (/\b(search|filter|sort|find)\b/.test(l))                            return 6;
        if (/\b(delet|remov|archiv|purg)\b/.test(l))                            return 7;
        if (/\b(export|download|report|generat)\b/.test(l))                     return 8;
        if (/\b(notif|email|alert|message)\b/.test(l))                          return 9;
        if (/\b(error|invalid|exception|edge|boundary)\b/.test(l))              return 10;
        return 5;
    }

    /* Build a "depends-on" count: modules that many others depend on should
     * appear first.  We scan each module's precondition text for keywords
     * from every other module's label. */
    var dependentsOf = {};
    ucList.forEach(function (uc) { dependentsOf[uc] = 0; });

    if (cols && cols.precondition) {
        ucList.forEach(function (ucA) {
            var preText = (ucGroups.get(ucA) || []).map(function (r) {
                return String(r[cols.precondition] || '').toLowerCase();
            }).join(' ');

            ucList.forEach(function (ucB) {
                if (ucB === ucA) return;
                var bKws = ucB.toLowerCase().replace(/[^\w\s]/g, ' ')
                    .split(/\s+/).filter(function (w) { return w.length >= 4 && !SUM_STOP_WORDS.has(w); });
                if (bKws.length > 0 && bKws.some(function (w) { return preText.indexOf(w) !== -1; })) {
                    /* ucA depends on ucB → ucB should come first */
                    dependentsOf[ucB] = (dependentsOf[ucB] || 0) + 1;
                }
            });
        });
    }

    return ucList.slice().sort(function (a, b) {
        /* Primary: more dependents ⇒ earlier */
        var depDiff = (dependentsOf[b] || 0) - (dependentsOf[a] || 0);
        if (depDiff !== 0) return depDiff;
        /* Secondary: pattern score */
        return patternScore(a) - patternScore(b);
    });
}

/**
 * Detect cross-module dependencies by scanning each use-case's precondition
 * and step text for references to the names of other use-case / feature areas.
 *
 * @param {string[]} ucList   - Named use-case / feature-area labels.
 * @param {Map}      ucGroups - Map returned by groupByUseCase().
 * @param {Object}   cols     - Detected column map.
 * @returns {{ from: string, to: string }[]} Dependency pairs where the `from`
 *   module's tests reference concepts from the `to` module.
 */
function detectCrossModuleDeps(ucList, ucGroups, cols) {
    var pairs = [];
    if (!ucGroups || !cols || ucList.length < 2) return pairs;

    /* Build a combined text corpus per module */
    var ucTexts = {};
    ucList.forEach(function (uc) {
        var text = (ucGroups.get(uc) || []).map(function (r) {
            var parts = [];
            if (cols.precondition)   parts.push(String(r[cols.precondition]   || ''));
            if (cols.steps)          parts.push(String(r[cols.steps]          || '').slice(0, SUM_MAX_FALLBACK_TEXT));
            if (cols.expectedResult) parts.push(String(r[cols.expectedResult] || '').slice(0, SUM_DEP_MAX_EXP_TEXT));
            return parts.join(' ');
        }).join(' ').toLowerCase();
        ucTexts[uc] = text;
    });

    /* Pre-compile one RegExp per keyword per module label to avoid repeated
     * regexp construction inside the nested loop. */
    var ucBPatterns = {};
    ucList.forEach(function (ucB) {
        var bKws = ucB.toLowerCase().replace(/[^\w\s]/g, ' ')
            .split(/\s+/).filter(function (w) { return w.length >= 4 && !SUM_STOP_WORDS.has(w); });
        ucBPatterns[ucB] = bKws.map(function (w) {
            return new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        });
    });

    ucList.forEach(function (ucA) {
        ucList.forEach(function (ucB) {
            if (ucA === ucB) return;
            var patterns = ucBPatterns[ucB];
            if (!patterns || patterns.length === 0) return;
            /* Whole-word match to avoid substring false-positives */
            var matched = patterns.some(function (re) { return re.test(ucTexts[ucA]); });
            if (matched && !pairs.some(function (p) { return p.from === ucA && p.to === ucB; })) {
                pairs.push({ from: ucA, to: ucB });
            }
        });
    });

    return pairs;
}

/**
 * Build a single brief plain-language sentence summarising the test suite so
 * any stakeholder can immediately understand what is being tested.
 *
 * The sentence identifies the application / feature name (from scenario titles
 * or use-case labels), the primary flow under test, and the types of test
 * coverage present (positive, negative, security, etc.).
 *
 * Example output:
 *   "This test case document explains the login flow for the Backup feature
 *    with positive and negative cases."
 *
 * @param {Object[]} rows    - All parsed test-case rows.
 * @param {Object}   cols    - Detected column map.
 * @param {Object}   stats   - Output of extractSumStats().
 * @param {Object}   builtIn - Output of builtInSummarise() — { intro, capabilities }.
 * @param {Object}   quality - Output of analyzeTestQuality().
 * @returns {string} Safe HTML fragment.
 */
function buildNarrativeSummary(rows, cols, stats, builtIn, quality) {
    var ucListRaw = stats.useCases.filter(function (uc) {
        return uc && uc !== '(No Use Case)' && !SUM_GENERIC_UC_TERMS.has(uc.trim().toLowerCase());
    });

    /* Collect real scenario titles (non-ID rows) */
    var allScenarios = [];
    rows.forEach(function (r) {
        var name = (cols.testCase ? String(r[cols.testCase] || '') : '').trim();
        if (name && !SUM_ID_PATTERN.test(name)) allScenarios.push(name);
    });

    /* ── 1. Detect the feature / application name ── */
    /* Prefer the explicit use-case / feature-area name when available — it is
     * the most reliable signal (set by the test-suite author).  Fall back to
     * keyword detection from scenario titles only when no named areas exist. */
    var appName = null;
    if (ucListRaw.length === 1) {
        appName = capFirst(ucListRaw[0]);
    } else if (ucListRaw.length > 1) {
        var ucKws = extractTopKeywords(ucListRaw, 1);
        appName = ucKws.length ? ucKws[0] : capFirst(ucListRaw[0]);
    }
    if (!appName) {
        appName = detectSumSubject(allScenarios);
    }
    if (!appName && allScenarios.length > 0) {
        var fallbackKws = extractTopKeywords(allScenarios, 1);
        appName = fallbackKws.length ? fallbackKws[0] : null;
    }

    /* ── 2. Detect the primary flow being tested ── */
    /* Check use-case labels first (e.g. "Backup Retention" → backup), then
     * fall through to scenario text for suites with no named use-case column. */
    var ucText     = ucListRaw.join(' ').toLowerCase();
    var allText    = allScenarios.concat(ucListRaw).join(' ').toLowerCase();
    var flowType   = null;
    var flowSource = ucText || allText; /* prefer ucText when available */

    if (/\b(backup|restore)\b/.test(flowSource)) {
        flowType = 'backup and restore';
    } else if (/\b(login|log[\s-]?in|sign[\s-]?in|auth)\b/.test(flowSource)) {
        flowType = 'login';
    } else if (/\b(upload|import|export|file|attachment)\b/.test(flowSource)) {
        flowType = 'file management';
    } else if (/\b(setting|config|preference|profile)\b/.test(flowSource)) {
        flowType = 'settings and configuration';
    } else if (/\b(search|filter|sort)\b/.test(flowSource)) {
        flowType = 'search and filtering';
    } else if (/\b(dashboard|home|overview)\b/.test(flowSource)) {
        flowType = 'dashboard';
    } else if (/\b(creat|add|register|new)\b/.test(flowSource)) {
        flowType = 'creation';
    } else if (/\b(edit|updat|modif)\b/.test(flowSource)) {
        flowType = 'editing';
    } else if (/\b(delet|remov|archiv)\b/.test(flowSource)) {
        flowType = 'deletion';
    }
    /* Second pass on full allText if ucText gave no match */
    if (!flowType && ucText) {
        if (/\b(login|log[\s-]?in|sign[\s-]?in|auth|session|password|credential|onboard)\b/.test(allText)) {
            flowType = 'login';
        } else if (/\b(upload|import|export|file|attachment)\b/.test(allText)) {
            flowType = 'file management';
        } else if (/\b(setting|config|preference|profile)\b/.test(allText)) {
            flowType = 'settings and configuration';
        } else if (/\b(search|filter|sort)\b/.test(allText)) {
            flowType = 'search and filtering';
        } else if (/\b(creat|add|register|new)\b/.test(allText)) {
            flowType = 'creation';
        } else if (/\b(edit|updat|modif)\b/.test(allText)) {
            flowType = 'editing';
        } else if (/\b(delet|remov|archiv)\b/.test(allText)) {
            flowType = 'deletion';
        }
    }

    /* ── 3. Detect test coverage types present ── */
    var covTypes = [];
    var covLabelMap = {
        'positive':     'positive',
        'happy':        'positive',
        'negative':     'negative',
        'error-path':   'negative',
        'boundary':     'boundary value',
        'edge':         'boundary value',
        'security':     'security',
        'performance':  'performance',
        'state':        'state transition',
        'workflow':     'state transition',
        'accessibility':'accessibility',
        'data':         'data integrity',
        'ui':           'UI',
    };
    if (quality) {
        quality.insights.forEach(function (ins) {
            if (ins.charAt(0) === '✅') {
                var raw = ins.slice(2).toLowerCase();
                var matched = null;
                Object.keys(covLabelMap).forEach(function (key) {
                    if (!matched && raw.indexOf(key) !== -1) matched = covLabelMap[key];
                });
                var label = matched || ins.slice(2).replace(/\s*(detected|scenarios)\s*$/i, '').trim().toLowerCase();
                if (label && covTypes.indexOf(label) === -1) covTypes.push(label);
            }
        });
    }

    /* ── 4. Build single brief sentence ── */
    var appPart = appName
        ? 'the <strong>' + escSum(appName) + '</strong> feature'
        : 'this application';
    var sentence;
    if (flowType) {
        sentence = 'This test case document explains the ' + flowType + ' flow for ' + appPart;
    } else {
        sentence = 'This test case document covers test cases for ' + appPart;
    }
    if (covTypes.length > 0) {
        var sliced = covTypes.slice(0, 3);
        var covStr = sliced.length === 1
            ? sliced[0]
            : sliced.slice(0, -1).join(', ') + ' and ' + sliced[sliced.length - 1];
        sentence += ' with ' + covStr + ' cases.';
    } else {
        sentence += '.';
    }

    var html = '<div class="sum-narrative-block" style="'
        + 'background:var(--card-bg,#f8f9fa);'
        + 'border-left:4px solid var(--accent,#1a73e8);'
        + 'border-radius:0 8px 8px 0;'
        + 'padding:14px 18px;margin-bottom:16px;line-height:1.8">';
    html += '<p style="margin:0;font-size:.93rem;color:var(--text,#222)">' + sentence + '</p>';
    html += '</div>';
    return html;
}

/* ─────────────────────────────────────────────
   Built-in summarisation engine
   Produces a brief user-story narrative (≤ 15 lines, < 2 min read).
   No category headers — just an intro sentence and a short
   capability bullet per functional area.
───────────────────────────────────────────── */
function builtInSummarise(rows, cols, stats) {
    var groups = groupByUseCase(rows, cols);

    /* Build two parallel arrays from the uploaded data:
     *
     * allScenarios     — Unique real test-case TITLES (non-ID rows only).
     *                    Used exclusively by detectSumSubject() so that
     *                    domain nouns in short, clean titles are not diluted
     *                    by the process-language in steps / expected results
     *                    (e.g. "Enter", "Navigate", "Click").
     *
     * allAnalysisTexts — One entry per row.  Combines the test-case title
     *                    with steps and expected-result text whenever those
     *                    columns are present in the sheet.  Used for theme
     *                    grouping and keyword extraction so the analysis
     *                    has the richest possible signal from the full test
     *                    specification, not just the title alone.
     *                    When steps / expected-result columns are absent the
     *                    entry is just the title (or ID fallback), matching
     *                    the previous behaviour exactly. */
    var allScenarios    = [];
    var allAnalysisTexts = [];
    groups.forEach(function (ucRows) {
        ucRows.forEach(function (r) {
            var name     = (cols.testCase   ? String(r[cols.testCase]   || '') : '').trim()
                        || (cols.testCaseId ? String(r[cols.testCaseId] || '') : '').trim();
            var isIdOnly = !name || SUM_ID_PATTERN.test(name);
            var stepText = (cols.steps          ? String(r[cols.steps]          || '') : '').trim().slice(0, SUM_MAX_FALLBACK_TEXT);
            var expText  = (cols.expectedResult ? String(r[cols.expectedResult] || '') : '').trim().slice(0, SUM_MAX_FALLBACK_TEXT);

            /* Real title → add to allScenarios for subject detection */
            if (!isIdOnly && allScenarios.indexOf(name) === -1) {
                allScenarios.push(name);
            }

            /* Rich per-row text: real title (when available) + steps + expected result.
             * For bare-ID rows the available step/expected text is used as the base. */
            var parts = [];
            if (!isIdOnly && name) parts.push(name);
            if (stepText)          parts.push(stepText);
            if (expText)           parts.push(expText);
            if (!parts.length)     parts.push(name); // last resort: raw ID
            allAnalysisTexts.push(parts.join(' '));
        });
    });

    /* Detect main subject.
     * Primary:  most-frequent meaningful noun across real test-case titles.
     * Fallback: when titles are all bare IDs (allScenarios is empty), derive
     *           the subject from the domain keywords in the rich analysis texts. */
    var subject = detectSumSubject(allScenarios);
    if (!subject) {
        var subjectKws = extractTopKeywords(allAnalysisTexts, 1);
        if (subjectKws.length) subject = subjectKws[0];
    }

    /* Collect named feature areas and their test-case counts */
    var ucList = stats.useCases.filter(function (uc) {
        return uc && uc !== '(No Use Case)' && !SUM_GENERIC_UC_TERMS.has(uc.trim().toLowerCase());
    });
    var ucCounts = {};
    if (cols.useCase) {
        rows.forEach(function (row) {
            var uc = String(row[cols.useCase] || '').trim();
            if (uc) ucCounts[uc] = (ucCounts[uc] || 0) + 1;
        });
    }

    var capabilities = [];

    if (ucList.length >= 3) {
        /*
         * Strategy 1 — named feature areas (most accurate, content-driven).
         * The use-case / feature-area column already contains the real capability
         * names supplied by the author of the test suite.  Surface all areas
         * sorted by test coverage so stakeholders see the most important areas
         * first, each with its individual scenario names listed beneath it.
         */
        capabilities = useCasesToCapabilities(ucList, ucCounts, groups, cols);
    } else {
        /*
         * Strategy 2 — theme-based keyword analysis (fallback when no named
         * feature areas are present or too few to be meaningful).
         * Uses allAnalysisTexts (name + steps + expected result per row)
         * so that theme detection and keyword extraction have the richest
         * possible signal from the full test specification.
         */
        var themeGroups = groupScenariosByTheme(allAnalysisTexts);
        themeGroups.slice(0, SUM_MAX_CAPABILITIES).forEach(function (g) {
            var cap = themeCapability(g.key, g.list);
            if (cap) capabilities.push({ label: cap, scenarios: [] });
        });
    }

    /* Build a single intro sentence.
     * Priority order:
     *  1. 1 named use-case area  → name it explicitly (most reliable for single-area files).
     *  2. 2 named use-case areas → name both (more reliable than a keyword guess).
     *  3. ≥3 named areas present (Strategy 1) → narrative sentence listing top areas.
     *  4. Detected subject keyword (no use-case column or < 3 named areas).
     *  5. Count of named areas with a full list.
     *  6. Generic scenario count fallback. */
    var ucListFull = stats.useCases;
    var intro;
    if (ucList.length === 1) {
        intro = '<strong>' + escSum(ucList[0]) + '</strong> feature validated across ' +
                '<strong>' + rows.length + ' scenario' + (rows.length !== 1 ? 's' : '') + '</strong>' +
                (capabilities.length > 0 ? ' — key capabilities below.' : '.');
    } else if (ucList.length === 2) {
        intro = '<strong>' + escSum(ucList[0]) + '</strong> and <strong>' + escSum(ucList[1]) +
                '</strong> validated across ' +
                '<strong>' + rows.length + ' scenario' + (rows.length !== 1 ? 's' : '') + '</strong>' +
                (capabilities.length > 0 ? ' — key capabilities below.' : '.');
    } else if (ucList.length >= 3) {
        /* Show a narrative intro listing the top 3 highest-coverage areas by name */
        var topAreaLabels = capabilities.slice(0, 3).map(function (c) {
            return '<strong>' + escSum(typeof c === 'object' ? c.label : c) + '</strong>';
        });
        var areaPhrase = topAreaLabels.join(', ');
        if (ucList.length > 3) {
            var remainingCount = ucList.length - 3;
            areaPhrase += ', and <strong>' + remainingCount + ' more area' + (remainingCount !== 1 ? 's' : '') + '</strong>';
        }
        intro = 'The test suite spans <strong>' + rows.length + ' scenario' + (rows.length !== 1 ? 's' : '') + '</strong>' +
                ' across <strong>' + ucList.length + ' feature area' + (ucList.length !== 1 ? 's' : '') + '</strong>' +
                ' — covering ' + areaPhrase + '.';
    } else if (subject) {
        intro = '<strong>' + escSum(subject) + '</strong> feature validated across ' +
                '<strong>' + rows.length + ' scenario' + (rows.length !== 1 ? 's' : '') + '</strong>' +
                (capabilities.length > 0 ? ' — key capabilities below.' : '.');
    } else if (ucListFull.length > 0) {
        intro = 'Covers <strong>' + ucListFull.length + ' feature area' + (ucListFull.length !== 1 ? 's' : '') + '</strong>: ' +
                ucListFull.map(escSum).join(', ') + '.';
    } else {
        intro = 'Test suite covers <strong>' + rows.length + ' scenario' + (rows.length !== 1 ? 's' : '') + '</strong>.';
    }

    return { intro: intro, capabilities: capabilities };
}

/* ─────────────────────────────────────────────
   Build AI prompt from test case data
───────────────────────────────────────────── */
function buildAIPrompt(rows, cols, stats) {
    var total = stats.total;
    var ucList = stats.useCases;

    var prompt = 'You are a senior QA engineer with deep expertise in test coverage analysis. '
        + 'Read the test case data below and produce a clear, concise summary so any stakeholder can '
        + 'immediately understand what the product does, what is well-covered, and what may be missing.\n\n';

    prompt += '## Test Suite Data\n';
    prompt += '- Total test cases: ' + total + '\n';
    if (ucList.length) prompt += '- Feature areas / use cases: ' + ucList.join(', ') + '\n';

    // Sample test cases (limited to AI_MAX_SAMPLE_ROWS to stay within API token limits)
    var sample = rows.slice(0, AI_MAX_SAMPLE_ROWS);
    prompt += '\n## Sample Test Cases\n';
    sample.forEach(function (row, i) {
        var parts = [];
        if (cols.testCaseId)     parts.push('ID: '       + String(row[cols.testCaseId]     || '').trim());
        if (cols.testCase)       parts.push('Name: '     + String(row[cols.testCase]       || '').trim());
        if (cols.useCase)        parts.push('Use Case: ' + String(row[cols.useCase]        || '').trim());
        if (cols.steps)          parts.push('Steps: '    + String(row[cols.steps]          || '').trim().slice(0, 120));
        if (cols.expectedResult) parts.push('Expected: ' + String(row[cols.expectedResult] || '').trim().slice(0, 120));
        prompt += (i + 1) + '. ' + parts.join(' | ') + '\n';
    });
    if (rows.length > AI_MAX_SAMPLE_ROWS) {
        prompt += '… and ' + (rows.length - AI_MAX_SAMPLE_ROWS) + ' more test cases not shown.\n';
    }

    prompt += '\n## Your Task\n';
    prompt += 'Write a **brief, plain-language summary** structured as follows:\n';
    prompt += '1. **Feature Narrative** (2–3 sentences): Describe what this feature/product does and its primary user journey in plain language any stakeholder can understand.\n';
    prompt += '2. **Key Capabilities** (4–6 bullet points): One bullet per distinct capability or user flow being tested. Each bullet = one concise line describing what the user CAN DO or what the system DOES.\n';
    prompt += '3. **Coverage Note** (1–2 sentences): Briefly note which test types appear well-covered (e.g. positive, negative, security) and call out any obvious gap (e.g. no performance tests, no boundary tests). Be specific.\n';
    prompt += '\nFormatting rules:\n';
    prompt += '- Maximum 15 lines total.\n';
    prompt += '- Do NOT list individual test case names, TC IDs, severity labels, or pass/fail statistics.\n';
    prompt += '- Plain, jargon-free language readable by a non-technical stakeholder in under 2 minutes.\n';

    return prompt;
}

/* ─────────────────────────────────────────────
   AI API callers
───────────────────────────────────────────── */
/** Maximum retry attempts and base delay (ms) for rate-limit (HTTP 429) responses. */
var AI_MAX_RETRIES = 3;
var AI_RETRY_BASE_DELAY_MS = 2000;

/** Wait for `ms` milliseconds. */
function aiDelay(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

async function callOpenAI(apiKey, prompt) {
    var lastError;
    for (var attempt = 0; attempt <= AI_MAX_RETRIES; attempt++) {
        var response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey,
            },
            body: JSON.stringify({
                model: 'gpt-4o',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: AI_MAX_RESPONSE_TOKENS,
                temperature: AI_TEMPERATURE,
            }),
        });

        if (response.status === 429 && attempt < AI_MAX_RETRIES) {
            var retryAfter = parseInt(response.headers.get('Retry-After') || '0', 10);
            var delay = retryAfter > 0 ? retryAfter * 1000 : AI_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
            await aiDelay(delay);
            continue;
        }

        if (!response.ok) {
            var errData = await response.json().catch(function () { return {}; });
            lastError = new Error(errData.error && errData.error.message
                ? errData.error.message
                : 'OpenAI API returned status ' + response.status);
            break;
        }
        var data = await response.json();
        return data.choices[0].message.content.trim();
    }
    throw lastError || new Error('OpenAI API rate limit exceeded after ' + AI_MAX_RETRIES + ' retries');
}

async function callGemini(apiKey, prompt) {
    var lastError;
    for (var attempt = 0; attempt <= AI_MAX_RETRIES; attempt++) {
        var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=' + encodeURIComponent(apiKey);
        var response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: AI_TEMPERATURE, maxOutputTokens: AI_MAX_RESPONSE_TOKENS },
            }),
        });

        if (response.status === 429 && attempt < AI_MAX_RETRIES) {
            var retryAfter = parseInt(response.headers.get('Retry-After') || '0', 10);
            var delay = retryAfter > 0 ? retryAfter * 1000 : AI_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
            await aiDelay(delay);
            continue;
        }

        if (!response.ok) {
            var errData = await response.json().catch(function () { return {}; });
            lastError = new Error(errData.error && errData.error.message
                ? errData.error.message
                : 'Gemini API returned status ' + response.status);
            break;
        }
        var data = await response.json();
        return data.candidates[0].content.parts[0].text.trim();
    }
    throw lastError || new Error('Gemini API rate limit exceeded after ' + AI_MAX_RETRIES + ' retries');
}

/* ─────────────────────────────────────────────
   HTML helpers
───────────────────────────────────────────── */
function escSum(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function capFirst(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/* Convert plain-text AI response (markdown-lite) to safe HTML. */
function aiTextToHtml(text) {
    var escaped = escSum(text);
    // Bold: **text** or __text__
    escaped = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    escaped = escaped.replace(/__(.+?)__/g,      '<strong>$1</strong>');
    // Headers: ## text or # text
    escaped = escaped.replace(/^### (.+)$/gm, '<h4 style="margin:14px 0 6px;color:var(--accent)">$1</h4>');
    escaped = escaped.replace(/^## (.+)$/gm,  '<h3 style="margin:16px 0 8px;color:var(--accent)">$1</h3>');
    escaped = escaped.replace(/^# (.+)$/gm,   '<h3 style="margin:16px 0 8px;color:var(--accent)">$1</h3>');
    // Numbered list items: 1. text
    escaped = escaped.replace(/^\d+\.\s+(.+)$/gm, '<li style="margin-bottom:6px">$1</li>');
    // Bulleted list items: - text or * text
    escaped = escaped.replace(/^[*\-]\s+(.+)$/gm, '<li style="margin-bottom:6px">$1</li>');
    // Wrap consecutive <li> runs in <ol> or <ul>
    escaped = escaped.replace(/(<li[^>]*>[\s\S]*?<\/li>\s*)+/g, function (match) {
        return '<ul style="padding-left:20px;margin:8px 0">' + match + '</ul>';
    });
    // Blank lines → paragraph breaks
    escaped = escaped.replace(/\n{2,}/g, '</p><p style="margin:10px 0">');
    return '<p style="margin:10px 0">' + escaped + '</p>';
}

/* ─────────────────────────────────────────────
   Constants
───────────────────────────────────────────── */
/** Maximum number of test case rows sent to AI APIs (GPT-4o has a 128K context window; 200 rows is well within limits). */
var AI_MAX_SAMPLE_ROWS = 200;

/** Max tokens requested from AI models — set to the GPT-4o output maximum (4096) so responses are never truncated. */
var AI_MAX_RESPONSE_TOKENS = 4096;

/** Low temperature for factual, consistent summaries (not creative writing). */
var AI_TEMPERATURE = 0.3;

/** Max representative scenarios shown per feature block (named or themed). */
var SUM_MAX_SCENARIOS_SHOWN = 5;

/** Max capability bullets shown in the built-in user-story narrative. */
var SUM_MAX_CAPABILITIES = 6;

/** Max use-case names shown in the intro when a use-case column is present. */
var SUM_MAX_USE_CASES_SHOWN = 3;

/** Minimum frequency for an acronym to be treated as the suite's main subject. */
var SUM_MIN_ACRONYM_FREQ = 2;

/** Minimum word length for noun extraction (excludes short prepositions, articles). */
var SUM_MIN_WORD_LENGTH = 4;

/** Minimum frequency (occurrences across scenarios) for a keyword to be surfaced. */
var SUM_MIN_KEYWORD_FREQ = 2;

/** Max characters taken from steps/expectedResult when testCase is a bare ID. */
var SUM_MAX_FALLBACK_TEXT = 200;

/** Max characters scanned from expectedResult text when detecting cross-module deps. */
var SUM_DEP_MAX_EXP_TEXT = 100;

/** Regex that identifies a bare test-case ID (e.g. "TC001", "R-42", "1") vs a real title. */
var SUM_ID_PATTERN = /^[A-Za-z]{0,5}[-_]?\d+$/;

/**
 * Lowercase use-case labels that are too generic to be useful as capability bullets.
 * Any use-case whose trimmed, lowercased value matches one of these strings is
 * excluded from the named-feature-area list and from the intro sentence.
 */
var SUM_GENERIC_UC_TERMS = new Set([
    'others', 'other', 'misc', 'miscellaneous', 'general', 'general functionality',
    'general features', 'tbd', 'n/a', 'na', 'none', 'unknown', 'uncategorized',
    'uncategorised', 'unclassified', 'various', 'undefined',
]);

/* ─────────────────────────────────────────────
   History helpers
───────────────────────────────────────────── */
const SUM_HISTORY_KEY = 'tca_sum_history';
/** Cap at 20 entries — balances UX utility and localStorage size constraints. */
const SUM_HISTORY_MAX = 20;

function saveToSumHistory(fileName, modelLabel, stats, summaryHtml, useCaseBreakdown) {
    var history = [];
    try { history = JSON.parse(localStorage.getItem(SUM_HISTORY_KEY) || '[]'); } catch (e) { history = []; }
    var entry = {
        id:               Date.now(),
        fileName:         fileName,
        timestamp:        new Date().toISOString(),
        model:            modelLabel,
        totalRows:        stats.total,
        useCases:         stats.useCases,
        stats:            stats,
        summaryHtml:      summaryHtml,
        useCaseBreakdown: useCaseBreakdown,
    };
    history.unshift(entry);
    if (history.length > SUM_HISTORY_MAX) history = history.slice(0, SUM_HISTORY_MAX);
    try {
        localStorage.setItem(SUM_HISTORY_KEY, JSON.stringify(history));
    } catch (e) {
        // localStorage quota exceeded — trim entries one by one until it fits
        while (history.length > 1) {
            history.pop();
            try { localStorage.setItem(SUM_HISTORY_KEY, JSON.stringify(history)); break; } catch (e2) { /* continue trimming */ }
        }
    }
    // Notify the history tab to refresh (failure is non-fatal — tab will refresh on next open)
    try { window.dispatchEvent(new CustomEvent('tca-history-updated')); } catch (e) { /* ignore */ }
}

/* ─────────────────────────────────────────────
   UI / DOM logic
───────────────────────────────────────────── */
(function () {
    var dropZone    = document.getElementById('sum-drop-zone');
    var fileInput   = document.getElementById('sum-file-input');
    var btnSummarise = document.getElementById('btn-summarise');
    var statusEl    = document.getElementById('sum-status');

    var secStats    = document.getElementById('sum-sec-stats');
    var secSummary  = document.getElementById('sum-sec-summary');

    var parsedRows      = null;
    var currentFileName = '';

    /* ── Status bar ── */
    function setStatus(msg, type) {
        statusEl.textContent = msg;
        statusEl.className   = type || '';
        statusEl.style.display = msg ? 'block' : 'none';
    }

    function clearResults() {
        [secStats, secSummary].forEach(function (s) {
            if (s) s.classList.remove('visible');
        });
    }

    /* ── Drag-and-drop ── */
    dropZone.addEventListener('dragover', function (e) { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', function () { dropZone.classList.remove('drag-over'); });
    dropZone.addEventListener('drop', function (e) {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        var file = e.dataTransfer.files[0];
        if (file) handleFileSelected(file);
    });

    fileInput.addEventListener('change', function () {
        if (fileInput.files[0]) handleFileSelected(fileInput.files[0]);
    });

    function handleFileSelected(file) {
        var name = file.name.toLowerCase();
        if (!name.endsWith('.xlsx') && !name.endsWith('.csv')) {
            setStatus('⚠ Please upload an .xlsx or .csv file.', 'error');
            btnSummarise.disabled = true;
            return;
        }
        document.getElementById('sum-drop-label').textContent = '📄 ' + file.name;
        document.getElementById('sum-drop-hint').textContent  = (file.size / 1024).toFixed(1) + ' KB';
        btnSummarise.disabled = true;
        currentFileName = file.name;
        parsedRows = null;
        clearResults();
        readSumFile(file);
    }

    function readSumFile(file) {
        setStatus('Reading file…', 'info');
        var name = file.name.toLowerCase();

        if (name.endsWith('.csv')) {
            var reader = new FileReader();
            reader.onload = function (e) {
                try {
                    var rows = sumParseCSV(e.target.result);
                    if (!rows.length) {
                        setStatus('⚠ The CSV file appears to be empty or has only a header row.', 'error');
                        btnSummarise.disabled = true;
                        return;
                    }
                    parsedRows = rows;
                    btnSummarise.disabled = false;
                    doSummarise();
                } catch (err) {
                    setStatus('⚠ Could not parse CSV: ' + err.message, 'error');
                    btnSummarise.disabled = true;
                }
            };
            reader.onerror = function () {
                setStatus('⚠ Could not read file. Please try again.', 'error');
                btnSummarise.disabled = true;
            };
            reader.readAsText(file);
        } else {
            if (typeof readXlsxFile === 'undefined') {
                setStatus('⚠ XLSX library not loaded. Please refresh the page.', 'error');
                btnSummarise.disabled = true;
                return;
            }
            try {
                readXlsxFile(file, { getSheets: true }).then(function (sheets) {
                    // Smart tab detection: prefer a sheet named TC / TC's / testcase / testcases
                    var tcPatterns = ['tc', 'tcs', 'testcase', 'testcases'];
                    var targetSheet = 1;
                    var sheetNote = '';
                    if (sheets && sheets.length > 1) {
                        var match = sheets.find(function (s) {
                            return tcPatterns.includes(s.name.toLowerCase().replace(/['\u2018\u2019\s-]/g, ''));
                        });
                        if (match) {
                            targetSheet = match.name;
                            sheetNote = ' (tab: "' + match.name + '")';
                        }
                    }
                    return readXlsxFile(file, { sheet: targetSheet }).then(function (rawRows) {
                        var rows = sumRowsToObjects(rawRows);
                        if (!rows.length) {
                            setStatus('⚠ The selected sheet' + sheetNote + ' appears to be empty or has only a header row.', 'error');
                            btnSummarise.disabled = true;
                            return;
                        }
                        parsedRows = rows;
                        btnSummarise.disabled = false;
                        doSummarise();
                    });
                }).catch(function (err) {
                    setStatus('⚠ Could not parse file: ' + (err && err.message ? err.message : String(err)), 'error');
                    btnSummarise.disabled = true;
                });
            } catch (err) {
                setStatus('⚠ Could not read XLSX file: ' + (err && err.message ? err.message : String(err)), 'error');
                btnSummarise.disabled = true;
            }
        }
    }

    /* ── Core summarise logic (auto-triggered on upload and on button click) ── */
    function doSummarise() {
        if (!parsedRows || parsedRows.length === 0) {
            setStatus('⚠ Please upload a file first.', 'error');
            return;
        }

        btnSummarise.disabled = true;
        clearResults();

        var headers = Object.keys(parsedRows[0]);
        var cols    = detectSumColumns(headers);
        var stats   = extractSumStats(parsedRows, cols);

        try {
            setStatus('⏳ Generating summary…', 'info');
            var modelLabel  = 'Auto Analysis';
            var builtIn     = builtInSummarise(parsedRows, cols, stats);
            var quality     = analyzeTestQuality(parsedRows, cols);
            var summaryHtml = buildBuiltInSummaryHtml(builtIn, quality, parsedRows, cols, stats);

            renderSumStats(stats, cols);
            renderSumSummary(summaryHtml, modelLabel);

            var ucBreakdownArr = [];
            var ucGroups = groupByUseCase(parsedRows, cols);
            ucGroups.forEach(function (ucRows, ucName) {
                ucBreakdownArr.push({ name: ucName, count: ucRows.length });
            });
            saveToSumHistory(currentFileName, modelLabel, stats, summaryHtml, ucBreakdownArr);

            setStatus('✔ Summary complete.', 'success');

            // Scroll results into view so the user can see them
            if (secStats) {
                secStats.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        } catch (err) {
            setStatus('⚠ ' + (err && err.message ? err.message : String(err)), 'error');
        } finally {
            btnSummarise.disabled = false;
        }
    }

    /* ── Summarise button (re-runs the summary on demand) ── */
    btnSummarise.addEventListener('click', function () {
        doSummarise();
    });

    /* ── Render stats section ── */
    function renderSumStats(stats, cols) {
        var container = document.getElementById('sum-stats-body');
        if (!container) return;

        var html = '<div class="stats-row">';

        // Total
        html += '<div class="stat-chip"><div class="num">' + stats.total + '</div><div class="lbl">Total test cases</div></div>';

        // Use cases
        if (stats.useCases.length > 0) {
            html += '<div class="stat-chip"><div class="num">' + stats.useCases.length + '</div><div class="lbl">Feature areas</div></div>';
        }

        // Automatable
        var autoTotal = stats.automatable + stats.notAutomatable;
        if (autoTotal > 0) {
            var autoPct = Math.round((stats.automatable / autoTotal) * 100);
            html += '<div class="stat-chip" style="border-top:3px solid #2e7d32"><div class="num" style="color:#2e7d32">' + autoPct + '%</div><div class="lbl">Automatable</div></div>';
        }

        // Bugs
        if (stats.withBug > 0) {
            html += '<div class="stat-chip" style="border-top:3px solid #c62828"><div class="num" style="color:#c62828">' + stats.withBug + '</div><div class="lbl">Linked bugs</div></div>';
        }

        html += '</div>';
        container.innerHTML = html;
        secStats.classList.add('visible');
    }

    /* ── Render summary section ── */
    function renderSumSummary(html, modelLabel) {
        var titleEl   = document.getElementById('sum-summary-title');
        var contentEl = document.getElementById('sum-content');
        var baseTitle = '📋 What\'s Being Tested';
        var label = (modelLabel === 'Built-in Analysis') ? baseTitle : baseTitle + ' — ' + modelLabel;
        if (titleEl)   titleEl.textContent = label;
        if (contentEl) contentEl.innerHTML  = html;
        secSummary.classList.add('visible');
    }

    /* ── Build HTML for built-in summary result ── */
    function buildBuiltInSummaryHtml(builtIn, quality, rows, cols, stats) {
        var html = '';

        /* Quality badge */
        if (quality) {
            var badgeStyle = 'display:inline-block;padding:3px 12px;border-radius:12px;'
                + 'font-size:.78rem;font-weight:700;letter-spacing:.03em;margin-bottom:12px;'
                + 'background:' + escSum(quality.qualityColor) + '18;'
                + 'color:' + escSum(quality.qualityColor) + ';'
                + 'border:1.5px solid ' + escSum(quality.qualityColor) + '55;';
            html += '<div style="' + badgeStyle + '">📊 ' + escSum(quality.qualityLabel) + '</div>';
        }

        /* Brief one-sentence narrative summary */
        if (rows && cols && stats) {
            html += buildNarrativeSummary(rows, cols, stats, builtIn, quality);
        } else {
            html += '<p class="sum-narrative-intro">' + builtIn.intro + '</p>';
        }

        return html;
    }

    /* ── Init: nothing to do on load ── */
}());
