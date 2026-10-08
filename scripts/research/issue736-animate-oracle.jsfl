// Issue #736 read-only Adobe Animate authoring-DOM collector.
//
// Run this command from inside Adobe Animate with the frozen source FLA open.
// It does not save or edit the FLA. It writes a JSON inventory and an SWF
// export to a unique path under D:\PandaStage-Acceptance\.
//
// The library item / timeline / frame filter is a candidate locator only.
// The raw-XFL address contains nested group indexes, so a final Shape mapping
// still requires geometry/topology comparison with the XFL receipt.

(function issue736AnimateOracle() {
    var EXPECTED_SOURCE_PATH = "D:\\表情合集\\黑衣修仙男.fla";
    var TARGET_LIBRARY_ITEM = "补间 1";
    var TARGET_LAYER_INDEX = 0;
    var TARGET_FRAME_INDEX = 0;
    var OUTPUT_DIR_URI = "file:///D|/PandaStage-Acceptance/issue736-open-fill-oracle-20261008";
    var MAX_HALF_EDGES_PER_CONTOUR = 10000;

    function asString(value) {
        if (value === undefined || value === null) return null;
        try { return String(value); } catch (error) { return "<unprintable>"; }
    }

    function read(object, propertyName) {
        try {
            if (object === undefined || object === null) return null;
            var value = object[propertyName];
            if (value === undefined || value === null) return null;
            if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
            return value;
        } catch (error) {
            return null;
        }
    }

    function call(object, methodName, args) {
        try {
            if (object === undefined || object === null || typeof object[methodName] !== "function") return null;
            return object[methodName].apply(object, args || []);
        } catch (error) {
            return null;
        }
    }

    function asPlainArray(value) {
        var result = [];
        if (!value || typeof value.length !== "number") return result;
        for (var index = 0; index < value.length; index += 1) {
            var item = value[index];
            if (item === null || item === undefined || typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
                result.push(item === undefined ? null : item);
            } else if (typeof item.x === "number" && typeof item.y === "number") {
                result.push({ x: item.x, y: item.y });
            } else {
                result.push(asString(item));
            }
        }
        return result;
    }

    function point(pointObject) {
        if (!pointObject) return null;
        return { x: read(pointObject, "x"), y: read(pointObject, "y") };
    }

    function matrix(matrixObject) {
        if (!matrixObject) return null;
        return {
            a: read(matrixObject, "a"), b: read(matrixObject, "b"),
            c: read(matrixObject, "c"), d: read(matrixObject, "d"),
            tx: read(matrixObject, "tx"), ty: read(matrixObject, "ty")
        };
    }

    function fillSummary(fillObject) {
        if (!fillObject) return null;
        return {
            style: read(fillObject, "style"),
            color: read(fillObject, "color"),
            bitmapPath: read(fillObject, "bitmapPath"),
            bitmapIsClipped: read(fillObject, "bitmapIsClipped"),
            colorArray: asPlainArray(read(fillObject, "colorArray")),
            posArray: asPlainArray(read(fillObject, "posArray")),
            focalPoint: read(fillObject, "focalPoint"),
            linearRGB: read(fillObject, "linearRGB"),
            overflow: read(fillObject, "overflow"),
            matrix: matrix(read(fillObject, "matrix"))
        };
    }

    function strokeSummary(strokeObject) {
        if (!strokeObject) return null;
        return {
            style: read(strokeObject, "style"),
            color: read(strokeObject, "color"),
            thickness: read(strokeObject, "thickness"),
            capType: read(strokeObject, "capType"),
            joinType: read(strokeObject, "joinType"),
            miterLimit: read(strokeObject, "miterLimit")
        };
    }

    function halfEdgeId(halfEdge) {
        var id = read(halfEdge, "id");
        return id === null ? null : id;
    }

    function edgeGeometry(edgeObject) {
        if (!edgeObject) return null;
        var halfEdge = call(edgeObject, "getHalfEdge");
        var opposite = call(halfEdge, "getOppositeHalfEdge");
        var from = call(opposite, "getVertex");
        var to = call(halfEdge, "getVertex");
        var controls = [];
        for (var controlIndex = 0; controlIndex < 3; controlIndex += 1) {
            controls.push(point(call(edgeObject, "getControl", [controlIndex])));
        }
        return {
            id: read(edgeObject, "id"),
            cubicSegmentIndex: read(edgeObject, "cubicSegmentIndex"),
            isLine: read(edgeObject, "isLine"),
            halfEdgeId: halfEdgeId(halfEdge),
            oppositeHalfEdgeId: halfEdgeId(opposite),
            from: point(from),
            to: point(to),
            controlPoints0To2: controls,
            stroke: strokeSummary(read(edgeObject, "stroke"))
        };
    }

    function halfEdgeRecord(halfEdge, walkIndex) {
        var edgeObject = call(halfEdge, "getEdge");
        var next = call(halfEdge, "getNext");
        var previous = call(halfEdge, "getPrev");
        var opposite = call(halfEdge, "getOppositeHalfEdge");
        var head = call(halfEdge, "getVertex");
        var tail = call(opposite, "getVertex");
        return {
            walkIndex: walkIndex,
            id: halfEdgeId(halfEdge),
            nextId: halfEdgeId(next),
            prevId: halfEdgeId(previous),
            oppositeId: halfEdgeId(opposite),
            edgeId: read(edgeObject, "id"),
            edgeIsLine: read(edgeObject, "isLine"),
            cubicSegmentIndex: read(edgeObject, "cubicSegmentIndex"),
            from: point(tail),
            to: point(head),
            edgeGeometry: edgeGeometry(edgeObject)
        };
    }

    function sameHalfEdge(left, right) {
        if (!left || !right) return false;
        var leftId = halfEdgeId(left);
        var rightId = halfEdgeId(right);
        if (leftId !== null && rightId !== null) return leftId === rightId;
        return left === right;
    }

    function walkContour(contour) {
        var start = call(contour, "getHalfEdge");
        var result = {
            interior: read(contour, "interior"),
            orientation: read(contour, "orientation"),
            fill: fillSummary(read(contour, "fill")),
            startingHalfEdgeId: halfEdgeId(start),
            closedAtStart: false,
            stopReason: null,
            halfEdges: []
        };
        if (!start) {
            result.stopReason = "CONTOUR_START_HALF_EDGE_MISSING";
            return result;
        }

        var current = start;
        for (var index = 0; index < MAX_HALF_EDGES_PER_CONTOUR; index += 1) {
            result.halfEdges.push(halfEdgeRecord(current, index));
            var next = call(current, "getNext");
            if (!next) {
                result.stopReason = "NEXT_HALF_EDGE_MISSING";
                return result;
            }
            if (sameHalfEdge(next, start)) {
                result.closedAtStart = true;
                result.stopReason = "RETURNED_TO_START";
                return result;
            }
            for (var seenIndex = 0; seenIndex < result.halfEdges.length; seenIndex += 1) {
                if (result.halfEdges[seenIndex].id !== null && result.halfEdges[seenIndex].id === halfEdgeId(next)) {
                    result.stopReason = "REPEATED_NON_START_HALF_EDGE";
                    return result;
                }
            }
            current = next;
        }
        result.stopReason = "HALF_EDGE_SAFETY_LIMIT_REACHED";
        return result;
    }

    function identityIndex(arrayLike, target) {
        if (!arrayLike || target === null || target === undefined) return null;
        for (var index = 0; index < arrayLike.length; index += 1) {
            if (arrayLike[index] === target) return index;
        }
        return null;
    }

    function captureShape(shape, searchResult, searchIndex) {
        var edgeObjects = read(shape, "edges") || [];
        var vertexObjects = read(shape, "vertices") || [];
        var contourObjects = read(shape, "contours") || [];
        var edges = [];
        var vertices = [];
        var contours = [];

        for (var edgeIndex = 0; edgeIndex < edgeObjects.length; edgeIndex += 1) {
            edges.push(edgeGeometry(edgeObjects[edgeIndex]));
        }
        for (var vertexIndex = 0; vertexIndex < vertexObjects.length; vertexIndex += 1) {
            var vertex = vertexObjects[vertexIndex];
            var incidentHalfEdge = call(vertex, "getHalfEdge");
            vertices.push({
                index: vertexIndex,
                id: read(vertex, "id"),
                x: read(vertex, "x"),
                y: read(vertex, "y"),
                incidentHalfEdgeId: halfEdgeId(incidentHalfEdge)
            });
        }
        for (var contourIndex = 0; contourIndex < contourObjects.length; contourIndex += 1) {
            contours.push(walkContour(contourObjects[contourIndex]));
        }

        var timeline = read(searchResult, "timeline");
        var layer = read(searchResult, "layer");
        var keyframe = read(searchResult, "keyframe");
        var libraryItem = read(timeline, "libraryItem");
        var parent = read(searchResult, "parent");
        var layerIndex = identityIndex(read(timeline, "layers"), layer);
        var startFrame = read(keyframe, "startFrame");
        var libraryName = read(libraryItem, "name");
        var isGroup = read(shape, "isGroup");

        return {
            searchResultIndex: searchIndex,
            scope: {
                timelineName: read(timeline, "name"),
                libraryItemName: libraryName,
                libraryItemType: read(libraryItem, "itemType"),
                layerIndex: layerIndex,
                layerName: read(layer, "name"),
                keyframeStartFrame: startFrame,
                keyframeDuration: read(keyframe, "duration"),
                parentElementType: read(parent, "elementType"),
                parentName: read(parent, "name")
            },
            shape: {
                elementType: read(shape, "elementType"),
                description: read(shape, "description"),
                isGroup: isGroup,
                isDrawingObject: read(shape, "isDrawingObject"),
                isFloating: read(shape, "isFloating"),
                numCubicSegments: read(shape, "numCubicSegments"),
                edgeCount: edgeObjects.length,
                vertexCount: vertexObjects.length,
                contourCount: contourObjects.length,
                edges: edges,
                vertices: vertices,
                contours: contours
            },
            targetCandidate: libraryName === TARGET_LIBRARY_ITEM &&
                layerIndex === TARGET_LAYER_INDEX &&
                startFrame === TARGET_FRAME_INDEX &&
                isGroup === false
        };
    }

    function quoteJson(value) {
        var result = "\"";
        for (var index = 0; index < value.length; index += 1) {
            var character = value.charAt(index);
            var code = value.charCodeAt(index);
            if (character === "\"") result += "\\\"";
            else if (character === "\\") result += "\\\\";
            else if (character === "\b") result += "\\b";
            else if (character === "\f") result += "\\f";
            else if (character === "\n") result += "\\n";
            else if (character === "\r") result += "\\r";
            else if (character === "\t") result += "\\t";
            else if (code < 32) result += "\\u" + ("0000" + code.toString(16)).slice(-4);
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

    function uniqueOutputUri(stem, extension) {
        for (var suffix = 0; suffix < 1000; suffix += 1) {
            var suffixText = suffix === 0 ? "" : "-" + suffix;
            var candidate = OUTPUT_DIR_URI + "/" + stem + suffixText + extension;
            if (!FLfile.exists(candidate)) return candidate;
        }
        throw new Error("Could not find an unused output filename for " + stem);
    }

    function normalizedWindowsPath(value) {
        var text = asString(value);
        return text === null ? null : text.replace(/\//g, "\\").toLowerCase();
    }

    var doc = fl.getDocumentDOM();
    var jsonUri = null;
    var swfUri = null;
    var output = {
        schemaVersion: 1,
        issue: 736,
        collector: "scripts/research/issue736-animate-oracle.jsfl",
        host: { animateVersion: read(fl, "version"), runAsCommandInOpenFla: true },
        source: doc ? {
            expectedPath: EXPECTED_SOURCE_PATH,
            documentName: read(doc, "name"),
            documentPath: read(doc, "path"),
            documentPathURI: read(doc, "pathURI"),
            expectedPathMatches: normalizedWindowsPath(read(doc, "path")) === normalizedWindowsPath(EXPECTED_SOURCE_PATH),
            fileModificationDateBefore: doc ? FLfile.getModificationDate(read(doc, "pathURI")) : null,
            currentPublishProfile: read(doc, "currentPublishProfile"),
            currentPublishProfileSettingsXml: call(doc, "exportPublishProfileString"),
            publishProfiles: asPlainArray(read(doc, "publishProfiles"))
        } : null,
        targetLocator: {
            rawXflAddress: "graphic:补间 1/layer-0-frame-0/0/0/0",
            libraryItemName: TARGET_LIBRARY_ITEM,
            layerIndex: TARGET_LAYER_INDEX,
            frameIndex: TARGET_FRAME_INDEX,
            locatorStatus: "NOT_RUN"
        },
        xflMappingHints: {
            status: "HINTS_ONLY_REQUIRES_GEOMETRY_AND_TOPOLOGY_MAPPING",
            failureTarget: {
                sourceAddress: "graphic:补间 1/layer-0-frame-0/0/0/0",
                shapeId: "fla-shape-f715af380bb888b2571345e2",
                fillStyleIndex: 1,
                fullShapeEdgeRecordCount: 160,
                targetFillEdgeRecordCount: 14
            },
            naturallyClosedControl: {
                sourceAddress: "graphic:补间 1/layer-0-frame-0/0/4/0",
                shapeId: "fla-shape-289bd154caee9595b4c5ddef",
                shapeBlockSha256: "ACBC9D4A2B1AA9477F4D631BA052BB195020975679D24333BED8177849B5CFAA",
                fillStyleIndex: 1,
                fullShapeEdgeRecordCount: 33,
                targetFillEdgeRecordCount: 3
            }
        },
        animateShapes: { status: "NOT_RUN", targetScopeShapes: [], targetCandidates: [], controlCandidates: [] },
        publishedSwf: {
            status: "NOT_RUN",
            outputUri: null,
            exportedShapeRecordsParsed: false,
            shapeRecordParserScript: "scripts/research/issue736-swf-oracle.cjs",
            shapeRecordDumpStatus: "NOT_RUN",
            shapeRecordDumpCommandTemplate: "node scripts/research/issue736-swf-oracle.cjs --swf <published-swf-path> --receipt <xfl-panda-receipt.json> --out <swf-receipt.json>"
        }
    };

    try {
        if (!doc) throw new Error("No active FLA document is open in Animate");
        if (!output.source.expectedPathMatches) throw new Error("Active document path does not match the frozen Issue #736 FLA");
        if (!FLfile.exists(OUTPUT_DIR_URI)) FLfile.createFolder(OUTPUT_DIR_URI);

        var searchResults = fl.findObjectInDocByType("shape", doc);
        var scopedShapes = [];
        var targetCandidates = [];
        var controlCandidates = [];
        for (var resultIndex = 0; resultIndex < searchResults.length; resultIndex += 1) {
            var searchResult = searchResults[resultIndex];
            var shape = read(searchResult, "obj");
            if (!shape) continue;
            var captured = captureShape(shape, searchResult, resultIndex);
            if (captured.scope.libraryItemName !== TARGET_LIBRARY_ITEM) continue;
            scopedShapes.push(captured);
            if (captured.targetCandidate) targetCandidates.push(captured);
            if (captured.shape.isGroup === false && captured.shape.contourCount > 0) controlCandidates.push(captured);
        }

        output.animateShapes = {
            status: "CAPTURED",
            searchResultCount: searchResults.length,
            targetScopeShapeCount: scopedShapes.length,
            targetScopeShapes: scopedShapes,
            targetCandidates: targetCandidates,
            controlCandidates: controlCandidates,
            controlSelection: "UNRESOLVED_UNTIL_RAW_XFL_EXACTLY_IDENTIFIES_A_NATURALLY_CLOSED_SHAPE"
        };
        output.targetLocator.candidateCount = targetCandidates.length;
        output.targetLocator.locatorStatus = targetCandidates.length === 1 ?
            "ONE_FRAME_LAYER_CANDIDATE_REQUIRES_GEOMETRY_MAPPING" :
            (targetCandidates.length === 0 ? "NO_FRAME_LAYER_CANDIDATE" : "AMBIGUOUS_FRAME_LAYER_CANDIDATES");

        swfUri = uniqueOutputUri("issue736-adobe-published", ".swf");
        output.publishedSwf.outputUri = swfUri;
        output.publishedSwf.publishProfile = read(doc, "currentPublishProfile");
        output.publishedSwf.publishAction = "document.exportSWF(outputUri, true) using the current SWF publish settings";
        try {
            doc.exportSWF(swfUri, true);
            output.publishedSwf.status = FLfile.exists(swfUri) ? "EXPORTED_NEEDS_SHAPE_RECORD_DUMP" : "EXPORT_REQUESTED_FILE_NOT_FOUND";
            output.publishedSwf.sizeBytes = FLfile.exists(swfUri) ? FLfile.getSize(swfUri) : null;
        } catch (exportError) {
            output.publishedSwf.status = "EXPORT_FAILED";
            output.publishedSwf.error = asString(exportError);
        }

        output.source.fileModificationDateAfter = FLfile.getModificationDate(read(doc, "pathURI"));
        output.source.saveApiCalled = false;
        output.status = "CAPTURE_FINISHED_REQUIRES_EXTERNAL_XFL_AND_SWF_MAPPING";
    } catch (error) {
        output.status = "COLLECTION_FAILED";
        output.error = asString(error);
        if (doc) output.source.fileModificationDateAfter = FLfile.getModificationDate(read(doc, "pathURI"));
        output.source.saveApiCalled = false;
    }

    try {
        jsonUri = uniqueOutputUri("issue736-animate-oracle", ".json");
        output.receiptUri = jsonUri;
        if (!FLfile.write(jsonUri, json(output))) throw new Error("FLfile.write returned false for " + jsonUri);
        fl.trace("Issue #736 Animate oracle JSON: " + jsonUri);
        if (swfUri) fl.trace("Issue #736 published SWF: " + swfUri);
    } catch (writeError) {
        fl.trace("Issue #736 Animate oracle output failed: " + asString(writeError));
        alert("Issue #736 Animate oracle output failed: " + asString(writeError));
    }
})();
