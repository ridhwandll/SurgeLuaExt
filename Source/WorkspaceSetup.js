// Copyright (c) RidT. Licensed under the MIT License, see LICENSE.txt
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const API_FILE = 'SurgeAPI.lua';
const LIBRARY_FILES = [API_FILE, 'Sandbox.lua'];

// The definition files live in global storage, so the path written into workspace settings survives extension updates
function installLibrary(context)
{
    const target = path.join(context.globalStorageUri.fsPath, 'library');
    fs.mkdirSync(target, { recursive: true });
    for(const file of LIBRARY_FILES)
    {
        const source = path.join(context.extensionPath, 'Library', file);
        if(!fs.existsSync(source))
        {
            vscode.window.showErrorMessage(`Surge: ${file} is missing from the extension, run Scripts/Build.js.`);
            continue;
        }

        const content = fs.readFileSync(source);
        const destination = path.join(target, file);
        if(!fs.existsSync(destination) || !content.equals(fs.readFileSync(destination)))
            fs.writeFileSync(destination, content);
    }
    return target;
}

function sameValue(a, b)
{
    return JSON.stringify(a) === JSON.stringify(b);
}

// Lua language server settings for one workspace folder: the API library, Lua 5.4, and the standard
// library the engine actually opens (no io/debug, os reduced to time functions: Library/Sandbox.lua)
async function configureFolder(folder, assetsUri, libraryPath)
{
    const config = vscode.workspace.getConfiguration('Lua', folder.uri);
    const current = (key) => config.inspect(key).workspaceFolderValue;
    const updates = [];

    if(current('runtime.version') !== 'Lua 5.4')
        updates.push(['runtime.version', 'Lua 5.4']);

    const builtin = Object.assign({}, current('runtime.builtin') || {}, { io: 'disable', debug: 'disable', os: 'disable' });
    if(!sameValue(builtin, current('runtime.builtin')))
        updates.push(['runtime.builtin', builtin]);

    const library = (current('workspace.library') || []).slice();
    if(!library.some(entry => path.resolve(entry) === path.resolve(libraryPath)))
    {
        library.push(libraryPath);
        updates.push(['workspace.library', library]);
    }

    // require("Scripts.Game.State") is relative to the Assets folder, which may sit below the workspace root
    const relative = path.relative(folder.uri.fsPath, assetsUri.fsPath).split(path.sep).join('/');
    const runtimePath = ['?.lua', '?/init.lua'];
    if(relative.length > 0)
        runtimePath.push(`${relative}/?.lua`, `${relative}/?/init.lua`);
    const existingPath = current('runtime.path');
    const mergedPath = [...new Set([...(existingPath || []), ...runtimePath])];
    if(!sameValue(mergedPath, existingPath))
        updates.push(['runtime.path', mergedPath]);

    for(const [key, value] of updates)
        await config.update(key, value, vscode.ConfigurationTarget.WorkspaceFolder);
    return updates.length;
}

async function configureWorkspace(context, projects, explicit)
{
    if(projects.Projects.length === 0)
    {
        if(explicit)
            vscode.window.showWarningMessage('Surge: no Surge project (AssetRegistry.surge) in this workspace.');
        return;
    }

    const mode = vscode.workspace.getConfiguration('surge.lua').get('configureWorkspace', 'always');
    if(!explicit)
    {
        if(mode === 'never')
            return;
        if(mode === 'ask')
        {
            const answer = context.workspaceState.get('surge.configureAnswer');
            if(answer === 'no')
                return;
            if(answer !== 'yes')
            {
                const choice = await vscode.window.showInformationMessage(
                    'Surge: configure the Lua language server for this project (Surge API, Lua 5.4, sandboxed standard library)?', 'Yes', 'No');
                if(!choice)
                    return;
                await context.workspaceState.update('surge.configureAnswer', choice === 'Yes' ? 'yes' : 'no');
                if(choice !== 'Yes')
                    return;
            }
        }
    }

    const libraryPath = installLibrary(context);
    let changed = 0;
    try
    {
        for(const project of projects.Projects)
        {
            const folder = vscode.workspace.getWorkspaceFolder(project.AssetsUri);
            if(folder)
                changed += await configureFolder(folder, project.AssetsUri, libraryPath);
        }
    }
    catch(error)
    {
        vscode.window.showErrorMessage(`Surge: could not write the Lua settings (${error.message}). Is the Lua extension (sumneko.lua) installed?`);
        return;
    }

    if(explicit)
        vscode.window.showInformationMessage(changed > 0 ? 'Surge: Lua language server configured.' : 'Surge: the Lua language server was already configured.');
    await warnAboutApiCopies(context, projects);
}

// Projects made before the extension carry their own SurgeAPI.lua: two definitions of every class confuse completion
async function warnAboutApiCopies(context, projects)
{
    for(const project of projects.Projects)
    {
        const copies = await vscode.workspace.findFiles(new vscode.RelativePattern(project.AssetsUri, '**/' + API_FILE));
        const folder = vscode.workspace.getWorkspaceFolder(project.AssetsUri);
        if(copies.length === 0 || !folder)
            continue;

        const dismissedKey = 'surge.apiCopyDismissed:' + project.AssetsPath;
        if(context.workspaceState.get(dismissedKey))
            continue;

        const config = vscode.workspace.getConfiguration('Lua', folder.uri);
        const ignored = (config.inspect('workspace.ignoreDir').workspaceFolderValue || []).slice();
        const relatives = copies.map(uri => path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join('/')).filter(r => !ignored.includes(r));
        if(relatives.length === 0)
            continue;

        const choice = await vscode.window.showWarningMessage(
            `Surge: this project has its own copy of the API (${relatives.join(', ')}). The Surge extension already provides it, ` +
            'and an outdated copy shadows the current API. Let the language server ignore the copy?', 'Ignore Copy', 'Keep Using It');
        if(choice === 'Ignore Copy')
            await config.update('workspace.ignoreDir', [...ignored, ...relatives], vscode.ConfigurationTarget.WorkspaceFolder);
        else if(choice === 'Keep Using It')
            await context.workspaceState.update(dismissedKey, true);
    }
}

function libraryApiPath(context)
{
    return path.join(installLibrary(context), API_FILE);
}

module.exports = { configureWorkspace, libraryApiPath };
