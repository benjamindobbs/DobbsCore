'use strict';

const BTN_ID        = 'ck-sync-btn';
const IMPORT_BTN_ID = 'ck-import-btn';
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

    const isRegistered = resp.data.some(c => String(c.ps_section_id) === String(ctx.sectionId));
    if (isRegistered) {
        makeBtn(BTN_ID, 'Create DobbsCore Assignment', '24px', '#2563eb', () => showCreatePanel(ctx));
    } else {
        makeBtn(IMPORT_BTN_ID, 'Import Roster to DobbsCore', '24px', '#059669', () => showImportPanel(ctx));
    }
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
        const createResp = await fetch('/ws/xte/section/assignment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json;charset=UTF-8' },
            body: JSON.stringify({
                standardcalcdirection:  'NONE',
                standardscoringmethod:  'GradeScale',
                yearid,
                _assignmentsections: [{
                    description:              '',
                    duedate,
                    dueDateObj,
                    extracreditpoints:        0,
                    iscountedinfinalgrade:    true,
                    isscorespublish:          true,
                    isscoringneeded:          true,
                    maxretakeallowed:         0,
                    name,
                    pointspossible:           points,
                    publishdaysbeforedue:     0,
                    publishonspecificdate:    duedate,
                    publishOnSpecificDateObj: dueDateObj,
                    publishoption:            'Immediately',
                    relatedgradescaleitemdcid: null,
                    scoreentrypoints:         points,
                    scoretype:                'POINTS',
                    sectionsdcid:             Number(ctx.sectionId),
                    selectedOnlineWorkType:   { id: 'Assignment', name: 'Learning Assignment', plugin: 'com.powerschool.lms', disabled: false },
                    selectedPublishOption:    { label: 'Immediately', value: 'Immediately' },
                    selectedScoreType:        { label: 'Points', value: 'POINTS' },
                    totalpointvalue:          points,
                    weight:                   1,
                    yearid,
                    _assignmentcategoryassociations: [{ teachercategoryid, isprimary: true }],
                    _assignmentstandardassociations: []
                }]
            })
        });

        if (!createResp.ok) {
            const errText = await createResp.text();
            throw new Error(`Assignment creation failed (${createResp.status}): ${errText}`);
        }

        const location         = createResp.headers.get('Location') || '';
        const assignmentId     = location.split('/').pop();
        const sectionIdsRaw    = createResp.headers.get('AssignmentSectionIds') || '[]';
        const assignmentsectionid = JSON.parse(sectionIdsRaw)[0];

        if (!assignmentId || !assignmentsectionid) {
            throw new Error('Assignment created but IDs missing from response headers.');
        }

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
        scores.push({
            studentsdcid:              dcid,
            actualscoreentered:        String(pointValue),
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
        });
    }

    if (scores.length === 0) {
        if (unmatched.length > 0)
            throw new Error(`No ID matches found. Unmatched: ${unmatched.join(', ')}`);
        throw new Error('No grades to submit for the selected date range.');
    }

    setStatus(`Submitting ${scores.length} grades…`);
    const submitResp = await fetch('/ws/xte/score?push_assignment_scores=false&status=A,I,P', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json;charset=UTF-8' },
        body: JSON.stringify({ assignment_scores: scores })
    });
    if (!submitResp.ok) {
        const errText = await submitResp.text();
        throw new Error(`PS returned ${submitResp.status}: ${errText}`);
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
        student_name: s.lastfirst
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

// ── Navigation detection ──────────────────────────────────────────────────────

function handleNavigation() {
    removeUI();
    const ctx = getPageContext();
    if (ctx) injectButton(ctx);
}

window.addEventListener('hashchange', handleNavigation);
handleNavigation();
