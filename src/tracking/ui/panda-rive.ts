import rivUrl from './panda.riv?url';
import wasmUrl from '@rive-app/canvas-lite/rive.wasm?url';

/** The triggers of the state machine `PandaCoach`; each name is a trigger of the default View Model instance. */
export type PandaGesture = 'greet' | 'listen' | 'nod' | 'breathe' | 'flex' | 'bike' | 'run' | 'yoga' | 'read' | 'knit';

export type PandaHandle = { play(gesture: PandaGesture): void; dispose(): void };

/**
 * Loads the Rive runtime and the Panda file from the own origin and starts the neutral pose on the canvas.
 * Resolves after the first frame is drawn; rejects when anything fails to load.
 */
export async function mountPanda(canvas: HTMLCanvasElement): Promise<PandaHandle> {
  const { Rive, RuntimeLoader } = await import('@rive-app/canvas-lite');
  // Same origin only: no fallback or threaded build from a CDN.
  RuntimeLoader.setWasmUrl(wasmUrl);
  RuntimeLoader.setWasmFallbackUrl(null);
  RuntimeLoader.setWasmThreadsUrl(null);
  let disposed = false;
  let instance: InstanceType<typeof Rive> | null = null;
  const stop = () => {
    if (disposed) return;
    disposed = true;
    try { instance?.cleanup(); } catch { /* already gone */ }
  };
  await new Promise<void>((resolve, reject) => {
    instance = new Rive({
      src: rivUrl,
      canvas,
      artboard: 'Panda',
      stateMachines: 'PandaCoach',
      autoplay: true,
      autoBind: true,
      onLoad: () => {
        instance?.resizeDrawingSurfaceToCanvas();
        // Two animation frames: by then the first advance has drawn the neutral pose.
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      },
      onLoadError: () => reject(new Error('panda file did not load')),
    });
  }).catch((e) => { stop(); throw e; });
  return {
    play(gesture) {
      if (disposed) return;
      try { instance?.viewModelInstance?.trigger(gesture)?.trigger(); } catch { /* a missing trigger leaves the neutral pose */ }
    },
    dispose: stop,
  };
}
