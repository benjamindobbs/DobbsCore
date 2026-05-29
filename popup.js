'use strict';

const serverUrlInput   = document.getElementById('serverUrl');
const teacherTokenInput = document.getElementById('teacherToken');
const saveBtn          = document.getElementById('save');
const statusEl         = document.getElementById('status');

// Load saved values
chrome.storage.sync.get(['serverUrl', 'teacherToken'], ({ serverUrl, teacherToken }) => {
    if (serverUrl)    serverUrlInput.value    = serverUrl;
    if (teacherToken) teacherTokenInput.value = teacherToken;
});

saveBtn.onclick = () => {
    const serverUrl    = serverUrlInput.value.trim().replace(/\/$/, '');
    const teacherToken = teacherTokenInput.value.trim();

    if (!serverUrl) {
        statusEl.textContent = 'Server URL is required.';
        statusEl.style.color = '#dc2626';
        return;
    }

    chrome.storage.sync.set({ serverUrl, teacherToken }, () => {
        statusEl.textContent = 'Saved.';
        statusEl.style.color = '#16a34a';
        setTimeout(() => { statusEl.textContent = ''; }, 1500);
    });
};
