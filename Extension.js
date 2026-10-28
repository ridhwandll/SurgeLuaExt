// Copyright (c) RidT. Licensed under the MIT License, see LICENSE.txt
'use strict';

const vscode = require('vscode');
const { ProjectIndex } = require('./Source/AssetIndex');
const { SurgeCompletionProvider } = require('./Source/Completion');
const { SurgeDiagnostics } = require('./Source/Diagnostics');
const { configureWorkspace, libraryApiPath } = require('./Source/WorkspaceSetup');
const { newScript, openApi } = require('./Source/Commands');

const LUA = { language: 'lua', scheme: 'file' };

async function activate(context)
{
    const projects = new ProjectIndex();
    const diagnostics = new SurgeDiagnostics(projects);
    context.subscriptions.push(projects, diagnostics);

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(LUA, new SurgeCompletionProvider(projects), '"', '\'', '/', '.'),
        vscode.languages.registerCodeActionsProvider(LUA, diagnostics, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),

        vscode.workspace.onDidOpenTextDocument(d => diagnostics.update(d)),
        vscode.workspace.onDidChangeTextDocument(e => diagnostics.schedule(e.document)),
        vscode.workspace.onDidCloseTextDocument(d => diagnostics.clear(d)),
        vscode.workspace.onDidChangeConfiguration(e =>
        {
            if(e.affectsConfiguration('surge.lua.diagnostics'))
                diagnostics.refreshAll();
        }),
        vscode.workspace.onDidChangeWorkspaceFolders(() => projects.scan()),
        projects.onDidChange(() => diagnostics.refreshAll()),

        vscode.commands.registerCommand('surge.newScript', (uri) => newScript(projects, uri)),
        vscode.commands.registerCommand('surge.configureWorkspace', () => configureWorkspace(context, projects, true)),
        vscode.commands.registerCommand('surge.openApi', () => openApi(libraryApiPath(context))),
        vscode.commands.registerCommand('surge.refreshAssets', () => projects.scan())
    );

    await projects.scan();
    await configureWorkspace(context, projects, false);
}

function deactivate()
{
}

module.exports = { activate, deactivate };
