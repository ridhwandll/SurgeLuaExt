// Copyright (c) RidT. Licensed under the MIT License, see LICENSE.txt
'use strict';

// Copies the engine's SurgeAPI.lua and logo into the extension and packs surge-lua-<version>.vsix.
// Needs nothing but Node (no npm packages, no vsce): node Scripts/Build.js [--engine <Surge repo>] [--install]
// The engine repo is --engine, else the SURGE_ENGINE_DIR environment variable, else ../Surge_Expired next to this repo.
// Without one, the copies committed here are packed as they are. --install also runs 'code --install-extension'.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ENGINE_API = path.join('Engine', 'Source', 'Surge', 'ScriptEngine', 'Intellisense', 'SurgeAPI.lua');
const SYNCED = [
    [ENGINE_API, path.join('Library', 'SurgeAPI.lua')],
    [path.join('Docs', 'Images', 'SurgeLogo-DarkMode.png'), 'Icon.png']
];
const PACKAGED = ['package.json', 'Extension.js', 'README.md', 'LICENSE.txt', 'Icon.png', 'Source', 'Library', 'Snippets'];

const CRC_TABLE = (() =>
{
    const table = new Uint32Array(256);
    for(let n = 0; n < 256; n++)
    {
        let c = n;
        for(let k = 0; k < 8; k++)
            c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(buffer)
{
    let crc = 0xFFFFFFFF;
    for(const byte of buffer)
        crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Minimal zip writer (deflate, UTF-8 names), enough for a .vsix
function writeZip(entries, outputPath)
{
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const chunks = [];
    const central = [];
    let offset = 0;

    for(const { Name, Data } of entries)
    {
        const name = Buffer.from(Name, 'utf8');
        const compressed = zlib.deflateRawSync(Data, { level: 9 });
        const crc = crc32(Data);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034B50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x0800, 6);
        local.writeUInt16LE(8, 8);
        local.writeUInt16LE(dosTime, 10);
        local.writeUInt16LE(dosDate, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(compressed.length, 18);
        local.writeUInt32LE(Data.length, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(0, 28);
        chunks.push(local, name, compressed);

        const header = Buffer.alloc(46);
        header.writeUInt32LE(0x02014B50, 0);
        header.writeUInt16LE(20, 4);
        header.writeUInt16LE(20, 6);
        header.writeUInt16LE(0x0800, 8);
        header.writeUInt16LE(8, 10);
        header.writeUInt16LE(dosTime, 12);
        header.writeUInt16LE(dosDate, 14);
        header.writeUInt32LE(crc, 16);
        header.writeUInt32LE(compressed.length, 20);
        header.writeUInt32LE(Data.length, 24);
        header.writeUInt16LE(name.length, 28);
        header.writeUInt32LE(offset, 42);
        central.push(header, name);

        offset += local.length + name.length + compressed.length;
    }

    const centralSize = central.reduce((size, b) => size + b.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054B50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(offset, 16);
    fs.writeFileSync(outputPath, Buffer.concat([...chunks, ...central, end]));
}

function collect(relative, out)
{
    const absolute = path.join(ROOT, relative);
    if(fs.statSync(absolute).isDirectory())
    {
        for(const child of fs.readdirSync(absolute).sort())
            collect(path.join(relative, child), out);
    }
    else
        out.push(relative.split(path.sep).join('/'));
}

function escapeXml(text)
{
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function manifest(pkg)
{
    return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${pkg.name}" Version="${pkg.version}" Publisher="${pkg.publisher}" />
    <DisplayName>${escapeXml(pkg.displayName)}</DisplayName>
    <Description xml:space="preserve">${escapeXml(pkg.description)}</Description>
    <Tags>${escapeXml(pkg.keywords.join(','))}</Tags>
    <Categories>${escapeXml(pkg.categories.join(','))}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${escapeXml(pkg.engines.vscode)}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="${escapeXml(pkg.extensionDependencies.join(','))}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="${escapeXml((pkg.extensionPack || []).join(','))}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="${escapeXml(pkg.extensionKind.join(','))}" />
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value="" />
    </Properties>
    <License>extension/LICENSE.txt</License>
    <Icon>extension/Icon.png</Icon>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.txt" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/Icon.png" Addressable="true" />
  </Assets>
</PackageManifest>
`;
}

function contentTypes(files)
{
    const types = { '.json': 'application/json', '.js': 'application/javascript', '.md': 'text/markdown', '.lua': 'text/plain',
                    '.txt': 'text/plain', '.png': 'image/png', '.vsixmanifest': 'text/xml', '.code-snippets': 'application/json' };
    const used = new Set(['.vsixmanifest', ...files.map(f => path.extname(f).toLowerCase())]);
    const defaults = [...used].filter(e => types[e]).map(e => `  <Default Extension="${e}" ContentType="${types[e]}" />`).join('\n');
    return `<?xml version="1.0" encoding="utf-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n${defaults}\n</Types>\n`;
}

function findEngine()
{
    const flag = process.argv.indexOf('--engine');
    const explicit = flag >= 0 ? process.argv[flag + 1] : process.env.SURGE_ENGINE_DIR;
    const engine = path.resolve(explicit || path.join(ROOT, '..', 'Surge_Expired'));
    if(fs.existsSync(path.join(engine, ENGINE_API)))
        return engine;
    if(explicit)
    {
        console.error(`[Surge] ${engine} is not a Surge engine repo (no ${ENGINE_API})`);
        process.exit(1);
    }
    return null;
}

function main()
{
    const engine = findEngine();
    if(engine)
    {
        for(const [source, destination] of SYNCED)
            fs.copyFileSync(path.join(engine, source), path.join(ROOT, destination));
        console.log(`[Surge] Synced SurgeAPI.lua and icon from ${engine}`);
    }
    else
        console.warn('[Surge] Engine repo not found (--engine / SURGE_ENGINE_DIR): packing the committed SurgeAPI.lua');

    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const files = [];
    PACKAGED.forEach(entry => collect(entry, files));

    const entries = [
        { Name: '[Content_Types].xml', Data: Buffer.from(contentTypes(files), 'utf8') },
        { Name: 'extension.vsixmanifest', Data: Buffer.from(manifest(pkg), 'utf8') },
        ...files.map(file => ({ Name: 'extension/' + file, Data: fs.readFileSync(path.join(ROOT, file)) }))
    ];
    const output = path.join(ROOT, `${pkg.name}-${pkg.version}.vsix`);
    writeZip(entries, output);
    console.log(`[Surge] Packed ${files.length} files into ${output}`);

    if(process.argv.includes('--install'))
    {
        // code.cmd is a batch file: Windows only runs it through the shell
        execSync(`code --install-extension "${output}" --force`, { stdio: 'inherit' });
        console.log('[Surge] Installed, reload VS Code windows to pick it up.');
    }
}

main();
