/**
 * test-case-analyzer.js
 * Parses an uploaded XLSX file of test cases and identifies
 * missing functional, privacy, security, and performance test cases.
 *
 * Depends on read-excel-file (v7) loaded locally from read-excel-file.min.js.
 */

'use strict';

/* ─────────────────────────────────────────────
   Keyword banks for gap detection
   Each check has an optional `applicableContexts` array.
   If non-empty, the check is only flagged as missing when at least
   one of the listed contexts is detected in the uploaded test cases.
   An empty / absent array means the check is always applicable.
───────────────────────────────────────────── */

// Functional patterns – each entry is {id, label, keywords, scenarios, applicableContexts}
const FUNCTIONAL_CHECKS = [
    { id: 'happy-path',      label: 'Happy / positive path tests',       severity: 'critical',
      keywords: ['success', 'valid', 'positive', 'happy', 'correct', 'should work', 'verify that', 'able to'],
      applicableContexts: [],
      scenarios: [
        'Verify user can complete the primary workflow end-to-end with valid inputs.',
        'Verify the expected success message / confirmation is displayed on completion.',
        'Verify data is correctly saved and retrievable after a successful operation.',
        'Verify the UI state updates correctly after a successful action.',
      ]},
    { id: 'negative-path',   label: 'Negative / invalid input tests',    severity: 'major',
      keywords: ['invalid', 'negative', 'incorrect', 'wrong', 'bad input', 'fail', 'reject', 'error message', 'not allowed'],
      applicableContexts: [],
      scenarios: [
        'Verify an appropriate error message is shown when invalid data is submitted.',
        'Verify the system rejects empty required fields and highlights them.',
        'Verify the user cannot proceed past a step with incorrect/missing inputs.',
        'Verify attempting a forbidden action returns a clear denial message.',
      ]},
    { id: 'boundary',        label: 'Boundary / edge value tests',       severity: 'major',
      keywords: ['boundary', 'edge', 'limit', 'min', 'max', 'maximum', 'minimum', 'overflow', 'empty', 'zero', 'null'],
      applicableContexts: ['has_forms', 'has_api'],
      scenarios: [
        'Verify the field accepts exactly the maximum allowed number of characters.',
        'Verify the field rejects input one character beyond the maximum limit.',
        'Verify the minimum valid value (e.g. 0 or 1) is accepted.',
        'Verify the system handles null / empty values gracefully without crashing.',
        'Verify numeric overflow or extremely large values are rejected with a clear message.',
      ]},
    { id: 'error-handling',  label: 'Error handling tests',              severity: 'major',
      keywords: ['error', 'exception', 'timeout', 'network failure', '500', '404', 'unavailable', 'retry'],
      applicableContexts: [],
      scenarios: [
        'Verify a user-friendly error page / message is shown on a server 500 response.',
        'Verify a 404 page is displayed for invalid or non-existent routes.',
        'Verify the application handles network timeouts gracefully and offers a retry option.',
        'Verify partial failures (one service down) do not break the entire page.',
      ]},
    { id: 'ui-validation',   label: 'UI / form validation tests',        severity: 'minor',
      keywords: ['form', 'field', 'required', 'placeholder', 'dropdown', 'checkbox', 'radio', 'submit button', 'validation message'],
      applicableContexts: ['has_forms'],
      scenarios: [
        'Verify required field indicators (asterisks / labels) are visible.',
        'Verify inline validation messages appear on blur for invalid fields.',
        'Verify dropdown / select defaults to the correct initial option.',
        'Verify the submit button is disabled until all required fields are valid.',
        'Verify checkbox and radio button states are toggled correctly.',
      ]},
    { id: 'pagination',      label: 'Pagination / list navigation tests',severity: 'minor',
      keywords: ['page', 'pagination', 'next', 'previous', 'sort', 'filter', 'search results', 'load more'],
      applicableContexts: ['has_lists'],
      scenarios: [
        'Verify the "Next" button navigates to the next page of results.',
        'Verify the "Previous" button is disabled on the first page.',
        'Verify sorting by a column reorders the list correctly.',
        'Verify the correct number of items per page is displayed.',
        'Verify search / filter results update the paginated list accurately.',
      ]},
    { id: 'crud',            label: 'CRUD operation tests (C/R/U/D)',    severity: 'critical',
      keywords: ['create', 'read', 'update', 'delete', 'add', 'edit', 'remove', 'save', 'modify'],
      applicableContexts: ['has_state_changes'],
      scenarios: [
        'Verify a new record can be created and appears in the list.',
        'Verify record details can be viewed/read without modification.',
        'Verify an existing record can be edited and changes are persisted.',
        'Verify a record can be deleted and no longer appears after deletion.',
        'Verify a confirmation prompt is shown before irreversible delete.',
      ]},
    { id: 'concurrency',     label: 'Concurrency / race condition tests', severity: 'major',
      keywords: ['concurrent', 'simultaneous', 'parallel', 'race condition', 'lock', 'duplicate submission'],
      applicableContexts: ['has_state_changes', 'has_concurrent_ops'],
      scenarios: [
        'Verify duplicate form submissions are prevented (button disabled after first click).',
        'Verify concurrent edits to the same record by two users are handled gracefully.',
        'Verify no data corruption occurs when multiple users save simultaneously.',
        'Verify optimistic-locking or conflict resolution messages are shown when needed.',
      ]},
    { id: 'accessibility',   label: 'Accessibility tests',               severity: 'minor',
      keywords: ['accessibility', 'screen reader', 'keyboard navigation', 'aria', 'wcag', 'a11y', 'tab order'],
      applicableContexts: [],
      scenarios: [
        'Verify all interactive elements are reachable and operable via keyboard alone.',
        'Verify ARIA labels / roles are present on all form controls and icons.',
        'Verify colour contrast ratios are sufficient for readability (minimum 4.5:1 for normal text).',
        'Verify focus order follows a logical reading sequence.',
        'Verify screen-reader announcements are made for dynamic content updates.',
      ]},
    { id: 'smoke-sanity',    label: 'Smoke / sanity tests',              severity: 'showstopper',
      keywords: ['smoke test', 'smoke-test', 'sanity test', 'sanity-test', 'basic test', 'health check', 'health-check', 'critical path', 'critical-path', 'core flow', 'primary flow', 'startup', 'launch'],
      applicableContexts: [],
      scenarios: [
        'Verify the application launches and the primary screen loads without errors.',
        'Verify the most critical end-to-end user journey (e.g. login → perform main action → confirm) completes successfully.',
        'Verify core navigation links and menu items are accessible and route correctly.',
        'Verify the primary data-entry form opens, accepts valid input, and saves without error.',
        'Verify API health/status endpoints return expected 200 responses.',
      ]},
    { id: 'state-transition', label: 'State transition / workflow tests', severity: 'major',
      keywords: ['approve', 'reject', 'status', 'pending', 'workflow', 'transition', 'draft', 'publish', 'active', 'inactive', 'cancel', 'confirm', 'close', 'reopen', 'escalate', 'assign', 'complete', 'in progress', 'in-progress'],
      applicableContexts: ['has_state_changes'],
      scenarios: [
        'Verify all permitted state transitions complete correctly and update the record status immediately.',
        'Verify invalid or skipped state transitions are blocked with a meaningful, specific error message.',
        'Verify only users with the required role can trigger each state transition.',
        'Verify state changes are recorded in the audit log / activity history.',
        'Verify notifications or alerts are triggered for state-change events where expected.',
        'Verify the UI only exposes actions that are valid for the current state (no phantom buttons).',
      ]},
    { id: 'data-integrity',  label: 'Data integrity / persistence tests', severity: 'critical',
      keywords: ['data integrity', 'persist', 'consistent', 'accurate', 'correct data', 'saved', 'stored', 'retrieve', 'reload', 'data loss', 'corrupt'],
      applicableContexts: ['has_state_changes'],
      scenarios: [
        'Verify saved data persists correctly after a page refresh.',
        'Verify saved data is retrievable and unchanged after logout and login.',
        'Verify all field values are stored without truncation, encoding errors, or data-type mismatches.',
        'Verify concurrent writes to the same record do not cause data loss or silent overwrites.',
        'Verify data relationships (references, foreign keys) remain intact after CRUD operations.',
        'Verify that long text, special characters, and Unicode values are stored and displayed correctly.',
      ]},
    { id: 'equivalence-partition', label: 'Equivalence partitioning / input class tests', severity: 'major',
      keywords: ['valid input', 'invalid input', 'input format', 'data type', 'input class', 'partition', 'alphanumeric', 'special character', 'wrong type', 'wrong format'],
      applicableContexts: ['has_forms', 'has_api'],
      scenarios: [
        'Verify a representative value from each VALID input equivalence class is accepted and processed.',
        'Verify a representative value from each INVALID input class is rejected with a specific error message.',
        'Verify inputs of the wrong data type (e.g. text in a numeric field) are rejected with clear guidance.',
        'Verify inputs in an incorrect format (e.g. invalid email format, wrong date format) are rejected.',
        'Verify empty, whitespace-only, and null inputs are handled consistently across all fields.',
        'Verify the system does not proceed or save data when any invalid equivalence class input is present.',
      ]},
];

// Privacy patterns
const PRIVACY_CHECKS = [
    { id: 'pii-display',     label: 'PII masking / display tests (emails, phone, SSN, DOB)',  severity: 'critical',
      keywords: ['pii', 'personal', 'mask', 'redact', 'email', 'phone', 'ssn', 'date of birth', 'dob', 'address', 'name visible', 'sensitive data'],
      applicableContexts: ['has_pii'],
      scenarios: [
        'Verify email addresses are partially masked (e.g. j***@example.com) in the UI.',
        'Verify phone numbers display only the last 4 digits.',
        'Verify SSN / national ID is masked and never shown in full.',
        'Verify PII fields are not included in client-side logs or error messages.',
        'Verify sensitive data is not exposed in URL query parameters.',
      ]},
    { id: 'consent',         label: 'User consent & opt-in/opt-out tests',                    severity: 'critical',
      keywords: ['consent', 'opt-in', 'opt-out', 'gdpr', 'ccpa', 'privacy policy', 'cookie', 'agree', 'permission'],
      applicableContexts: ['has_pii'],
      scenarios: [
        'Verify a consent / cookie banner is shown to new users on first visit.',
        'Verify users can opt-out of non-essential cookies and the preference is saved.',
        'Verify marketing emails are only sent to users who have opted in.',
        'Verify the privacy policy link is accessible from the consent form.',
        'Verify withdrawing consent stops further data processing immediately.',
      ]},
    { id: 'data-retention',  label: 'Data retention & deletion tests',                        severity: 'major',
      keywords: ['retention', 'delete account', 'right to erasure', 'data deletion', 'purge', 'anonymize', 'right to be forgotten'],
      applicableContexts: ['has_pii'],
      scenarios: [
        'Verify user data is purged / anonymized after the defined retention period.',
        'Verify a user can request full account deletion and all their data is removed.',
        'Verify deletion is confirmed to the user after the data erasure request is fulfilled.',
        'Verify backup copies are also cleared within the defined timeframe.',
      ]},
    { id: 'data-access',     label: 'Data access control tests (who can see what)',           severity: 'critical',
      keywords: ['access control', 'who can see', 'visibility', 'profile privacy', 'data sharing', 'expose', 'leak', 'third party'],
      applicableContexts: ['has_pii', 'has_roles'],
      scenarios: [
        'Verify a user can only view their own personal data, not other users\'.',
        'Verify the admin role can view all records but regular users cannot.',
        'Verify sensitive fields are hidden from lower-privilege roles.',
        'Verify API endpoints do not return data belonging to a different user.',
        'Verify third-party data sharing is clearly disclosed and controllable by the user.',
      ]},
    { id: 'audit-log',       label: 'Audit / activity log tests',                             severity: 'major',
      keywords: ['audit', 'activity log', 'history', 'track', 'log access', 'audit trail'],
      applicableContexts: ['has_auth', 'has_roles', 'has_pii'],
      scenarios: [
        'Verify successful and failed login attempts are recorded in the audit log.',
        'Verify access to sensitive data generates an audit-log entry with timestamp and user.',
        'Verify audit log entries cannot be modified or deleted by regular users.',
        'Verify admins can filter / search the audit log by user, date, and action.',
      ]},
    { id: 'data-export',     label: 'Data export / portability tests',                        severity: 'minor',
      keywords: ['export', 'download data', 'data portability', 'backup', 'portable'],
      applicableContexts: ['has_pii'],
      scenarios: [
        'Verify users can download their personal data in a standard format (CSV / JSON).',
        'Verify the exported file contains all relevant user data fields.',
        'Verify the export function is restricted to the authenticated account owner.',
        'Verify a confirmation / notification is sent when a data export is ready.',
      ]},
];

// Security patterns
const SECURITY_CHECKS = [
    { id: 'authn',           label: 'Authentication tests (login, logout, MFA)',              severity: 'showstopper',
      keywords: ['login', 'logout', 'sign in', 'sign out', 'authentication', 'mfa', '2fa', 'otp', 'sso', 'token', 'session'],
      applicableContexts: ['has_auth'],
      scenarios: [
        'Verify a user cannot access protected pages without being logged in.',
        'Verify the session is fully invalidated on logout.',
        'Verify MFA / OTP is required for sensitive operations or privileged accounts.',
        'Verify login fails with incorrect credentials and shows a generic error.',
        'Verify SSO / third-party login flow completes correctly and creates a session.',
      ]},
    { id: 'authz',           label: 'Authorization / role-based access tests',                severity: 'showstopper',
      keywords: ['authorization', 'role', 'permission', 'access denied', 'forbidden', 'privilege', 'rbac', 'admin only', 'unauthorized'],
      applicableContexts: ['has_roles', 'has_auth'],
      scenarios: [
        'Verify non-admin users cannot access admin-only pages (expect 403 / redirect).',
        'Verify RBAC permissions are enforced on all API endpoints.',
        'Verify a user cannot modify another user\'s resources via direct URL manipulation.',
        'Verify privilege escalation attempts are rejected.',
        'Verify "Access Denied" messages do not leak sensitive system information.',
      ]},
    { id: 'injection',       label: 'Injection attack tests (SQL, command, LDAP)',            severity: 'critical',
      keywords: ['sql injection', 'injection', 'command injection', 'ldap', 'nosql injection', 'xpath', 'special characters'],
      applicableContexts: ['has_forms', 'has_api'],
      scenarios: [
        'Verify SQL injection payloads (e.g. \' OR 1=1 --) in input fields are sanitized.',
        'Verify command injection characters (;, |, &&) are rejected or escaped.',
        'Verify NoSQL injection attempts do not return unintended data.',
        'Verify parameterized queries / prepared statements are used for DB interactions.',
      ]},
    { id: 'xss',             label: 'Cross-site scripting (XSS) tests',                       severity: 'critical',
      keywords: ['xss', 'cross-site scripting', 'script injection', '<script', 'alert(', 'javascript:'],
      applicableContexts: ['has_forms', 'has_user_content'],
      scenarios: [
        'Verify user-supplied content containing <script> tags is escaped before rendering.',
        'Verify javascript: URIs in href/src attributes are blocked.',
        'Verify stored XSS payloads in user profiles / comments are not executed.',
        'Verify DOM-based XSS via URL parameters is prevented.',
      ]},
    { id: 'csrf',            label: 'CSRF protection tests',                                  severity: 'critical',
      keywords: ['csrf', 'cross-site request forgery', 'anti-csrf', 'csrf token', 'samesite'],
      applicableContexts: ['has_state_changes', 'has_forms', 'has_auth'],
      scenarios: [
        'Verify all state-changing requests (POST/PUT/DELETE) include a valid CSRF token.',
        'Verify requests without a valid CSRF token are rejected with 403.',
        'Verify SameSite cookie attribute is set to Strict or Lax.',
        'Verify CSRF tokens are unique per session and not reused.',
      ]},
    { id: 'session-mgmt',    label: 'Session management tests (expiry, fixation)',            severity: 'critical',
      keywords: ['session expir', 'session timeout', 'session fixation', 'cookie secure', 'httponly', 'session hijack'],
      applicableContexts: ['has_auth'],
      scenarios: [
        'Verify the session automatically expires after the configured idle timeout.',
        'Verify a new session token is issued on login (prevents session fixation).',
        'Verify session cookies have HttpOnly and Secure flags set.',
        'Verify the old session token is invalid after logout.',
      ]},
    { id: 'input-validation',label: 'Input validation & sanitization tests',                  severity: 'major',
      keywords: ['sanitiz', 'whitelist', 'blacklist', 'input length', 'special char', 'html escap', 'encode', 'valid input'],
      applicableContexts: ['has_forms', 'has_api'],
      scenarios: [
        'Verify all input fields enforce maximum length limits on both client and server.',
        'Verify special characters are HTML-encoded before being reflected in responses.',
        'Verify path traversal patterns (../) in filename inputs are rejected.',
        'Verify server-side validation rejects payloads that pass client-side checks.',
      ]},
    { id: 'encryption',      label: 'Encryption / data-at-rest and in-transit tests',         severity: 'critical',
      keywords: ['encrypt', 'decrypt', 'https', 'tls', 'ssl', 'at rest', 'in transit', 'hash', 'password storage'],
      applicableContexts: ['has_auth', 'has_pii'],
      scenarios: [
        'Verify all pages and API calls are served over HTTPS (no mixed content).',
        'Verify passwords are stored as salted hashes (never plaintext).',
        'Verify sensitive data fields in the database are encrypted at rest.',
        'Verify TLS certificate is valid and not expired.',
      ]},
    { id: 'rate-limiting',   label: 'Rate limiting / brute-force protection tests',           severity: 'major',
      keywords: ['rate limit', 'brute force', 'lockout', 'throttle', 'too many attempts', 'captcha'],
      applicableContexts: ['has_auth', 'has_api'],
      scenarios: [
        'Verify the account is locked / throttled after N consecutive failed login attempts.',
        'Verify API endpoints return HTTP 429 when the rate limit is exceeded.',
        'Verify CAPTCHA is triggered after repeated failed authentication attempts.',
        'Verify IP-based rate limiting is applied to sensitive endpoints.',
      ]},
    { id: 'file-upload-sec', label: 'File upload security tests',                             severity: 'major',
      keywords: ['file upload', 'malicious file', 'file type', 'antivirus', 'file size limit', 'mime type'],
      applicableContexts: ['has_file_upload'],
      scenarios: [
        'Verify only explicitly allowed file types (whitelist) can be uploaded.',
        'Verify files exceeding the size limit are rejected with a clear error.',
        'Verify uploaded files are stored outside the web root (not directly accessible).',
        'Verify file names are sanitized to prevent path traversal or script execution.',
        'Verify MIME type is validated server-side, not just by file extension.',
      ]},
];

// Performance patterns – dedicated category
const PERFORMANCE_CHECKS = [
    { id: 'page-load',       label: 'Page load / response time tests',            severity: 'major',
      keywords: ['page load', 'load time', 'response time', 'latency', 'speed', 'ttfb', 'lcp', 'first contentful', 'time to interactive'],
      applicableContexts: [],
      scenarios: [
        'Verify the main page loads within the acceptable threshold (e.g. < 3 s) on a standard connection.',
        'Verify Time to First Byte (TTFB) is within acceptable limits.',
        'Verify Largest Contentful Paint (LCP) meets the target (e.g. < 2.5 s).',
        'Verify the page remains visually stable during load (low Cumulative Layout Shift).',
      ]},
    { id: 'api-perf',        label: 'API / backend response time tests',          severity: 'major',
      keywords: ['api response', 'endpoint latency', 'server response', 'backend performance', 'api speed'],
      applicableContexts: ['has_api', 'has_state_changes'],
      scenarios: [
        'Verify API endpoints respond within the defined SLA (e.g. < 500 ms) under normal load.',
        'Verify bulk/export API calls complete within an acceptable timeout.',
        'Verify slow queries are identified and optimized with appropriate indexes.',
        'Verify API response times are monitored and alerted on threshold breaches.',
      ]},
    { id: 'load-testing',    label: 'Concurrent user / load tests',               severity: 'major',
      keywords: ['concurrent user', 'load test', 'simultaneous request', 'traffic spike', 'user load', 'stress test'],
      applicableContexts: [],
      scenarios: [
        'Verify the application remains responsive when the expected number of concurrent users is active.',
        'Verify no significant degradation occurs at peak load (e.g. 2× expected traffic).',
        'Verify background jobs and queues do not starve the main request thread under load.',
        'Verify auto-scaling / resource limits behave correctly under sustained traffic.',
      ]},
    { id: 'db-perf',         label: 'Database / query performance tests',         severity: 'major',
      keywords: ['database performance', 'query time', 'slow query', 'db latency', 'index', 'query optimization'],
      applicableContexts: ['has_state_changes', 'has_lists'],
      scenarios: [
        'Verify list/search queries execute within acceptable time as data volume grows.',
        'Verify paginated queries do not degrade with large offsets.',
        'Verify write-heavy operations (bulk inserts/updates) do not cause lock contention.',
        'Verify database connection pooling is configured to avoid exhaustion under load.',
      ]},
    { id: 'frontend-perf',   label: 'Front-end / rendering performance tests',    severity: 'minor',
      keywords: ['render time', 'bundle size', 'javascript performance', 'dom performance', 'animation', 'scroll performance'],
      applicableContexts: [],
      scenarios: [
        'Verify JavaScript bundle sizes are within acceptable limits (e.g. < 200 KB gzipped).',
        'Verify scrolling and animations remain smooth (targeting 60 fps).',
        'Verify large lists use virtualization / lazy rendering to prevent DOM bloat.',
        'Verify images and assets are properly optimised and served in modern formats.',
      ]},
    { id: 'perf-degradation', label: 'Performance regression / degradation tests', severity: 'minor',
      keywords: ['performance regression', 'performance benchmark', 'degradation', 'baseline', 'performance budget'],
      applicableContexts: [],
      scenarios: [
        'Verify new releases do not introduce measurable performance regressions against a baseline.',
        'Verify performance budgets are enforced in the CI/CD pipeline.',
        'Verify memory usage does not grow unboundedly over a prolonged session (memory leak check).',
        'Verify third-party scripts do not significantly impact page load performance.',
      ]},
];

// Compatibility patterns – cross-browser, mobile, and localisation
const COMPATIBILITY_CHECKS = [
    { id: 'cross-browser',    label: 'Cross-browser compatibility tests',           severity: 'major',
      keywords: ['chrome', 'firefox', 'safari', 'edge', 'browser', 'cross-browser', 'cross browser', 'ie11', 'internet explorer'],
      applicableContexts: [],
      scenarios: [
        'Verify the application functions correctly and consistently in Chrome, Firefox, Safari, and Edge (latest versions).',
        'Verify no browser-specific layout breaks, missing elements, or JavaScript console errors appear.',
        'Verify forms, file uploads, and all dynamic UI interactions work in all major browsers.',
        'Verify CSS styles, animations, and transitions render consistently across browsers.',
        'Verify third-party scripts, fonts, and embedded content load correctly in all tested browsers.',
      ]},
    { id: 'mobile-responsive', label: 'Mobile / responsive design tests',           severity: 'major',
      keywords: ['mobile', 'responsive', 'tablet', 'ipad', 'iphone', 'android', 'viewport', 'touch', 'swipe', 'pinch', 'landscape', 'portrait'],
      applicableContexts: [],
      scenarios: [
        'Verify the layout adapts correctly to mobile screen widths (320 px – 767 px).',
        'Verify the layout adapts correctly to tablet screen widths (768 px – 1024 px).',
        'Verify touch interactions (tap, swipe, scroll) work correctly on iOS and Android devices.',
        'Verify text is legible and tap targets are adequately large (≥ 44 × 44 px) on small screens.',
        'Verify the application works correctly in both portrait and landscape orientations.',
        'Verify no horizontal scrollbars appear on mobile viewport sizes.',
      ]},
    { id: 'localisation',     label: 'Localisation / internationalisation tests',   severity: 'minor',
      keywords: ['locale', 'language', 'i18n', 'l10n', 'internationalisation', 'localisation', 'localization', 'internationalization', 'translation', 'multilingual', 'rtl', 'unicode', 'currency', 'date format', 'time zone'],
      applicableContexts: [],
      scenarios: [
        'Verify the application supports switching between all configured languages and locales.',
        'Verify dates, times, numbers, and currencies are formatted according to the active locale.',
        'Verify RTL (right-to-left) text is rendered and aligned correctly for applicable languages.',
        'Verify translated strings are not truncated or overflowing UI containers.',
        'Verify Unicode and multi-byte characters are stored and displayed without corruption.',
        'Verify time-zone-sensitive data is displayed in the user\'s local time zone.',
      ]},
    { id: 'os-platform',      label: 'Operating system / desktop platform tests',   severity: 'minor',
      keywords: ['windows', 'macos', 'linux', 'operating system', 'os', 'platform', 'desktop app', 'electron', 'native'],
      applicableContexts: [],
      scenarios: [
        'Verify the application installs and runs without errors on Windows (latest stable version).',
        'Verify the application installs and runs without errors on macOS (latest stable version).',
        'Verify file system operations (save, open, upload) behave correctly on each supported OS.',
        'Verify keyboard shortcuts respect OS-specific modifier keys (Ctrl on Windows, Cmd on macOS).',
        'Verify system notifications or integrations (clipboard, file picker) work on all supported platforms.',
      ]},
];

/* ─────────────────────────────────────────────
   Utility helpers
───────────────────────────────────────────── */

/**
 * Return a lowercase single string from all text columns in a row object.
 */
function rowText(row) {
    return Object.values(row).join(' ').toLowerCase();
}

/**
 * Check whether any keyword appears in the given text.
 */
function anyKeyword(text, keywords) {
    return keywords.some(kw => text.includes(kw.toLowerCase()));
}

/**
 * Detect the likely column that holds test-case names / titles.
 */
function detectTitleColumn(headers) {
    const candidates = ['test case', 'test name', 'title', 'scenario', 'description', 'name', 'test', 'case'];
    for (const c of candidates) {
        const match = headers.find(h => h.toLowerCase().includes(c));
        if (match) return match;
    }
    return headers[0];
}

/**
 * Attempt to derive a "feature / module" label from a row using common column names.
 */
function detectFeatureColumn(headers) {
    const candidates = ['feature', 'module', 'component', 'section', 'area', 'category', 'epic', 'sprint'];
    for (const c of candidates) {
        const match = headers.find(h => h.toLowerCase().includes(c));
        if (match) return match;
    }
    return null;
}

/**
 * Analyse the uploaded test-case texts and return a Set of active feature
 * contexts.  These contexts are used to filter which gap checks are
 * applicable to the uploaded test suite so that irrelevant checks (e.g. XSS
 * for a read-only display page, or CSRF for a feature with no state changes)
 * are not surfaced as "missing".
 *
 * Contexts:
 *   has_forms        – the feature involves user-input forms / fields
 *   has_auth         – the feature involves authentication / sessions
 *   has_user_content – the feature handles user-generated text content
 *   has_state_changes – the feature creates / updates / deletes data
 *   has_pii          – the feature handles personal / sensitive data
 *   has_lists        – the feature has list / search / pagination views
 *   has_file_upload  – the feature has file upload / download operations
 *   has_roles        – the feature has multiple user roles / permissions
 *   has_api          – the feature exercises API / backend endpoints
 *   has_concurrent_ops – the feature mentions concurrent / parallel usage
 */

// Maps each feature context to the regex that detects it in test-case text.
const CONTEXT_PATTERNS = [
    { context: 'has_forms',         pattern: /\b(form|field|input|submit|button|enter|type|fill|textbox|dropdown|checkbox|radio)\b/ },
    { context: 'has_auth',          pattern: /\b(login|logout|sign in|sign out|sign-in|sign-out|password|auth|session|mfa|2fa|otp|token|sso|credential)\b/ },
    { context: 'has_user_content',  pattern: /\b(comment|post|review|content|user.?generated|message|thread|reply|feedback|note)\b/ },
    { context: 'has_state_changes', pattern: /\b(create|add|save|submit|update|edit|modify|delete|remove|change|insert|patch|put)\b/ },
    { context: 'has_pii',           pattern: /\b(email address|phone number|phone no|mobile number|home address|personal info|personal data|date of birth|dob|ssn|social security|pii|user profile|account details|full name|first name|last name|national id|credit card|passport)\b/ },
    { context: 'has_lists',         pattern: /\b(list|search|filter|sort|paginate|pagination|results|grid|table|find|query|browse)\b/ },
    { context: 'has_file_upload',   pattern: /\b(upload|file|attachment|document|import|export|download|image|pdf|csv|xlsx)\b/ },
    { context: 'has_roles',         pattern: /\b(role|permission|admin|access|rbac|privilege|unauthorized|forbidden|user management)\b/ },
    { context: 'has_api',           pattern: /\b(api|endpoint|request|response|webhook|integration|rest|graphql|http|json|xml)\b/ },
    { context: 'has_concurrent_ops',pattern: /\b(concurrent|simultaneous|parallel|multiple user|race condition|lock|duplicate submission)\b/ },
];

function detectFeatureContexts(allTexts) {
    const combined = allTexts.join(' ').toLowerCase();
    const ctx = new Set();
    CONTEXT_PATTERNS.forEach(({ context, pattern }) => {
        if (pattern.test(combined)) ctx.add(context);
    });
    return ctx;
}

/**
 * Run one bank of checks (FUNCTIONAL / PRIVACY / SECURITY / PERFORMANCE)
 * against all row texts.  Checks whose `applicableContexts` list is non-empty
 * are only evaluated when at least one of the listed contexts is present in
 * the uploaded test suite; otherwise they are skipped entirely (marked
 * notApplicable) so that irrelevant gaps are not surfaced.
 *
 * Returns an array of { id, label, covered, severity, scenarios,
 *                        notApplicable? } objects.
 */
function runChecks(checks, allRowTexts, activeContexts) {
    return checks.map(check => {
        const base = { id: check.id, label: check.label, severity: check.severity || 'minor', scenarios: check.scenarios || [] };

        // Determine applicability based on feature contexts
        const requiredCtx = check.applicableContexts || [];
        if (requiredCtx.length > 0 && !requiredCtx.some(c => activeContexts.has(c))) {
            return { ...base, covered: true, notApplicable: true };
        }

        const covered = allRowTexts.some(t => anyKeyword(t, check.keywords));
        return { ...base, covered };
    });
}

/**
 * Infer unique features from rows using the detected feature column.
 * Falls back to extracting keywords if no explicit column exists.
 */
function extractFeatures(rows, featureCol) {
    const features = new Set();
    if (featureCol) {
        rows.forEach(r => {
            const v = (r[featureCol] || '').toString().trim();
            if (v) features.add(v);
        });
    } else {
        // Heuristic: pull capitalised proper-noun-ish tokens from test names
        const titleKws = ['login', 'signup', 'dashboard', 'profile', 'settings', 'search',
                          'upload', 'download', 'payment', 'checkout', 'cart', 'notification',
                          'report', 'admin', 'user', 'role', 'permission', 'api', 'integration'];
        rows.forEach(r => {
            const text = rowText(r);
            titleKws.forEach(kw => { if (text.includes(kw)) features.add(kw.charAt(0).toUpperCase() + kw.slice(1)); });
        });
    }
    return [...features].filter(Boolean);
}

/* ─────────────────────────────────────────────
   Feature summary generation
───────────────────────────────────────────── */

function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Generate a brief human-readable paragraph summarising what the
 * uploaded test suite is testing, based on the test-case titles.
 */
function generateFeatureSummary(testCaseTexts, features) {
    const allText = testCaseTexts.join(' ').toLowerCase();

    // Broad feature-domain detection
    const domains = [
        { name: 'authentication',        keywords: ['login', 'logout', 'sign in', 'sign out', 'register', 'password', 'mfa', '2fa', 'otp', 'sso', 'session'] },
        { name: 'user profile / account', keywords: ['profile', 'account', 'avatar', 'personal info', 'bio', 'user settings', 'preferences'] },
        { name: 'payment / checkout',    keywords: ['payment', 'checkout', 'cart', 'order', 'purchase', 'billing', 'invoice', 'refund', 'transaction'] },
        { name: 'search & filtering',    keywords: ['search', 'filter', 'sort', 'query', 'find', 'results'] },
        { name: 'file upload',           keywords: ['upload', 'file', 'attachment', 'import', 'document'] },
        { name: 'notifications',         keywords: ['notification', 'alert', 'email', 'sms', 'push', 'reminder'] },
        { name: 'reporting / dashboard', keywords: ['report', 'dashboard', 'analytics', 'chart', 'graph', 'export', 'metric'] },
        { name: 'administration',        keywords: ['admin', 'role', 'permission', 'user management', 'access control', 'rbac'] },
        { name: 'API / integrations',    keywords: ['api', 'integration', 'webhook', 'endpoint', 'request', 'response', 'third-party'] },
        { name: 'data management',       keywords: ['create', 'edit', 'delete', 'update', 'save', 'list', 'view', 'record'] },
    ];

    const matchedDomains = domains
        .map(d => ({ name: d.name, count: d.keywords.filter(kw => allText.includes(kw)).length }))
        .filter(d => d.count > 0)
        .sort((a, b) => b.count - a.count);

    // Action/operation types present in the test cases
    const actionTypes = [];
    if (/\b(create|add|new|register|submit)\b/.test(allText)) actionTypes.push('creation');
    if (/\b(edit|update|modify|change|save)\b/.test(allText))   actionTypes.push('editing');
    if (/\b(delete|remove|archive|clear)\b/.test(allText))      actionTypes.push('deletion');
    if (/\b(search|filter|find|query)\b/.test(allText))         actionTypes.push('search & filtering');
    if (/\b(login|sign in|authenticate|logout)\b/.test(allText)) actionTypes.push('authentication');
    if (/\b(permission|role|access|authoriz)\b/.test(allText))  actionTypes.push('access control');
    if (/\b(valid|invalid|error|boundary|negative)\b/.test(allText)) actionTypes.push('input validation');

    // Build the summary paragraph
    let summary = '';

    if (features && features.length > 0) {
        const listed = features.slice(0, 5).join(', ');
        summary += `This test suite covers the <strong>${escapeHtml(listed)}</strong> feature area${features.slice(0, 5).length > 1 ? 's' : ''}. `;
    } else if (matchedDomains.length > 0) {
        const topNames = matchedDomains.slice(0, 3).map(d => d.name).join(', ');
        summary += `This test suite focuses on <strong>${escapeHtml(topNames)}</strong>. `;
    } else {
        summary += 'This test suite covers a general application feature. ';
    }

    if (actionTypes.length > 0) {
        summary += `The test cases exercise <strong>${escapeHtml(actionTypes.join(', '))}</strong> scenarios`;
        if (matchedDomains.length > 0) {
            summary += ` within the detected feature area${matchedDomains.length > 1 ? 's' : ''}`;
        }
        summary += '. ';
    }

    summary += `A total of <strong>${testCaseTexts.length}</strong> test case${testCaseTexts.length !== 1 ? 's were' : ' was'} read and analysed for coverage gaps.`;

    return summary;
}

/* ─────────────────────────────────────────────
   Industry-standard column detection for review
───────────────────────────────────────────── */

/**
 * Semantic column variants matched case-insensitively against spreadsheet headers.
 * Used by reviewTestCaseQuality to locate required IEEE 829 fields.
 */
const REVIEWER_COL_MAP = {
    testCaseId:     ['test case id', 'tc id', 'testcaseid', 'tc_id', 'test id', 'case id', 'id', '#'],
    testCase:       ['test case', 'test name', 'title', 'scenario', 'test scenario', 'description', 'name', 'test'],
    precondition:   ['precondition', 'pre-condition', 'pre condition', 'prerequisite', 'preconditions', 'setup'],
    steps:          ['steps', 'step', 'test steps', 'test procedure', 'procedure', 'actions', 'action'],
    expectedResult: ['expected results', 'expected result', 'expected outcome', 'expected', 'outcome', 'expected behavior'],
    severity:       ['severity', 'priority', 'impact', 'risk level', 'criticality'],
};

function detectReviewerColumns(headers) {
    const normalised = headers.map(h => String(h).trim().toLowerCase());
    const result = {};
    Object.entries(REVIEWER_COL_MAP).forEach(([field, variants]) => {
        for (const v of variants) {
            const idx = normalised.indexOf(v);
            if (idx !== -1) { result[field] = headers[idx]; break; }
        }
    });
    return result;
}

/* ─────────────────────────────────────────────
   Test case review quality analyser
   Evaluates the uploaded test cases against
   IEEE 829 Test Case Specification &
   ISTQB Test Design best practices.
───────────────────────────────────────────── */

/**
 * Evaluate the quality of the uploaded test cases against industry standards.
 *
 * Scoring breakdown (100 pts total):
 *  - Field completeness  40 pts  (presence + fill-rate of required IEEE 829 fields)
 *  - Expected result quality 20 pts  (verifiable, measurable outcomes)
 *  - Test steps quality  20 pts  (steps present and non-empty)
 *  - Coverage balance    20 pts  (positive + negative + boundary scenarios)
 *
 * @param {Object[]} rows  - Parsed row objects.
 * @param {Object}   cols  - Detected column map (from detectReviewerColumns).
 * @returns {Object|null}
 */
function reviewTestCaseQuality(rows, cols) {
    const total = rows.length;
    if (!total) return null;

    /* ── 1. Field completeness metrics ── */
    const fieldChecks = [
        { key: 'testCaseId',    label: 'Test Case ID',            weight: 8,
          desc: 'Unique identifier for each test case' },
        { key: 'testCase',      label: 'Test Case Title/Description', weight: 12,
          desc: 'Clear, descriptive name of what is being tested' },
        { key: 'precondition',  label: 'Preconditions',           weight: 5,
          desc: 'Environmental or state conditions required before execution' },
        { key: 'steps',         label: 'Test Steps',              weight: 10,
          desc: 'Numbered, action-oriented steps for test execution' },
        { key: 'expectedResult',label: 'Expected Results',        weight: 10,
          desc: 'Specific, measurable outcome for each test' },
        { key: 'severity',      label: 'Severity / Priority',     weight: 5,
          desc: 'Risk-based priority to guide execution order' },
    ];

    const fieldMetrics = fieldChecks.map(fc => {
        if (!cols[fc.key]) {
            return { label: fc.label, desc: fc.desc, pct: 0, present: false, colMissing: true, weight: fc.weight };
        }
        const filled = rows.filter(r => String(r[cols[fc.key]] || '').trim().length > 0).length;
        return { label: fc.label, desc: fc.desc, pct: Math.round((filled / total) * 100), present: true, colMissing: false, weight: fc.weight };
    });

    /* ── 2. Field completeness score (40 pts) ── */
    const maxFieldWeight = fieldChecks.reduce((s, f) => s + f.weight, 0);
    let rawFieldScore = 0;
    fieldMetrics.forEach(fm => {
        if (!fm.colMissing) rawFieldScore += Math.round((fm.pct / 100) * fm.weight);
    });
    const fieldScore = Math.round((rawFieldScore / maxFieldWeight) * 40);

    /* ── 3. Expected result quality score (20 pts) ── */
    let clearExpected = 0;
    let expFilled = 0;
    if (cols.expectedResult) {
        rows.forEach(r => {
            const exp = String(r[cols.expectedResult] || '').trim();
            if (!exp) return;
            expFilled++;
            // Verifiable outcomes: action verbs, UI states, numbers, error/success keywords
            const isVerifiable = /\b(should|displays?|shows?|returns?|confirms?|navigates?|redirects?|updates?|creates?|deletes?|saves?|appears?|disappears?|enabled|disabled|visible|hidden|selected|checked|error|success|message|\d+\s*(ms|second|record|result|item|row|character|char|kb|mb))\b/i.test(exp);
            if (isVerifiable) clearExpected++;
        });
    }
    const expQualScore = expFilled > 0 ? Math.round((clearExpected / expFilled) * 100) : 0;
    const expScore = cols.expectedResult ? Math.round((expQualScore / 100) * 20) : 0;

    /* ── 4. Steps quality score (20 pts) ── */
    let stepsScore = 0;
    if (cols.steps) {
        const stepsWithContent = rows.filter(r => String(r[cols.steps] || '').trim().length > 0).length;
        stepsScore = Math.round((stepsWithContent / total) * 20);
    } else if (cols.testCase) {
        stepsScore = 10; // Partial credit when only a title/description column is present
    }

    /* ── 5. Coverage balance score (20 pts) ── */
    const allText = rows.map(r => Object.values(r).join(' ').toLowerCase()).join(' ');
    const hasPositive = /\b(valid|success|successful|positive|happy[\s-]?path|correct|verify that|able to|complete)\b/.test(allText);
    const hasNegative = /\b(invalid|negative|error|fail|reject|not allowed|cannot|unable|blocked|denied|wrong|bad input)\b/.test(allText);
    const hasBoundary = /\b(boundary|limit|min\b|max\b|maximum|minimum|overflow|empty|zero|null|edge[\s-]?case|out[\s-]of[\s-]range)\b/.test(allText);
    const covScore    = (hasPositive ? 7 : 0) + (hasNegative ? 7 : 0) + (hasBoundary ? 6 : 0);

    const totalScore = Math.min(100, fieldScore + expScore + stepsScore + covScore);

    /* ── Grade ── */
    let grade, gradeColor, gradeLabel;
    if (totalScore >= 80)      { grade = 'A'; gradeColor = '#1b5e20'; gradeLabel = 'Excellent'; }
    else if (totalScore >= 60) { grade = 'B'; gradeColor = '#2e7d32'; gradeLabel = 'Good'; }
    else if (totalScore >= 40) { grade = 'C'; gradeColor = '#e65100'; gradeLabel = 'Fair'; }
    else if (totalScore >= 20) { grade = 'D'; gradeColor = '#bf360c'; gradeLabel = 'Poor'; }
    else                       { grade = 'F'; gradeColor = '#b71c1c'; gradeLabel = 'Inadequate'; }

    /* ── Coverage checklist ── */
    const coverageItems = [
        { label: 'Positive / Happy-path tests',    present: hasPositive },
        { label: 'Negative / Invalid-input tests', present: hasNegative },
        { label: 'Boundary / Limit-value tests',   present: hasBoundary },
    ];

    /* ── Recommendations ── */
    const recommendations = [];
    fieldMetrics.forEach(fm => {
        if (fm.colMissing) {
            recommendations.push('❌ Add a <strong>' + escapeHtml(fm.label) + '</strong> column — ' + fm.desc + '.');
        } else if (fm.pct < 80) {
            recommendations.push('⚠ <strong>' + escapeHtml(fm.label) + '</strong> is empty in ' + (100 - fm.pct) + '% of rows. ' + fm.desc + '.');
        }
    });
    if (cols.expectedResult && expFilled > 0 && expQualScore < 70) {
        recommendations.push('⚠ <strong>Expected results</strong> lack specificity in ' + (100 - expQualScore) + '% of test cases. Use action verbs and measurable outcomes — e.g. "The system displays a success message" rather than "It works correctly".');
    }
    if (!hasNegative) {
        recommendations.push('⚠ <strong>No negative test cases detected.</strong> Add tests for invalid inputs, error messages, and rejection scenarios.');
    }
    if (!hasBoundary) {
        recommendations.push('⚠ <strong>No boundary value tests detected.</strong> Add tests at minimum, maximum, and just-outside-limit values.');
    }
    if (!hasPositive) {
        recommendations.push('⚠ <strong>No positive / happy-path tests detected.</strong> Verify that core functional flows succeed with valid inputs.');
    }
    if (recommendations.length === 0) {
        recommendations.push('✅ Test cases meet baseline quality standards. Continue adding security, performance, and exploratory tests for comprehensive coverage.');
    }

    return {
        score: totalScore,
        grade: grade,
        gradeColor: gradeColor,
        gradeLabel: gradeLabel,
        fieldMetrics: fieldMetrics,
        coverageItems: coverageItems,
        expQualScore: expQualScore,
        stepsScore: stepsScore,
        covScore: covScore,
        recommendations: recommendations,
    };
}

/* ─────────────────────────────────────────────
   Main analysis entry-point
───────────────────────────────────────────── */

/**
 * Analyse an array of row objects (parsed from XLSX).
 * Returns a structured result object for the UI to render.
 */
function analyzeTestCases(rows) {
    if (!rows || rows.length === 0) {
        return { error: 'No data rows found in the spreadsheet.' };
    }

    const headers    = Object.keys(rows[0]);
    const titleCol   = detectTitleColumn(headers);
    const featureCol = detectFeatureColumn(headers);
    // Only use the test-case title/description column for gap analysis
    const allTexts   = rows.map(r => String(r[titleCol] ?? '').toLowerCase());

    // Detect what kind of feature/flow this test suite covers
    const activeContexts = detectFeatureContexts(allTexts);

    const functionalResults     = runChecks(FUNCTIONAL_CHECKS,    allTexts, activeContexts);
    const privacyResults        = runChecks(PRIVACY_CHECKS,       allTexts, activeContexts);
    const securityResults       = runChecks(SECURITY_CHECKS,      allTexts, activeContexts);
    const performanceResults    = runChecks(PERFORMANCE_CHECKS,   allTexts, activeContexts);
    const compatibilityResults  = runChecks(COMPATIBILITY_CHECKS, allTexts, activeContexts);

    const features = extractFeatures(rows, featureCol);
    const featureSummary = generateFeatureSummary(allTexts, features);

    // Industry-standard review quality assessment
    const reviewCols    = detectReviewerColumns(headers);
    const reviewQuality = reviewTestCaseQuality(rows, reviewCols);

    return {
        totalRows:   rows.length,
        headers,
        titleCol,
        featureCol,
        features,
        activeContexts,
        functional:    functionalResults,
        privacy:       privacyResults,
        security:      securityResults,
        performance:   performanceResults,
        compatibility: compatibilityResults,
        rows,
        featureSummary,
        reviewCols,
        reviewQuality,
    };
}

/* ─────────────────────────────────────────────
   DOM / UI logic
───────────────────────────────────────────── */

(function () {
    const dropZone   = document.getElementById('drop-zone');
    const fileInput  = document.getElementById('file-input');
    const btnAnalyze = document.getElementById('btn-analyze');
    const statusBar  = document.getElementById('status-bar');

    const secSummary        = document.getElementById('sec-summary');
    const secFeatureSummary = document.getElementById('sec-feature-summary');
    const secReviewQuality  = document.getElementById('sec-review-quality');
    const secFeatures       = document.getElementById('sec-features');
    const secFunctional     = document.getElementById('sec-functional');
    const secPrivacy        = document.getElementById('sec-privacy');
    const secSecurity       = document.getElementById('sec-security');
    const secPerformance    = document.getElementById('sec-performance');
    const secCompatibility  = document.getElementById('sec-compatibility');
    const secTable          = document.getElementById('sec-table');

    let parsedRows      = null;
    let currentFileName = '';

    /* ── History helpers ── */
    const HISTORY_KEY = 'tca_rev_history';
    const HISTORY_MAX = 20;

    function saveToRevHistory(fileName, result) {
        let history = [];
        try { history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) { history = []; }
        const entry = {
            id:             Date.now(),
            fileName:       fileName,
            timestamp:      new Date().toISOString(),
            totalRows:      result.totalRows,
            features:       result.features,
            featureSummary: result.featureSummary,
            functional:     result.functional,
            privacy:        result.privacy,
            security:       result.security,
            performance:    result.performance,
            compatibility:  result.compatibility,
            reviewQuality:  result.reviewQuality,
            headers:        result.headers,
            rows:           result.rows.slice(0, 200),
        };
        history.unshift(entry);
        if (history.length > HISTORY_MAX) history = history.slice(0, HISTORY_MAX);
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch (e) {
            while (history.length > 1) {
                history.pop();
                try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); break; } catch (e2) { /* continue */ }
            }
        }
        try { window.dispatchEvent(new CustomEvent('tca-history-updated')); } catch (e) {}
    }

    /* ── File selection helpers ── */
    function setStatus(msg, type) {
        statusBar.textContent = msg;
        statusBar.className   = type;
        statusBar.style.display = 'block';
    }

    function clearResults() {
        [secSummary, secFeatureSummary, secReviewQuality, secFeatures, secFunctional, secPrivacy, secSecurity, secPerformance, secCompatibility, secTable]
            .forEach(s => s && s.classList.remove('visible'));
    }

    /* ── Drag-and-drop ── */
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) handleFileSelected(file);
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files[0]) handleFileSelected(fileInput.files[0]);
    });

    /* ── Summary chip → section scroll ── */
    document.querySelectorAll('.stat-chip--link[data-target]').forEach(chip => {
        function scrollToTarget() {
            const target = document.getElementById(chip.dataset.target);
            if (target && target.classList.contains('visible')) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
        chip.addEventListener('click', scrollToTarget);
        chip.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                scrollToTarget();
            }
        });
    });

    function handleFileSelected(file) {
        const name = file.name.toLowerCase();
        if (!name.endsWith('.xlsx') && !name.endsWith('.csv')) {
            setStatus('⚠ Please upload an .xlsx or .csv file.', 'error');
            btnAnalyze.disabled = true;
            return;
        }
        document.getElementById('drop-label').textContent  = '📄 ' + file.name;
        document.getElementById('drop-hint').textContent   = (file.size / 1024).toFixed(1) + ' KB';
        setStatus('File ready. Click "Analyse Test Cases" to start.', 'info');
        btnAnalyze.disabled = false;
        currentFileName = file.name;
        parsedRows = null; // reset previous parse
        clearResults();

        // Pre-parse immediately for quick analysis
        readFile(file);
    }

    /**
     * Convert an array-of-arrays (from read-excel-file) where the first row
     * is the header into an array of plain objects.
     */
    function rowsToObjects(rawRows) {
        if (!rawRows || rawRows.length < 2) return [];
        const headers = rawRows[0].map(h => (h !== null && h !== undefined ? String(h) : ''));
        return rawRows.slice(1).map(row =>
            Object.fromEntries(headers.map((h, i) => [h, row[i] !== null && row[i] !== undefined ? row[i] : '']))
        );
    }

    /**
     * Parse a CSV text string into an array of objects using the first row as headers.
     * Handles quoted fields containing commas.
     */
    function parseCSV(text) {
        const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
        if (lines.length < 2) return [];
        function splitLine(line) {
            const fields = [];
            let cur = '', inQuote = false;
            for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (ch === '"') {
                    if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
                    else inQuote = !inQuote;
                } else if (ch === ',' && !inQuote) {
                    fields.push(cur); cur = '';
                } else {
                    cur += ch;
                }
            }
            fields.push(cur);
            return fields;
        }
        const headers = splitLine(lines[0]);
        return lines.slice(1).map(line => {
            const vals = splitLine(line);
            return Object.fromEntries(headers.map((h, i) => [h, vals[i] !== null && vals[i] !== undefined ? vals[i] : '']));
        });
    }

    function readFile(file) {
        setStatus('Reading file…', 'info');
        const name = file.name.toLowerCase();

        if (name.endsWith('.csv')) {
            const reader = new FileReader();
            reader.onload = e => {
                try {
                    const rows = parseCSV(e.target.result);
                    if (!rows.length) {
                        setStatus('⚠ The CSV file appears to be empty or has only a header row.', 'error');
                        btnAnalyze.disabled = true;
                        return;
                    }
                    parsedRows = rows;
                    setStatus(`✔ Parsed ${rows.length} rows from CSV. Click Analyse.`, 'success');
                    btnAnalyze.disabled = false;
                } catch (err) {
                    setStatus('⚠ Could not parse CSV: ' + err.message, 'error');
                    btnAnalyze.disabled = true;
                }
            };
            reader.readAsText(file);
        } else {
            // .xlsx via read-excel-file
            readXlsxFile(file, { getSheets: true }).then(sheets => {
                // Smart tab detection: prefer a sheet named TC / TC's / testcase / testcases
                const tcPatterns = ['tc', 'tcs', 'testcase', 'testcases'];
                let targetSheet = 1;
                let sheetNote = '';
                if (sheets && sheets.length > 1) {
                    const match = sheets.find(s =>
                        tcPatterns.includes(s.name.toLowerCase().replace(/['\u2018\u2019\s-]/g, ''))
                    );
                    if (match) {
                        targetSheet = match.name;
                        sheetNote = ` (tab: "${match.name}")`;
                    }
                }
                return readXlsxFile(file, { sheet: targetSheet }).then(rawRows => {
                    const rows = rowsToObjects(rawRows);
                    if (!rows.length) {
                        setStatus('⚠ The selected sheet' + sheetNote + ' appears to be empty or has only a header row.', 'error');
                        btnAnalyze.disabled = true;
                        return;
                    }
                    parsedRows = rows;
                    setStatus(`✔ Parsed ${rows.length} rows${sheetNote}. Click Analyse.`, 'success');
                    btnAnalyze.disabled = false;
                });
            }).catch(err => {
                setStatus('⚠ Could not parse file: ' + err.message, 'error');
                btnAnalyze.disabled = true;
            });
        }
    }

    /* ── Analyse button ── */
    btnAnalyze.addEventListener('click', () => {
        if (!parsedRows) { setStatus('Please select a file first.', 'error'); return; }
        const result = analyzeTestCases(parsedRows);
        if (result.error) { setStatus('⚠ ' + result.error, 'error'); return; }
        renderResults(result);
        setStatus(`✔ Analysis complete — ${result.totalRows} test cases analysed.`, 'success');
        saveToRevHistory(currentFileName || 'unknown', result);
    });

    /* ── Render helpers ── */
    function renderResults(r) {
        renderSummary(r);
        renderFeatureSummary(r);
        renderReviewQuality(r);
        renderFeatures(r);
        renderGapSection(secFunctional,    'Functional Test Gaps',      r.functional,    r.features);
        renderGapSection(secPrivacy,       'Privacy Test Gaps',          r.privacy,       r.features);
        renderGapSection(secSecurity,      'Security Test Gaps',         r.security,      r.features);
        renderGapSection(secPerformance,   'Performance Test Gaps',      r.performance,   r.features);
        if (secCompatibility) renderGapSection(secCompatibility, 'Compatibility Test Gaps', r.compatibility, r.features);
        renderTable(r);
    }

    function renderFeatureSummary(r) {
        const container = document.getElementById('feature-summary-content');
        container.innerHTML = r.featureSummary;
        secFeatureSummary.classList.add('visible');
    }

    function renderReviewQuality(r) {
        if (!secReviewQuality) return;
        const q = r.reviewQuality;
        if (!q) return;

        const body = document.getElementById('review-quality-body');
        if (!body) return;

        /* ── Grade badge ── */
        const badgeBg   = q.gradeColor + '18';
        const badgeBdr  = q.gradeColor + '55';
        let html = '<div class="review-grade-row">'
            + '<div class="review-grade-circle" style="background:' + escapeHtml(badgeBg) + ';border:3px solid ' + escapeHtml(q.gradeColor) + ';color:' + escapeHtml(q.gradeColor) + '">'
            + '<span class="review-grade-letter">' + escapeHtml(q.grade) + '</span>'
            + '<span class="review-grade-score">' + q.score + '/100</span>'
            + '</div>'
            + '<div class="review-grade-details">'
            + '<strong style="color:' + escapeHtml(q.gradeColor) + ';font-size:1.1rem">' + escapeHtml(q.gradeLabel) + '</strong>'
            + '<p style="margin:4px 0 0;font-size:.88rem;color:var(--text-muted,#555)">Overall quality score based on field completeness, expected result verifiability, and coverage balance.</p>'
            + '</div></div>';

        /* ── Field completeness table ── */
        html += '<h4 style="margin:16px 0 8px;font-size:.9rem;font-weight:700;color:var(--accent,#1a73e8)">📋 Field Completeness</h4>';
        html += '<div class="review-field-grid">';
        q.fieldMetrics.forEach(function (fm) {
            const icon  = fm.colMissing ? '❌' : (fm.pct >= 90 ? '✅' : fm.pct >= 50 ? '⚠' : '❌');
            const color = fm.colMissing ? '#b71c1c' : (fm.pct >= 90 ? '#1b5e20' : fm.pct >= 50 ? '#e65100' : '#b71c1c');
            const bar   = fm.colMissing ? 0 : fm.pct;
            html += '<div class="review-field-item">'
                + '<div class="review-field-label">' + icon + ' <span>' + escapeHtml(fm.label) + '</span>'
                + (fm.colMissing ? ' <span class="review-missing-badge">column missing</span>' : '')
                + '</div>'
                + '<div class="review-field-bar-wrap"><div class="review-field-bar" style="width:' + bar + '%;background:' + color + '"></div></div>'
                + '<span class="review-field-pct" style="color:' + color + '">' + (fm.colMissing ? 'N/A' : bar + '%') + '</span>'
                + '<span class="review-field-desc">' + escapeHtml(fm.desc) + '</span>'
                + '</div>';
        });
        html += '</div>';

        /* ── Coverage balance checklist ── */
        html += '<h4 style="margin:16px 0 8px;font-size:.9rem;font-weight:700;color:var(--accent,#1a73e8)">🔬 Coverage Balance</h4>';
        html += '<ul class="review-coverage-list">';
        q.coverageItems.forEach(function (ci) {
            html += '<li>'
                + (ci.present ? '✅' : '❌')
                + ' <strong>' + escapeHtml(ci.label) + '</strong>'
                + '</li>';
        });
        html += '</ul>';

        /* ── Expected result quality ── */
        if (r.reviewCols && r.reviewCols.expectedResult) {
            const expColor = q.expQualScore >= 80 ? '#1b5e20' : q.expQualScore >= 50 ? '#e65100' : '#b71c1c';
            html += '<div class="review-exp-quality">'
                + '<span class="review-exp-label">Expected Result Verifiability:</span>'
                + '<div class="review-field-bar-wrap" style="flex:1;max-width:180px"><div class="review-field-bar" style="width:' + q.expQualScore + '%;background:' + expColor + '"></div></div>'
                + '<strong style="color:' + expColor + '">' + q.expQualScore + '%</strong>'
                + '<span class="review-field-desc">Use specific, measurable outcomes — e.g. "The system displays a success toast"</span>'
                + '</div>';
        }

        /* ── Recommendations ── */
        if (q.recommendations.length > 0) {
            html += '<details class="review-recommendations" open>'
                + '<summary style="cursor:pointer;font-weight:700;font-size:.9rem;color:var(--accent,#1a73e8);list-style:none;outline:none;margin-top:16px">'
                + '💡 Recommendations</summary>'
                + '<ul style="margin:10px 0 0 0;padding-left:0;list-style:none;line-height:1.8">';
            q.recommendations.forEach(function (rec) {
                html += '<li style="font-size:.88rem;padding:4px 0;border-bottom:1px solid var(--border,#e8e8e8)">' + rec + '</li>';
            });
            html += '</ul></details>';
        }

        body.innerHTML = html;

        /* ── Suggested Missing Test Cases (by category) ── */
        const categoryDefs = [
            { key: 'functional',    icon: '⚙️', label: 'Functional Tests',    data: r.functional },
            { key: 'privacy',       icon: '🔒', label: 'Privacy Tests',        data: r.privacy },
            { key: 'security',      icon: '🛡',  label: 'Security Tests',       data: r.security },
            { key: 'performance',   icon: '⚡', label: 'Performance Tests',    data: r.performance },
            { key: 'compatibility', icon: '🌐', label: 'Compatibility Tests',  data: r.compatibility },
        ];

        const missingByCategory = categoryDefs
            .map(function (cat) {
                const missing = (cat.data || []).filter(function (c) { return !c.covered && !c.notApplicable; });
                return { icon: cat.icon, label: cat.label, missing: missing };
            })
            .filter(function (cat) { return cat.missing.length > 0; });

        if (missingByCategory.length > 0) {
            const missingSection = document.createElement('details');
            missingSection.className = 'review-missing-section';
            missingSection.open = true;

            const summary = document.createElement('summary');
            summary.style.cssText = 'cursor:pointer;font-weight:700;font-size:.9rem;color:var(--accent,#1a73e8);list-style:none;outline:none;margin-top:20px;padding-top:16px;border-top:1px solid var(--border,#e0e0e0)';
            const totalMissing = missingByCategory.reduce(function (s, c) { return s + c.missing.length; }, 0);
            summary.innerHTML = '🔍 Suggested Missing Test Cases <span style="font-weight:400;font-size:.8rem;background:#e53935;color:#fff;border-radius:10px;padding:1px 8px;margin-left:6px">' + escapeHtml(String(totalMissing)) + ' gaps</span>';
            missingSection.appendChild(summary);

            missingByCategory.forEach(function (cat) {
                const catDiv = document.createElement('div');
                catDiv.style.cssText = 'margin-top:12px';

                const catHeader = document.createElement('h5');
                catHeader.style.cssText = 'margin:0 0 6px;font-size:.85rem;font-weight:700;color:var(--text,#222)';
                catHeader.textContent = cat.icon + ' ' + cat.label;
                catDiv.appendChild(catHeader);

                const ul = document.createElement('ul');
                ul.className = 'gap-list';
                ul.style.cssText = 'padding-left:0;list-style:none;margin:0';

                cat.missing.forEach(function (c) {
                    const li = document.createElement('li');
                    li.className = 'gap-item expandable';
                    li.setAttribute('role', 'button');
                    li.setAttribute('aria-expanded', 'false');
                    li.setAttribute('tabindex', '0');
                    const safeSeverity = ['critical', 'major', 'minor', 'showstopper'].includes(c.severity) ? c.severity : 'minor';
                    li.innerHTML = '<span class="icon-mark">❌</span>'
                        + '<span class="gap-label">' + escapeHtml(c.label) + '</span>'
                        + '<span class="severity-badge severity-' + safeSeverity + '">' + escapeHtml(c.severity) + '</span>'
                        + '<span class="expand-arrow" aria-hidden="true">▶</span>';

                    if (c.scenarios && c.scenarios.length) {
                        const panel = document.createElement('div');
                        panel.className = 'scenarios-panel';
                        panel.setAttribute('aria-hidden', 'true');
                        const scenUl = document.createElement('ul');
                        c.scenarios.forEach(function (s) {
                            const item = document.createElement('li');
                            item.textContent = s;
                            scenUl.appendChild(item);
                        });
                        panel.appendChild(scenUl);
                        li.appendChild(panel);

                        function toggleScenarios() {
                            const expanded = li.getAttribute('aria-expanded') === 'true';
                            li.setAttribute('aria-expanded', String(!expanded));
                            panel.setAttribute('aria-hidden', String(expanded));
                            li.classList.toggle('open', !expanded);
                        }
                        li.addEventListener('click', toggleScenarios);
                        li.addEventListener('keydown', function (e) {
                            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleScenarios(); }
                        });
                    }
                    ul.appendChild(li);
                });

                catDiv.appendChild(ul);
                missingSection.appendChild(catDiv);
            });

            body.appendChild(missingSection);
        }

        secReviewQuality.classList.add('visible');
    }

    function renderSummary(r) {
        const missing = fn => fn.filter(x => !x.covered && !x.notApplicable).length;
        const mFn     = missing(r.functional);
        const mPr     = missing(r.privacy);
        const mSec    = missing(r.security);
        const mPerf   = missing(r.performance);
        const mComp   = r.compatibility ? missing(r.compatibility) : 0;

        document.getElementById('stat-total').textContent     = r.totalRows;
        document.getElementById('stat-features').textContent  = r.features.length || '—';
        document.getElementById('stat-fn-miss').textContent   = mFn;
        document.getElementById('stat-pr-miss').textContent   = mPr;
        document.getElementById('stat-sec-miss').textContent  = mSec;
        document.getElementById('stat-perf-miss').textContent = mPerf;
        const compEl = document.getElementById('stat-comp-miss');
        if (compEl) compEl.textContent = mComp;

        secSummary.classList.add('visible');
    }

    function renderFeatures(r) {
        const container = document.getElementById('feature-tags-container');
        container.innerHTML = '';
        if (!r.features.length) {
            container.innerHTML = '<span style="color:#999;font-size:.9rem">No distinct feature/module column detected. Add a "Feature" or "Module" column for better insights.</span>';
        } else {
            r.features.forEach(f => {
                const span = document.createElement('span');
                span.className   = 'feature-tag';
                span.textContent = f;
                container.appendChild(span);
            });
        }
        secFeatures.classList.add('visible');
    }

    function renderGapSection(sectionEl, title, checks, features) {
        const h2 = sectionEl.querySelector('h2');
        h2.textContent = title;

        const body = sectionEl.querySelector('.gap-body');
        body.innerHTML = '';

        // Feature summary
        if (features && features.length) {
            const featSummary = document.createElement('div');
            featSummary.className = 'gap-feature-summary';
            const label = document.createElement('span');
            label.className = 'gap-feature-summary-label';
            label.textContent = 'Features / Modules in scope:';
            featSummary.appendChild(label);
            const tags = document.createElement('div');
            tags.className = 'feature-tags';
            features.forEach(f => {
                const span = document.createElement('span');
                span.className = 'feature-tag';
                span.textContent = f;
                tags.appendChild(span);
            });
            featSummary.appendChild(tags);
            body.appendChild(featSummary);
        }

        const missing = checks.filter(c => !c.covered && !c.notApplicable);
        const covered = checks.filter(c =>  c.covered && !c.notApplicable);

        if (!missing.length) {
            body.insertAdjacentHTML('beforeend', '<div class="no-gaps-banner">✅ No obvious gaps detected in this category.</div>');
            sectionEl.classList.add('visible');
            return;
        }

        // Missing
        const missCat = document.createElement('div');
        missCat.className = 'gap-category';
        missCat.innerHTML = `<h3>Potentially missing test cases <span class="badge missing">${missing.length} gaps</span></h3>`;
        const missUl = document.createElement('ul');
        missUl.className = 'gap-list';
        missing.forEach(c => {
            const li = document.createElement('li');
            li.className = 'gap-item expandable';
            li.setAttribute('role', 'button');
            li.setAttribute('aria-expanded', 'false');
            li.setAttribute('tabindex', '0');
            li.innerHTML = `<span class="icon-mark">❌</span><span class="gap-label">${escapeHtml(c.label)}</span><span class="severity-badge severity-${escapeHtml(c.severity)}">${escapeHtml(c.severity)}</span><span class="expand-arrow" aria-hidden="true">▶</span>`;

            if (c.scenarios && c.scenarios.length) {
                const panel = document.createElement('div');
                panel.className = 'scenarios-panel';
                panel.setAttribute('aria-hidden', 'true');
                const ul = document.createElement('ul');
                c.scenarios.forEach(s => {
                    const item = document.createElement('li');
                    item.textContent = s;
                    ul.appendChild(item);
                });
                panel.appendChild(ul);
                li.appendChild(panel);

                function toggleScenarios(e) {
                    const expanded = li.getAttribute('aria-expanded') === 'true';
                    li.setAttribute('aria-expanded', String(!expanded));
                    panel.setAttribute('aria-hidden', String(expanded));
                    li.classList.toggle('open', !expanded);
                }
                li.addEventListener('click', toggleScenarios);
                li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleScenarios(e); } });
            }

            missUl.appendChild(li);
        });
        missCat.appendChild(missUl);
        body.appendChild(missCat);

        // Covered
        if (covered.length) {
            const covCat = document.createElement('div');
            covCat.className = 'gap-category';
            covCat.innerHTML = `<h3>Covered areas <span class="badge covered">${covered.length} found</span></h3>`;
            const covUl = document.createElement('ul');
            covUl.className = 'gap-list';
            covered.forEach(c => {
                const li = document.createElement('li');
                li.className = 'ok-item';
                li.innerHTML = `<span class="icon-mark">✅</span><span>${escapeHtml(c.label)}</span>`;
                covUl.appendChild(li);
            });
            covCat.appendChild(covUl);
            body.appendChild(covCat);
        }

        sectionEl.classList.add('visible');
    }

    function renderTable(r) {
        const thead = document.getElementById('table-head');
        const tbody = document.getElementById('table-body');
        thead.innerHTML = '';
        tbody.innerHTML = '';

        const tr = document.createElement('tr');
        r.headers.forEach(h => {
            const th = document.createElement('th');
            th.textContent = h;
            tr.appendChild(th);
        });
        thead.appendChild(tr);

        const maxRows = Math.min(r.rows.length, 200); // cap to 200 for performance
        for (let i = 0; i < maxRows; i++) {
            const row   = r.rows[i];
            const trRow = document.createElement('tr');
            r.headers.forEach(h => {
                const td = document.createElement('td');
                td.textContent = row[h] !== null && row[h] !== undefined ? row[h] : '';
                trRow.appendChild(td);
            });
            tbody.appendChild(trRow);
        }

        if (r.rows.length > maxRows) {
            const note = document.createElement('tr');
            const td   = document.createElement('td');
            td.colSpan  = r.headers.length;
            td.style.textAlign  = 'center';
            td.style.color      = '#888';
            td.style.padding    = '10px';
            td.textContent = `… ${r.rows.length - maxRows} more rows not shown`;
            note.appendChild(td);
            tbody.appendChild(note);
        }

        secTable.classList.add('visible');
    }

})();
