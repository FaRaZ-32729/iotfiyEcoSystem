/**
 * Flatten Ackit Brand documents into dotted IR keys
 * (power.on, temp.24, mode.cool, fan.low, …)
 */

const TEMP_WORD_BY_C = {
    16: "sixteen",
    17: "seventeen",
    18: "eighteen",
    19: "nineteen",
    20: "twenty",
    21: "twentyOne",
    22: "twentyTwo",
    23: "twentyThree",
    24: "twentyFour",
    25: "twentyFive",
    26: "twentySix",
    27: "twentySeven",
    28: "twentyEight",
    29: "twentyNine",
    30: "thirty",
};

function toFrontendSignals(draft) {
    const temperatures = {};
    for (const [c, word] of Object.entries(TEMP_WORD_BY_C)) {
        const value = draft.temperatureCommands?.[word] || "";
        temperatures[Number(c)] = value || null;
    }

    return {
        powerOn: draft.powerCommands?.on || null,
        powerOff: draft.powerCommands?.off || null,
        temperatures,
        fanSpeeds: {
            low: draft.fanSpeedCommands?.low || null,
            medium: draft.fanSpeedCommands?.medium || null,
            high: draft.fanSpeedCommands?.high || null,
            ultra: draft.fanSpeedCommands?.ultra || null,
            turbo: draft.fanSpeedCommands?.turbo || null,
        },
        modes: {
            cool: draft.modes?.cool || null,
            heat: draft.modes?.heat || null,
            dry: draft.modes?.dry || null,
            fan: draft.modes?.fanOnly || null,
            auto: draft.modes?.smartAuto || null,
        },
    };
}

function signalsToDottedCommands(signals = {}) {
    const commands = {};

    if (signals.powerOn) commands["power.on"] = signals.powerOn;
    if (signals.powerOff) commands["power.off"] = signals.powerOff;

    for (const [key, value] of Object.entries(signals.modes || {})) {
        if (value) commands[`mode.${key}`] = value;
    }

    for (const [c, value] of Object.entries(signals.temperatures || {})) {
        if (value) commands[`temp.${c}`] = value;
    }

    for (const [key, value] of Object.entries(signals.fanSpeeds || {})) {
        if (value) commands[`fan.${key}`] = value;
    }

    return commands;
}

function brandDocumentToCommandsMap(brand) {
    if (!brand) return {};
    return signalsToDottedCommands(toFrontendSignals(brand));
}

function brandHasCommand(brand, key) {
    if (!key) return false;
    const map = brandDocumentToCommandsMap(brand);
    return Boolean(map[key]);
}

function getBrandCommandValue(brand, key) {
    if (!key || !brand) return null;
    const map = brandDocumentToCommandsMap(brand);
    const value = map[key];
    return value ? String(value) : null;
}

module.exports = {
    TEMP_WORD_BY_C,
    toFrontendSignals,
    signalsToDottedCommands,
    brandDocumentToCommandsMap,
    brandHasCommand,
    getBrandCommandValue,
};
