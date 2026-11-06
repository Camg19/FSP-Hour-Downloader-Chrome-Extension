const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const headers = { Authorization: 'Bearer test-token', 'x-subscription-key': 'test-key', 'x-fsp-environment': 'production', Accept: 'application/json, text/plain, */*' };
const payload = { toAirportId: 'KJFK', fromAirportId: 'KBOS', viaAirportIds: ['KPVD'], trainingSessionTimesSummary: { totalXC: 1.2, totalNight: 0.4, instrumentActual: 0.2, totalSim: 0.1 } };
let response = { ok: true, status: 200, json: async () => payload };
const requests = [];
const context = vm.createContext({ console: { log() {} }, URLSearchParams, testHeaders: headers,
    document: { getElementById: () => ({ addEventListener() {}, style: {} }), addEventListener() {} },
    chrome: { storage: { onChanged: { addListener() {} } } },
    fetch: async (url, options) => { requests.push({ url, options }); return response; }
});
vm.runInContext(fs.readFileSync('popup.js', 'utf8'), context);
(async () => {
    const result = await vm.runInContext("getSession(testHeaders, 'session-id', '165587')", context);
    assert.equal(result, payload);
    assert.equal(requests[0].url, 'https://usc-api.flightschedulepro.com/curriculum-app/api/v1/trainingsessions/session-id?operatorId=165587&readOnly=true');
    assert.equal(requests[0].options.method, 'GET');
    assert.deepEqual(requests[0].options.headers, headers);
    vm.runInContext(`
        getReservation = async () => ({ flightData: { hobbsTotalTime: 1.5 }, trainingSessions: [{ sessionId: 'session-one' }, { sessionId: 'session-two' }] });
        globalThis.flight = new Flight('N123', 'reservation-id');
    `, context);
    await vm.runInContext("flight.runAll(testHeaders, '165587', 'pic')", context);
    assert.equal(requests.length, 3);
    assert.equal(context.flight.xc, 2.4);
    assert.equal(context.flight.night, 0.8);
    assert.equal(context.flight.instruent, 0.4);
    assert.equal(context.flight.simulationTime, 0.2);
    assert.equal(context.flight.toA, 'KJFK');
    assert.equal(context.flight.dataRow.CrossCountry, 2.4);
    for (const status of [401, 403, 404, 500]) {
        response = { ok: false, status, json: async () => { throw Error('Must not parse failed response'); } };
        await assert.rejects(vm.runInContext("getSession(testHeaders, 'session-id', '165587')", context), /FSP/);
    }
    vm.runInContext("globalThis.failedFlight = new Flight('N123', 'reservation-id')", context);
    await assert.rejects(vm.runInContext("failedFlight.runAll(testHeaders, '165587', 'pic')", context), /FSP/);
    assert.equal(context.failedFlight.dataRow, undefined);
    for (const invalid of [null, [], 'invalid']) {
        response = { ok: true, json: async () => invalid };
        await assert.rejects(vm.runInContext("getSession(testHeaders, 'session-id', '165587')", context), /unexpected/);
    }
    console.log('Passed: curriculum endpoint, full Bearer headers, training time aggregation, failed export propagation, and response validation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
