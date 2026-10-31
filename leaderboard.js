import {RANKED_COURSES,LEADERBOARD_LIMIT} from './ranked-courses.js';

export function formatLeaderboardScore(value, endless = false) {
  if (endless) return `${value.toLocaleString('en-CA')} u`;
  const ms = Math.round(value * 1000);
  return `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}

export function leaderboardRows(records, endless = false) {
  const escape = text => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  return records.slice(0, LEADERBOARD_LIMIT).map((entry, i) => `<tr><td>${i + 1}</td><td>${escape(entry.name)}</td><td>${formatLeaderboardScore(entry.value, endless)}</td></tr>`).join('');
}

export function hasLeaderboard(courseId,revision=1){return RANKED_COURSES.some(course=>course.map===courseId&&course.revision===revision);}
