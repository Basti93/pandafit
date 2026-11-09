import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const png = (f: string) => { const b = readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
const art = (f: string, id: string) => readFileSync(f, 'utf8').match(new RegExp(`<!-- ${id} -->[\\s\\S]*?<!-- /${id} -->`))?.[0];

describe('logo', () => {
  it('links only icons that exist, in the sizes they claim', () => {
    const html = readFileSync('src/web/index.html', 'utf8');
    for (const [, href] of html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)) expect(existsSync(`src/web/public${href}`), href).toBe(true);
    const manifest = JSON.parse(readFileSync('src/web/public/manifest.webmanifest', 'utf8'));
    for (const i of manifest.icons) expect(png(`src/web/public${i.src}`), i.src).toEqual(i.sizes.split('x').map(Number));
    expect(png('src/web/public/icons/apple-touch-icon.png')).toEqual([180, 180]);
    expect(png('src/web/public/icons/favicon-32.png')).toEqual([32, 32]);
    expect(png('resources/icon.png')).toEqual([1024, 1024]);
  });
  it('draws the same Bo in the Mac icon and the web icon, and the old logo is gone', () => {
    expect(art('resources/icon.svg', 'bo-logo')).toBeTruthy();
    expect(art('resources/icon.svg', 'bo-logo')).toBe(art('src/web/public/icons/icon.svg', 'bo-logo'));
    expect(existsSync('src/web/public/icons/panda.svg')).toBe(false);
  });
});
