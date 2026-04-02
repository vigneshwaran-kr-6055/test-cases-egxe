/**
 * test-case-generator.js
 * Reads uploaded use-case documents (TXT, CSV, XLSX, DOCX, PDF) and generates
 * structured test cases with severity and test-case-type tags.
 *
 * Depends on read-excel-file (v7), JSZip, and PDF.js already loaded by the host page.
 */

'use strict';

/* ─────────────────────────────────────────────
   Severity & type detection rules
───────────────────────────────────────────── */

const SEVERITY_RULES = [
    {
        level: 'showstopper',
        keywords: [
            'login', 'logout', 'sign in', 'sign out', 'authentication', 'authorize',
            'payment', 'checkout', 'billing', 'transaction', 'purchase',
            'access denied', 'security', 'crash', 'critical', 'unable to access',
            'data loss', 'account', 'password', 'token', 'session',
        ],
    },
    {
        level: 'critical',
        keywords: [
            'create', 'submit', 'save', 'register', 'user', 'profile',
            'data', 'record', 'delete', 'remove', 'export', 'import',
            'upload', 'download', 'notification', 'email', 'permission',
            'role', 'admin',
        ],
    },
    {
        level: 'major',
        keywords: [
            'update', 'edit', 'search', 'filter', 'sort', 'list', 'view',
            'report', 'dashboard', 'integration', 'api', 'sync', 'refresh',
            'pagination', 'validate', 'verify',
        ],
    },
    // default is 'minor'
];

const TYPE_RULES = [
    {
        type: 'security',
        keywords: [
            'login', 'logout', 'password', 'authentication', 'authorization',
            'token', 'session', 'xss', 'injection', 'csrf', 'encryption',
            'https', 'access denied', 'privilege', 'security', 'hacker',
            'brute force', 'otp', 'mfa', '2fa', 'sso',
        ],
    },
    {
        type: 'privacy',
        keywords: [
            'personal data', 'pii', 'email', 'phone', 'address', 'dob',
            'date of birth', 'ssn', 'gdpr', 'ccpa', 'consent', 'opt-in',
            'opt-out', 'data retention', 'mask', 'redact', 'anonymize',
            'sensitive', 'privacy', 'personal information',
        ],
    },
    {
        type: 'ui',
        keywords: [
            'display', 'show', 'visible', 'button', 'form', 'field',
            'dropdown', 'checkbox', 'radio', 'placeholder', 'label', 'icon',
            'tooltip', 'modal', 'popup', 'dialog', 'layout', 'responsive',
            'color', 'font', 'style', 'ui', 'ux', 'interface', 'screen',
            'page', 'navigation', 'menu', 'header', 'footer', 'sidebar',
        ],
    },
    {
        type: 'non-functional',
        keywords: [
            'performance', 'load', 'stress', 'scalability', 'latency',
            'response time', 'throughput', 'concurrent', 'availability',
            'reliability', 'uptime', 'recovery', 'backup', 'disaster',
            'accessibility', 'a11y', 'wcag', 'aria', 'screen reader',
        ],
    },
    // default is 'functional'
];

/* ─────────────────────────────────────────────
   Cached lookups for condition functions
───────────────────────────────────────────── */
const UI_RULE_KEYWORDS       = TYPE_RULES.find(r => r.type === 'ui').keywords;
const PRIVACY_RULE_KEYWORDS  = TYPE_RULES.find(r => r.type === 'privacy').keywords;
const SECURITY_RULE_KEYWORDS = TYPE_RULES.find(r => r.type === 'security').keywords;
const NONFUNC_RULE_KEYWORDS  = TYPE_RULES.find(r => r.type === 'non-functional').keywords;
const BOUNDARY_RE = /\b(limit|max|min|maximum|minimum|length|count|number|characters?|size|range|value|amount|quantity)\b/i;

/** Default ISTQB technique label used when a template does not specify one. */
const DEFAULT_TECHNIQUE = 'Functional Testing';

/* ─────────────────────────────────────────────
   Test case template generators
───────────────────────────────────────────── */

/**
 * Each template produces zero or more test case objects for a given
 * use-case text.  Templates with a `condition` only fire when the
 * condition returns true.
 *
 * @typedef {{ ucRef:string, title:string, description:string[], steps:string[], expectedResult:string, severity:string, type:string }} TC
 */
const TEMPLATES = [
    // 1. Happy / positive path — always generated
    {
        id: 'happy-path',
        technique: 'Positive Testing',
        generate(ucText, ucRef, feature, ctx) {
            const { action, entity, actor, module } = ctx || {};
            return [{
                ucRef,
                title: `Verify successful ${feature} with valid inputs`,
                description: [
                    `Verify that the ${feature} completes successfully end-to-end.`,
                    'All required input fields are filled with valid data.',
                    `The ${actor || 'user'} has the appropriate permissions to perform the action.`,
                ],
                steps: buildActionSpecificSteps(action, entity, module, feature, actor),
                expectedResult: `The ${feature} completes successfully and the system confirms the action with an appropriate success message or state change.`,
                severity: detectSeverity(ucText),
                type: 'functional',
            }];
        },
    },

    // 2. Negative / invalid input path — always generated
    {
        id: 'negative-path',
        technique: 'Negative Testing / Error Guessing',
        generate(ucText, ucRef, feature, ctx) {
            const { action, entity, actor, module } = ctx || {};
            return [{
                ucRef,
                title: `Verify error handling for invalid inputs in ${feature}`,
                description: [
                    `Ensure the system handles invalid or missing inputs gracefully for ${feature}.`,
                    'The system must not proceed or corrupt data on bad input.',
                    'A clear, user-friendly error message must be displayed.',
                ],
                steps: buildNegativePathSteps(action, entity, module, feature, actor),
                expectedResult: `The system displays a clear, descriptive error message, highlights the problematic field(s), and does not process or save any data.`,
                severity: 'major',
                type: 'functional',
            }];
        },
    },

    // 3. Boundary conditions — generated when numeric/limit keywords present
    {
        id: 'boundary',
        technique: 'Boundary Value Analysis (BVA)',
        condition: text => BOUNDARY_RE.test(text),
        generate(ucText, ucRef, feature) {
            return [{
                ucRef,
                title: `Verify boundary values for ${feature}`,
                description: [
                    `Validate correct behaviour at the defined limits for ${feature}.`,
                    'Test at exactly the minimum allowed value.',
                    'Test at exactly the maximum allowed value.',
                    'Test with a value just beyond the maximum.',
                ],
                steps: [
                    'Identify the minimum and maximum allowed values for the relevant field(s).',
                    'Enter the minimum valid value and submit — note the result.',
                    'Enter the maximum valid value and submit — note the result.',
                    'Enter one unit above the maximum and attempt to submit — note the result.',
                    'Enter one unit below the minimum and attempt to submit — note the result.',
                ],
                expectedResult: `Values within range are accepted; values outside the range are rejected with a clear validation message indicating the allowed limits.`,
                severity: 'major',
                type: 'functional',
            }];
        },
    },

    // 4. UI / display — generated when UI keywords present
    {
        id: 'ui-check',
        technique: 'UI Verification',
        condition: text => { const lower = text.toLowerCase(); return UI_RULE_KEYWORDS.some(kw => lower.includes(kw)); },
        generate(ucText, ucRef, feature) {
            return [{
                ucRef,
                title: `Verify UI elements and layout for ${feature}`,
                description: [
                    `All UI elements for ${feature} are correctly displayed and labelled.`,
                    'The layout must be consistent and accessible across supported screen sizes.',
                    'Interactive elements must be keyboard-navigable.',
                ],
                steps: [
                    `Open the page or screen for ${feature} on a desktop-sized viewport.`,
                    'Verify all buttons, labels, input fields, and icons are visible and correctly labelled.',
                    'Resize the viewport to tablet and mobile sizes; verify the layout adapts responsively.',
                    'Use keyboard-only navigation (Tab, Enter) to interact with all controls.',
                    'Check colour contrast for accessibility compliance.',
                ],
                expectedResult: `All UI elements render correctly on all supported viewport sizes, labels are accurate, and the interface is fully keyboard-accessible.`,
                severity: 'minor',
                type: 'ui',
            }];
        },
    },

    // 5. Privacy — generated when personal-data keywords present
    {
        id: 'privacy-check',
        technique: 'Privacy / GDPR Compliance Testing',
        condition: text => { const lower = text.toLowerCase(); return PRIVACY_RULE_KEYWORDS.some(kw => lower.includes(kw)); },
        generate(ucText, ucRef, feature) {
            return [{
                ucRef,
                title: `Verify personal data protection in ${feature}`,
                description: [
                    `Sensitive/personal data in ${feature} must be protected at rest and in transit.`,
                    'Data must be masked or redacted in UI where applicable.',
                    'Access must be restricted to authorised roles only.',
                    'Processing must comply with applicable privacy regulations (GDPR, CCPA, etc.).',
                ],
                steps: [
                    'Log in as a user without elevated permissions and attempt to view or export sensitive data.',
                    'Inspect network requests to confirm personal data is transmitted over HTTPS.',
                    `Verify that sensitive fields (e.g. passwords, SSN) are masked in the UI for ${feature}.`,
                    'Check that audit/access logs capture access to personal data.',
                    'Confirm that data-retention and deletion policies are enforced.',
                ],
                expectedResult: `Personal and sensitive data is masked in the UI, transmitted securely, accessible only to authorised roles, and handled in compliance with privacy regulations.`,
                severity: 'critical',
                type: 'privacy',
            }];
        },
    },

    // 6. Security — generated when auth/security keywords present
    {
        id: 'security-check',
        technique: 'Security Testing',
        condition: text => { const lower = text.toLowerCase(); return SECURITY_RULE_KEYWORDS.some(kw => lower.includes(kw)); },
        generate(ucText, ucRef, feature) {
            return [{
                ucRef,
                title: `Verify access control and security for ${feature}`,
                description: [
                    `${feature} must enforce proper authentication and authorisation.`,
                    'Common attack vectors must be mitigated (injection, XSS, CSRF, brute-force).',
                    'Unauthenticated or unauthorised access attempts must be rejected.',
                ],
                steps: [
                    'Attempt to access the feature without authentication — verify redirection to login.',
                    'Log in as a lower-privilege user and attempt to perform privileged actions.',
                    'Inject SQL/XSS payloads into input fields and verify they are sanitised.',
                    'Attempt repeated failed logins to verify brute-force protection/lockout.',
                    'Verify CSRF tokens are present and validated on state-changing requests.',
                ],
                expectedResult: `Unauthenticated and unauthorised requests are rejected; injected payloads are neutralised; brute-force and CSRF protections are active and effective.`,
                severity: 'showstopper',
                type: 'security',
            }];
        },
    },

    // 7. Non-functional — generated when performance/reliability keywords present
    {
        id: 'non-functional-check',
        technique: 'Non-Functional Testing (Performance / Reliability)',
        condition: text => { const lower = text.toLowerCase(); return NONFUNC_RULE_KEYWORDS.some(kw => lower.includes(kw)); },
        generate(ucText, ucRef, feature) {
            return [{
                ucRef,
                title: `Verify performance and reliability of ${feature}`,
                description: [
                    `${feature} must meet defined non-functional requirements under normal and peak load.`,
                    'Response times must stay within acceptable thresholds.',
                    'The feature must remain available and recover gracefully from failures.',
                ],
                steps: [
                    `Execute the ${feature} workflow under normal load and measure response time.`,
                    'Simulate peak load (concurrent users) and observe system performance.',
                    'Verify the feature remains available and returns within SLA limits.',
                    'Introduce a failure condition (e.g. service outage) and verify graceful degradation.',
                    'Verify recovery once the failure is resolved.',
                ],
                expectedResult: `The ${feature} responds within the defined SLA thresholds under normal and peak load, degrades gracefully under failure, and recovers automatically.`,
                severity: 'minor',
                type: 'non-functional',
            }];
        },
    },

    // 8. Equivalence partitioning — generated when input/field/form keywords present
    {
        id: 'equivalence-partitioning',
        technique: 'Equivalence Partitioning (EP)',
        condition: text => /\b(field|form|input|textbox|text\s+box|enter|fill|type|format|data|value)\b/i.test(text),
        generate(ucText, ucRef, feature, ctx) {
            const { actor } = ctx || {};
            const actorLabel = actor || 'user';
            return [{
                ucRef,
                title: `Verify equivalence partitioning and input class validation for ${feature}`,
                description: [
                    `Verify that ${feature} correctly accepts all valid input equivalence classes and rejects all invalid input classes.`,
                    'One representative value from each equivalence partition is tested to validate the class behaviour.',
                    'Invalid partitions must each produce a specific, meaningful error message.',
                ],
                steps: [
                    `Log in as a ${actorLabel} and navigate to the ${feature} screen.`,
                    'Identify all valid equivalence classes (e.g. correct format, within range, correct data type).',
                    'Enter a representative value from each VALID class and submit — verify the system accepts each one.',
                    'Identify all invalid equivalence classes (e.g. wrong format, out of range, wrong type, empty, null, special characters).',
                    'Enter a representative value from each INVALID class and submit — verify each is rejected with a specific error.',
                    'Verify that error messages clearly describe the constraint violated (format, range, type, required).',
                    'Verify the form or action does not proceed when any invalid input is present.',
                ],
                expectedResult: `All valid equivalence class inputs are accepted and processed correctly; all invalid class inputs are rejected with specific, descriptive validation messages; the system does not process or save data when invalid inputs are present.`,
                severity: 'major',
                type: 'functional',
            }];
        },
    },

    // 9. State transition — generated when workflow/status/approval keywords present
    {
        id: 'state-transition',
        technique: 'State Transition Testing',
        condition: text => /\b(approve|reject|submit|workflow|status|pending|active|inactive|enable|disable|draft|publish|cancel|confirm|transition|archive|close|reopen|escalate|assign|complete|in[- ]?progress)\b/i.test(text),
        generate(ucText, ucRef, feature, ctx) {
            const { entity, actor } = ctx || {};
            const subject = entity || 'item';
            const actorLabel = actor || 'user';
            return [{
                ucRef,
                title: `Verify state transitions and workflow integrity for ${feature}`,
                description: [
                    `Verify that ${feature} enforces the correct state machine — only permitted transitions are allowed, and each state change is correctly persisted and reflected.`,
                    'Invalid or out-of-order transitions must be blocked with a clear error message.',
                    'Role-based restrictions on state transitions must be enforced.',
                ],
                steps: [
                    `Log in as a ${actorLabel} with the required role/permissions.`,
                    `Create or locate a ${subject} in its initial/start state.`,
                    'Verify only the permitted next-state actions or buttons are visible and enabled.',
                    'Perform each valid state transition in the correct sequence and verify the status updates immediately.',
                    `Attempt to perform an invalid or skipped transition (bypass an intermediate state) — verify it is blocked with a meaningful error.`,
                    'Log in as a lower-privilege user and attempt a privileged state transition — verify access is denied.',
                    'Verify the state change is recorded in the audit log or activity history where applicable.',
                    'Verify stakeholder notifications are triggered for state-change events as expected.',
                ],
                expectedResult: `All valid state transitions complete successfully and update the ${subject} status; invalid transitions are blocked with appropriate errors; role-based restrictions are enforced; state changes are persisted, visible in the UI, and logged in the audit trail.`,
                severity: 'major',
                type: 'functional',
            }];
        },
    },

    // 10. Data persistence / integrity — generated when save/create/update keywords present
    {
        id: 'data-persistence',
        technique: 'Data Integrity Testing',
        condition: text => /\b(save|create|add|update|edit|modify|submit|store|persist|record)\b/i.test(text),
        generate(ucText, ucRef, feature, ctx) {
            const { entity, actor } = ctx || {};
            const subject = entity || feature || 'data';
            const actorLabel = actor || 'user';
            return [{
                ucRef,
                title: `Verify data integrity and persistence for ${feature}`,
                description: [
                    `Verify that ${feature} stores data accurately and that the stored data is retrievable, consistent, and not corrupted across sessions.`,
                    'Saved data must survive page refreshes and user re-logins.',
                    'All field values must be stored without truncation, encoding errors, or type mismatches.',
                ],
                steps: [
                    `Log in as a ${actorLabel} and navigate to the ${feature} screen.`,
                    `Create or update a ${subject} record with specific, uniquely identifiable test values for every field.`,
                    'Save / submit the record and note the confirmation response.',
                    'Refresh the browser page and verify the saved values are still present and unchanged.',
                    'Log out and log back in; re-open the same record and verify all field values persist correctly.',
                    'Verify that long-text, special characters, and numeric fields are stored without truncation or encoding issues.',
                    'If the feature supports concurrent editing, verify that simultaneous saves do not cause data loss or overwrite conflicts without warning.',
                ],
                expectedResult: `All field values are saved accurately, persist across page refreshes and user sessions, are free from truncation or encoding corruption, and concurrent edits are handled gracefully without silent data loss.`,
                severity: 'critical',
                type: 'functional',
            }];
        },
    },

    // 11. Cross-browser / platform compatibility — generated when UI keywords present
    {
        id: 'cross-platform',
        technique: 'Compatibility Testing',
        condition: text => { const lower = text.toLowerCase(); return UI_RULE_KEYWORDS.some(kw => lower.includes(kw)); },
        generate(ucText, ucRef, feature) {
            return [{
                ucRef,
                title: `Verify cross-browser and cross-device compatibility for ${feature}`,
                description: [
                    `Verify that ${feature} functions correctly and renders consistently across major browsers and device form factors.`,
                    'No browser-specific layout breaks, functional regressions, or console errors should occur.',
                    'Touch and pointer interactions must work on mobile and tablet devices.',
                ],
                steps: [
                    `Open ${feature} in Google Chrome (latest) — verify full functionality, layout, and no console errors.`,
                    'Repeat in Mozilla Firefox (latest) — verify consistent behaviour and appearance.',
                    'Repeat in Apple Safari (latest) — verify consistent behaviour and appearance.',
                    'Repeat in Microsoft Edge (latest) — verify consistent behaviour and appearance.',
                    'Test on a mobile device (iOS Safari) — verify responsive layout and touch interactions.',
                    'Test on an Android device (Chrome Mobile) — verify responsive layout and touch interactions.',
                    'Verify form submissions, file uploads, and dynamic UI interactions work correctly in every tested environment.',
                ],
                expectedResult: `${feature} functions identically and renders consistently across Chrome, Firefox, Safari, and Edge on desktop, and on iOS and Android mobile browsers; no layout breaks, missing functionality, or unhandled console errors are present in any environment.`,
                severity: 'major',
                type: 'non-functional',
            }];
        },
    },

    // 12. Integration — generated when API/service/integration keywords present
    {
        id: 'integration-check',
        technique: 'Integration Testing',
        condition: text => /\b(api|integration|webhook|third.?party|external|service|microservice|backend|rest|graphql|endpoint|connect|sync|exchange|notification|email)\b/i.test(text),
        generate(ucText, ucRef, feature, ctx) {
            const { entity, actor } = ctx || {};
            const subject = entity || feature || 'feature';
            const actorLabel = actor || 'user';
            return [{
                ucRef,
                title: `Verify integration and end-to-end data flow for ${feature}`,
                description: [
                    `Verify that ${feature} integrates correctly with all dependent services, APIs, and external systems, and that data flows accurately across component boundaries.`,
                    'Integration failures must be handled gracefully with clear, user-facing messages.',
                    'Retry logic and fallback behaviour must work correctly during service unavailability.',
                ],
                steps: [
                    'Set up the integration test environment with all dependent services active.',
                    `Log in as a ${actorLabel} and execute the ${feature} workflow that triggers an integration call.`,
                    'Verify the outgoing request to the external service/API contains the correct payload, headers, and authentication.',
                    'Verify the response is processed correctly and the result is reflected accurately in the UI.',
                    'Simulate an integration failure (service down, timeout, invalid response) and verify the system shows a user-friendly error and does not lose or corrupt data.',
                    'Verify retry logic or exponential back-off is triggered for transient failures where applicable.',
                    'Verify that integration events are logged and auditable.',
                ],
                expectedResult: `${feature} sends correctly formatted requests to external services, processes responses accurately, reflects results in the UI, handles integration failures gracefully with user-friendly messages, and logs integration events for auditability.`,
                severity: 'critical',
                type: 'functional',
            }];
        },
    },
];

/* ─────────────────────────────────────────────
   Helpers
───────────────────────────────────────────── */

function detectSeverity(text) {
    const lower = text.toLowerCase();
    for (const rule of SEVERITY_RULES) {
        if (rule.keywords.some(kw => lower.includes(kw))) return rule.level;
    }
    return 'minor';
}

/**
 * Extract a short feature label from the use-case text.
 * Handles "As a … I want to …", direct titles, ability-to patterns, and more.
 */
function extractFeature(text) {
    // "I want to [verb phrase]"
    const m = text.match(/i want to\s+([^,.;!?\n]+)/i);
    if (m) return truncateWords(m[1].trim(), 60);

    // "As a [actor], I [want/need/can/must/should] to [verb phrase]"
    const userStoryMatch = text.match(/as\s+(?:a|an)\s+[^,]+,\s*i\s+(?:want|need|can|must|should)\s+to\s+([^,.;!?\n]+)/i);
    if (userStoryMatch) return truncateWords(userStoryMatch[1].trim(), 60);

    // "should be able to [verb phrase]"
    const ableToMatch = text.match(/should be able to\s+([^,.;!?\n]+)/i);
    if (ableToMatch) return truncateWords(ableToMatch[1].trim(), 60);

    // "Use Case: [title]" or "Feature: [title]" or "Title: [value]"
    const labeledTitleMatch = text.match(/(?:use\s*case|feature|title)\s*\d*\s*[:\-–]\s*(.+)/i);
    if (labeledTitleMatch) return truncateWords(labeledTitleMatch[1].trim(), 60);

    // "[user/admin/…] can/should/must/shall/wants to [verb phrase]"
    const actorActionMatch = text.match(/(?:user|admin|customer|actor|member|operator)\s+(?:can|should|must|shall|wants?\s+to|needs?\s+to)\s+([^,.;!?\n]+)/i);
    if (actorActionMatch) return truncateWords(actorActionMatch[1].trim(), 60);

    // "ability to [verb phrase]"
    const abilityToMatch = text.match(/ability\s+to\s+([^,.;!?\n]+)/i);
    if (abilityToMatch) return truncateWords(abilityToMatch[1].trim(), 60);

    // Short capitalised phrase at the start (likely a spreadsheet title cell)
    const titlePhraseMatch = text.match(/^([A-Z][A-Za-z0-9 \-/]{2,59})(?:\n|\.|\s{2,}|$)/);
    if (titlePhraseMatch && titlePhraseMatch[1].trim().split(/\s+/).length <= 8) return titlePhraseMatch[1].trim();

    // Fall back to first few meaningful words
    return truncateWords(text.replace(/[^\w\s]/g, ' '), 60);
}

/**
 * Extract structured context (action verb, entity, actor, module) from a use-case text.
 * Used to produce more specific, relevant test case steps.
 *
 * @param {string} text
 * @returns {{ action: string, entity: string, actor: string, module: string }}
 */
function extractUseCaseContext(text) {
    const lower = text.toLowerCase();

    // ── Actor ──
    let actor = 'user';
    const actorMatch =
        text.match(/^as\s+(?:a|an)\s+([a-z][a-z ]{1,25}?)\s*[,;]/i) ||
        text.match(/\b(admin(?:istrator)?|manager|customer|member|guest|operator|staff|reviewer|approver|editor|viewer|owner)\b/i);
    if (actorMatch) actor = actorMatch[1].trim().toLowerCase();

    // ── Action verb (ordered from most-specific to generic) ──
    const ACTION_VERBS = [
        'sign up', 'log in', 'log out', 'sign in', 'sign out', 'check out', 'check in',
        'create', 'add', 'register', 'upload', 'import',
        'update', 'edit', 'modify', 'change', 'rename',
        'delete', 'remove', 'cancel', 'deactivate', 'disable',
        'download', 'export', 'generate', 'print',
        'search', 'filter', 'find', 'sort', 'browse',
        'view', 'display', 'read', 'list', 'preview',
        'submit', 'save', 'confirm', 'send',
        'approve', 'reject', 'review', 'comment',
        'share', 'invite', 'assign', 'manage', 'configure',
        'reset', 'restore', 'recover',
        'pay', 'purchase', 'checkout',
        'verify', 'validate', 'authenticate',
        'enable', 'activate',
        'access', 'navigate',
        'login', 'logout',
    ];

    let action = '';
    for (const verb of ACTION_VERBS) {
        const escaped = verb.replace(/[-\s]/g, '[\\s\\-]?');
        if (new RegExp(`\\b${escaped}\\b`, 'i').test(lower)) {
            action = verb;
            break;
        }
    }

    // ── Entity (noun phrase after the action verb) ──
    // Skip entity extraction for auth/session actions that don't have a meaningful object
    const NO_ENTITY_ACTIONS = new Set(['login', 'logout', 'log in', 'log out', 'sign in', 'sign out', 'register', 'sign up']);
    let entity = '';
    if (action && !NO_ENTITY_ACTIONS.has(action)) {
        const escaped = action.replace(/[-\s]/g, '[\\s\\-]?');
        const entityRegex = new RegExp(
            `\\b${escaped}\\s+(?:a|an|the|new|existing|their|my|all|for|with)?\\s*([a-zA-Z][a-zA-Z \\-]{1,35}?)` +
            `(?=\\s+(?:with|by|using|from|in|on|to|for|and|that|which)|[,\\.;!?]|$)`,
            'i'
        );
        const entityMatch = text.match(entityRegex);
        if (entityMatch) {
            entity = entityMatch[1].trim().replace(/\s+/g, ' ').split(/\s+/).slice(0, 4).join(' ');
        }
    }

    // ── Module / screen ──
    let module = '';
    const modulePats = [
        /(?:in|on|within|at)\s+(?:the\s+)?([A-Z][A-Za-z ]{2,30}?)\s+(?:section|page|screen|module|tab|panel|dashboard|portal|form|view)\b/i,
        /(?:navigate|go)\s+to\s+(?:the\s+)?([A-Za-z ]{2,30}?)\s+(?:section|page|screen|module|tab|panel|dashboard|portal|form|view)\b/i,
    ];
    for (const pat of modulePats) {
        const moduleMatch = text.match(pat);
        if (moduleMatch) { module = moduleMatch[1].trim(); break; }
    }

    return { action, entity, actor, module };
}

/**
 * Generate action-specific happy-path test steps based on extracted context.
 *
 * @param {string} action  - Primary action verb (e.g. "create", "login")
 * @param {string} entity  - Subject entity (e.g. "order", "user account")
 * @param {string} module  - UI module/section (e.g. "Settings")
 * @param {string} feature - Fallback feature label
 * @param {string} actor   - Role performing the action (e.g. "admin")
 * @returns {string[]}
 */
function buildActionSpecificSteps(action, entity, module, feature, actor) {
    const subject    = entity  || feature || 'item';
    const navTarget  = module  ? `the ${module} section` : `the ${subject} screen`;
    const actorLabel = actor   || 'user';
    const a          = (action || '').toLowerCase();

    if (/^(login|log in|sign in)$/.test(a)) {
        return [
            'Navigate to the application login page.',
            'Enter a valid username or email address.',
            'Enter the correct password.',
            "Click the 'Login' / 'Sign In' button.",
            'Verify successful authentication and redirection to the expected home/dashboard page.',
        ];
    }
    if (/^(logout|log out|sign out)$/.test(a)) {
        return [
            'Log in with a valid account.',
            'Navigate to the user menu or profile section.',
            "Click the 'Logout' / 'Sign Out' button.",
            'Verify the session is ended and the user is redirected to the login page.',
        ];
    }
    if (/^(register|sign up)$/.test(a)) {
        return [
            'Navigate to the registration / sign-up page.',
            'Fill in all required registration fields (name, email, password, etc.) with valid data.',
            'Accept terms and conditions if required.',
            'Submit the registration form.',
            'Verify the account is created and a confirmation message or verification email is received.',
        ];
    }
    if (/^(create|add)$/.test(a)) {
        return [
            `Log in as a ${actorLabel} with the required permissions.`,
            `Navigate to ${navTarget}.`,
            `Click the 'New' / 'Create ${subject}' button or equivalent control.`,
            `Fill in all required fields for the ${subject} with valid, correctly formatted data.`,
            `Submit / save the ${subject}.`,
            `Verify the ${subject} is created and appears in the list with the correct details.`,
        ];
    }
    if (/^(update|edit|modify|change|rename)$/.test(a)) {
        return [
            `Log in as a ${actorLabel} with the required permissions.`,
            `Navigate to ${navTarget}.`,
            `Locate and select an existing ${subject}.`,
            `Click 'Edit' or equivalent to enter edit mode.`,
            `Update the required fields with valid new data.`,
            `Save the changes.`,
            `Verify the ${subject} displays the updated information correctly.`,
        ];
    }
    if (/^(delete|remove)$/.test(a)) {
        return [
            `Log in as a ${actorLabel} with the required permissions.`,
            `Navigate to ${navTarget}.`,
            `Select the ${subject} to be deleted.`,
            `Click 'Delete' / 'Remove' and confirm the action in the confirmation dialog.`,
            `Verify the ${subject} is removed and no longer appears in the list.`,
        ];
    }
    if (/^(search|find|filter|sort|browse)$/.test(a)) {
        return [
            `Log in as a ${actorLabel}.`,
            `Navigate to ${navTarget}.`,
            `Enter valid search keywords or apply filter/sort criteria for ${subject}.`,
            `Submit the search or apply the filter.`,
            `Verify the results match the entered criteria and are displayed correctly.`,
        ];
    }
    if (/^(upload|import)$/.test(a)) {
        return [
            `Log in as a ${actorLabel} with the required permissions.`,
            `Navigate to ${navTarget}.`,
            "Click the 'Upload' / 'Import' button.",
            `Select a valid file in the required format and within the allowed size limit.`,
            `Confirm the upload / import.`,
            `Verify the ${subject} is processed successfully and the data is accessible.`,
        ];
    }
    if (/^(download|export)$/.test(a)) {
        return [
            `Log in as a ${actorLabel} with the required permissions.`,
            `Navigate to ${navTarget}.`,
            `Select the ${subject} to download / export.`,
            `Click 'Download' / 'Export' and choose the format if applicable.`,
            `Verify the file downloads with complete and correct data.`,
        ];
    }
    if (/^(pay|purchase|checkout|check out)$/.test(a)) {
        return [
            'Add the desired items to the cart.',
            'Navigate to the checkout / payment page.',
            'Enter valid shipping and billing information.',
            'Enter valid payment details (card number, expiry, CVV).',
            'Confirm the payment.',
            'Verify the transaction is processed and a confirmation receipt is displayed.',
        ];
    }
    if (/^(approve|review)$/.test(a)) {
        return [
            `Log in as a ${actorLabel} with approval rights.`,
            `Navigate to ${navTarget}.`,
            `Locate the pending ${subject} awaiting action.`,
            `Review all relevant details of the ${subject}.`,
            `Click 'Approve' and confirm.`,
            `Verify the ${subject} status is updated to 'Approved' and stakeholders are notified.`,
        ];
    }
    if (/^(reject)$/.test(a)) {
        return [
            `Log in as a ${actorLabel} with approval rights.`,
            `Navigate to ${navTarget}.`,
            `Locate the pending ${subject}.`,
            `Review the details.`,
            `Click 'Reject', provide a reason if prompted, and confirm.`,
            `Verify the ${subject} status is updated to 'Rejected' and stakeholders are notified.`,
        ];
    }
    if (/^(reset|restore|recover)$/.test(a)) {
        return [
            `Log in as a ${actorLabel}.`,
            `Navigate to ${navTarget}.`,
            `Initiate the ${a} process for the ${subject}.`,
            `Complete the required verification steps (e.g. confirm identity, enter new value).`,
            `Submit the ${a} request.`,
            `Verify the ${subject} is successfully reset/restored to the expected state.`,
        ];
    }
    if (/^(view|display|read|list|preview)$/.test(a)) {
        return [
            `Log in as a ${actorLabel} with appropriate access rights.`,
            `Navigate to ${navTarget}.`,
            `Locate the ${subject} to view.`,
            `Open or select the ${subject}.`,
            `Verify all details are displayed correctly and completely.`,
        ];
    }
    if (/^(send|share|invite)$/.test(a)) {
        return [
            `Log in as a ${actorLabel} with the required permissions.`,
            `Navigate to ${navTarget}.`,
            `Compose or select the ${subject} to ${a}.`,
            `Specify the recipient(s) with valid details.`,
            `Click '${a.charAt(0).toUpperCase() + a.slice(1)}' and confirm.`,
            `Verify the ${subject} is sent/shared successfully and appears in the relevant history.`,
        ];
    }

    // Generic fallback with context
    return [
        `Log in as a ${actorLabel} with the required permissions.`,
        `Navigate to ${navTarget}.`,
        `Fill in all required fields with valid, correctly formatted data.`,
        `Submit or confirm the action.`,
        `Verify the operation completes successfully and the system responds as expected.`,
    ];
}

/**
 * Generate action-specific negative-path test steps.
 *
 * @param {string} action
 * @param {string} entity
 * @param {string} module
 * @param {string} feature
 * @param {string} actor
 * @returns {string[]}
 */
function buildNegativePathSteps(action, entity, module, feature, actor) {
    const subject   = entity || feature || 'item';
    const navTarget = module ? `the ${module} section` : `the ${subject} screen`;
    const a         = (action || '').toLowerCase();

    if (/^(login|log in|sign in)$/.test(a)) {
        return [
            'Navigate to the login page.',
            'Attempt to log in with an incorrect password — verify login is rejected with a clear error.',
            'Attempt to log in with a non-existent username/email — verify the appropriate error message.',
            'Submit the form with empty username and password fields — verify validation errors are shown.',
        ];
    }
    if (/^(register|sign up)$/.test(a)) {
        return [
            'Navigate to the registration page.',
            'Attempt to register without filling required fields — verify field-level validation errors.',
            'Enter an already-registered email address — verify a duplicate account error.',
            'Enter a password that does not meet the strength requirements — verify the specific error message.',
        ];
    }
    if (/^(create|add)$/.test(a)) {
        return [
            `Navigate to ${navTarget}.`,
            `Attempt to create a ${subject} with all required fields left empty — verify validation errors are shown.`,
            `Enter invalid data formats (e.g., text in a numeric field, invalid date format) — verify field-level errors.`,
            `Attempt to create a duplicate ${subject} (if uniqueness is enforced) — verify a duplicate entry error.`,
        ];
    }
    if (/^(update|edit|modify|change)$/.test(a)) {
        return [
            `Navigate to ${navTarget} and open an existing ${subject} for editing.`,
            `Clear all required fields and attempt to save — verify validation errors are shown.`,
            `Enter out-of-range or invalid-format data in the fields — verify rejection with clear messages.`,
            `Attempt the update without sufficient permissions — verify access is denied.`,
        ];
    }
    if (/^(delete|remove)$/.test(a)) {
        return [
            `Navigate to ${navTarget}.`,
            `Attempt to delete a ${subject} without the required permissions — verify access is denied.`,
            `Attempt to delete a ${subject} that is referenced by other records — verify a meaningful constraint error.`,
            `Cancel the deletion in the confirmation dialog — verify the ${subject} is not deleted.`,
        ];
    }
    if (/^(upload|import)$/.test(a)) {
        return [
            `Navigate to ${navTarget}.`,
            `Attempt to upload a file with an unsupported format — verify rejection with a clear error.`,
            `Attempt to upload a file exceeding the allowed size limit — verify the size limit error.`,
            `Upload a malformed or corrupted file — verify the system handles it gracefully and displays an error.`,
        ];
    }
    if (/^(search|find|filter)$/.test(a)) {
        return [
            `Navigate to ${navTarget}.`,
            `Submit a search with an empty query — verify appropriate behaviour (all results or helpful prompt).`,
            `Enter special characters or injection strings in the search field — verify input is sanitised.`,
            `Apply filter criteria that match no records — verify a clear 'no results found' message is shown.`,
        ];
    }
    if (/^(pay|purchase|checkout|check out)$/.test(a)) {
        return [
            'Navigate to the checkout / payment page.',
            'Enter an invalid card number — verify the payment is rejected with a clear error.',
            'Attempt to pay with expired card details — verify expiry validation error.',
            'Submit the payment form without filling required fields — verify validation messages.',
        ];
    }

    // Generic fallback
    return [
        `Navigate to ${navTarget}.`,
        `Leave required fields empty or enter invalid/malformed data.`,
        `Attempt to submit or perform the action.`,
        `Verify the system displays clear, descriptive validation errors and does not process invalid data.`,
    ];
}

/** Truncate text at a word boundary to at most maxLen characters. */
function truncateWords(text, maxLen) {
    if (text.length <= maxLen) return text;
    const words = text.split(/\s+/).filter(Boolean);
    let result = '';
    for (const word of words) {
        const candidate = result ? result + ' ' + word : word;
        if (candidate.length > maxLen) break;
        result = candidate;
    }
    return result || text.slice(0, maxLen);
}

/** HTML-escape a string to prevent XSS. */
function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/* ─────────────────────────────────────────────
   Core generator
───────────────────────────────────────────── */

/**
 * Given an array of use-case descriptors [{ref, text}], produce an
 * array of test-case objects.
 *
 * @param {{ ref: string, text: string }[]} useCases
 * @returns {TC[]}
 */
function generateTestCases(useCases) {
    const allTCs = [];
    let tcIndex = 1;

    useCases.forEach(({ ref, text }) => {
        if (!text || !text.trim()) return;
        const feature = extractFeature(text);
        const ctx     = extractUseCaseContext(text);

        TEMPLATES.forEach(tpl => {
            if (tpl.condition && !tpl.condition(text)) return;
            const produced = tpl.generate(text, ref, feature, ctx);
            produced.forEach(tc => {
                allTCs.push({ id: `TC-${String(tcIndex++).padStart(3, '0')}`, technique: tpl.technique || DEFAULT_TECHNIQUE, ...tc });
            });
        });
    });

    return allTCs;
}

/* ─────────────────────────────────────────────
   File parsing helpers
───────────────────────────────────────────── */

/**
 * Parse a plain-text file into use cases.
 * Splits on blank lines or numbered entries.
 */
function parseTxt(text) {
    // Split on blank lines or lines starting with "Use Case"/"UC" numbering
    const blocks = text.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);

    if (blocks.length === 0) return [];

    return blocks.map((block, i) => {
        // Extract a ref if the block starts with "Use Case N" or "UC-N"
        const refMatch = block.match(/^(use\s+case\s*\d+|uc[-\s]?\d+)[:\-–\s]*/i);
        const ref = refMatch
            ? refMatch[0].trim().replace(/[:\-–\s]+$/, '')
            : `UC-${String(i + 1).padStart(3, '0')}`;
        const txt = refMatch ? block.slice(refMatch[0].length).trim() : block;
        return { ref, text: txt };
    });
}

/**
 * Parse a CSV text string into use-case objects.
 * Detects "use case", "description", "feature", "acceptance criteria" etc. columns
 * and combines multiple relevant columns for richer context.
 */
function parseCsvToUseCases(csvText) {
    const lines = csvText.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return [];

    function splitLine(line) {
        const fields = [];
        let cur = '', inQ = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
                else inQ = !inQ;
            } else if (ch === ',' && !inQ) {
                fields.push(cur); cur = '';
            } else {
                cur += ch;
            }
        }
        fields.push(cur);
        return fields.map(f => f.trim());
    }

    const headerRaw = splitLine(lines[0]);
    const headers   = headerRaw.map(h => h.toLowerCase());
    const rows      = lines.slice(1).map(l => splitLine(l));

    // ── Ref / ID column ──
    const refCol = headers.findIndex(h =>
        /use\s*case\s*(id|no|number|#)/i.test(h) || /^(id|uc[-_]?\d*|ref)$/i.test(h)
    );

    // ── Primary use-case / description column ──
    const txtCol = headers.findIndex((h, idx) => {
        if (idx === refCol) return false;
        return /use\s*cases?$/i.test(h) ||
               /description/i.test(h)   ||
               /user\s*stor/i.test(h)   ||
               /scenario/i.test(h)      ||
               /requirement/i.test(h)   ||
               /feature/i.test(h);
    });

    // ── Supplementary columns ──
    const suppCols = headers.reduce((acc, h, idx) => {
        if (idx === refCol || idx === txtCol) return acc;
        if (/title|name/i.test(h)                                    ||
            /use\s*cases?$/i.test(h) || /description/i.test(h)       ||
            /user\s*stor/i.test(h)   || /scenario/i.test(h)          ||
            /requirement/i.test(h)                                   ||
            /acceptance\s*criteria|acceptance|criteria/i.test(h)     ||
            /expected\s*(result|output|behaviour|behavior)/i.test(h) ||
            /objective|goal|purpose/i.test(h)                        ||
            /actor|role|persona/i.test(h)                            ||
            /precondition|pre[-\s]condition|given/i.test(h)) {
            acc.push({ idx, label: headerRaw[idx] });
        }
        return acc;
    }, []);

    function buildText(row) {
        const parts = [];
        if (txtCol !== -1 && row[txtCol]) {
            parts.push(row[txtCol]);
        }
        suppCols.forEach(({ idx, label }) => {
            const val = row[idx];
            if (val) parts.push(`${label}: ${val}`);
        });
        if (!parts.length) {
            return row.filter((_, j) => j !== refCol).join(' ');
        }
        return parts.join('. ');
    }

    // No recognisable columns — treat each row joined as one use case
    if (txtCol === -1 && suppCols.length === 0) {
        return rows.map((row, i) => ({
            ref:  refCol !== -1 && row[refCol] ? row[refCol] : `UC-${String(i + 1).padStart(3, '0')}`,
            text: row.filter((_, j) => j !== refCol).join(' '),
        })).filter(uc => uc.text.trim());
    }

    return rows
        .map((row, i) => ({
            ref:  refCol !== -1 && row[refCol] ? row[refCol] : `UC-${String(i + 1).padStart(3, '0')}`,
            text: buildText(row),
        }))
        .filter(uc => uc.text.trim());
}

/**
 * Convert an XLSX array-of-arrays (from read-excel-file) into use-case objects.
 * Detects a wide range of column names and combines multiple relevant columns
 * (title, description, acceptance criteria, actor, etc.) for richer context.
 */
function parseXlsxToUseCases(rawRows) {
    if (!rawRows || rawRows.length < 2) return [];
    const headerRaw  = rawRows[0].map(h => String(h ?? '').trim());
    const headers    = headerRaw.map(h => h.toLowerCase());
    const dataRows   = rawRows.slice(1);

    // ── Ref / ID column ──
    const refCol = headers.findIndex(h =>
        /use\s*case\s*(id|no|number|#)/i.test(h) || /^(id|uc[-_]?\d*|ref)$/i.test(h)
    );

    // ── Primary use-case / description column ──
    const txtCol = headers.findIndex((h, idx) => {
        if (idx === refCol) return false;
        return /use\s*cases?$/i.test(h) ||
               /description/i.test(h)   ||
               /user\s*stor/i.test(h)   ||
               /scenario/i.test(h)      ||
               /requirement/i.test(h)   ||
               /feature/i.test(h);
    });

    // ── Supplementary columns to include for richer context ──
    const suppCols = headers.reduce((acc, h, idx) => {
        if (idx === refCol || idx === txtCol) return acc;
        if (/title|name/i.test(h)                                    ||
            /use\s*cases?$/i.test(h) || /description/i.test(h)       ||
            /user\s*stor/i.test(h)   || /scenario/i.test(h)          ||
            /requirement/i.test(h)                                   ||
            /acceptance\s*criteria|acceptance|criteria/i.test(h)     ||
            /expected\s*(result|output|behaviour|behavior)/i.test(h) ||
            /objective|goal|purpose/i.test(h)                        ||
            /actor|role|persona/i.test(h)                            ||
            /precondition|pre[-\s]condition|given/i.test(h)) {
            acc.push({ idx, label: headerRaw[idx] });
        }
        return acc;
    }, []);

    function buildText(row) {
        const parts = [];
        if (txtCol !== -1 && row[txtCol]) {
            parts.push(String(row[txtCol]));
        }
        suppCols.forEach(({ idx, label }) => {
            const val = row[idx];
            if (val) parts.push(`${label}: ${String(val)}`);
        });
        if (!parts.length) {
            // Fallback: join all non-ref cells
            return row.filter((_, j) => j !== refCol).filter(Boolean).map(v => String(v)).join(' ');
        }
        return parts.join('. ');
    }

    // No recognisable columns at all — join everything
    if (txtCol === -1 && suppCols.length === 0) {
        return dataRows
            .map((row, i) => ({
                ref:  refCol !== -1 && row[refCol] ? String(row[refCol]) : `UC-${String(i + 1).padStart(3, '0')}`,
                text: row.filter((_, j) => j !== refCol).filter(Boolean).map(v => String(v)).join(' '),
            }))
            .filter(uc => uc.text.trim());
    }

    return dataRows
        .map((row, i) => ({
            ref:  refCol !== -1 && row[refCol] ? String(row[refCol]) : `UC-${String(i + 1).padStart(3, '0')}`,
            text: buildText(row),
        }))
        .filter(uc => uc.text.trim());
}

/**
 * Parse a plain-text string extracted from a DOCX or PDF file into use-case objects.
 * Delegates to the existing parseTxt logic.
 */
function parsePlainText(text) {
    return parseTxt(text);
}

/**
 * Extract plain text from a DOCX file (ArrayBuffer) using JSZip + DOMParser.
 * Returns a Promise that resolves to a plain-text string.
 */
async function extractDocxText(arrayBuffer) {
    if (typeof JSZip === 'undefined') {
        throw new Error('JSZip library not loaded. Please refresh the page.');
    }
    const zip = await JSZip.loadAsync(arrayBuffer);
    const xmlFile = zip.file('word/document.xml');
    if (!xmlFile) throw new Error('Not a valid DOCX file (word/document.xml missing).');
    const xmlText = await xmlFile.async('string');

    // Parse the XML with DOMParser and extract text via the Word namespace
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const paragraphs = Array.from(doc.getElementsByTagNameNS(NS_W, 'p'));

    if (paragraphs.length > 0) {
        const lines = paragraphs.map(p =>
            Array.from(p.getElementsByTagNameNS(NS_W, 't'))
                .map(t => t.textContent)
                .join('')
        );
        return lines.filter(Boolean).join('\n\n').trim();
    }

    // Fallback: return raw text content (safe — no HTML involved)
    return doc.documentElement.textContent.trim();
}

/**
 * Extract plain text from a PDF file (ArrayBuffer) using PDF.js.
 * Returns a Promise that resolves to a plain-text string.
 */
async function extractPdfText(arrayBuffer) {
    if (typeof pdfjsLib === 'undefined') {
        throw new Error('PDF.js library not loaded. Please refresh the page.');
    }
    // Point the worker at the same CDN version
    pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://unpkg.com/pdfjs-dist@4.9.155/legacy/build/pdf.worker.min.js';

    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        pages.push(content.items.map(item => item.str).join(' '));
    }
    return pages.join('\n\n').trim();
}



(function () {
    const dropZone    = document.getElementById('gen-drop-zone');
    const fileInput   = document.getElementById('gen-file-input');
    const btnGenerate = document.getElementById('btn-generate');
    const statusEl    = document.getElementById('gen-status');

    const secSummary  = document.getElementById('gen-sec-summary');
    const secTable    = document.getElementById('gen-sec-table');

    if (!dropZone) return; // guard: generator elements not present

    let parsedUseCases  = null;
    let generatedTCs    = null;
    let currentFileName = '';

    /* ── History helpers ── */
    const HISTORY_KEY    = 'tca_gen_history';
    const HISTORY_MAX    = 20;

    function saveToGenHistory(fileName, tcs) {
        let history = [];
        try { history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) { history = []; }
        const countBySev  = { showstopper: 0, critical: 0, major: 0, minor: 0 };
        const countByType = { functional: 0, 'non-functional': 0, ui: 0, privacy: 0, security: 0 };
        tcs.forEach(function (tc) {
            if (tc.severity in countBySev)  countBySev[tc.severity]++;
            if (tc.type     in countByType) countByType[tc.type]++;
        });
        const entry = {
            id:        Date.now(),
            fileName:  fileName,
            timestamp: new Date().toISOString(),
            testCases: tcs,
            summary:   { total: tcs.length, bySeverity: countBySev, byType: countByType },
        };
        history.unshift(entry);
        if (history.length > HISTORY_MAX) history = history.slice(0, HISTORY_MAX);
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch (e) {
            // Storage quota exceeded – drop oldest entries until it fits
            while (history.length > 1) {
                history.pop();
                try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); break; } catch (e2) { /* continue */ }
            }
        }
        window.dispatchEvent(new CustomEvent('tca-history-updated'));
    }

    /* ── Helpers ── */
    function setStatus(msg, type) {
        statusEl.textContent = msg;
        statusEl.className   = type;
        statusEl.style.display = 'block';
    }

    function clearResults() {
        [secSummary, secTable].forEach(s => s && s.classList.remove('visible'));
        generatedTCs = null;
    }

    /* ── Drag-and-drop ── */
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files[0]) handleFile(fileInput.files[0]);
    });

    function handleFile(file) {
        const name = file.name.toLowerCase();
        const allowed = ['.txt', '.csv', '.xlsx', '.docx', '.doc', '.pdf'];
        if (!allowed.some(ext => name.endsWith(ext))) {
            setStatus('⚠ Please upload a .txt, .csv, .xlsx, .docx, or .pdf file.', 'error');
            btnGenerate.disabled = true;
            return;
        }
        if (name.endsWith('.doc') && !name.endsWith('.docx')) {
            setStatus('⚠ Legacy .doc format is not supported. Please save the file as .docx and re-upload.', 'error');
            btnGenerate.disabled = true;
            return;
        }
        document.getElementById('gen-drop-label').textContent = '📄 ' + file.name;
        document.getElementById('gen-drop-hint').textContent  = (file.size / 1024).toFixed(1) + ' KB';
        setStatus('File ready. Click "Generate Test Cases" to start.', 'info');
        btnGenerate.disabled = false;
        currentFileName = file.name;
        parsedUseCases  = null;
        clearResults();
        readFile(file);
    }

    function readFile(file) {
        const name = file.name.toLowerCase();

        if (name.endsWith('.txt')) {
            const reader = new FileReader();
            reader.onload = e => {
                try {
                    parsedUseCases = parseTxt(e.target.result);
                    if (!parsedUseCases.length) {
                        setStatus('⚠ No use cases found in the file. Ensure the file has content.', 'error');
                        btnGenerate.disabled = true;
                        return;
                    }
                    setStatus(`✔ Found ${parsedUseCases.length} use case block(s). Click Generate.`, 'success');
                    btnGenerate.disabled = false;
                } catch (err) {
                    setStatus('⚠ Could not read file: ' + err.message, 'error');
                    btnGenerate.disabled = true;
                }
            };
            reader.readAsText(file);

        } else if (name.endsWith('.csv')) {
            const reader = new FileReader();
            reader.onload = e => {
                try {
                    parsedUseCases = parseCsvToUseCases(e.target.result);
                    if (!parsedUseCases.length) {
                        setStatus('⚠ No use cases found in the CSV.', 'error');
                        btnGenerate.disabled = true;
                        return;
                    }
                    setStatus(`✔ Found ${parsedUseCases.length} use case(s) in CSV. Click Generate.`, 'success');
                    btnGenerate.disabled = false;
                } catch (err) {
                    setStatus('⚠ Could not parse CSV: ' + err.message, 'error');
                    btnGenerate.disabled = true;
                }
            };
            reader.readAsText(file);

        } else if (name.endsWith('.docx')) {
            const reader = new FileReader();
            reader.onload = e => {
                extractDocxText(e.target.result).then(text => {
                    parsedUseCases = parsePlainText(text);
                    if (!parsedUseCases.length) {
                        setStatus('⚠ No use cases found in the DOCX file.', 'error');
                        btnGenerate.disabled = true;
                        return;
                    }
                    setStatus(`✔ Found ${parsedUseCases.length} use case block(s) in DOCX. Click Generate.`, 'success');
                    btnGenerate.disabled = false;
                }).catch(err => {
                    setStatus('⚠ Could not parse DOCX: ' + err.message, 'error');
                    btnGenerate.disabled = true;
                });
            };
            reader.readAsArrayBuffer(file);

        } else if (name.endsWith('.pdf')) {
            const reader = new FileReader();
            reader.onload = e => {
                extractPdfText(e.target.result).then(text => {
                    parsedUseCases = parsePlainText(text);
                    if (!parsedUseCases.length) {
                        setStatus('⚠ No use cases found in the PDF.', 'error');
                        btnGenerate.disabled = true;
                        return;
                    }
                    setStatus(`✔ Found ${parsedUseCases.length} use case block(s) in PDF. Click Generate.`, 'success');
                    btnGenerate.disabled = false;
                }).catch(err => {
                    setStatus('⚠ Could not parse PDF: ' + err.message, 'error');
                    btnGenerate.disabled = true;
                });
            };
            reader.readAsArrayBuffer(file);

        } else {
            // .xlsx
            if (typeof readXlsxFile === 'undefined') {
                setStatus('⚠ XLSX library not loaded. Please refresh the page.', 'error');
                btnGenerate.disabled = true;
                return;
            }
            readXlsxFile(file, { getSheets: true }).then(sheets => {
                // Smart tab detection: prefer a sheet named UC / UC's / usecase / usecases
                const ucPatterns = ['uc', 'ucs', 'usecase', 'usecases'];
                let targetSheet = 1;
                let sheetNote = '';
                if (sheets && sheets.length > 1) {
                    const match = sheets.find(s =>
                        ucPatterns.includes(s.name.toLowerCase().replace(/['\u2018\u2019\s-]/g, ''))
                    );
                    if (match) {
                        targetSheet = match.name;
                        sheetNote = ` (tab: "${match.name}")`;
                    }
                }
                return readXlsxFile(file, { sheet: targetSheet }).then(rawRows => {
                    parsedUseCases = parseXlsxToUseCases(rawRows);
                    if (!parsedUseCases.length) {
                        setStatus('⚠ No use cases found in the spreadsheet' + sheetNote + '.', 'error');
                        btnGenerate.disabled = true;
                        return;
                    }
                    setStatus(`✔ Found ${parsedUseCases.length} use case(s) in spreadsheet${sheetNote}. Click Generate.`, 'success');
                    btnGenerate.disabled = false;
                });
            }).catch(err => {
                setStatus('⚠ Could not parse XLSX: ' + err.message, 'error');
                btnGenerate.disabled = true;
            });
        }
    }

    /* ── Generate button ── */
    btnGenerate.addEventListener('click', () => {
        if (!parsedUseCases || !parsedUseCases.length) {
            setStatus('Please select a file first.', 'error');
            return;
        }
        generatedTCs = generateTestCases(parsedUseCases);
        if (!generatedTCs.length) {
            setStatus('⚠ No test cases could be generated. Please check the file content.', 'error');
            return;
        }
        renderResults(generatedTCs);
        setStatus(`✔ Generated ${generatedTCs.length} test case(s) from ${parsedUseCases.length} use case(s).`, 'success');
        saveToGenHistory(currentFileName || 'unknown', generatedTCs);
    });

    /* ── Render results ── */
    function renderResults(tcs) {
        renderSummary(tcs);
        renderStandardsBanner(tcs);
        renderTable(tcs);
    }

    function renderStandardsBanner(tcs) {
        const banner = document.getElementById('gen-standards-banner');
        if (!banner) return;
        // Collect unique techniques used
        const techSet = new Set(tcs.map(tc => tc.technique).filter(Boolean));
        const techList = Array.from(techSet);
        if (techList.length === 0) { banner.hidden = true; return; }
        const techHtml = techList.map(t => `<span class="tech-badge">${esc(t)}</span>`).join(' ');
        banner.innerHTML = '<strong>📐 Test Design Techniques Applied:</strong> ' + techHtml;
        banner.hidden = false;
    }

    function renderSummary(tcs) {
        const countBySev  = { showstopper: 0, critical: 0, major: 0, minor: 0 };
        const countByType = { functional: 0, 'non-functional': 0, ui: 0, privacy: 0, security: 0 };
        tcs.forEach(tc => {
            if (tc.severity in countBySev)  countBySev[tc.severity]++;
            if (tc.type     in countByType) countByType[tc.type]++;
        });

        document.getElementById('gen-stat-total').textContent        = tcs.length;
        document.getElementById('gen-stat-showstopper').textContent  = countBySev.showstopper;
        document.getElementById('gen-stat-critical').textContent     = countBySev.critical;
        document.getElementById('gen-stat-major').textContent        = countBySev.major;
        document.getElementById('gen-stat-minor').textContent        = countBySev.minor;

        document.getElementById('gen-stat-functional').textContent      = countByType.functional;
        document.getElementById('gen-stat-nonfunctional').textContent   = countByType['non-functional'];
        document.getElementById('gen-stat-ui').textContent             = countByType.ui;
        document.getElementById('gen-stat-privacy').textContent        = countByType.privacy;
        document.getElementById('gen-stat-security').textContent       = countByType.security;

        secSummary.classList.add('visible');
    }

    function renderTable(tcs) {
        const tbody = document.getElementById('gen-table-body');
        tbody.innerHTML = '';
        tcs.forEach(tc => {
            const tr = document.createElement('tr');

            // Precondition: plain text
            const descHtml = Array.isArray(tc.description)
                ? tc.description.map(d => esc(d)).join(' ')
                : esc(tc.description);

            // Steps: numbered list
            const stepsHtml = Array.isArray(tc.steps) && tc.steps.length
                ? `<ol class="tc-list">${tc.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>`
                : '';

            // Expected Result: plain text
            const expectedHtml = tc.expectedResult ? esc(tc.expectedResult) : '';

            tr.innerHTML = `
                <td>${esc(tc.id)}</td>
                <td>${esc(tc.ucRef)}</td>
                <td>${esc(tc.title)}</td>
                <td>${descHtml}</td>
                <td>${stepsHtml}</td>
                <td>${expectedHtml}</td>
                <td><span class="badge-severity sev-${esc(tc.severity)}">${esc(tc.severity)}</span></td>
                <td><span class="badge-type type-${esc(tc.type)}">${esc(tc.type)}</span></td>
                <td><span class="badge-technique">${esc(tc.technique || DEFAULT_TECHNIQUE)}</span></td>
            `;
            tbody.appendChild(tr);
        });
        secTable.classList.add('visible');
    }

    /* ── Export to CSV ── */
    const btnExport = document.getElementById('btn-export-csv');
    if (btnExport) {
        btnExport.addEventListener('click', () => {
            if (!generatedTCs || !generatedTCs.length) return;
            const header = ['Test Case ID', 'Use Case Ref', 'Test Case', 'Precondition', 'Steps', 'Expected Results', 'Severity', 'Type', 'Technique'];
            const rows   = generatedTCs.map(tc => [
                tc.id,
                tc.ucRef,
                tc.title,
                Array.isArray(tc.description) && tc.description.length ? tc.description.join(' | ') : String(tc.description || ''),
                Array.isArray(tc.steps)       && tc.steps.length       ? tc.steps.join(' | ')       : String(tc.steps || ''),
                tc.expectedResult || '',
                tc.severity,
                tc.type,
                tc.technique || DEFAULT_TECHNIQUE,
            ]);
            const csvContent = [header, ...rows]
                .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
                .join('\r\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = 'generated-test-cases.csv';
            a.click();
            URL.revokeObjectURL(url);
        });
    }

})();
