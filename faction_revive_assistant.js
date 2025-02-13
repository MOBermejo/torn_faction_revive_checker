// ==UserScript==
// @name         Faction Revive Assistant
// @namespace    http://tampermonkey.net/
// @version      1.31
// @description  Checks all factions users in the hospital, and determines if they are revivable.
// @author       Marzen [3385879]
// @match        https://www.torn.com/factions.php?step=profile*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// ==/UserScript==

(function () {
    'use strict';

    // **CONFIGURABLE OPTIONS**
    const API_DELAY = 750;              // Set rate limit delay for API (in ms)
    const CONTINOUS_DELAY = 5000        // Set  delay for continous check button (in ms)

    // Variables for script
    let isRunning = false;
    let isContinuous = false;

    function createApiKeyDiv() {
        let existingContainer = document.getElementById('revive-api-container');
        if (existingContainer) return;

        waitForMembersList((membersList) => {
            let container = document.createElement('div');
            container.id = 'revive-api-container';
            container.style.background = '#222';
            container.style.color = 'white';
            container.style.padding = '10px';
            container.style.borderRadius = '5px';
            container.style.marginBottom = '10px';
            container.style.display = 'flex';
            container.style.flexDirection = 'column';
            container.style.alignItems = 'left';
            container.style.fontSize = '14px';
            container.style.marginTop = '10px';

            container.innerHTML = `
                <div style="text-align: center; font-size: 16px; font-weight: bold; margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid gray;">
                    Faction Revive Assistant
                </div>
                <div style="display: flex; align-items: center; gap: 6px; width: 100%;">
                    <label style="font-weight: bold; white-space: nowrap;">API Key:</label>
                    <input type="text" id="apiKeyInput" style="width: 90%; padding: 4px; text-align: center; border-radius: 5px; border: 1px solid #ccc; background: #333; color: white;" value="${localStorage.reviveApiKey || ''}"/>
                    <button id="updateKey" class="revive-asst-btn" style="padding: 4px 8px;">Save</button>
                    <button id="clearKey" class="revive-asst-btn" style="padding: 4px 8px;">Clear</button>
                </div>
                <div style="margin-top: 8px; display: flex; gap: 6px;">
                    <button id="toggleScan" class="revive-asst-btn" style="flex-grow: 1;">Start Continuous Scan</button>
                    <button id="initiateReviveCheck" class="revive-asst-btn" style="flex-grow: 1;">Start Revive Check</button>
                </div>
            `;

            // Insert container before members list
            membersList.insertAdjacentElement('beforebegin', container);

            // Create style for buttons with "revive-asst-btn" class
            const style = document.createElement('style');
            style.innerHTML = `
                .revive-asst-btn {
                    background: #444;
                    color: white;
                    border: 1px solid #555;
                    padding: 6px 12px;
                    border-radius: 5px;
                    cursor: pointer;
                    transition: 0.2s;
                }
                .revive-asst-btn:hover {
                    background: #555;
                    border-color: #777;
                }
                .revive-asst-btn:disabled {
                    background: #333 !important;
                    border-color: #222 !important;
                    color: gray !important;
                    cursor: not-allowed !important;
                }
            `;
            document.head.appendChild(style);

            // Button event handlers
            document.getElementById("updateKey").addEventListener("click", () => {
                let apiKey = document.getElementById("apiKeyInput").value.trim();
                localStorage.reviveApiKey = apiKey;
                alert('API key has been saved!')
            });

            document.getElementById("clearKey").addEventListener("click", () => {
                localStorage.reviveApiKey = "";
                document.getElementById("apiKeyInput").value = "";
                alert('API key has been cleared!')
            });

            document.getElementById("toggleScan").addEventListener("click", function () {
                isContinuous = !isContinuous;
                this.textContent = isContinuous ? "Stop Continuous Scan" : "Start Continuous Scan";
                document.getElementById("initiateReviveCheck").disabled = isContinuous;
                console.log(`[FRA] Continuous scan: ${isContinuous}`);
                if (isContinuous) updateFactionMembers();
            });

            document.getElementById("initiateReviveCheck").addEventListener("click", function () {
                if (!isRunning) {
                    console.log("[FRA] Starting one-time revive check...");
                    this.disabled = true;
                    document.getElementById("toggleScan").disabled = true;
                    updateFactionMembers().finally(() => {
                        this.disabled = false;
                        document.getElementById("toggleScan").disabled = false;
                        console.log("[FRA] One-time revive check complete.");
                    });
                }
            });
        });
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
            localStorage.reviveApiKey = "";
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
        const apiKey = localStorage.reviveApiKey;
        if (!apiKey) {
            console.warn("[FRA] No API Key found!");
            isRunning = false;
            alert('API key is missing. Please enter the key and try again.');
            return;
        }

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
                    if (userData) {
                        let isRevivable = userData?.revivable; // Check if user is revivable

                        // Get current user div
                        let userDiv = row.querySelector('[class^="userInfoBox"]');
                        if (userDiv) {
                            let reviveIcon = userDiv.querySelector(".revivable-indicator");

                            // Symbol to denote revive icon
                            let newText = isRevivable ? "✅" : "❌"; 

                            if (!reviveIcon) {
                                // If the indicator doesn't exist, create it
                                reviveIcon = document.createElement("span");
                                reviveIcon.className = "revivable-indicator";
                                reviveIcon.textContent = newText;
                                userDiv.insertBefore(reviveIcon, userDiv.firstChild);
                                console.log(`[FRA] Marked User ${userId} as ${isRevivable ? "revivable ✅" : "not revivable ❌"}.`);
                            } else {
                                // If the indicator exists, update it if needed
                                if (reviveIcon.textContent !== newText) {
                                    reviveIcon.textContent = newText;
                                    console.log(`[FRA] Updated User ${userId} to ${isRevivable ? "revivable ✅" : "not revivable ❌"}.`);
                                }
                            }
                        }

                        // Update revivable counter
                        if (isRevivable) revivable++;

                    } else {
                        console.log(`[FRA] User ${userId} is NOT revivable.`);

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

        // If continous scan is enabled, then reinitate after delay
        if (isContinuous) {
            console.log(`[FRA] Continuous scan enabled. Starting in ${CONTINOUS_DELAY} ms.`);
            setTimeout(updateFactionMembers, CONTINOUS_DELAY);
        } else {
            // Update buttons since run has finished
            document.getElementById("toggleScan").disabled = false;
            document.getElementById("initiateReviveCheck").disabled = false;
            console.log("[FRA] Revive check has been completed.");
        }
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

    // Function to wait for members list (using setInterval for ease of use)
    function waitForMembersList(callback) {
        console.log("[FRA] Waiting for members list...");
        const checkInterval = setInterval(() => {
            const membersList = document.querySelector('.members-list');
            if (membersList) {
                console.log("[FRA] Members list found!");
                clearInterval(checkInterval);
                callback(membersList);
            }
        }, 500);
    }

    // Create div to allow for functionality
    createApiKeyDiv();

})();