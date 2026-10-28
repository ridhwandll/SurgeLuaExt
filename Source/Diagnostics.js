// Copyright (c) RidT. Licensed under the MIT License, see LICENSE.txt
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { tokenize } = require('./LuaLexer');
const { ROLE, ASSET_EXTENSIONS, ASSET_TYPES, ARRAY_ELEMENTS, OVERLAY_MODES, analyzeString } = require('./LuaCalls');
const { AssetIndex } = require('./AssetIndex');

// ScriptEngine::Instantiate looks these up by name, a misspelled one silently never runs
const CALLBACKS = ['OnCreate', 'OnEnable', 'OnDisable', 'OnFixedUpdate', 'OnUpdate', 'OnLateUpdate', 'OnDestroy',
                   'OnCollisionEnter', 'OnCollisionExit', 'OnTriggerEnter', 'OnTriggerExit'];

function editDistance(a, b)
{
    const row = Array.from({ length: b.length + 1 }, (_, j) => j);
    for(let i = 1; i <= a.length; i++)
    {
        let diagonal = row[0];
        row[0] = i;
        for(let j = 1; j <= b.length; j++)
        {
            const above = row[j];
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
            diagonal = above;
        }
    }
    return row[b.length];
}

function closestCallback(name)
{
    let best = null;
    let bestDistance = 3;
    for(const callback of CALLBACKS)
    {
        const distance = callback.toLowerCase() === name.toLowerCase() ? 0 : editDistance(name, callback);
        if(distance < bestDistance)
        {
            best = callback;
            bestDistance = distance;
        }
    }
    return best;
}

// "Scene.Load", "Property.Asset", but only "SetMesh" for entity.MeshC:SetMesh
function calleeName(call)
{
    const names = call.Callee.filter(n => n !== '?');
    return names.length === 2 && call.Callee[0] !== '?' && /^[A-Z]/.test(names[0]) ? names.join('.') : names[names.length - 1];
}

function withArticle(type)
{
    return (/^[AEIO]/.test(type) ? 'an ' : 'a ') + type;
}

function isFile(file)
{
    try
    {
        return fs.statSync(file).isFile();
    }
    catch
    {
        return false;
    }
}

class SurgeDiagnostics
{
    constructor(projects)
    {
        this.mProjects = projects;
        this.mCollection = vscode.languages.createDiagnosticCollection('surge');
        this.mFixes = new Map();    // uri -> Map(key -> { Title, Range, Text })
        this.mTimers = new Map();
    }

    static fixKey(range, message)
    {
        return `${range.start.line}:${range.start.character}:${message}`;
    }

    enabled()
    {
        return vscode.workspace.getConfiguration('surge.lua').get('diagnostics', true);
    }

    schedule(document, delay = 300)
    {
        const key = document.uri.toString();
        clearTimeout(this.mTimers.get(key));
        this.mTimers.set(key, setTimeout(() =>
        {
            this.mTimers.delete(key);
            this.update(document);
        }, delay));
    }

    refreshAll()
    {
        vscode.workspace.textDocuments.forEach(d => this.update(d));
    }

    clear(document)
    {
        this.mCollection.delete(document.uri);
        this.mFixes.delete(document.uri.toString());
    }

    update(document)
    {
        if(document.languageId !== 'lua' || document.isClosed)
            return;
        const project = this.mProjects.projectFor(document.uri);
        const text = document.getText();
        if(!project || !this.enabled() || text.startsWith('---@meta'))
        {
            this.clear(document);
            return;
        }

        const diagnostics = [];
        const fixes = new Map();
        const tokens = tokenize(text);
        const rangeOf = (start, end) => new vscode.Range(document.positionAt(start), document.positionAt(end));
        const report = (start, end, message, severity, fix) =>
        {
            const range = rangeOf(start, end);
            const diagnostic = new vscode.Diagnostic(range, message, severity);
            diagnostic.source = 'Surge';
            diagnostics.push(diagnostic);
            if(fix)
                fixes.set(SurgeDiagnostics.fixKey(range, message), { Title: fix.Title, Range: rangeOf(fix.Start, fix.End), Text: fix.Text });
        };

        const layers = new Set(project.Layers.map(l => l.Name));
        const scriptStems = new Set(project.scripts().map(s => AssetIndex.scriptStem(s.Path)));
        for(let i = 0; i < tokens.length; i++)
        {
            const t = tokens[i];
            if(t.Type === 'STRING')
            {
                if(!t.Closed)
                    continue;
                const info = analyzeString(tokens, i);
                if(info && info.Whole)
                    this.checkString(project, t, info, layers, scriptStems, report);
            }
            else if(t.Type === 'KEYWORD' && t.Value === 'function')
                this.checkCallbackName(tokens, i, report);
            else if(t.Type === 'NAME' && (t.Value === 'dofile' || t.Value === 'loadfile'))
            {
                const prev = tokens[i - 1];
                const member = prev && prev.Type === 'OP' && (prev.Value === '.' || prev.Value === ':');
                if(!member)
                    report(t.Start, t.End, `${t.Value} reads the file system, which exported games don't have (Android reads assets from the APK): use require() for scripts and Storage for save data.`, vscode.DiagnosticSeverity.Warning);
            }
        }

        this.mCollection.set(document.uri, diagnostics);
        this.mFixes.set(document.uri.toString(), fixes);
    }

    checkString(project, token, info, layers, scriptStems, report)
    {
        const value = token.Value;
        const start = token.ContentStart;
        const end = token.ContentEnd;
        const replace = (title, text) => ({ Title: title, Start: start, End: end, Text: text });
        const W = vscode.DiagnosticSeverity.Warning;

        switch(info.Role)
        {
            case ROLE.ASSET_OF_KIND:
            {
                if(value.length === 0)
                    return;
                const expected = info.AssetKind ? `${withArticle(info.AssetKind)} asset` : 'an asset';
                if(value.includes('\\'))
                {
                    const fixed = value.replace(/\\+/g, '/');
                    report(start, end, 'Asset paths use forward slashes.', W, replace(`Use '${fixed}'`, fixed));
                    return;
                }

                const asset = project.ByPath.get(value);
                if(asset)
                {
                    if(info.AssetKind && asset.Type !== info.AssetKind)
                        report(start, end, `'${value}' is ${withArticle(asset.Type)} asset, ${calleeName(info.Call)} expects ${expected}.`, W);
                    return;
                }

                const stripped = value.replace(/^\.?\/?Assets\//i, '');
                if(stripped !== value && project.ByPath.has(stripped))
                {
                    report(start, end, 'Asset paths are relative to the Assets folder.', W, replace(`Use '${stripped}'`, stripped));
                    return;
                }

                const caseMatch = project.ByLowerPath.get(value.toLowerCase());
                if(caseMatch)
                {
                    report(start, end, `Asset paths are case sensitive (the Android APK too): the asset is '${caseMatch.Path}'.`, W,
                           replace(`Use '${caseMatch.Path}'`, caseMatch.Path));
                    return;
                }

                if(!value.startsWith('Engine://') && isFile(path.join(project.AssetsPath, value)))
                {
                    report(start, end, `'${value}' is not in the asset registry yet: open the project in the Editor to import it.`, vscode.DiagnosticSeverity.Information);
                    return;
                }

                // Same file name elsewhere: probably moved
                const name = path.posix.basename(value).toLowerCase();
                const moved = project.Assets.filter(a => path.posix.basename(a.Path).toLowerCase() === name && (!info.AssetKind || a.Type === info.AssetKind));
                if(moved.length === 1)
                    report(start, end, `No asset '${value}' in this project, did you mean '${moved[0].Path}'?`, W, replace(`Use '${moved[0].Path}'`, moved[0].Path));
                else
                {
                    const extensions = info.AssetKind ? ` (${ASSET_EXTENSIONS[info.AssetKind].join(', ')})` : '';
                    report(start, end, `No asset '${value}' in this project, ${calleeName(info.Call)} expects ${expected}${extensions} relative to the Assets folder.`, W);
                }
                return;
            }
            case ROLE.MODULE:
            {
                const result = project.resolveModule(value);
                if(result.Error)
                    report(start, end, result.Error, W);
                return;
            }
            case ROLE.SCRIPT_NAME:
                if(!scriptStems.has(value))
                {
                    const stem = value.replace(/\.lua$/i, '').split(/[/.]/).pop();
                    const fix = stem !== value && scriptStems.has(stem) ? replace(`Use '${stem}'`, stem) : null;
                    report(start, end, `No script named '${value}' in this project: ${calleeName(info.Call)} takes the script's file name without extension.`, W, fix);
                }
                return;
            case ROLE.LAYER:
                if(layers.size > 0 && !layers.has(value))
                    report(start, end, `No physics layer named '${value}' (layers: ${[...layers].join(', ')}). GetLayer returns -1 for it.`, W);
                return;
            case ROLE.ASSET_KIND:
                if(!ASSET_TYPES.includes(value))
                    report(start, end, `Unknown asset kind '${value}', expected one of ${ASSET_TYPES.join(', ')}.`, W);
                return;
            case ROLE.ARRAY_ELEMENT:
                if(!ARRAY_ELEMENTS.includes(value))
                    report(start, end, `Unknown Property.Array element type '${value}'.`, W);
                return;
            case ROLE.OVERLAY_MODE:
                if(!OVERLAY_MODES.includes(value))
                    report(start, end, `Overlay mode is one of ${OVERLAY_MODES.join(', ')}.`, W);
                return;
        }
    }

    // A global 'function OnUpate(' that is a near miss of an engine callback
    checkCallbackName(tokens, index, report)
    {
        const name = tokens[index + 1];
        const open = tokens[index + 2];
        const prev = tokens[index - 1];
        if(!name || name.Type !== 'NAME' || !open || open.Type !== 'OP' || open.Value !== '(')
            return;
        if(prev && prev.Type === 'KEYWORD' && prev.Value === 'local')
            return;
        if(CALLBACKS.includes(name.Value) || !/^on/i.test(name.Value))
            return;
        const closest = closestCallback(name.Value);
        if(closest)
        {
            report(name.Start, name.End, `'${name.Value}' is not a Surge callback and never runs on its own, did you mean '${closest}'?`,
                   vscode.DiagnosticSeverity.Warning, { Title: `Rename to '${closest}'`, Start: name.Start, End: name.End, Text: closest });
        }
    }

    provideCodeActions(document, range, context)
    {
        const fixes = this.mFixes.get(document.uri.toString());
        if(!fixes)
            return [];
        const actions = [];
        for(const diagnostic of context.diagnostics)
        {
            const fix = fixes.get(SurgeDiagnostics.fixKey(diagnostic.range, diagnostic.message));
            if(!fix)
                continue;
            const action = new vscode.CodeAction(fix.Title, vscode.CodeActionKind.QuickFix);
            action.diagnostics = [diagnostic];
            action.isPreferred = true;
            action.edit = new vscode.WorkspaceEdit();
            action.edit.replace(document.uri, fix.Range, fix.Text);
            actions.push(action);
        }
        return actions;
    }

    dispose()
    {
        this.mTimers.forEach(t => clearTimeout(t));
        this.mCollection.dispose();
    }
}

module.exports = { SurgeDiagnostics, CALLBACKS };
