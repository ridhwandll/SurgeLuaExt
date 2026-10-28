# SurgeLuaExt

VS Code support for Surge Engine Lua scripts. It sits on top of the Lua language server
([sumneko.lua](https://marketplace.visualstudio.com/items?itemName=sumneko.lua), installed with it) and adds what only the
engine and the open project know.

## Requirements

- VS Code 1.85 or newer.
- The Lua extension by sumneko (`sumneko.lua`). VS Code installs it together with this one if you dont have it installed.
- The [Visual Assist Dark Theme](https://marketplace.visualstudio.com/items?itemName=septag.visual-assist-dark) is installed
  with it too (optional: it can be uninstalled on its own). Select it with *Preferences: Color Theme > Visual Assist Dark Theme* to get the
  [Visual Assist colors](#visual-assist-colors) for Lua.

## How To Install

Clone this repository and run `Build.bat --install`: it packs `surge-lua-<version>.vsix` in the repository root and installs it
into VS Code. Only VS Code is needed (no Node or npm). With the Surge engine repo next to this one (`../Surge_Expired`), the build
first syncs the latest `SurgeAPI.lua` from it.

To install a `.vsix` by hand: Command Palette (Ctrl+Shift+P) > **Extensions: Install from VSIX...** >pick the file.

## Features

### At a glance

| Area | What you get |
| --- | --- |
| Engine API | Completion, hover docs, signature help and type checks for the whole Surge Lua API |
| Sandbox | The standard library exactly as the engine opens it (no `io`, no `debug`, time-only `os`) |
| Project completion | Asset paths, modules, script, entity, widget and layer names inside string arguments |
| Project checks | Missing or mistyped assets, case mismatches, bad `require`s, unknown layers, misspelled callbacks, with quick fixes |
| Snippets | Script and module templates, every callback, every `Property.*` type, common patterns |
| Commands | New Script (3 templates), Configure Lua Language Server, Open Lua API Definitions, Refresh Asset Index |
| Live project index | Follows the Editor: the registry, scenes, UI layouts and project settings reload when they change |
| File types | `.srg`, `.sui`, `.spfx` and `.surgeproj` open as JSON |
| Visual Assist colors | Lua colored like Visual Assist colors C++, with the Visual Assist Dark Theme |

### Project detection

- A Surge project is any folder that holds `AssetRegistry.surge`, i.e. a project's Assets folder. The extension activates
  when the workspace contains one, and its project features apply to Lua files inside that folder.
- Both ways of opening a project work: the Assets folder itself (what the Editor's "Open in VS Code" does) or the project
  folder above it.
- Multi-root workspaces and several projects in one workspace are supported (up to 32). Nested projects resolve to the
  innermost one, so the engine repo's `Engine/Assets` keeps its own index. `node_modules`, `build`, `out` and `.git` are not searched.

### Engine API (via the Lua language server)

- Ships `SurgeAPI.lua`, the engine's API definitions: every global (`Scene`, `Physics`, `Input`, `Math`, `Time`, `Storage`,
  `Diagnostics`, `Particles`, `UI`, `Log`, `Property`...), every component (`entity.TransformC`, `MeshC`, `RigidbodyC`,
  `AnimatorC`...), every UI widget type, the math types (`Vec2/3/4`, `Quat`, `Mat4`) with their operators, and the key/mouse enums.
- The language server provides from it: member completion, hover documentation, signature help, go to definition,
  type checking and undefined-global warnings.
- Nothing is copied into your project. The definitions are installed into VS Code's global storage, at a path that does not
  change when the extension updates, so the workspace settings stay valid.
- **Surge: Open Lua API Definitions** opens the shipped file to browse the full API.

### Sandboxed standard library

The language server is set to Lua 5.4 and to the libraries `ScriptEngine::Initialize` opens: `base`, `math`, `string`,
`table`, `utf8`, `coroutine` and `package`.

- `io` and `debug` are reported as undefined globals.
- `os` only has `clock`, `date`, `difftime` and `time` (`Library/Sandbox.lua`). `os.execute`, `os.exit`, `os.getenv`,
  `os.remove`, `os.rename`, `os.tmpname` and `os.setlocale` are reported as unknown fields.
- `dofile` and `loadfile` get a warning: exported games read assets from the APK and have no file system. Use `require` for
  scripts and `Storage` for save data.

### Completion inside string arguments

Typing inside a string argument of a known call (triggered by `"`, `'`, `/` and `.`) lists what the project actually has.
Picking an entry replaces the whole string, so editing in the middle of an old path leaves nothing behind.

| Call | Argument | Offers |
| --- | --- | --- |
| `Scene.Load` | 1st | Scene assets (`.srg`) |
| `MeshC:SetMesh` | 1st | Mesh assets (`.glb`, `.gltf`), then the engine's built-in meshes (`Engine://...`) |
| `MeshC:SetMaterialOverride` | 2nd | Material assets (`.smat`) |
| `AudioSourceC:SetAudioClip` | 1st | Audio assets (`.wav`, `.mp3`, `.ogg`) |
| `ParticleSystemC:SetEffect`, `Particles.Play` | 1st | Particle effects (`.spfx`) |
| `ScriptC:AddScript`, `ScriptC:SetScript` | 1st | Script assets (`.lua`) |
| `UIImage:SetTexture`, `UIImage.new`, `UIImageButton.new` | 1st | Textures (`.png`, `.jpg`, `.jpeg`) |
| `UIButton.new` | 2nd / 3rd | Fonts (`.ttf`, `.otf`) / textures |
| `UIText.new`, `UIToggle.new` | 2nd | Fonts |
| `UITabView.new`, `UIInputField.new`, `UIDropdown.new` | 1st | Fonts |
| `Property.Asset` | 1st | Asset kinds (`MESH`, `TEXTURE2D`, `AUDIO`...) with their extensions |
| `Property.Asset` | 2nd | Assets of the kind given in the 1st argument (any asset when it is `nil`) |
| `Property.Array` | 1st | Element types (`Float`, `Int`, `Bool`, `String`, `Vec2/3/4`, `Color`, `Entity`, `Asset`, `Asset:<KIND>`) |
| `require` | 1st | Module names (`Scripts.Game.State`), the current file left out, with each module's path |
| `GetScript`, `HasScript`, `IsScriptActive`, `SetScriptActive` | 1st | Script names (file name without extension) |
| `Scene.FindEntity`, `FindEntityByName` | 1st | Entity names from every scene, with the scenes that contain them |
| `UICanvasC:FindWidget` | 1st | Widget names from every UI layout, with their type and layout (`BUTTON in UI/HUD.sui`) |
| `Physics.GetLayer`, `Physics.GetLayerMask` | any | Physics layer names from the `.surgeproj`, in layer order |
| `Diagnostics.SetOverlay` | 1st | `Off`, `Compact`, `Detailed` |

Asset completion lists exactly what is in `AssetRegistry.surge`, the same table `AssetManager::GetIDFromPath` resolves at
runtime, so a completed path is one the engine will find.

### Project checks and quick fixes

Checks run on string literals that make up a whole argument. Concatenations (`"Audio/" .. name .. ".wav"`), variables and
comments are skipped, so dynamic paths never produce false warnings. Files starting with `---@meta` (API definitions) are not
checked. Results update 300 ms after you stop typing and again whenever the project index changes.

| Check | Example | Quick fix |
| --- | --- | --- |
| Asset path differs only in case (works on Windows, fails in the APK) | `"meshes/Rock.glb"` | Use the registered spelling |
| Asset path relative to the project instead of the Assets folder | `"Assets/Meshes/Rock.glb"` | Strip `Assets/` |
| Backslashes in an asset path | `"Meshes\\Rock.glb"` | Use forward slashes |
| Asset moved: same file name exists elsewhere | `"Rock.glb"` → `Meshes/Props/Rock.glb` | Use the found path |
| Asset of the wrong type for the call | `SetMesh("Audio/Hit.wav")` | |
| Asset not in the project (lists the expected extensions) | `Scene.Load("Scenes/Nope.srg")` | |
| File exists but is not imported yet (information) | a new `.png` the Editor has not seen | |
| `require` target not found | `require("Scripts.Game.Stat")` | |
| `require` target ambiguous (lists the candidates) | `require("State")` with two `State.lua` | |
| Unknown script name | `GetScript("Healthh")` | Use the file name when a path was given |
| Unknown physics layer (only when the project defines layers) | `Physics.GetLayerMask("Grond")` | |
| Unknown `Property.Asset` kind | `Property.Asset("MESHH")` | |
| Unknown `Property.Array` element type | `Property.Array("Floats")` | |
| Unknown overlay mode | `Diagnostics.SetOverlay("Full")` | |
| Misspelled engine callback: a global function whose name is close to a callback never runs | `function OnUpate(entity, dt)` | Rename to the callback |
| `dofile` / `loadfile` | `dofile("Config.lua")` | |

- `require` resolution mirrors `ScriptEngine::ResolveModule`: dotted (`Scripts.Game.State`), slashed (`Scripts/Game/State`),
  with or without `.lua`, case-insensitive, and a unique file name alone (`State`) found anywhere in the project.
- The callback check knows `OnCreate`, `OnEnable`, `OnDisable`, `OnFixedUpdate`, `OnUpdate`, `OnLateUpdate`, `OnDestroy`,
  `OnCollisionEnter`, `OnCollisionExit`, `OnTriggerEnter` and `OnTriggerExit`. It flags names starting with `On` that are
  within two edits of a callback or differ from it only in case (`OnUpdated`, `onUpdate`), ignores `local` functions and leaves unrelated names such as `OnHit` alone.
- Entity and widget names are completed but not checked, since scripts can create both at runtime.
- An empty string is accepted where an asset is expected (`UIImage:SetTexture("")` clears the texture).

### Snippets

| Prefix | Inserts |
| --- | --- |
| `surge-script` | Entity script: `Properties`, `OnCreate` and `OnUpdate` |
| `surge-module` | Module table named after the file, returned at the end |
| `OnCreate`, `OnEnable`, `OnDisable`, `OnDestroy` | The callback with `---@param entity Entity` |
| `OnUpdate`, `OnLateUpdate`, `OnFixedUpdate` | The callback with typed `entity` and delta time parameters |
| `OnCollisionEnter`, `OnTriggerEnter` | The callback with typed `entity` and `other` |
| `OnCollisionExit`, `OnTriggerExit` | The same, with the `other:IsValid()` guard (`other` may already be destroyed) |
| `Properties` | An empty `Properties = { }` block |
| `prop-float`, `prop-int` | `Property.Float/Int(value, min, max, tooltip)` |
| `prop-bool`, `prop-string` | `Property.Bool/String(value, tooltip)` |
| `prop-vec3`, `prop-color` | `Property.Vec3(x, y, z, tooltip)`, `Property.Color(r, g, b, a, tooltip)` |
| `prop-entity` | `Property.Entity(tooltip)` |
| `prop-asset` | `Property.Asset(kind, nil, tooltip)` with a choice of asset kinds |
| `prop-enum` | `Property.Enum(value, { options }, tooltip)` |
| `prop-array` | `Property.Array(elementType, nil, tooltip)` with a choice of element types |
| `require` | `local Module = require("Scripts.Module")` |
| `raycast` | `Physics.Raycast` with the hit check |
| `touches` | Loop over every active touch (`Input.GetTouchCount` / `GetTouch`) |
| `findwidget` | `UICanvasC:FindWidget` with an `--[[@as UIButton]]` cast, choice of widget types |
| `onclick` | `widget:OnClick(function(self) ... end)` |
| `getstats` | `Diagnostics.GetStats` into a reused table, logged as FPS / CPU / GPU |

### Commands

All under `Surge:` in the Command Palette. Every command except Open Lua API Definitions is listed only when the workspace holds a
Surge project.

| Command | What it does |
| --- | --- |
| **New Script...** | Asks for a template and a name, creates the file and opens it. Templates: **Entity Script** (Properties + typed `OnCreate`/`OnUpdate`), **Module** (table + its `require` line) and **UI Canvas Script** (`FindWidget` + `OnClick`). Also in the Explorer's right-click menu on folders inside a project, creating the script in that folder; otherwise it goes to `Assets/Scripts`. Names must be valid Lua identifiers, existing files are never overwritten. |
| **Configure Lua Language Server for this Project** | Writes the language server settings now (see below), whatever `surge.lua.configureWorkspace` says. |
| **Open Lua API Definitions** | Opens the installed `SurgeAPI.lua`. |
| **Refresh Asset Index** | Searches the workspace for projects again and reloads every index. |

### Language server configuration

When a project opens (setting `surge.lua.configureWorkspace`), the extension writes to the workspace folder's
`.vscode/settings.json`:

| Setting | Value |
| --- | --- |
| `Lua.runtime.version` | `Lua 5.4` |
| `Lua.runtime.builtin` | `io`, `debug` and `os` disabled (the reduced `os` comes from `Sandbox.lua`), your other entries kept |
| `Lua.workspace.library` | The installed API folder added to your existing entries |
| `Lua.runtime.path` | `?.lua`, `?/init.lua`, plus `Assets/?.lua` and `Assets/?/init.lua` when the workspace is the project folder, so `require("Scripts.X")` resolves for go to definition |

Settings are merged with what is already there and only written when something differs, so reopening a project does not touch
the file. `.vscode` folders are hidden from the Editor's Content Browser.

Projects made before the extension may carry their own `Scripts/Intellisense/SurgeAPI.lua`. Two definitions of every class
confuse completion, and an outdated copy hides newer API. The extension offers **Ignore Copy** (adds it to
`Lua.workspace.ignoreDir`) or **Keep Using It** (not asked again for that project). Delete the copy once every machine uses the
extension.

### Live project index

- Reads `AssetRegistry.surge` (every asset path and type), every scene (`.srg`, entity names), every UI layout (`.sui`, widget
  names and types) and the project's `.surgeproj` (physics layer names).
- Watches those files and reloads 400 ms after the last change, since the Editor rewrites the registry in bursts. Saving in the
  Editor updates completion and checks without reloading VS Code.
- Scenes and layouts are only parsed again when their modification time changed. A file being written, or one that is not
  JSON, is skipped until its next change.

### File types

`.srg` (scenes), `.sui` (UI layouts), `.spfx` (particle effects) and `.surgeproj` (project) open with JSON highlighting,
folding and formatting.

### Visual Assist colors

The [Visual Assist Dark Theme](https://marketplace.visualstudio.com/items?itemName=septag.visual-assist-dark) colors C++ like
Visual Assist does in Visual Studio, but it only knows a few Lua scopes: fields show in plain white and engine globals like
`Scene` look like any variable. With that theme active, the extension recolors Lua from the language server's semantic tokens
in the same palette:

| Color | Lua |
| --- | --- |
| Gold `#FFD700` | Engine and standard library globals (`Scene`, `Math`, `Key`, `Property`, `math`, `string`...), classes and annotation types (`---@param entity Entity`) |
| Orange `#FF8000` | Functions and methods: calls, definitions, engine functions (`Scene.Load`, `entity.MeshC:SetMesh`, `print`) |
| Khaki `#BDB76B` | Variables: locals, parameters, your own globals and fields (`entity.TransformC.Position`) |
| Blue `#569CD6` | `self` (like `this`) |
| Green `#B8D7A3` | `<const>` locals |
| Gray `#808080` | Annotation tags (`@param`, `@return`) |
| Strikethrough | `---@deprecated` API |

Keywords, strings, numbers, comments and operators keep the theme's own colors. Only Lua is affected (every rule ends in
`:lua`), and only while the Visual Assist Dark Theme is the active theme. Your own `editor.semanticTokenColorCustomizations` win
over these defaults, so any color can be changed there:

```json
"editor.semanticTokenColorCustomizations": {
    "[Visual Assist Dark Theme]": { "rules": { "property:lua": "#DCDCDC" } }
}
```

## Settings

| Setting | Default | |
| --- | --- | --- |
| `surge.lua.configureWorkspace` | `always` | Writes the language server settings (`Lua.workspace.library`, `Lua.runtime.version`, `Lua.runtime.builtin`, `Lua.runtime.path`) into the workspace's `.vscode/settings.json` when a project opens. `ask` asks once per workspace, `never` leaves it to the command. |
| `surge.lua.diagnostics` | `true` | The project checks above. Turning it off clears them right away. |

## Build and install

`Build.bat --install` (or `node Scripts/Build.js --install`): copies the engine's `SurgeAPI.lua` and logo into the
extension, packs `surge-lua-<version>.vsix` (no npm packages needed, falls back to VS Code's own Node runtime) and installs it.
Without `--install`, install the `.vsix` with *Extensions: Install from VSIX...*.

The engine repo is found through `--engine <path>`, else the `SURGE_ENGINE_DIR` environment variable, else `../Surge_Expired`
next to this repo. Without one, the build packs the `Library/SurgeAPI.lua` committed here, so commit it after a sync.

Development: open this folder in VS Code and press F5 (Extension Development Host). It uses `Library/SurgeAPI.lua` as it is,
run the build once to sync it with the engine.

When the engine's Lua API changes, update its `SurgeAPI.lua` as usual, then rebuild here and commit the synced copy. A new
binding that takes an asset path, script, entity, widget or layer name also needs a line in the `RULES` table of `Source/LuaCalls.js`.

## License

[MIT](LICENSE.txt) © 2026 RidT

## AI SLOP NOTE

This is a AI slop generated by Claude with no human checks on the .js code, I (Rid) do not know sh*t about how JavaScript works(and do not want to know it either). This makes the scripting experience in the Lua of SurgeEngine a lot nicer, so I will allow this Slop(#SlopForGood).
