// Copyright (c) RidT. Licensed under the MIT License, see LICENSE.txt
'use strict';

const vscode = require('vscode');
const { tokenize } = require('./LuaLexer');
const { ROLE, ASSET_EXTENSIONS, ASSET_TYPES, ARRAY_ELEMENTS, OVERLAY_MODES, analyzeString } = require('./LuaCalls');
const { AssetIndex } = require('./AssetIndex');

const ASSET_ICONS = {
    TEXTURE2D: vscode.CompletionItemKind.File,
    MESH: vscode.CompletionItemKind.Struct,
    MATERIAL: vscode.CompletionItemKind.Color,
    SCENE: vscode.CompletionItemKind.Folder,
    SCRIPT: vscode.CompletionItemKind.Module,
    FONT: vscode.CompletionItemKind.Text,
    AUDIO: vscode.CompletionItemKind.Event,
    UI_LAYOUT: vscode.CompletionItemKind.Interface,
    PARTICLE_EFFECT: vscode.CompletionItemKind.Event
};

// The string token the cursor is inside of (between its quotes), or -1
function stringAt(tokens, offset)
{
    for(let i = 0; i < tokens.length; i++)
    {
        const t = tokens[i];
        if(t.Start >= offset)
            break;
        if(t.Type === 'STRING' && offset >= t.ContentStart && offset <= t.ContentEnd)
            return i;
    }
    return -1;
}

function item(label, kind, range, detail, sortText)
{
    const completion = new vscode.CompletionItem(label, kind);
    completion.range = range;
    completion.detail = detail;
    completion.filterText = label;
    if(sortText)
        completion.sortText = sortText;
    return completion;
}

class SurgeCompletionProvider
{
    constructor(projects)
    {
        this.mProjects = projects;
    }

    provideCompletionItems(document, position)
    {
        const project = this.mProjects.projectFor(document.uri);
        if(!project)
            return undefined;

        const text = document.getText();
        const offset = document.offsetAt(position);
        const tokens = tokenize(text);
        const index = stringAt(tokens, offset);
        if(index < 0)
            return undefined;
        const token = tokens[index];
        const info = analyzeString(tokens, index);
        if(!info)
            return undefined;

        // Replace the whole string content, so picking an entry mid-path never leaves half of the old one
        const range = new vscode.Range(document.positionAt(token.ContentStart), document.positionAt(token.ContentEnd));
        const items = [];
        switch(info.Role)
        {
            case ROLE.ASSET_OF_KIND:
            {
                for(const asset of project.Assets)
                {
                    if(info.AssetKind && asset.Type !== info.AssetKind)
                        continue;
                    // Built-in meshes after the project's own assets
                    const builtin = asset.Path.startsWith('Engine://');
                    items.push(item(asset.Path, ASSET_ICONS[asset.Type] || vscode.CompletionItemKind.File, range, asset.Type, (builtin ? '1' : '0') + asset.Path));
                }
                break;
            }
            case ROLE.ASSET_KIND:
                ASSET_TYPES.forEach(type => items.push(item(type, vscode.CompletionItemKind.EnumMember, range, ASSET_EXTENSIONS[type].join(' '))));
                break;
            case ROLE.ARRAY_ELEMENT:
                ARRAY_ELEMENTS.forEach((type, i) => items.push(item(type, vscode.CompletionItemKind.EnumMember, range, 'Property.Array element', String(i).padStart(3, '0'))));
                break;
            case ROLE.OVERLAY_MODE:
                OVERLAY_MODES.forEach((mode, i) => items.push(item(mode, vscode.CompletionItemKind.EnumMember, range, 'Performance overlay', String(i))));
                break;
            case ROLE.MODULE:
            {
                const self = project.contains(document.uri) ? project.relativePath(document.uri) : '';
                for(const script of project.scripts())
                {
                    if(script.Path === self)
                        continue;
                    const completion = item(AssetIndex.moduleName(script.Path), vscode.CompletionItemKind.Module, range, script.Path);
                    items.push(completion);
                }
                break;
            }
            case ROLE.SCRIPT_NAME:
            {
                const stems = new Set(project.scripts().map(s => AssetIndex.scriptStem(s.Path)));
                stems.forEach(stem => items.push(item(stem, vscode.CompletionItemKind.Module, range, 'Script')));
                break;
            }
            case ROLE.ENTITY_NAME:
                for(const [name, scenes] of project.EntityNames)
                    items.push(item(name, vscode.CompletionItemKind.Reference, range, scenes.join(', ')));
                break;
            case ROLE.WIDGET_NAME:
                for(const [name, entries] of project.Widgets)
                {
                    const types = [...new Set(entries.map(e => e.Type))].join('/');
                    const layouts = [...new Set(entries.map(e => e.Layout))].join(', ');
                    items.push(item(name, vscode.CompletionItemKind.Field, range, `${types} in ${layouts}`));
                }
                break;
            case ROLE.LAYER:
                project.Layers.forEach(layer => items.push(item(layer.Name, vscode.CompletionItemKind.EnumMember, range, `Layer ${layer.Index}`, String(layer.Index).padStart(2, '0'))));
                break;
        }
        return new vscode.CompletionList(items, false);
    }
}

module.exports = { SurgeCompletionProvider };
