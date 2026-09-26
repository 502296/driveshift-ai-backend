/* ============================================================
   DRIVESHIFT — VERIFIED OBD EVIDENCE

   Responsibilities:
   - Accept structured OBD evidence from the DriveShift client.
   - Normalize only known OBD evidence fields.
   - Preserve verification state and ECU provenance.
   - Never convert NO DATA / NO RESPONSE / NOT SUPPORTED
     into successful measurements.
   - Never promote unverified data to verified data.
   - Build a compact model-safe representation.
   - Extract only verified DTCs for diagnostic reasoning.

   SECURITY:
   Client input is never trusted merely because it is structured.
   Every field is normalized before model use.
   ============================================================ */

const QUERY_STATES = new Set([
  "success",
  "noData",
  "noResponse",
  "notSupported",
  "error",
  "notScanned",
]);

const MIL_STATES = new Set([
  "on",
  "off",
  "unknown",
]);

const LIVE_READ_STATES = new Set([
  "verified",
  "notSupportedByVehicle",
  "noData",
  "noResponse",
  "adapterNotSupported",
  "error",
]);

const ADAPTER_VOLTAGE_STATES = new Set([
  "verified",
  "noResponse",
  "notSupported",
  "invalidResponse",
]);

const READINESS_ENGINE_TYPES = new Set([
  "sparkIgnition",
  "compressionIgnition",
  "unknown",
]);

const READINESS_MONITOR_STATES = new Set([
  "complete",
  "incomplete",
  "notSupported",
  "unknown",
]);

const FREEZE_FRAME_STATES = new Set([
  "verified",
  "noFreezeFrameReported",
  "noData",
  "noResponse",
  "notSupported",
  "unverified",
]);

/* ============================================================
   PUBLIC API
   ============================================================ */

export function normalizeVerifiedObdEvidence(
  value,
) {
  if (!isPlainObject(value)) {
    return null;
  }

  const schemaVersion =
    sanitizeText(
      value.schemaVersion,
      20,
    );

  /*
   * Unknown schemas are not interpreted.
   */
  if (schemaVersion !== "1.0") {
    return null;
  }

  const normalized = {
    schemaVersion:
      "1.0",

    source:
      "DriveShift verified OBD pipeline",
  };

  const coreScan =
    normalizeCoreScan(
      value.coreScan,
    );

  if (coreScan) {
    normalized.coreScan =
      coreScan;
  }

  const liveData =
    normalizeLiveData(
      value.liveData,
    );

  if (liveData) {
    normalized.liveData =
      liveData;
  }

  const readiness =
    normalizeReadiness(
      value.readiness,
    );

  if (readiness) {
    normalized.readiness =
      readiness;
  }

  const freezeFrame =
    normalizeFreezeFrame(
      value.freezeFrame,
    );

  if (freezeFrame) {
    normalized.freezeFrame =
      freezeFrame;
  }

  /*
   * A schema wrapper without actual OBD sections is not
   * meaningful diagnostic evidence.
   */
  if (
    !normalized.coreScan &&
    !normalized.liveData &&
    !normalized.readiness &&
    !normalized.freezeFrame
  ) {
    return null;
  }

  return normalized;
}

/*
 * Build only the OBD information that the diagnostic model
 * needs for reasoning.
 *
 * Raw adapter traffic is intentionally excluded from the
 * model prompt. It remains transport/provenance evidence,
 * not a natural-language diagnostic fact.
 */
export function buildVerifiedObdEvidenceForModel(
  normalizedEvidence,
) {
  if (
    !normalizedEvidence ||
    !isPlainObject(
      normalizedEvidence,
    )
  ) {
    return {};
  }

  const result = {
    schemaVersion:
      "1.0",

    evidenceType:
      "structured_obd_evidence",
  };

  const core =
    normalizedEvidence
      .coreScan;

  if (core) {
    result.coreScan = {
      milState:
        core.milState,

      confirmedDtcCount:
        core.confirmedDtcCount,

      respondingEcus:
        [...core.respondingEcus],

      supportedPids:
        [...core.supportedPids],

      milQueryState:
        core.milQuery.state,

      stored:
        buildServiceForModel(
          core.stored,
        ),

      pending:
        buildServiceForModel(
          core.pending,
        ),

      permanent:
        buildServiceForModel(
          core.permanent,
        ),
    };
  }

  const live =
    normalizedEvidence
      .liveData;

  if (live) {
    result.liveData = {
      verifiedReadingCount:
        live.verifiedReadings.length,

      requestedReadingCount:
        live.requestedReadingCount,

      respondingEcus:
        [...live.respondingEcus],

      /*
       * Only readings carrying verified=true are exposed as
       * actual vehicle measurements.
       */
      verifiedReadings:
        live.verifiedReadings
          .filter(
            (reading) =>
              reading.verified ===
              true,
          )
          .map(
            (reading) => ({
              pid:
                reading.pid,

              name:
                reading.name,

              value:
                reading.value,

              displayValue:
                reading.displayValue,

              unit:
                reading.unit,

              sourceEcu:
                reading.sourceEcu,

              command:
                reading.command,

              payloadHex:
                reading.payloadHex,

              status:
                "CONFIRMED",
            }),
          ),

      /*
       * Failed reads are exposed only as availability states.
       * No measurement value is attached to them.
       */
      unavailableReadings:
        live.unverifiedReadings
          .map(
            (reading) => ({
              pid:
                reading.pid,

              name:
                reading.name,

              state:
                reading.state,
            }),
          ),
    };

    if (
      live.adapterSupplyVoltage
    ) {
      const adapter =
        live.adapterSupplyVoltage;

      if (
        adapter.verified ===
          true &&
        adapter.state ===
          "verified" &&
        adapter.volts !==
          null
      ) {
        result
          .liveData
          .adapterSupplyVoltage = {
          state:
            "verified",

          verified:
            true,

          volts:
            adapter.volts,

          displayValue:
            adapter.displayValue,

          source:
            "OBD adapter / ATRV",

          status:
            "CONFIRMED",
        };
      } else {
        result
          .liveData
          .adapterSupplyVoltage = {
          state:
            adapter.state,

          verified:
            false,

          source:
            "OBD adapter / ATRV",
        };
      }
    }
  }

  const readiness =
    normalizedEvidence
      .readiness;

  if (readiness) {
    result.readiness = {
      hasVerifiedData:
        readiness
          .verifiedReports
          .length >
        0,

      verifiedEcuCount:
        readiness
          .verifiedReports
          .length,

      respondingEcus:
        [
          ...readiness
            .respondingEcus,
        ],

      note:
        readiness.note,

      reports:
        readiness
          .verifiedReports
          .map(
            (report) => ({
              sourceEcu:
                report.sourceEcu,

              engineType:
                report.engineType,

              payloadHex:
                report.payloadHex,

              completeCount:
                report.completeCount,

              incompleteCount:
                report.incompleteCount,

              unsupportedCount:
                report.unsupportedCount,

              monitors:
                report.monitors.map(
                  (monitor) => ({
                    type:
                      monitor.type,

                    state:
                      monitor.state,
                  }),
                ),

              status:
                "CONFIRMED",
            }),
          ),
    };
  }

  const freezeFrame =
    normalizedEvidence
      .freezeFrame;

  if (freezeFrame) {
    result.freezeFrame = {
      state:
        freezeFrame.state,

      verifiedFrameCount:
        freezeFrame
          .verifiedRecords
          .length,

      note:
        freezeFrame.note,

      records:
        freezeFrame
          .verifiedRecords
          .map(
            (record) => ({
              frame:
                record.frame,

              sourceEcu:
                record.sourceEcu,

              triggerDtc:
                record.triggerDtc,

              verifiedReadingCount:
                record
                  .verifiedReadings
                  .length,

              readings:
                record
                  .verifiedReadings
                  .filter(
                    (reading) =>
                      reading
                        .verified ===
                      true,
                  )
                  .map(
                    (reading) => ({
                      pid:
                        reading.pid,

                      name:
                        reading.name,

                      displayValue:
                        reading
                          .displayValue,

                      sourceEcu:
                        reading
                          .sourceEcu,

                      status:
                        "CONFIRMED",
                    }),
                  ),

              status:
                "CONFIRMED",
            }),
          ),
    };
  }

  return result;
}

/*
 * Extract only DTCs explicitly marked verified by the
 * structured OBD pipeline.
 *
 * Text-extracted codes are intentionally handled elsewhere.
 */
export function extractVerifiedObdCodes(
  normalizedEvidence,
) {
  if (
    !normalizedEvidence ||
    !isPlainObject(
      normalizedEvidence,
    )
  ) {
    return [];
  }

  const codes =
    new Set();

  const core =
    normalizedEvidence
      .coreScan;

  if (core) {
    for (
      const service of [
        core.stored,
        core.pending,
        core.permanent,
      ]
    ) {
      for (
        const dtc of
          service?.codes || []
      ) {
        if (
          dtc.verified ===
            true &&
          isDtcCode(
            dtc.code,
          )
        ) {
          codes.add(
            dtc.code,
          );
        }
      }
    }
  }

  const freezeFrame =
    normalizedEvidence
      .freezeFrame;

  if (freezeFrame) {
    for (
      const record of
        freezeFrame
          .verifiedRecords
    ) {
      const trigger =
        record.triggerDtc;

      if (
        trigger?.verified ===
          true &&
        isDtcCode(
          trigger.code,
        )
      ) {
        codes.add(
          trigger.code,
        );
      }
    }
  }

  return [
    ...codes,
  ];
}

/* ============================================================
   CORE SCAN
   ============================================================ */

function normalizeCoreScan(
  value,
) {
  if (!isPlainObject(value)) {
    return null;
  }

  return {
    milState:
      normalizeEnum(
        value.milState,
        MIL_STATES,
        "unknown",
      ),

    confirmedDtcCount:
      normalizeNullableInteger(
        value.confirmedDtcCount,
        0,
        255,
      ),

    respondingEcus:
      normalizeStringArray(
        value.respondingEcus,
        32,
        24,
      ),

    supportedPids:
      normalizePidArray(
        value.supportedPids,
      ),

    milQuery:
      normalizeQuery(
        value.milQuery,
      ),

    stored:
      normalizeDtcService(
        value.stored,
      ),

    pending:
      normalizeDtcService(
        value.pending,
      ),

    permanent:
      normalizeDtcService(
        value.permanent,
      ),
  };
}

function normalizeQuery(
  value,
) {
  if (!isPlainObject(value)) {
    return {
      state:
        "notScanned",

      rawResponse:
        "",
    };
  }

  return {
    state:
      normalizeEnum(
        value.state,
        QUERY_STATES,
        "notScanned",
      ),

    rawResponse:
      sanitizeText(
        value.rawResponse,
        16_000,
      ),
  };
}

function normalizeDtcService(
  value,
) {
  if (!isPlainObject(value)) {
    return {
      state:
        "notScanned",

      rawResponse:
        "",

      codes:
        [],
    };
  }

  const codes =
    Array.isArray(
      value.codes,
    )
      ? value.codes
          .map(
            normalizeDtc,
          )
          .filter(Boolean)
          .slice(
            0,
            64,
          )
      : [];

  return {
    state:
      normalizeEnum(
        value.state,
        QUERY_STATES,
        "notScanned",
      ),

    rawResponse:
      sanitizeText(
        value.rawResponse,
        16_000,
      ),

    codes,
  };
}

function normalizeDtc(
  value,
) {
  if (!isPlainObject(value)) {
    return null;
  }

  const code =
    normalizeDtcCode(
      value.code,
    );

  if (!code) {
    return null;
  }

  return {
    code,

    status:
      normalizeEnum(
        value.status,
        new Set([
          "stored",
          "pending",
          "permanent",
        ]),
        "",
      ),

    verified:
      value.verified ===
      true,

    sourceEcu:
      normalizeEcu(
        value.sourceEcu,
      ),
  };
}

/* ============================================================
   LIVE DATA
   ============================================================ */

function normalizeLiveData(
  value,
) {
  if (!isPlainObject(value)) {
    return null;
  }

  const verifiedReadings =
    Array.isArray(
      value.verifiedReadings,
    )
      ? value
          .verifiedReadings
          .map(
            normalizeVerifiedLiveReading,
          )
          .filter(Boolean)
          .slice(
            0,
            128,
          )
      : [];

  const unverifiedReadings =
    Array.isArray(
      value.unverifiedReadings,
    )
      ? value
          .unverifiedReadings
          .map(
            normalizeUnverifiedLiveReading,
          )
          .filter(Boolean)
          .slice(
            0,
            128,
          )
      : [];

  const requestedReadingCount =
    normalizeInteger(
      value.requestedReadingCount,
      0,
      512,
      verifiedReadings.length +
        unverifiedReadings.length,
    );

  return {
    verifiedReadingCount:
      verifiedReadings.length,

    requestedReadingCount,

    respondingEcus:
      normalizeStringArray(
        value.respondingEcus,
        32,
        24,
      ),

    verifiedReadings,

    unverifiedReadings,

    adapterSupplyVoltage:
      normalizeAdapterVoltage(
        value.adapterSupplyVoltage,
      ),
  };
}

function normalizeVerifiedLiveReading(
  value,
) {
  if (!isPlainObject(value)) {
    return null;
  }

  const pid =
    normalizePid(
      value.pid,
    );

  if (!pid) {
    return null;
  }

  /*
   * A reading is not allowed into the verified collection
   * unless the client explicitly marked it verified.
   */
  if (
    value.verified !==
    true
  ) {
    return null;
  }

  return {
    pid,

    name:
      sanitizeText(
        value.name,
        160,
      ),

    value:
      normalizeNullableNumber(
        value.value,
      ),

    displayValue:
      sanitizeText(
        value.displayValue,
        120,
      ),

    unit:
      sanitizeText(
        value.unit,
        40,
      ),

    verified:
      true,

    sourceEcu:
      normalizeEcu(
        value.sourceEcu,
      ),

    command:
      sanitizeHexLike(
        value.command,
        80,
      ),

    payloadHex:
      sanitizeHexLike(
        value.payloadHex,
        512,
      ),

    rawResponse:
      sanitizeText(
        value.rawResponse,
        8_000,
      ),
  };
}

function normalizeUnverifiedLiveReading(
  value,
) {
  if (!isPlainObject(value)) {
    return null;
  }

  const pid =
    normalizePid(
      value.pid,
    );

  if (!pid) {
    return null;
  }

  return {
    pid,

    name:
      sanitizeText(
        value.name,
        160,
      ),

    state:
      normalizeEnum(
        value.state,
        LIVE_READ_STATES,
        "error",
      ),

    verified:
      false,

    command:
      sanitizeHexLike(
        value.command,
        80,
      ),

    rawResponse:
      sanitizeText(
        value.rawResponse,
        8_000,
      ),
  };
}

function normalizeAdapterVoltage(
  value,
) {
  if (!isPlainObject(value)) {
    return null;
  }

  const state =
    normalizeEnum(
      value.state,
      ADAPTER_VOLTAGE_STATES,
      "invalidResponse",
    );

  const verified =
    value.verified ===
      true &&
    state ===
      "verified";

  return {
    state,

    verified,

    volts:
      verified
        ? normalizeNullableNumber(
            value.volts,
          )
        : null,

    displayValue:
      verified
        ? sanitizeText(
            value.displayValue,
            80,
          )
        : "",

    source:
      "OBD adapter / ATRV",

    rawResponse:
      sanitizeText(
        value.rawResponse,
        4_000,
      ),
  };
}

/* ============================================================
   READINESS
   ============================================================ */

function normalizeReadiness(
  value,
) {
  if (!isPlainObject(value)) {
    return null;
  }

  const verifiedReports =
    Array.isArray(
      value.reports,
    )
      ? value.reports
          .map(
            normalizeReadinessReport,
          )
          .filter(Boolean)
          .slice(
            0,
            32,
          )
      : [];

  return {
    hasVerifiedData:
      verifiedReports.length >
      0,

    verifiedEcuCount:
      verifiedReports.length,

    respondingEcus:
      normalizeStringArray(
        value.respondingEcus,
        32,
        24,
      ),

    note:
      sanitizeText(
        value.note,
        1_000,
      ),

    rawResponse:
      sanitizeText(
        value.rawResponse,
        12_000,
      ),

    verifiedReports,
  };
}

function normalizeReadinessReport(
  value,
) {
  if (!isPlainObject(value)) {
    return null;
  }

  const monitors =
    Array.isArray(
      value.monitors,
    )
      ? value.monitors
          .map(
            normalizeReadinessMonitor,
          )
          .filter(Boolean)
          .slice(
            0,
            64,
          )
      : [];

  return {
    sourceEcu:
      normalizeEcu(
        value.sourceEcu,
      ),

    engineType:
      normalizeEnum(
        value.engineType,
        READINESS_ENGINE_TYPES,
        "unknown",
      ),

    payloadHex:
      sanitizeHexLike(
        value.payloadHex,
        512,
      ),

    completeCount:
      normalizeInteger(
        value.completeCount,
        0,
        64,
        monitors.filter(
          (monitor) =>
            monitor.state ===
            "complete",
        ).length,
      ),

    incompleteCount:
      normalizeInteger(
        value.incompleteCount,
        0,
        64,
        monitors.filter(
          (monitor) =>
            monitor.state ===
            "incomplete",
        ).length,
      ),

    unsupportedCount:
      normalizeInteger(
        value.unsupportedCount,
        0,
        64,
        monitors.filter(
          (monitor) =>
            monitor.state ===
            "notSupported",
        ).length,
      ),

    monitors,
  };
}

function normalizeReadinessMonitor(
  value,
) {
  if (!isPlainObject(value)) {
    return null;
  }

  const type =
    sanitizeIdentifier(
      value.type,
      100,
    );

  if (!type) {
    return null;
  }

  return {
    type,

    state:
      normalizeEnum(
        value.state,
        READINESS_MONITOR_STATES,
        "unknown",
      ),
  };
}

/* ============================================================
   FREEZE FRAME
   ============================================================ */

function normalizeFreezeFrame(
  value,
) {
  if (!isPlainObject(value)) {
    return null;
  }

  const state =
    normalizeEnum(
      value.state,
      FREEZE_FRAME_STATES,
      "unverified",
    );

  const verifiedRecords =
    Array.isArray(
      value.records,
    )
      ? value.records
          .map(
            normalizeFreezeFrameRecord,
          )
          .filter(Boolean)
          .slice(
            0,
            32,
          )
      : [];

  return {
    state,

    verifiedFrameCount:
      verifiedRecords.length,

    note:
      sanitizeText(
        value.note,
        1_000,
      ),

    rawResponse:
      sanitizeText(
        value.rawResponse,
        12_000,
      ),

    verifiedRecords,
  };
}

function normalizeFreezeFrameRecord(
  value,
) {
  if (!isPlainObject(value)) {
    return null;
  }

  const frame =
    normalizeByteHex(
      value.frame,
    );

  if (!frame) {
    return null;
  }

  const verifiedReadings =
    Array.isArray(
      value.readings,
    )
      ? value.readings
          .map(
            normalizeFreezeFrameReading,
          )
          .filter(Boolean)
          .slice(
            0,
            128,
          )
      : [];

  return {
    frame,

    sourceEcu:
      normalizeEcu(
        value.sourceEcu,
      ),

    triggerDtc:
      normalizeTriggerDtc(
        value.triggerDtc,
      ),

    verifiedReadingCount:
      verifiedReadings.length,

    verifiedReadings,
  };
}

function normalizeTriggerDtc(
  value,
) {
  if (!isPlainObject(value)) {
    return null;
  }

  const code =
    normalizeDtcCode(
      value.code,
    );

  if (
    !code ||
    value.verified !==
      true
  ) {
    return null;
  }

  return {
    code,

    verified:
      true,
  };
}

function normalizeFreezeFrameReading(
  value,
) {
  if (!isPlainObject(value)) {
    return null;
  }

  if (
    value.verified !==
    true
  ) {
    return null;
  }

  const pid =
    normalizePid(
      value.pid,
    );

  if (!pid) {
    return null;
  }

  return {
    pid,

    name:
      sanitizeText(
        value.name,
        160,
      ),

    displayValue:
      sanitizeText(
        value.displayValue,
        120,
      ),

    verified:
      true,

    sourceEcu:
      normalizeEcu(
        value.sourceEcu,
      ),

    rawResponse:
      sanitizeText(
        value.rawResponse,
        8_000,
      ),
  };
}

/* ============================================================
   MODEL SERVICE REPRESENTATION
   ============================================================ */

function buildServiceForModel(
  service,
) {
  if (!service) {
    return {
      state:
        "notScanned",

      verifiedCodes:
        [],
    };
  }

  return {
    state:
      service.state,

    verifiedCodes:
      service.codes
        .filter(
          (dtc) =>
            dtc.verified ===
            true,
        )
        .map(
          (dtc) => ({
            code:
              dtc.code,

            status:
              dtc.status,

            sourceEcu:
              dtc.sourceEcu,

            statusLabel:
              "CONFIRMED",
          }),
        ),
  };
}

/* ============================================================
   LOW-LEVEL NORMALIZATION
   ============================================================ */

function isPlainObject(
  value,
) {
  return Boolean(
    value &&
      typeof value ===
        "object" &&
      !Array.isArray(
        value,
      ),
  );
}

function sanitizeText(
  value,
  maxLength,
) {
  return String(
    value ??
      "",
  )
    .replace(
      /\u0000/g,
      "",
    )
    .trim()
    .slice(
      0,
      maxLength,
    );
}

function sanitizeIdentifier(
  value,
  maxLength,
) {
  return sanitizeText(
    value,
    maxLength,
  ).replace(
    /[^a-zA-Z0-9_-]/g,
    "",
  );
}

function sanitizeHexLike(
  value,
  maxLength,
) {
  return sanitizeText(
    value,
    maxLength,
  )
    .toUpperCase()
    .replace(
      /[^0-9A-F >:\r\n-]/g,
      "",
    );
}

function normalizeEnum(
  value,
  allowed,
  fallback,
) {
  const clean =
    sanitizeText(
      value,
      100,
    );

  return allowed.has(
    clean,
  )
    ? clean
    : fallback;
}

function normalizeStringArray(
  value,
  maxItems,
  maxItemLength,
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .map(
          (item) =>
            sanitizeText(
              item,
              maxItemLength,
            ),
        )
        .filter(Boolean),
    ),
  ].slice(
    0,
    maxItems,
  );
}

function normalizeInteger(
  value,
  min,
  max,
  fallback,
) {
  const number =
    Number(value);

  if (
    !Number.isInteger(
      number,
    )
  ) {
    return fallback;
  }

  if (
    number < min ||
    number > max
  ) {
    return fallback;
  }

  return number;
}

function normalizeNullableInteger(
  value,
  min,
  max,
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number =
    Number(value);

  if (
    !Number.isInteger(
      number,
    ) ||
    number < min ||
    number > max
  ) {
    return null;
  }

  return number;
}

function normalizeNullableNumber(
  value,
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(
    number,
  )
    ? number
    : null;
}

function normalizePidArray(
  value,
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .map(
          normalizePid,
        )
        .filter(Boolean),
    ),
  ].slice(
    0,
    256,
  );
}

function normalizePid(
  value,
) {
  const clean =
    sanitizeText(
      value,
      8,
    )
      .replace(
        /^0x/i,
        "",
      )
      .toUpperCase();

  if (
    !/^[0-9A-F]{1,2}$/.test(
      clean,
    )
  ) {
    return "";
  }

  return clean.padStart(
    2,
    "0",
  );
}

function normalizeByteHex(
  value,
) {
  const clean =
    sanitizeText(
      value,
      8,
    )
      .replace(
        /^0x/i,
        "",
      )
      .toUpperCase();

  if (
    !/^[0-9A-F]{1,2}$/.test(
      clean,
    )
  ) {
    return "";
  }

  return clean.padStart(
    2,
    "0",
  );
}

function normalizeEcu(
  value,
) {
  const clean =
    sanitizeText(
      value,
      24,
    )
      .toUpperCase()
      .replace(
        /[^0-9A-F]/g,
        "",
      );

  if (
    clean.length <
      2 ||
    clean.length >
      8
  ) {
    return "";
  }

  return clean;
}

function normalizeDtcCode(
  value,
) {
  const clean =
    sanitizeText(
      value,
      16,
    ).toUpperCase();

  return isDtcCode(
    clean,
  )
    ? clean
    : "";
}

function isDtcCode(
  value,
) {
  return /^[PCBU][0-9A-F]{4}$/.test(
    String(
      value ||
        "",
    ).toUpperCase(),
  );
}
