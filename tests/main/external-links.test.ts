import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { linkedWebOrigins, opensExternally } from '../../src/main/external-links';

describe('opensExternally', () => {
  it('opens Hevy, wger and a YouTube search in the browser', () => {
    expect(opensExternally('https://hevy.com/settings?developer')).toBe(true);
    expect(opensExternally('https://wger.de/en/exercise/73/view/')).toBe(true);
    expect(opensExternally('https://www.youtube.com/results?search_query=Squat%20exercise%20form')).toBe(true);
  });
  it('opens nothing else', () => {
    expect(opensExternally('https://www.youtube.com/watch?v=x')).toBe(false);
    expect(opensExternally('http://wger.de/')).toBe(false);
    expect(opensExternally('https://wger.de.evil.example/')).toBe(false);
    expect(opensExternally('https://evil.example/https://hevy.com/')).toBe(false);
    expect(opensExternally('file:///etc/passwd')).toBe(false);
    expect(opensExternally('not a url')).toBe(false);
  });
  it('opens the linked server\'s web app, exactly its origin, and only from the coach\'s list', () => {
    const origins = ['https://pandafit.example.org'];
    expect(opensExternally('https://pandafit.example.org/', origins)).toBe(true);
    expect(opensExternally('https://pandafit.example.org/kraft?x=1', origins)).toBe(true);
    expect(opensExternally('https://pandafit.example.org/')).toBe(false);
    expect(opensExternally('http://pandafit.example.org/', origins)).toBe(false);
    expect(opensExternally('https://pandafit.example.org.evil.example/', origins)).toBe(false);
    expect(opensExternally('https://other.example.org/', origins)).toBe(false);
    expect(opensExternally('https://pandafit.example.org:8443/', origins)).toBe(false);
  });
  it('reads the origins from the account links in the data folder, https only', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'links-'));
    fs.writeFileSync(path.join(dir, 'pa'), JSON.stringify({ url: 'https://pandafit.example.org/app', name: 'a', token: 't' }));
    fs.writeFileSync(path.join(dir, 'pb'), JSON.stringify({ url: 'http://localhost:8080', name: 'b', token: 't' }));
    fs.writeFileSync(path.join(dir, 'pa.cursors'), '{}');
    fs.writeFileSync(path.join(dir, 'pc'), 'not json');
    expect(linkedWebOrigins(dir)).toEqual(['https://pandafit.example.org']);
    expect(linkedWebOrigins(path.join(dir, 'missing'))).toEqual([]);
    fs.rmSync(dir, { recursive: true });
  });
});
