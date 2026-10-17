// Issue #741 research only. Creates tiny Animate FLA fixtures once, then
// reopens those files read-only to capture Shape/Contour/HalfEdge evidence.
// All generated files live outside the repository.
(function issue741AnimateFixtureSuite() {
    var ROOT_PATH = "D:\\PandaStage-Acceptance\\issue741-repair-contract-20261009";
    var FIXTURE_PATH = ROOT_PATH + "\\fixtures";
    var CAPTURE_ROOT_PATH = ROOT_PATH + "\\animate-captures";
    var MANIFEST_PATH = ROOT_PATH + "\\authoring-manifest.json";
    var PAINT = "#D64242";
    var STAGE_WIDTH = 360;
    var STAGE_HEIGHT = 280;
    var MAX_HALF_EDGES_PER_CONTOUR = 10000;
    var MAX_SHAPE_DEPTH = 32;
    var FIXTURES = [
        {
            key: "D-A-authored-close",
            family: "D",
            variant: "authored-close",
            fileName: "D-A-authored-close.fla",
            closeMode: "path-close",
            points: [[95, 90], [265, 90], [180, 220]]
        },
        {
            key: "D-B-explicit-close",
            family: "D",
            variant: "explicit-closing-edge",
            fileName: "D-B-explicit-close.fla",
            closeMode: "explicit-return-point",
            points: [[95, 90], [265, 90], [180, 220]]
        },
        {
            key: "B-A-clockwise-explicit",
            family: "B",
            variant: "clockwise-explicit-boundary",
            fileName: "B-A-clockwise-explicit.fla",
            closeMode: "explicit-return-point",
            points: [[95, 90], [265, 90], [180, 220]]
        },
        {
            key: "B-B-counterclockwise-explicit",
            family: "B",
            variant: "counterclockwise-explicit-boundary",
            fileName: "B-B-counterclockwise-explicit.fla",
            closeMode: "explicit-return-point",
            points: [[95, 90], [180, 220], [265, 90]]
        },
        {
            key: "control-explicit-closed",
            family: "control",
            variant: "known-good-explicit-closed-triangle",
            fileName: "control-explicit-closed.fla",
            closeMode: "explicit-return-point",
            points: [[95, 90], [265, 90], [180, 220]]
        }
    ];

    function read(object, propertyName) {
        try {
            if (object === undefined || object === null) return null;
            var value = object[propertyName];
            return value === undefined || value === null ? null : value;
        } catch (error) { return null; }
    }

    function call(object, methodName, args) {
        try {
            if (object === undefined || object === null || typeof object[methodName] !== "function") return null;
            return object[methodName].apply(object, args || []);
        } catch (error) { return null; }
    }

    function asString(value) {
        if (value === undefined || value === null) return null;
        try { return String(value); } catch (error) { return "<unprintable>"; }
    }

    function point(value) {
        if (!value) return null;
        return { x: read(value, "x"), y: read(value, "y") };
    }

    function matrix(value) {
        if (!value) return null;
        return {
            a: read(value, "a"), b: read(value, "b"), c: read(value, "c"),
            d: read(value, "d"), tx: read(value, "tx"), ty: read(value, "ty")
        };
    }

    function plain(value) {
        if (!value || typeof value.length !== "number") return [];
        var result = [];
        for (var index = 0; index < value.length; index += 1) {
            var item = value[index];
            if (item === null || item === undefined || typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
                result.push(item === undefined ? null : item);
            } else if (typeof item.x === "number" && typeof item.y === "number") {
                result.push({ x: item.x, y: item.y });
            } else result.push(asString(item));
        }
        return result;
    }

    function fillSummary(value) {
        if (!value) return null;
        return {
            style: read(value, "style"), color: read(value, "color"),
            bitmapPath: read(value, "bitmapPath"), bitmapIsClipped: read(value, "bitmapIsClipped"),
            colorArray: plain(read(value, "colorArray")), posArray: plain(read(value, "posArray")),
            focalPoint: read(value, "focalPoint"), linearRGB: read(value, "linearRGB"),
            overflow: read(value, "overflow"), matrix: matrix(read(value, "matrix"))
        };
    }

    function strokeSummary(value) {
        if (!value) return null;
        return {
            style: read(value, "style"), color: read(value, "color"), thickness: read(value, "thickness"),
            capType: read(value, "capType"), joinType: read(value, "joinType"), miterLimit: read(value, "miterLimit")
        };
    }

    function halfEdgeId(value) {
        var id = read(value, "id");
        return id === null ? null : id;
    }

    function edgeGeometry(edgeObject) {
        if (!edgeObject) return null;
        var halfEdge = call(edgeObject, "getHalfEdge");
        var opposite = call(halfEdge, "getOppositeHalfEdge");
        var controls = [];
        for (var controlIndex = 0; controlIndex < 3; controlIndex += 1) {
            controls.push(point(call(edgeObject, "getControl", [controlIndex])));
        }
        return {
            id: read(edgeObject, "id"), cubicSegmentIndex: read(edgeObject, "cubicSegmentIndex"),
            isLine: read(edgeObject, "isLine"), halfEdgeId: halfEdgeId(halfEdge),
            oppositeHalfEdgeId: halfEdgeId(opposite),
            from: point(call(opposite, "getVertex")), to: point(call(halfEdge, "getVertex")),
            controlPoints0To2: controls, stroke: strokeSummary(read(edgeObject, "stroke"))
        };
    }

    function sameHalfEdge(left, right) {
        if (!left || !right) return false;
        var leftId = halfEdgeId(left), rightId = halfEdgeId(right);
        if (leftId !== null && rightId !== null) return leftId === rightId;
        return left === right;
    }

    function walkContour(contour) {
        var start = call(contour, "getHalfEdge");
        var result = {
            interior: read(contour, "interior"), orientation: read(contour, "orientation"),
            fill: fillSummary(read(contour, "fill")), startingHalfEdgeId: halfEdgeId(start),
            closedAtStart: false, stopReason: null, halfEdges: []
        };
        if (!start) { result.stopReason = "CONTOUR_START_HALF_EDGE_MISSING"; return result; }
        var current = start;
        for (var index = 0; index < MAX_HALF_EDGES_PER_CONTOUR; index += 1) {
            var edgeObject = call(current, "getEdge");
            var next = call(current, "getNext");
            var previous = call(current, "getPrev");
            var opposite = call(current, "getOppositeHalfEdge");
            result.halfEdges.push({
                walkIndex: index, id: halfEdgeId(current), nextId: halfEdgeId(next),
                prevId: halfEdgeId(previous), oppositeId: halfEdgeId(opposite),
                edgeId: read(edgeObject, "id"), edgeIsLine: read(edgeObject, "isLine"),
                cubicSegmentIndex: read(edgeObject, "cubicSegmentIndex"),
                from: point(call(opposite, "getVertex")), to: point(call(current, "getVertex")),
                edgeGeometry: edgeGeometry(edgeObject)
            });
            if (!next) { result.stopReason = "NEXT_HALF_EDGE_MISSING"; return result; }
            if (sameHalfEdge(next, start)) {
                result.closedAtStart = true;
                result.stopReason = "RETURNED_TO_START";
                return result;
            }
            for (var seen = 0; seen < result.halfEdges.length; seen += 1) {
                if (result.halfEdges[seen].id !== null && result.halfEdges[seen].id === halfEdgeId(next)) {
                    result.stopReason = "REPEATED_NON_START_HALF_EDGE";
                    return result;
                }
            }
            current = next;
        }
        result.stopReason = "HALF_EDGE_SAFETY_LIMIT_REACHED";
        return result;
    }

    function captureShape(shape, timeline, layer, frame, layerIndex, frameArrayIndex, memberPath) {
        var edgeObjects = read(shape, "edges") || [];
        var vertexObjects = read(shape, "vertices") || [];
        var contourObjects = read(shape, "contours") || [];
        var edges = [], vertices = [], contours = [], cubicSegments = [], seenCubic = {};
        for (var edgeIndex = 0; edgeIndex < edgeObjects.length; edgeIndex += 1) {
            var edgeObject = edgeObjects[edgeIndex];
            edges.push(edgeGeometry(edgeObject));
            var cubicSegmentIndex = read(edgeObject, "cubicSegmentIndex");
            if (cubicSegmentIndex !== null && !seenCubic["index-" + cubicSegmentIndex]) {
                seenCubic["index-" + cubicSegmentIndex] = true;
                cubicSegments.push({ index: cubicSegmentIndex, points: plain(call(shape, "getCubicSegmentPoints", [cubicSegmentIndex])) });
            }
        }
        for (var vertexIndex = 0; vertexIndex < vertexObjects.length; vertexIndex += 1) {
            var vertex = vertexObjects[vertexIndex];
            vertices.push({
                index: vertexIndex, id: read(vertex, "id"), x: read(vertex, "x"), y: read(vertex, "y"),
                incidentHalfEdgeId: halfEdgeId(call(vertex, "getHalfEdge"))
            });
        }
        for (var contourIndex = 0; contourIndex < contourObjects.length; contourIndex += 1) {
            contours.push(walkContour(contourObjects[contourIndex]));
        }
        return {
            memberPath: memberPath,
            scope: {
                timelineName: read(timeline, "name"), layerIndex: layerIndex, layerName: read(layer, "name"),
                frameArrayIndex: frameArrayIndex, keyframeStartFrame: read(frame, "startFrame"),
                keyframeDuration: read(frame, "duration")
            },
            shape: {
                elementType: read(shape, "elementType"), matrix: matrix(read(shape, "matrix")),
                x: read(shape, "x"), y: read(shape, "y"), left: read(shape, "left"), top: read(shape, "top"),
                isDrawingObject: read(shape, "isDrawingObject"), isFloating: read(shape, "isFloating"),
                numCubicSegments: read(shape, "numCubicSegments"),
                edgeCount: edgeObjects.length, vertexCount: vertexObjects.length, contourCount: contourObjects.length,
                edges: edges, vertices: vertices, contours: contours, cubicSegments: cubicSegments
            }
        };
    }

    function collectTimelineShapes(doc) {
        var timelines = read(doc, "timelines") || [];
        var timelineIndex = read(doc, "currentTimeline");
        var timeline = timelines[timelineIndex] || timelines[0];
        if (!timeline) throw new Error("Document has no active timeline");
        var layers = read(timeline, "layers") || [];
        var shapes = [];
        var frameInventory = [];
        function visit(element, parentPath, depth, layer, frame, layerIndex, frameArrayIndex) {
            if (!element || depth > MAX_SHAPE_DEPTH) throw new Error("Stage element traversal exceeded the safety depth");
            var members = read(element, "members") || [];
            var elementType = read(element, "elementType");
            var memberPath = parentPath;
            if (elementType === "shape") {
                shapes.push(captureShape(element, timeline, layer, frame, layerIndex, frameArrayIndex, memberPath));
            }
            for (var memberIndex = 0; memberIndex < members.length; memberIndex += 1) {
                visit(members[memberIndex], memberPath + "/" + memberIndex, depth + 1, layer, frame, layerIndex, frameArrayIndex);
            }
        }
        for (var layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
            var layer = layers[layerIndex];
            var frames = read(layer, "frames") || [];
            for (var frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
                var frame = frames[frameIndex];
                var elements = read(frame, "elements") || [];
                frameInventory.push({
                    layerIndex: layerIndex, layerName: read(layer, "name"), frameArrayIndex: frameIndex,
                    startFrame: read(frame, "startFrame"), duration: read(frame, "duration"), elementCount: elements.length
                });
                if (read(frame, "startFrame") !== 0) continue;
                for (var elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
                    visit(elements[elementIndex], String(elementIndex), 0, layer, frame, layerIndex, frameIndex);
                }
            }
        }
        return {
            timelineName: read(timeline, "name"), frameCount: read(timeline, "frameCount"),
            layerCount: layers.length, frameInventory: frameInventory, shapes: shapes
        };
    }

    function quoteJson(value) {
        var result = "\"";
        for (var index = 0; index < value.length; index += 1) {
            var character = value.charAt(index), code = value.charCodeAt(index);
            if (character === "\"") result += "\\\"";
            else if (character === "\\") result += "\\\\";
            else if (character === "\b") result += "\\b";
            else if (character === "\f") result += "\\f";
            else if (character === "\n") result += "\\n";
            else if (character === "\r") result += "\\r";
            else if (character === "\t") result += "\\t";
            else if (code < 32 || code > 126) result += "\\u" + ("0000" + code.toString(16)).slice(-4);
            else result += character;
        }
        return result + "\"";
    }

    function json(value) {
        if (value === null || value === undefined) return "null";
        if (typeof value === "string") return quoteJson(value);
        if (typeof value === "number") return isFinite(value) ? String(value) : "null";
        if (typeof value === "boolean") return value ? "true" : "false";
        if (value instanceof Array) {
            var arrayParts = [];
            for (var arrayIndex = 0; arrayIndex < value.length; arrayIndex += 1) arrayParts.push(json(value[arrayIndex]));
            return "[" + arrayParts.join(",") + "]";
        }
        var objectParts = [];
        for (var property in value) {
            if (value.hasOwnProperty(property)) objectParts.push(quoteJson(property) + ":" + json(value[property]));
        }
        return "{" + objectParts.join(",") + "}";
    }

    function uriFromPath(value) {
        return FLfile.platformPathToURI(value);
    }

    function ensureFolder(path) {
        var uri = uriFromPath(path);
        if (!FLfile.exists(uri) && !FLfile.createFolder(uri) && !FLfile.exists(uri)) {
            throw new Error("Could not create output folder: " + path);
        }
    }

    function normalizedPath(value) {
        return asString(value) === null ? null : String(value).replace(/\//g, "\\").toLowerCase();
    }

    function createFixture(fixture, filePath) {
        var doc = null;
        try {
            doc = fl.createDocument("timeline");
            if (!doc) throw new Error("fl.createDocument returned no document");
            if (doc === originalDoc) throw new Error("fl.createDocument returned the pre-existing active document; refusing to edit it");
            doc.width = STAGE_WIDTH;
            doc.height = STAGE_HEIGHT;
            doc.backgroundColor = "#FFFFFF";
            var fill = doc.getCustomFill();
            fill.style = "solid";
            fill.color = PAINT;
            doc.setCustomFill(fill);

            var path = fl.drawingLayer.newPath();
            if (!path) throw new Error("drawingLayer.newPath returned no Path");
            for (var pointIndex = 0; pointIndex < fixture.points.length; pointIndex += 1) {
                path.addPoint(fixture.points[pointIndex][0], fixture.points[pointIndex][1]);
            }
            if (fixture.closeMode === "path-close") path.close();
            else path.addPoint(fixture.points[0][0], fixture.points[0][1]);
            path.makeShape(false, true);

            var fileUri = uriFromPath(filePath);
            if (!fl.saveDocument(doc, fileUri)) throw new Error("fl.saveDocument returned false");
            var savedPath = read(doc, "path");
            var savedPathMatches = normalizedPath(savedPath) === normalizedPath(filePath);
            if (!savedPathMatches) throw new Error("Saved FLA path differs from requested output path");
            if (read(doc, "modified") !== false) throw new Error("New fixture is still marked modified after save");
            fl.closeDocument(doc);
            doc = null;
            return { status: "CREATED_BY_ANIMATE", filePath: filePath, fileUri: fileUri, saveApiCalled: true };
        } catch (error) {
            if (doc && doc !== originalDoc) {
                try { fl.closeDocument(doc, false); } catch (closeError) {}
            }
            return { status: "AUTHORING_FAILED", filePath: filePath, error: asString(error), saveApiCalled: false };
        }
    }

    function nextCaptureRunPath() {
        for (var number = 1; number <= 99; number += 1) {
            var digits = number < 10 ? "0" + number : String(number);
            var candidate = CAPTURE_ROOT_PATH + "\\run" + digits;
            if (!FLfile.exists(uriFromPath(candidate))) return { number: number, path: candidate };
        }
        throw new Error("No unused Animate capture run directory remains");
    }

    var originalDoc = fl.getDocumentDOM();
    var originalPath = originalDoc ? read(originalDoc, "path") : null;
    var originalPathURI = originalDoc ? read(originalDoc, "pathURI") : null;
    var originalModifiedBefore = originalDoc ? read(originalDoc, "modified") : null;
    var originalModificationDateBefore = originalPathURI ? FLfile.getModificationDate(originalPathURI) : null;
    var originalDocumentCountBefore = (read(fl, "documents") || []).length;
    var output = {
        schemaVersion: "issue741-animate-fixtures-oracle/1",
        issue: 741,
        collector: "scripts/research/issue741-animate-fixtures-and-oracle.jsfl",
        host: { animateVersion: read(fl, "version"), executablePath: "D:\\AN2023\\Adobe Animate 2023\\Animate.exe" },
        invocation: {
            activeDocumentPathBefore: originalPath,
            activeDocumentModifiedBefore: originalModifiedBefore,
            activeDocumentModificationDateBefore: originalModificationDateBefore,
            existingDocumentCountBefore: originalDocumentCountBefore,
            originalDocumentSaveApiCalled: false,
            oracleSaveApiCalled: false
        },
        status: "NOT_RUN",
        runNumber: null,
        fixtures: [],
        authoringManifestPath: MANIFEST_PATH
    };

    try {
        if (!originalDoc) throw new Error("An Animate document must already be open; the script will restore it after capture");
        var acceptanceParent = "D:\\PandaStage-Acceptance";
        var datedRoot = ROOT_PATH;
        ensureFolder(acceptanceParent);
        ensureFolder(datedRoot);
        ensureFolder(FIXTURE_PATH);
        ensureFolder(CAPTURE_ROOT_PATH);

        var existingCount = 0;
        for (var fixtureIndex = 0; fixtureIndex < FIXTURES.length; fixtureIndex += 1) {
            if (FLfile.exists(uriFromPath(FIXTURE_PATH + "\\" + FIXTURES[fixtureIndex].fileName))) existingCount += 1;
        }
        if (existingCount !== 0 && existingCount !== FIXTURES.length) {
            throw new Error("Partial fixture set exists; refusing to overwrite or complete it. Inspect the external output folder first.");
        }
        var manifestExists = FLfile.exists(uriFromPath(MANIFEST_PATH));
        if (existingCount === 0 && manifestExists) throw new Error("Authoring manifest exists without the complete fixture set; refusing to create files under a stale manifest");
        if (existingCount === FIXTURES.length && !manifestExists) throw new Error("Fixture FLAs exist without an authoring manifest; refusing to treat them as this suite");

        var run = nextCaptureRunPath();
        output.runNumber = run.number;
        ensureFolder(run.path);

        if (existingCount === 0) {
            var authoredFixtures = [];
            for (var createIndex = 0; createIndex < FIXTURES.length; createIndex += 1) {
                var createFixtureSpec = FIXTURES[createIndex];
                var createPath = FIXTURE_PATH + "\\" + createFixtureSpec.fileName;
                var authored = createFixture(createFixtureSpec, createPath);
                authoredFixtures.push({
                    key: createFixtureSpec.key, family: createFixtureSpec.family, variant: createFixtureSpec.variant,
                    closeMode: createFixtureSpec.closeMode, intendedPoints: createFixtureSpec.points,
                    stageWidth: STAGE_WIDTH, stageHeight: STAGE_HEIGHT, fillColor: PAINT,
                    fileName: createFixtureSpec.fileName, authoring: authored
                });
                if (authored.status !== "CREATED_BY_ANIMATE") {
                    output.status = "AUTHORING_FAILED";
                    output.authoringFailures = authoredFixtures;
                    throw new Error("Fixture authoring failed for " + createFixtureSpec.key + ": " + authored.error);
                }
            }
            var manifest = {
                schemaVersion: "issue741-animate-authoring-manifest/1",
                issue: 741,
                authoringApi: "Adobe Animate JSAPI Path / Document",
                stageWidth: STAGE_WIDTH,
                stageHeight: STAGE_HEIGHT,
                fillColor: PAINT,
                authoringManifestPath: MANIFEST_PATH,
                fixtures: authoredFixtures
            };
            if (!FLfile.write(uriFromPath(MANIFEST_PATH), json(manifest))) throw new Error("Could not write authoring manifest");
            output.fixturesCreatedByThisRun = true;
            output.fixtureAuthoringSaveApiCount = FIXTURES.length;
        } else {
            output.fixturesCreatedByThisRun = false;
            output.fixtureAuthoringSaveApiCount = 0;
            if (!FLfile.exists(uriFromPath(MANIFEST_PATH))) throw new Error("All fixture FLAs exist but authoring manifest is missing");
        }

        for (var targetIndex = 0; targetIndex < FIXTURES.length; targetIndex += 1) {
            var fixture = FIXTURES[targetIndex];
            var sourcePath = FIXTURE_PATH + "\\" + fixture.fileName;
            var sourceUri = uriFromPath(sourcePath);
            var screenshotPath = run.path + "\\" + fixture.key + ".png";
            var screenshotUri = uriFromPath(screenshotPath);
            if (!FLfile.exists(sourceUri)) throw new Error("Fixture source FLA is missing: " + sourcePath);
            if (FLfile.exists(screenshotUri)) throw new Error("Refusing to overwrite existing capture image: " + screenshotPath);

            var target = {
                key: fixture.key, family: fixture.family, variant: fixture.variant,
                fileName: fixture.fileName, sourcePath: sourcePath,
                sourceFileModificationDateBefore: FLfile.getModificationDate(sourceUri),
                status: "NOT_RUN", saveApiCalled: false
            };
            try {
                fl.openDocument(sourceUri);
                var doc = fl.getDocumentDOM();
                if (!doc) throw new Error("Animate did not activate the fixture FLA");
                target.documentPath = read(doc, "path");
                target.documentPathMatches = normalizedPath(target.documentPath) === normalizedPath(sourcePath);
                target.isPreExistingDocument = false;
                var documentsNow = read(fl, "documents") || [];
                for (var originalIndex = 0; originalIndex < originalDocumentCountBefore; originalIndex += 1) {
                    if (documentsNow[originalIndex] === doc) target.isPreExistingDocument = true;
                }
                if (!target.documentPathMatches) throw new Error("Active document path differs from fixture source path");
                if (target.isPreExistingDocument) throw new Error("Fixture path was already open before this run; refusing to inspect live user state");
                target.documentModifiedBeforeCapture = read(doc, "modified");
                target.timelineCapture = collectTimelineShapes(doc);
                target.candidateShapeCount = target.timelineCapture.shapes.length;
                if (target.candidateShapeCount !== 1) throw new Error("Expected exactly one stage Shape, captured " + target.candidateShapeCount);
                if (!doc.exportPNG(screenshotUri, true, true)) throw new Error("Animate exportPNG returned false");
                target.screenshotPath = screenshotPath;
                target.screenshotExportedByAnimate = true;
                target.documentModifiedAfterCapture = read(doc, "modified");
                target.sourceFileModificationDateAfter = FLfile.getModificationDate(sourceUri);
                target.sourceFileModificationDateUnchanged = target.sourceFileModificationDateBefore === target.sourceFileModificationDateAfter;
                if (target.documentModifiedAfterCapture !== false) throw new Error("Read-only oracle left the fixture document modified");
                if (!target.sourceFileModificationDateUnchanged) throw new Error("Source fixture modification date changed during read-only oracle capture");
                target.status = "CAPTURED_READ_ONLY";
                fl.closeDocument(doc);
            } catch (targetError) {
                target.status = "CAPTURE_FAILED";
                target.error = asString(targetError);
                try {
                    var failedDoc = fl.getDocumentDOM();
                    if (failedDoc && target.isPreExistingDocument === false && normalizedPath(read(failedDoc, "path")) === normalizedPath(sourcePath)) {
                        fl.closeDocument(failedDoc, false);
                    }
                } catch (closeError) {
                    target.closeError = asString(closeError);
                }
            }
            output.fixtures.push(target);
        }
        var allFixturesCaptured = true;
        for (var statusIndex = 0; statusIndex < output.fixtures.length; statusIndex += 1) {
            if (output.fixtures[statusIndex].status !== "CAPTURED_READ_ONLY") allFixturesCaptured = false;
        }
        output.status = allFixturesCaptured ? "CAPTURED_READ_ONLY" : "CAPTURE_PARTIAL_OR_FAILED";
    } catch (error) {
        if (output.status === "NOT_RUN") output.status = "COLLECTION_FAILED";
        output.error = asString(error);
    }

    try {
        fl.setActiveWindow(originalDoc);
        output.invocation.activeDocumentPathAfter = read(fl.getDocumentDOM(), "path");
        output.invocation.activeDocumentRestored = fl.getDocumentDOM() === originalDoc;
        output.invocation.activeDocumentModifiedAfter = read(originalDoc, "modified");
        output.invocation.activeDocumentModificationDateAfter = originalPathURI ? FLfile.getModificationDate(originalPathURI) : null;
        output.invocation.activeDocumentModifiedStateUnchanged = output.invocation.activeDocumentModifiedAfter === originalModifiedBefore;
        output.invocation.activeDocumentModificationDateUnchanged = output.invocation.activeDocumentModificationDateAfter === originalModificationDateBefore;
        output.invocation.existingDocumentCountAfter = (read(fl, "documents") || []).length;
        output.invocation.originalDocumentSaveApiCalled = false;
        output.invocation.oracleSaveApiCalled = false;
        if (!output.invocation.activeDocumentRestored) output.status = "ACTIVE_DOCUMENT_RESTORE_FAILED";
        if (!output.invocation.activeDocumentModifiedStateUnchanged || !output.invocation.activeDocumentModificationDateUnchanged) {
            output.status = "ORIGINAL_DOCUMENT_STATE_CHANGED";
        }
    } catch (restoreError) {
        output.status = "ACTIVE_DOCUMENT_RESTORE_FAILED";
        output.invocation.restoreError = asString(restoreError);
    }

    try {
        if (output.runNumber === null) {
            var fallbackRun = nextCaptureRunPath();
            output.runNumber = fallbackRun.number;
            ensureFolder(fallbackRun.path);
            run = fallbackRun;
        }
        var receiptPath = run.path + "\\animate-run" + (output.runNumber < 10 ? "0" + output.runNumber : String(output.runNumber)) + ".json";
        output.receiptPath = receiptPath;
        output.outputDirectory = run.path;
        if (!FLfile.write(uriFromPath(receiptPath), json(output))) {
            throw new Error("FLfile.write returned false for oracle receipt");
        }
        fl.trace("Issue #741 Animate capture " + output.status + ": " + receiptPath);
    } catch (writeError) {
        fl.trace("Issue #741 receipt write failed: " + asString(writeError));
    }
}());
