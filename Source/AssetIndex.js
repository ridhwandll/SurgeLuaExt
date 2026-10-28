// Copyright (c) RidT. Licensed under the MIT License, see LICENSE.txt
'use strict';

const vscode = require('vscode');
const path = require('path');

const REGISTRY_FILE = 'AssetRegistry.surge';
const decoder = new TextDecoder('utf-8');

async function readText(uri)
{
    return decoder.decode(await vscode.workspace.fs.readFile(uri));
}

async function modifiedTime(uri)
{
    try
    {
        return (await vscode.workspace.fs.stat(uri)).mtime;
    }
    catch
    {
        return -1;
    }
}

function scriptStem(relativePath)
{
    return path.posix.basename(relativePath, path.posix.extname(relativePath));
}

// Entity names of a scene source (.srg JSON: Scene.<Entity>."Surge::NameComponent".Name)
function collectEntityNames(json)
{
    const names = [];
    const scene = json && json.Scene;
    if(scene && typeof scene === 'object')
    {
        for(const entity of Object.values(scene))
        {
            const name = entity && entity['Surge::NameComponent'] && entity['Surge::NameComponent'].Name;
            if(typeof name === 'string' && name.length > 0)
                names.push(name);
        }
    }
    return names;
}

// Widget names + types of a UI layout source (.sui JSON: Root.Children...)
function collectWidgets(json)
{
    const widgets = [];
    const visit = (widget) =>
    {
        if(!widget || typeof widget !== 'object')
            return;
        if(typeof widget.Name === 'string' && widget.Name.length > 0)
            widgets.push({ Name: widget.Name, Type: widget.Type || '' });
        if(Array.isArray(widget.Children))
            widget.Children.forEach(visit);
    };
    visit(json && json.Root);
    return widgets;
}

// One Surge project's Assets folder: the registry (exactly what AssetManager::GetIDFromPath resolves),
// script modules, scene entity names, UI widget names and the project's physics layers.
class AssetIndex
{
    constructor(assetsUri)
    {
        this.AssetsUri = assetsUri;
        this.Assets = [];                // { Path, Type }, Engine:// built-ins included
        this.ByPath = new Map();         // exact path -> asset
        this.ByLowerPath = new Map();    // lower case path -> asset
        this.ModuleByLowerPath = new Map();
        this.EntityNames = new Map();    // name -> scene paths
        this.Widgets = new Map();        // name -> [{ Type, Layout }]
        this.Layers = [];
        this.ProjectUri = null;
        this.mSourceCache = new Map();   // path -> { Time, Data }
    }

    get AssetsPath()
    {
        return this.AssetsUri.fsPath;
    }

    contains(uri)
    {
        const relative = path.relative(this.AssetsUri.fsPath, uri.fsPath);
        return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
    }

    relativePath(uri)
    {
        return path.relative(this.AssetsUri.fsPath, uri.fsPath).split(path.sep).join('/');
    }

    async reload()
    {
        await this.loadRegistry();
        await Promise.all([this.loadSources(), this.loadProject()]);
    }

    async loadRegistry()
    {
        let text = '';
        try
        {
            text = await readText(vscode.Uri.joinPath(this.AssetsUri, REGISTRY_FILE));
        }
        catch
        {
            return;
        }

        this.Assets = [];
        this.ByPath.clear();
        this.ByLowerPath.clear();
        this.ModuleByLowerPath.clear();
        for(const rawLine of text.split(/\r?\n/))
        {
            const line = rawLine.trim();
            if(line.length === 0 || line.startsWith('//'))
                continue;
            // UUID|Type|RelativePath
            const first = line.indexOf('|');
            const second = line.indexOf('|', first + 1);
            if(first < 0 || second < 0)
                continue;
            const asset = { Type: line.slice(first + 1, second), Path: line.slice(second + 1) };
            this.Assets.push(asset);
            this.ByPath.set(asset.Path, asset);
            this.ByLowerPath.set(asset.Path.toLowerCase(), asset);
            if(asset.Type === 'SCRIPT')
                this.ModuleByLowerPath.set(asset.Path.toLowerCase(), asset);
        }
        this.Assets.sort((a, b) => a.Path.localeCompare(b.Path));
    }

    // Scene entity names and layout widget names, re-parsed only when a file changed
    async loadSources()
    {
        const sources = this.Assets.filter(a => (a.Type === 'SCENE' || a.Type === 'UI_LAYOUT') && !a.Path.startsWith('Engine://'));
        const results = await Promise.all(sources.map(async (asset) =>
        {
            const uri = vscode.Uri.joinPath(this.AssetsUri, asset.Path);
            const time = await modifiedTime(uri);
            const cached = this.mSourceCache.get(asset.Path);
            if(cached && cached.Time === time)
                return [asset, cached.Data];

            let data = [];
            if(time >= 0)
            {
                try
                {
                    const json = JSON.parse(await readText(uri));
                    data = asset.Type === 'SCENE' ? collectEntityNames(json) : collectWidgets(json);
                }
                catch
                {
                    // Being written by the Editor or not JSON: keep it empty until the next change
                }
            }
            this.mSourceCache.set(asset.Path, { Time: time, Data: data });
            return [asset, data];
        }));

        this.EntityNames.clear();
        this.Widgets.clear();
        for(const [asset, data] of results)
        {
            if(asset.Type === 'SCENE')
            {
                for(const name of data)
                {
                    const scenes = this.EntityNames.get(name) || [];
                    if(!scenes.includes(asset.Path))
                        scenes.push(asset.Path);
                    this.EntityNames.set(name, scenes);
                }
            }
            else
            {
                for(const widget of data)
                {
                    const entries = this.Widgets.get(widget.Name) || [];
                    entries.push({ Type: widget.Type, Layout: asset.Path });
                    this.Widgets.set(widget.Name, entries);
                }
            }
        }
    }

    // <ProjectDir>/<Name>.surgeproj next to the Assets folder: physics layer names
    async loadProject()
    {
        this.Layers = [];
        this.ProjectUri = null;
        const projectDir = vscode.Uri.file(path.dirname(this.AssetsUri.fsPath));
        let entries = [];
        try
        {
            entries = await vscode.workspace.fs.readDirectory(projectDir);
        }
        catch
        {
            return;
        }

        const project = entries.find(([name, type]) => type === vscode.FileType.File && name.toLowerCase().endsWith('.surgeproj'));
        if(!project)
            return;
        this.ProjectUri = vscode.Uri.joinPath(projectDir, project[0]);
        try
        {
            const json = JSON.parse(await readText(this.ProjectUri));
            const layers = json && json.Project && json.Project.Physics && json.Project.Physics.Layers;
            if(Array.isArray(layers))
                this.Layers = layers.map((name, index) => ({ Name: name, Index: index })).filter(l => typeof l.Name === 'string' && l.Name.length > 0);
        }
        catch
        {
            // Older binary or partially written project file: no layer names
        }
    }

    // require() resolution, same rules as ScriptEngine::ResolveModule. Returns { Asset } or { Error }
    resolveModule(name)
    {
        let key = name.replace(/\\/g, '/');
        if(key.length > 4 && key.slice(-4).toLowerCase() === '.lua')
            key = key.slice(0, -4);
        if(!key.includes('/'))
            key = key.replace(/\./g, '/');
        const wanted = (key + '.lua').toLowerCase();

        const exact = this.ModuleByLowerPath.get(wanted);
        if(exact)
            return { Asset: exact };

        const suffix = '/' + wanted;
        const candidates = [];
        for(const [lowerPath, asset] of this.ModuleByLowerPath)
        {
            if(lowerPath.length > suffix.length && lowerPath.endsWith(suffix))
                candidates.push(asset);
        }
        if(candidates.length === 1)
            return { Asset: candidates[0] };
        if(candidates.length === 0)
            return { Error: `No script asset '${key}.lua' in the project (paths are relative to the Assets folder)` };
        return { Error: `'${name}' is ambiguous, use the full path: ${candidates.map(c => c.Path).join(', ')}`, Ambiguous: true };
    }

    scripts()
    {
        return this.Assets.filter(a => a.Type === 'SCRIPT' && !a.Path.startsWith('Engine://'));
    }

    static moduleName(scriptPath)
    {
        return scriptPath.replace(/\.lua$/i, '').split('/').join('.');
    }

    static scriptStem(scriptPath)
    {
        return scriptStem(scriptPath);
    }
}

// Every Surge project in the workspace (a folder holding AssetRegistry.surge), with file watchers
class ProjectIndex
{
    constructor()
    {
        this.Projects = [];
        this.mOnDidChange = new vscode.EventEmitter();
        this.onDidChange = this.mOnDidChange.event;
        this.mWatchers = [];
        this.mPending = new Map();
    }

    async scan()
    {
        this.disposeWatchers();
        const registries = await vscode.workspace.findFiles('**/' + REGISTRY_FILE, '**/{node_modules,build,out,.git}/**', 32);
        this.Projects = registries.map(uri => new AssetIndex(vscode.Uri.file(path.dirname(uri.fsPath))));
        // Deepest first, so a project nested in another (the engine repo's Engine/Assets) wins for its own files
        this.Projects.sort((a, b) => b.AssetsPath.length - a.AssetsPath.length);
        await Promise.all(this.Projects.map(p => p.reload()));

        for(const project of this.Projects)
        {
            const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(project.AssetsUri, '{' + REGISTRY_FILE + ',**/*.srg,**/*.sui}'));
            const schedule = () => this.scheduleReload(project);
            watcher.onDidChange(schedule);
            watcher.onDidCreate(schedule);
            watcher.onDidDelete(schedule);
            this.mWatchers.push(watcher);

            if(project.ProjectUri)
            {
                const projectWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(project.ProjectUri.fsPath)), '*.surgeproj'));
                projectWatcher.onDidChange(schedule);
                this.mWatchers.push(projectWatcher);
            }
        }

        await vscode.commands.executeCommand('setContext', 'surge.isProject', this.Projects.length > 0);
        this.mOnDidChange.fire();
    }

    // The Editor rewrites the registry after every change: wait for the burst to end
    scheduleReload(project)
    {
        clearTimeout(this.mPending.get(project));
        this.mPending.set(project, setTimeout(async () =>
        {
            this.mPending.delete(project);
            await project.reload();
            this.mOnDidChange.fire();
        }, 400));
    }

    projectFor(uri)
    {
        return this.Projects.find(p => p.contains(uri)) || null;
    }

    disposeWatchers()
    {
        this.mWatchers.forEach(w => w.dispose());
        this.mWatchers = [];
    }

    dispose()
    {
        this.disposeWatchers();
        this.mPending.forEach(t => clearTimeout(t));
        this.mOnDidChange.dispose();
    }
}

module.exports = { AssetIndex, ProjectIndex };
