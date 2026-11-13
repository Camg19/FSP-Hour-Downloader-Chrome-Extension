# FSP Hour Downloader Chrome Extension

Use this extension to download your hours from Flight Schedule Pro and import them directly to ForeFlight

## Installation

1. Download the project and unzip it in your desired location
2. Navigate to chrome://extensions/ in a Chrome Browser
3. Select "Load Unpacked" in the top left corner
4. Select the unzipped folder

## Usage

After installing or reloading the extension, refresh your signed-in Flight Schedule Pro dashboard before opening the extension. The extension captures the session from FSP's requests; opening an already-loaded dashboard may not provide a session. If the session has expired, sign in to FSP again and reopen the extension.

1. Select the settings button in the top right
2. Set the Username to be exactly what your name shows up as in FSP Dashboard
3. Select if you want to include simulator or ground brief time
4. Select how you want the time to be logged.
    * Dual Given: Sum session `totalDual` as Total Time, Dual Given and PIC.
    * Dual Received with PIC: Sum session `totalDual` as Total Time, Dual Received and PIC.
    * Dual Received No PIC: Sum session `totalDual` as Total Time and Dual Received; PIC is zero.
    * PIC Only: Sum session `totalPIC` as Total Time and PIC; dual time is zero.
    * Totals include all attached sessions. Missing session time stays zero rather than falling back to Hobbs. Hobbs meter readings are still exported separately. Simulator time remains in SimulatedFlight.
5. Select "Update Settngs" to save the settings and return to the main screen
6. Navigate to your dashboard on FSP and make sure you are logged in. The extension is active when it says its connected to FSP with a green light
7. Select the operator and whether to download all time from FSP or to start from a specific date.
8. Select "Download" and wait for the data to be downloaded. AFter its complete it will automatically download a csv file. NOTE: Extension window MUST be kept open or the download progress will be stopped.
9. Open the CSV and verify all times and data are accurate. Then navigate to https://plan.foreflight.com/logbook#/import and upload the file.
