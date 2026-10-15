(function (root) {
  'use strict';
  const HEIGHT = 6;
  const GLOVE_TOP = 8;
  const ARM_REACH = 2.5;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  function profile(field) {
    const skill = Math.max(0, field) / (Math.max(0, field) + 50);
    return {
      jump: 0.6 + 4 * skill,
      dive: 2 + 8 * skill,
      timing: 0.18 * (1 - skill),
      recovery: 1.5 - skill
    };
  }

  function action(kind, time, ability, dx, dy) {
    const duration = kind === 'jump' ? 0.7 + ability.jump * 0.08 : 0.65;
    const lead = duration / 2 - ability.timing;
    return {
      kind, start: time - lead, contact: time, end: time + duration / 2 + ability.recovery,
      duration, height: ability.jump, distance: ability.dive, dx, dy
    };
  }

  function pose(move, time) {
    if (!move || time < move.start || time >= move.end) return { z: 0, tilt: 0, dx: 0, dy: 0 };
    const age = time - move.start;
    if (move.kind === 'jump') {
      return { z: age < move.duration ? move.height * Math.sin(Math.PI * age / move.duration) : 0, tilt: 0, dx: move.dx, dy: move.dy };
    }
    const rise = clamp(age / Math.max(0.01, move.contact - move.start), 0, 1);
    const recover = time <= move.contact ? 1 : clamp((move.end - time) / (move.end - move.contact), 0, 1);
    return { z: 0, tilt: 1.25 * rise * recover, dx: move.dx, dy: move.dy };
  }

  function reach(body, height) {
    if (height < Math.max(0, body.z - 2) || height > GLOVE_TOP + body.z) return 0;
    if (body.tilt) {
      const sine = Math.sin(body.tilt), cosine = Math.cos(body.tilt);
      if (height > HEIGHT * cosine + 1.5) return 0;
      const along = clamp((height + ARM_REACH * sine) / cosine, 0, HEIGHT);
      const vertical = height - along * cosine;
      return along * sine + Math.sqrt(Math.max(0, ARM_REACH * ARM_REACH - vertical * vertical));
    }
    const above = Math.max(0, height - body.z - HEIGHT);
    return ARM_REACH * Math.sqrt(Math.max(0, 1 - above * above / 4));
  }

  function canReach(body, dx, dy, height) {
    if (height < Math.max(0, body.z - 2) || height > GLOVE_TOP + body.z) return false;
    if (!body.tilt) return Math.hypot(dx, dy) <= reach(body, height) + 1e-6;
    if (height > HEIGHT * Math.cos(body.tilt) + 1.5) return false;
    const axisX = body.dx * Math.sin(body.tilt), axisY = body.dy * Math.sin(body.tilt);
    const axisZ = Math.cos(body.tilt);
    const along = clamp(dx * axisX + dy * axisY + height * axisZ, 0, HEIGHT);
    return Math.hypot(dx - along * axisX, dy - along * axisY, height - along * axisZ) <= ARM_REACH + 1e-6;
  }

  const api = { HEIGHT, GLOVE_TOP, ARM_REACH, profile, action, pose, reach, canReach };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FieldingMotion = api;
})(typeof window !== 'undefined' ? window : globalThis);
