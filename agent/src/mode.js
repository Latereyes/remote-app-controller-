import fs from 'node:fs';
import path from 'node:path';

/**
 * Modalità del PC decisa all'accensione (cartella boot/ della repository).
 * - mode.txt: "server" o "xbox", scritto dal countdown;
 * - game.txt: richiesta «per giocare» arrivata dall'app; il countdown la legge come se qualcuno
 *   avesse toccato il PC e resta in modalità Xbox (serve per la Steam Deck: Moonlight si collega dopo).
 */
export function createModeControl({ bootDir, apps, log = console.log }) {
  const modeFile = path.join(bootDir, 'mode.txt');
  const gameFile = path.join(bootDir, 'game.txt');
  const read = (f) => { try { return fs.readFileSync(f, 'utf8').trim() || null; } catch { return null; } };

  /** App avviate dal countdown in modalità server (boot.json), da chiudere per giocare. */
  const serverApps = () => {
    try {
      const list = JSON.parse(fs.readFileSync(path.join(bootDir, 'boot.json'), 'utf8').replace(/^﻿/, '')).serverApps;
      if (Array.isArray(list)) return list;
    } catch { /* boot.json mancante o rotto: valori di base */ }
    return ['ollama', 'comfy'];
  };

  return {
    get: () => read(modeFile),

    /**
     * Il PC serve per giocare. Se il countdown non ha ancora deciso, lascia la richiesta in game.txt.
     * Se è già in modalità server chiude le app del countdown, così la GPU è libera per il gioco.
     */
    async requestGame(who = 'app') {
      fs.writeFileSync(gameFile, `${new Date().toISOString()} ${who}\n`);
      const before = read(modeFile);
      const stopped = [];
      if (before === 'server') {
        const known = new Set(apps.ids());
        for (const id of serverApps().filter((x) => known.has(x))) {
          try { await apps.stop(id); stopped.push(id); } catch (e) { log(`[gioco] chiusura di ${id} non riuscita: ${e.message}`); }
        }
        fs.writeFileSync(modeFile, 'xbox');
      }
      log(`[gioco] richiesto da ${who}${before === 'server' ? `: da server a Xbox, chiuse ${stopped.join(', ') || 'nessuna app'}` : ''}`);
      return { mode: before === 'server' ? 'xbox' : before, stopped, waiting: !before };
    },
  };
}
