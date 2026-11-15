/**
 * Schermi giusti senza toccare niente, quando nessuno è collegato con Moonlight:
 * - TV accesa e schermo virtuale ancora acceso (TV spenta all'avvio, o stream finito male) → solo la TV
 *   (boot/schermo-pc.ps1): altrimenti lo schermo principale resta quello virtuale e la TV è nera;
 * - nessuno schermo acceso (TV spenta) → di nuovo lo schermo virtuale (boot/schermo-virtuale.ps1):
 *   senza uno schermo acceso Sunshine non trova l'encoder e Moonlight risponde 503.
 * Durante lo stream non fa niente: gli schermi li sceglie Sunshine.
 */

/** Cosa fare con gli schermi letti da displays(): 'physical', 'virtual' o null. */
export function screenAction(info) {
  if (!info?.available || info.stream?.streaming || !info.displays?.length) return null;
  const active = info.displays.filter((d) => d.active);
  if (!active.length) return info.displays.some((d) => d.virtual) ? 'virtual' : null;
  if (active.some((d) => d.virtual) && active.some((d) => !d.virtual)) return 'physical';
  return null;
}

/**
 * Controlla gli schermi ogni `intervalMs`; agisce solo se la stessa situazione si ripete due volte di fila
 * (Sunshine ha bisogno di qualche secondo per rimettere gli schermi dopo lo stream, la TV per accendersi).
 * `run(kind)` esegue lo script; dopo un errore riprova solo dopo `retryMs`.
 */
export function createScreenWatch({ displays, run, enabled = () => true, log = console.log, retryMs = 5 * 60 * 1000, now = Date.now }) {
  let pending = null;
  let busy = false;
  let pauseUntil = 0;

  async function check() {
    if (busy || !enabled() || now() < pauseUntil) return null;
    busy = true;
    try {
      const action = screenAction(await displays());
      if (!action || action !== pending) { pending = action; return null; }
      pending = null;
      log(action === 'physical'
        ? '[schermo] TV accesa e nessuno su Moonlight: spengo lo schermo virtuale'
        : '[schermo] nessuno schermo acceso: accendo lo schermo virtuale per Moonlight');
      try {
        await run(action);
      } catch (e) {
        log(`[schermo] non riuscito: ${e.message}`);
        pauseUntil = now() + retryMs;
      }
      return action;
    } catch {
      return null;
    } finally {
      busy = false;
    }
  }

  return { check };
}
