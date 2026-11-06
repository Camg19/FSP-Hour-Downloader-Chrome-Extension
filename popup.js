const settingsButton = document.getElementById("settingsButton");
const operatorSelect = document.getElementById("operator");
const startDate = document.getElementById("startDate");
const getAllData = document.getElementById("getAllData");
const downloadButton = document.getElementById("downloadButton");
const status = document.getElementById("status");
const connectionText = document.getElementById("connectionText");
const statusDot = document.getElementById("statusDot");
const progressContainer = document.getElementById("progressContainer");
const progressBar = document.getElementById("progressBar");
const progressPercent = document.getElementById("progressPercent");
const progressText = document.getElementById("progressText");
const progressDetail = document.getElementById("progressDetail");
let operators = {};
let date = null;

document.addEventListener("DOMContentLoaded", async () => {
    console.log("Extension popup opened");
    await runInitialChecks();
});

settingsButton.addEventListener("click", () => {
    window.location.href = "settings.html";
});

getAllData.addEventListener("change", () => {
    startDate.disabled = getAllData.checked;

    if (getAllData.checked) {
        startDate.value = "";
    }
});

function setConnectionStatus(message, color, enabled) {
    connectionText.textContent = message;
    statusDot.style.background = color;
    downloadButton.disabled = !enabled;
}

async function runInitialChecks() {
    setConnectionStatus("Checking Flight Schedule Pro session...", "#f59e0b", false);
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.url) {
            setConnectionStatus("Unable to determine current tab", "#ef4444", false);
            return;
        }
        if (!tab.url.startsWith("https://app.flightschedulepro.com/")) {
            setConnectionStatus("Open Flight Schedule Pro and sign in", "#ef4444", false);
            return;
        }
        const headers = await getFSPCoreHeaders();
        if (!headers) {
            setConnectionStatus("Refresh FSP, then reopen this extension", "#f59e0b", false);
            return;
        }
        operators = await getOperators(headers);
        populateOperatorSelect(operators);
        setConnectionStatus("Connected to Flight Schedule Pro", "#22c55e", true);
    } catch (error) {
        console.error("Unable to connect to FSP:", error);
        setConnectionStatus(
            error.message === "FSP authorization rejected."
                ? "FSP rejected the API session. Refresh FSP and reopen this extension"
                : "Unable to load FSP operators. Refresh FSP and try again",
            "#ef4444", false
        );
    }
}

// Capture a session arriving while the popup is already open.
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "session" && Object.entries(changes).some(([key, change]) => key.startsWith("fspRequestHeaders:") && change.newValue)) {
        void runInitialChecks();
    }
});

function populateOperatorSelect(operatorDict) {

    // Clear old options
    operatorSelect.innerHTML = "";


    // Default option
    const defaultOption =
        document.createElement("option");

    defaultOption.value = "";
    defaultOption.textContent =
        "Select an operator";

    defaultOption.disabled = true;
    defaultOption.selected = true;

    operatorSelect.appendChild(
        defaultOption
    );


    // Add operators
    for (
        const [companyName, companyId]
        of Object.entries(operatorDict)
    ) {

        const option =
            document.createElement("option");


        option.value = companyId;
        option.textContent = companyName;


        operatorSelect.appendChild(
            option
        );

    }
}

downloadButton.addEventListener("click", async () => {

    status.textContent = "";

    const allData = getAllData.checked;
    const date = startDate.value;

    const operatorId = operatorSelect.value;

    const operatorName =
        operatorSelect.options[
        operatorSelect.selectedIndex
        ]?.text;

    if (!operatorId) {
        status.textContent =
            "Please select an operator.";
            return;
        }

    

    //Validate Settings
    if (!allData && !date) {
        status.textContent =
            "Please select a date or choose Get All Data.";
        return;
    }

    status.textContent = "Downloading flight data...";

    //Check Current Tab
    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    //Uable to find current Tab
    if (!tab || !tab.url) {
        status.textContent =
            "Unable to determine the current browser tab.";
        return;
    }

    //Check if on FSP
    const validFSPUrl =
        tab.url.startsWith(
            "https://app.flightschedulepro.com/"
        );

    //Error Handeling
    if (!validFSPUrl) {
        status.textContent =
            "Open Flight Schedule Pro before downloading hours.";
        return;
    }

    //Start Download
    try {
        await startDownload(
            allData,
            date, 
            operatorId
        );

    }
    catch (error) {

        console.error(error);

        status.textContent =
            error.message || "Unable to download FSP data.";
    }

});

async function getFSPCoreHeaders() {
    const key = "fspRequestHeaders:https://usc-api.flightschedulepro.com";
    const result = await chrome.storage.session.get(key);
    const headers = result[key];
    if (!headers?.authorization || !headers["x-subscription-key"] || !headers["x-fsp-environment"]) {
        return null;
    }
    return {
        "Authorization": headers.authorization,
        "x-subscription-key": headers["x-subscription-key"],
        "x-fsp-environment": headers["x-fsp-environment"],
        "Accept": "application/json, text/plain, */*"
    };
}

async function loadSettings() {
    const settings = await chrome.storage.local.get([
        "username",
        "includeSimulator",
        "includeGbs",
        "flightLogMode"
    ]);

    return {
        username: settings.username ?? "",
        includeSimulator: settings.includeSimulator ?? false,
        includeGbs: settings.includeGbs ?? false,
        flightLogMode: settings.flightLogMode ?? "logDualGivenPIC"
    };
}

function updateProgress(percent, message) {

    progressContainer.style.display = "block";

    progressBar.style.width =
        `${percent}%`;

    progressPercent.textContent =
        `${Math.round(percent)}%`;

    if (message) {
        progressDetail.textContent = message;
    }
}

async function startDownload(getAllData, startDate, operatorId) {

    const headers = await getFSPCoreHeaders();
    if (!headers) {
        throw new Error("Refresh FSP and open your reservations, then retry.");
    }
    const settings = await loadSettings();
    const cutoffDate = getAllData ? null : startDate;

    updateProgress(
        1,
        "Loading reservations..."
    );

    const events = [];
    let ind = 0;
    let reservationsRead = 0;

    while (true) {
        const reservations = await getReservations(
            headers,
            operatorId,
            ind,
            25
        );

        const [flights, isFinished] = createFlightObjs(
            reservations,
            cutoffDate,
            true,
            settings.username
        );

        events.push(...flights);
        reservationsRead += reservations.results.length;

        if (reservations.results.length === 0) {
            break;
        }

        if (isFinished) {
            break;
        }

        if (Number.isFinite(reservations.total) && reservationsRead >= reservations.total) {
            break;
        }
        // FSP can normalize a request for page 0 to page 1.
        ind = Number.isInteger(reservations.pageIndex)
            ? Math.max(ind + 1, reservations.pageIndex + 1)
            : ind + 1;
    }

    updateProgress(
        2,
        "Reservations Loaded..."
    );

    if (events.length === 0) {
        throw new Error("No matching reservations found. Check your selected operator, date range, and the name in Settings (instructor or pilot first and last name).");
    }

    const progressBarUpdateAmount = 98 / events.length
    var progressBarProgress = 2.0

    for (const event of events) {
        await event.runAll(headers, operatorId, settings.flightLogMode);
        progressBarProgress += progressBarUpdateAmount
        updateProgress(
            progressBarProgress,
            "Downloading Sessions..."
        );
    }

    const df = flightsToDataframe(events, settings.includeSimulator, settings.includeGbs);

    const templatePath = chrome.runtime.getURL(
        "logbook_template_faa.csv"
    );

    await writeFlightsToCSV(
        df,
        templatePath,
        "MyFlightbook_Import.csv"
    );

  
}

//FUNCTIONS FOR DOWNLOADING DATA
async function getOperators(headers) {
    const response = await fetch(
        "https://usc-api.flightschedulepro.com/core-app/api/V1/myoperators",
        { method: "GET", headers }
    );
    if (response.status === 401 || response.status === 403) {
        throw new Error("FSP authorization rejected.");
    }
    if (!response.ok) {
        throw new Error(`FSP returned status ${response.status}`);
    }

    const data = await response.json();

    const operatorDict = {};


    for (const company of data.companies) {

        operatorDict[company.name] =
            company.id;

    }


    console.log(
        "Operators loaded:",
        operatorDict
    );


    return operatorDict;
}

async function getReservations(headers, operatorId, pageIndex = 0, pageSize = 25) {
    const params = new URLSearchParams();
    params.append("dateTypeFilter", 2);
    params.append("operatorId", operatorId);
    params.append("pageIndex", pageIndex);
    params.append("pageSize", pageSize);
    params.append("timeZoneBias", -new Date().getTimezoneOffset());

    const response = await fetch(
        `https://usc-api.flightschedulepro.com/core-app/api/V2/Reservation?${params}`,
        { method: "GET", headers }
    );
    if (response.status === 401 || response.status === 403) {
        throw new Error("FSP rejected the reservations session. Refresh FSP and retry.");
    }
    if (!response.ok) {
        throw new Error(`Unable to load FSP reservations (status ${response.status}).`);
    }
    const data = await response.json();
    if (!Array.isArray(data?.results)) {
        throw new Error("FSP returned an unexpected reservations format.");
    }
    return data;
}

async function getReservation(resId, operatorId) {
    const coreHeaders = await getFSPCoreHeaders();
    if (!/^Bearer\s+\S+/i.test(coreHeaders?.Authorization ?? "")) {
        throw new Error("Refresh your signed-in FSP dashboard, then retry the download.");
    }
    const key = "fspRequestHeaders:https://usc-api.flightschedulepro.com:reservation-detail";
    const stored = await chrome.storage.session.get(key);
    // FSP's detail endpoint uses the same session JWT with the Basic scheme.
    // Prefer an observed API key; the default is from the supplied working FSP request.
    const apiKey = stored[key]?.["x-fsp-apikey"] ?? "cb50ceed-44de-43ad-bc24-afe2f08f15de";
    const detailHeaders = {
        ...coreHeaders,
        "Authorization": coreHeaders.Authorization.replace(/^Bearer\s+/i, "Basic "),
        "x-fsp-apikey": apiKey
    };
    const params = new URLSearchParams({ operatorId });
    const response = await fetch(
        `https://usc-api.flightschedulepro.com/core-app/api/V2/Reservation/${encodeURIComponent(resId)}?${params}`,
        {
            method: "GET",
            headers: detailHeaders
        }
    );
    if (response.status === 401 || response.status === 403) {
        throw new Error("FSP rejected the reservation-detail request. Refresh your signed-in FSP dashboard and retry.");
    }
    if (!response.ok) {
        throw new Error(`Unable to load FSP reservation ${resId} (status ${response.status}).`);
    }
    const data = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("FSP returned an unexpected reservation-detail format.");
    }
    return data;
}

async function getSession(headers, sesId, operatorId) {
    const params = new URLSearchParams({ operatorId, readOnly: "true" });
    const response = await fetch(
        `https://usc-api.flightschedulepro.com/curriculum-app/api/v1/trainingsessions/${encodeURIComponent(sesId)}?${params}`,
        { method: "GET", headers }
    );
    if (response.status === 401 || response.status === 403) {
        throw new Error("FSP rejected the training-session authorization. Refresh FSP and retry.");
    }
    if (!response.ok) {
        throw new Error(`Unable to load FSP training session ${sesId} (status ${response.status}).`);
    }
    const data = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("FSP returned an unexpected training-session format.");
    }
    return data;
}

//Flight OBJ
class Flight {
    constructor(
        aircraft,
        resId,
        student = null,
        course = null,
        lesson = null,
        startTime = null,
        endTime = null,
        instructor = null
    ) {
        this.aircraft = aircraft;
        this.time = null;
        this.resId = resId;
        this.student = student;
        this.course = course;
        this.lesson = lesson;

        this.hobbsStart = null;
        this.hobbsEnd = null;
        this.tachStart = null;
        this.tachEnd = null;

        this.startTime = startTime;
        this.endTime = endTime;
        this.instructor = instructor;

        this.toA = null;
        this.fromA = null;
        this.route = null;
        this.night = null;
        this.simulationTime = null;

        this.xc = null;
        this.instruent = null;

        this.sessionIds = [];
    }

    async getLessonData(operatorId) {
        const newData = await getReservation(this.resId, operatorId);

        this.time = newData?.flightData?.hobbsTotalTime ?? 0;

        this.hobbsStart = newData?.flightData?.hobbsIn ?? 0;
        this.hobbsEnd = newData?.flightData?.hobbsOut ?? 0;

        this.tachStart = newData?.flightData?.tach1In ?? 0;
        this.tachEnd = newData?.flightData?.tach1Out ?? 0;

        const trainingSessions = newData?.trainingSessions ?? [];

        for (const trainingSession of trainingSessions) {
            this.sessionIds.push(trainingSession.sessionId);
        }
    }

    convertTimes() {
        if (this.startTime) {
            this.startTime = new Date(this.startTime);
        }

        if (this.endTime) {
            this.endTime = new Date(this.endTime);
        }
    }

    async getSessionData(headers, operatorId) {
        let xc = 0;
        let ira = 0;
        let night = 0;
        let simulationTime = 0;

        for (const sessionId of this.sessionIds) {
            const newData = await getSession(headers, sessionId, operatorId);

            this.toA = newData?.toAirportId ?? null;
            this.fromA = newData?.fromAirportId ?? null;
            this.route = newData?.viaAirportIds ?? null;

            xc += newData?.trainingSessionTimesSummary?.totalXC ?? 0;

            night += newData?.trainingSessionTimesSummary?.totalNight ?? 0;

            ira += newData?.trainingSessionTimesSummary?.instrumentActual ?? 0;

            simulationTime += newData?.trainingSessionTimesSummary?.totalSim ?? 0;
        }

        this.xc = xc;
        this.instruent = ira;
        this.night = night;
        this.simulationTime = simulationTime
    }

    toArqueroRow(flightLogMode) {
        const comments = [];

        if (this.student) {
            comments.push(`Student: ${this.student}`);
        }

        if (this.course) {
            comments.push(`Course: ${this.course}`);
        }

        if (this.lesson) {
            comments.push(`Lesson: ${this.lesson}`);
        }

        comments.push(`FSP Reservation: ${this.resId}`);

        const formatDate = (date) => {
            if (!date) return "";

            return [
                date.getFullYear(),
                String(date.getMonth() + 1).padStart(2, "0"),
                String(date.getDate()).padStart(2, "0")
            ].join("-");
        };

        const formatTime = (date) => {
            if (!date) return "";

            return [
                String(date.getHours()).padStart(2, "0"),
                String(date.getMinutes()).padStart(2, "0")
            ].join(":");
        };

        //don't include sim time in total time
        var totalTimeVar = null;
        if (this.simulationTime > 0) {
            totalTimeVar = 0
        } else {
            totalTimeVar = this.time
        }


        var dualGivenVar = null;
        var PICVar = null;
        var dualReceivedVar = null;
        if (flightLogMode == "logDualGivenPIC") {
            console.log("Given")
            dualGivenVar = this.time
            PICVar = this.time
            dualReceivedVar = 0
        } else if (flightLogMode == "logDualReceivedPIC") {
            console.log("RecPic")
            dualGivenVar = 0
            PICVar = this.time
            dualReceivedVar = this.time
        } else if (flightLogMode == "logDualReceivedNoPIC"){
            console.log("RecNoPic")
            dualGivenVar = 0
            PICVar = 0
            dualReceivedVar = this.time
        } else if (flightLogMode == "pic"){
            console.log("Pic")
            dualGivenVar = 0
            PICVar = this.time
            dualReceivedVar = 0
        } else {
            console.log("OOPs??")
            console.log(flightLogMode)
        }



        return {
            "Date": formatDate(this.startTime),
            "AircraftID": this.aircraft,

            "From": this.fromA,
            "To": this.toA,
            "Route": this.route,

            "TimeOut": formatTime(this.startTime),
            "TimeOff": "",
            "TimeOn": "",
            "TimeIn": formatTime(this.endTime),

            "OnDuty": "",
            "OffDuty": "",

            "TotalTime": totalTimeVar,

            "PIC": PICVar,

            "SIC": "",
            "Night": this.night,
            "Solo": "",
            "CrossCountry": this.xc,
            "PICUS": "",
            "MultiPilot": "",
            "IFR": "",
            "Examiner": "",
            "NVG": "",
            "NVGOps": "",
            "Distance": "",

            "Takeoff Day": "",
            "Takeoff Night": "",
            "Landing Full-Stop Day": "",
            "Landing Full-Stop Night": "",
            "Landing Touch-and-Go Day": "",
            "Landing Touch-and-Go Night": "",

            "ActualInstrument": this.instruent,
            "SimulatedInstrument": "",
            "GroundTraining": "",
            "GroundTrainingGiven": "",

            "HobbsStart": this.hobbsStart,
            "HobbsEnd": this.hobbsEnd,
            "TachStart": this.tachStart,
            "TachEnd": this.tachEnd,

            "Holds": "",

            "Approach1": "",
            "Approach2": "",
            "Approach3": "",
            "Approach4": "",
            "Approach5": "",
            "Approach6": "",

            "DualGiven": dualGivenVar,
            "DualReceived": dualReceivedVar,
            "SimulatedFlight": this.simulationTime,

            "InstructorName": "",
            "InstructorComments": "",

            "Person1": "",
            "Person2": "",
            "Person3": "",
            "Person4": "",
            "Person5": "",
            "Person6": "",

            "PilotComments": `${this.lesson ?? ""} with ${this.student ?? ""}`,

            "Flight Review": "",
            "IPC": "",
            "Checkride": "",
            "FAA 61.58": "",
            "NVG Proficiency": "",

            "[Text]CustomFieldName": "",
            "[Numeric]CustomFieldName": "",
            "[Hours]CustomFieldName": "",
            "[Counter]CustomFieldName": "",
            "[Date]CustomFieldName": "",
            "[DateTime]CustomFieldName": "",
            "[Toggle]CustomFieldName": ""
        };
    }

    async runAll(headers, operatorId, flightLogMode) {
        this.convertTimes();
        await this.getLessonData(operatorId);
        await this.getSessionData(headers, operatorId);
        this.dataRow = this.toArqueroRow(flightLogMode);
    }
}

//Downloading Logic
function createFlightObjs(
        data,
        date = null,
        onlyIncludePilot = true,
        name = null
    ) {
        let isFinished = false;
        const flightList = [];

        const flights = data?.results;

        if (!flights) {
            return [[], isFinished];
        }

        if (flights.length === 0) {
            console.log("No flight data available");
            return [[], isFinished];
        }

        for (const flight of flights) {
            const course =
                flight?.trainingSessions?.[0]?.courseName ?? null;

            const lessonsList = flight?.trainingSessions ?? [];

            // Never turn an unknown date into an old flight and stop the download.
            const start = new Date(flight.start);
            if (date) {
                if (Number.isNaN(start.getTime())) {
                    throw new Error("FSP returned a reservation without a valid start date.");
                }
                const compareDate = date instanceof Date ? date : new Date(`${date}T00:00:00`);
                if (start < compareDate) {
                    // Reservation history is newest first; older pages cannot match.
                    isFinished = true;
                    break;
                }
            }

            if (onlyIncludePilot && name) {
                const normalizeName = value => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
                const searchName = normalizeName(name);
                const instructor = normalizeName(flight.instructor);
                const pilotName = normalizeName(`${flight.pilotFirstName ?? ""} ${flight.pilotLastName ?? ""}`);
                if (searchName !== instructor && searchName !== pilotName) continue;
            }

            // Lesson names
            const lessons = lessonsList
                .map(lesson => lesson.lessonName)
                .filter(Boolean)
                .join(" & ");

            // Create Flight object
            const newFlight = new Flight(
                flight.resource,
                flight.reservationId,
                `${flight?.pilotFirstName ?? ""} ${flight?.pilotLastName ?? ""}`.trim(),
                course,
                lessons,
                flight.start,
                flight.end,
                flight.instructor
            );

            flightList.push(newFlight);
        }

    return [flightList, isFinished];
}

function flightsToDataframe(flights, keepSim, keepGround) {
    return flights
        .map(flight => flight.dataRow)
        .filter(row => {
            if (row == null) {
                return false;
            }

            // If getting all data, remove flights with 0 time
            if (!keepSim) {
                // Remove rows with 0 total time
                if (Number(row.SimulatedFlight) > 0) {
                    return false;
                }
            }

            if (!keepGround) {
                // Remove rows with 0 total time
                if (Number(row.TotalTime) == 0 & (Number(row.SimulatedFlight) == 0)) {
                    return false;
                }
            }

            return true;
        });
}

async function writeFlightsToCSV(df, templatePath, outputName) {
    // Read template CSV
    const response = await fetch(templatePath);
    const templateText = await response.text();

    // Split into lines
    const lines = templateText.split(/\r?\n/);

    // Keep rows 1-15
    const headerRows = lines.slice(0, 15);

    // Get rows from Arquero dataframe
    const rows = df;

    // Escape values correctly for CSV
    const escapeCSV = (value) => {
        if (value === null || value === undefined) {
            return "";
        }

        const str = String(value);

        if (
            str.includes(",") ||
            str.includes('"') ||
            str.includes("\n")
        ) {
            return `"${str.replace(/"/g, '""')}"`;
        }

        return str;
    };

    // Convert dataframe rows to CSV
    // No header row, matching pandas header=False
    const flightRows = rows.map(row =>
        Object.values(row)
            .map(escapeCSV)
            .join(",")
    );

    // Combine original first 15 rows + flight data
    const outputCSV = [
        ...headerRows,
        ...flightRows
    ].join("\r\n");

    // Create downloadable file
    const blob = new Blob(
        [outputCSV],
        { type: "text/csv;charset=utf-8;" }
    );

    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = outputName;

    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
}