// ==UserScript==
// @name         Faction Revive Assistant
// @namespace    http://tampermonkey.net/
// @version      1.27
// @description  Checks all factions users in the hospital, and determines if they are revivable.
// @author       Marzen [3385879]
// @match        https://www.torn.com/factions.php?step=profile*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// ==/UserScript==

(function () {
    'use strict';

    // **CONFIGURABLE OPTIONS**
    // Set rate limit delay for API (in ms)
    const API_DELAY = 750;

    // Variables for script
    let isRunning = false;
    let observer = null;
    let lastRunTime = 0;

    // Get local API key from local storage if possible
    async function getApiKey() {
        let apiKey = localStorage.reviveApiKey;
        if (!apiKey) {
            // Create div to enter API key (as opposed to using a prompt)
            createApiKeyDiv();
            return "";
        }
        return apiKey;
    }

    async function createApiKeyDiv() {
        // Check if div has already been created
        let apiDiv = document.getElementById('revive-check-api-prompt')
        if (apiDiv) return;

        // Obtain API key (manual entry or previously set in local storage)
        let apiKey = localStorage.reviveApiKey ? localStorage.reviveApiKey : "";

        // Create div
        apiEntryDiv = document.createElement("div");
        apiEntryDiv.id = "revive-check-api-prompt";
        apiEntryDiv.innerHTML = `
            <label for="apiKeyInput">Revive API Key:</label></br>
            <input type="text" id="apiKeyInput" style="width: 150px;" value="${apiKey}"/><br>
            <button id="updateKey">Save Key</button>
            <button id="clearKey">Clear Key</button>
        `;

        // Add a button to manually initiate script
        let startButton = document.getElementById("start-revive-script");
        if (!startButton) {
            startButton = document.createElement("button");
            startButton.id = "start-revive-script";
            startButton.textContent = "Start Revive Check";
            startButton.style.position = "fixed";
            startButton.style.bottom = "50px";
            startButton.style.left = "10px";
            startButton.style.zIndex = "1000";
            document.body.appendChild(startButton);
        }
        startButton.onclick = updateFactionMembers;

        // Attach buttons to appropriate location
        document.body.appendChild(apiEntryDiv);
        document.body.appendChild(startButton);

        // Create listeners for button functionality
        document.getElementById("updateKey").onclick = async function () {
            // Save apiKey value
            let apiKey = document.getElementById("apiKeyInput").value.trim();
            if (apiKey) {
                const isValid = await validateApiKey(apiKey);
                if (isValid) {
                    localStorage.reviveApiKey = apiKey;
                    apiDiv.remove();
                } else {
                    alert("Invalid API key. Try again.");
                }
            }
        };

        document.getElementById("clearKey").onclick = function () {
            localStorage.reviveApiKey = "";
            alert("API key removed.");
        };

        // Manual start button
        function addStartButton() {
            let startButton = document.getElementById("initiateReviveCheck");
            if (!startButton) {
                startButton = document.createElement("button");
                startButton.id = "initiateReviveCheck";
                startButton.textContent = "Start Revive Check";
                startButton.style.position = "fixed";
                startButton.style.bottom = "50px";
                startButton.style.left = "10px";
                startButton.style.zIndex = "1000";
                document.body.appendChild(startButton);
            }
            startButton.onclick = updateFactionMembers;
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
                localStorage.reviveApiKey = "";
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

        // Variables to ensure function isn't trigger by observer while already running
        isRunning = true;
        lastRunTime = Date.now();

        // Parse all rows to get faction members available
        const rows = document.querySelectorAll(".members-list .table-body .table-row");
        if (!rows.length) return (isRunning = false);

        // Get total faction members reported
        let totalMembers = getTotalFactionMembers();

        // Check if all faction members have loaded. If not, then exit script
        if (rows.length < totalMembers) return (isRunning = false);

        // Verify API key after table has fully loaded
        const apiKey = await getApiKey();
        if (!apiKey) return (isRunning = false);

        // Variables for progress box
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

    // Get the faction member count from faction info section
    function getTotalFactionMembers() {
        const memberText = document.querySelector(".f-info li:nth-child(3)")?.textContent.trim();
        if (!memberText) return 0;

        const memberCount = memberText.match(/(\d+)\s*\/\s*\d+/);
        return memberCount ? parseInt(memberCount[1], 10) : 0;
    }

    // Get number of members currently loaded in the table
    function getLoadedFactionMembers() {
        return document.querySelectorAll(".members-list .table-body .table-row").length;
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
                    let totalMembers = getTotalFactionMembers();
                    let loadedMembers = getLoadedFactionMembers();
                    if (loadedMembers === totalMembers) {
                        observer.disconnect(); // Stop observing while running
                        updateFactionMembers().finally(() => startObserver());
                    }
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
                let totalMembers = getTotalFactionMembers();
                let loadedMembers = getLoadedFactionMembers();
                if (loadedMembers === totalMembers) {
                    console.log("Detected TornPDA page refresh on #mainContainer. Re-running script...");
                    updateFactionMembers();
                }
            });
            pageObserver.observe(contentWrapper, { childList: true, subtree: true });
        }
    }

    // Start observer + update faction members
    updateFactionMembers();
    startObserver();

})();