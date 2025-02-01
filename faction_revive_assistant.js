// ==UserScript==
// @name         Faction Revive Assistant
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Checks all factions users in the hospital, and determines if they are revivable.
// @author       Marzen [3385879]
// @match        https://www.torn.com/factions.php?*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @require       GM_xmlhttpRequest
// @connect      api.torn.com
// ==/UserScript==

(function() {
    'use strict';

    // Set rate limit delay for API (in ms)
    const API_DELAY = 1000;

    // Obtain apiKey from store
    let apiKey = '###PDA-APIKEY###' != '###PDA-APIKEY###' ? '###PDA-APIKEY###' : GM_getValue("apiKey", "");

    // Helper function to wrap GM_xmlhttpRequest in a Promise
    function httpRequest(options) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                ...options,
                onload: (response) => resolve(response),
                onerror: (error) => reject(error),
            });
        });
    }

    // Function to verify if an API key is available, and prompt for a key if not
    async function verifyApiKey() {
        if (!apiKey) {
            apiKey = prompt("Please enter a public access API key to continue:")
            if (apiKey) {
                GM_setValue("apiKey", apiKey);
                const isValid = await validateApiKey(apiKey);
                if (isValid) {
                    alert("Your API key has been validated and saved. Thank you.");
                } else {
                    alert("API key is not valid. Please refresh the page and try again.");
                    GM_setValue("apiKey", "");
                    throw new Error("Invalid API key.");
                }

            } else {
                alert("API key not set. Please refresh the page and try again.")
            }
        }
    }

    // Validate an API key
    async function validateApiKey(key) {
        try {
            const response = await httpRequest({
                method: 'GET',
                url: `https://api.torn.com/v2/user/`,
                headers: {
                    "Authorization": `ApiKey ${key}`,
                }
            });
            const data = JSON.parse(response.responseText);
            return !data.error;
        } catch (error) {
            console.error("Failed to validate API key:", error);
            return false;
        }
    }

    // Get user data
    async function queryUserData(userId) {
        try {
            const response = await httpRequest({
                method: 'GET',
                url: `https://api.torn.com/v2/user/${userId}/`,
                headers: {
                    "Authorization": `ApiKey ${apiKey}`,
                }
            });
            const data = JSON.parse(response.responseText);
            return data;
        } catch (error) {
            console.error("Failed to validate API key:", error);
            GM_setValue("apiKey", "");
            return false;
        }
    }

    // Function to monitor faction members table
    async function observeFactionMembers() {
        return new Promise(resolve => {
            const observer = new MutationObserver(() => {
                const rows = document.querySelectorAll(".table-body .table-row");
                if (rows.length > 0) {
                    observer.disconnect();
                    resolve();
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        });
    }

    // Scrape faction page for users in hospital
    async function updateFactionMembers() {
        // Set time since last update for rate limiting
        let lastUpdate = 0;

        // Parse all rows to find members in hosp
        await waitForFactionList();
        const rows = document.querySelectorAll(".table-body .table-row");

        // Create progress box
        let processed, revivable = 0;
        const total = rows.length;
        const progressDiv = document.createElement("div");
        progressDiv.style.position = "fixed";
        progressDiv.style.bottom = "10px";
        progressDiv.style.right = "10px";
        progressDiv.style.backgroundColor = "rgba(0, 0, 0, 0.8)";
        progressDiv.style.color = "white";
        progressDiv.style.padding = "10px";
        progressDiv.style.borderRadius = "5px";
        progressDiv.style.zIndex = "1000";
        document.body.appendChild(progressDiv);
        
        for (const row of rows) {
            const profileLink = row.querySelector('a[href*="/profiles.php?XID="]');
            const status = row.querySelector(".status span").textContent.trim();
            if (profileLink && status === "Hospital") {

                // Query user information and add indicator if they are in the hospital
                const match = profileLink.href.match(/XID=(\d+)/);
                if (match && match[1]) {
                    let userId = match[1];

                    // Calculate the time since the last request
                    const now = Date.now();
                    const timeSinceLastUpdate = now - lastUpdate;

                    // Delay if necessary
                    if (timeSinceLastUpdate < API_DELAY) {
                        let delayTime = API_DELAY - timeSinceLastUpdate;
                        console.log('delay time', delayTime);
                        await new Promise((resolve) => setTimeout(resolve, delayTime));
                    }

                    let userData = await queryUserData(userId);
                    if (userData && userData.revivable) {
                        // Get current user div
                        const userDiv = row.querySelector('[class^="userInfoBox"]');

                        // Create a new div for the revive status
                        const reviveInfo = `Reviveable`;
                        const reviveDiv = document.createElement("div");
                        reviveDiv.style.fontWeight = "bold";
                        reviveDiv.style["margin-left"] = "8px";
                        reviveDiv.style.color = "green";
                        reviveDiv.textContent = reviveInfo;

                        // Append the new div to the userDiv
                        userDiv.appendChild(reviveDiv);

                        // Update revivable counter
                        revivable++;
                    }

                    // Record the last update timestamp
                    lastUpdate = Date.now();

                }
            }

            // Update progress indicator
            processed++;
            progressDiv.textContent = `Progress: ${processed / total}% | Revivable: ${revivable}`;
        }
    }

    async function start() {
        await verifyApiKey();
        console.log("Processing faction members...");
        await updateFactionMembers();
        console.log("Faction members processed successfully");
    }

    window.onload = function () {
        start();
    };
})();