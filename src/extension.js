const vscode = require("vscode");
const { parseRng } = require("./parseRng");

exports.activate = function activate(context) {
    const didChangeTreeDataEmitter = new vscode.EventEmitter();
    let isRelaxNG = false;
    let isTreeContentPinned = false;
    let currentTreeViewProvider = null;
    let currentDocumentUri = null;

    const treeViewProvider = {
        onDidChangeTreeData: didChangeTreeDataEmitter.event,
        getChildren: e => {
            if (currentTreeViewProvider == null && isRelaxNG) {
                const text = vscode.window.activeTextEditor?.document.getText();
                currentTreeViewProvider = new DocumentTreeViewProvider(parseRng(text));
                didChangeTreeDataEmitter.fire();
            }
            return currentTreeViewProvider?.getChildren(e) ?? [];
        },
        getTreeItem: e => currentTreeViewProvider?.getTreeItem(e),
    };

    vscode.window.registerTreeDataProvider("relaxng-outline.relaxNGOutline", treeViewProvider);
    vscode.window.onDidChangeActiveTextEditor(debounce(syncronizedEditorWithOutline, 200));
    vscode.workspace.onDidChangeTextDocument(debounce(syncronizedEditorWithOutline, 700));
    
    vscode.commands.registerCommand("relaxng-outline.refreshOutline", () => {
        syncronizedEditorWithOutline();
    });

    vscode.commands.registerCommand("relaxng-outline.pinContent", () => {
        isTreeContentPinned = true;
        vscode.commands.executeCommand("setContext", "relaxng-outline.contentPinned", true);
    });

    vscode.commands.registerCommand("relaxng-outline.unpinContent", () => {
        isTreeContentPinned = false;
        vscode.commands.executeCommand("setContext", "relaxng-outline.contentPinned", false);
        syncronizedEditorWithOutline();
    });

    vscode.commands.registerCommand("relaxng-outline.copyRngNodePath", (rngNode) => {
        if (rngNode.fullPath)
            vscode.env.clipboard.writeText(rngNode.fullPath);
        syncronizedEditorWithOutline();
    });

    vscode.commands.registerCommand("relaxng-outline.openRngNode", async rngNode => {
        let editor;
        if (isTreeContentPinned) { 
            const document = vscode.workspace.openTextDocument(currentDocumentUri);
            editor = await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false });
        } else {
            editor = vscode.window.activeTextEditor;
            await vscode.window.showTextDocument(editor.document, { preview: false, preserveFocus: false });
        }
        if (editor) {
            const position = new vscode.Position(rngNode.position.line, rngNode.position.column);
            var range = new vscode.Range(position, position);
            editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
            editor.selection = new vscode.Selection(range.start, range.end);
        }
    });

    function syncronizedEditorWithOutline() {
        if (isTreeContentPinned) {
            return;
        }
        const activeTextEditor = vscode.window.activeTextEditor;
        isRelaxNG =
            activeTextEditor?.document != undefined &&
            activeTextEditor?.document.uri.scheme === "file" &&
            activeTextEditor?.document.languageId === "xml" &&
            activeTextEditor?.document.getText().includes("<element");
        vscode.commands.executeCommand("setContext", "relaxng-outline.relaxNGOutlineEnabled", isRelaxNG);
        currentTreeViewProvider = null;
        if (isRelaxNG) {
            currentDocumentUri = activeTextEditor.document.uri;
        }
        didChangeTreeDataEmitter.fire();
    }

    syncronizedEditorWithOutline();
};

const debounce = (func, wait) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
};

class DocumentTreeViewProvider {
    constructor(parsedRngRoot) {
        this.parsedRngRoot = parsedRngRoot;
    }

    getChildren(rngNode) {
        if (!rngNode) return this.parsedRngRoot.elements;
        if (rngNode.type == "element") return [...(rngNode.attributes ?? []), ...(rngNode.elements ?? [])];
        if (rngNode.type == "attribute") return [rngNode.dataType];
        if (rngNode.type == "type") return rngNode.constraints;
    }

    getTreeItem(rngNode) {
        if (rngNode.type === "element") {
            const multiple = rngNode.properties["multiple"] === "true";
            const description = rngNode.properties["description"];
            const optional = rngNode.properties["optional"] === "true";
            return {
                label: rngNode.name + (optional ? " ?" : "") + (multiple ? " *️" : ""),
                collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
                description: (multiple ? "[array] " : "") + (description ?? ""),
                tooltip: new vscode.MarkdownString("#### " + rngNode.name + "\n\n" + (description ?? "")),
                iconPath: multiple ? new vscode.ThemeIcon("symbol-array") : new vscode.ThemeIcon("symbol-object"),
                contextValue: "relaxng-outline.rngNode.hasPath",
            };
        } else if (rngNode.type === "attribute") {
            const description = rngNode.properties["description"];
            const optional = rngNode.properties["optional"] === "true";
            return {
                label: rngNode.name + (optional ? " ?" : ""),
                collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
                description: description ?? "",
                tooltip: description ?? "",
                iconPath: new vscode.ThemeIcon("symbol-property"),
                contextValue: "relaxng-outline.rngNode.hasPath",
            };
        } else if (rngNode.type === "type") {
            const description = rngNode.properties["description"];
            return {
                label: "type" + (rngNode.base ? ` : ${rngNode.base}` : ""),
                collapsibleState:
                    rngNode.constraints.length > 0
                        ? vscode.TreeItemCollapsibleState.Expanded
                        : vscode.TreeItemCollapsibleState.None,
                description: description ?? "",
                tooltip: description,
                iconPath:
                    rngNode.base === "string"
                        ? new vscode.ThemeIcon("symbol-string")
                        : rngNode.base === "boolean"
                        ? new vscode.ThemeIcon("symbol-boolean")
                        : rngNode.base === "decimal"
                        ? new vscode.ThemeIcon("symbol-numeric")
                        : rngNode.base === "integer"
                        ? new vscode.ThemeIcon("symbol-numeric")
                        : rngNode.base === "gYear"
                        ? new vscode.ThemeIcon("history")
                        : rngNode.base === "date"
                        ? new vscode.ThemeIcon("history")
                        : rngNode.base === "base64Binary"
                        ? new vscode.ThemeIcon("file-binary")
                        : rngNode.base === "dateTime"
                        ? new vscode.ThemeIcon("history")
                        : new vscode.ThemeIcon("symbol-class"),
                contextValue: "relaxng-outline.rngNode",
            };
        } else if (rngNode.type === "constraint") {
            const description = rngNode.properties["description"];
            const value = rngNode.properties["value"];
            return {
                label: rngNode.name,
                collapsibleState: vscode.TreeItemCollapsibleState.None,
                description: value,
                tooltip: description + "\n" + value,
                iconPath:
                    rngNode.name === "enum"
                        ? new vscode.ThemeIcon("symbol-enum")
                        : rngNode.name === "enumeration"
                        ? new vscode.ThemeIcon("symbol-enum-member")
                        : rngNode.name === "pattern"
                        ? new vscode.ThemeIcon("regex")
                        : rngNode.base === "customvalidation"
                        ? new vscode.ThemeIcon("symbol-event")
                        : new vscode.ThemeIcon("symbol-constant"),
                contextValue: "relaxng-outline.rngNode",
            };
        }
        return {
            label: rngNode.name,
            collapsibleState: vscode.TreeItemCollapsibleState.None,
            contextValue: "relaxng-outline.rngNode",
        };
    }
}

exports.deactivate = () => {};
