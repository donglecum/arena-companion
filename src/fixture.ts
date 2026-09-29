// Sample data for running the UI with no League client or tracker:
// ARENA_COMPANION_FIXTURE=1 (dashboard) or =champselect (a live Arena champ select).
// Deterministic, so screenshots are comparable run to run. Champion art is
// generated locally (see fixtureArt) because the sample must work offline.
import type { DDragonChampion } from './ddragon.ts';

const ROSTER = `Aatrox|Aatrox|Fighter,Tank;Ahri|Ahri|Mage,Assassin;Akali|Akali|Assassin;Akshan|Akshan|Marksman,Assassin;Alistar|Alistar|Tank,Support;Ambessa|Ambessa|Fighter,Assassin;Amumu|Amumu|Tank,Mage;Anivia|Anivia|Mage,Support;Annie|Annie|Mage;Aphelios|Aphelios|Marksman;Ashe|Ashe|Marksman,Support;AurelionSol|Aurelion Sol|Mage;Aurora|Aurora|Mage,Assassin;Azir|Azir|Mage,Marksman;Bard|Bard|Support,Mage;Belveth|Bel'Veth|Fighter;Blitzcrank|Blitzcrank|Tank,Fighter;Brand|Brand|Mage;Braum|Braum|Support,Tank;Briar|Briar|Fighter,Assassin;Caitlyn|Caitlyn|Marksman;Camille|Camille|Fighter;Cassiopeia|Cassiopeia|Mage;Chogath|Cho'Gath|Tank,Mage;Corki|Corki|Marksman;Darius|Darius|Fighter,Tank;Diana|Diana|Fighter,Mage;Draven|Draven|Marksman;DrMundo|Dr. Mundo|Tank,Fighter;Ekko|Ekko|Assassin,Fighter;Elise|Elise|Mage,Fighter;Evelynn|Evelynn|Assassin,Mage;Ezreal|Ezreal|Marksman,Mage;Fiddlesticks|Fiddlesticks|Mage,Support;Fiora|Fiora|Fighter,Assassin;Fizz|Fizz|Assassin,Fighter;Galio|Galio|Tank,Mage;Gangplank|Gangplank|Fighter;Garen|Garen|Fighter,Tank;Gnar|Gnar|Fighter,Tank;Gragas|Gragas|Fighter,Mage;Graves|Graves|Marksman;Gwen|Gwen|Fighter,Assassin;Hecarim|Hecarim|Fighter,Tank;Heimerdinger|Heimerdinger|Mage,Support;Hwei|Hwei|Mage,Support;Illaoi|Illaoi|Fighter,Tank;Irelia|Irelia|Fighter,Assassin;Ivern|Ivern|Support,Mage;Janna|Janna|Support,Mage;JarvanIV|Jarvan IV|Tank,Fighter;Jax|Jax|Fighter,Assassin;Jayce|Jayce|Fighter,Marksman;Jhin|Jhin|Marksman,Mage;Jinx|Jinx|Marksman;Kaisa|Kai'Sa|Marksman;Kalista|Kalista|Marksman;Karma|Karma|Mage,Support;Karthus|Karthus|Mage;Kassadin|Kassadin|Assassin,Mage;Katarina|Katarina|Assassin,Mage;Kayle|Kayle|Fighter,Support;Kayn|Kayn|Fighter,Assassin;Kennen|Kennen|Mage;Khazix|Kha'Zix|Assassin;Kindred|Kindred|Marksman;Kled|Kled|Fighter,Tank;KogMaw|Kog'Maw|Marksman,Mage;KSante|K'Sante|Tank,Fighter;Leblanc|LeBlanc|Assassin,Mage;LeeSin|Lee Sin|Fighter,Assassin;Leona|Leona|Tank,Support;Lillia|Lillia|Fighter,Mage;Lissandra|Lissandra|Mage;Lucian|Lucian|Marksman;Lulu|Lulu|Support,Mage;Lux|Lux|Mage,Support;Malphite|Malphite|Tank,Fighter;Malzahar|Malzahar|Mage,Assassin;Maokai|Maokai|Tank,Mage;MasterYi|Master Yi|Assassin,Fighter;Mel|Mel|Mage,Support;Milio|Milio|Support,Mage;MissFortune|Miss Fortune|Marksman;MonkeyKing|Wukong|Fighter,Tank;Mordekaiser|Mordekaiser|Fighter;Morgana|Morgana|Mage,Support;Naafiri|Naafiri|Assassin,Fighter;Nami|Nami|Support,Mage;Nasus|Nasus|Fighter,Tank;Nautilus|Nautilus|Tank,Support;Neeko|Neeko|Mage,Support;Nidalee|Nidalee|Assassin,Mage;Nilah|Nilah|Fighter,Assassin;Nocturne|Nocturne|Assassin,Fighter;Nunu|Nunu & Willump|Tank,Mage;Olaf|Olaf|Fighter,Tank;Orianna|Orianna|Mage,Support;Ornn|Ornn|Tank,Fighter;Pantheon|Pantheon|Fighter,Assassin;Poppy|Poppy|Tank,Fighter;Pyke|Pyke|Support,Assassin;Qiyana|Qiyana|Assassin,Fighter;Quinn|Quinn|Marksman,Assassin;Rakan|Rakan|Support;Rammus|Rammus|Tank,Fighter;RekSai|Rek'Sai|Fighter;Rell|Rell|Tank,Support;Renata|Renata Glasc|Support,Mage;Renekton|Renekton|Fighter,Tank;Rengar|Rengar|Assassin,Fighter;Riven|Riven|Fighter,Assassin;Rumble|Rumble|Fighter,Mage;Ryze|Ryze|Mage,Fighter;Samira|Samira|Marksman,Assassin;Sejuani|Sejuani|Tank,Fighter;Senna|Senna|Marksman,Support;Seraphine|Seraphine|Mage,Support;Sett|Sett|Fighter,Tank;Shaco|Shaco|Assassin;Shen|Shen|Tank;Shyvana|Shyvana|Fighter,Tank;Singed|Singed|Tank,Fighter;Sion|Sion|Tank,Fighter;Sivir|Sivir|Marksman;Skarner|Skarner|Tank,Fighter;Smolder|Smolder|Marksman,Mage;Sona|Sona|Support,Mage;Soraka|Soraka|Support,Mage;Swain|Swain|Mage,Fighter;Sylas|Sylas|Mage,Assassin;Syndra|Syndra|Mage;TahmKench|Tahm Kench|Support,Tank;Taliyah|Taliyah|Mage,Support;Talon|Talon|Assassin;Taric|Taric|Support,Fighter;Teemo|Teemo|Marksman,Assassin;Thresh|Thresh|Support,Fighter;Tristana|Tristana|Marksman,Assassin;Trundle|Trundle|Fighter,Tank;Tryndamere|Tryndamere|Fighter,Assassin;TwistedFate|Twisted Fate|Mage;Twitch|Twitch|Marksman,Assassin;Udyr|Udyr|Fighter,Tank;Urgot|Urgot|Fighter,Tank;Varus|Varus|Marksman,Mage;Vayne|Vayne|Marksman,Assassin;Veigar|Veigar|Mage;Velkoz|Vel'Koz|Mage;Vex|Vex|Mage;Vi|Vi|Fighter,Assassin;Viego|Viego|Assassin,Fighter;Viktor|Viktor|Mage;Vladimir|Vladimir|Mage,Fighter;Volibear|Volibear|Fighter,Tank;Warwick|Warwick|Fighter,Tank;Xayah|Xayah|Marksman;Xerath|Xerath|Mage;XinZhao|Xin Zhao|Fighter,Assassin;Yasuo|Yasuo|Fighter,Assassin;Yone|Yone|Assassin,Fighter;Yorick|Yorick|Fighter,Tank;Yuumi|Yuumi|Support,Mage;Yunara|Yunara|Marksman;Zac|Zac|Tank,Fighter;Zed|Zed|Assassin;Zeri|Zeri|Marksman;Ziggs|Ziggs|Mage;Zilean|Zilean|Support,Mage;Zoe|Zoe|Mage,Support;Zyra|Zyra|Mage,Support`;

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fixtureChampions(): DDragonChampion[] {
  return ROSTER.split(';').map((entry, index) => {
    const [id, name, tags] = entry.split('|');
    return { id, key: String(index + 1), name, image: `${id}.png`, title: '', tags: tags.split(',') };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export interface Fixture {
  champions: DDragonChampion[];
  store: { account: Record<string, string>; matches: Record<string, { championName: string; win: boolean; placement: number; gameEnd: number }> };
  masteries: Record<string, { level: number; points: number }>;
  manual: Set<string>;
  owned: number[];
  arenaGod: number;
  summoner: { gameName: string; tagLine: string; summonerLevel: number };
}

export function buildFixture(now: number): Fixture {
  const random = rng(602002);
  const champions = fixtureChampions();
  const pick = <T,>(list: T[]) => list[Math.floor(random() * list.length)];
  // A player who favors a comfort pool, with games spread over five months and
  // clustered into evening sessions; the last session ended 40 minutes ago.
  const comfort = champions.filter(() => random() < 0.35);
  const matches: Fixture['store']['matches'] = {};
  let t = now - 40 * 60_000;
  for (let i = 0; i < 760; i += 1) {
    const champion = random() < 0.4 ? pick(comfort) : pick(champions);
    const skill = comfort.includes(champion) ? 0.24 : 0.16;
    const roll = random();
    const placement = roll < skill ? 1 : 2 + Math.floor(((roll - skill) / (1 - skill)) * 7);
    matches[`NA1_${5_100_000_000 - i}`] = { championName: champion.id, win: placement === 1, placement, gameEnd: Math.round(t) };
    t -= random() < 0.8 ? (17 + random() * 14) * 60_000 : (8 + random() * 60) * 3600_000;
  }
  const masteries: Fixture['masteries'] = {};
  for (const c of champions) {
    const points = Math.floor((comfort.includes(c) ? 40_000 + random() * 380_000 : random() * 60_000));
    masteries[c.key] = { level: Math.min(40, Math.max(1, Math.floor(points / 11_000))), points };
  }
  const played = new Set(Object.values(matches).map((m) => m.championName));
  const manual = new Set(champions.filter((c) => !played.has(c.id)).slice(0, 4).map((c) => c.id));
  const owned = champions.filter(() => random() < 0.88).map((c) => Number(c.key));
  const won = new Set([...Object.values(matches).filter((m) => m.win).map((m) => m.championName), ...manual]);
  return {
    champions,
    store: { account: { puuid: 'fixture', gameName: 'Player', tagLine: 'NA1' }, matches },
    masteries,
    manual,
    owned,
    arenaGod: won.size + 7, // wins from before match-v5 retention
    summoner: { gameName: 'Player', tagLine: 'NA1', summonerLevel: 512 },
  };
}

function hash(text: string) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** A generated stand-in portrait/splash: a two-tone gradient with the champion's initials. */
export function fixtureArt(id: string): string {
  const h = hash(id);
  const hue = h % 360;
  const hue2 = (hue + 40 + (h >> 9) % 80) % 360;
  const initials = id.replace(/[^A-Za-z]/g, '').replace(/^(.)(?:.*?([A-Z]))?.*$/, (_m, a, b) => `${a}${b ?? ''}`).toUpperCase().slice(0, 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" preserveAspectRatio="xMidYMid slice">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 55% 42%)"/><stop offset="1" stop-color="hsl(${hue2} 60% 18%)"/></linearGradient>
<radialGradient id="r" cx=".3" cy=".25" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".25"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
<rect width="120" height="120" fill="url(#g)"/><rect width="120" height="120" fill="url(#r)"/>
<circle cx="${20 + (h % 80)}" cy="${30 + ((h >> 5) % 60)}" r="${18 + (h % 22)}" fill="#fff" fill-opacity=".06"/>
<text x="60" y="73" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="38" font-weight="700" fill="#fff" fill-opacity=".82">${initials}</text></svg>`;
}
