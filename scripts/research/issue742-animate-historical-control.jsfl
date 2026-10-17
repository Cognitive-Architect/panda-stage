// Read-only Adobe Animate 2023 Shape/Contour/HalfEdge collector for Issue #742.
// It opens byte-identical external copies of frozen FLAs, captures target
// library-item timelines, never saves, and restores the document that was open.

(function issue742AnimateOracle() {
    var INPUT_ROOT = "D:\\PandaStage-Acceptance\\issue742-repair-contract-20261009-attempt03\\animate-controls\\inputs";
    var OUTPUT_DIR_URI = "file:///D|/PandaStage-Acceptance/issue742-repair-contract-20261009-attempt03/animate-controls";
    var HOST_PROVENANCE_PATH = "D:\\PandaStage-Acceptance\\issue742-repair-contract-20261009-attempt03\\animate-host-provenance.txt";
    var MAX_HALF_EDGES_PER_CONTOUR = 10000;
    var MAX_DEPTH = 32;
    var MAX_SHAPES = 2000;

    var TARGETS = [
        {
            key: "issue737-historical-oracle",
            sourcePath: "REDACTED_USER_SOURCE_PATH",
            sourceCopyPath: "D:\\PandaStage-Acceptance\\issue742-repair-contract-20261009-attempt03\\animate-controls\\inputs\\historical.fla",
            sourceSha256: "A328A163DD212F0369E27B30E5078178FD42744954203FDAD6A9CD06F3B171FA",
            shapeId: "fla-shape-f715af380bb888b2571345e2",
            fillStyleIndex: 1,
            sourceAddress: "graphic:\u8865\u95f4 1/layer-0-frame-0/0/0/0",
            libraryItemName: "\u8865\u95f4 1",
            layerIndex: 0,
            frameIndex: 0,
            rawMemberPath: "0/0" ,
            xflMemberPath: "0/0/0" ,
            pathMappingRule: "XFL path resolves to Animate DOM Shape after the terminal XFL child index 0; all observed matrix coefficients match."
        },
        {
            key: "issue737-closed-fill-control",
            sourcePath: "REDACTED_USER_SOURCE_PATH",
            sourceCopyPath: "D:\\PandaStage-Acceptance\\issue742-repair-contract-20261009-attempt03\\animate-controls\\inputs\\historical.fla",
            sourceSha256: "A328A163DD212F0369E27B30E5078178FD42744954203FDAD6A9CD06F3B171FA",
            shapeId: "fla-shape-289bd154caee9595b4c5ddef",
            fillStyleIndex: 1,
            sourceAddress: "graphic:\u8865\u95f4 1/layer-0-frame-0/0/4/0",
            libraryItemName: "\u8865\u95f4 1",
            layerIndex: 0,
            frameIndex: 0,
            rawMemberPath: "0/4" ,
            xflMemberPath: "0/4/0" ,
            pathMappingRule: "XFL path resolves to Animate DOM Shape after the terminal XFL child index 0; all observed matrix coefficients match."
        }
    ];

    // Run only the accepted #737 target and its known-good closed-fill control.
    // Original user-document paths are intentionally redacted in committed source.

    function asString(value) {
        if (value === undefined || value === null) return null;
        try { return String(value); } catch (error) { return "<unprintable>"; }
    }

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

    function point(value) {
        return value ? { x: read(value, "x"), y: read(value, "y") } : null;
    }

    function matrix(value) {
        if (!value) return null;
        return { a: read(value, "a"), b: read(value, "b"), c: read(value, "c"), d: read(value, "d"), tx: read(value, "tx"), ty: read(value, "ty") };
    }

    function fillSummary(value) {
        if (!value) return null;
        return {
            style: read(value, "style"), color: read(value, "color"), bitmapPath: read(value, "bitmapPath"),
            bitmapIsClipped: read(value, "bitmapIsClipped"), colorArray: plain(read(value, "colorArray")),
            posArray: plain(read(value, "posArray")), focalPoint: read(value, "focalPoint"),
            linearRGB: read(value, "linearRGB"), overflow: read(value, "overflow"), matrix: matrix(read(value, "matrix"))
        };
    }

    function strokeSummary(value) {
        if (!value) return null;
        return { style: read(value, "style"), color: read(value, "color"), thickness: read(value, "thickness"), capType: read(value, "capType"), joinType: read(value, "joinType"), miterLimit: read(value, "miterLimit") };
    }

    function halfEdgeId(value) {
        var id = read(value, "id");
        return id === null ? null : id;
    }

    function edgeGeometry(edgeObject) {
        if (!edgeObject) return null;
        var halfEdge = call(edgeObject, "getHalfEdge");
        var opposite = call(halfEdge, "getOppositeHalfEdge");
        var from = call(opposite, "getVertex");
        var to = call(halfEdge, "getVertex");
        var controls = [];
        for (var controlIndex = 0; controlIndex < 3; controlIndex += 1) controls.push(point(call(edgeObject, "getControl", [controlIndex])));
        return {
            id: read(edgeObject, "id"), cubicSegmentIndex: read(edgeObject, "cubicSegmentIndex"),
            isLine: read(edgeObject, "isLine"), halfEdgeId: halfEdgeId(halfEdge),
            oppositeHalfEdgeId: halfEdgeId(opposite), from: point(from), to: point(to),
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
            if (sameHalfEdge(next, start)) { result.closedAtStart = true; result.stopReason = "RETURNED_TO_START"; return result; }
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

    function captureShape(shape, timeline, layer, frame, parent, layerIndex, frameArrayIndex, memberPath) {
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
        for (var contourIndex = 0; contourIndex < contourObjects.length; contourIndex += 1) contours.push(walkContour(contourObjects[contourIndex]));
        return {
            memberPath: memberPath,
            scope: {
                timelineName: read(timeline, "name"), libraryItemName: read(read(timeline, "libraryItem"), "name"),
                layerIndex: layerIndex, layerName: read(layer, "name"), frameArrayIndex: frameArrayIndex,
                keyframeStartFrame: read(frame, "startFrame"), keyframeDuration: read(frame, "duration"),
                parentElementType: read(parent, "elementType"), parentName: read(parent, "name")
            },
            shape: {
                elementType: read(shape, "elementType"), description: read(shape, "description"), isGroup: read(shape, "isGroup"),
                matrix: matrix(read(shape, "matrix")), x: read(shape, "x"), y: read(shape, "y"),
                left: read(shape, "left"), top: read(shape, "top"),
                isDrawingObject: read(shape, "isDrawingObject"), isFloating: read(shape, "isFloating"),
                numCubicSegments: read(shape, "numCubicSegments"),
                edgeCount: edgeObjects.length, vertexCount: vertexObjects.length, contourCount: contourObjects.length,
                edges: edges, vertices: vertices, contours: contours, cubicSegments: cubicSegments
            }
        };
    }

    function captureTimeline(item, target) {
        var timeline = read(item, "timeline");
        var layers = read(timeline, "layers") || [];
        var layer = layers[target.layerIndex];
        if (!layer) throw new Error("Target layer index was not found: " + target.layerIndex);
        var layerFrames = read(layer, "frames") || [];
        var frame = null;
        var frameArrayIndex = -1;
        var frames = [];
        for (var index = 0; index < layerFrames.length; index += 1) {
            var candidateFrame = layerFrames[index];
            var candidateStart = read(candidateFrame, "startFrame");
            var candidateElements = read(candidateFrame, "elements") || [];
            frames.push({ layerIndex: target.layerIndex, frameArrayIndex: index, startFrame: candidateStart, duration: read(candidateFrame, "duration"), elementCount: candidateElements.length });
            if (candidateStart === target.frameIndex && frame === null) {
                frame = candidateFrame;
                frameArrayIndex = index;
            }
        }
        if (!frame) throw new Error("Target frame start was not found: " + target.frameIndex);
        var elements = read(frame, "elements") || [];
        var pathParts = target.rawMemberPath.split("/");
        var element = null;
        var parent = null;
        var memberPath = "";
        var inventory = [];
        for (var depth = 0; depth < pathParts.length; depth += 1) {
            var childIndex = parseInt(pathParts[depth], 10);
            if (isNaN(childIndex) || childIndex < 0) throw new Error("Invalid member path: " + target.rawMemberPath);
            if (depth === 0) element = elements[childIndex];
            else {
                parent = element;
                var members = read(element, "members") || [];
                element = members[childIndex];
            }
            if (!element) throw new Error("Member path element was not found: " + target.rawMemberPath + " at depth " + depth);
            memberPath = memberPath.length ? memberPath + "/" + childIndex : String(childIndex);
            inventory.push({ memberPath: memberPath, elementType: read(element, "elementType"), name: read(element, "name"), isGroup: read(element, "isGroup"), matrix: matrix(read(element, "matrix")), edgeCount: (read(element, "edges") || []).length, vertexCount: (read(element, "vertices") || []).length, contourCount: (read(element, "contours") || []).length });
        }
        if (read(element, "elementType") !== "shape") throw new Error("Exact member path does not resolve to a Shape: " + target.rawMemberPath);
        var shape = captureShape(element, timeline, layer, frame, parent, target.layerIndex, frameArrayIndex, memberPath);
        var shapes = [shape];
        return {
            timelineName: read(timeline, "name"), frameCount: read(timeline, "frameCount"), layerCount: layers.length,
            selectedLayerIndex: target.layerIndex, selectedFrameStart: target.frameIndex,
            selectedRawMemberPath: target.rawMemberPath, frames: frames, elementInventory: inventory,
            shapes: shapes, inventoryOverflow: false,
            exactMemberPathCandidate: [{ memberPath: memberPath, edgeCount: shape.shape.edgeCount, vertexCount: shape.shape.vertexCount, contourCount: shape.shape.contourCount }]
        };
    }

    function discoverTimelineShapes(item, target) {
        var timeline = read(item, "timeline");
        var layers = read(timeline, "layers") || [];
        var layer = layers[target.layerIndex];
        if (!layer) throw new Error("Discovery layer was not found: " + target.layerIndex);
        var layerFrames = read(layer, "frames") || [];
        var frame = null;
        var frameArrayIndex = -1;
        for (var frameIndex = 0; frameIndex < layerFrames.length; frameIndex += 1) {
            if (read(layerFrames[frameIndex], "startFrame") === target.frameIndex) {
                frame = layerFrames[frameIndex];
                frameArrayIndex = frameIndex;
                break;
            }
        }
        if (!frame) throw new Error("Discovery frame was not found: " + target.frameIndex);
        var inventory = [];
        var overflow = false;
        function visit(element, memberPath, depth, parentPath) {
            if (!element || depth > MAX_DEPTH || inventory.length >= MAX_SHAPES) { overflow = true; return; }
            var members = read(element, "members") || [];
            var edges = read(element, "edges") || [];
            var vertices = read(element, "vertices") || [];
            var contours = read(element, "contours") || [];
            inventory.push({ memberPath: memberPath, parentPath: parentPath, elementType: read(element, "elementType"), name: read(element, "name"), isGroup: read(element, "isGroup"), matrix: matrix(read(element, "matrix")), x: read(element, "x"), y: read(element, "y"), left: read(element, "left"), top: read(element, "top"), edgeCount: edges.length, vertexCount: vertices.length, contourCount: contours.length, memberCount: members.length });
            for (var memberIndex = 0; memberIndex < members.length; memberIndex += 1) visit(members[memberIndex], memberPath + "/" + memberIndex, depth + 1, memberPath);
        }
        var elements = read(frame, "elements") || [];
        for (var elementIndex = 0; elementIndex < elements.length; elementIndex += 1) visit(elements[elementIndex], String(elementIndex), 0, null);
        return { timelineName: read(timeline, "name"), frameCount: read(timeline, "frameCount"), selectedLayerIndex: target.layerIndex, selectedFrameStart: target.frameIndex, frameArrayIndex: frameArrayIndex, inventoryOverflow: overflow, shapeInventory: inventory };
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
            else if (code < 32) result += "\\u" + ("0000" + code.toString(16)).slice(-4);
            else if (code > 126) result += "\\u" + ("0000" + code.toString(16)).slice(-4);
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
        for (var property in value) if (value.hasOwnProperty(property)) objectParts.push(quoteJson(property) + ":" + json(value[property]));
        return "{" + objectParts.join(",") + "}";
    }

    function uriFromPath(value) {
        try { return FLfile.platformPathToURI(value); }
        catch (error) {
            var text = String(value).replace(/\\/g, "/");
            return "file:///" + text.charAt(0) + "|" + text.substring(2);
        }
    }

    function readHostProvenance() {
        var uri = uriFromPath(HOST_PROVENANCE_PATH);
        if (!FLfile.exists(uri)) throw new Error("Animate host provenance manifest is missing: " + HOST_PROVENANCE_PATH);
        var text = FLfile.read(uri);
        if (!text) throw new Error("Animate host provenance manifest is empty");
        var values = {};
        var lines = String(text).split(/\r?\n/);
        for (var lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
            var separator = lines[lineIndex].indexOf("=");
            if (separator <= 0) continue;
            values[lines[lineIndex].substring(0, separator)] = lines[lineIndex].substring(separator + 1);
        }
        var required = ["EXECUTABLE_PATH", "FILE_VERSION", "SHA256", "AUTHENTICODE_STATUS", "PROVENANCE"];
        for (var requiredIndex = 0; requiredIndex < required.length; requiredIndex += 1) {
            if (!values[required[requiredIndex]]) throw new Error("Animate host provenance field is missing: " + required[requiredIndex]);
        }
        return {
            executablePath: values.EXECUTABLE_PATH,
            fileVersion: values.FILE_VERSION,
            sha256: values.SHA256,
            authenticodeStatus: values.AUTHENTICODE_STATUS,
            provenance: values.PROVENANCE,
            manifestPath: HOST_PROVENANCE_PATH
        };
    }

    function normalizedPath(value) {
        return asString(value) === null ? null : String(value).replace(/\//g, "\\").toLowerCase();
    }

    function libraryItemByName(doc, name) {
        var library = read(doc, "library"), items = read(library, "items") || [];
        for (var index = 0; index < items.length; index += 1) {
            if (read(items[index], "name") === name) return { item: items[index], index: index };
        }
        return null;
    }

    function uniqueOutputUri(stem) {
        for (var suffix = 0; suffix < 1000; suffix += 1) {
            var suffixText = suffix === 0 ? "" : "-" + suffix;
            var candidate = OUTPUT_DIR_URI + "/" + stem + suffixText + ".json";
            if (!FLfile.exists(candidate)) return candidate;
        }
        throw new Error("Could not find an unused output filename");
    }


    var originalDocs = read(fl, "documents") || [];
    var originalDoc = fl.getDocumentDOM();
    var originalDocPath = originalDoc ? read(originalDoc, "path") : null;
    var originalDocPathURI = originalDoc ? read(originalDoc, "pathURI") : null;
    var originalDocModifiedBefore = originalDoc ? read(originalDoc, "modified") : null;
    var originalDocModificationDateBefore = originalDocPathURI ? FLfile.getModificationDate(originalDocPathURI) : null;
    var hostProvenance = readHostProvenance();
    var output = {
        schemaVersion: "issue742-animate-oracle/1",
        issue: 742,
        collector: "scripts/research/issue742-animate-historical-control.jsfl",
        host: {
            animateVersion: read(fl, "version"),
            executablePath: hostProvenance.executablePath,
            fileVersion: hostProvenance.fileVersion,
            sha256: hostProvenance.sha256,
            authenticodeStatus: hostProvenance.authenticodeStatus,
            provenance: hostProvenance.provenance,
            provenanceManifestPath: hostProvenance.manifestPath,
            runAsReadOnlyJsfl: true
        },
        invocation: {
            activeDocumentPathBefore: originalDocPath,
            activeDocumentModifiedBefore: originalDocModifiedBefore,
            activeDocumentModifiedStateObservableBefore: typeof originalDocModifiedBefore === "boolean",
            activeDocumentModificationDateBefore: originalDocModificationDateBefore,
            existingDocumentCountBefore: originalDocs.length,
            saveApiCalled: false
        },
        targets: []
    };

    try {
        if (!originalDoc) throw new Error("No active Animate document existed before the read-only capture");
        if (!FLfile.exists(OUTPUT_DIR_URI)) FLfile.createFolder(OUTPUT_DIR_URI);
        for (var targetIndex = 0; targetIndex < TARGETS.length; targetIndex += 1) {
            var target = TARGETS[targetIndex];
            var targetReceipt = {
                key: target.key, expectedOriginalSourcePath: target.sourcePath, sourceCopyPath: target.sourceCopyPath,
                expectedSourceSha256: target.sourceSha256, shapeId: target.shapeId, fillStyleIndex: target.fillStyleIndex,
                sourceAddress: target.sourceAddress, expectedLibraryItemName: target.libraryItemName,
                layerIndex: target.layerIndex, frameIndex: target.frameIndex, xflMemberPath: target.xflMemberPath, animateDomMemberPath: target.rawMemberPath, pathMappingRule: target.pathMappingRule,
                status: "NOT_RUN", saveApiCalled: false
            };
            try {
                var copyUri = uriFromPath(target.sourceCopyPath);
                if (!FLfile.exists(copyUri)) throw new Error("Byte-identical source copy is missing: " + target.sourceCopyPath);
                targetReceipt.fileModificationDateBefore = FLfile.getModificationDate(copyUri);
                fl.openDocument(copyUri);
                var doc = fl.getDocumentDOM();
                if (!doc) throw new Error("Animate did not activate an opened document");
                targetReceipt.documentPath = read(doc, "path");
                targetReceipt.documentPathURI = read(doc, "pathURI");
                targetReceipt.expectedCopyPathMatches = normalizedPath(targetReceipt.documentPath) === normalizedPath(target.sourceCopyPath);
                targetReceipt.isPreExistingDocument = false;
                for (var existingIndex = 0; existingIndex < originalDocs.length; existingIndex += 1) {
                    if (originalDocs[existingIndex] === doc) targetReceipt.isPreExistingDocument = true;
                }
                if (!targetReceipt.expectedCopyPathMatches) throw new Error("Active document path does not match the external frozen-source copy");
                if (targetReceipt.isPreExistingDocument) throw new Error("Historical control copy was already open before capture; refusing to inspect live document state");
                targetReceipt.documentModifiedBeforeCapture = read(doc, "modified");
                targetReceipt.documentModifiedStateObservableBeforeCapture = typeof targetReceipt.documentModifiedBeforeCapture === "boolean";
                if (targetReceipt.documentModifiedBeforeCapture === true) throw new Error("Frozen control copy was modified before read-only capture");
                var match = libraryItemByName(doc, target.libraryItemName);
                if (!match) throw new Error("Target library item was not found by exact name: " + target.libraryItemName);
                targetReceipt.libraryItemIndex = match.index;
                targetReceipt.libraryItem = {
                    name: read(match.item, "name"), itemType: read(match.item, "itemType"),
                    symbolType: read(match.item, "symbolType"), timelineName: read(read(match.item, "timeline"), "name"),
                    frameCount: read(read(match.item, "timeline"), "frameCount")
                };
                targetReceipt.targetLibraryTimelineCapture = captureTimeline(match.item, target);
                targetReceipt.candidateShapeCount = targetReceipt.targetLibraryTimelineCapture.shapes.length;
                targetReceipt.candidatePaths = targetReceipt.targetLibraryTimelineCapture.exactMemberPathCandidate;
                targetReceipt.fileModificationDateAfter = FLfile.getModificationDate(copyUri);
                targetReceipt.fileModificationDateUnchanged = targetReceipt.fileModificationDateBefore === targetReceipt.fileModificationDateAfter;
                targetReceipt.documentModifiedAfterCapture = read(doc, "modified");
                targetReceipt.documentModifiedStateObservableAfterCapture = typeof targetReceipt.documentModifiedAfterCapture === "boolean";
                targetReceipt.documentModifiedStateUnchanged = targetReceipt.documentModifiedStateObservableBeforeCapture &&
                    targetReceipt.documentModifiedStateObservableAfterCapture
                    ? targetReceipt.documentModifiedBeforeCapture === targetReceipt.documentModifiedAfterCapture
                    : null;
                if (!targetReceipt.fileModificationDateUnchanged) throw new Error("Frozen historical control source changed during capture");
                if (targetReceipt.documentModifiedAfterCapture === true) throw new Error("Read-only historical control capture left its document modified");
                targetReceipt.status = "CAPTURED";
                if (!targetReceipt.isPreExistingDocument) {
                    try {
                        fl.closeDocument(doc, false);
                        targetReceipt.closeNewCopyDocumentAttempted = true;
                        targetReceipt.closeNewCopyDocumentResult = targetReceipt.documentModifiedStateObservableAfterCapture
                            ? "CLOSED_WITHOUT_SAVE"
                            : "CLOSED_WITHOUT_SAVE_MODIFIED_STATE_UNOBSERVABLE";
                    } catch (closeError) {
                        targetReceipt.closeNewCopyDocumentAttempted = true;
                        targetReceipt.closeNewCopyDocumentResult = "LEFT_OPEN_AFTER_CLOSE_ERROR: " + asString(closeError);
                    }
                }
            } catch (targetError) {
                targetReceipt.status = "CAPTURE_FAILED";
                targetReceipt.error = asString(targetError);
                try {
                    var failedDoc = fl.getDocumentDOM();
                    var failedMatch = libraryItemByName(failedDoc, target.libraryItemName);
                    if (failedMatch) targetReceipt.discovery = discoverTimelineShapes(failedMatch.item, target);
                    if (failedDoc && targetReceipt.isPreExistingDocument === false &&
                        normalizedPath(read(failedDoc, "path")) === normalizedPath(target.sourceCopyPath)) {
                        fl.closeDocument(failedDoc, false);
                        targetReceipt.closeAfterFailure = "CLOSED_WITHOUT_SAVE";
                    }
                } catch (discoveryError) {
                    targetReceipt.discoveryError = asString(discoveryError);
                }
            }
            output.targets.push(targetReceipt);
        }
        var allTargetsCaptured = true;
        for (var targetStatusIndex = 0; targetStatusIndex < output.targets.length; targetStatusIndex += 1) {
            if (output.targets[targetStatusIndex].status !== "CAPTURED") allTargetsCaptured = false;
        }
        output.status = allTargetsCaptured ? "CAPTURE_FINISHED_READ_ONLY" : "CAPTURE_PARTIAL_OR_FAILED";
    } catch (error) {
        output.status = "COLLECTION_FAILED";
        output.error = asString(error);
    }

    try {
        if (originalDoc) fl.setActiveWindow(originalDoc);
        var restoredDoc = fl.getDocumentDOM();
        output.invocation.activeDocumentPathAfter = restoredDoc ? read(restoredDoc, "path") : null;
        output.invocation.activeDocumentRestored = restoredDoc === originalDoc;
        output.invocation.activeDocumentModifiedAfter = originalDoc ? read(originalDoc, "modified") : null;
        output.invocation.activeDocumentModifiedStateObservableAfter = typeof output.invocation.activeDocumentModifiedAfter === "boolean";
        output.invocation.activeDocumentModifiedStateUnchanged = output.invocation.activeDocumentModifiedStateObservableBefore &&
            output.invocation.activeDocumentModifiedStateObservableAfter
            ? output.invocation.activeDocumentModifiedAfter === originalDocModifiedBefore
            : null;
        output.invocation.activeDocumentModificationDateAfter = originalDocPathURI ? FLfile.getModificationDate(originalDocPathURI) : null;
        output.invocation.activeDocumentModificationDateUnchanged = output.invocation.activeDocumentModificationDateAfter === originalDocModificationDateBefore;
        output.invocation.existingDocumentCountAfter = (read(fl, "documents") || []).length;
        output.invocation.saveApiCalled = false;
        if (!output.invocation.activeDocumentRestored || output.invocation.existingDocumentCountAfter !== originalDocs.length ||
            output.invocation.activeDocumentModifiedStateUnchanged === false ||
            !output.invocation.activeDocumentModificationDateUnchanged) {
            output.status = "ORIGINAL_DOCUMENT_STATE_CHANGED_OR_NOT_RESTORED";
        }
    } catch (restoreError) {
        output.invocation.restoreError = asString(restoreError);
        output.invocation.saveApiCalled = false;
    }

    try {
        var outputUri = uniqueOutputUri("issue742-animate-oracle-run01");
        output.receiptUri = outputUri;
        if (!FLfile.write(outputUri, json(output))) throw new Error("FLfile.write returned false for " + outputUri);
        fl.trace("Issue #742 Animate oracle JSON: " + outputUri);
    } catch (writeError) {
        fl.trace("Issue #742 Animate oracle output failed: " + asString(writeError));
        alert("Issue #742 Animate oracle output failed: " + asString(writeError));
    }
})();
