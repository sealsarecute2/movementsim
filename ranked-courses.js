export const LEADERBOARD_LIMIT=5;
export const RANKED_ENDLESS_SEED=0x51ea15e;
export const RANKED_COURSES=Object.freeze([
  ['course',1],['bhop-school',1],['ladder-run',1],['bhop_lego',2],['bhop_kitsune',3],['endless',3],
].flatMap(([map,revision])=>['classic','practice'].map(preset=>Object.freeze({map,revision,preset}))));
export const rankedCourseAllowed=selection=>!!selection&&RANKED_COURSES.some(course=>['map','revision','preset'].every(key=>course[key]===selection[key]));
