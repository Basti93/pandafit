import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { EXERCISE_IMAGES } from '../../src/shared/exercise-images';
import { FEDB_EXERCISES } from '../../src/shared/fedb';
import { loadFedb } from '../../src/tracking/fedb-lazy';
import { exerciseImages, imageSrc, videoSearchUrl } from '../../src/tracking/media';

describe('exerciseImages', () => {
  beforeAll(async () => { await loadFedb(); });

  it('gives the bundled pictures of an own exercise with their credits', () => {
    const imgs = exerciseImages('pf-bench-press');
    expect(imgs.length).toBeGreaterThan(0);
    expect(imgs[0]).toEqual(expect.objectContaining({ author: expect.any(String), licence: expect.stringMatching(/^(CC-BY-SA [34]\.0|CC0 1\.0)$/) }));
    expect(imgs[0]!.sourceUrl).toMatch(/^https:\/\/wger\.de\//);
  });

  it('gives nothing for an exercise without pictures', () => {
    expect(exerciseImages('pf-squat')).toEqual([]);
    expect(exerciseImages('hevy-unknown')).toEqual([]);
  });

  it('gives a base-catalog entry its generated pictures with the public-domain credit', () => {
    const e = FEDB_EXERCISES.find((x) => (x.images?.length ?? 0) > 0)!;
    const imgs = exerciseImages(e.id);
    expect(imgs.map((i) => i.file)).toEqual(e.images!.map((_, i) => `exercises/fedb/${e.id}-${i + 1}.jpg`));
    expect(imgs[0]!.author).toBe('free-exercise-db (gemeinfrei)');
  });

  it('every listed picture exists, at most two per exercise, under 3 MB together', () => {
    let bytes = 0;
    for (const list of Object.values(EXERCISE_IMAGES)) {
      expect(list.length).toBeLessThanOrEqual(2);
      for (const img of list) {
        expect(img.licence).toMatch(/^(CC-BY-SA [34]\.0|CC0 1\.0)$/);
        bytes += fs.statSync(`src/web/public/${img.file}`).size;
      }
    }
    expect(bytes).toBeLessThan(3 * 1024 * 1024);
  });

  it('builds the image address from the app base', () => {
    expect(imageSrc('exercises/a.jpg')).toBe('/exercises/a.jpg');
  });
});

describe('videoSearchUrl', () => {
  it('searches YouTube for the English Hevy title', () => {
    expect(videoSearchUrl({ title: 'Kniebeuge', hevyTitle: 'Squat (Barbell)' }))
      .toBe('https://www.youtube.com/results?search_query=Squat%20(Barbell)%20exercise%20form');
  });

  it('uses the German title when there is no English one', () => {
    expect(videoSearchUrl({ title: 'Übung & mehr' })).toBe('https://www.youtube.com/results?search_query=%C3%9Cbung%20%26%20mehr%20exercise%20form');
  });
});

describe('exerciseImages before the base catalog is loaded', () => {
  it('knows only the own exercises (the screens render again when the catalog arrives)', async () => {
    const { vi } = await import('vitest');
    vi.resetModules();
    const fresh = await import('../../src/tracking/media');
    expect(fresh.exerciseImages(FEDB_EXERCISES.find((e) => (e.images?.length ?? 0) > 0)!.id)).toEqual([]);
    expect(fresh.exerciseImages('pf-bench-press').length).toBeGreaterThan(0);
  });
});
