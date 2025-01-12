const { parseRng } = require("../src/parseRng.js");
const fs = require("fs");
const path = require("path");

describe("RelaxNG Parser", () => {
    test("Minimal example", () => {
        expect(
            parseRng(`<?xml version="1.0" encoding="utf-8"?>
            <element name="A">
            <attribute name="a">
                <type base="string" />
            </attribute>
            </element>
        `)
        ).toMatchSnapshot()
    });
});

describe("RelaxNG Parser Test files parser", () => {
    const testFilesDir = path.join(__dirname, "test-files");
    const testFiles = fs.readdirSync(testFilesDir, { recursive: true }).filter(file => file.endsWith(".rng.xml"));
    
    test.each(testFiles)("Parse %s without errors", fileName => {
        const filePath = path.join(testFilesDir, fileName);
        const fileContent = fs.readFileSync(filePath, "utf-8");
        const relaxNg = dropPositions(parseRng(fileContent));
        expect(relaxNg).toMatchSnapshot();
    });
});

function dropPositions(relaxNgNode) {
    delete relaxNgNode["position"];
    relaxNgNode.attributes?.forEach(dropPositions);
    relaxNgNode.elements?.forEach(dropPositions);
    return relaxNgNode;
}
