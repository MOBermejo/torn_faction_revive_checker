// ==UserScript==
// @name         Faction Revive Assistant
// @namespace    http://tampermonkey.net/
// @version      1.9
// @description  Checks all factions users in the hospital, and determines if they are revivable.
// @author       Marzen [3385879]
// @match        https://www.torn.com/factions.php?step=profile*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// ==/UserScript==

(function() {
    'use strict';

    // Set rate limit delay for API (in ms)
    const API_DELAY = 750;

    // Function to verify if an API key is available, and prompt for a key if not
    async function verifyApiKey() {
        // Attempt to retrieve key from store
        let apiKey = localStorage.getItem("reviveCheckApiKey") || "";
        if (apiKey) {
            return apiKey;
        }

        apiKey = prompt("Please enter a public access API key to continue:")
        if (apiKey) {
            localStorage.setItem("reviveCheckApiKey", apiKey);
            const isValid = await validateApiKey(apiKey);
            if (isValid) {
                return apiKey;
            } else {
                alert("API key is not valid. Please refresh the page and try again.");
                localStorage.setItem("reviveCheckApiKey", "");
                return "";
            }

        } else {
            return "";
        }

    }

    // Validate an API key
    async function validateApiKey(key) {
        try {
            const response = await fetch(`https://api.torn.com/v2/user/`, {
                headers: {
                    "Authorization": `ApiKey ${key}`
                }
            });
            if (!response.ok) throw new Error("Unable to authorize");
            return true;
        } catch (error) {
            console.error("Failed to validate API key:", error);
            return false;
        }
    }

    // Get user data
    async function queryUserData(userId, key) {
        try {
            const response = await fetch(`https://api.torn.com/v2/user/${userId}/`, {
                headers: {
                    "Authorization": `ApiKey ${key}`
                }
            });
            if (!response.ok) throw new Error("Unable to query user");
            return await response.json();
        } catch (error) {
            console.error("Failed to validate API key:", error);
            localStorage.setItem("reviveCheckApiKey", "");
            return false;
        }
    }

    // Function to monitor faction members table
    async function observeFactionMembers() {
        return new Promise(resolve => {
            // Check if table has already loaded (TornPDA)
            const rows = document.querySelectorAll(".members-list .table-body .table-row");
            if (rows.length > 0) {
                resolve();
                return;
            }
    
            // If not, create observer to continue script after table has loaded
            const observer = new MutationObserver(() => {
                const updatedRows = document.querySelectorAll(".members-list .table-body .table-row");
                if (updatedRows.length > 0) {
                    observer.disconnect();
                    resolve();
                }
            });
    
            observer.observe(document.body, { childList: true, subtree: true });
        });
    }

    // Scrape faction page for users in hospital
    async function updateFactionMembers(key) {
        // Ensure table has been loaded
        await observeFactionMembers();

        // Verify API key after table has fully loaded
        let apiKey = await verifyApiKey();

        // Parse all rows to find members in hosp
        const rows = document.querySelectorAll(".members-list .table-body .table-row");

        // Create progress box
        let processed = 0;
        let apiRequestCount = 0;
        let revivable = 0;
        const total = rows.length;
        const progressDiv = document.createElement("div");
        progressDiv.style.position = "fixed";
        progressDiv.style.bottom = "10px";
        progressDiv.style.left = "10px";
        progressDiv.style.backgroundColor = "rgba(0, 0, 0, 0.8)";
        progressDiv.style.color = "white";
        progressDiv.style.padding = "10px";
        progressDiv.style.borderRadius = "5px";
        progressDiv.style.zIndex = "1000";
        document.body.appendChild(progressDiv);

        // If API is unavailable, then display message
        progressDiv.textContent = `Unable to verify API key.`;

        // Track script run time for rate-limiting
        let runTime = Date.now();

        for (const row of rows) {
            const profileLink = row.querySelector('a[href*="/profiles.php?XID="]');
            const status = row.querySelector(".status span").textContent.trim();
            if (profileLink && status === "Hospital") {

                // Query user information and add indicator if they are in the hospital
                const match = profileLink.href.match(/XID=(\d+)/);
                if (match && match[1]) {
                    let userId = match[1];

                    // Calculate expected elapsed time
                    const expectedElapsedTime = API_DELAY * apiRequestCount;
                    const actualElapsedTime = Date.now() - runTime;

                    // Delay if necessary
                    if (actualElapsedTime < expectedElapsedTime) {
                        let delayTime = expectedElapsedTime - actualElapsedTime;
                        await new Promise((resolve) => setTimeout(resolve, delayTime));
                    }

                    let userData = await queryUserData(userId, apiKey);
                    if (userData && userData.revivable) {
                        // Get current user div
                        const userDiv = row.querySelector('[class^="userInfoBox"]');

                        // Create a new div for the revive status
                        const reviveInfo = `(Revives On)`;
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

                    // Increment API request count
                    apiRequestCount++
                }
            }

            // Update progress indicator
            processed++;
            progressDiv.textContent = `Progress: ${total > 0 ? (processed / total * 100).toFixed(0) : 0}% | Revivable: ${revivable}`;
        }
    }

    // Initiate script
    window.addEventListener('load', async function () {
        await updateFactionMembers();
    })
})();