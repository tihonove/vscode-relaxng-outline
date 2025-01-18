const vscode = require("vscode");
const path = require("path");
const { parseRng } = require("./parseRng");

exports.activate = function activate(context) {
    const didChangeTreeDataEmitter = new vscode.EventEmitter();
    let isRelaxNG = false;
    let isTreeContentPinned = false;
    let followCursor = context.workspaceState.get("relaxng-outline.followCursor", false);
    let showOnErrorTreeViewProvider = null;
    let currentTreeViewProvider = null;
    let currentDocumentUri = null;

    const treeViewProvider = {
        onDidChangeTreeData: didChangeTreeDataEmitter.event,
        getParent: e => currentTreeViewProvider?.getParent(e),
        getChildren: e => {
            if (currentTreeViewProvider == null && isRelaxNG) {
                const text = vscode.window.activeTextEditor?.document.getText();
                try {
                    currentTreeViewProvider = new DocumentTreeViewProvider(parseRng(text), context);
                    showOnErrorTreeViewProvider = currentTreeViewProvider;
                    didChangeTreeDataEmitter.fire();
                } catch (error) {
                    currentTreeViewProvider = showOnErrorTreeViewProvider;
                }
            }
            return currentTreeViewProvider?.getChildren(e) ?? [];
        },
        getTreeItem: e => currentTreeViewProvider?.getTreeItem(e),
    };

    async function ensureTreeViewProviderExists() {
        if (treeView.visible) return;
        const children = treeViewProvider.getChildren();
        for (const child of children) {
            await treeView.reveal(child, { select: false, focus: false, expand: false });
            return;
        }
    }

    const treeView = vscode.window.createTreeView("relaxng-outline.relaxNGOutline", {
        treeDataProvider: treeViewProvider,
        showCollapseAll: true,
    });
    vscode.window.onDidChangeActiveTextEditor(debounce(syncronizedEditorWithOutline, 200));
    vscode.workspace.onDidChangeTextDocument(debounce(() => syncronizedEditorWithOutline(true), 700));

    vscode.commands.registerCommand("relaxng-outline.refreshOutline", () => {
        syncronizedEditorWithOutline();
    });

    vscode.commands.registerCommand("relaxng-outline.pinContent", () => {
        isTreeContentPinned = true;
        vscode.commands.executeCommand("setContext", "relaxng-outline.contentPinned", true);
    });

    vscode.commands.registerCommand("relaxng-outline.expandAllNodes", async () => {
        async function revealNode(node) {
            if (node.type === "attribute") {
                await treeView.reveal(node, { expand: false, focus: false, select: false });
            } else {
                const children = await treeViewProvider.getChildren(node);
                if (children) {
                    for (const child of children) {
                        revealNode(child);
                    }
                }
            }
        }

        const rootNodes = await treeViewProvider.getChildren();
        if (rootNodes) {
            for (const rootNode of rootNodes) {
                await revealNode(rootNode);
            }
        }
    });

    vscode.commands.registerCommand("relaxng-outline.unpinContent", () => {
        isTreeContentPinned = false;
        vscode.commands.executeCommand("setContext", "relaxng-outline.contentPinned", false);
        syncronizedEditorWithOutline();
    });

    vscode.commands.registerCommand("relaxng-outline.enableFollowCursor", () => {
        followCursor = true;
        vscode.commands.executeCommand("setContext", "relaxng-outline.followCursor", followCursor);
        context.workspaceState.update("relaxng-outline.followCursor", followCursor);
    });

    vscode.commands.registerCommand("relaxng-outline.disableFollowCursor", () => {
        followCursor = false;
        vscode.commands.executeCommand("setContext", "relaxng-outline.followCursor", followCursor);
        context.workspaceState.update("relaxng-outline.followCursor", followCursor);
    });

    vscode.commands.registerCommand("relaxng-outline.copyRngNodePath", rngNode => {
        if (rngNode.fullPath) vscode.env.clipboard.writeText(rngNode.fullPath);
        syncronizedEditorWithOutline();
    });

    vscode.commands.registerCommand("relaxng-outline.revealNodeAtCursor", () => {
        const textEditor = vscode.window.activeTextEditor;
        revealNodeAtCursorForEditor(textEditor, true, false);
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
            const startPosition = new vscode.Position(rngNode.range.start.line, rngNode.range.start.column);
            const endPosition = new vscode.Position(rngNode.range.end.line, rngNode.range.end.column);
            var range = new vscode.Range(startPosition, endPosition);
            editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
            editor.selection = new vscode.Selection(range.start, range.end);
        }
    });

    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(async event => {
            if (!followCursor) return;
            await revealNodeAtCursorForEditor(event.textEditor, false, true);
        })
    );

    async function revealNodeAtCursorForEditor(textEditor, focus, skipIfInvisible) {
        if (textEditor?.document?.uri.toString() !== currentDocumentUri?.toString()) return;
        if (skipIfInvisible && !(treeView?.visible ?? false)) return;
        await ensureTreeViewProviderExists();
        const position = textEditor.selections[0]?.active;
        const offset = textEditor.document.offsetAt(position);
        if (position) {
            const node = currentTreeViewProvider?.getNodeForOffset(offset);
            if (node) {
                await treeView.reveal(node, { select: true, focus: focus });
            }
        }
    }

    function syncronizedEditorWithOutline(doNotResetPreviousContent = false) {
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
        if (!doNotResetPreviousContent) {
            showOnErrorTreeViewProvider = null;
        }
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
    constructor(parsedRngRoot, context) {
        this.parsedRngRoot = parsedRngRoot;
        this.context = context;
    }

    getNodeForOffset(offset) {
        const findByOffsetDfs = rngNode => {
            for (var child of this.getChildren(rngNode) ?? []) {
                if (child?.range?.start?.offset <= offset && child?.range?.end?.offset >= offset) {
                    return findByOffsetDfs(child);
                }
            }
            return rngNode;
        };
        const r = findByOffsetDfs(undefined);
        return findByOffsetDfs(undefined);
    }

    getParent(rngNode) {
        return rngNode?.parent;
    }

    getChildren(rngNode) {
        if (!rngNode) return this.parsedRngRoot.elements;
        if (rngNode.type == "element") return [...(rngNode.attributes ?? []), ...(rngNode.elements ?? [])];
        if (rngNode.type == "choice") return [...(rngNode.attributes ?? []), ...(rngNode.elements ?? [])];
        if (rngNode.type == "attribute") return [rngNode.dataType];
        if (rngNode.type == "type") return rngNode.constraints;
        return rngNode.children ?? [];
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
        } else if (rngNode.type === "choice") {
            return {
                label: "choice",
                collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
                iconPath: new vscode.ThemeIcon("type-hierarchy"),
                contextValue: "relaxng-outline.rngNode",
            };
        } else if (rngNode.type === "attribute") {
            const description = rngNode.properties["description"];
            const optional = rngNode.properties["optional"] === "true";
            return {
                label: rngNode.name + (optional ? " ?" : ""),
                collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
                description: description ?? "",
                tooltip: description ?? "",
                iconPath: new vscode.ThemeIcon("mention"),
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
                tooltip: new vscode.MarkdownString(
                    `#### Type ${rngNode.base ? ` : ${rngNode.base}` : ""}\n\n${description ?? ""}`
                ),
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
            description: rngNode.name != rngNode.type ? rngNode.type : "",
            collapsibleState: rngNode.children?.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
            contextValue: "relaxng-outline.rngNode",
            iconPath: new vscode.ThemeIcon(rngNodeTypeIcons[rngNode.type] ?? "code")
        };
    }
}

exports.deactivate = () => {};

const rngNodeTypeIcons = {
    "group": "code",
    "interleave": "code",
    "optional": "code",
    "zeroOrMore": "code",
    "oneOrMore": "plus",
    "list": "checklist",
    "mixed": "symbol-misc",
    "ref": "symbol-reference",
    "parentRef": "references",
    "empty": "remove-close",
    "text": "symbol-string",
    "value": "symbol-constant",
    "data": "symbol-constant",
    "notAllowed": "remove-close",
    "externalRef": "symbol-reference",
    "grammar": "symbol-class",
    "define": "symbol-class",
    "div": "code",
    "include": "symbol-reference",
    "start": "target",
};
