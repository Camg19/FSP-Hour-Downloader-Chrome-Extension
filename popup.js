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

    const connectionText = document.getElementById("connectionText");
    const statusDot = document.getElementById("statusDot");
    const downloadButton = document.getElementById("downloadButton");

    // Get current active tab
    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });


    // Could not get tab
    if (!tab || !tab.url) {

        connectionText.textContent = "Unable to determine current tab";
        statusDot.style.background = "#ef4444";
        downloadButton.disabled = true;

        return;
    }


    // Check that we're on Flight Schedule Pro
    const onFSP =
        tab.url.startsWith("https://app.flightschedulepro.com/App/");


    if (!onFSP) {

        connectionText.textContent = "Flight Schedule Pro is not open";
        statusDot.style.background = "#ef4444";
        downloadButton.disabled = true;

        return;
    }

    const authorization = await getFSPAuthorization();

    if (!authorization) {
        throw new Error(
            "No active Flight Schedule Pro session detected."
        );
    }

    try {

        // Fetch operators from FSP
        operators =
            await getOperators(authorization);


        // Put operators into select
        populateOperatorSelect(operators);


        setConnectionStatus(
            "Connected to Flight Schedule Pro",
            "#22c55e",
            true
        );

    }
    catch (error) {

        console.error(
            "Unable to load operators:",
            error
        );


        setConnectionStatus(
            "Unable to load FSP operators",
            "#ef4444",
            false
        );
    }

    // Everything good
    connectionText.textContent = "Connected to Flight Schedule Pro";
    statusDot.style.background = "#22c55e";
    downloadButton.disabled = false;



}

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
            "https://app.flightschedulepro.com/App/"
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
            "Unable to download FSP data.";
    }

});

async function getFSPAuthorization() {

    const result = await chrome.storage.session.get(
        "fspAuthorization"
    );

    return result.fspAuthorization ?? null;
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

    const authorization = await getFSPAuthorization();

    if (!authorization) {
        throw new Error(
            "No active Flight Schedule Pro session detected."
        );
    }

    const settings = await loadSettings();
    console.log("TESTT")
    console.log(settings.flightLogMode)

    if (!getAllData.checked && startDate.value) {
        date = new Date(startDate.value);
    }

    updateProgress(
        1,
        "Loading reservations..."
    );

    const events = [];
    let ind = 1;

    while (true) {
        const reservations = await getReservations(
            authorization,
            operatorId,
            ind,
            25
        );

        const [flights, isFinished] = createFlightObjs(
            reservations,
            startDate,
            true,
            settings.username
        );

        events.push(...flights);

        if (flights.length === 0) {
            break;
        }

        if (isFinished) {
            break;
        }

        ind++;
    }

    updateProgress(
        2,
        "Reservations Loaded..."
    );

    const progressBarUpdateAmount = 98 / events.length
    var progressBarProgress = 2.0

    for (const event of events) {
        await event.runAll(authorization, operatorId, settings.flightLogMode);
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
async function getOperators(authorization) {

    const response = await fetch(
        "https://api-external.flightschedulepro.com/api/V1/myoperators",
        {
            method: "GET",

            headers: {
                "Authorization": authorization,
                "Accept": "application/json"
            }
        }
    );


    if (response.status === 401) {

        await chrome.storage.session.remove(
            "fspAuthorization"
        );

        throw new Error(
            "FSP authorization expired."
        );
    }


    if (!response.ok) {

        throw new Error(
            `FSP returned status ${response.status}`
        );

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

async function getReservations(authorization, operatorId, pageindex=1, pagesize=25) {

    const params = new URLSearchParams();
    params.append("pageindex", pageindex);
    params.append("pagesize", pagesize);
    params.append("dateTypeFilter", 2);
    params.append("timeZoneBias", -240);
    params.append("operatorId", operatorId);


    const response = await fetch(
        `https://api-external.flightschedulepro.com/api/V2/Reservation?${params}`,
        {
            method: "GET",
            headers: {
                "Authorization": authorization,
                "Accept": "application/json"
            }
        }
    );


    if (response.status === 401) {
        throw new Error(
            "Reservations Not Downloaded"
        );
    }

    const data = await response.json();

    return data
}

async function getReservation(authorization, resId, operatorId) {
    const params = new URLSearchParams();
    params.append("operatorId", operatorId);

    const response = await fetch(
        `https://api-external.flightschedulepro.com/api/V2/Reservation/${resId}?${params}`,
        {
            method: "GET",
            headers: {
                "Authorization": authorization,
                "Accept": "application/json"
            }
        }
    );

    if (response.status === 401) {
        console.log("Reservation Not Downloaded");
        return null;
    }

    const data = await response.json();

    return data

}

async function getSession(authorization, sesId, operatorId) {
    const params = new URLSearchParams();
    params.append("operatorId", operatorId);
    params.append("readOnly", "true");

    const response = await fetch(
        `https://curriculum-api-external.flightschedulepro.com/api/v1/trainingsessions/${sesId}?${params}`,
        {
            method: "GET",
            headers: {
                "Authorization": authorization,
                "Accept": "application/json"
            }
        }
    );

    if (response.status === 401) {
        console.log("Session Not Downloaded");
        return null;
    }

    const data = await response.json();

    return data
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

    async getLessonData(authorization, operatorId) {
        const newData = await getReservation(authorization, this.resId, operatorId);

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

    async getSessionData(authorization, operatorId) {
        let xc = 0;
        let ira = 0;
        let night = 0;
        let simulationTime = 0;

        for (const sessionId of this.sessionIds) {
            const newData = await getSession(authorization, sessionId, operatorId);

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

    async runAll(authorization, operatorId, flightLogMode) {
        this.convertTimes();
        await this.getLessonData(authorization, operatorId);
        await this.getSessionData(authorization, operatorId);
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

            // Date check
            let start;

            try {
                start = new Date(flight.start);

                if (isNaN(start.getTime())) {
                    start = new Date(1999, 0, 1);
                }
            } catch {
                start = new Date(1999, 0, 1);
            }

            if (date) {
                const compareDate =
                    date instanceof Date
                        ? date
                        : new Date(date);

                if (compareDate >= start) {
                    isFinished = true;
                    break;
                }
            }

            // Name check
            if (onlyIncludePilot && name) {
                const searchName = name.toLowerCase();

                const instructor =
                    flight?.instructor?.toLowerCase() ?? "";

                const pilotName =
                    `${flight?.pilotFirstName ?? ""} ${flight?.pilotLastName ?? ""}`
                        .trim()
                        .toLowerCase();

                if (
                    searchName !== instructor &&
                    searchName !== pilotName
                ) {
                    continue;
                }
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