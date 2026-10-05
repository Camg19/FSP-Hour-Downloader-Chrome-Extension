const username = document.getElementById("username");
const includeSimulator = document.getElementById("includeSimulator");
const includeGbs = document.getElementById("includeGbs");
const updateButton = document.getElementById("updateSettings");
const backButton = document.getElementById("backButton");
const status = document.getElementById("settingsStatus");
const logDualGiven = document.getElementById("logDualGivenPIC");
const logDualReceivedPIC = document.getElementById("logDualReceivedPIC");
const logDualReceivedNoPIC = document.getElementById("logDualReceivedNoPIC");
const logPIC = document.getElementById("logPIC");




// Load saved settings
chrome.storage.local.get(
    ["username", "includeSimulator", "includeGbs", "flightLogMode"],
    (settings) => {

        username.value = settings.username ?? "";

        includeSimulator.checked = settings.includeSimulator ?? false;

        includeGbs.checked = settings.includeGbs ?? false;


        const mode = settings.flightLogMode ?? "logDualGivenPIC";


        if (mode === "logDualGivenPIC") {
            logDualGiven.checked = true;
        }

        else if (mode === "logDualReceivedPIC") {
            logDualReceivedPIC.checked = true;
        }

        else if (mode === "logDualReceivedNoPIC") {
            logDualReceivedNoPIC.checked = true;
        }

        else if (mode === "pic") {
            logPIC.checked = true;
        }
    }
);


// Save settings
updateButton.addEventListener("click", () => {

    const usernameValue = username.value.trim();

    status.classList.remove("success", "error");


    if (!usernameValue) {
        status.textContent = "Please enter your username.";
        status.classList.add("error");
        return;
    }

    const selectedLogMode =
        document.querySelector(
            'input[name="flightLogMode"]:checked'
        );


    if (!selectedLogMode) {

        status.textContent =
            "Please select a flight logging option.";

        status.classList.add("error");

        return;
    }


    chrome.storage.local.set(
        {
            username: usernameValue,
            includeSimulator: includeSimulator.checked,
            includeGbs: includeGbs.checked,
            flightLogMode: selectedLogMode.value
        },
        () => {

            status.textContent = "Settings updated successfully.";
            status.classList.add("success");

        }
    );

});


// Back to main page
backButton.addEventListener("click", () => {
    window.location.href = "popup.html";
});