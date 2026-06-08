'use strict';

const BTN_ID        = 'ck-sync-btn';
const IMPORT_BTN_ID = 'ck-import-btn';
const MC_BTN_ID     = 'ck-mc-btn';
const RUBRIC_BTN_ID = 'ck-rubric-btn';
const PANEL_ID      = 'ck-sync-panel';

// ── URL parsing ───────────────────────────────────────────────────────────────

function getPageContext() {
    const hash      = window.location.hash;
    const queryStr  = hash.split('?')[1] || '';
    const params    = new URLSearchParams(queryStr);
    const sectionId = params.get('sectionId');

    if (hash.includes('score_assignment')) {
        const assignmentId = params.get('assignmentId');
        if (sectionId && assignmentId) return { type: 'score', sectionId, assignmentId };
    } else if (hash.match(/^#\/\?/) && sectionId) {
        return { type: 'class', sectionId };
    }
    return null;
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function removeUI() {
    document.getElementById(BTN_ID)?.remove();
    document.getElementById(IMPORT_BTN_ID)?.remove();
    document.getElementById(MC_BTN_ID)?.remove();
    document.getElementById(RUBRIC_BTN_ID)?.remove();
    document.getElementById(PANEL_ID)?.remove();
}

function makeBtn(id, text, bottom, bg, onclick) {
    const btn = document.createElement('button');
    btn.id = id;
    btn.textContent = text;
    Object.assign(btn.style, {
        position: 'fixed', bottom, right: '24px', zIndex: '9999',
        background: bg, color: '#fff', border: 'none', borderRadius: '6px',
        padding: '10px 18px', fontSize: '13px', fontWeight: '600',
        cursor: 'pointer', boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
        fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif'
    });
    btn.onmouseenter = () => { btn.style.filter = 'brightness(0.9)'; };
    btn.onmouseleave = () => { btn.style.filter = ''; };
    btn.onclick = onclick;
    document.body.appendChild(btn);
    return btn;
}

function injectButton(ctx) {
    removeUI();
    if (ctx.type === 'score') {
        makeBtn(BTN_ID, 'Sync DobbsCore Grades', '24px', '#2563eb', () => showSyncPanel(ctx));
    } else {
        checkAndInjectClassBtn(ctx);
    }
}

async function checkAndInjectClassBtn(ctx) {
    const { serverUrl, teacherToken } = await chrome.storage.sync.get(['serverUrl', 'teacherToken']);
    if (!serverUrl || !teacherToken) return;

    const resp = await chrome.runtime.sendMessage({
        type: 'KENKEN_FETCH', url: `${serverUrl}/api/teacher/classes`, token: teacherToken
    });
    if (!resp.ok) return;

    const matchedClass = resp.data.find(c => String(c.ps_section_id) === String(ctx.sectionId));
    if (!matchedClass) {
        makeBtn(IMPORT_BTN_ID, 'Import Roster to DobbsCore', '24px', '#059669', () => showImportPanel(ctx));
        return;
    }

    makeBtn(BTN_ID, 'Create DobbsCore Assignment', '24px', '#2563eb', () => showCreatePanel(ctx));

    // Check for microcredentials on this class and add a second button if any exist
    const mcResp = await chrome.runtime.sendMessage({
        type: 'KENKEN_FETCH',
        url: `${serverUrl}/api/teacher/microcredentials?class_id=${matchedClass.id}`,
        token: teacherToken
    });
    if (mcResp.ok && mcResp.data?.length) {
        makeBtn(MC_BTN_ID, 'Sync Microcredentials', '72px', '#7c3aed',
            () => showMcSyncPanel(ctx, matchedClass.id, mcResp.data));
    }

    // Always add a rubric sync button (rubric is available for all registered classes)
    makeBtn(RUBRIC_BTN_ID, 'Sync Rubric', '120px', '#0891b2',
        () => showRubricSyncPanel(ctx, matchedClass.id));
}

function makePanel(title) {
    removeUI();
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    Object.assign(panel.style, {
        position: 'fixed', bottom: '24px', right: '24px', zIndex: '9999',
        background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px',
        padding: '20px', width: '300px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.14)',
        fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif', fontSize: '13px',
        color: '#1e293b', maxHeight: '90vh', overflowY: 'auto'
    });
    panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <strong style="font-size:14px">${title}</strong>
            <button id="ck-close" style="background:none;border:none;cursor:pointer;font-size:20px;color:#94a3b8;line-height:1">×</button>
        </div>
    `;
    document.body.appendChild(panel);
    return panel;
}

function field(label, inputHtml) {
    const s = 'style="font-size:11px;color:#64748b;display:block;margin-bottom:3px;font-weight:500;text-transform:uppercase;letter-spacing:.04em"';
    return `<label style="display:block;margin-bottom:10px"><span ${s}>${label}</span>${inputHtml}</label>`;
}

const IS = 'style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:4px;font-size:13px;box-sizing:border-box"';

function setStatus(msg, color = '#64748b') {
    const el = document.getElementById('ck-status');
    if (el) { el.textContent = msg; el.style.color = color; }
}

// ── KenKen class list (shared) ────────────────────────────────────────────────

async function populateClasses(selectId) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const { serverUrl, teacherToken } = await chrome.storage.sync.get(['serverUrl', 'teacherToken']);
    if (!serverUrl || !teacherToken) {
        sel.innerHTML = '<option value="">⚠ Configure extension settings first</option>';
        return;
    }
    const resp = await chrome.runtime.sendMessage({
        type: 'KENKEN_FETCH', url: `${serverUrl}/api/teacher/classes`, token: teacherToken
    });
    if (!resp.ok || !resp.data?.length) {
        sel.innerHTML = '<option value="">No classes found</option>';
        return;
    }
    sel.innerHTML = resp.data.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}

// ── Score-only panel (existing assignment) ────────────────────────────────────

function showSyncPanel(ctx) {
    const panel = makePanel('Sync DobbsCore Grades');
    panel.innerHTML += `
        ${field('DobbsCore Class',  `<select id="ck-class" ${IS}><option>Loading…</option></select>`)}
        ${field('Start Date',    `<input  id="ck-start" type="date" ${IS}>`)}
        ${field('End Date',      `<input  id="ck-end"   type="date" ${IS}>`)}
        <div id="ck-status" style="font-size:12px;color:#64748b;margin-bottom:12px;min-height:16px;line-height:1.4"></div>
        <button id="ck-sync" style="width:100%;padding:9px;background:#2563eb;color:#fff;border:none;border-radius:5px;font-size:13px;font-weight:600;cursor:pointer">Sync Grades</button>
    `;
    document.getElementById('ck-close').onclick = () => { removeUI(); injectButton(ctx); };
    document.getElementById('ck-sync').onclick  = () => doSync(ctx);
    populateClasses('ck-class');
}

async function doSync(ctx) {
    const { serverUrl, teacherToken } = await chrome.storage.sync.get(['serverUrl', 'teacherToken']);
    const classId = document.getElementById('ck-class')?.value;
    const start   = document.getElementById('ck-start')?.value;
    const end     = document.getElementById('ck-end')?.value;

    if (!classId)       { setStatus('Select a class.', '#dc2626'); return; }
    if (!start || !end) { setStatus('Select a date range.', '#dc2626'); return; }
    if (start > end)    { setStatus('Start must be before end.', '#dc2626'); return; }
    if (!serverUrl || !teacherToken) { setStatus('Configure settings first.', '#dc2626'); return; }

    const btn = document.getElementById('ck-sync');
    btn.disabled = true; btn.textContent = 'Syncing…';
    try {
        await submitScores(ctx.sectionId, ctx.assignmentId, classId, start, end, serverUrl, teacherToken);
    } catch (err) {
        setStatus(`Error: ${err.message}`, '#dc2626');
        console.error('[KenKen Sync]', err);
    }
    btn.disabled = false; btn.textContent = 'Sync Grades';
}

// ── Create + sync panel ───────────────────────────────────────────────────────

async function showCreatePanel(ctx) {
    const today       = new Date().toISOString().slice(0, 10);
    const defaultName = `DobbsCore ${new Date().toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}`;

    const { serverUrl, teacherToken } = await chrome.storage.sync.get(['serverUrl', 'teacherToken']);
    let defaultPoints = 10;
    if (serverUrl && teacherToken) {
        const settingsResp = await chrome.runtime.sendMessage({
            type: 'KENKEN_FETCH', url: `${serverUrl}/api/teacher/gradebook-settings`, token: teacherToken
        });
        if (settingsResp.ok) defaultPoints = settingsResp.data.assignment_max_score ?? 10;
    }

    const panel = makePanel('Create DobbsCore Assignment');
    panel.innerHTML += `
        ${field('Assignment Name', `<input  id="ck-name"     type="text"   value="${defaultName}" ${IS}>`)}
        ${field('Due Date',        `<input  id="ck-due"      type="date"   value="${today}" ${IS}>`)}
        ${field('Max Points',      `<input  id="ck-points"   type="number" value="${defaultPoints}" min="1" ${IS}>`)}
        ${field('Category',        `<select id="ck-category" ${IS}><option value="">Loading…</option></select>`)}
        <div id="ck-period-row" style="display:none;margin-bottom:10px">
            <span style="font-size:11px;color:#64748b;font-weight:500;text-transform:uppercase;letter-spacing:.04em">Marking Period</span>
            <span id="ck-period" style="display:block;font-size:13px;margin-top:3px"></span>
        </div>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:12px 0">
        ${field('DobbsCore Class',    `<select id="ck-class"    ${IS}><option>Loading…</option></select>`)}
        ${field('Score Start',     `<input  id="ck-start"    type="date" ${IS}>`)}
        ${field('Score End',       `<input  id="ck-end"      type="date" value="${today}" ${IS}>`)}
        <div id="ck-status" style="font-size:12px;color:#64748b;margin-bottom:12px;min-height:16px;line-height:1.4"></div>
        <button id="ck-create" style="width:100%;padding:9px;background:#2563eb;color:#fff;border:none;border-radius:5px;font-size:13px;font-weight:600;cursor:pointer">Create &amp; Sync</button>
    `;
    document.getElementById('ck-close').onclick  = () => { removeUI(); injectButton(ctx); };
    document.getElementById('ck-create').onclick = () => doCreateAndSync(ctx);
    populateClasses('ck-class');
    loadCategories(ctx.sectionId);
}

async function loadCategories(sectionId) {
    const catSel = document.getElementById('ck-category');
    if (!catSel) return;
    try {
        const resp = await fetch('/ws/xte/teacher_category/calculations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json;charset=UTF-8' },
            body: JSON.stringify({ section_ids: [Number(sectionId)] })
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data    = await resp.json();
        const section = data.find(s => String(s.dcid) === String(sectionId));
        if (!section) throw new Error('section not found in response');

        catSel.dataset.termid = section.termid;

        const mBin = section._termbins.find(b => b.storecode.startsWith('M') && b._weights?.length);
        catSel.innerHTML = mBin
            ? mBin._weights.map(w => `<option value="${w.teachercategoryid}">${w.categoryname}</option>`).join('')
            : '<option value="">No categories found</option>';

        // Default to Formative if available
        const formativeOpt = Array.from(catSel.options).find(o => o.textContent.toLowerCase().includes('formative'));
        if (formativeOpt) formativeOpt.selected = true;

        const today   = new Date().toISOString().slice(0, 10);
        const current = section._termbins.find(
            b => b.storecode.startsWith('M') && b._weights?.length && b.startdate <= today && today <= b.enddate
        );
        if (current) {
            catSel.dataset.storecode = current.storecode;
            const row = document.getElementById('ck-period-row');
            const lbl = document.getElementById('ck-period');
            if (row && lbl) { lbl.textContent = current.storecode; row.style.display = ''; }
        }
    } catch (err) {
        catSel.innerHTML = '<option value="">Could not load categories</option>';
        console.error('[KenKen loadCategories]', err);
    }
}

async function doCreateAndSync(ctx) {
    const { serverUrl, teacherToken } = await chrome.storage.sync.get(['serverUrl', 'teacherToken']);
    const name      = document.getElementById('ck-name')?.value.trim();
    const duedate   = document.getElementById('ck-due')?.value;
    const points    = parseFloat(document.getElementById('ck-points')?.value);
    const catSel    = document.getElementById('ck-category');
    const teachercategoryid = Number(catSel?.value);
    const termid    = Number(catSel?.dataset.termid);
    const storecode = catSel?.dataset.storecode;
    const classId   = document.getElementById('ck-class')?.value;
    const start     = document.getElementById('ck-start')?.value;
    const end       = document.getElementById('ck-end')?.value;

    if (!name)              { setStatus('Enter an assignment name.', '#dc2626'); return; }
    if (!duedate)           { setStatus('Select a due date.', '#dc2626'); return; }
    if (isNaN(points) || points < 1) { setStatus('Enter valid max points.', '#dc2626'); return; }
    if (!teachercategoryid) { setStatus('Select a category.', '#dc2626'); return; }
    if (!termid)            { setStatus('Category data not loaded yet.', '#dc2626'); return; }
    if (!storecode)         { setStatus('No active marking period found.', '#dc2626'); return; }
    if (!classId)           { setStatus('Select a DobbsCore class.', '#dc2626'); return; }
    if (!start || !end)     { setStatus('Select a score date range.', '#dc2626'); return; }
    if (start > end)        { setStatus('Start must be before end.', '#dc2626'); return; }
    if (!serverUrl || !teacherToken) { setStatus('Configure extension settings first.', '#dc2626'); return; }

    const btn = document.getElementById('ck-create');
    btn.disabled = true; btn.textContent = 'Creating…';

    try {
        const yearid     = Math.floor(termid / 100);
        const dueDateObj = new Date(duedate + 'T12:00:00').toISOString();

        setStatus('Creating assignment in PowerSchool…');
        const { assignmentId, assignmentsectionid } =
            await psCreateAssignment(name, duedate, dueDateObj, points, Number(ctx.sectionId), yearid, teachercategoryid);

        setStatus(`Assignment "${name}" created. Syncing grades…`);
        await submitScores(
            ctx.sectionId, assignmentId, classId, start, end, serverUrl, teacherToken,
            { assignmentsectionid, totalpointvalue: points }
        );

    } catch (err) {
        setStatus(`Error: ${err.message}`, '#dc2626');
        console.error('[KenKen Create]', err);
    }

    btn.disabled = false; btn.textContent = 'Create & Sync';
}

// ── Shared PS helpers ─────────────────────────────────────────────────────────

// Creates a PS assignment and returns { assignmentId, assignmentsectionid }.
// Throws on failure so callers can catch with a meaningful message.
async function psCreateAssignment(name, duedate, dueDateObj, points, sectionsdcid, yearid, teachercategoryid) {
    const resp = await fetch('/ws/xte/section/assignment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json;charset=UTF-8' },
        body: JSON.stringify({
            standardcalcdirection:  'NONE',
            standardscoringmethod:  'GradeScale',
            yearid,
            _assignmentsections: [{
                description: '', duedate, dueDateObj,
                extracreditpoints: 0, iscountedinfinalgrade: true,
                isscorespublish: true, isscoringneeded: true, maxretakeallowed: 0,
                name, pointspossible: points, publishdaysbeforedue: 0,
                publishonspecificdate: duedate, publishOnSpecificDateObj: dueDateObj,
                publishoption: 'Immediately', relatedgradescaleitemdcid: null,
                scoreentrypoints: points, scoretype: 'POINTS', sectionsdcid,
                selectedOnlineWorkType:  { id: 'Assignment', name: 'Learning Assignment', plugin: 'com.powerschool.lms', disabled: false },
                selectedPublishOption:   { label: 'Immediately', value: 'Immediately' },
                selectedScoreType:       { label: 'Points', value: 'POINTS' },
                totalpointvalue: points, weight: 1, yearid,
                _assignmentcategoryassociations: [{ teachercategoryid, isprimary: true }],
                _assignmentstandardassociations: []
            }]
        })
    });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Assignment creation failed (${resp.status}): ${text}`);
    }
    const assignmentId        = (resp.headers.get('Location') || '').split('/').pop();
    const assignmentsectionid = JSON.parse(resp.headers.get('AssignmentSectionIds') || '[]')[0];
    if (!assignmentId || !assignmentsectionid)
        throw new Error('Assignment created but IDs missing from response headers.');
    return { assignmentId, assignmentsectionid };
}

// Builds a single PS score entry object.
function psScoreEntry(dcid, score, assignmentsectionid, assignmentId, sectionId) {
    return {
        studentsdcid:              dcid,
        actualscoreentered:        String(score),
        actualscoregradescaledcid: null,
        actualscorekind:           'REAL_SCORE',
        islate: false, iscollected: false, isexempt: false,
        ismissing: false, isabsent: false, isincomplete: false,
        scorepercent: null,
        _assignmentsection: {
            assignmentsectionid,
            sectionsdcid:    Number(sectionId),
            _assignment: { assignmentid: Number(assignmentId) }
        },
        assignmentsectionid,
        sectionsdcid:  Number(sectionId),
        assignmentid:  Number(assignmentId)
    };
}

// Submits an array of score entries to PS.
async function psSubmitScores(scores) {
    const resp = await fetch('/ws/xte/score?push_assignment_scores=false&status=A,I,P', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json;charset=UTF-8' },
        body: JSON.stringify({ assignment_scores: scores })
    });
    if (!resp.ok) throw new Error(`PS returned ${resp.status}: ${await resp.text()}`);
}

// ── Microcredential sync panel ────────────────────────────────────────────────

function showMcSyncPanel(ctx, classId, mcs) {
    const today = new Date().toISOString().slice(0, 10);
    let mcIncludeSubtasks = 1;
    const panel = makePanel('Sync Microcredentials');
    panel.innerHTML += `
        ${field('Microcredential', `<select id="ck-mc-sel" ${IS}>${mcs.map(m =>
            `<option value="${m.id}">${m.name}</option>`).join('')}</select>`)}
        ${field('Category',        `<select id="ck-category" ${IS}><option value="">Loading…</option></select>`)}
        <div id="ck-period-row" style="display:none;margin-bottom:10px">
            <span style="font-size:11px;color:#64748b;font-weight:500;text-transform:uppercase;letter-spacing:.04em">Marking Period</span>
            <span id="ck-period" style="display:block;font-size:13px;margin-top:3px"></span>
        </div>
        ${field('Due Date',              `<input id="ck-due"        type="date"   value="${today}" ${IS}>`)}
        ${field('Sub Skill Max Points',  `<input id="ck-sub-points" type="number" value="10" min="0.01" step="0.01" ${IS}>`)}
        ${field('Credential Max Points', `<input id="ck-cred-points" type="number" value="50" min="0.01" step="0.01" ${IS}>`)}
        <div id="ck-status" style="font-size:12px;color:#64748b;margin-bottom:12px;min-height:32px;line-height:1.4"></div>
        <div style="display:flex;gap:8px">
            <button id="ck-mc-form" style="flex:1;padding:9px;background:#7c3aed;color:#fff;border:none;border-radius:5px;font-size:12px;font-weight:600;cursor:pointer">Sync Checkpoints</button>
            <button id="ck-mc-summ" style="flex:1;padding:9px;background:#0f172a;color:#fff;border:none;border-radius:5px;font-size:12px;font-weight:600;cursor:pointer">Sync Credential</button>
        </div>
    `;
    document.getElementById('ck-close').onclick = () => { removeUI(); injectButton(ctx); };

    const runSync = async (type) => {
        const subPoints  = parseFloat(document.getElementById('ck-sub-points')?.value);
        const credPoints = parseFloat(document.getElementById('ck-cred-points')?.value);
        const duedate    = document.getElementById('ck-due')?.value;
        const catSel     = document.getElementById('ck-category');
        const teachercategoryid = Number(catSel?.value);
        const termid     = Number(catSel?.dataset.termid);
        const storecode  = catSel?.dataset.storecode;
        const mcId       = Number(document.getElementById('ck-mc-sel')?.value);

        if (!duedate)                          { setStatus('Select a due date.', '#dc2626'); return; }
        if (isNaN(subPoints)  || subPoints  <= 0) { setStatus('Enter valid sub skill max points.', '#dc2626'); return; }
        if (isNaN(credPoints) || credPoints <= 0) { setStatus('Enter valid credential max points.', '#dc2626'); return; }
        if (!teachercategoryid)                { setStatus('Select a category.', '#dc2626'); return; }
        if (!termid)                           { setStatus('Category data not loaded yet.', '#dc2626'); return; }
        if (!storecode)                        { setStatus('No active marking period found.', '#dc2626'); return; }

        const fBtn = document.getElementById('ck-mc-form');
        const sBtn = document.getElementById('ck-mc-summ');
        fBtn.disabled = sBtn.disabled = true;
        fBtn.textContent = sBtn.textContent = 'Working…';
        try {
            await doMcSync(ctx, classId, mcId, type, subPoints, credPoints, mcIncludeSubtasks, duedate, teachercategoryid, termid);
        } catch (err) {
            setStatus(`Error: ${err.message}`, '#dc2626');
            console.error('[MC Sync]', err);
        }
        fBtn.disabled = sBtn.disabled = false;
        fBtn.textContent = 'Sync Checkpoints';
        sBtn.textContent = 'Sync Credential';
    };

    document.getElementById('ck-mc-form').onclick = () => runSync('formative');
    document.getElementById('ck-mc-summ').onclick = () => runSync('summative');
    loadCategories(ctx.sectionId);

    // Pre-fill max points from teacher's saved gradebook settings
    (async () => {
        const { serverUrl, teacherToken } = await chrome.storage.sync.get(['serverUrl', 'teacherToken']);
        if (!serverUrl || !teacherToken) return;
        try {
            const resp = await chrome.runtime.sendMessage({
                type: 'KENKEN_FETCH',
                url: `${serverUrl}/api/teacher/gradebook-settings`,
                token: teacherToken
            });
            if (!resp?.ok) return;
            const s = resp.data;
            mcIncludeSubtasks = s.mc_include_subtasks ?? 1;
            const subEl  = document.getElementById('ck-sub-points');
            const credEl = document.getElementById('ck-cred-points');
            if (subEl)  subEl.value  = s.mc_subtask_max_score    ?? 10;
            if (credEl) credEl.value = s.mc_credential_max_score ?? 50;
        } catch { /* silently ignore */ }
    })();
}

async function doMcSync(ctx, classId, mcId, type, subPoints, credPoints, mcIncludeSubtasks, duedate, teachercategoryid, termid) {
    const { serverUrl, teacherToken } = await chrome.storage.sync.get(['serverUrl', 'teacherToken']);
    const yearid     = Math.floor(termid / 100);
    const dueDateObj = new Date(duedate + 'T12:00:00').toISOString();

    setStatus('Fetching microcredential progress…');
    const progressResp = await chrome.runtime.sendMessage({
        type: 'KENKEN_FETCH',
        url:  `${serverUrl}/api/teacher/microcredentials/${mcId}/progress?class_id=${classId}`,
        token: teacherToken
    });
    if (!progressResp.ok) throw new Error('Failed to fetch microcredential progress.');
    const progress = progressResp.data;

    setStatus('Fetching class roster…');
    const rosterResp = await fetch(`/ws/xte/student?section_ids=${ctx.sectionId}&status=A,P`);
    if (!rosterResp.ok) throw new Error(`Roster fetch failed (${rosterResp.status})`);
    const dcidMap = {};
    for (const s of await rosterResp.json()) dcidMap[s.studentnumber] = s.dcid;

    // Helper: get or create a PS assignment, returning { assignmentId, assignmentsectionid }
    const resolveAssignment = async (existingIds, name, maxPts) => {
        if (existingIds?.ps_assignment_id) {
            let { ps_assignment_id: assignmentId, ps_assignmentsection_id: assignmentsectionid } = existingIds;
            if (!assignmentsectionid) {
                const r = await fetch(`/ws/xte/section/assignment/${assignmentId}`);
                if (r.ok) {
                    const d = await r.json();
                    assignmentsectionid = d._assignmentsections
                        ?.find(s => String(s.sectionsdcid) === String(ctx.sectionId))?.assignmentsectionid;
                }
            }
            return { assignmentId, assignmentsectionid };
        }
        return psCreateAssignment(name, duedate, dueDateObj, maxPts, Number(ctx.sectionId), yearid, teachercategoryid);
    };

    // Helper: build and submit scores for one assignment
    const submitForAssignment = async (assignmentId, assignmentsectionid, scoreFn) => {
        const scores = [];
        const unmatched = [];
        for (const s of progress.students) {
            const dcid = dcidMap[s.student_id];
            if (!dcid) { unmatched.push(s.student_name); continue; }
            scores.push(psScoreEntry(dcid, scoreFn(s), assignmentsectionid, assignmentId, ctx.sectionId));
        }
        if (scores.length) await psSubmitScores(scores);
        return unmatched;
    };

    // Proportional score: subtasks done / total subtasks * maxPts (rounds to 2 dp)
    const subtaskScore = (s, cp, maxPts) => {
        if (!cp.subtasks?.length) return s.completions[cp.id] ? maxPts : 0;
        const done = cp.subtasks.filter(st => !!s.subtask_completions?.[st.id]).length;
        return Math.round((done / cp.subtasks.length) * maxPts * 100) / 100;
    };

    // PS assignment names are capped at 50 characters
    const psName = (s) => s.length <= 50 ? s : s.slice(0, 47) + '…';

    if (progress.sync_enabled === 0) {
        setStatus('This credential is excluded from gradebook sync. Enable it in the teacher portal to sync.', '#94a3b8');
        return;
    }

    if (type === 'formative') {
        const enabledCps   = progress.checkpoints.filter(cp => cp.sync_enabled !== 0);
        const skippedCount = progress.checkpoints.length - enabledCps.length;
        const syncedCheckpoints = [];
        for (const cp of enabledCps) {
            setStatus(`Syncing: ${cp.name}…`);
            const { assignmentId, assignmentsectionid } = await resolveAssignment(
                progress.ps_ids.checkpoints[cp.id],
                psName(`${progress.mc_name} — ${cp.name}`),
                subPoints
            );
            await submitForAssignment(assignmentId, assignmentsectionid,
                s => subtaskScore(s, cp, subPoints));
            syncedCheckpoints.push({
                checkpoint_id:           cp.id,
                ps_assignment_id:        String(assignmentId),
                ps_assignmentsection_id: String(assignmentsectionid)
            });
        }
        if (syncedCheckpoints.length) {
            await chrome.runtime.sendMessage({
                type: 'KENKEN_FETCH', method: 'POST',
                url:  `${serverUrl}/api/teacher/microcredentials/${mcId}/sync-ids`,
                token: teacherToken,
                body: { class_id: classId, checkpoints: syncedCheckpoints }
            });
        }
        let msg = `✓ Synced ${enabledCps.length} checkpoint assignment${enabledCps.length !== 1 ? 's' : ''}.`;
        if (skippedCount) msg += ` ${skippedCount} excluded from sync.`;
        setStatus(msg, '#16a34a');

    } else {
        setStatus('Syncing credential assignment…');
        const { assignmentId, assignmentsectionid } = await resolveAssignment(
            progress.ps_ids.summative,
            psName(`${progress.mc_name} — Microcredential`),
            credPoints
        );

        const credScoreFn = mcIncludeSubtasks
            ? (s) => {
                // % of all subtasks across all checkpoints × max
                const allSubtasks = progress.checkpoints.flatMap(cp => cp.subtasks ?? []);
                if (!allSubtasks.length) {
                    const done = progress.checkpoints.filter(cp => !!s.completions[cp.id]).length;
                    return Math.round((done / progress.checkpoints.length) * credPoints * 100) / 100;
                }
                const done = allSubtasks.filter(st => !!s.subtask_completions?.[st.id]).length;
                return Math.round((done / allSubtasks.length) * credPoints * 100) / 100;
            }
            : (s) => {
                // fully completed checkpoints ÷ total × max
                const done = progress.checkpoints.filter(cp => !!s.completions[cp.id]).length;
                return Math.round((done / progress.checkpoints.length) * credPoints * 100) / 100;
            };

        const unmatched = await submitForAssignment(assignmentId, assignmentsectionid, credScoreFn);
        await chrome.runtime.sendMessage({
            type: 'KENKEN_FETCH', method: 'POST',
            url:  `${serverUrl}/api/teacher/microcredentials/${mcId}/sync-ids`,
            token: teacherToken,
            body: { class_id: classId, summative: { ps_assignment_id: String(assignmentId), ps_assignmentsection_id: String(assignmentsectionid) } }
        });
        const fullCredit = progress.students.filter(s => credScoreFn(s) >= credPoints).length;
        let msg = `✓ ${fullCredit} / ${progress.students.length} at full credit.`;
        if (unmatched.length) msg += ` ${unmatched.length} unmatched.`;
        setStatus(msg, '#16a34a');
    }
}

// ── Daily rubric sync panel ───────────────────────────────────────────────────

async function showRubricSyncPanel(ctx, classId) {
    const today        = new Date().toISOString().slice(0, 10);
    const defaultName  = `Rubric ${new Date().toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}`;
    const { serverUrl, teacherToken } = await chrome.storage.sync.get(['serverUrl', 'teacherToken']);

    let defaultPoints = 75;
    if (serverUrl && teacherToken) {
        const settingsResp = await chrome.runtime.sendMessage({
            type: 'KENKEN_FETCH', url: `${serverUrl}/api/teacher/gradebook-settings`, token: teacherToken
        });
        if (settingsResp.ok) defaultPoints = settingsResp.data.rubric_max_score ?? 75;
    }

    const panel = makePanel('Sync Daily Rubric');
    panel.innerHTML += `
        ${field('Assignment Name', `<input id="ck-name"     type="text"   value="${defaultName}" ${IS}>`)}
        ${field('Due Date',        `<input id="ck-due"      type="date"   value="${today}" ${IS}>`)}
        ${field('Max Points',      `<input id="ck-points"   type="number" value="${defaultPoints}" min="1" ${IS}>`)}
        ${field('Category',        `<select id="ck-category" ${IS}><option value="">Loading…</option></select>`)}
        <div id="ck-period-row" style="display:none;margin-bottom:10px">
            <span style="font-size:11px;color:#64748b;font-weight:500;text-transform:uppercase;letter-spacing:.04em">Marking Period</span>
            <span id="ck-period" style="display:block;font-size:13px;margin-top:3px"></span>
        </div>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:12px 0">
        ${field('Score Start', `<input id="ck-start" type="date" ${IS}>`)}
        ${field('Score End',   `<input id="ck-end"   type="date" value="${today}" ${IS}>`)}
        <div id="ck-status" style="font-size:12px;color:#64748b;margin-bottom:12px;min-height:16px;line-height:1.4"></div>
        <button id="ck-rubric-create" style="width:100%;padding:9px;background:#0891b2;color:#fff;border:none;border-radius:5px;font-size:13px;font-weight:600;cursor:pointer">Create &amp; Sync</button>
    `;
    document.getElementById('ck-close').onclick          = () => { removeUI(); injectButton(ctx); };
    document.getElementById('ck-rubric-create').onclick  = () => doRubricSync(ctx, classId);
    loadCategories(ctx.sectionId);
}

async function doRubricSync(ctx, classId) {
    const { serverUrl, teacherToken } = await chrome.storage.sync.get(['serverUrl', 'teacherToken']);
    const name      = document.getElementById('ck-name')?.value.trim();
    const duedate   = document.getElementById('ck-due')?.value;
    const points    = parseFloat(document.getElementById('ck-points')?.value);
    const catSel    = document.getElementById('ck-category');
    const teachercategoryid = Number(catSel?.value);
    const termid    = Number(catSel?.dataset.termid);
    const storecode = catSel?.dataset.storecode;
    const start     = document.getElementById('ck-start')?.value;
    const end       = document.getElementById('ck-end')?.value;

    if (!name)                        { setStatus('Enter an assignment name.', '#dc2626'); return; }
    if (!duedate)                     { setStatus('Select a due date.', '#dc2626'); return; }
    if (isNaN(points) || points < 1)  { setStatus('Enter valid max points.', '#dc2626'); return; }
    if (!teachercategoryid)           { setStatus('Select a category.', '#dc2626'); return; }
    if (!termid)                      { setStatus('Category data not loaded yet.', '#dc2626'); return; }
    if (!storecode)                   { setStatus('No active marking period found.', '#dc2626'); return; }
    if (!start || !end)               { setStatus('Select a score date range.', '#dc2626'); return; }
    if (start > end)                  { setStatus('Start must be before end.', '#dc2626'); return; }

    const btn = document.getElementById('ck-rubric-create');
    btn.disabled = true; btn.textContent = 'Creating…';

    try {
        const yearid     = Math.floor(termid / 100);
        const dueDateObj = new Date(duedate + 'T12:00:00').toISOString();

        setStatus('Fetching rubric totals…');
        const totalsUrl = `${serverUrl}/api/teacher/rubric/totals?class_id=${classId}&start=${start}&end=${end}`;
        console.log('[Rubric Sync] fetching:', totalsUrl);
        const totalsResp = await chrome.runtime.sendMessage({
            type: 'KENKEN_FETCH',
            url: totalsUrl,
            token: teacherToken
        });
        console.log('[Rubric Sync] totals response:', totalsResp);
        if (!totalsResp.ok) throw new Error('Failed to fetch rubric totals.');
        const totalsData = totalsResp.data;

        if (!totalsData.students?.length)
            throw new Error('No rubric entries found for the selected date range.');

        setStatus('Fetching class roster…');
        const rosterResp = await fetch(`/ws/xte/student?section_ids=${ctx.sectionId}&status=A,P`);
        if (!rosterResp.ok) throw new Error(`Roster fetch failed (${rosterResp.status})`);
        const dcidMap = {};
        for (const s of await rosterResp.json()) dcidMap[s.studentnumber] = s.dcid;

        setStatus('Creating assignment in PowerSchool…');
        const { assignmentId, assignmentsectionid } =
            await psCreateAssignment(name, duedate, dueDateObj, points, Number(ctx.sectionId), yearid, teachercategoryid);

        setStatus('Submitting scores…');
        const scores    = [];
        const unmatched = [];
        for (const s of totalsData.students) {
            const dcid = dcidMap[s.student_id];
            if (!dcid) { unmatched.push(s.student_id); continue; }
            scores.push(psScoreEntry(dcid, s.total_score, assignmentsectionid, assignmentId, ctx.sectionId));
        }
        if (scores.length) await psSubmitScores(scores);

        let msg = `✓ Synced ${scores.length} rubric score${scores.length !== 1 ? 's' : ''}.`;
        if (unmatched.length) msg += ` ${unmatched.length} unmatched.`;
        setStatus(msg, '#16a34a');
    } catch (err) {
        setStatus(`Error: ${err.message}`, '#dc2626');
        console.error('[Rubric Sync]', err);
    }
    btn.disabled = false; btn.textContent = 'Create & Sync';
}

// ── Shared score submission ───────────────────────────────────────────────────

async function submitScores(sectionId, assignmentId, classId, start, end, serverUrl, teacherToken, preloaded = null) {
    setStatus('Fetching class roster…');
    const rosterResp = await fetch(`/ws/xte/student?section_ids=${sectionId}&status=A,P`);
    if (!rosterResp.ok) throw new Error(`Roster fetch failed (${rosterResp.status})`);
    const roster  = await rosterResp.json();
    const dcidMap = {};
    for (const s of roster) dcidMap[s.studentnumber] = s.dcid;

    let assignmentsectionid, totalpointvalue;
    if (preloaded) {
        ({ assignmentsectionid, totalpointvalue } = preloaded);
    } else {
        setStatus('Fetching assignment details…');
        const assignResp = await fetch(`/ws/xte/section/assignment/${assignmentId}`);
        if (!assignResp.ok) throw new Error(`Assignment fetch failed (${assignResp.status})`);
        const assignData    = await assignResp.json();
        const sectionEntry  = assignData._assignmentsections?.find(s => String(s.sectionsdcid) === String(sectionId));
        if (!sectionEntry)  throw new Error('Assignment not linked to this section.');
        ({ assignmentsectionid, totalpointvalue } = sectionEntry);
    }

    setStatus('Fetching DobbsCore grades…');
    const gradesResp = await chrome.runtime.sendMessage({
        type: 'KENKEN_FETCH',
        url: `${serverUrl}/api/teacher/grades?class_id=${classId}&start=${start}&end=${end}`,
        token: teacherToken
    });
    if (!gradesResp.ok) throw new Error(`DobbsCore grades fetch failed: ${gradesResp.error}`);
    const gradesData = gradesResp.data;

    setStatus('Matching students…');
    const scores    = [];
    const unmatched = [];

    for (const student of gradesData.students) {
        if (student.grade == null) continue;
        const dcid = dcidMap[student.student_id];
        if (!dcid) { unmatched.push(student.student_name); continue; }

        const pointValue = +((student.grade / gradesData.max_score) * totalpointvalue).toFixed(1);
        scores.push(psScoreEntry(dcid, pointValue, assignmentsectionid, assignmentId, sectionId));
    }

    if (scores.length === 0) {
        if (unmatched.length > 0)
            throw new Error(`No ID matches found. Unmatched: ${unmatched.join(', ')}`);
        throw new Error('No grades to submit for the selected date range.');
    }

    setStatus(`Submitting ${scores.length} grades…`);
    try {
        await psSubmitScores(scores);
    } catch (err) {
        throw new Error(err.message);
    }

    let msg = `✓ Synced ${scores.length} grade${scores.length !== 1 ? 's' : ''}.`;
    if (unmatched.length) msg += ` ${unmatched.length} unmatched: ${unmatched.join(', ')}.`;
    setStatus(msg, '#16a34a');
}

// ── Import roster panel ───────────────────────────────────────────────────────

function showImportPanel(ctx) {
    const panel = makePanel('Import Roster to DobbsCore');
    panel.innerHTML += `
        ${field('Class Name', `<input id="ck-name" type="text" placeholder="e.g. Period 3" ${IS}>`)}
        <div id="ck-roster-preview" style="font-size:12px;color:#64748b;margin-bottom:12px">Fetching roster…</div>
        <div id="ck-status" style="font-size:12px;color:#64748b;margin-bottom:12px;min-height:16px;line-height:1.4"></div>
        <button id="ck-import" style="width:100%;padding:9px;background:#059669;color:#fff;border:none;border-radius:5px;font-size:13px;font-weight:600;cursor:pointer">Import</button>
    `;
    document.getElementById('ck-close').onclick = () => { removeUI(); injectButton(ctx); };
    document.getElementById('ck-import').onclick = () => doImportRoster(ctx);

    // Pre-fetch roster to show student count
    fetch(`/ws/xte/student?section_ids=${ctx.sectionId}&status=A,P`)
        .then(r => r.json())
        .then(roster => {
            ctx._roster = roster;
            const preview = document.getElementById('ck-roster-preview');
            if (preview) preview.textContent = `${roster.length} students found in this section.`;
        })
        .catch(() => {
            const preview = document.getElementById('ck-roster-preview');
            if (preview) preview.textContent = 'Could not fetch roster preview.';
        });
}

async function doImportRoster(ctx) {
    const { serverUrl, teacherToken } = await chrome.storage.sync.get(['serverUrl', 'teacherToken']);
    const name = document.getElementById('ck-name')?.value.trim();

    if (!name)   { setStatus('Enter a class name.', '#dc2626'); return; }
    if (!ctx._roster?.length) { setStatus('Roster not loaded yet — try again.', '#dc2626'); return; }
    if (!serverUrl || !teacherToken) { setStatus('Configure extension settings first.', '#dc2626'); return; }

    const btn = document.getElementById('ck-import');
    btn.disabled = true; btn.textContent = 'Importing…';

    const students = ctx._roster.map(s => ({
        student_id:   s.studentnumber,
        student_name: s.lastfirst,
        ps_dcid:      s.id      // s.id = PS Student ID (used in attendance); s.dcid = DCID (used in score entries)
    }));

    const resp = await chrome.runtime.sendMessage({
        type:   'KENKEN_FETCH',
        method: 'POST',
        url:    `${serverUrl}/api/teacher/classes/import-roster`,
        token:  teacherToken,
        body:   { name, ps_section_id: ctx.sectionId, students }
    });

    if (!resp.ok) {
        setStatus(`Import failed: ${resp.error}`, '#dc2626');
        btn.disabled = false; btn.textContent = 'Import';
        return;
    }

    setStatus(`✓ Imported ${resp.data.student_count} students as "${name}".`, '#16a34a');
    // Remove the import button — section is now registered
    document.getElementById(IMPORT_BTN_ID)?.remove();
    btn.disabled = false; btn.textContent = 'Import';
}

// ── Navigation detection (PowerSchool) ───────────────────────────────────────

function handleNavigation() {
    removeUI();
    const ctx = getPageContext();
    if (ctx) injectButton(ctx);
}

if (window.location.hostname.includes('powerschool.com')) {
    window.addEventListener('hashchange', handleNavigation);
    handleNavigation();
}

// ── DobbsCore portal injection ────────────────────────────────────────────────
// Runs when the extension is loaded on the DobbsCore teacher portal.
// Watches for the rubric tab and injects a "Pull from PS Attendance" button.

if (window.location.hostname.includes('powerschool.com')) {
    // On the PS attendance page: auto-capture JS vars into chrome.storage.local
    if (window.location.pathname.includes('saveAttendanceGrid') ||
        window.location.pathname.includes('attendance-grid')) {
        captureAttendanceFromPage();
    }
} else {
    // On DobbsCore portal: watch for rubric tab and inject pull button
    const rubricObserver = new MutationObserver(() => {
        const actionsEl = document.getElementById('rubric-tab-actions');
        if (actionsEl && !document.getElementById('ck-pull-att-btn')) {
            injectPullAttendanceButton(actionsEl);
        }
    });
    rubricObserver.observe(document.body, { childList: true, subtree: true });
}

function showAttToast(msg, bg = '#16a34a') {
    const existing = document.getElementById('ck-att-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'ck-att-toast';
    toast.textContent = msg;
    Object.assign(toast.style, {
        position: 'fixed', bottom: '24px', right: '24px', zIndex: '99999',
        background: bg, color: '#fff', padding: '12px 18px',
        borderRadius: '8px', fontSize: '13px', fontWeight: '600',
        boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
        fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif',
        maxWidth: '320px', lineHeight: '1.4',
        transition: 'opacity 0.4s'
    });
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; }, 3500);
    setTimeout(() => { toast.remove(); }, 4000);
}

// Runs on the PS attendance page. Asks the background to read PS window-scope variables
// via executeScript (which is not blocked by PS's CSP, unlike inline script injection),
// then caches the data in chrome.storage.local keyed by section + date.
function captureAttendanceFromPage() {
    chrome.runtime.sendMessage({ type: 'READ_ATT_VARS' }, async (result) => {
        if (chrome.runtime.lastError || !result?.ok) {
            const msg = result?.error || chrome.runtime.lastError?.message || 'unknown error';
            showAttToast(`DobbsCore: Could not read attendance — ${msg}`, '#dc2626');
            return;
        }
        const { sectionId, studentIds, dates, attData } = result;
        if (!sectionId) {
            showAttToast('DobbsCore: Could not read attendance data from this page.', '#dc2626');
            return;
        }
        const key          = `att_${sectionId}`;
        const studentCount = studentIds?.[0]?.length ?? 0;
        const dateCount    = dates?.[0]?.length ?? 0;
        await chrome.storage.local.set({ [key]: { studentIds, dates, attData, cachedAt: Date.now() } });
        console.log('[DobbsCore] Attendance cached for section', sectionId, '—', dateCount, 'dates,', studentCount, 'students');
        showAttToast(`DobbsCore: Attendance cached — ${studentCount} students, ${dateCount} dates`, '#16a34a');
    });
}

function injectPullAttendanceButton(actionsEl) {
    const btn = document.createElement('button');
    btn.id        = 'ck-pull-att-btn';
    btn.textContent = '⟳ Pull from PS Attendance';
    Object.assign(btn.style, {
        padding: '0.5rem 1rem', background: '#0891b2', color: '#fff',
        border: 'none', borderRadius: '6px', fontSize: '0.875rem',
        fontWeight: '600', cursor: 'pointer', marginLeft: '0.75rem'
    });
    btn.onmouseenter = () => { btn.style.filter = 'brightness(0.9)'; };
    btn.onmouseleave = () => { btn.style.filter = ''; };
    btn.onclick = doPullAttendance;

    const statusSpan = document.createElement('span');
    statusSpan.id = 'ck-pull-att-status';
    Object.assign(statusSpan.style, { fontSize: '0.8125rem', marginLeft: '0.5rem', color: '#64748b' });

    actionsEl.appendChild(btn);
    actionsEl.appendChild(statusSpan);
}

async function doPullAttendance() {
    const btn      = document.getElementById('ck-pull-att-btn');
    const statusEl = document.getElementById('ck-pull-att-status');
    const setPS = (msg, color = '#64748b') => {
        if (statusEl) { statusEl.textContent = msg; statusEl.style.color = color; }
    };

    const classId = document.getElementById('rubric-class-select')?.value;
    const isoDate = document.getElementById('rubric-tab-date')?.value;
    if (!classId) { setPS('Select a class first.', '#dc2626'); return; }
    if (!isoDate) { setPS('Select a date first.', '#dc2626'); return; }

    btn.disabled = true; btn.textContent = 'Pulling...'; setPS('');

    try {
        if (!chrome?.storage?.local) {
            throw new Error('Extension storage not available — reload the page and try again.');
        }

        const classSel = document.getElementById('rubric-class-select');
        const psSectionId = classSel?.selectedOptions[0]?.dataset?.psSection;
        if (!psSectionId) { setPS('Class has no linked PS section ID.', '#dc2626'); return; }

        const [yr, mm, dd] = isoDate.split('-');
        const psDate = `${mm}/${dd}/${yr}`;
        const mdDate = `${parseInt(mm)}/${parseInt(dd)}`;

        // Read from cache written when teacher visited the PS attendance page.
        // Keyed by section only (no date) — the full grid is stored and any date can be looked up.
        // PS uses different sectionId values in gradebook vs attendance URLs, so fall back to
        // scanning all cached sections for one that contains the requested date.
        const cacheKey  = `att_${psSectionId}`;
        const allCached = await chrome.storage.local.get(null);
        let cache       = allCached[cacheKey];

        if (!cache) {
            // Filter to sections that actually contain the requested date in their range
            const candidates = Object.entries(allCached)
                .filter(([k, v]) => k.startsWith('att_') && (v.dates?.[0] ?? []).includes(mdDate));

            if (!candidates.length) {
                setPS(`No cached attendance containing ${mdDate}. Open the PS attendance page for this class, then try again.`, '#dc2626');
                return;
            }

            if (candidates.length === 1) {
                cache = candidates[0][1];
            } else {
                // Multiple sections have this date — match by stored ps_dcid values
                setPS('Matching attendance to class...');
                const { serverUrl, teacherToken } = await chrome.storage.sync.get(['serverUrl', 'teacherToken']);
                const classResp2 = await chrome.runtime.sendMessage({
                    type: 'KENKEN_FETCH',
                    url: `${serverUrl}/api/teacher/classes/${classId}`,
                    token: teacherToken
                });
                if (classResp2.ok) {
                    const knownDcids = new Set(classResp2.data.students.map(s => String(s.ps_dcid)).filter(Boolean));
                    const match = candidates.find(([, v]) =>
                        (v.studentIds?.[0] ?? []).some(id => knownDcids.has(String(id)))
                    );
                    if (match) cache = match[1];
                }
                if (!cache) cache = candidates[0][1]; // last resort
            }
        }

        const studentDcids = cache.studentIds?.[0];
        const dates        = cache.dates?.[0];
        const attData      = cache.attData?.[0];
        if (!studentDcids || !dates || !attData) {
            setPS('Cached data is incomplete. Re-open the PS attendance page.', '#dc2626');
            return;
        }

        const dateIdx = dates.indexOf(mdDate);
        if (dateIdx === -1) {
            setPS(`Date ${mdDate} not found in cached attendance (not a school day?).`, '#dc2626');
            return;
        }

        const codeByDcid = {};
        studentDcids.forEach((dcid, sIdx) => {
            codeByDcid[String(dcid)] = attData[sIdx]?.[dateIdx]?.[0]?.[3]?.[1] ?? '';
        });

        // Fetch DobbsCore students for this class — they have ps_dcid stored from import
        setPS('Matching students...');
        const { serverUrl, teacherToken } = await chrome.storage.sync.get(['serverUrl', 'teacherToken']);
        const classResp = await chrome.runtime.sendMessage({
            type: 'KENKEN_FETCH',
            url: `${serverUrl}/api/teacher/classes/${classId}`,
            token: teacherToken
        });
        if (!classResp.ok) { setPS('Could not load class roster from DobbsCore.', '#dc2626'); return; }

        console.log('[DobbsCore Pull] codeByDcid keys (from PS cache):', Object.keys(codeByDcid));
        console.log('[DobbsCore Pull] DobbsCore students:',
            classResp.data.students.map(s => ({ name: s.student_name, student_id: s.student_id, ps_dcid: s.ps_dcid }))
        );

        let filled = 0;
        for (const s of classResp.data.students) {
            if (!s.ps_dcid) continue;
            const code = codeByDcid[String(s.ps_dcid)];
            if (code === undefined) continue;
            const tlSel = document.getElementById(`rb-tl-${s.student_id}`);
            if (!tlSel) continue;
            tlSel.value = String(codeToTimeliness(code));
            tlSel.dispatchEvent(new Event('change'));
            filled++;
        }

        setPS(
            filled > 0
                ? `Filled ${filled} student${filled !== 1 ? 's' : ''} from PS.`
                : 'No students matched - check roster is imported.',
            filled > 0 ? '#16a34a' : '#dc2626'
        );
    } catch (err) {
        setPS(`Error: ${err.message}`, '#dc2626');
        console.error('[Pull Attendance]', err);
    } finally {
        btn.disabled = false; btn.textContent = 'Pull from PS Attendance';
    }
}

// Bracket-counting parser for embedded PS JavaScript arrays.
// PS embeds data as  var name = [...];  in <script> blocks.
function extractJsVar(html, varName) {
    const marker = `var ${varName} = `;
    const pos = html.indexOf(marker);
    if (pos === -1) return null;
    let i = pos + marker.length, depth = 0, inStr = false, esc = false, strCh = '';
    const start = i;
    while (i < html.length) {
        const c = html[i];
        if (esc)         { esc = false; }
        else if (inStr)  { if (c === '\\') esc = true; else if (c === strCh) inStr = false; }
        else             {
            if      (c === '"' || c === "'") { inStr = true; strCh = c; }
            else if (c === '[') depth++;
            else if (c === ']' && --depth === 0) { i++; break; }
        }
        i++;
    }
    try { return JSON.parse(html.slice(start, i)); } catch { return null; }
}

// Maps a PS attendance code to a rubric timeliness value (5/3/0).
function codeToTimeliness(code) {
    if (!code) return 5;
    const c = code.toUpperCase();
    if (c === 'UXT') return 3;  // Unexcused Tardy
    if (c === 'UNV') return 0;  // Unverified Absence
    return 5;                   // All other codes → On Time
}
