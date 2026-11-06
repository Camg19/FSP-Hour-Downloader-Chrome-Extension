const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const storage = {};
let listener;
let response = { ok: true, status: 200, json: async () => ({ flightData: { hobbsTotalTime: 1.2 }, trainingSessions: [] }) };
const requests = [];
const chrome = {
    storage: { session: { set: async values => Object.assign(storage, values), get: async key => ({ [key]: storage[key] }) }, onChanged: { addListener() {} } },
    webRequest: { onBeforeSendHeaders: { addListener(callback) { listener = callback; } } }
};
vm.runInNewContext(fs.readFileSync('service_worker.js', 'utf8'), { chrome, URL, console });
const origin = 'https://usc-api.flightschedulepro.com';
const detailKey = `fspRequestHeaders:${origin}:reservation-detail`;
function capture(path, authorization, extra = []) {
    listener({ tabId: 1, initiator: 'https://app.flightschedulepro.com', url: origin + path,
        requestHeaders: [{ name: 'Authorization', value: authorization }, { name: 'X-Subscription-Key', value: 'test-subscription' }, { name: 'X-FSP-Environment', value: 'production' }, ...extra] });
}
const context = vm.createContext({ chrome, console, URLSearchParams,
    document: { getElementById: () => ({ addEventListener() {}, style: {} }), addEventListener() {} },
    fetch: async (url, options) => { requests.push({ url, options }); return response; }
});
vm.runInContext(fs.readFileSync('popup.js', 'utf8'), context);
(async () => {
    capture('/core-app/api/V1/myoperators', 'Bearer list-token');
    await vm.runInContext("getReservation('test-id', '165587')", context);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options.headers.Authorization, 'Basic list-token');
    assert.ok(requests[0].options.headers['x-fsp-apikey']);
    requests.length = 0;
    capture('/core-app/api/V2/Reservation/test-id', 'Basic detail-token', [{ name: 'X-FSP-ApiKey', value: 'test-api-key' }, { name: 'Cookie', value: 'excluded' }]);
    assert.equal(storage[`fspRequestHeaders:${origin}`].authorization, 'Bearer list-token');
    assert.equal(storage[detailKey].authorization, 'Basic detail-token');
    assert.equal(storage[detailKey].cookie, undefined);
    const data = await vm.runInContext("getReservation('test-id', '165587')", context);
    assert.equal(data.flightData.hobbsTotalTime, 1.2);
    assert.equal(requests[0].url, origin + '/core-app/api/V2/Reservation/test-id?operatorId=165587');
    assert.equal(requests[0].options.method, 'GET');
    const headers = requests[0].options.headers;
    assert.equal(headers.Authorization, 'Basic list-token');
    assert.equal(headers['x-fsp-apikey'], 'test-api-key');
    assert.equal(headers['x-subscription-key'], 'test-subscription');
    assert.equal(headers['x-fsp-environment'], 'production');
    capture('/core-app/api/V1/myoperators', 'Bearer refreshed-list-token');
    assert.equal(storage[detailKey].authorization, 'Basic detail-token');
    for (const status of [401, 403, 404, 500]) {
        response = { ok: false, status, json: async () => { throw Error('Must not parse failed response'); } };
        await assert.rejects(vm.runInContext("getReservation('test-id', '165587')", context), /FSP/);
    }
    response = { ok: true, json: async () => null };
    await assert.rejects(vm.runInContext("getReservation('test-id', '165587')", context), /unexpected/);
    delete storage[detailKey]['x-fsp-apikey'];
    response = { ok: true, status: 200, json: async () => ({ flightData: {} }) };
    await vm.runInContext("getReservation('test-id', '165587')", context);
    assert.equal(requests.at(-1).options.headers.Authorization, 'Basic refreshed-list-token');
    delete storage[`fspRequestHeaders:${origin}`];
    await assert.rejects(vm.runInContext("getReservation('test-id', '165587')", context), /Refresh your signed-in/);
    console.log('Passed: detail endpoint and headers, separate Basic/Bearer capture, automatic details from list session, token refresh, and failed responses.');
})().catch(error => { console.error(error); process.exitCode = 1; });
