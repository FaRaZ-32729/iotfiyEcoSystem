/**

 * SMD (smoke) devices — ESP publishes:

 *   { "smoke": <0–100> }

//  *

 * Stores percentage on device.espSmokePct.

 * Detected / smokeAlert comes from device CONDITIONS (default smoke > 60).

 */



/**

 * Apply ESP smoke % onto device + normalize payload for conditionChecker.

 * Does NOT decide alert — that is condition-driven (smoke > threshold).

 * @returns {boolean} true if smoke % was applied

 */

function applySmdSmokeFromPayload(device, payload, updatedFields = []) {

    if (!device || device.deviceType !== "SMD" || !payload) return false;



    let raw;

    if (payload.smoke !== undefined && payload.smoke !== null && payload.smoke !== "") {

        raw = payload.smoke;

    } else if (

        payload.smokePct !== undefined &&

        Number.isFinite(Number(payload.smokePct))

    ) {

        raw = payload.smokePct;

    }



    if (raw === undefined || raw === null || raw === "") return false;



    const pct = Math.min(100, Math.max(0, Number(raw)));

    if (!Number.isFinite(pct)) return false;



    device.espSmokePct = pct;



    // condition type "smoke" reads payload.smoke as percentage

    payload.smoke = pct;

    payload.smokePct = pct;



    updatedFields.push(`smoke%: ${pct}`);

    return true;

}



/**

 * After checkConditions(): sync boolean Detected flag from smokeAlert.

 */

function syncSmdSmokeDetectedFromAlert(device, alerts = []) {

    if (!device || device.deviceType !== "SMD") return alerts;



    device.espSmoke = device.smokeAlert === true;



    if (device.smokeAlert && !alerts.some((a) => a.type === "smoke")) {

        alerts.push({

            type: "smoke",

            value: device.espSmokePct != null ? device.espSmokePct : "Detected",

            message: "Smoke Detected",

        });

    }

    return alerts;

}



module.exports = {

    applySmdSmokeFromPayload,

    syncSmdSmokeDetectedFromAlert,

};

