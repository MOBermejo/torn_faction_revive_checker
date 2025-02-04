// ==UserScript==
// @name         Faction Revive Assistant
// @namespace    http://tampermonkey.net/
// @version      1.23
// @description  Checks all factions users in the hospital, and determines if they are revivable.
// @author       Marzen [3385879]
// @match        https://www.torn.com/factions.php?step=profile*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// ==/UserScript==

(function () {
    'use strict';

    // Set rate limit delay for API (in ms)
    const API_DELAY = 750;

    // Variables for script
    let isRunning = false;
    let observer = null;
    let lastRunTime = 0;


    // Function to verify if an API key is available, and prompt for a key if not
    async function getApiKey() {
        // Attempt to retrieve key from local storage
        let apiKey = localStorage.getItem("reviveCheckApiKey") || "";
        if (!apiKey) {
            apiKey = prompt("Please enter a public access API key to continue:")
        }

        // Validate key
        if (apiKey) {
            localStorage.setItem("reviveCheckApiKey", apiKey);
            console.log('api key is', apiKey);
            const isValid = await validateApiKey(apiKey);
            if (isValid) {
                return apiKey;
            } else {
                alert("API key is invalid. Please refresh the page and try again.");
                localStorage.removeItem("reviveCheckApiKey");
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

            // Get JSON from response
            const data = await response.json();
            if (data.error) {
                console.warn(`API Key validation failed: ${data.error.error}`);
                localStorage.removeItem("reviveCheckApiKey");
                return false;
            }
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
            localStorage.removeItem("reviveCheckApiKey");
            return false;
        }
    }

    // Scrape faction page for users in hospital
    async function updateFactionMembers(key) {
        if (isRunning) return;

        // Variables to ensure function isn't trigger by observer too often
        isRunning = true;
        lastRunTime = Date.now();

        // Verify API key after table has fully loaded
        const apiKey = await getApiKey();
        if (!apiKey) return (isRunning = false);

        // Parse all rows to find members in hosp.
        const rows = document.querySelectorAll(".members-list .table-body .table-row");
        if (!rows.length) return (isRunning = false);

        // Create progress box
        let processed = 0, revivable = 0;
        let apiRequestCount = 0;
        const total = rows.length;

        // Create div to display script progress
        let progressDiv = document.getElementById("revive-progress");
        if (!progressDiv) {
            progressDiv = document.createElement("div");
            progressDiv.id = "revive-progress";
            progressDiv.style.position = "fixed";
            progressDiv.style.bottom = "10px";
            progressDiv.style.left = "10px";
            progressDiv.style.backgroundColor = "rgba(0, 0, 0, 0.8)";
            progressDiv.style.color = "white";
            progressDiv.style.padding = "10px";
            progressDiv.style.borderRadius = "5px";
            progressDiv.style.zIndex = "1000";
            progressDiv.style.cursor = "pointer";
            progressDiv.onclick = () => progressDiv.remove();
            document.body.appendChild(progressDiv);
        }
        progressDiv.textContent = `Processing faction members...`;

        // Track script run time for rate-limiting
        let runTime = Date.now();

        for (const row of rows) {
            const profileLink = row.querySelector('a[href*="/profiles.php?XID="]');
            const status = row.querySelector(".status span").textContent.trim();
            if (profileLink && status === "Hospital") {

                // Query user information and add indicator if they are in the hospital
                const match = profileLink.href.match(/XID=(\d+)/);
                if (match) {
                    let userId = match[1];

                    // Calculate expected elapsed time
                    const expectedElapsedTime = API_DELAY * apiRequestCount;
                    const actualElapsedTime = Date.now() - runTime;

                    // Delay if necessary
                    if (actualElapsedTime < expectedElapsedTime) {
                        await new Promise(resolve => setTimeout(resolve, expectedElapsedTime - actualElapsedTime));
                    }

                    let userData = await queryUserData(userId, apiKey);
                    if (userData?.revivable) {
                        // Get current user div
                        const userDiv = row.querySelector('[class^="userInfoBox"]');

                        // Only update indicator once
                        if (!userDiv.querySelector(".revivable-indicator")) {
                            const reviveDiv = document.createElement("div");
                            reviveDiv.className = "revivable-indicator";
                            reviveDiv.style.fontWeight = "bold";
                            reviveDiv.style.marginLeft = "8px";
                            reviveDiv.style.color = "green";
                            reviveDiv.textContent = "(Revivable)";
                            userDiv.appendChild(reviveDiv);
                        }

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

        progressDiv.textContent = `Revivable: ${revivable}`
        isRunning = false;
    }

    // Use observer to initate script on web and track TornPDA web view changes
    function startObserver() {
        if (observer) observer.disconnect();

        // Create observer to track changes to the members list table
        observer = new MutationObserver(() => {
            const now = Date.now();
            if (!isRunning && now - lastRunTime > 5000) {
                const memberTable = mutations.some(mutation =>
                    [...mutation.addedNodes].some(node =>
                        node.nodeType === 1 && node.matches(".members-list .table-body .table-row")
                    )
                );

                if (memberTable) {
                    console.log("Detected faction member table update. Running script...");
                    observer.disconnect(); // Stop observing while running
                    updateFactionMembers().finally(() => startObserver());
                }
            }
        });

        // Observe members list for changes to the table
        const membersList = document.querySelector(".members-list .table-body");
        if (membersList) {
            observer.observe(membersList, { childList: true, subtree: true });
        }

        // Observe main container div to handle refreshes on TornPDA
        const contentWrapper = document.querySelector("#mainContainer");
        if (contentWrapper) {
            const pageObserver = new MutationObserver(() => {
                console.log("Detected TornPDA page refresh. Re-running script...");
                updateFactionMembers();
            });
            pageObserver.observe(contentWrapper, { childList: true, subtree: true });
        }
    }

    // Start observer
    startObserver();

})();