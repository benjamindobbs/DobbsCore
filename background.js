// Service worker — proxies requests to the KenKen server.
// Content scripts can't make cross-origin fetches without CORS headers,
// but service workers with host_permissions can.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    // DobbsCore API fetch — Bearer token auth, JSON response
    if (msg.type === 'KENKEN_FETCH') {
        fetch(msg.url, {
            method: msg.method || 'GET',
            headers: {
                'Authorization': `Bearer ${msg.token}`,
                'Content-Type': 'application/json'
            },
            body: msg.body ? JSON.stringify(msg.body) : undefined
        })
        .then(async r => {
            if (!r.ok) {
                const text = await r.text();
                return sendResponse({ ok: false, status: r.status, error: text });
            }
            const data = await r.json();
            sendResponse({ ok: true, data });
        })
        .catch(err => sendResponse({ ok: false, error: err.message }));
        return true;
    }

    // Read PS attendance window-scope variables from the sender tab.
    // chrome.scripting.executeScript is not subject to the page's CSP.
    if (msg.type === 'READ_ATT_VARS') {
        (async () => {
            try {
                const results = await chrome.scripting.executeScript({
                    target: { tabId: _sender.tab.id },
                    world: 'MAIN',
                    func: () => {
                        if (typeof sec_cls_att_arr === 'undefined')
                            return { ok: false, error: 'PS attendance variables not found on this page.' };
                        // Use the sectionId URL param — this matches what DobbsCore stores as ps_section_id
                        // (sectionMap[0] is a different internal PS identifier)
                        const sectionId = new URLSearchParams(window.location.search).get('sectionId')
                            || (typeof sectionMap !== 'undefined' && sectionMap[0])
                            || null;
                        return {
                            ok: true,
                            sectionId,
                            studentIds: sec_cls_stud_id_arr,
                            dates:     sec_att_date_arr,
                            attData:   sec_cls_att_arr
                        };
                    }
                });
                sendResponse(results[0]?.result ?? { ok: false, error: 'No result from executeScript.' });
            } catch (err) {
                sendResponse({ ok: false, error: err.message });
            }
        })();
        return true;
    }

    // PowerSchool fetch — executes inside an open PS tab so the request is
    // same-origin and session cookies are included automatically.
    if (msg.type === 'PS_FETCH') {
        (async () => {
            try {
                const psTabs = await chrome.tabs.query({
                    url: 'https://hartford.powerschool.com/teachers/*'
                });
                if (!psTabs.length) {
                    sendResponse({ ok: false, error: 'No PowerSchool tab open. Please open PowerSchool first.' });
                    return;
                }
                const results = await chrome.scripting.executeScript({
                    target: { tabId: psTabs[0].id },
                    func: async (url, method, body) => {
                        const r = await fetch(url, {
                            method: method || 'GET',
                            headers: body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {},
                            body: body || undefined
                        });
                        return { ok: r.ok, status: r.status, text: await r.text() };
                    },
                    args: [msg.url, msg.method || 'GET', msg.body || null]
                });
                sendResponse(results[0]?.result ?? { ok: false, error: 'No result from PS tab.' });
            } catch (err) {
                sendResponse({ ok: false, error: err.message });
            }
        })();
        return true;
    }
});
