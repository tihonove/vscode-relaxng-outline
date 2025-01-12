const sax = require("sax");

exports.parseRng = function parseRng(xml) {
    const parser = sax.parser(true);
    let root = { elements: [] };
    const stack = [root];
    const top = () => stack[stack.length - 1];

    parser.onopentag = node => {
        if (node.name === "element") {
            const element = {
                type: "element",
                fullPath: stack.map(x => x.name).join("/"),
                name: node.attributes.name,
                elements: [],
                attributes: [],
                position: { line: parser.line, column: parser.column },
                properties: node.attributes,
            };
            top().elements ??= [];
            top().elements.push(element);
            stack.push(element);
        }
        else if (node.name === "attribute") {
            const attribute = {
                type: "attribute",
                name: node.attributes.name,
                fullPath: stack.map(x => x.name).join("/") + "/@" + node.attributes.name,
                position: { line: parser.line, column: parser.column },
                properties: node.attributes,
                dataType: undefined,
            };
            if (top().attributes != undefined)
                top().attributes.push(attribute);
            stack.push(attribute);
        } else if (node.name === "type") {
            const typeNode = {
                type: "type",
                name: "type",
                base: node.attributes.base,
                position: { line: parser.line, column: parser.column },
                properties: node.attributes,
                constraints: [],
            };
            top().dataType = typeNode;
            stack.push(typeNode);
        } else if (top().type === "type") {
            const constraint = {
                type: "constraint",
                name: node.name,
                position: { line: parser.line, column: parser.column },
                properties: node.attributes,
            };
            if (top().constraints)
                top().constraints.push(constraint);
            stack.push(constraint);
        } else {
            stack.push({ name: node.name });
        }
    };

    parser.ontext = text => {};

    parser.onclosetag = node => {
        stack.pop();
    };

    parser.onerror = err => {
        console.error("Parsing error:", err.message);
        parser.resume();
    };

    parser.write(xml).close();
    return root;
}
