#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const BASELINE = "1e7091c4b34e4ff8b7d77bc5c10015b6e37f0c9f";
const OUTPUT_DIR = path.resolve(__dirname, "../../docs/research");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function csvCell(value) {
  const text = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function roundRate(numerator, denominator) {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 10;
}

function increment(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

function uniqueTimelines(row) {
  const seen = new Set();
  const duplicates = [];
  const timelines = [];
  for (const [index, original] of (row.gate5?.timelines || []).entries()) {
    const timeline = { ...original, evidenceIndex: index + 1 };
    const id = timeline.target?.renderTargetId || JSON.stringify(timeline.target);
    if (seen.has(id)) {
      duplicates.push(id);
      continue;
    }
    seen.add(id);
    timelines.push(timeline);
  }
  return { timelines, duplicateTargetIds: duplicates };
}

function classifyBlocker(temporalStatus, firstBlocker) {
  const message = firstBlocker?.message || "";
  if (/open fill boundary/i.test(message)) {
    return {
      family: "SHAPE_REGION_GENERATION_OPEN_FILL_BOUNDARY",
      class: "D",
      gate: "G5",
      explanation: "The production renderer stops on an open fill boundary; correct region construction is not established.",
    };
  }
  if (/linear stroke fill/i.test(message)) {
    return {
      family: "BOUNDED_LINEAR_STROKE_FILL",
      class: "C",
      gate: "G5",
      explanation: "The first blocker is a specifically identified linear stroke fill outside the currently supported normal SolidStroke subset.",
    };
  }
  if (/motion tween interpolation/i.test(message)) {
    return {
      family: "MOTION_TWEEN_METADATA_OUTSIDE_BOUNDED_SUBSET",
      class: "D",
      gate: "G5",
      explanation: "Source metadata falls outside the production transform-only tween subset; no interpolation was guessed.",
    };
  }
  if (temporalStatus === "BLOCKED_NO_TEMPORAL_PRODUCT_ROOT") {
    return {
      family: "TEMPORAL_ROOT_NOT_EXPOSED_BY_PRODUCT_CATALOG",
      class: "E",
      gate: "G5",
      explanation: "The Scene temporal root was not present in the bounded product render-target catalog, so its reconstruction was not measured.",
    };
  }
  return null;
}

function statusForG5(status) {
  if (status === "COMPLETE") return "COMPLETE";
  if (status === "PARTIAL_BLOCKED") return "PARTIAL";
  if (status === "BLOCKED_NO_TEMPORAL_PRODUCT_ROOT") return "BLOCKED";
  if (status === "NOT_APPLICABLE_STATIC") return "NOT APPLICABLE / STATIC";
  return "UNKNOWN";
}

function makeRows(census, temporal) {
  const temporalById = new Map(temporal.results.map((row) => [row.fixtureId, row]));
  return census.results.map((source) => {
    const probe = temporalById.get(source.fixtureId);
    if (!probe) throw new Error(`Missing temporal manifest row for ${source.fixtureId}`);
    if (source.sourceSha256 !== probe.sourceSha256 || source.sourceSha256 !== probe.sourceSha256After) {
      throw new Error(`Source hash mismatch for ${source.fixtureId}`);
    }
    const { timelines, duplicateTargetIds } = uniqueTimelines(probe);
    const gate5Status = statusForG5(probe.gate5?.status);
    const isStatic = gate5Status === "NOT APPLICABLE / STATIC";
    const temporalTotals = timelines.reduce((totals, item) => {
      totals.requested += item.requestedFrameCount || 0;
      totals.resolved += item.resolvedFrameCount || 0;
      for (const [status, count] of Object.entries(item.statusCounts || {})) totals.statusCounts[status] = (totals.statusCounts[status] || 0) + count;
      return totals;
    }, { requested: 0, resolved: 0, statusCounts: { AUTHORED: 0, TWEEN_RECONSTRUCTED: 0, HELD: 0, BLOCKED: 0 } });
    const firstTimelineBlocker = timelines.find((item) => item.firstBlocker)?.firstBlocker || null;
    const blocker = classifyBlocker(probe.gate5?.status, firstTimelineBlocker);
    const noTemporalRoot = probe.gate5?.status === "BLOCKED_NO_TEMPORAL_PRODUCT_ROOT";
    const missingRoot = (probe.sceneRootDiscovery?.roots || []).find((root) => root.status === "NO_CATALOG_TARGET");
    const noCatalogMessage = missingRoot
      ? `Scene Graphic root ${missingRoot.libraryItemName} was not exposed by the bounded production render-target catalog (catalog candidates=${source.gate1.productCatalogCandidateCount}).`
      : "Scene temporal root was not exposed by the bounded production render-target catalog.";
    const gate5FirstBlocker = firstTimelineBlocker || (noTemporalRoot ? { code: "NO_CATALOG_TARGET", gate: "G5", message: noCatalogMessage } : null);
    const completedClips = timelines
      .filter((item) => item.completeReviewClip?.status === "PRODUCED" && item.completeReviewClip?.decodedByFfmpeg)
      .map((item) => ({
        renderTargetId: item.target?.renderTargetId,
        frameCount: item.completeReviewClip.frameCount,
        frameRate: item.completeReviewClip.sourceFrameRate,
        sha256: item.completeReviewClip.sha256,
        path: path.join(probe.evidenceDirectory, "timelines", String(item.evidenceIndex).padStart(2, "0"), "review.mp4"),
      }));

    let finalClass = blocker?.class || "E";
    let blockerFamily = blocker?.family || "VISUAL_REFERENCE_AND_PRODUCT_REVIEW_PENDING";
    let firstBlocker = blocker
      ? `${blocker.gate}: ${firstTimelineBlocker?.message || noCatalogMessage}`
      : "G3: No independent authored reference or maintainer visual review is available; no technical blocker was observed through the measured path.";
    if (isStatic) firstBlocker = "G3: No independent authored reference or maintainer visual review is available; static reconstruction coherence remains unconfirmed.";

    const gates = {
      G0: {
        status: source.gate0.status,
        parseResult: source.gate0.parseResult,
        normalizationAppliedInMemory: Boolean(source.gate0.normalization?.applied),
        normalizationMode: source.gate0.normalization?.mode || "none",
        originalSourceWritten: source.gate0.normalization?.originalBytesWritten === true,
        fatalBlocker: source.gate0.fatalBlocker,
      },
      G1: {
        status: source.gate1.status,
        candidateCount: source.gate1.productCatalogCandidateCount,
        candidateTypes: source.gate1.candidateTypes,
        blankCandidateCount: source.gate1.blankCandidateCount,
        exactDuplicateCandidateGroupCount: source.gate1.exactDuplicateCandidateGroupCount,
        likelyUsefulAuthoredRootFoundHeuristically: source.gate1.likelyUsefulAuthoredRootFound,
      },
      G2: {
        status: "PARTIAL",
        probeStatus: source.gate2.status,
        authoredStateCandidateCount: source.gate2.authoredStateCandidateCount,
        renderedCandidateCount: source.gate2.renderedCandidateCount,
        blankCount: source.gate2.blankCount,
        exactDuplicateGroupCount: source.gate2.exactDuplicateGroupCount,
        renderFailureCount: source.gate2.renderFailureCount,
        unsupportedCount: source.gate2.unsupportedCount,
        repeatDeterminism: {
          candidateDiscoveryIdentical: source.gate2.repeatDeterminism?.candidateDiscoveryIdentical === true,
          renderArtifactsIdentical: source.gate2.repeatDeterminism?.renderArtifactsIdentical === true,
        },
        contactSheetStatus: source.gate2.contactSheet?.status || "NOT PRODUCED",
        note: "Candidate output exists, but this probe's PASS is not a coherence or visual-correctness sign-off.",
      },
      G3: {
        status: "REFERENCE UNAVAILABLE",
        humanReview: "PENDING",
        note: "No independent authored reference screenshots or maintainer visual sign-off were supplied.",
      },
      G4: isStatic
        ? { status: "NOT APPLICABLE / STATIC" }
        : {
            status: "PARTIAL",
            sourceClassification: source.temporal?.classification || null,
            probeAssessment: source.temporal?.g4 || "NEEDS_FAMILY_REVIEW",
            sourceTimelineCount: probe.sourceStructure?.totalTimelineCount ?? null,
            temporalTimelineCount: source.temporal?.temporalTimelineCount ?? null,
            sourceFrameCount: probe.sourceStructure?.frameCount ?? null,
            tweenCount: probe.sourceStructure?.tweenCount ?? null,
            graphicCount: probe.sourceStructure?.graphicCount ?? null,
            movieClipCount: probe.sourceStructure?.movieClipCount ?? null,
            rootTimelineCount: timelines.length,
            timelineFacts: (source.temporal?.timelineFacts || []).map((fact) => ({
              ownerKind: fact.ownerKind,
              ownerName: fact.ownerName,
              sourceIndex: fact.sourceIndex,
              frameCount: fact.frameCount,
              visibleLayerCount: fact.visibleLayerCount,
              authoredStartCount: fact.authoredStartCount,
              tweenSpanCount: fact.tweenSpanCount,
              sceneAdapterSpanIndexExposed: fact.sceneAdapterSpanIndexExposed,
              catalogInitialFrameCandidateCount: fact.catalogInitialFrameCandidateCount,
            })),
            rootDiscovery: {
              method: probe.sceneRootDiscovery?.method || null,
              sourceHasTemporalFacts: probe.sceneRootDiscovery?.sourceHasTemporalFacts ?? null,
              temporalRootInstanceCount: probe.sceneRootDiscovery?.temporalRootInstanceCount ?? null,
              temporalRootCount: probe.sceneRootDiscovery?.temporalRootCount ?? null,
              roots: (probe.sceneRootDiscovery?.roots || []).map((root) => ({
                sceneIndex: root.sceneIndex,
                libraryItemName: root.libraryItemName,
                symbolType: root.symbolType,
                renderTargetId: root.target?.renderTargetId || null,
                previewSupported: root.previewSupported,
                status: root.status,
              })),
            },
            note: "Structural timeline/frame/span facts were captured; a complete authored semantic-family review remains open.",
          },
      G5: {
        status: gate5Status,
        rootTimelineCount: timelines.length,
        requestedFrameCount: temporalTotals.requested,
        resolvedFrameCount: temporalTotals.resolved,
        statusCounts: temporalTotals.statusCounts,
        firstBlocker: gate5FirstBlocker,
        completeDecodedClipCount: completedClips.length,
        timelines: timelines.map((item) => ({
          renderTargetId: item.target?.renderTargetId,
          label: item.target?.userLabel || item.target?.sourceLibraryItemName || null,
          sourceFrameCount: item.sourceFrameCount,
          frameSpanFacts: item.frameSpanFacts,
          requestedFrameCount: item.requestedFrameCount,
          resolvedFrameCount: item.resolvedFrameCount,
          statusCounts: item.statusCounts,
          complete: item.complete,
          firstBlocker: item.firstBlocker,
          clip: item.completeReviewClip?.status === "PRODUCED" ? item.completeReviewClip : null,
        })),
      },
      G6: blocker || noTemporalRoot
        ? {
            status: "NOT PRODUCT USABLE",
            note: "The currently measured temporal asset path cannot expose a complete usable result for the authored action.",
          }
        : {
            status: "UNKNOWN",
            note: "An ordinary creator flow and visual/product acceptance were not measured.",
          },
    };

    const sheet = source.artifactEvidence?.contactSheet;
    const contactSheetPath = sheet?.status === "PRODUCED"
      ? path.join(source.artifactEvidence.run1, sheet.png?.path || "contact-sheet.png")
      : null;
    return {
      fixtureId: source.fixtureId,
      category: source.category,
      filename: source.filename,
      sourcePath: source.sourcePath,
      sourceSha256: source.sourceSha256,
      sourceShaUnchanged: source.sourceShaUnchanged && probe.sourceHashUnchanged,
      variantGroup: source.category === "PROP" && source.filename.startsWith("草药 仙草 灵植") ? "herb-asset-two-source-files" : null,
      staticOrTemporal: isStatic ? "STATIC" : "TEMPORAL",
      source: {
        document: source.productionInspection?.document || null,
        structure: probe.sourceStructure,
        inMemoryNormalization: source.gate0.normalization || null,
      },
      gates,
      finalClass,
      firstBlocker,
      blockerFamily,
      blockerClassExplanation: blocker?.explanation || "The measured engine path did not establish a failing semantic; this row remains SOURCE_OR_UNKNOWN pending visual and product review.",
      evidence: {
        staticRun1: source.artifactEvidence?.run1,
        staticRun2: source.artifactEvidence?.run2,
        candidateRenderIndex: source.artifactEvidence?.candidateRenderIndex || null,
        contactSheet: contactSheetPath,
        contactSheetStatus: sheet?.status || "NOT PRODUCED",
        temporalReceipt: probe.receiptPath,
        temporalEvidenceDirectory: probe.evidenceDirectory,
        completeDecodedClips: completedClips,
      },
      notes: [
        "The Issue #706 static probe's NESTED_GRAPHIC_TIMING / UNKNOWN_SEMANTIC strings are preliminary legacy observations and are not used as final blocker classifications.",
        duplicateTargetIds.length ? `The temporal manifest contained ${duplicateTargetIds.length} duplicate root target row(s); this report deduplicated by renderTargetId.` : "",
        noTemporalRoot ? "The source contains temporal facts, but the Scene temporal root was not returned in the 64-entry product catalog." : "",
      ].filter(Boolean),
    };
  });
}

function summarize(rows) {
  const categories = ["CHARACTER", "PROP", "EFFECT"];
  const categorySummary = {};
  const total = rows.length;
  const classes = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  const gates = {
    G0: { PASS: 0, PARTIAL: 0, BLOCKED: 0, UNKNOWN: 0 },
    G1: { PASS: 0, PARTIAL: 0, BLOCKED: 0, UNKNOWN: 0 },
    G2: { PASS: 0, PARTIAL: 0, BLOCKED: 0, UNKNOWN: 0 },
    G3: { HUMAN_PASS: 0, HUMAN_PARTIAL: 0, HUMAN_FAIL: 0, NO_REVIEWABLE_OUTPUT: 0, REFERENCE_UNAVAILABLE: 0 },
    G4: { UNDERSTOOD: 0, PARTIAL_OR_NEEDS_REVIEW: 0, BLOCKED: 0, NOT_APPLICABLE_STATIC: 0 },
    G5: { COMPLETE: 0, PARTIAL: 0, BLOCKED: 0, NOT_APPLICABLE_STATIC: 0 },
    G6: { PRODUCT_READY: 0, ENGINE_READY_PRODUCT_GAP: 0, NOT_PRODUCT_USABLE: 0, UNKNOWN: 0 },
  };
  let authored = 0;
  let rendered = 0;
  let blanks = 0;
  let duplicates = 0;
  let requestedFrames = 0;
  let resolvedFrames = 0;
  let clips = 0;
  const temporalStatusCounts = { AUTHORED: 0, TWEEN_RECONSTRUCTED: 0, HELD: 0, BLOCKED: 0 };

  for (const row of rows) {
    increment(classes, row.finalClass);
    increment(gates.G0, row.gates.G0.status);
    increment(gates.G1, row.gates.G1.status);
    increment(gates.G2, row.gates.G2.status);
    increment(gates.G3, "REFERENCE_UNAVAILABLE");
    if (row.gates.G4.status === "NOT APPLICABLE / STATIC") increment(gates.G4, "NOT_APPLICABLE_STATIC");
    else increment(gates.G4, "PARTIAL_OR_NEEDS_REVIEW");
    const g5 = row.gates.G5.status;
    increment(gates.G5, g5 === "NOT APPLICABLE / STATIC" ? "NOT_APPLICABLE_STATIC" : g5);
    const g6 = row.gates.G6.status;
    increment(gates.G6, g6 === "PRODUCT READY" ? "PRODUCT_READY" : g6 === "ENGINE READY / PRODUCT GAP" ? "ENGINE_READY_PRODUCT_GAP" : g6.replaceAll(" ", "_"));
    authored += row.gates.G2.authoredStateCandidateCount;
    rendered += row.gates.G2.renderedCandidateCount;
    blanks += row.gates.G2.blankCount;
    duplicates += row.gates.G2.exactDuplicateGroupCount;
    requestedFrames += row.gates.G5.requestedFrameCount;
    resolvedFrames += row.gates.G5.resolvedFrameCount;
    for (const [status, count] of Object.entries(row.gates.G5.statusCounts)) temporalStatusCounts[status] = (temporalStatusCounts[status] || 0) + count;
    clips += row.gates.G5.completeDecodedClipCount;
  }

  for (const category of categories) {
    const subset = rows.filter((row) => row.category === category);
    const classCounts = { A: 0, B: 0, C: 0, D: 0, E: 0 };
    for (const row of subset) increment(classCounts, row.finalClass);
    const productReady = classCounts.A;
    const engineRenderable = classCounts.A + classCounts.B;
    categorySummary[category] = {
      total: subset.length,
      productReadyCount: productReady,
      productReadyRatePercent: roundRate(productReady, subset.length),
      engineRenderableCount: engineRenderable,
      engineRenderableRatePercent: roundRate(engineRenderable, subset.length),
      candidateCount: subset.reduce((sum, row) => sum + row.gates.G1.candidateCount, 0),
      authoredStateCandidateCount: subset.reduce((sum, row) => sum + row.gates.G2.authoredStateCandidateCount, 0),
      renderedCandidateCount: subset.reduce((sum, row) => sum + row.gates.G2.renderedCandidateCount, 0),
      temporalFiles: subset.filter((row) => row.staticOrTemporal === "TEMPORAL").length,
      completeTemporalFiles: subset.filter((row) => row.gates.G5.status === "COMPLETE").length,
      classCounts,
    };
  }

  const productReady = classes.A;
  const engineRenderable = classes.A + classes.B;
  const temporalFiles = rows.filter((row) => row.staticOrTemporal === "TEMPORAL");
  const structureFields = ["sceneCount", "totalTimelineCount", "layerCount", "frameCount", "tweenCount", "symbolCount", "movieClipCount", "graphicCount", "buttonCount"];
  const structureTotals = (subset) => Object.fromEntries(structureFields.map((field) => [field, subset.reduce((sum, row) => sum + (row.source.structure?.[field] || 0), 0)]));
  const blockerConcentration = [
    { family: "SHAPE_REGION_GENERATION_OPEN_FILL_BOUNDARY", fileCount: rows.filter((row) => row.blockerFamily === "SHAPE_REGION_GENERATION_OPEN_FILL_BOUNDARY").length, categoryCount: 1, representativeFixtures: rows.filter((row) => row.blockerFamily === "SHAPE_REGION_GENERATION_OPEN_FILL_BOUNDARY").map((row) => row.filename), firstGate: "G5", likelyClass: "D — NEW_SEMANTIC_FAMILY" },
    { family: "BOUNDED_LINEAR_STROKE_FILL", fileCount: rows.filter((row) => row.blockerFamily === "BOUNDED_LINEAR_STROKE_FILL").length, categoryCount: 1, representativeFixtures: rows.filter((row) => row.blockerFamily === "BOUNDED_LINEAR_STROKE_FILL").map((row) => row.filename), firstGate: "G5", likelyClass: "C — BOUNDED_ENGINE_GAP" },
    { family: "MOTION_TWEEN_METADATA_OUTSIDE_BOUNDED_SUBSET", fileCount: rows.filter((row) => row.blockerFamily === "MOTION_TWEEN_METADATA_OUTSIDE_BOUNDED_SUBSET").length, categoryCount: 1, representativeFixtures: rows.filter((row) => row.blockerFamily === "MOTION_TWEEN_METADATA_OUTSIDE_BOUNDED_SUBSET").map((row) => row.filename), firstGate: "G5", likelyClass: "D — NEW_SEMANTIC_FAMILY" },
    { family: "TEMPORAL_ROOT_NOT_EXPOSED_BY_PRODUCT_CATALOG", fileCount: rows.filter((row) => row.blockerFamily === "TEMPORAL_ROOT_NOT_EXPOSED_BY_PRODUCT_CATALOG").length, categoryCount: 1, representativeFixtures: rows.filter((row) => row.blockerFamily === "TEMPORAL_ROOT_NOT_EXPOSED_BY_PRODUCT_CATALOG").map((row) => row.filename), firstGate: "G5", likelyClass: "E — SOURCE_OR_UNKNOWN / PRODUCT GAP SUSPECTED" },
    { family: "VISUAL_REFERENCE_AND_PRODUCT_REVIEW_PENDING", fileCount: rows.filter((row) => row.blockerFamily === "VISUAL_REFERENCE_AND_PRODUCT_REVIEW_PENDING").length, categoryCount: new Set(rows.filter((row) => row.blockerFamily === "VISUAL_REFERENCE_AND_PRODUCT_REVIEW_PENDING").map((row) => row.category)).size, representativeFixtures: rows.filter((row) => row.blockerFamily === "VISUAL_REFERENCE_AND_PRODUCT_REVIEW_PENDING").slice(0, 5).map((row) => row.filename), firstGate: "G3/G6", likelyClass: "E — SOURCE_OR_UNKNOWN" },
  ];
  const technicalBlockers = blockerConcentration.filter((item) => item.family !== "VISUAL_REFERENCE_AND_PRODUCT_REVIEW_PENDING" && item.fileCount > 0).sort((left, right) => right.fileCount - left.fileCount);
  return {
    total,
    categories: categorySummary,
    productReadyRate: { count: productReady, total, percent: roundRate(productReady, total) },
    engineRenderableRate: { count: engineRenderable, total, percent: roundRate(engineRenderable, total) },
    classes,
    gates,
    uniqueBlockerFamilyCount: blockerConcentration.filter((item) => item.fileCount > 0).length,
    uniqueTechnicalBlockerFamilyCount: technicalBlockers.length,
    topThreeTechnicalBlockerFamilies: technicalBlockers.slice(0, 3),
    candidateOutput: {
      productCatalogTargetCount: rows.reduce((sum, row) => sum + row.gates.G1.candidateCount, 0),
      authoredStateCandidateCount: authored,
      renderedCandidateCount: rendered,
      renderedCandidateRatePercent: roundRate(rendered, authored),
      blankCandidateCount: blanks,
      exactDuplicateGroupCount: duplicates,
      filesWithAtLeastOneRenderedCandidate: rows.filter((row) => row.gates.G2.renderedCandidateCount > 0).length,
      repeatDeterministicFiles: rows.filter((row) => row.gates.G2.repeatDeterminism.candidateDiscoveryIdentical && row.gates.G2.repeatDeterminism.renderArtifactsIdentical).length,
    },
    temporal: {
      fileCount: temporalFiles.length,
      staticFileCount: total - temporalFiles.length,
      completeFileCount: temporalFiles.filter((row) => row.gates.G5.status === "COMPLETE").length,
      partialFileCount: temporalFiles.filter((row) => row.gates.G5.status === "PARTIAL").length,
      blockedFileCount: temporalFiles.filter((row) => row.gates.G5.status === "BLOCKED").length,
      requestedFrameCount: requestedFrames,
      resolvedFrameCount: resolvedFrames,
      blockedOrUnresolvedFrameCount: requestedFrames - resolvedFrames,
      resolvedFrameRatePercent: roundRate(resolvedFrames, requestedFrames),
      statusCounts: temporalStatusCounts,
      uniqueCompleteDecodedClipCount: clips,
      sourceStructureTotals: structureTotals(rows),
      sourceStructureTotalsByCategory: Object.fromEntries(categories.map((category) => [category, structureTotals(rows.filter((row) => row.category === category))])),
    },
    visualEvidence: {
      contactSheetCount: rows.filter((row) => row.evidence.contactSheetStatus === "PRODUCED").length,
      contactSheetMissingDueRenderBudget: rows.filter((row) => row.evidence.contactSheetStatus === "BLOCKED_RENDER_BUDGET").map((row) => row.filename),
      allFilesHaveCandidateRenderIndex: rows.filter((row) => row.evidence.candidateRenderIndex).length,
      g3HumanPass: 0,
      g3HumanPartial: 0,
      g3HumanFail: 0,
      g3ReferenceUnavailable: total,
    },
    variants: [{ id: "herb-asset-two-source-files", rawCorpusCount: 2, note: "Both source files remain separate in the denominator." }],
    blockerConcentration,
  };
}

function renderMarkdown(report) {
  const summary = report.summary;
  const categoryRows = ["CHARACTER", "PROP", "EFFECT"].map((category) => {
    const value = summary.categories[category];
    return `| ${category} | ${value.total} | ${value.productReadyCount}/${value.total} (${value.productReadyRatePercent}%) | ${value.engineRenderableCount}/${value.total} (${value.engineRenderableRatePercent}%) | ${value.temporalFiles} | ${value.completeTemporalFiles} | ${value.renderedCandidateCount}/${value.authoredStateCandidateCount} |`;
  }).join("\n");
  const classRows = Object.entries(summary.classes).map(([key, count]) => `| ${key} | ${count} |`).join("\n");
  const blockerRows = summary.blockerConcentration.map((item) => `| ${item.family} | ${item.fileCount} | ${item.categoryCount} | ${item.firstGate} | ${item.likelyClass} | ${item.representativeFixtures.join("、")} |`).join("\n");
  const inventory = report.inventory.categories;
  return `# Issue #732 — Cross-Category FLA Capability Census\n\n` +
    `- Issue: [#732](https://github.com/Cognitive-Architect/panda-stage/issues/732)\n` +
    `- Mother PR: [#677](https://github.com/Cognitive-Architect/panda-stage/pull/677) (OPEN / DRAFT at report generation)\n` +
    `- Frozen baseline: \`${report.baseline.commit}\`\n` +
    `- Corpus: ${summary.total} FLAs (characters ${inventory.CHARACTER.expectedCount}, props ${inventory.PROP.expectedCount}, effects ${inventory.EFFECT.expectedCount})\n` +
    `- Inventory delta from maintainer list: none; recursive filesystem census exactly matched 28 expected files.\n` +
    `- Source hashes: 28 recorded; all unchanged after both probes.\n` +
    `- Production changes / FLA mutations / fixture workarounds: 0 / 0 / 0.\n\n` +
    `## Capability summary\n\n` +
    `The baseline safely parsed all ${summary.total} sources, found at least one product catalog candidate in each, and emitted ${summary.candidateOutput.renderedCandidateCount} candidate previews from ${summary.candidateOutput.authoredStateCandidateCount} authored-state rows. The preview emission rate is ${(summary.candidateOutput.renderedCandidateRatePercent ?? 0).toFixed(1)}%; it is not a correctness or product-readiness rate. The static probe repeated deterministically for ${summary.candidateOutput.repeatDeterministicFiles}/${summary.total} files.\n\n` +
    `The production frame-sequence seam completed ${summary.temporal.completeFileCount}/${summary.temporal.fileCount} temporal files and ${summary.temporal.uniqueCompleteDecodedClipCount} unique root-timeline clips. It resolved ${summary.temporal.resolvedFrameCount}/${summary.temporal.requestedFrameCount} requested frames (${summary.temporal.resolvedFrameRatePercent}%): ${summary.temporal.statusCounts.AUTHORED} AUTHORED, ${summary.temporal.statusCounts.TWEEN_RECONSTRUCTED} TWEEN_RECONSTRUCTED, ${summary.temporal.statusCounts.HELD} HELD, and ${summary.temporal.statusCounts.BLOCKED} BLOCKED. The seven remaining temporal files are split across six renderer-blocked sources and one source whose Scene temporal root was not exposed by the bounded product catalog.\n\n` +
    `No independent authored reference images or maintainer visual sign-off were available. Therefore G3 is REFERENCE UNAVAILABLE for all ${summary.total} files. Strict Issue-defined Product Ready and Engine Renderable rates (A and A+B) are both ${summary.productReadyRate.count}/${summary.total}; this is an evidence-conservative rate, not a claim that no output was produced. Seven-gate and per-file details are in [CSV](issue-732-cross-category-capability-census.csv) and [JSON](issue-732-cross-category-capability-census.json).\n\n` +
    `## Category results\n\n` +
    `| Category | Total | Product ready | Engine renderable (A+B) | Temporal | G5 complete | Candidate previews / authored states |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n${categoryRows}\n\n` +
    `## Class distribution\n\n| Class | Files |\n| --- | ---: |\n${classRows}\n\n` +
    `A/B remain zero because the Issue requires visual correctness and product usability, neither of which was signed off. C is reserved for the two explicitly identified linear-stroke-fill blockers. D covers three open-fill-boundary sources and one motion-tween source outside the bounded transform-only subset. E covers the catalog-root omission and files whose source/product correctness remains unknown pending review.\n\n` +
    `## Blocker concentration\n\n| Family | Files | Categories | First gate | Likely class | Representative files |\n| --- | ---: | ---: | --- | --- | --- |\n${blockerRows}\n\n` +
    `Observed outcome families: ${summary.uniqueBlockerFamilyCount} total, including ${summary.uniqueTechnicalBlockerFamilyCount} concrete engine/product blocker families and one visual/product-review evidence family. The largest three concrete families are ${summary.topThreeTechnicalBlockerFamilies.map((item, index) => `${index + 1}) ${item.family} (${item.fileCount})`).join("; ")}.\n\n` +
    `The legacy Issue #706 probe's \`NESTED_GRAPHIC_TIMING\` and \`UNKNOWN_SEMANTIC\` labels are preliminary observations only. The final blocker grouping uses the production temporal seam's exact first failure; the legacy labels were not counted as final semantic families.\n\n` +
    `## Gate rollup\n\n` +
    `- G0: PASS ${summary.gates.G0.PASS}/${summary.total}; 25 sources used in-memory archive normalization and 3 parsed without it. Source bytes were never written.\n` +
    `- G1: PASS ${summary.gates.G1.PASS}/${summary.total}; candidate discovery is heuristic and does not prove product identity.\n` +
    `- G2: ${summary.gates.G2.PARTIAL}/${summary.total} partial pending coherence review; rendered output exists for ${summary.candidateOutput.filesWithAtLeastOneRenderedCandidate}/${summary.total}. Strict coherent-static confirmation remains 0 until review.\n` +
    `- G3: HUMAN PASS 0; PARTIAL 0; FAIL 0; REFERENCE UNAVAILABLE ${summary.gates.G3.REFERENCE_UNAVAILABLE}. Contact sheets exist for ${summary.visualEvidence.contactSheetCount}/${summary.total}; the two over-budget files retain individual candidate render indexes. Seven limited exploratory visual spot checks were not counted as acceptance.\n` +
    `- G4: structural temporal facts captured for ${summary.temporal.fileCount} files; source probes still mark family review as needed. Static N/A ${summary.temporal.staticFileCount}.\n` +
    `- G5: complete ${summary.temporal.completeFileCount}; partial ${summary.temporal.partialFileCount}; blocked/no catalog root ${summary.temporal.blockedFileCount}; static N/A ${summary.temporal.staticFileCount}.\n` +
    `- G6: not product usable ${summary.gates.G6.NOT_PRODUCT_USABLE}; unknown ${summary.gates.G6.UNKNOWN}; product-ready 0; engine-ready/product-gap 0.\n\n` +
    `## Interpretation and next action\n\n` +
    `Current measured boundary: Panda parses this mixed corpus and emits candidate previews across all three categories. On the production temporal path it reconstructs complete source-timed sequences for 14 temporal files; it stops on open fill boundaries, linear stroke fills, one out-of-subset motion tween, and one catalog-root omission. These results do not establish that the candidates are visually faithful or directly usable by an ordinary creator.\n\n` +
    `Biggest product question: whether candidate fragments, repeated states, and multi-view characters can be organized into an ordinary creator-facing asset. The census did not validate that flow.\n\n` +
    `Biggest engine/semantic gap by repeated files: open-fill boundary / Shape Region Generation (3 character files), followed by linear stroke fill (2 character files).\n\n` +
    `Recommended next investment: maintainer reviews the 26 contact sheets and the two over-budget candidate indexes, supplies or identifies authored references where possible, and records G3/G6. Then decide whether the three-file open-fill family merits a bounded evidence issue.\n\n` +
    `### Evidence locations\n\n` +
    `- Static census: \`${report.evidence.staticDirectory}\`\n` +
    `- Temporal production probe: \`${report.evidence.temporalDirectory}\`\n` +
    `- Contact sheets / frame PNGs / decoded MP4s remain outside the repository under those acceptance directories. The JSON and CSV carry per-file source hashes and artifact paths.\n`;
}

function main() {
  const staticDir = path.resolve(process.argv[2] || "D:/PandaStage-Acceptance/issue732-b5u-round1-20261007b");
  const temporalDir = path.resolve(process.argv[3] || "D:/PandaStage-Acceptance/issue732-b5u-temporal-20261007-v2");
  const census = readJson(path.join(staticDir, "census-manifest.json"));
  const temporal = readJson(path.join(temporalDir, "temporal-batch-manifest.json"));
  if (census.baseline?.commit !== BASELINE || census.baseline?.currentHead !== BASELINE || temporal.baseline !== BASELINE) {
    throw new Error("Frozen baseline mismatch; refusing to build Issue #732 report.");
  }
  if (!census.inventory?.exactInventoryMatch || census.fileCount !== 28 || temporal.fileCount !== 28) {
    throw new Error("Census inventory/file count mismatch; refusing to build Issue #732 report.");
  }
  if (census.sourceIntegrity.some((entry) => !entry.unchanged) || temporal.sourceHashInvariant !== true) {
    throw new Error("Source hash invariant failed; refusing to build Issue #732 report.");
  }
  const files = makeRows(census, temporal);
  if (files.length !== 28 || files.some((row) => !row.sourceShaUnchanged)) throw new Error("Per-file census validation failed.");
  const report = {
    schemaVersion: "issue732-cross-category-capability-report/1",
    issue: 732,
    title: "Stage B5-U Research: FLA Real-World Capability Census — Cross-Category Baseline",
    baseline: { commit: BASELINE, productionFilesChanged: 0, sourceFlaMutations: 0, fixtureSpecificWorkarounds: 0, newSemanticImplementations: 0 },
    inventory: census.inventory,
    sourceIntegrity: census.sourceIntegrity,
    evidence: { staticDirectory: staticDir, temporalDirectory: temporalDir, staticManifest: path.join(staticDir, "census-manifest.json"), temporalManifest: path.join(temporalDir, "temporal-batch-manifest.json") },
    methodology: {
      staticProbe: "Existing Issue #706 Electron inspection/candidate discovery and render seam, run twice per source.",
      temporalProbe: "Current Preload production chooseAndInspect/staticSnapshotCatalog/frameSequenceRender path; source normalization is in memory only; no project commit API.",
      temporalRootSelection: "Visible Scene frame-0 Graphic instances matched against the production render-target catalog.",
      deduplication: "Temporal roots deduplicated by renderTargetId; the pre-dedupe 黑袍大师兄 receipt duplicate is excluded from totals.",
      reviewLimit: "No independent authored-reference images or maintainer human visual/product sign-off were available. Assistant spot checks do not count as G3 PASS.",
      exploratoryVisualSpotChecks: ["生气.fla", "储物袋.fla", "草药 仙草 灵植.fla", "汉服修仙女.fla", "蓝白古装男.fla", "青绫修仙女（四视角）.fla", "修仙宗门圣女（四视角）.fla"],
      caveat: "G2 probe PASS means candidate outputs were emitted; this report keeps G2 PARTIAL until coherence review. PNG existence is not visual acceptance.",
    },
    summary: null,
    files,
  };
  report.summary = summarize(files);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, "issue-732-cross-category-capability-census.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const columns = ["category", "filename", "source_sha256", "static_or_temporal", "G0", "G1", "G2", "G3", "G4", "G5", "G6", "final_class_A_E", "first_blocker", "blocker_family", "review_artifact", "notes"];
  const csvRows = files.map((row) => [
    row.category,
    row.filename,
    row.sourceSha256,
    row.staticOrTemporal,
    row.gates.G0.status,
    row.gates.G1.status,
    row.gates.G2.status,
    row.gates.G3.status,
    row.gates.G4.status,
    row.gates.G5.status,
    row.gates.G6.status,
    row.finalClass,
    row.firstBlocker,
    row.blockerFamily,
    row.evidence.contactSheet || row.evidence.staticRun1 || row.evidence.temporalEvidenceDirectory,
    row.notes.join(" "),
  ].map(csvCell).join(","));
  fs.writeFileSync(path.join(OUTPUT_DIR, "issue-732-cross-category-capability-census.csv"), `${columns.join(",")}\n${csvRows.join("\n")}\n`, "utf8");
  fs.writeFileSync(path.join(OUTPUT_DIR, "issue-732-cross-category-capability-census.md"), renderMarkdown(report), "utf8");
  process.stdout.write(JSON.stringify({ outputDirectory: OUTPUT_DIR, fileCount: files.length, summary: report.summary }, null, 2));
}

main();
