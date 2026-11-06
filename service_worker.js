// Observe requests made by FSP tabs, never requests replayed by this extension.
chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
        if (details.tabId < 0 || details.initiator !== "https://app.flightschedulepro.com") {
            return;
        }
        // Capture only the application headers needed to replay API requests.
        // Never persist cookies or copy browser-managed headers.
        const headers = {};
        for (const header of details.requestHeaders ?? []) {
            const name = header.name.toLowerCase();
            if (["authorization", "x-fsp-environment", "x-subscription-key", "x-fsp-apikey"].includes(name) && header.value) {
                headers[name] = header.value;
            }
        }
        if (!headers.authorization) return;
        const url = new URL(details.url);
        const origin = url.origin;
        const isReservationDetail = origin === "https://usc-api.flightschedulepro.com" &&
            /^\/core-app\/api\/V2\/Reservation\/[^/]+\/?$/i.test(url.pathname);
        // Detail requests use Basic and an API key; list/operator requests use Bearer.
        // Store the complete detail context without overwriting the shared Bearer context.
        const suffix = isReservationDetail ? ":reservation-detail" : "";
        if (origin === "https://usc-api.flightschedulepro.com" &&
            !isReservationDetail && !/^Bearer\s+/i.test(headers.authorization)) return;
        void chrome.storage.session.set({
            [`fspAuthorization:${origin}${suffix}`]: headers.authorization,
            [`fspRequestHeaders:${origin}${suffix}`]: headers
        }).catch(error => {
            console.error("Unable to save FSP session:", error);
        });
    },
    {
        urls: [
            "https://usc-api.flightschedulepro.com/*",
            "https://api-external.flightschedulepro.com/*",
            "https://curriculum-api-external.flightschedulepro.com/*"
        ]
    },
    ["requestHeaders", "extraHeaders"]
);
