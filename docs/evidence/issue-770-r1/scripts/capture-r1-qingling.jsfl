(function () {
    var ROOT = "D:/PandaStage-Acceptance/REA-R1-770-20261013";
    var SOURCE_PATH = ROOT + "/input/qingling-source-copy.fla";
    var SCENE_PNG = ROOT + "/animate/scene-00.png";
    var SYMBOL_PNG = ROOT + "/animate/symbol-00.png";
    var RECEIPT = ROOT + "/animate/capture.json";
    var EXPECTED_ROOT = "\u91cd\u590d\u9879\u76ee\u6587\u4ef6\u5939/\u5143\u4ef6 1";
    var EXPECTED_TWEEN5 = "\u91cd\u590d\u9879\u76ee\u6587\u4ef6\u5939/\u8865\u95f4 5";
    var SOURCE_URI = FLfile.platformPathToURI(SOURCE_PATH);

    function read(object, property) {
        try { return object[property]; } catch (error) { return null; }
    }
    function quoteJson(value) {
        var result = "\"";
        for (var index = 0; index < value.length; index += 1) {
            var character = value.charAt(index);
            var code = value.charCodeAt(index);
            if (character === "\"") result += "\\\"";
            else if (character === "\\") result += "\\\\";
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
        for (var property in value) if (value.hasOwnProperty(property)) objectParts.push(quoteJson(property) + ":" + json(value[property]));
        return "{" + objectParts.join(",") + "}";
    }
    function matrixValue(matrix) {
        if (!matrix) return null;
        return {a:read(matrix,"a"),b:read(matrix,"b"),c:read(matrix,"c"),d:read(matrix,"d"),tx:read(matrix,"tx"),ty:read(matrix,"ty")};
    }
    function normalizeName(name) { return String(name || "").replace(/\\/g,"/"); }
    function captureLayerInstances(timeline, frameIndex, scope) {
        var rows = [];
        var layers = read(timeline, "layers") || [];
        for (var layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
            var layer = layers[layerIndex];
            var frames = read(layer, "frames") || [];
            var frame = frames[frameIndex] || null;
            if (!frame && frames.length) {
                for (var searchIndex = frameIndex; searchIndex >= 0; searchIndex -= 1) {
                    var candidate = frames[searchIndex];
                    var start = read(candidate, "startFrame");
                    var duration = read(candidate, "duration");
                    if (candidate && start !== null && duration !== null && start <= frameIndex && start + duration > frameIndex) { frame = candidate; break; }
                }
            }
            var elements = frame ? (read(frame, "elements") || []) : [];
            for (var elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
                var element = elements[elementIndex];
                var item = read(element, "libraryItem");
                var itemName = item ? normalizeName(read(item, "name")) : null;
                rows.push({
                    scope:scope, layerIndex:layerIndex, layerName:read(layer,"name"), layerVisible:read(layer,"visible"),
                    frameIndex:frameIndex, keyframeStart:read(frame,"startFrame"), keyframeDuration:read(frame,"duration"),
                    elementIndex:elementIndex, elementType:read(element,"elementType"), instanceName:read(element,"name"),
                    libraryItemName:itemName, symbolType:item ? read(item,"symbolType") : null,
                    libraryItemFrameCount:item ? read(read(item,"timeline"),"frameCount") : null,
                    firstFrame:read(element,"firstFrame"), lastFrame:read(element,"lastFrame"), loop:read(element,"loop"),
                    visible:read(element,"visible"), depth:read(element,"depth"), depthObservation:read(element,"depth") === null ? "UNKNOWN" : "OBSERVED", matrix:matrixValue(read(element,"matrix")),
                    sourceAddress:scope + "/layer-" + layerIndex + "-frame-" + read(frame,"startFrame") + "/" + elementIndex
                });
            }
        }
        return rows;
    }
    var receipt = {
        schema:"issue770-r1-animate-capture/1", issue:770, stage:"R1 only",
        animateVersion:read(fl,"version"), expectedDocumentPath:SOURCE_PATH,
        saveApiCalled:false, sourceModificationDateBefore:FLfile.getModificationDate(SOURCE_URI), status:"STARTED"
    };
    try {
        var doc = fl.getDocumentDOM();
        if (!doc) throw new Error("No active Animate document is open");
        receipt.documentPath = read(doc,"path");
        receipt.documentPathMatches = normalizeName(receipt.documentPath).toLowerCase() === SOURCE_PATH.toLowerCase();
        if (!receipt.documentPathMatches) throw new Error("Active document is not the exact-hash R1 inspection copy");
        receipt.documentModifiedBefore = read(doc,"modified");
        if (receipt.documentModifiedBefore === true) throw new Error("Inspection copy was already modified before capture");
        var sceneTimeline = doc.getTimeline();
        receipt.scene = {
            name:read(sceneTimeline,"name"), frameCount:read(sceneTimeline,"frameCount"), layerCount:read(sceneTimeline,"layerCount"),
            currentFrame:read(sceneTimeline,"currentFrame"), stageWidth:read(doc,"width"), stageHeight:read(doc,"height"), targetFrame:0
        };
        if (receipt.scene.currentFrame !== 0) throw new Error("Scene was not already at frame 0; capture refused to move its playhead");
        receipt.sceneInstances = captureLayerInstances(sceneTimeline,0,"scene:0");
        receipt.sceneRootMatch = null;
        for (var sceneIndex = 0; sceneIndex < receipt.sceneInstances.length; sceneIndex += 1) {
            if (receipt.sceneInstances[sceneIndex].libraryItemName === EXPECTED_ROOT) receipt.sceneRootMatch = receipt.sceneInstances[sceneIndex];
        }
        if (!receipt.sceneRootMatch) throw new Error("Exact Scene instance for the repeated-folder root symbol was not found");
        if (!doc.exportPNG(FLfile.platformPathToURI(SCENE_PNG), true, true)) throw new Error("Animate Scene frame-0 exportPNG returned false");
        receipt.sceneExport = {path:SCENE_PNG, exported:true, sourceAddress:"Scene@0/instance:" + EXPECTED_ROOT + "@0"};

        var libraryItems = read(doc.library,"items") || [];
        receipt.libraryRootMatches = [];
        for (var itemIndex = 0; itemIndex < libraryItems.length; itemIndex += 1) {
            if (normalizeName(read(libraryItems[itemIndex],"name")) === EXPECTED_ROOT) {
                receipt.libraryRootMatches.push({name:read(libraryItems[itemIndex],"name"),itemType:read(libraryItems[itemIndex],"itemType"),symbolType:read(libraryItems[itemIndex],"symbolType"),frameCount:read(read(libraryItems[itemIndex],"timeline"),"frameCount")});
            }
        }
        doc.library.editItem(EXPECTED_ROOT);
        var symbolTimeline = doc.getTimeline();
        receipt.symbol = {name:read(symbolTimeline,"name"),frameCount:read(symbolTimeline,"frameCount"),layerCount:read(symbolTimeline,"layerCount"),currentFrame:read(symbolTimeline,"currentFrame"),targetFrame:0};
        if (receipt.symbol.currentFrame !== 0) throw new Error("Symbol was not already at authored frame 0; capture refused to move its playhead");
        receipt.symbolInstances = captureLayerInstances(symbolTimeline,0,"graphic:" + EXPECTED_ROOT + "@0");
        receipt.suspectNestedInstances = [];
        for (var nestedIndex = 0; nestedIndex < receipt.symbolInstances.length; nestedIndex += 1) {
            var nestedName = receipt.symbolInstances[nestedIndex].libraryItemName || "";
            if (nestedName.indexOf("\u8865\u95f4 5") >= 0) receipt.suspectNestedInstances.push(receipt.symbolInstances[nestedIndex]);
        }
        if (!doc.exportPNG(FLfile.platformPathToURI(SYMBOL_PNG), true, true)) throw new Error("Animate symbol-edit frame-0 exportPNG returned false");
        receipt.symbolExport = {path:SYMBOL_PNG, exported:true, sourceAddress:"Graphic:" + EXPECTED_ROOT + "@0"};
        receipt.documentModifiedAfter = read(doc,"modified");
        receipt.sourceModificationDateAfter = FLfile.getModificationDate(SOURCE_URI);
        receipt.sourceFileModificationDateUnchanged = receipt.sourceModificationDateBefore === receipt.sourceModificationDateAfter;
        receipt.status = "CAPTURED";
    } catch (error) {
        receipt.status = "CAPTURE_FAILED";
        receipt.error = String(error);
        receipt.saveApiCalled = false;
    }
    if (!FLfile.write(FLfile.platformPathToURI(RECEIPT), json(receipt))) fl.trace("Issue #770 R1 Animate capture failed to write receipt: " + RECEIPT);
    else fl.trace("Issue #770 R1 Animate capture receipt: " + RECEIPT);
})();