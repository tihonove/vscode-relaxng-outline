const sax = require("sax");

const rngPatternNames = new Set([
    "group",
    "interleave",
    "optional",
    "zeroOrMore",
    "oneOrMore",
    "list",
    "mixed",
    "ref",
    "parentRef",
    "empty",
    "text",
    "value",
    "data",
    "notAllowed",
    "externalRef",
    "grammar",
]);

const grammarContentNames = new Set(["define", "div", "include", "start"]);

const otherNames = new Set(["anyName", "except"]);


exports.parseRng = function parseRng(xml) {
    const parser = sax.parser(true);
    let root = { elements: [] };
    const stack = [root];
    const top = () => stack[stack.length - 1];
    let openTagPosition;

    parser.onopentagstart = () => {
        openTagPosition = {
            line: parser.line,
            column: parser.column - (parser.position - parser.startTagPosition) - 1,
            offset: parser.startTagPosition,
        };
    };

    parser.onopentag = node => {
        let result;
        if (node.name === "element") {
            result = {
                type: "element",
                fullPath:
                    stack
                        .filter(x => x.type === "element")
                        .map(x => x.name)
                        .join("/") +
                    "/" +
                    node.attributes.name,
                name: node.attributes.name ?? "element",
                elements: [],
                attributes: [],
                properties: node.attributes,
            };
            if (top().children != undefined) top().children.push(result);
            else (top().elements ??= []).push(result);
        } else if (node.name === "attribute") {
            result = {
                type: "attribute",
                name: node.attributes.name ?? "attribute",
                fullPath:
                    stack
                        .filter(x => x.type === "element")
                        .map(x => x.name)
                        .join("/") +
                    "/@" +
                    node.attributes.name,
                properties: node.attributes,
                dataType: undefined,
            };
            if (top().children != undefined) top().children.push(result);
            else if (top().attributes != undefined) top().attributes.push(result);
        } else if (node.name === "choice") {
            result = {
                type: "choice",
                name: "choice",
                elements: [],
                attributes: [],
            };
            if (top().children != undefined) top().children.push(result);
            else if (top().elements != undefined) top().elements.push(result);
        } else if (rngPatternNames.has(node.name) || grammarContentNames.has(node.name)) {
            result = {
                type: node.name,
                name: node.attributes.name ?? node.name,
                children: [],
            };
            if (top().children != undefined) top().children.push(result);
            else if (top().elements != undefined) top().elements.push(result);
        } else if (node.name === "type") {
            result = {
                type: "type",
                name: "type",
                base: node.attributes.base,
                properties: node.attributes,
                constraints: [],
            };
            top().dataType = result;
        } else if (top().type === "type") {
            result = {
                type: "constraint",
                name: node.name,
                properties: node.attributes,
            };
            if (top().constraints) top().constraints.push(result);
        } else {
            result = { name: node.name };
        }
        result.position = openTagPosition;
        result.range = { start: openTagPosition };
        result.parent = top();
        stack.push(result);
    };

    parser.ontext = () => {};

    parser.onclosetag = () => {
        const lastElement = stack.pop();
        if (lastElement.range) {
            lastElement.range.end = { line: parser.line, column: parser.column, offset: parser.position };
        }
    };

    parser.onerror = err => {
        throw err;
    };

    parser.write(xml).close();
    return root;
};
