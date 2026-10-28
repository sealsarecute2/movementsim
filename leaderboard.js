export function parseLeaderboard(text, { preset = 'classic', endless = false } = {}) {
  const best = new Map();
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const fields = line.split('|').map(field => field.trim());
    if (fields.length < 2 || fields.length > 3) continue;
    const [rawName, score, mode = 'classic'] = fields;
    if (!rawName || mode.toLowerCase() !== preset) continue;
    let value;
    if (endless) {
      if (!/^\d+$/.test(score)) continue;
      value = Number(score);
    } else if (/^\d+(?:\.\d{1,3})?$/.test(score)) value = Number(score);
    else {
      const parts = /^(\d+):([0-5]\d)(?:\.(\d{1,3}))?$/.exec(score);
      if (!parts) continue;
      value = Number(parts[1]) * 60 + Number(parts[2]) + Number((parts[3] || '').padEnd(3, '0')) / 1000;
    }
    if (!Number.isFinite(value) || value <= 0 || (endless && !Number.isSafeInteger(value))) continue;
    const name = [...rawName.normalize('NFC')].slice(0, 40).join('');
    const key = name.toLowerCase(), previous = best.get(key);
    if (!previous || (endless ? value > previous.value : value < previous.value)) best.set(key, { name, value });
  }
  return [...best.values()].sort((a, b) => (endless ? b.value - a.value : a.value - b.value) || a.name.localeCompare(b.name));
}

export function formatLeaderboardScore(value, endless = false) {
  if (endless) return `${value.toLocaleString('en-CA')} u`;
  const ms = Math.round(value * 1000);
  return `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}

export function leaderboardRows(records, endless = false) {
  const escape = text => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  return records.slice(0, 100).map((entry, i) => `<tr><td>${i + 1}</td><td>${escape(entry.name)}</td><td>${formatLeaderboardScore(entry.value, endless)}</td></tr>`).join('');
}

const LEADERBOARD_FILES = Object.freeze({
  course: {revision:1,file:'course.txt'},
  'bhop-school': {revision:1,file:'bhop-school.txt'},
  'ladder-run': {revision:1,file:'ladder-run.txt'},
  endless: {revision:3,file:'endless-v3.txt',endless:true},
  bhop_lego: {revision:2,file:'bhop_lego-v2.txt'},
  bhop_kitsune: {revision:3,file:'bhop_kitsune-v3.txt'},
});

export function hasLeaderboard(courseId, revision=1) {
  return Object.hasOwn(LEADERBOARD_FILES,courseId)&&LEADERBOARD_FILES[courseId].revision===revision;
}

export async function loadLeaderboard(courseId, preset, { fetcher = globalThis.fetch, signal, revision=1 } = {}) {
  if (!hasLeaderboard(courseId,revision) || !['classic', 'practice'].includes(preset)) throw new Error('Invalid leaderboard');
  const response = await fetcher(`leaderboards/${LEADERBOARD_FILES[courseId].file}?v=${Math.floor(Date.now() / 30000)}`, { cache: 'no-store', signal });
  if (!response.ok) throw new Error('Leaderboard unavailable');
  const text = await response.text();
  if (text.length > 200000) throw new Error('Leaderboard file is too large');
  return parseLeaderboard(text, { preset,endless:!!LEADERBOARD_FILES[courseId].endless });
}
