import fs from 'node:fs';
import path from 'node:path';
import { parseLockfile, redactLockfile } from './lockfile.ts';
import { LcuClient, sanitize } from './lcu.ts';
import { collectLcuEvents } from './ws.ts';

const LOCKFILE_PATH = process.argv[2] ?? 'C:\\Riot Games\\League of Legends\\lockfile';
const SAMPLES_DIR = path.resolve('samples');

function saveSample(name: string, data: unknown) {
  fs.mkdirSync(SAMPLES_DIR, { recursive: true });
  fs.writeFileSync(path.join(SAMPLES_DIR, name), JSON.stringify(data, null, 2));
}

async function main() {
  console.log('=== Arena Companion — LCU probe ===\n');

  let raw: string;
  try {
    raw = fs.readFileSync(LOCKFILE_PATH, 'utf8');
  } catch {
    console.log(`LOCKFILE: NOT FOUND at ${LOCKFILE_PATH}`);
    console.log('LCU CONNECTED: no');
    process.exit(1);
  }
  console.log(`LOCKFILE: found (${redactLockfile(raw)})`);

  const lf = parseLockfile(raw);
  const lcu = new LcuClient(lf);

  // 1. gameflow phase — also proves connectivity
  let phase = '<unavailable>';
  try {
    const res = await lcu.getJson('/lol-gameflow/v1/gameflow-phase');
    phase = res.status === 200 ? String(res.json) : `<HTTP ${res.status}>`;
    console.log(`LCU CONNECTED: yes`);
  } catch (err) {
    console.log(`LCU CONNECTED: no (${String(err).slice(0, 80)})`);
    process.exit(1);
  }
  console.log(`GAMEFLOW PHASE: ${phase}`);

  // 2. current summoner
  try {
    const res = await lcu.getJson('/lol-summoner/v1/current-summoner');
    if (res.status === 200 && res.json && typeof res.json === 'object') {
      const s = res.json as Record<string, unknown>;
      console.log(`SUMMONER: ${s.gameName ?? '?'}#${s.tagLine ?? '?'} (level ${s.summonerLevel ?? '?'})`);
      saveSample('current-summoner.json', sanitize(res.json));
    } else {
      console.log(`SUMMONER: <HTTP ${res.status}>`);
    }
  } catch (err) {
    console.log(`SUMMONER: error (${String(err).slice(0, 60)})`);
  }

  // 3. owned champions
  try {
    const res = await lcu.getJson('/lol-champions/v1/owned-champions-minimal');
    if (res.status === 200 && Array.isArray(res.json)) {
      console.log(`OWNED CHAMPIONS: ${res.json.length}`);
      saveSample('owned-champions.json', sanitize(res.json));
    } else {
      console.log(`OWNED CHAMPIONS: <HTTP ${res.status}>`);
    }
  } catch (err) {
    console.log(`OWNED CHAMPIONS: error (${String(err).slice(0, 60)})`);
  }

  // 4. champ select session (expected to fail outside champ select)
  try {
    const res = await lcu.getJson('/lol-champ-select/v1/session');
    if (res.status === 200) {
      console.log(`CHAMP SELECT: session available`);
      saveSample('champ-select-session.json', sanitize(res.json));
    } else {
      console.log(`CHAMP SELECT: not in champ select (HTTP ${res.status})`);
    }
  } catch (err) {
    console.log(`CHAMP SELECT: error (${String(err).slice(0, 60)})`);
  }

  // 5. swagger — endpoint capability survey
  let swaggerPaths: string[] = [];
  for (const swPath of ['/swagger/v3/openapi.json', '/swagger/v2/swagger.json']) {
    try {
      const res = await lcu.getJson(swPath);
      if (res.status === 200 && res.json && typeof res.json === 'object') {
        swaggerPaths = Object.keys((res.json as { paths?: object }).paths ?? {});
        console.log(`SWAGGER: ${swaggerPaths.length} endpoints from ${swPath}`);
        break;
      }
    } catch {
      /* try next */
    }
  }
  if (swaggerPaths.length) {
    const interesting = swaggerPaths.filter((p) =>
      /challenge|collection|champion|mastery|champ-select|gameflow/i.test(p),
    );
    saveSample('swagger-interesting.json', interesting);
    console.log(`INTERESTING ENDPOINTS: ${interesting.length} (saved to samples/swagger-interesting.json)`);
    const challenge = swaggerPaths.filter((p) => /challenge/i.test(p));
    console.log(`CHALLENGE ENDPOINTS: ${challenge.length ? challenge.join(', ') : 'none found'}`);
  } else {
    console.log('SWAGGER: unavailable');
  }

  // 5b. challenges — can LCU see Arena God (602002) progress?
  try {
    const res = await lcu.getJson('/lol-challenges/v1/challenges/local-player');
    if (res.status === 200 && res.json && typeof res.json === 'object') {
      const byId = res.json as Record<string, Record<string, unknown>>;
      const arenaGod = byId['602002'];
      const total = Object.keys(byId).length;
      saveSample('challenges-602002.json', sanitize(arenaGod ?? { error: 'not found', totalChallenges: total }));
      if (arenaGod) {
        console.log(
          `ARENA GOD (602002): name=${arenaGod.name ?? '?'} value=${arenaGod.currentValue ?? '?'} level=${arenaGod.level ?? '?'}`,
        );
      } else {
        console.log(`ARENA GOD (602002): not present in local-player challenges (${total} total)`);
      }
    } else {
      console.log(`CHALLENGES: <HTTP ${res.status}>`);
    }
  } catch (err) {
    console.log(`CHALLENGES: error (${String(err).slice(0, 60)})`);
  }

  // 6. WebSocket event subscription (15s)
  console.log('\nWS: subscribing to OnJsonApiEvent for 15s...');
  const ws = await collectLcuEvents(lf, 15_000);
  if (ws.error) {
    console.log(`WS: failed (${ws.error.slice(0, 80)})`);
  } else {
    console.log(`WS: connected, captured ${ws.events.length} events`);
    const byPrefix = new Map<string, number>();
    for (const e of ws.events) {
      const prefix = e.uri.split('/').slice(0, 3).join('/');
      byPrefix.set(prefix, (byPrefix.get(prefix) ?? 0) + 1);
    }
    for (const [prefix, count] of [...byPrefix.entries()].sort()) {
      console.log(`  ${prefix} ×${count}`);
    }
    saveSample('ws-events.json', ws.events);
  }

  console.log('\n=== probe complete ===');
}

main();
