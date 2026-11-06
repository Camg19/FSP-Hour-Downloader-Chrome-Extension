const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const requests = [];
let response = { ok: true, status: 200, json: async () => ({ results: [] }) };
const headers = { Authorization: 'test-token', 'x-subscription-key': 'test-key', 'x-fsp-environment': 'production', Accept: 'application/json, text/plain, */*' };
class WinterDate extends Date { getTimezoneOffset() { return 300; } }
const context = vm.createContext({
    console, URLSearchParams, Date: WinterDate,
    document: { getElementById: () => ({ addEventListener() {}, style: {} }), addEventListener() {} },
    chrome: { storage: { onChanged: { addListener() {} } } },
    fetch: async (url, options) => { requests.push({ url, options }); return response; }
});
vm.runInContext(fs.readFileSync('popup.js', 'utf8'), context);
context.testHeaders = headers;
(async () => {
    await vm.runInContext("getReservations(testHeaders, '165587')", context);
    let request = requests.at(-1);
    const url = new URL(request.url);
    assert.equal(url.origin + url.pathname, 'https://usc-api.flightschedulepro.com/core-app/api/V2/Reservation');
    assert.equal(url.search, '?dateTypeFilter=2&operatorId=165587&pageIndex=0&pageSize=25&timeZoneBias=-300');
    assert.equal(request.options.method, 'GET');
    assert.deepEqual(request.options.headers, headers);
    await vm.runInContext("getReservations(testHeaders, '165587', 2, 50)", context);
    assert.equal(new URL(requests.at(-1).url).searchParams.get('pageIndex'), '2');
    assert.equal(new URL(requests.at(-1).url).searchParams.get('pageSize'), '50');
    class SummerDate extends Date { getTimezoneOffset() { return 240; } }
    context.Date = SummerDate;
    await vm.runInContext("getReservations(testHeaders, '165587')", context);
    assert.equal(new URL(requests.at(-1).url).searchParams.get('timeZoneBias'), '-240');
    for (const status of [401, 403, 500]) {
        response = { ok: false, status, json: async () => { throw new Error('Must not parse failed response'); } };
        await assert.rejects(vm.runInContext("getReservations(testHeaders, '165587')", context), /FSP|reservations/);
    }
    response = { ok: true, json: async () => ({ changedShape: [] }) };
    await assert.rejects(vm.runInContext("getReservations(testHeaders, '165587')", context), /unexpected reservations format/);

    // Match the Settings name against instructor or combined pilot name, regardless of role flags.
    vm.runInContext(`
        globalThis.originalCreateFlightObjs = createFlightObjs;
        globalThis.sample = { reservationId: 'sample-id', start: '2026-11-05T14:00:00', end: '2026-11-05T16:25:00',
            instructor: 'Cameron Thomas Morley', pilotFirstName: 'Battu', pilotLastName: 'Sai Deepak ',
            isPilot: false, isInstructor: true, resource: 'N557ND' };
    `, context);
    assert.equal(vm.runInContext("createFlightObjs({ results: [sample] }, null, true, 'Different saved name')[0].length", context), 0);
    assert.equal(vm.runInContext("createFlightObjs({ results: [{ ...sample, isInstructor: false }] }, null, true, 'Cameron Thomas Morley')[0].length", context), 1);
    assert.equal(vm.runInContext("createFlightObjs({ results: [sample] }, '2026-11-06', true, 'Different saved name')[0].length", context), 0);
    assert.equal(vm.runInContext("createFlightObjs({ results: [sample] }, '2026-11-05', true, 'Cameron Thomas Morley')[0].length", context), 1);
    assert.equal(vm.runInContext("createFlightObjs({ results: [{ ...sample, isPilot: undefined, isInstructor: undefined }] }, null, true, '  cameron  thomas morley  ')[0].length", context), 1);
    assert.throws(() => vm.runInContext("createFlightObjs({ results: [{ ...sample, start: undefined }] }, '2026-11-05', true, 'Different saved name')", context), /valid start date/);

    assert.equal(vm.runInContext("createFlightObjs({ results: [sample] }, null, true, '  BATTU  Sai Deepak ')[0].length", context), 1);
    // A page with no matching pilot must not stop pagination.
    vm.runInContext(`
        globalThis.pages = [];
        globalThis.cutoffs = [];
        getFSPCoreHeaders = async () => testHeaders;
        loadSettings = async () => ({ username: 'Test Pilot' });
        updateProgress = () => {};
        getReservations = async (headers, operator, index) => {
            pages.push(index);
            return { results: index < 2 ? [{}] : [] };
        };
        createFlightObjs = (data, cutoff) => { cutoffs.push(cutoff); return [[], false]; };
        writeFlightsToCSV = async () => {};
        chrome.runtime = { getURL: path => path };
    `, context);
    await assert.rejects(vm.runInContext("startDownload(true, '2026-01-01', '165587')", context), /No matching reservations/);
    assert.deepEqual(Array.from(context.pages), [0, 1, 2]);
    assert.deepEqual(Array.from(context.cutoffs), [null, null, null]);
    context.pages.length = 0;
    context.cutoffs.length = 0;
    await assert.rejects(vm.runInContext("startDownload(false, '2026-01-01', '165587')", context), /No matching reservations/);
    assert.deepEqual(Array.from(context.cutoffs), ['2026-01-01', '2026-01-01', '2026-01-01']);
    // Exercise the real filter through the download loop, including normalized page indexes.
    vm.runInContext(`
        loadSettings = async () => ({ username: 'Cameron Thomas Morley' });
        pages = [];
        globalThis.processed = [];
        globalThis.exports = 0;
        createFlightObjs = originalCreateFlightObjs;
        getReservations = async (headers, operator, index) => {
            pages.push(index);
            return index === 0
                ? { results: [{ ...sample, instructor: 'Another Instructor' }], pageIndex: 1, total: 2 }
                : { results: [sample], pageIndex: 2, total: 2 };
        };
        Flight.prototype.runAll = async function() {
            processed.push(this.resId);
            this.dataRow = { TotalTime: 1, SimulatedFlight: 0 };
        };
        writeFlightsToCSV = async rows => { exports++; if (rows.length !== 1) throw Error('Expected one flight'); };
    `, context);
    await vm.runInContext("startDownload(true, '', '165587')", context);
    assert.deepEqual(Array.from(context.pages), [0, 2]);
    assert.deepEqual(Array.from(context.processed), ['sample-id']);
    assert.equal(context.exports, 1);
    // Stop paging at the cutoff, include the entire selected day, and do not
    // download details for older reservations (even if their name differs).
    vm.runInContext(`
        pages = [];
        processed = [];
        getReservations = async (headers, operator, index) => {
            pages.push(index);
            if (index !== 0) throw Error('Must stop before requesting older pages');
            return { pageIndex: 1, total: 1519, results: [
                { ...sample, reservationId: 'newer', start: '2026-11-05T14:00:00' },
                { ...sample, reservationId: 'cutoff', start: '2026-10-25T00:00:00' },
                { ...sample, reservationId: 'older', start: '2026-10-24T23:59:59', instructor: 'Another Instructor' }
            ] };
        };
        writeFlightsToCSV = async rows => { if (rows.length !== 2) throw Error('Expected two eligible flights'); };
    `, context);
    await vm.runInContext("startDownload(false, '2026-10-25', '165587')", context);
    assert.deepEqual(Array.from(context.pages), [0]);
    assert.deepEqual(Array.from(context.processed), ['newer', 'cutoff']);
    assert.equal(vm.runInContext("createFlightObjs({ results: [{ ...sample, start: '2026-10-24T23:59:59' }] }, '2026-10-25', true, 'Cameron Thomas Morley')[1]", context), true);
    assert.equal(vm.runInContext("createFlightObjs({ results: [{ ...sample, start: '2026-10-24T23:59:59' }] }, null, true, 'Cameron Thomas Morley')[1]", context), false);
    console.log('Passed: instructor and pilot name matching, date filtering, processing/export, normalized pages, reservations endpoint, headers, zero-based paging, timezone, errors, response validation, and download pagination.');
})().catch(error => { console.error(error); process.exitCode = 1; });
