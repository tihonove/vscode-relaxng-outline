const sax = require("sax");

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
                name: node.attributes.name,
                elements: [],
                attributes: [],
                properties: node.attributes,
            };
            top().elements ??= [];
            top().elements.push(result);
        } else if (node.name === "attribute") {
            result = {
                type: "attribute",
                name: node.attributes.name,
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
            if (top().attributes != undefined) top().attributes.push(result);
        } else if (node.name === "choice") {
            result = {
                type: "choice",
                name: "choice",
                elements: [],
                attributes: [],
            };
            if (top().elements != undefined) top().elements.push(result);
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
