import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodeResolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootPkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')
);

const externals = new Set([
...Object.keys(rootPkg.dependencies || {}),
...Object.keys(rootPkg.peerDependencies || {}),
]);

const librariesRoot = path.join(__dirname, 'libraries');

const libraryDirs = fs
    .readdirSync(librariesRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(librariesRoot, d.name));

const configs = libraryDirs
    .map((dir) => {
        const input = path.join(dir, 'index.js');
        if (!fs.existsSync(input)) return null;
        return {
            input,
            output: [
                {
                    file: path.join(dir, 'build', 'index.js'),
                    format: 'es',
                },
            ],
            // external: (id) => {
            //     if (id.startsWith('.') || path.isAbsolute(id)) return false;
            //     const pkg = id.split('/')[0];
            //     return externals.has(pkg);
            // },
            plugins: [
                nodeResolve({
                    browser: true,
                    extensions: ['.mjs', '.js', '.json'],
                }),
                commonjs(),
            ],
        };
    }).filter(Boolean);

    if (configs.length === 0) {
    console.warn('No libraries with index.js found in /libraries');
}

export default configs;