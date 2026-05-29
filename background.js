// Service worker — proxies requests to the KenKen server.
// Content scripts can't make cross-origin fetches without CORS headers,
// but service workers with host_permissions can.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== 'KENKEN_FETCH') return;

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

    return true; // keep message channel open for async response
});
