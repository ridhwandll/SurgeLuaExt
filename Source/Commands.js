// Copyright (c) RidT. Licensed under the MIT License, see LICENSE.txt
'use strict';

const vscode = require('vscode');
const path = require('path');
const { AssetIndex } = require('./AssetIndex');

const TEMPLATES = [
    {
        Label: 'Entity Script',
        Detail: 'Callbacks + Properties, added to an entity with a Script Component',
        Build: (name) => `-- ${name}

Properties = {
    Speed = Property.Float(5.0, 0.0, 20.0, "Units per second"),
}

---@param entity Entity
function OnCreate(entity)
end

---@param entity Entity
---@param deltaTime number
function OnUpdate(entity, deltaTime)
end
`
    },
    {
        Label: 'Module',
        Detail: 'Shared code and state, loaded with require()',
        Build: (name, moduleName) => `-- ${name}: one instance per play session, shared by every script that requires it
--   local ${name} = require("${moduleName}")

local ${name} = {}

return ${name}
`
    },
    {
        Label: 'UI Canvas Script',
        Detail: 'Script of a UI Canvas Component: finds widgets of its layout',
        Build: (name) => `-- ${name}

---@param entity Entity
function OnCreate(entity)
    local canvas = entity.UICanvasC
    local button = canvas:FindWidget("Button") --[[@as UIButton]]
    if button then
        button:OnClick(function(self)
            Log.Info("Clicked " .. self.Name)
        end)
    end
end
`
    }
];

async function exists(uri)
{
    try
    {
        await vscode.workspace.fs.stat(uri);
        return true;
    }
    catch
    {
        return false;
    }
}

async function newScript(projects, folderUri)
{
    let project = folderUri ? projects.projectFor(vscode.Uri.joinPath(folderUri, 'x')) : null;
    if(!project)
    {
        const active = vscode.window.activeTextEditor;
        project = (active && projects.projectFor(active.document.uri)) || projects.Projects[0];
        folderUri = null;
    }
    if(!project)
    {
        vscode.window.showWarningMessage('Surge: no Surge project (AssetRegistry.surge) in this workspace.');
        return;
    }
    if(!folderUri)
        folderUri = vscode.Uri.joinPath(project.AssetsUri, 'Scripts');

    const template = await vscode.window.showQuickPick(TEMPLATES.map(t => ({ label: t.Label, detail: t.Detail, template: t })), { placeHolder: 'Script type' });
    if(!template)
        return;

    const name = await vscode.window.showInputBox({
        prompt: `New script in ${project.relativePath(folderUri) || 'Assets'}`,
        placeHolder: 'PlayerController',
        validateInput: (value) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) ? null : 'Letters, digits and underscores, not starting with a digit'
    });
    if(!name)
        return;

    const fileUri = vscode.Uri.joinPath(folderUri, name + '.lua');
    if(await exists(fileUri))
    {
        vscode.window.showWarningMessage(`Surge: ${name}.lua already exists.`);
        return;
    }

    const moduleName = AssetIndex.moduleName(project.relativePath(fileUri));
    await vscode.workspace.fs.createDirectory(folderUri);
    await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(template.template.Build(name, moduleName)));
    await vscode.window.showTextDocument(fileUri);
}

async function openApi(apiPath)
{
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(apiPath));
    await vscode.window.showTextDocument(document, { preview: true });
}

module.exports = { newScript, openApi };
