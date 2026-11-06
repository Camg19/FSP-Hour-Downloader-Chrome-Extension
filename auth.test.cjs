const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function checkPopup({ token = null, coreToken = token, subscriptionKey = 'test-subscription', environment = 'production', response, url = 'https://app.flightschedulepro.com/App/' } = {}) {
    const elements = new Map();
    const removed = [];
    const context = vm.createContext({
        console: { log() {}, error() {} },
        document: {
            getElementById(id) {
                if (!elements.has(id)) elements.set(id, { style: {}, addEventListener() {}, appendChild() {} });
                return elements.get(id);
            },
            addEventListener() {},
            createElement() { return {}; }
        },
        chrome: {
            tabs: { query: async () => [{ url }] },
            storage: {
                session: { get: async key => ({ [key]: key.startsWith('fspRequestHeaders:')
                    ? (coreToken ? { authorization: coreToken, 'x-subscription-key': subscriptionKey, 'x-fsp-environment': environment } : null)
                    : token }), remove: async key => removed.push(key) },
                onChanged: { addListener() {} }
            }
        },
        fetch: async (requestUrl, options) => {
            assert.equal(requestUrl, 'https://usc-api.flightschedulepro.com/core-app/api/V1/myoperators');
            assert.equal(options.headers['x-subscription-key'], subscriptionKey);
            assert.equal(options.headers['x-fsp-environment'], environment);
            assert.ok(subscriptionKey && environment, 'Incomplete context must not trigger a request');
            const expectedToken = requestUrl.includes('usc-api') ? coreToken : token;
            assert.equal(options.headers.Authorization, expectedToken, 'Token must match the destination API');
            assert.ok(expectedToken, 'Missing session must not trigger an API request');
            return response;
        }
    });
    vm.runInContext(fs.readFileSync('popup.js', 'utf8'), context);
    await vm.runInContext('runInitialChecks()', context);
    return { text: elements.get('connectionText').textContent, disabled: elements.get('downloadButton').disabled, removed };
}

(async () => {
    let result = await checkPopup();
    assert.equal(result.disabled, true);
    assert.match(result.text, /Refresh FSP/);
    result = await checkPopup({ token: 'test-session', response: { ok: true, status: 200, json: async () => ({ companies: [{ name: 'Test operator', id: '123' }] }) } });
    assert.equal(result.disabled, false);
    assert.match(result.text, /Connected/);
    result = await checkPopup({ token: 'expired', response: { ok: false, status: 401 } });
    assert.equal(result.disabled, true);
    assert.match(result.text, /rejected/);
    assert.deepEqual(result.removed, []);
    result = await checkPopup({ token: 'test-session', response: { ok: false, status: 500 } });
    assert.equal(result.disabled, true);
    result = await checkPopup({ token: 'legacy-token', coreToken: 'core-token', response: { ok: true, status: 200, json: async () => ({ companies: [] }) } });
    assert.equal(result.disabled, false);
    result = await checkPopup({ token: 'legacy-token', coreToken: 'core-token', response: { ok: false, status: 401 } });
    assert.equal(result.disabled, true);
    result = await checkPopup({ token: 'valid-token', subscriptionKey: null });
    assert.equal(result.disabled, true);
    assert.match(result.text, /Refresh FSP/);
    result = await checkPopup({ token: 'valid-token', environment: null });
    assert.equal(result.disabled, true);
    result = await checkPopup({ url: 'https://example.com/' });
    assert.equal(result.disabled, true);

    let listener;
    const saved = [];
    vm.runInNewContext(fs.readFileSync('service_worker.js', 'utf8'), {
        chrome: {
            webRequest: { onBeforeSendHeaders: { addListener(callback, filter) {
                listener = callback;
                assert.ok(filter.urls.includes('https://usc-api.flightschedulepro.com/*'));
            } } },
            storage: { session: { set: async value => saved.push(value) } }
        }, console, URL
    });
    listener({ url: 'https://usc-api.flightschedulepro.com/core-app/api/V1/myoperators', tabId: 1, initiator: 'https://app.flightschedulepro.com', requestHeaders: [{ name: 'Authorization', value: 'Bearer test-session' }, { name: 'X-Subscription-Key', value: 'test-subscription' }, { name: 'X-FSP-Environment', value: 'production' }, { name: 'Cookie', value: 'must-not-save' }] });
    listener({ tabId: -1, initiator: 'chrome-extension://test', requestHeaders: [{ name: 'Authorization', value: 'extension-request' }] });
    listener({ url: 'https://usc-api.flightschedulepro.com/core-app/api/V1/myoperators', tabId: 1, initiator: 'https://app.flightschedulepro.com', requestHeaders: [] });
    assert.equal(saved.length, 1);
    assert.equal(saved[0]['fspAuthorization:https://usc-api.flightschedulepro.com'], 'Bearer test-session');
    assert.equal(saved[0].fspAuthorization, undefined);
    const captured = saved[0]['fspRequestHeaders:https://usc-api.flightschedulepro.com'];
    assert.equal(captured.authorization, 'Bearer test-session');
    assert.equal(captured['x-subscription-key'], 'test-subscription');
    assert.equal(captured['x-fsp-environment'], 'production');
    assert.equal(captured.cookie, undefined);
    assert.equal(Object.keys(captured).length, 3);
    console.log('Passed: full operator request headers, missing headers, rejected sessions, API failure, wrong tab, and capture allowlist.');
})().catch(error => { console.error(error); process.exitCode = 1; });
