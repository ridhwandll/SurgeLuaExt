// Copyright (c) RidT. Licensed under the MIT License, see LICENSE.txt
'use strict';

// Calls whose string arguments name something of the project. Keep in sync with SurgeAPI.lua.
// Tail: the callee's last names must match (Scene.Load), Method: only its last name (entity.MeshC:SetMesh).
// Args maps an argument index ('*' = any) to a role: an AssetType, or one of the roles below.
const ROLE = Object.freeze({
    ASSET_OF_KIND: 'ASSET_OF_KIND', // Property.Asset's path: the kind is the first argument
    ASSET_KIND: 'ASSET_KIND',
    ARRAY_ELEMENT: 'ARRAY_ELEMENT',
    MODULE: 'MODULE',
    SCRIPT_NAME: 'SCRIPT_NAME',
    ENTITY_NAME: 'ENTITY_NAME',
    WIDGET_NAME: 'WIDGET_NAME',
    LAYER: 'LAYER',
    OVERLAY_MODE: 'OVERLAY_MODE'
});

// Source extensions per AssetType (Editor/Source/Asset/AssetExtensions.hpp)
const ASSET_EXTENSIONS = Object.freeze({
    TEXTURE2D: ['.png', '.jpg', '.jpeg'],
    MESH: ['.glb', '.gltf'],
    MATERIAL: ['.smat'],
    SCENE: ['.srg'],
    SCRIPT: ['.lua'],
    FONT: ['.ttf', '.otf'],
    AUDIO: ['.wav', '.mp3', '.ogg'],
    UI_LAYOUT: ['.sui'],
    PARTICLE_EFFECT: ['.spfx']
});
const ASSET_TYPES = Object.keys(ASSET_EXTENSIONS);

const ARRAY_ELEMENTS = ['Float', 'Int', 'Bool', 'String', 'Vec2', 'Vec3', 'Vec4', 'Color', 'Entity', 'Asset',
                        ...ASSET_TYPES.map(t => 'Asset:' + t)];
const OVERLAY_MODES = ['Off', 'Compact', 'Detailed'];

const RULES = [
    { Tail: ['Scene', 'Load'], Args: { 0: 'SCENE' } },
    { Method: 'SetMesh', Args: { 0: 'MESH' } },
    { Method: 'SetMaterialOverride', Args: { 1: 'MATERIAL' } },
    { Method: 'AddScript', Args: { 0: 'SCRIPT' } },
    { Method: 'SetScript', Args: { 0: 'SCRIPT' } },
    { Method: 'SetAudioClip', Args: { 0: 'AUDIO' } },
    { Method: 'SetEffect', Args: { 0: 'PARTICLE_EFFECT' } },
    { Tail: ['Particles', 'Play'], Args: { 0: 'PARTICLE_EFFECT' } },
    { Method: 'SetTexture', Args: { 0: 'TEXTURE2D' } },
    { Tail: ['UIImage', 'new'], Args: { 0: 'TEXTURE2D' } },
    { Tail: ['UIImageButton', 'new'], Args: { 0: 'TEXTURE2D' } },
    { Tail: ['UIButton', 'new'], Args: { 1: 'FONT', 2: 'TEXTURE2D' } },
    { Tail: ['UIText', 'new'], Args: { 1: 'FONT' } },
    { Tail: ['UIToggle', 'new'], Args: { 1: 'FONT' } },
    { Tail: ['UITabView', 'new'], Args: { 0: 'FONT' } },
    { Tail: ['UIInputField', 'new'], Args: { 0: 'FONT' } },
    { Tail: ['UIDropdown', 'new'], Args: { 0: 'FONT' } },
    { Tail: ['Property', 'Asset'], Args: { 0: ROLE.ASSET_KIND, 1: ROLE.ASSET_OF_KIND } },
    { Tail: ['Property', 'Array'], Args: { 0: ROLE.ARRAY_ELEMENT } },
    { Tail: ['require'], Args: { 0: ROLE.MODULE } },
    { Method: 'HasScript', Args: { 0: ROLE.SCRIPT_NAME } },
    { Method: 'IsScriptActive', Args: { 0: ROLE.SCRIPT_NAME } },
    { Method: 'SetScriptActive', Args: { 0: ROLE.SCRIPT_NAME } },
    { Method: 'GetScript', Args: { 0: ROLE.SCRIPT_NAME } },
    { Tail: ['Scene', 'FindEntity'], Args: { 0: ROLE.ENTITY_NAME } },
    { Method: 'FindEntityByName', Args: { 0: ROLE.ENTITY_NAME } },
    { Method: 'FindWidget', Args: { 0: ROLE.WIDGET_NAME } },
    { Tail: ['Physics', 'GetLayer'], Args: { 0: ROLE.LAYER } },
    { Tail: ['Physics', 'GetLayerMask'], Args: { '*': ROLE.LAYER } },
    { Tail: ['Diagnostics', 'SetOverlay'], Args: { 0: ROLE.OVERLAY_MODE } }
];

// Keywords that start or end a statement: walking back over one means the string is not inside a call
const STOP_KEYWORDS = new Set(['local', 'return', 'then', 'do', 'else', 'elseif', 'end', 'until', 'repeat', 'break', 'goto', 'function']);

// Callee names ending at token index i: ['entity', 'MeshC', 'SetMesh'], null when it is not a name chain
function readCallee(tokens, i)
{
    if(i < 0 || tokens[i].Type !== 'NAME')
        return null;
    const names = [tokens[i].Value];
    while(i >= 2 && tokens[i - 1].Type === 'OP' && (tokens[i - 1].Value === '.' || tokens[i - 1].Value === ':') && tokens[i - 2].Type === 'NAME')
    {
        names.unshift(tokens[i - 2].Value);
        i -= 2;
    }
    // A method of a call result (GetEntity():GetScript("x")): the receiver is unnamed
    if(i >= 1 && tokens[i - 1].Type === 'OP' && (tokens[i - 1].Value === '.' || tokens[i - 1].Value === ':'))
        names.unshift('?');
    return names;
}

// The call a string token is a direct argument of: { Callee, ArgIndex, OpenIndex } (OpenIndex = its '(', -1 for f"x"), or null
function findCall(tokens, index)
{
    const prev = tokens[index - 1];
    if(!prev)
        return null;
    if(prev.Type === 'NAME')
    {
        const callee = readCallee(tokens, index - 1);
        return callee ? { Callee: callee, ArgIndex: 0, OpenIndex: -1 } : null;
    }
    if(prev.Type !== 'OP' || (prev.Value !== '(' && prev.Value !== ','))
        return null;

    let argIndex = 0;
    let depth = 0;
    for(let i = index - 1; i >= 0 && i >= index - 512; i--)
    {
        const t = tokens[i];
        if(t.Type === 'KEYWORD')
        {
            if(depth === 0 && STOP_KEYWORDS.has(t.Value))
                return null;
            continue;
        }
        if(t.Type !== 'OP')
            continue;

        const v = t.Value;
        if(v === ')' || v === ']' || v === '}')
            depth++;
        else if(v === '(' || v === '[' || v === '{')
        {
            if(depth > 0)
            {
                depth--;
                continue;
            }
            if(v !== '(')
                return null; // Table constructor or index
            const callee = readCallee(tokens, i - 1);
            return callee ? { Callee: callee, ArgIndex: argIndex, OpenIndex: i } : null;
        }
        else if(depth === 0 && v === ',')
            argIndex++;
        else if(depth === 0 && v === '=')
            return null;
    }
    return null;
}

function matchRole(callee, argIndex)
{
    for(const rule of RULES)
    {
        if(rule.Method)
        {
            if(callee.length < 2 || callee[callee.length - 1] !== rule.Method)
                continue;
        }
        else
        {
            if(callee.length < rule.Tail.length)
                continue;
            const offset = callee.length - rule.Tail.length;
            if(!rule.Tail.every((name, k) => callee[offset + k] === name))
                continue;
        }
        return rule.Args[argIndex] || rule.Args['*'] || null;
    }
    return null;
}

// Role of the string token at index plus its call, or null. Whole: the string is the entire argument (no concatenation)
function analyzeString(tokens, index)
{
    const call = findCall(tokens, index);
    if(!call)
        return null;
    let role = matchRole(call.Callee, call.ArgIndex);
    if(!role)
        return null;

    let kind = null;
    if(role === ROLE.ASSET_OF_KIND)
    {
        // Property.Asset("MESH", "path"): nil or an unknown kind accepts any asset
        const first = tokens[call.OpenIndex + 1];
        kind = first && first.Type === 'STRING' && ASSET_EXTENSIONS[first.Value] ? first.Value : null;
    }
    else if(ASSET_EXTENSIONS[role])
    {
        kind = role;
        role = ROLE.ASSET_OF_KIND;
    }

    const next = tokens[index + 1];
    const whole = !next || (next.Type === 'OP' && (next.Value === ')' || next.Value === ',')) || call.OpenIndex < 0;
    return { Role: role, AssetKind: kind, Call: call, Whole: whole };
}

module.exports = { ROLE, ASSET_EXTENSIONS, ASSET_TYPES, ARRAY_ELEMENTS, OVERLAY_MODES, analyzeString, readCallee };
