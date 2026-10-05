console.log("Service worker loaded");

chrome.webRequest.onBeforeSendHeaders.addListener(
    async (details) => {

        const authHeader = details.requestHeaders?.find(
            header =>
                header.name.toLowerCase() === "authorization"
        );

        if (!authHeader?.value) {
            return;
        }

        console.log("FSP authorization detected");

        await chrome.storage.session.set({
            fspAuthorization: authHeader.value
        });
    },

    {
        urls: [
            "https://api-external.flightschedulepro.com/*"
        ]
    },

    [
        "requestHeaders",
        "extraHeaders"
    ]
);