'use strict';

const BTN_ID        = 'ck-sync-btn';
const IMPORT_BTN_ID = 'ck-import-btn';
const RESYNC_BTN_ID = 'ck-resync-btn';
const WBL_BTN_ID    = 'ck-wbl-btn';
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
    document.getElementById(RESYNC_BTN_ID)?.remove();
    document.getElementById(WBL_BTN_ID)?.remove();
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

    // Work-Based Learning: only when this class is linked to a WBL program
    const wblResp = await chrome.runtime.sendMessage({
        type: 'KENKEN_FETCH',
        url: `${serverUrl}/api/wbl/sync/progress?class_id=${matchedClass.id}`,
        token: teacherToken
    });
    if (wblResp.ok && wblResp.data?.programs?.length) {
        makeBtn(WBL_BTN_ID, 'Sync Work-Based Learning', '72px', '#c2410c',
            () => showWblSyncPanel(ctx, matchedClass.id, wblResp.data.programs.map(p => p.program)));
    }

    // Re-pull the PS roster and reconcile adds/withdrawals against DobbsCore.
    // Fixed 120px slot so it never collides with the conditional WBL button.
    makeBtn(RESYNC_BTN_ID, 'Re-sync Roster', '120px', '#d97706', () => showResyncPanel(ctx, matchedClass));
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

// ── Work-Based Learning sync panel ────────────────────────────────────────────
//
// Three grains, mirroring the three scored lenses of the WBL framework:
//   · Credentials  — one PS assignment per credential, partial credit by skills satisfied
//   · Work Events  — one PS assignment per completed job, scored from its Holistic Call
//   · Transfer     — one PS assignment per transfer skill, accumulating verified claims
//
// QC spot checks and the dispositional Do Now / Exit Slip are deliberately never
// synced: they are formative and carry no score by design.

// Clones the category list into the summative selector and preselects a
// summative-looking category. loadCategories() only populates #ck-category,
// and the WBL panel needs two: formative for skills, summative for credentials.
function mirrorSummativeCategories() {
    const src = document.getElementById('ck-category');
    const dst = document.getElementById('ck-category-summ');
    if (!src || !dst) return;
    dst.innerHTML = src.innerHTML;
    const summ = Array.from(dst.options).find(o => o.textContent.toLowerCase().includes('summative'));
    if (summ) summ.selected = true;
}

function showWblSyncPanel(ctx, classId, programs) {
    const today = new Date().toISOString().slice(0, 10);
    const panel = makePanel('Sync Work-Based Learning');
    panel.innerHTML += `
        ${field('Program', `<select id="ck-wbl-prog" ${IS}>${programs.map(p =>
            `<option value="${p.id}">${p.name}</option>`).join('')}</select>`)}
        ${field('Formative Category', `<select id="ck-category" ${IS}><option value="">Loading…</option></select>`)}
        ${field('Summative Category', `<select id="ck-category-summ" ${IS}><option value="">Loading…</option></select>`)}
        <div id="ck-period-row" style="display:none;margin-bottom:10px">
            <span style="font-size:11px;color:#64748b;font-weight:500;text-transform:uppercase;letter-spacing:.04em">Marking Period</span>
            <span id="ck-period" style="display:block;font-size:13px;margin-top:3px"></span>
        </div>
        ${field('Due Date',              `<input id="ck-due"        type="date"   value="${today}" ${IS}>`)}
        ${field('Work Event Max Points', `<input id="ck-we-points"   type="number" value="20" min="0.01" step="0.01" ${IS}>`)}
        ${field('Transfer Max Points',   `<input id="ck-tr-points"   type="number" value="10" min="0.01" step="0.01" ${IS}>`)}
        <p style="font-size:11px;color:#94a3b8;margin:-2px 0 10px;line-height:1.45">
            Skills and credentials are completion grades, scored 0 or 100.
        </p>
        <div id="ck-wbl-jobs" style="margin-bottom:10px"></div>
        <div id="ck-status" style="font-size:12px;color:#64748b;margin-bottom:12px;min-height:32px;line-height:1.4"></div>
        <div style="display:flex;flex-direction:column;gap:6px">
            <button id="ck-wbl-skills" style="padding:9px;background:#2563eb;color:#fff;border:none;border-radius:5px;font-size:12px;font-weight:600;cursor:pointer">Sync Skills (Formative)</button>
            <button id="ck-wbl-cred" style="padding:9px;background:#0f172a;color:#fff;border:none;border-radius:5px;font-size:12px;font-weight:600;cursor:pointer">Sync Credentials (Summative)</button>
            <button id="ck-wbl-we"   style="padding:9px;background:#c2410c;color:#fff;border:none;border-radius:5px;font-size:12px;font-weight:600;cursor:pointer">Sync Selected Work Events</button>
            <button id="ck-wbl-tr"   style="padding:9px;background:#7c3aed;color:#fff;border:none;border-radius:5px;font-size:12px;font-weight:600;cursor:pointer">Sync Transfer Skills</button>
        </div>
    `;
    document.getElementById('ck-close').onclick = () => { removeUI(); injectButton(ctx); };
    loadCategories(ctx.sectionId).then(() => mirrorSummativeCategories());

    // Point defaults come from the teacher's DobbsCore gradebook settings so the
    // two systems agree without re-typing.
    (async () => {
        const { serverUrl, teacherToken } = await chrome.storage.sync.get(['serverUrl', 'teacherToken']);
        const gs = await chrome.runtime.sendMessage({
            type: 'KENKEN_FETCH', url: `${serverUrl}/api/teacher/gradebook-settings`, token: teacherToken
        });
        if (!gs.ok) return;
        const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
        set('ck-we-points',   gs.data.wbl_holistic_max_score);
        set('ck-tr-points',   gs.data.wbl_transfer_max_score);
    })();

    let cache = null;   // last /sync/progress payload

    const refreshJobs = async () => {
        const { serverUrl, teacherToken } = await chrome.storage.sync.get(['serverUrl', 'teacherToken']);
        const resp = await chrome.runtime.sendMessage({
            type: 'KENKEN_FETCH',
            url: `${serverUrl}/api/wbl/sync/progress?class_id=${classId}`,
            token: teacherToken
        });
        if (!resp.ok) { setStatus('Could not load WBL progress.', '#dc2626'); return; }
        cache = resp.data;
        const progId = Number(document.getElementById('ck-wbl-prog').value);
        const block  = cache.programs.find(p => p.program.id === progId);
        const jobs   = block?.work_events ?? [];
        const el = document.getElementById('ck-wbl-jobs');
        el.innerHTML = jobs.length
            ? `<span style="font-size:11px;color:#64748b;font-weight:500;text-transform:uppercase;letter-spacing:.04em">Completed Work Events</span>
               <div style="max-height:132px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:4px;padding:6px;margin-top:3px">
                 ${jobs.map(j => `
                   <label style="display:flex;align-items:center;gap:6px;padding:2px 0;font-size:12px;cursor:pointer">
                     <input type="checkbox" class="ck-wbl-job" value="${j.work_event_id}" ${j.ps_assignment_id ? '' : 'checked'}>
                     <span>${j.title}</span>
                     ${j.ps_assignment_id ? '<span style="color:#94a3b8;font-size:11px">· synced</span>' : ''}
                   </label>`).join('')}
               </div>`
            : '<span style="font-size:12px;color:#94a3b8">No completed work events yet.</span>';
    };
    document.getElementById('ck-wbl-prog').onchange = refreshJobs;
    refreshJobs();

    const readForm = () => {
        const catSel = document.getElementById('ck-category');
        const summSel = document.getElementById('ck-category-summ');
        const f = {
            duedate:   document.getElementById('ck-due')?.value,
            wePts:     parseFloat(document.getElementById('ck-we-points')?.value),
            trPts:     parseFloat(document.getElementById('ck-tr-points')?.value),
            progId:    Number(document.getElementById('ck-wbl-prog')?.value),
            teachercategoryid:     Number(catSel?.value),
            summcategoryid:        Number(summSel?.value) || Number(catSel?.value),
            termid:    Number(catSel?.dataset.termid),
            storecode: catSel?.dataset.storecode,
        };
        if (!f.duedate)            { setStatus('Select a due date.', '#dc2626'); return null; }
        if (!f.teachercategoryid)  { setStatus('Select a category.', '#dc2626'); return null; }
        if (!f.termid)             { setStatus('Category data not loaded yet.', '#dc2626'); return null; }
        if (!f.storecode)          { setStatus('No active marking period found.', '#dc2626'); return null; }
        return f;
    };

    const run = async (kind) => {
        const f = readForm();
        if (!f) return;
        const btns = ['ck-wbl-skills', 'ck-wbl-cred', 'ck-wbl-we', 'ck-wbl-tr'].map(id => document.getElementById(id));
        btns.forEach(b => { b.disabled = true; b.style.opacity = '0.6'; });
        try {
            await doWblSync(ctx, classId, kind, f, cache);
            await refreshJobs();
        } catch (err) {
            setStatus('Error: ' + err.message, '#dc2626');
            console.error('[DobbsCore WBL sync]', err);
        } finally {
            btns.forEach(b => { b.disabled = false; b.style.opacity = ''; });
        }
    };
    document.getElementById('ck-wbl-skills').onclick = () => run('skills');
    document.getElementById('ck-wbl-cred').onclick = () => run('credentials');
    document.getElementById('ck-wbl-we').onclick   = () => run('work_events');
    document.getElementById('ck-wbl-tr').onclick   = () => run('transfer');
}

async function doWblSync(ctx, classId, kind, f, cache) {
    const { serverUrl, teacherToken } = await chrome.storage.sync.get(['serverUrl', 'teacherToken']);
    const yearid     = Math.floor(f.termid / 100);
    const dueDateObj = new Date(f.duedate + 'T12:00:00').toISOString();

    setStatus('Fetching WBL progress…');
    const resp = await chrome.runtime.sendMessage({
        type: 'KENKEN_FETCH',
        url:  `${serverUrl}/api/wbl/sync/progress?class_id=${classId}`,
        token: teacherToken
    });
    if (!resp.ok) throw new Error('Failed to fetch WBL progress.');
    const data  = resp.data;
    const block = data.programs.find(p => p.program.id === f.progId);
    if (!block) throw new Error('Program is not linked to this class.');

    setStatus('Fetching class roster…');
    const rosterResp = await fetch(`/ws/xte/student?section_ids=${ctx.sectionId}&status=A,P`);
    if (!rosterResp.ok) throw new Error(`Roster fetch failed (${rosterResp.status})`);
    const dcidMap = {};
    for (const s of await rosterResp.json()) dcidMap[s.studentnumber] = s.dcid;

    // Verifies a stored PS assignment id before reusing it — the teacher may
    // have deleted the assignment since the last sync.
    const resolveAssignment = async (existing, name, maxPts, categoryid) => {
        if (existing?.ps_assignment_id) {
            const r = await fetch(`/ws/xte/section/assignment/${existing.ps_assignment_id}`);
            if (r.ok) {
                const d = await r.json();
                const sec = d._assignmentsections?.find(s => String(s.sectionsdcid) === String(ctx.sectionId));
                const asid = Array.isArray(sec?.assignmentsectionid) ? sec.assignmentsectionid[0] : sec?.assignmentsectionid;
                if (asid) return { assignmentId: existing.ps_assignment_id, assignmentsectionid: asid };
            }
        }
        return psCreateAssignment(name, f.duedate, dueDateObj, maxPts, Number(ctx.sectionId), yearid,
                                  categoryid || f.teachercategoryid);
    };

    // Skills and credentials are completion grades, not partial mastery.
    const COMPLETION = 100;

    // scoreFn returns a number, or null to leave the student unscored.
    const submitFor = async (assignmentId, assignmentsectionid, scoreFn) => {
        const scores = [], unmatched = [];
        for (const s of data.students) {
            const dcid = dcidMap[s.student_id];
            if (!dcid) { unmatched.push(s.student_name); continue; }
            const v = scoreFn(s.student_id);
            if (v == null) continue;
            scores.push(psScoreEntry(dcid, v, assignmentsectionid, assignmentId, ctx.sectionId));
        }
        if (scores.length) await psSubmitScores(scores);
        return { count: scores.length, unmatched };
    };

    const round2 = n => Math.round(n * 100) / 100;
    const idsBack = { class_id: classId, skills: [], credentials: [], work_events: [], transfer: [] };
    let summary = '';

    // Formative: one 0/100 completion assignment per skill within a credential.
    // Keyed on the pair because the same skill can be satisfied for one
    // credential and not another with a stricter threshold.
    if (kind === 'skills') {
        const creds = block.credentials.filter(c => c.sync_enabled && c.skills.length);
        if (!creds.length) throw new Error('No credential skills to sync.');
        const total = creds.reduce((n, c) => n + c.skills.filter(sk => sk.sync_enabled).length, 0);
        let done = 0, unmatched = [], satisfiedCount = 0;
        for (const c of creds) {
            for (const sk of c.skills.filter(x => x.sync_enabled)) {
                setStatus(`Syncing “${sk.name}” (${++done}/${total})…`);
                const { assignmentId, assignmentsectionid } = await resolveAssignment(
                    sk, `${block.program.name}: ${c.name} — ${sk.name}`, COMPLETION, f.teachercategoryid);
                const met = new Set(sk.satisfied);
                const res = await submitFor(assignmentId, assignmentsectionid,
                    sid => (met.has(sid) ? COMPLETION : 0));
                unmatched = res.unmatched;
                satisfiedCount += met.size;
                idsBack.skills.push({
                    credential_id: c.credential_id, skill_id: sk.skill_id,
                    ps_assignment_id: String(assignmentId),
                    ps_assignmentsection_id: String(assignmentsectionid),
                });
            }
        }
        summary = `✓ ${total} skill assignment(s). ${satisfiedCount} completion(s) recorded.`;
        if (unmatched.length) summary += ` ${unmatched.length} unmatched.`;
    }

    // Summative: the credential itself, 0/100, earned or not. A credential
    // rests on a complete evidence trail, so there is no partial credit.
    if (kind === 'credentials') {
        const creds = block.credentials.filter(c => c.sync_enabled);
        if (!creds.length) throw new Error('No credentials to sync.');
        let done = 0, unmatched = [];
        for (const c of creds) {
            setStatus(`Syncing “${c.name}” (${++done}/${creds.length})…`);
            const { assignmentId, assignmentsectionid } = await resolveAssignment(
                c, `${block.program.name}: ${c.name}`, COMPLETION, f.summcategoryid);
            const prior = new Set(c.earned_prior);
            const here  = new Set(c.earned);
            const res = await submitFor(assignmentId, assignmentsectionid, sid => {
                // Earned in another class or a previous year: its grade already
                // landed there, so leave this term's assignment untouched.
                if (prior.has(sid) && !here.has(sid)) return null;
                return here.has(sid) ? COMPLETION : 0;
            });
            unmatched = res.unmatched;
            idsBack.credentials.push({
                credential_id: c.credential_id,
                ps_assignment_id: String(assignmentId),
                ps_assignmentsection_id: String(assignmentsectionid),
            });
        }
        const earned = new Set(creds.flatMap(c => c.earned));
        summary = `✓ ${creds.length} credential assignment(s). ${earned.size} earned.`;
        if (unmatched.length) summary += ` ${unmatched.length} unmatched.`;
    }

    if (kind === 'work_events') {
        const picked = new Set([...document.querySelectorAll('.ck-wbl-job:checked')].map(i => Number(i.value)));
        const jobs = block.work_events.filter(w => w.sync_enabled && picked.has(w.work_event_id));
        if (!jobs.length) throw new Error('Select at least one completed work event.');
        let done = 0, unmatched = [];
        for (const w of jobs) {
            setStatus(`Syncing “${w.title}” (${++done}/${jobs.length})…`);
            const { assignmentId, assignmentsectionid } =
                await resolveAssignment(w, `${block.program.name}: ${w.title}`, f.wePts, f.summcategoryid);
            const calls = Object.fromEntries(w.calls.map(c => [c.student_id, c]));
            // Only participants with a Holistic Call are scored — a student who
            // wasn't on the job gets no mark rather than a zero.
            const res = await submitFor(assignmentId, assignmentsectionid, sid => {
                const c = calls[sid];
                if (!c) return null;
                const pct = c.points_pct != null ? c.points_pct : (c.rank / 3) * 100;
                return round2((pct / 100) * f.wePts);
            });
            unmatched = res.unmatched;
            idsBack.work_events.push({
                work_event_id: w.work_event_id,
                ps_assignment_id: String(assignmentId),
                ps_assignmentsection_id: String(assignmentsectionid),
            });
        }
        summary = `✓ ${jobs.length} work event assignment(s) scored.`;
        if (unmatched.length) summary += ` ${unmatched.length} unmatched.`;
    }

    if (kind === 'transfer') {
        const LABEL = { application: 'Application of Previous Knowledge', extension: 'Extension of Knowledge' };
        let done = 0, unmatched = [], scored = 0;
        for (const t of block.transfer) {
            if (t.sync_enabled === 0) continue;
            setStatus(`Syncing ${LABEL[t.kind]} (${++done}/${block.transfer.length})…`);
            const { assignmentId, assignmentsectionid } =
                await resolveAssignment(t, `${block.program.name}: ${LABEL[t.kind]}`, f.trPts, f.summcategoryid);
            const byStudent = Object.fromEntries(t.scores.map(s => [s.student_id, s]));
            const res = await submitFor(assignmentId, assignmentsectionid, sid => {
                const s = byStudent[sid];
                if (!s) return null;              // no verified claim yet — leave blank
                return round2(Math.min(s.score, f.trPts));
            });
            scored += res.count; unmatched = res.unmatched;
            idsBack.transfer.push({
                kind: t.kind,
                ps_assignment_id: String(assignmentId),
                ps_assignmentsection_id: String(assignmentsectionid),
            });
        }
        summary = `✓ Transfer skills synced. ${scored} score(s) submitted.`;
        if (unmatched.length) summary += ` ${unmatched.length} unmatched.`;
    }

    // Hand the PS assignment ids back so the next sync updates these
    // assignments instead of creating duplicates.
    await chrome.runtime.sendMessage({
        type: 'KENKEN_FETCH', method: 'POST',
        url:  `${serverUrl}/api/wbl/sync/ids`,
        token: teacherToken,
        body: idsBack,
    });
    setStatus(summary, '#16a34a');
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

// ── Re-sync roster ────────────────────────────────────────────────────────────
// Reconciles an already-registered class against a fresh PS roster pull:
// new students are added (date-stamped so DobbsCore can prorate their do-now
// requirement), students no longer on the PS roster are soft-withdrawn
// (history kept, reversible), everyone else is left alone.

// PS section entry date for a roster row, confirmed against a live PS
// response (2026-09): it lives on the per-section enrollment record, not the
// top-level student —
//   s._enrollments: [{ sectiondcid, statuscode, enrolledlate, enrolleddate }]
// A student can carry more than one enrollment stint in the same section
// (dropped and re-added), so this filters to the requested section's dcid and
// takes the latest enrolleddate among those. Falls back to undefined — which
// tells the server to stamp the sync date instead — if PS ever omits it.
function psEntryDate(s, sectionId) {
    const entries = (s._enrollments || []).filter(e => String(e.sectiondcid) === String(sectionId));
    if (!entries.length) return undefined;
    const latest = entries.reduce((a, b) => (a.enrolleddate > b.enrolleddate ? a : b));
    const d = String(latest.enrolleddate || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined;
}

function showResyncPanel(ctx, matchedClass) {
    const panel = makePanel('Re-sync Roster');
    panel.innerHTML += `
        <div style="font-size:12px;color:#64748b;margin-bottom:12px;line-height:1.4">
            Pulls the live PowerSchool roster for this section and reconciles it
            against "${matchedClass.name}" in DobbsCore. Students no longer in PS
            are withdrawn, not deleted — their history is kept.
        </div>
        <div id="ck-status" style="font-size:12px;color:#64748b;margin-bottom:12px;min-height:32px;line-height:1.4"></div>
        <button id="ck-resync" style="width:100%;padding:9px;background:#d97706;color:#fff;border:none;border-radius:5px;font-size:13px;font-weight:600;cursor:pointer">Re-sync</button>
    `;
    document.getElementById('ck-close').onclick = () => { removeUI(); injectButton(ctx); };
    document.getElementById('ck-resync').onclick = () => doResyncRoster(ctx, matchedClass.id);
}

async function doResyncRoster(ctx, classId) {
    const { serverUrl, teacherToken } = await chrome.storage.sync.get(['serverUrl', 'teacherToken']);
    if (!serverUrl || !teacherToken) { setStatus('Configure extension settings first.', '#dc2626'); return; }

    const btn = document.getElementById('ck-resync');
    btn.disabled = true; btn.textContent = 'Syncing…';
    setStatus('Fetching PS roster…');

    try {
        const rosterResp = await fetch(`/ws/xte/student?section_ids=${ctx.sectionId}&status=A,P`);
        if (!rosterResp.ok) throw new Error(`Roster fetch failed (${rosterResp.status})`);
        const roster = await rosterResp.json();

        const students = roster.map(s => ({
            student_id:   s.studentnumber,
            student_name: s.lastfirst,
            ps_dcid:      s.id,
            entry_date:   psEntryDate(s, ctx.sectionId),
        }));

        setStatus('Reconciling with DobbsCore…');
        const resp = await chrome.runtime.sendMessage({
            type:   'KENKEN_FETCH',
            method: 'POST',
            url:    `${serverUrl}/api/teacher/classes/${classId}/sync-roster`,
            token:  teacherToken,
            body:   { students }
        });
        if (!resp.ok) throw new Error(resp.error || `HTTP ${resp.status}`);

        const { added, reactivated, withdrawn, unchanged } = resp.data;
        setStatus(
            `✓ Added ${added.length} · reactivated ${reactivated.length} · withdrew ${withdrawn.length} · ${unchanged} unchanged.`,
            '#16a34a'
        );
    } catch (err) {
        setStatus(`Error: ${err.message}`, '#dc2626');
        console.error('[Re-sync Roster]', err);
    }
    btn.disabled = false; btn.textContent = 'Re-sync';
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
// Watches for the WBL Roster tab and injects a "Sync Attendance from PS" button.

if (window.location.hostname.includes('powerschool.com')) {
    // On the PS attendance page: auto-capture JS vars into chrome.storage.local
    if (window.location.pathname.includes('saveAttendanceGrid') ||
        window.location.pathname.includes('attendance-grid')) {
        captureAttendanceFromPage();
    }
} else {
    // On DobbsCore portal: watch for the WBL Roster tab and inject the sync button
    const attObserver = new MutationObserver(() => {
        const actionsEl = document.getElementById('wbl-attendance-sync');
        if (actionsEl && !document.getElementById('ck-pull-att-btn')) {
            injectPullAttendanceButton(actionsEl);
        }
    });
    attObserver.observe(document.body, { childList: true, subtree: true });
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
    btn.textContent = '⟳ Sync Attendance from PS';
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

// PS's cached grid dates are bare "M/D" with no year. There's nothing in the
// cache to disambiguate, so this infers the school year from today's date
// (Jul–Jun year boundary, standard for US districts): a month on/after July
// belongs to the year the current school year started, everything else to
// the year it ends. Good enough for "sync shortly after visiting the PS
// attendance page," which is the only way this cache gets populated anyway.
function mdToIso(md) {
    const [m, d] = md.split('/').map(Number);
    const now = new Date();
    const schoolYearStart = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1; // getMonth() is 0-based, 6 = July
    const year = m >= 7 ? schoolYearStart : schoolYearStart + 1;
    return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Bulk direct ingest: the whole cached date range for every class linked to
// the selected WBL program, posted straight to the server in one shot per
// class — no per-date review step. Trusts PS as the source of truth; the
// only manual override is the "Called Out" button on the roster itself.
async function doPullAttendance() {
    const btn      = document.getElementById('ck-pull-att-btn');
    const statusEl = document.getElementById('ck-pull-att-status');
    const setPS = (msg, color = '#64748b') => {
        if (statusEl) { statusEl.textContent = msg; statusEl.style.color = color; }
    };

    const programId = document.getElementById('wbl-program-select')?.value;
    if (!programId) { setPS('Select a program first.', '#dc2626'); return; }

    btn.disabled = true; btn.textContent = 'Syncing...'; setPS('');

    try {
        if (!chrome?.storage?.local) {
            throw new Error('Extension storage not available — reload the page and try again.');
        }

        const { serverUrl, teacherToken } = await chrome.storage.sync.get(['serverUrl', 'teacherToken']);

        const [wblClassesResp, allClassesResp] = await Promise.all([
            chrome.runtime.sendMessage({ type: 'KENKEN_FETCH', url: `${serverUrl}/api/wbl/programs/${programId}/classes`, token: teacherToken }),
            chrome.runtime.sendMessage({ type: 'KENKEN_FETCH', url: `${serverUrl}/api/teacher/classes`, token: teacherToken }),
        ]);
        if (!wblClassesResp.ok || !allClassesResp.ok) { setPS('Could not load linked classes from DobbsCore.', '#dc2626'); return; }
        if (!wblClassesResp.data.length) { setPS('This program has no linked classes yet.', '#dc2626'); return; }

        const sectionByClassId = {};
        for (const c of allClassesResp.data) sectionByClassId[c.id] = c.ps_section_id;

        const allCached = await chrome.storage.local.get(null);
        let totalImported = 0, totalUnmatched = 0, classesSynced = 0;

        for (const cls of wblClassesResp.data) {
            const psSectionId = sectionByClassId[cls.id];
            if (!psSectionId) continue;   // no PS section linked to this class

            setPS(`Matching ${cls.name}...`);

            // Same section-id-mismatch fallback the old single-date pull used:
            // PS uses different sectionId values in gradebook vs attendance
            // URLs, so verify by student DCID overlap rather than trusting
            // the cache key alone.
            let cache = allCached[`att_${psSectionId}`];
            if (!cache) {
                const classResp = await chrome.runtime.sendMessage({
                    type: 'KENKEN_FETCH', url: `${serverUrl}/api/teacher/classes/${cls.id}`, token: teacherToken
                });
                if (classResp.ok) {
                    const knownDcids = new Set(classResp.data.students.map(s => String(s.ps_dcid)).filter(Boolean));
                    const match = Object.entries(allCached)
                        .filter(([k]) => k.startsWith('att_'))
                        .sort((a, b) => (b[1].cachedAt ?? 0) - (a[1].cachedAt ?? 0))
                        .find(([, v]) => (v.studentIds?.[0] ?? []).some(id => knownDcids.has(String(id))));
                    if (match) cache = match[1];
                }
            }
            if (!cache) {
                setPS(`No cached attendance for ${cls.name} — open the PS attendance page for it first.`, '#dc2626');
                continue;
            }

            const studentDcids = cache.studentIds?.[0];
            const dates        = cache.dates?.[0];
            const attData      = cache.attData?.[0];
            if (!studentDcids || !dates || !attData) continue;

            // dates (sec_att_date_arr) is already meeting-days-only — a date
            // absent from it never appears here, so there's nothing to filter.
            const rows = [];
            studentDcids.forEach((dcid, sIdx) => {
                dates.forEach((mdDate, dIdx) => {
                    const code = attData[sIdx]?.[dIdx]?.[0]?.[3]?.[1] ?? '';
                    rows.push({ ps_dcid: dcid, date: mdToIso(mdDate), code });
                });
            });
            if (!rows.length) continue;

            const importResp = await chrome.runtime.sendMessage({
                type: 'KENKEN_FETCH', method: 'POST',
                url: `${serverUrl}/api/wbl/classes/${cls.id}/attendance/import`,
                token: teacherToken, body: { rows },
            });
            if (importResp.ok) {
                totalImported += importResp.data.imported;
                totalUnmatched += importResp.data.unmatched.length;
                classesSynced++;
            } else {
                console.error('[Sync Attendance]', cls.name, importResp.error || importResp.status);
            }
        }

        setPS(
            classesSynced > 0
                ? `Synced ${totalImported} record${totalImported !== 1 ? 's' : ''} across ${classesSynced} class${classesSynced !== 1 ? 'es' : ''}`
                  + (totalUnmatched ? `, ${totalUnmatched} unmatched (no ps_dcid on record).` : '.')
                : 'Nothing synced — open the PS attendance page for a linked class first.',
            classesSynced > 0 ? '#16a34a' : '#dc2626'
        );
    } catch (err) {
        setPS(`Error: ${err.message}`, '#dc2626');
        console.error('[Sync Attendance]', err);
    } finally {
        btn.disabled = false; btn.textContent = '⟳ Sync Attendance from PS';
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
