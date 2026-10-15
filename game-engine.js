/*
  Field Notes game engine: pitch-by-pitch baseball simulation with no DOM dependency.

  Layers (each can later be replaced by manual input):
  - Pitch: pitcher ratings choose a pitch type and location.
  - Swing: batter ratings decide whether to swing; a swing is described by `timing` (ms, + = late)
    and `loc` (inches, + = under the ball). `stepPitch(game, manualSwing)` accepts the same shape,
    so a timing-based swing UI only has to supply { swing, timing, loc }.
  - Batted ball: swing quality becomes exit velocity, launch angle and direction. The flight uses
    the same drag + lift model as the spray chart.
  - Defense and running: fielders reach the ball by reaction + running time, throws and runners
    are timed against each other with a little noise.
  Ratings are 0 and up with no cap (about 50 = MLB average, best players near 100); see normalizePlayer.
*/
(function (root) {
  'use strict';
  const motion = typeof module !== 'undefined' && module.exports ? require('./fielding-motion.js') : root.FieldingMotion;
  const listedHeights = typeof module !== 'undefined' && module.exports ? require('./player-heights.js') : root.MLB_HEIGHTS;
  const listedWeights = typeof module !== 'undefined' && module.exports ? require('./player-weights.js') : root.MLB_WEIGHTS;
  const playerHeight = (player) => {
    const listed = listedHeights && listedHeights[player.mlb || player.id];
    if (listed && !player.heightManual) return listed;
    return Number.isFinite(Number(player.height)) && Number(player.height) > 0 ? Number(player.height) : listed || 72;
  };
  const playerWeight = (player) => {
    const listed = listedWeights && listedWeights[player.mlb || player.id];
    if (listed && !player.weightManual) return listed;
    return Number.isFinite(Number(player.weight)) && Number(player.weight) > 0 ? Number(player.weight) : listed || 200;
  };

  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  // Keep surname particles and generational suffixes in field labels.
  function shortName(full) {
    if (!full) return '';
    const parts = String(full).trim().split(/\s+/);
    let start = parts.length - 1;
    if (start > 0 && /^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(parts[start])) start -= 1;
    while (start > 0 && /^(de|del|della|di|da|das|do|dos|du|la|las|le|los|van|von|der|den|ten|ter|vel|st\.?)$/i.test(parts[start - 1])) start -= 1;
    return parts.slice(start).join(' ');
  }

  function makeRng(seed) {
    let state = (seed == null ? Math.floor(Math.random() * 4294967296) : seed) >>> 0;
    const next = () => {
      state = (state + 0x6D2B79F5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const gauss = () => {
      let u = 0;
      while (u === 0) u = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    };
    return {
      next,
      gauss,
      chance: (p) => next() < p,
      between: (a, b) => a + (b - a) * next(),
      pick: (list) => list[Math.floor(next() * list.length)]
    };
  }

  /* ---------------------------------------------------------------- parks */

  const PARK_LIST = [
    { id: 'angels', name: 'Angel Stadium', dims: [330, 396, 330] },
    { id: 'diamondbacks', name: 'Chase Field', dims: [330, 407, 335] },
    { id: 'braves', name: 'Truist Park', dims: [335, 400, 325] },
    { id: 'orioles', name: 'Camden Yards', dims: [333, 406, 318], walls: [[10, 45, 25]] },
    { id: 'red-sox', name: 'Fenway Park', dims: [310, 390, 302], walls: [[-45, -12, 37]] },
    { id: 'cubs', name: 'Wrigley Field', dims: [355, 400, 353] },
    { id: 'white-sox', name: 'Rate Field', dims: [330, 400, 335] },
    { id: 'reds', name: 'Great American Ball Park', dims: [328, 404, 325] },
    { id: 'guardians', name: 'Progressive Field', dims: [325, 405, 325] },
    { id: 'rockies', name: 'Coors Field', dims: [347, 415, 350] },
    { id: 'tigers', name: 'Comerica Park', dims: [345, 420, 330] },
    { id: 'astros', name: 'Daikin Park', dims: [315, 409, 326] },
    { id: 'royals', name: 'Kauffman Stadium', dims: [330, 400, 330] },
    { id: 'dodgers', name: 'Dodger Stadium', dims: [330, 395, 330] },
    { id: 'marlins', name: 'loanDepot park', dims: [340, 420, 335] },
    { id: 'brewers', name: 'American Family Field', dims: [342, 400, 337] },
    { id: 'twins', name: 'Target Field', dims: [339, 404, 328] },
    { id: 'mets', name: 'Citi Field', dims: [335, 405, 330] },
    { id: 'yankees', name: 'Yankee Stadium', dims: [318, 408, 314] },
    { id: 'athletics', name: 'Sutter Health Park', dims: [325, 403, 325] },
    { id: 'phillies', name: 'Citizens Bank Park', dims: [330, 401, 329] },
    { id: 'pirates', name: 'PNC Park', dims: [325, 399, 320] },
    { id: 'padres', name: 'Petco Park', dims: [336, 396, 322] },
    { id: 'giants', name: 'Oracle Park', dims: [339, 399, 309], walls: [[12, 45, 24]] },
    { id: 'mariners', name: 'T-Mobile Park', dims: [331, 405, 327] },
    { id: 'cardinals', name: 'Busch Stadium', dims: [336, 400, 335] },
    { id: 'rays', name: 'Tropicana Field', dims: [315, 404, 322] },
    { id: 'rangers', name: 'Globe Life Field', dims: [329, 407, 326] },
    { id: 'blue-jays', name: 'Rogers Centre', dims: [328, 400, 328] },
    { id: 'nationals', name: 'Nationals Park', dims: [336, 403, 335] }
  ];

  const parkById = (id) => PARK_LIST.find((park) => park.id === id) || PARK_LIST[0];

  // Use the drawn segments rather than interpolating across sharp corners or foul-line seams.
  function boundaryHit(park, degrees, outfieldOnly = false) {
    const dx = Math.sin(degrees * Math.PI / 180);
    const dy = Math.cos(degrees * Math.PI / 180);
    return traceBoundary(park, 0, 0, dx, dy, Infinity, outfieldOnly);
  }

  function traceBoundary(park, x, y, dx, dy, maxT, outfieldOnly = false) {
    if (typeof require === 'function' && !root.PARK_WALLS) require('./park-walls.js');
    const outline = root.PARK_BOUNDARIES && root.PARK_BOUNDARIES[park.id];
    if (!outline) return null;
    const count = outfieldOnly ? outline.outfield : outline.points.length;
    let best = null;
    for (let i = 0; i < count; i += 1) {
      const [ax, ay] = outline.points[i];
      const [bx, by] = outline.points[(i + 1) % outline.points.length];
      const ex = bx - ax;
      const ey = by - ay;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const feet = ((ax - x) * ey - (ay - y) * ex) / den;
      const u = ((ax - x) * dy - (ay - y) * dx) / den;
      if (feet > 1e-9 && feet <= maxT && u >= -1e-9 && u <= 1 + 1e-9 && (!best || feet < best.feet)) {
        const length = Math.hypot(ex, ey);
        best = { feet, x: x + feet * dx, y: y + feet * dy, height: outline.heights[i], nx: ey / length, ny: -ex / length };
      }
    }
    return best;
  }

  // Fence distance in feet at a spray angle (0 = CF, negative = LF), matching the walls drawn in the 3D chart.
  function wallSample(park, degrees) {
    if (typeof require === 'function' && !root.PARK_WALLS) {
      try { require('./park-walls.js'); } catch (error) { /* falls back to the park dimensions */ }
    }
    const table = root.PARK_WALLS && root.PARK_WALLS[park.id];
    if (!table) return null;
    const pos = (clamp(degrees, -45, 45) + 45) / 2.5;
    const i = Math.min(table.length - 2, Math.floor(pos));
    const u = pos - i;
    return {
      feet: table[i][0] + (table[i + 1][0] - table[i][0]) * u,
      height: Math.max(table[i][1], table[i + 1][1])
    };
  }

  // Angle (degrees, positive) of the park's own foul line on the side `dir` is on, as traced in the chart art.
  function foulLimit(park, dir) {
    if (typeof require === 'function' && !root.PARK_FOUL) {
      try { require('./park-walls.js'); } catch (error) { /* falls back to 45 degrees */ }
    }
    const lines = root.PARK_FOUL && root.PARK_FOUL[park.id];
    if (!lines) return 45;
    return dir < 0 ? Math.abs(lines[0]) : lines[1];
  }

  function fenceAt(park, degrees) {
    const exact = boundaryHit(park, degrees, true);
    if (exact) return exact.feet;
    const sample = wallSample(park, degrees);
    if (sample) return sample.feet;
    const [left, center, right] = park.dims;
    const angle = clamp(degrees, -45, 45);
    const side = angle < 0 ? left : right;
    return center + (side - center) * Math.pow(Math.abs(angle) / 45, 1.35);
  }

  // Distance to the wall or stands along a bearing: the outfield fence on fair ground, then the foul-territory wall
  // as outlined in the park art (falling back to a closing-in estimate). keepInside() uses it too, so fielders and the ball agree.
  function foulWallAt(park, degrees) {
    if (typeof require === 'function' && !root.PARK_FOUL_WALLS) {
      try { require('./foul-walls.js'); } catch (error) { /* falls back to the estimate */ }
    }
    const path = root.PARK_FOUL_WALLS && root.PARK_FOUL_WALLS[park.id];
    if (!path) return null;
    const dx = Math.sin(degrees * Math.PI / 180);
    const dy = Math.cos(degrees * Math.PI / 180);
    let best = Infinity;
    for (let i = 0; i < path.length - 1; i += 1) {
      const [ax, ay] = path[i];
      const [bx, by] = path[i + 1];
      const ex = bx - ax;
      const ey = by - ay;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = (ax * ey - ay * ex) / den;
      const u = (ax * dy - ay * dx) / den;
      if (t > 1 && u >= 0 && u <= 1 && t < best) best = t;
    }
    return best < Infinity ? best : null;
  }

  function boundaryAt(park, degrees) {
    const exact = boundaryHit(park, degrees);
    if (exact) return exact.feet;
    const m = Math.abs(degrees);
    const limit = foulLimit(park, degrees);
    if (m <= limit) return fenceAt(park, degrees);
    const drawn = foulWallAt(park, degrees);
    if (drawn !== null) return drawn;
    const edge = fenceAt(park, degrees < 0 ? -limit : limit);
    if (m <= 90) return edge + (80 - edge) * (m - limit) / (90 - limit);
    return 55;
  }

  function wallAt(park, degrees) {
    const exact = boundaryHit(park, degrees);
    if (exact) return exact.height;
    const sample = wallSample(park, degrees);
    if (sample) return sample.height;
    for (const [from, to, height] of park.walls || []) {
      if (degrees >= from && degrees <= to) return height;
    }
    return 8;
  }

  /* ----------------------------------------------------------- ball flight */

  const BALL = { drag: 0.0019, lift: 0.0008, g: 32.174, startHeight: 3 };
  const FOUL_POLE_REACH = 0.3;

  /* ------------------------------------------------------------ weather and spin */

  const FPS = 1.46667;
  // Damped to 70% of true density loss: the sim's exit-velocity tail is thin, so full density makes Coors absurd.
  const airDensity = (altitudeFt) => 1 - 0.7 * (1 - Math.pow(1 - 6.87e-6 * Math.max(0, altitudeFt || 0), 4.256));

  // Air density tracks 1/absolute temperature (70 F = 1.0): about 1% less dense per 5 F, which is roughly
  // 3 ft of carry per 10 F on a 400 ft fly ball, in line with published studies.
  const REF_TEMP_F = 70;
  const tempFactor = (tempF) => (REF_TEMP_F + 459.67) / ((Number.isFinite(tempF) ? tempF : REF_TEMP_F) + 459.67);

  // Typical game-time temperature (F) by park; roofed parks are climate controlled when closed.
  const PARK_TEMP = {
    angels: 74, brewers: 72, cardinals: 78, braves: 79, yankees: 70, cubs: 68, mariners: 64, rays: 72, twins: 68,
    athletics: 70, 'blue-jays': 68, 'white-sox': 71, guardians: 66, pirates: 69, padres: 68, giants: 62,
    nationals: 74, marlins: 82, royals: 72, reds: 73, rangers: 85, 'red-sox': 66, dodgers: 72, astros: 82,
    rockies: 68, tigers: 67, phillies: 73, mets: 71, diamondbacks: 90, orioles: 70
  };

  function parkEnv(park) {
    if (typeof require === 'function' && !root.PARK_ENV) {
      try { require('./park-walls.js'); } catch (error) { /* no weather data */ }
    }
    return (root.PARK_ENV && root.PARK_ENV[park.id]) || { alt: 0, cf: 0, roof: 'open', from: 270, mph: 8 };
  }

  // Wind in field coordinates (mph; x toward right field, y toward center field) from a compass FROM bearing.
  function windVector(speed, fromBearing, cfBearing) {
    const rel = (fromBearing + 180 - cfBearing) * Math.PI / 180;
    return { x: speed * Math.sin(rel), y: speed * Math.cos(rel) };
  }

  function windText(w) {
    if (Math.hypot(w.x, w.y) < 0.5) return 'calm';
    const rel = (Math.atan2(w.x, w.y) * 180 / Math.PI + 360) % 360;
    const labels = ['out to center', 'out to right-center', 'left to right', 'in from left-center', 'in from center', 'in from right-center', 'right to left', 'out to left-center'];
    return labels[Math.round(rel / 45) % 8];
  }

  /* ------------------------------------------------------------ game weather */

  // weather: { mode: 'calm'|'fixed'|'random'|'park', speed, from, variation: 'steady'|'gusty'|'inning',
  //            altitude (ft, optional), roof: 'open'|'closed' }
  function makeEnv(park, weather, rng) {
    const w = weather || {};
    const info = parkEnv(park);
    const alt = Number.isFinite(Number(w.altitude)) && w.altitude !== '' && w.altitude !== null && w.altitude !== undefined ? Number(w.altitude) : info.alt;
    const indoors = info.roof === 'dome' || (info.roof === 'retractable' && w.roof !== 'open');
    const tmode = ['fixed', 'random', 'park'].includes(w.tempMode) ? w.tempMode : 'standard';
    let temp = REF_TEMP_F;
    if (tmode === 'fixed') temp = Number.isFinite(Number(w.temp)) && w.temp !== '' && w.temp !== null ? Number(w.temp) : REF_TEMP_F;
    else if (indoors) temp = 72;
    else if (tmode === 'random') temp = Math.round(rng.between(40, 100));
    else if (tmode === 'park') temp = Math.round(clamp((PARK_TEMP[park.id] || 70) + 9 * rng.gauss(), 30, 110));
    const env = {
      alt,
      temp,
      rho: airDensity(alt) * tempFactor(temp),
      cf: info.cf,
      roofType: info.roof,
      roofOpen: info.roof === 'retractable' && w.roof === 'open',
      mode: ['fixed', 'random', 'park'].includes(w.mode) ? w.mode : 'calm',
      variation: ['gusty', 'inning'].includes(w.variation) ? w.variation : 'steady',
      fixed: { speed: Math.max(0, Number(w.speed) || 0), from: ((Number(w.from) || 0) % 360 + 360) % 360 },
      base: { speed: 0, from: 0 },
      inningKey: null
    };
    rollBaseWind(env, info, rng, false);
    return env;
  }

  function rollBaseWind(env, info, rng, jitterOnly) {
    if (env.mode === 'fixed') {
      env.base = jitterOnly
        ? { speed: Math.max(0, env.fixed.speed * (1 + 0.3 * rng.gauss())), from: (env.fixed.from + 30 * rng.gauss() + 360) % 360 }
        : { ...env.fixed };
    } else if (env.mode === 'random') {
      env.base = { speed: rng.between(0, 20), from: rng.between(0, 360) };
    } else if (env.mode === 'park') {
      const from = rng.chance(0.25) ? rng.between(0, 360) : (info.from + 55 * rng.gauss() + 360) % 360;
      env.base = { speed: clamp(info.mph * (1 + 0.55 * rng.gauss()), 0, 35), from };
    } else env.base = { speed: 0, from: 0 };
  }

  // Wind (field coordinates, mph) for the next batted ball.
  function windNow(g, steady) {
    const env = g.env;
    if (!env || env.mode === 'calm') return { x: 0, y: 0 };
    if (env.roofType === 'dome' || (env.roofType === 'retractable' && !env.roofOpen)) return { x: 0, y: 0 };
    if (env.variation === 'inning' && env.inningKey !== g.inning) {
      rollBaseWind(env, parkEnv(g.park), g.rng, true);
      env.inningKey = g.inning;
    }
    let { speed, from } = env.base;
    if (env.variation === 'gusty' && !steady) {
      speed = Math.max(0, speed * (1 + 0.22 * g.rng.gauss()) + 1.5 * g.rng.gauss());
      from = (from + 14 * g.rng.gauss() + 360) % 360;
    }
    return windVector(speed, from, env.cf);
  }

  // Spin from the swing: backspin follows launch angle, sidespin curves toward the nearest foul line
  // (hooks on the pull side, slices the other way).
  function spinFor(g, c, pullSign) {
    const q = c.q == null ? 0.8 : c.q;
    const rng = g.rng;
    let b = c.la >= 0 ? clamp(0.88 + 0.005 * c.la, 0.5, 1.15) : clamp(0.88 + 0.03 * c.la, -0.8, 0.88);
    if (c.la > 50) b = 1.3;
    b += rng.gauss() * 0.12 * (1.1 - q);
    const side = c.dir < 0 ? -1 : 1;
    const pullSide = pullSign && side === pullSign ? 1.3 : 1;
    const s = side * pullSide * (0.04 + 0.07 * Math.min(1, Math.abs(c.dir) / 45) + 0.08 * (1 - q) * Math.abs(rng.gauss())) + 0.02 * rng.gauss();
    return { b, s };
  }

  const flyOf = (g, c, extra) => ({ spin: c.spin, wind: c.wind, rho: g.env ? g.env.rho : 1, ...extra });

  // Gives a batted ball its spin and wind, and aims it so the spin curve ends on the intended spray angle.
  function prepBall(g, c, pullSign) {
    if (c.spin) return c;
    c.spin = spinFor(g, c, pullSign);
    c.wind = windNow(g);
    const aim = c.dir;
    const probe = flightSim(c.ev, c.la, aim, g.park, { spin: c.spin, noFence: true });
    if (probe.landing.d >= 90 && Math.abs(aim) < 90) {
      c.dir = aim - clamp(probe.landAngle - aim, -25, 25);
    }
    c.aim = aim;
    return c;
  }

  // Straight-line flight along `dir` degrees. Returns time-stamped points (feet, seconds).
  // opts.spin = { b: backspin, s: sidespin (+ curves toward right field) }, opts.rho = air density ratio,
  // opts.wind = { x, y } mph in field coordinates.
  const settings = { foulOver: false, hrStop: false };

  function flightSim(ev, la, dir, park, opts = {}) {
    const dt = 1 / 120;
    const heading = dir * Math.PI / 180;
    const ux0 = Math.sin(heading);
    const uy0 = Math.cos(heading);
    const radians = la * Math.PI / 180;
    const speed0 = ev * FPS;
    const spin = opts.spin || { b: 1, s: 0 };
    const rho = opts.rho || 1;
    const windX = (opts.wind ? opts.wind.x : 0) * FPS;
    const windY = (opts.wind ? opts.wind.y : 0) * FPS;
    const drag = BALL.drag * rho;
    const lift = BALL.lift * rho;
    let vx = ux0 * speed0 * Math.cos(radians);
    let vy = uy0 * speed0 * Math.cos(radians);
    let vz = speed0 * Math.sin(radians);
    let x = opts.origin ? opts.origin.x : 0;
    let y = opts.origin ? opts.origin.y : 0;
    let z = opts.origin && opts.origin.z !== undefined ? opts.origin.z : BALL.startHeight;
    let t = 0;
    let rolling = false;
    const angleOf = (px, py) => Math.atan2(px, py) * 180 / Math.PI;
    let fair = Math.abs(dir) <= foulLimit(park, dir);
    let landAngle = dir;
    const pts = [{ t, x, y, z }];
    let firstLand = -1;
    let wallHit = -1;
    let hr = false;
    let pole = false;
    let grd = false;
    let escaped = false;
    let landing = null;
    let pending = false;
    const baseDepth = (px) => 90 * Math.cos(foulLimit(park, px) * Math.PI / 180);
    let fence = Infinity;
    let past = false;
    let wallHeight = wallAt(park, dir);
    while (t < 14) {
      t += dt;
      let nz = z;
      if (!rolling) {
        // Air-relative velocity: wind fades toward the ground.
        const shear = 0.4 + 0.6 * Math.min(1, Math.max(0, z) / 80);
        const rx = vx - windX * shear;
        const ry = vy - windY * shear;
        const rz = vz;
        const speed = Math.hypot(rx, ry, rz);
        // Magnus: spin axis = b * (uy0, -ux0, 0) + s * (0, 0, 1), crossed with the relative velocity.
        const wx = spin.b * uy0;
        const wy = -spin.b * ux0;
        const wz = -spin.s;
        vx += (-drag * speed * rx + lift * speed * (wy * rz - wz * ry)) * dt;
        vy += (-drag * speed * ry + lift * speed * (wz * rx - wx * rz)) * dt;
        vz += (-BALL.g - drag * speed * rz + lift * speed * (wx * ry - wy * rx)) * dt;
        nz = z + vz * dt;
      } else {
        const h = Math.hypot(vx, vy);
        const slowed = Math.max(0, h - (7 + 0.5 * h) * dt);
        if (slowed <= 3) break;
        vx *= slowed / h;
        vy *= slowed / h;
      }
      const nx = x + vx * dt;
      const ny = y + vy * dt;
      const here = angleOf(nx, ny);
      const boundary = opts.noFence || past ? null : boundaryHit(park, here);
      let reach = opts.noFence || past ? Infinity : boundary ? boundary.feet : boundaryAt(park, here);
      if (!opts.thrown && !past && !opts.noFence && firstLand < 0 && !rolling && (opts.foulOver ?? settings.foulOver)) {
        const lim = foulLimit(park, here);
        const wallDist = reach;
        const miss = wallDist * Math.abs(Math.abs(here) - lim) * Math.PI / 180;
        if (Math.abs(here) > lim && miss > FOUL_POLE_REACH && Math.hypot(nx, ny) >= wallDist && nx * vx + ny * vy > 0 && Math.max(z, nz) > 8) {
          past = true;
          reach = Infinity;
        }
      }
      const radial = nx * vx + ny * vy;
      const crossing = opts.noFence || past ? null : traceBoundary(park, x, y, nx - x, ny - y, 1);
      if (crossing || (Math.hypot(nx, ny) >= reach && radial > 0)) {
        const crossAngle = crossing ? angleOf(crossing.x, crossing.y) : here;
        fence = crossing ? Math.hypot(crossing.x, crossing.y) : reach;
        const limit = foulLimit(park, crossAngle);
        const crossFair = Math.abs(crossAngle) <= limit;
        wallHeight = crossing ? crossing.height : boundary ? boundary.height : crossFair || Math.abs(here) <= limit + 1 ? wallAt(park, here) : 8;
        const crossZ = rolling ? 0 : crossing ? z + (nz - z) * crossing.feet : Math.max(z, nz);
        const poleMiss = fence * Math.abs(Math.abs(crossAngle) - limit) * Math.PI / 180;
        if (opts.thrown && crossZ > wallHeight) {
          escaped = true;
          pts.push({ t, x: nx, y: ny, z: nz });
          break;
        }
        if (crossZ > wallHeight && firstLand < 0) {
          landAngle = crossAngle;
          if (crossFair || poleMiss <= FOUL_POLE_REACH) {
            fair = crossFair;
            hr = true;
            pole = !crossFair;
          } else {
            fair = false;
          }
          pts.push({ t, x: nx, y: ny, z: nz });
          break;
        }
        if (crossZ > wallHeight && firstLand >= 0 && fair) {
          // A fair ball that bounced and left the park is a ground-rule double.
          grd = true;
          pts.push({ t, x: nx, y: ny, z: nz });
          break;
        }
        if (firstLand < 0) {
          fair = crossFair;
          landAngle = crossAngle;
        }
        // Reflect off the actual segment, including the angled walls at park corners.
        const r = Math.hypot(nx, ny);
        const nxu = nx / r;
        const nyu = ny / r;
        const normalX = crossing ? crossing.nx : boundary ? boundary.nx : nxu;
        const normalY = crossing ? crossing.ny : boundary ? boundary.ny : nyu;
        const vr = vx * normalX + vy * normalY;
        const tx = vx - vr * normalX;
        const ty = vy - vr * normalY;
        vx = tx * 0.6 - 0.35 * vr * normalX;
        vy = ty * 0.6 - 0.35 * vr * normalY;
        vz *= 0.7;
        const beforeWall = crossing ? Math.max(0, crossing.feet - 0.05 / Math.max(0.05, Math.hypot(nx - x, ny - y))) : 0;
        x = crossing ? x + (nx - x) * beforeWall : nxu * (reach - 0.3);
        y = crossing ? y + (ny - y) * beforeWall : nyu * (reach - 0.3);
        z = Math.max(0, Math.min(crossZ, wallHeight));
        if (wallHit < 0) wallHit = pts.length;
        pts.push({ t, x, y, z });
        continue;
      }
      if (!rolling && nz <= 0) {
        const fraction = z / (z - nz);
        x += (nx - x) * fraction;
        y += (ny - y) * fraction;
        z = 0;
        if (firstLand < 0) {
          firstLand = pts.length;
          landing = { x, y, t, d: Math.hypot(x, y) };
          landAngle = angleOf(x, y);
          if (y >= baseDepth(x)) {
            fair = Math.abs(landAngle) <= foulLimit(park, landAngle);
          } else {
            // Landed in front of 1st/3rd: fair or foul is settled where it crosses the bag line, or where it stops.
            pending = true;
            fair = y > 0 && Math.abs(landAngle) <= foulLimit(park, landAngle);
          }
        }
        const h = Math.hypot(vx, vy);
        const steep = Math.abs(vz) > h * 0.5;
        const keep = steep ? 0.7 : 0.85;
        vx *= keep;
        vy *= keep;
        vz = -vz * 0.45;
        if (vz < 4) {
          rolling = true;
          vz = 0;
        }
      } else {
        x = nx;
        y = ny;
        z = nz;
      }
      if (pending && !(firstLand === pts.length) && y >= baseDepth(x)) {
        pending = false;
        landAngle = angleOf(x, y);
        fair = Math.abs(landAngle) <= foulLimit(park, landAngle);
      }
      pts.push({ t, x, y, z });
    }
    if (firstLand < 0) {
      firstLand = pts.length - 1;
      const last = pts[firstLand];
      landing = { x: last.x, y: last.y, t: last.t, d: Math.hypot(last.x, last.y) };
      if (!hr) {
        landAngle = angleOf(last.x, last.y);
        fair = last.y >= baseDepth(last.x) ? Math.abs(landAngle) <= foulLimit(park, landAngle) : false;
        pending = false;
      }
    }
    if (pending) {
      const last = pts[pts.length - 1];
      landAngle = angleOf(last.x, last.y);
      fair = last.y > 0 && Math.abs(landAngle) <= foulLimit(park, landAngle);
    }
    if (!isFinite(fence)) fence = fenceAt(park, landAngle);
    const result = { pts, firstLand, landing, wallHit, hr, pole, grd, escaped, fair, dir, landAngle, ev, la, fence, wallHeight };
    if (!opts.thrown) result.lineCall = foulLineCall(result, park, fair);
    return result;
  }

  function foulLineCall(ball, park, ruledFair) {
    const landing = ball.pts[ball.firstLand];
    if (!landing || ball.hr || (ball.wallHit >= 0 && ball.wallHit < ball.firstLand)) return null;
    const depth = point => 90 * Math.cos(foulLimit(park, point.x) * Math.PI / 180);
    let point = landing;
    if (landing.y < depth(landing)) {
      let crossing = null;
      for (let i = ball.firstLand + 1; i < ball.pts.length; i++) {
        const a = ball.pts[i - 1], b = ball.pts[i];
        const da = a.y - depth(a), db = b.y - depth(b);
        if (da < 0 && db >= 0) {
          const u = -da / (db - da);
          crossing = { t: a.t + (b.t - a.t) * u, x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
          break;
        }
      }
      point = crossing || ball.pts[ball.pts.length - 1];
    }
    const angle = foulLimit(park, point.x) * Math.PI / 180;
    const distance = Math.abs(Math.abs(point.x) * Math.cos(angle) - point.y * Math.sin(angle));
    return point.y > 0 && distance <= 3 + 1e-9 ? { t: point.t, x: point.x, y: point.y, label: ruledFair ? 'FAIR!' : 'FOUL!' } : null;
  }

  /* --------------------------------------------------------------- fielding */

  const BASE_XY = [{ x: 0, y: 0 }, { x: 63.64, y: 63.64 }, { x: 0, y: 127.28 }, { x: -63.64, y: 63.64 }];
  const baseXY = (base) => BASE_XY[base % 4];
  const INFIELD = new Set(['P', 'C', '1B', '2B', '3B', 'SS']);
  const POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];

  function defaultSpot(pos, park) {
    const [left, center, right] = park.dims;
    const polar = (distance, degrees) => ({
      x: Math.sin(degrees * Math.PI / 180) * distance,
      y: Math.cos(degrees * Math.PI / 180) * distance
    });
    switch (pos) {
      case 'P': return { x: 0, y: 60.5 };
      case 'C': return { x: 0, y: -3 };
      case '1B': return { x: 66, y: 78 };
      case '2B': return { x: 30, y: 136 };
      case 'SS': return { x: -30, y: 136 };
      case '3B': return { x: -66, y: 78 };
      case 'LF': return polar(left * 0.85, -27);
      case 'CF': return polar(center * 0.8, 0);
      default: return polar(right * 0.85, 27);
    }
  }

  function fieldProfile(player) {
    // SPD sets running range, ARM sets throw velocity, FLD sets tracking and fielding technique.
    // Fielders accelerate like runners do (see RAMP_TIME) but top out a little slower.
    const vmax = 0.88 * 90 / (2.95 - 0.012 * (player.speed - 50));
    const field = Math.max(0, player.field === undefined ? 50 : player.field);
    const tracking = field / (field + 50);
    return {
      speed: vmax * 0.78,
      vmax,
      react: 0.34 + 0.16 * (1 - tracking),
      tracking,
      reach: motion.ARM_REACH,
      height: playerHeight(player),
      ability: motion.profile(player.field === undefined ? 50 : player.field),
      armFps: (70 + 0.45 * (player.arm - 20)) * 1.46667
    };
  }

  const FIELD_RAMP = 2.5;
  const FIELD_R0 = 0.3;
  // Seconds to cover `feet` from a standstill: speed ramps from 30% to full over FIELD_RAMP seconds.
  function fieldTime(fp, feet) {
    if (feet <= 0) return 0;
    const a = fp.vmax * (1 - FIELD_R0) / (2 * FIELD_RAMP);
    const b = fp.vmax * FIELD_R0;
    const rampFeet = fp.vmax * FIELD_RAMP * (FIELD_R0 + (1 - FIELD_R0) / 2);
    if (feet <= rampFeet) return (-b + Math.sqrt(b * b + 4 * a * feet)) / (2 * a);
    return FIELD_RAMP + (feet - rampFeet) / fp.vmax;
  }
  // Share of a run completed after share `u` of its time: starts slow, cruises, eases into the catch.
  const runEase = (u) => 0.5 * u + 0.5 * u * u * (3 - 2 * u);

  /* ------------------------------------------------- defensive positioning */

  // Keeps a point inside the park: the fence in fair ground, the stands in foul ground, the backstop behind the plate.
  function keepInside(park, x, y) {
    const angle = Math.atan2(x, y) * 180 / Math.PI;
    const r = Math.hypot(x, y);
    const wall = boundaryHit(park, angle);
    const inset = wall && r > 0 ? 0.4 / Math.max(0.001, Math.abs((wall.nx * x + wall.ny * y) / r)) : 0.4;
    const limit = Math.max(0, (wall ? wall.feet : boundaryAt(park, angle)) - inset);
    return r > limit && r > 0 ? { x: x * limit / r, y: y * limit / r } : { x, y };
  }

  const COVER_PREF = { 1: ['1B', 'P', '2B'], 2: ['2B', 'SS'], 3: ['3B', 'SS', 'P'], 4: ['C', 'P'] };
  const BACKUP_PREF = { 1: ['RF', 'P'], 2: ['CF', 'RF', 'LF'], 3: ['P', 'LF'], 4: ['P'] };
  const BACKUP_POOL = new Set(['LF', 'CF', 'RF', 'P']);
  const CUTOFF_POOL = new Set(['1B', '2B', '3B', 'SS']);
  const CATCH_PRIORITY = ['CF', 'LF', 'RF', 'SS', '2B', '3B', '1B', 'C', 'P'];

  // Where every fielder who isn't handling the ball should be: covering the bags runners are heading to,
  // lined up as cutoff and trailer on long throws, backing up bases and the fielder, or ready near their spot.
  // c = { park, fielders: [{ pos, x, y, hx, hy, speed }], free: Set(pos), ball: {x, y}, thrower: {x, y} | null,
  //       bases: [base numbers runners are heading to], lead: most advanced of those (0 for none) }
  function supportPlan(c) {
    const out = {};
    const free = c.fielders.filter((f) => c.free.has(f.pos));
    const left = new Set(free.map((f) => f.pos));
    const eta = (f, p) => Math.hypot(f.x - p.x, f.y - p.y) / f.speed;
    const put = (f, p, job) => {
      const spot = keepInside(c.park, p.x, p.y);
      out[f.pos] = { x: spot.x, y: spot.y, job, base: p.base };
      left.delete(f.pos);
    };
    const pick = (pool, p, prefs) => {
      let best = null;
      let bestCost = Infinity;
      for (const f of free) {
        if (!left.has(f.pos) || (pool && !pool.has(f.pos))) continue;
        const rank = prefs ? prefs.indexOf(f.pos) : 0;
        const cost = eta(f, p) + (rank < 0 ? 1.5 : rank * 0.4);
        if (cost < bestCost) {
          bestCost = cost;
          best = f;
        }
      }
      return best;
    };
    const ball = c.ball;
    const ballR = Math.hypot(ball.x, ball.y);
    const outfield = ballR > 150;
    const lead = c.lead || 0;
    const bases = [...new Set([...c.bases, ...(outfield ? [2, 3, 4, 1] : [])])]
      .sort((a, b) => (b === lead) - (a === lead) || b - a);
    const unit = (from, to) => {
      const d = Math.hypot(to.x - from.x, to.y - from.y) || 1;
      return { x: (to.x - from.x) / d, y: (to.y - from.y) / d, d };
    };

    for (const base of bases) {
      if (c.coveredBases && c.coveredBases.includes(base)) continue;
      const f = pick(INFIELD, baseXY(base), COVER_PREF[base]);
      if (f) put(f, { ...baseXY(base), base }, 'cover');
    }

    if (lead && outfield) {
      const target = baseXY(lead);
      const u = unit(target, ball);
      if (u.d > 120) {
        const feet = clamp(u.d * 0.45, 45, 135);
        const spot = { x: target.x + u.x * feet, y: target.y + u.y * feet };
        const prefs = lead === 4 ? (ball.x >= 0 ? ['1B', '2B', 'SS', '3B'] : ['3B', 'SS', '2B', '1B']) : ['SS', '2B', '3B', '1B'];
        const man = pick(CUTOFF_POOL, spot, prefs);
        if (man) {
          put(man, spot, 'cutoff');
          if (u.d > 200) {
            const trailer = pick(CUTOFF_POOL, spot, prefs);
            if (trailer) put(trailer, { x: spot.x - u.x * 30, y: spot.y - u.y * 30 }, 'trailer');
          }
        }
      }
    }

    if (outfield) {
      const u = unit({ x: 0, y: 0 }, ball);
      const back = pick(new Set(['LF', 'CF', 'RF']), { x: ball.x + u.x * 25, y: ball.y + u.y * 25 }, null);
      if (back) put(back, { x: ball.x + u.x * 25, y: ball.y + u.y * 25 }, 'backup');
    }

    const source = c.thrower || ball;
    const backBases = outfield ? (lead ? [lead] : []) : bases.slice(0, 2);
    for (const base of backBases) {
      const t = baseXY(base);
      const u = unit(source, t);
      const spot = { x: t.x + u.x * 24, y: t.y + u.y * 24 };
      const f = pick(BACKUP_POOL, spot, BACKUP_PREF[base]);
      if (f) put(f, spot, 'backup');
    }

    // Everyone else stays ready and drifts toward the action.
    for (const f of free) {
      if (!left.has(f.pos)) continue;
      const pull = f.pos === 'C' ? 0 : INFIELD.has(f.pos) ? 0.12 : 0.18;
      const cap = INFIELD.has(f.pos) ? 18 : 40;
      const dx = (ball.x - f.hx) * pull;
      const dy = (ball.y - f.hy) * pull;
      const k = Math.min(1, cap / (Math.hypot(dx, dy) || 1));
      put(f, { x: f.hx + dx * k, y: f.hy + dy * k }, 'ready');
    }
    return out;
  }

  // Frame-by-frame fielder positions for a simulated play (no live engine behind it).
  // c = { park, fielders: [{ pos, x, y, speed }], pts: ball flight [{t, x, y}], landing, primary: {pos, x, y, t} | null,
  //       throws: [{from, to, release, arrive, receiver}], runners: [{from, to, delay, perBase}], duration }
  function fieldTracks(c) {
    const dt = 0.1;
    const T = Math.max(1, c.duration);
    const ease = runEase;
    const st = c.fielders.map((f) => ({ pos: f.pos, hx: f.x, hy: f.y, x: f.x, y: f.y, speed: f.speed }));
    const by = (pos) => st.find((s) => s.pos === pos);
    const throws = (c.throws || []).slice().sort((a, b) => a.release - b.release);
    const flightEnd = c.pts.length ? c.pts[c.pts.length - 1].t : 0;
    const rest = c.primary ? c.primary.body || { x: c.primary.x, y: c.primary.y } : (c.landing ? keepInside(c.park, c.landing.x, c.landing.y) : { x: 0, y: 60 });
    const pickT = c.primary ? Math.max(0.3, c.primary.t) : flightEnd;
    const windows = {};
    const add = (pos, w) => { (windows[pos] = windows[pos] || []).push(w); };
    if (c.primary) add(c.primary.pos, { ts: 0, te: pickT, tgt: rest, until: throws.length ? throws[0].release : Infinity });
    else {
      let best = null;
      let bestEta = Infinity;
      for (const s of st) {
        const e = Math.hypot(s.x - rest.x, s.y - rest.y) / s.speed;
        if (e < bestEta) { bestEta = e; best = s; }
      }
      if (best) add(best.pos, { ts: 0, te: Math.max(0.3, bestEta), tgt: rest, until: Infinity });
    }
    throws.forEach((th, i) => {
      if (!th.receiver || !by(th.receiver)) return;
      const ts = i === 0 ? pickT : throws[i - 1].arrive;
      add(th.receiver, { ts, te: Math.max(ts + 0.3, th.arrive - 0.2), tgt: { x: th.to.x, y: th.to.y }, base: th.base, until: throws[i + 1] ? throws[i + 1].release : Infinity });
    });
    const started = new Map();
    const ballAt = (t) => {
      if (t <= flightEnd && c.pts.length) {
        let i = 0;
        while (i < c.pts.length - 1 && c.pts[i + 1].t < t) i += 1;
        return { x: c.pts[i].x, y: c.pts[i].y };
      }
      let at = rest;
      for (const th of throws) {
        if (t >= th.release && t <= th.arrive) {
          if (th.points && th.points.length) return trajectoryPoint(th.points, t - th.release);
          const u = (t - th.release) / Math.max(0.05, th.arrive - th.release);
          return { x: th.from.x + (th.to.x - th.from.x) * u, y: th.from.y + (th.to.y - th.from.y) * u };
        }
        if (t > th.arrive) at = { x: th.to.x, y: th.to.y };
      }
      return at;
    };
    const holderAt = (t) => {
      if (t < pickT) return null;
      let at = rest;
      for (const th of throws) {
        if (t >= th.release && t <= th.arrive) return null;
        if (t > th.arrive) at = { x: th.to.x, y: th.to.y };
      }
      return at;
    };
    const headings = (t) => {
      const bases = [];
      for (const r of c.runners || []) {
        const per = r.perBase || 3.3;
        const elapsed = t - (r.delay || 0);
        const prog = r.run ? runDistance(elapsed, 90 / per, r.run.start) / 90 : elapsed / per;
        if (prog >= r.to - r.from || r.from >= r.to) {
          if (!r.out && r.to < 4) bases.push(r.to + 1);
          continue;
        }
        const next = r.from + Math.max(0, Math.floor(prog)) + 1;
        if (next <= Math.min(4, r.to)) bases.push(next);
      }
      return bases;
    };

    const tracks = {};
    st.forEach((s) => { tracks[s.pos] = [[0, +s.x.toFixed(1), +s.y.toFixed(1)]]; });
    let dests = {};
    let nextPlan = 0;
    for (let t = dt; t <= T + 1e-9; t += dt) {
      const free = new Set();
      for (const s of st) {
        if (c.primary && c.primary.route && s.pos === c.primary.pos && t <= pickT) {
          const at = fieldingPosition(c.primary, t);
          s.x = at.x; s.y = at.y;
          continue;
        }
        const w = (windows[s.pos] || []).filter((x) => t > x.ts && t <= x.until).pop();
        if (w) {
          const key = s.pos + w.ts;
          if (!started.has(key)) started.set(key, { x: s.x, y: s.y });
          const from = started.get(key);
          const u = clamp((t - w.ts) / Math.max(0.1, w.te - w.ts), 0, 1);
          s.x = from.x + (w.tgt.x - from.x) * ease(u);
          s.y = from.y + (w.tgt.y - from.y) * ease(u);
        } else free.add(s.pos);
      }
      if (t >= nextPlan) {
        nextPlan = t + 0.2;
        const bases = headings(t);
        const holder = holderAt(t);
        dests = supportPlan({
          park: c.park, fielders: st, free, ball: ballAt(t), thrower: holder,
          bases, lead: bases.length ? Math.max(...bases) : 0,
          coveredBases: st.filter(s => !free.has(s.pos)).flatMap(s => (windows[s.pos] || [])
            .filter(w => t > w.ts && t <= w.until && w.base).map(w => w.base))
        });
      }
      for (const s of st) {
        if (!free.has(s.pos) || !dests[s.pos]) continue;
        const d = dests[s.pos];
        const dist = Math.hypot(d.x - s.x, d.y - s.y);
        const step = s.speed * 0.9 * dt;
        if (dist <= step) { s.x = d.x; s.y = d.y; } else { s.x += (d.x - s.x) / dist * step; s.y += (d.y - s.y) / dist * step; }
      }
      for (const s of st) {
        const p = keepInside(c.park, s.x, s.y);
        s.x = p.x;
        s.y = p.y;
        tracks[s.pos].push([+t.toFixed(2), s.x, s.y]);
      }
    }
    return tracks;
  }

  const fieldSpeed = (player) => fieldProfile(player).speed;

  function throwMotion(fielder, target) {
    const pickup = fielder.pickup;
    if (!pickup) return { prepare: 0, arm: 1, spread: 1, difficulty: 0 };
    const speed = Math.hypot(pickup.vx, pickup.vy);
    const moving = clamp(speed / Math.max(1, fielder.fp.vmax), 0, 1);
    target = target || fielder.throwTarget || baseXY(1);
    const dx = target.x - fielder.x, dy = target.y - fielder.y;
    const distance = Math.hypot(dx, dy);
    const against = speed && distance ? (1 - (pickup.vx * dx + pickup.vy * dy) / (speed * distance)) / 2 : 0;
    const skill = fielder.fp.ability ? 1.5 - fielder.fp.ability.recovery : 0.5;
    const difficulty = clamp((moving * (0.35 + 0.65 * against) + pickup.backhand * 0.3) * (1.1 - 0.35 * skill), 0, 1);
    return { prepare: 0.16 + difficulty * 0.32, arm: 1 - difficulty * 0.3, spread: 1 + difficulty * 2, difficulty };
  }

  const transferSecs = (fielder, target) => {
    const fld = fielder.p && fielder.p.field !== undefined ? fielder.p.field : 50;
    return (fielder.recovery || 0) + Math.max(0.18, (INFIELD.has(fielder.pos) ? 0.55 : 0.78) * (1 - (fld - 50) * 0.01))
      + throwMotion(fielder, target).prepare;
  };

  function throwSpread(fielder, distance, target) {
    return distance * Math.tan(throwAim(fielder, target) * Math.PI / 180);
  }

  function throwAim(fielder, target) {
    const arm = Math.max(0, fielder.p.arm === undefined ? 50 : fielder.p.arm);
    return (0.3 + 3.5 * Math.exp(-arm / 60)) * throwMotion(fielder, target).spread;
  }

  function trajectoryPoint(points, time) {
    let low = 0, high = points.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (points[mid].t <= time) low = mid;
      else high = mid - 1;
    }
    const a = points[low], b = points[Math.min(low + 1, points.length - 1)];
    const u = clamp((time - a.t) / Math.max(1e-9, b.t - a.t), 0, 1);
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u };
  }

  const throwPlans = new Map();
  function throwPlan(speed, distance) {
    if (distance <= 0) return { angle: 0, duration: 0, bounced: false };
    const key = `${speed.toFixed(1)}:${distance.toFixed(0)}`;
    if (throwPlans.has(key)) return throwPlans.get(key);
    const park = parkById('dodgers');
    const fly = angle => flightSim(speed / FPS, angle, 0, park,
      { noFence: true, thrown: true, origin: { x: 0, y: 0, z: 5 }, spin: { b: 0, s: 0 } });
    const arrival = flight => {
      const index = flight.pts.findIndex(p => p.y >= distance);
      if (index < 1) return null;
      const a = flight.pts[index - 1], b = flight.pts[index];
      const u = (distance - a.y) / (b.y - a.y);
      return { t: a.t + (b.t - a.t) * u, z: a.z + (b.z - a.z) * u, bounced: index >= flight.firstLand };
    };
    // Find the low, on-the-fly solution at a fixed release speed. If unreachable, use the quickest skip.
    let low = -5, high = 40, best = null;
    for (let i = 0; i < 12; i++) {
      const angle = (low + high) / 2, at = arrival(fly(angle));
      if (at && !at.bounced && at.z >= 4) {
        high = angle; best = { angle, duration: at.t, bounced: false };
      } else low = angle;
    }
    if (!best) {
      let farthest = -Infinity, fallback;
      for (let angle = 5; angle <= 40; angle += 5) {
        const flight = fly(angle), at = arrival(flight);
        const last = flight.pts[flight.pts.length - 1];
        if (at && (!best || at.t < best.duration)) best = { angle, duration: at.t, bounced: true };
        if (last.y > farthest) {
          farthest = last.y;
          fallback = { angle, duration: last.t + Math.max(0, distance - last.y) / 20 + 0.4, bounced: true };
        }
      }
      if (!best) best = fallback;
    }
    if (throwPlans.size >= 2048) throwPlans.clear();
    throwPlans.set(key, best);
    return best;
  }

  function throwFlight(fielder, target, park, rng, env = {}) {
    const speed = fielder.fp.armFps * throwMotion(fielder, target).arm;
    const distance = Math.hypot(target.x - fielder.x, target.y - fielder.y);
    const plan = throwPlan(speed, distance);
    const arm = Math.max(0, fielder.p.arm === undefined ? 50 : fielder.p.arm);
    const perfect = rng ? rng.chance(0.01 + 0.07 * (arm / (arm + 50)) ** 2) : true;
    const sd = throwAim(fielder, target);
    const directionError = perfect ? 0 : rng.gauss() * sd;
    const angleError = perfect ? 0 : rng.gauss() * sd * 0.65;
    const dir = Math.atan2(target.x - fielder.x, target.y - fielder.y) * 180 / Math.PI + directionError;
    const flight = flightSim(speed / FPS, plan.angle + angleError, dir, park, {
      ...env, thrown: true, origin: { x: fielder.x, y: fielder.y, z: 5 }, spin: { b: 0, s: 0 }
    });
    return { ...flight, speed, directionError, angleError, perfect, target: { ...target }, duration: plan.duration };
  }

  function cutoffPlan(h, target, fielders, excluded) {
    const distance = Math.hypot(h.x - target.x, h.y - target.y);
    if (distance < 140) return null;
    const direct = flightSecs(h, distance, target);
    let best = null;
    for (const f of fielders) {
      if (f === h || f === excluded || !INFIELD.has(f.pos) || f.pos === 'C' || f.pos === 'P') continue;
      const ux = (h.x - target.x) / distance, uy = (h.y - target.y) / distance;
      const along = clamp((f.x - target.x) * ux + (f.y - target.y) * uy, distance * 0.25, distance * 0.75);
      const mid = { x: target.x + ux * along, y: target.y + uy * along };
      const relayFielder = { ...f, ...mid, pickup: null, recovery: 0 };
      const first = flightSecs(h, Math.hypot(h.x - mid.x, h.y - mid.y), mid);
      const ready = Math.hypot(f.x - mid.x, f.y - mid.y) / f.fp.speed;
      if (ready > first + 0.15) continue;
      const via = first + transferSecs(relayFielder, target)
        + flightSecs(relayFielder, Math.hypot(mid.x - target.x, mid.y - target.y), target);
      if (!best || via < best.via) best = { man: f, mid, via, saves: direct - via };
    }
    return best;
  }

  function resolvedThrow(g, h, target, base, release, receiver, wind) {
    const flight = throwFlight(h, target, g.park, g.rng, { wind, rho: g.env ? g.env.rho : 1 });
    const pose = motion.pose(null, 0, receiver.fp.height);
    let catchPoint = null;
    for (const p of flight.pts) {
      const travel = receiver.fp.speed * Math.max(0, p.t - Math.max(0.15, flight.duration - 0.5));
      const distance = Math.hypot(p.x - target.x, p.y - target.y);
      if (p.t > 0.05 && motion.canReach(pose, Math.max(0, distance - travel), 0, p.z)) {
        catchPoint = p;
        break;
      }
    }
    const point = catchPoint || flight.pts[flight.pts.length - 1];
    const miss = Math.hypot(point.x - target.x, point.y - target.y);
    const recover = catchPoint ? 0 : miss / receiver.fp.speed + 0.35;
    const arrive = release + point.t + recover;
    return {
      from: { x: h.x, y: h.y }, to: { x: point.x, y: point.y }, base, release, arrive,
      ready: arrive + miss / receiver.fp.speed, receiver: receiver.pos, thrower: h.pos, wild: miss > 16 || flight.escaped, escaped: flight.escaped,
      points: flight.pts.filter(p => p.t <= point.t),
      speed: flight.speed, directionError: flight.directionError, angleError: flight.angleError
    };
  }

  function observedBall(ball, index, fp) {
    const pts = ball.pts, now = pts[index].t;
    const skill = fp.tracking === undefined ? 0.5 : fp.tracking;
    const lag = 0.04 + (1 - skill) * 0.08;
    let seen = index;
    while (seen > 0 && pts[seen].t > now - lag) seen--;
    let before = seen;
    while (before > 0 && pts[seen].t - pts[before].t < 0.1) before--;
    let earlier = before;
    while (earlier > 0 && pts[before].t - pts[earlier].t < 0.1) earlier--;
    const p = pts[seen], a = pts[before], b = pts[earlier];
    const dt = Math.max(1 / 120, p.t - a.t), prevDt = Math.max(1 / 120, a.t - b.t);
    let vx = (p.x - a.x) / dt, vy = (p.y - a.y) / dt, vz = (p.z - a.z) / dt;
    const span = (dt + prevDt) / 2;
    const smooth = earlier < before && b.z > 0 && a.z > 0 && p.z > 0;
    const ax = smooth ? (vx - (a.x - b.x) / prevDt) / span : 0;
    const ay = smooth ? (vy - (a.y - b.y) / prevDt) / span : 0;
    const az = smooth ? (vz - (a.z - b.z) / prevDt) / span : -BALL.g;
    if (smooth && az < 0) {
      vx += ax * dt / 2; vy += ay * dt / 2; vz += az * dt / 2;
    }
    return { x: p.x, y: p.y, z: p.z, vx, vy, vz, ax, ay, az, age: now - p.t, skill };
  }

  // Infer drag and curvature from already-seen motion, never from future flight samples.
  function projectRead(read, seconds = 8) {
    let { x, y, z, vx, vy, vz } = read;
    const speed = Math.hypot(vx, vy, vz), cube = Math.max(1, speed ** 3);
    const ax = read.ax, ay = read.ay, az = read.az + BALL.g;
    const drag = clamp(-(ax * vx + ay * vy + az * vz) / cube, 0, 0.004);
    const wx = (vy * az - vz * ay) / cube;
    const wy = (vz * ax - vx * az) / cube;
    const wz = (vx * ay - vy * ax) / cube;
    let t = 0;
    while (t < seconds && z > 0) {
      const dt = Math.min(1 / 60, seconds - t), v = Math.hypot(vx, vy, vz);
      const nx = vx + v * (-drag * vx + wy * vz - wz * vy) * dt;
      const ny = vy + v * (-drag * vy + wz * vx - wx * vz) * dt;
      const nz = vz + (-BALL.g + v * (-drag * vz + wx * vy - wy * vx)) * dt;
      const nextZ = z + nz * dt;
      const step = nextZ < 0 ? dt * z / (z - nextZ) : dt;
      x += nx * step; y += ny * step; z = Math.max(0, z + nz * step);
      vx = nx; vy = ny; vz = nz; t += dt;
    }
    return { x, y, z };
  }

  function trackingWallPressure(fielder, target, park) {
    if (!park) return 0;
    const clearance = point => {
      const radius = Math.hypot(point.x, point.y);
      if (!radius) return Infinity;
      const angle = Math.atan2(point.x, point.y) * 180 / Math.PI;
      const wall = boundaryHit(park, angle);
      return wall ? (wall.feet - radius) * Math.abs((wall.nx * point.x + wall.ny * point.y) / radius)
        : boundaryAt(park, angle) - radius;
    };
    // Use only the observed projection and the fielder's position, not the actual future wall hit.
    return clamp(1 - Math.min(clearance(fielder), clearance(target)) / 30, 0, 1);
  }

  function trackingReadInterval(skill, wallPressure) {
    return 0.05 + (1 - skill) * 0.08 + wallPressure * (0.02 + (1 - skill) * 0.06);
  }

  function readTarget(read, fielder, time, park) {
    const distance = Math.hypot(read.x - fielder.x, read.y - fielder.y);
    const horizontalSpeed2 = read.vx * read.vx + read.vy * read.vy;
    const approach = horizontalSpeed2 > 1
      ? ((fielder.x - read.x) * read.vx + (fielder.y - read.y) * read.vy) / horizontalSpeed2 - read.age : 0;
    const airborne = read.z > 7 || read.vz > 8;
    const horizon = clamp(approach, 0.08, 2.5);
    const lead = horizon + read.age;
    const drift = (1 - Math.exp(-0.12 * lead)) / 0.12;
    const target = airborne ? projectRead(read) : { x: read.x + read.vx * drift, y: read.y + read.vy * drift };
    const wallPressure = trackingWallPressure(fielder, target, park);
    const uncertainty = (0.3 + wallPressure * 0.7) * (1 - read.skill) ** 2
      * Math.min(12, distance * 0.06) / (1 + time * 0.8);
    if (airborne) {
      const falling = (read.vz + Math.sqrt(read.vz * read.vz + 2 * BALL.g * Math.max(0, read.z))) / BALL.g;
      const coarseDrift = (1 - Math.exp(-0.12 * (Math.min(3, falling) + read.age))) / 0.12;
      // Weaker readers lean on coarse extrapolation longer before trusting the observed curve.
      const doubt = (0.08 + wallPressure * 0.32) * (1 - read.skill) / (1 + time * 0.3);
      target.x += (read.x + read.vx * coarseDrift - target.x) * doubt;
      target.y += (read.y + read.vy * coarseDrift - target.y) * doubt;
    }
    return {
      x: target.x + Math.sin(time * 2.1) * uncertainty,
      y: target.y + Math.cos(time * 1.7) * uncertainty,
      wallPressure
    };
  }

  function readFieldingRoutes(ball, fielders, park) {
    const paths = {};
    for (const fielder of fielders) {
      const f = { ...fielder, vx: 0, vy: 0, target: { x: fielder.x, y: fielder.y } };
      const track = [[0, f.x, f.y, 0, 0]];
      let nextRead = f.fp.react;
      for (let index = 1; index < ball.pts.length; index++) {
        const time = ball.pts[index].t;
        const dt = time - ball.pts[index - 1].t;
        if (time >= nextRead) {
          const read = observedBall(ball, index, f.fp);
          f.target = readTarget(read, f, time, park);
          nextRead = time + trackingReadInterval(read.skill, f.target.wallPressure);
        }
        if (time >= f.fp.react) {
          const dx = f.target.x - f.x, dy = f.target.y - f.y, distance = Math.hypot(dx, dy);
          const desired = Math.min(f.fp.vmax, distance / Math.max(0.12, dt));
          const ax = (distance ? dx / distance * desired : 0) - f.vx;
          const ay = (distance ? dy / distance * desired : 0) - f.vy;
          const change = Math.hypot(ax, ay), scale = Math.min(1, f.fp.vmax * 1.4 * dt / Math.max(1e-9, change));
          f.vx += ax * scale; f.vy += ay * scale;
          const x = f.x + f.vx * dt, y = f.y + f.vy * dt;
          const next = park ? keepInside(park, x, y) : { x, y };
          f.vx = (next.x - f.x) / dt; f.vy = (next.y - f.y) / dt;
          f.x = next.x; f.y = next.y;
        }
        track.push([time, f.x, f.y, f.vx, f.vy]);
      }
      paths[f.pos] = track;
    }
    return paths;
  }

  function routePoint(route, time) {
    let low = 0, high = route.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (route[mid][0] <= time) low = mid;
      else high = mid - 1;
    }
    const a = route[low], b = route[Math.min(low + 1, route.length - 1)];
    const u = clamp((time - a[0]) / Math.max(1e-9, b[0] - a[0]), 0, 1);
    return { x: a[1] + (b[1] - a[1]) * u, y: a[2] + (b[2] - a[2]) * u };
  }

  function fieldingPosition(primary, time) {
    const route = primary.route;
    const at = routePoint(route, time);
    const last = route[route.length - 1];
    const start = primary.move ? primary.move.start : last[0];
    if (time > start) {
      const end = routePoint(route, primary.t);
      const u = clamp((time - start) / Math.max(0.01, primary.t - start), 0, 1);
      at.x += (primary.body.x - end.x) * u;
      at.y += (primary.body.y - end.y) * u;
    }
    return at;
  }

  // Who covers a base for a throw from `from`.
  function receiverFor(base, from) {
    switch (base % 4) {
      case 1: return from === '1B' ? 'P' : '1B';
      case 2: return from === '2B' ? 'SS' : '2B';
      case 3: return from === '3B' ? 'SS' : '3B';
      default: return 'C';
    }
  }

  // First moment a fielder can be at the ball: reaction + running time (minus glove reach) <= ball time.
  function fieldBall(ball, fielders, opts = {}) {
    const pts = ball.pts;
    const routes = Number.isFinite(ball.ev) ? readFieldingRoutes(ball, fielders, opts.park) : null;
    const last = opts.airOnly ? Math.min(ball.firstLand - 1, ball.wallHit < 0 ? pts.length - 1 : ball.wallHit - 1) : pts.length - 1;
    function intercept(standingOnly, limit = last, calledFielder = null) {
      for (let index = 1; index <= limit; index += 1) {
        const point = pts[index];
        if (opts.region && !opts.region(point)) continue;
        let best = null;
        let bestNeed = Infinity;
        let bestPlan = null;
        for (const fielder of fielders) {
          if (calledFielder && fielder !== calledFielder) continue;
          const at = routes && routes[fielder.pos][index];
          let plan;
          if (at) {
            const standing = motion.pose(null, point.t, fielder.fp.height);
            if (motion.canReach(standing, point.x - at[1], point.y - at[2], point.z)) {
              plan = { need: point.t, body: { x: at[1], y: at[2] }, move: null };
            } else if (!standingOnly) {
              const local = { ...fielder, x: at[1], y: at[2] };
              plan = fieldingPlan(local, point);
              if (plan && !plan.move) plan = null;
              if (plan && plan.move) {
                const startIndex = Math.max(0, Math.floor(plan.move.start * 120));
                const read = observedBall(ball, Math.min(index, startIndex), fielder.fp);
                const ahead = point.t - (pts[Math.min(index, startIndex)].t - read.age);
                const predicted = read.z > 0 ? projectRead(read, ahead)
                  : { x: read.x + read.vx * ahead, y: read.y + read.vy * ahead, z: 0 };
                if (Math.abs(predicted.z - point.z) > 2 || Math.hypot(predicted.x - point.x, predicted.y - point.y) > 5
                  || Math.hypot(plan.body.x - at[1], plan.body.y - at[2]) > fielder.fp.ability.dive) plan = null;
              }
            }
          } else plan = fieldingPlan(fielder, point, standingOnly);
          if (plan && calledFielder) {
            const margin = point.t - fielder.fp.react
              - fieldTime(fielder.fp, Math.max(0, Math.hypot(plan.body.x - fielder.x, plan.body.y - fielder.y) - fielder.fp.reach));
            if (plan.move || margin < 0.3 || (!INFIELD.has(fielder.pos) && Math.hypot(point.x, point.y) < 140)) plan = null;
          }
          if (plan && plan.need < bestNeed) {
            bestNeed = plan.need;
            best = fielder;
            bestPlan = plan;
          }
        }
        if (bestNeed <= point.t) {
          const air = index < ball.firstLand && (ball.wallHit < 0 || index < ball.wallHit);
          const at = routes && routes[best.pos][index];
          const pickup = { vx: at ? at[3] : 0, vy: at ? at[4] : 0,
            backhand: (point.x - bestPlan.body.x) * (best.p.throws === 'L' ? -1 : 1) > 0.8 ? 1 : 0 };
          return { f: best, index, t: point.t, x: point.x, y: point.y, z: point.z, air, body: bestPlan.body, move: bestPlan.move, routes, pickup };
        }
      }
      return null;
    }
    let standing = intercept(true);
    if (!standing && !opts.airOnly) {
      const rest = pts[pts.length - 1];
      let best = null;
      let bestNeed = Infinity;
      for (const fielder of fielders) {
        const need = fielder.fp.react + fieldTime(fielder.fp, Math.hypot(rest.x - fielder.x, rest.y - fielder.y) - fielder.fp.reach);
        if (need < bestNeed) {
          bestNeed = need;
          best = fielder;
        }
      }
      if (routes) {
        bestNeed = Infinity;
        for (const fielder of fielders) {
          const at = routes[fielder.pos][pts.length - 1];
          const need = rest.t + Math.hypot(rest.x - at[1], rest.y - at[2]) / fielder.fp.speed;
          if (need < bestNeed) { bestNeed = need; best = fielder; }
        }
      }
      standing = { f: best, index: pts.length - 1, t: Math.max(bestNeed, rest.t), x: rest.x, y: rest.y, z: 0, air: false, body: { x: rest.x, y: rest.y }, move: null, routes };
    }
    if (standing && standing.air) {
      const airLast = Math.min(last, ball.firstLand - 1, ball.wallHit < 0 ? last : ball.wallHit - 1);
      const candidates = [standing];
      for (const pos of CATCH_PRIORITY) {
        if (pos === standing.f.pos) continue;
        const fielder = fielders.find(f => f.pos === pos);
        if (!fielder) continue;
        const called = intercept(true, airLast, fielder);
        if (called) candidates.push(called);
      }
      const claims = candidates.map(candidate => {
        const route = routes && routes[candidate.f.pos];
        let settledAt = null;
        if (route) {
          for (let index = 1; index <= candidate.index; index++) {
            const at = route[index];
            const read = observedBall(ball, index, candidate.f.fp);
            const target = readTarget(read, { ...candidate.f, x: at[1], y: at[2] }, at[0], opts.park);
            const settled = Math.hypot(at[3], at[4]) <= 6
              && Math.hypot(target.x - at[1], target.y - at[2]) <= 6;
            settledAt = settled ? (settledAt === null ? at[0] : settledAt) : null;
          }
        } else if (Math.hypot(candidate.body.x - candidate.f.x, candidate.body.y - candidate.f.y) <= 6) {
          settledAt = candidate.f.fp.react;
        }
        return { candidate, at: settledAt !== null && candidate.t - settledAt >= 0.45 ? settledAt : Infinity };
      }).sort((a, b) => a.at - b.at);
      // A clear, settled caller owns the catch; positional priority only resolves overlapping claims.
      if (Number.isFinite(claims[0].at) && (claims.length === 1 || claims[1].at - claims[0].at > 0.2)) {
        return claims[0].candidate;
      }
      for (const pos of CATCH_PRIORITY) {
        const candidate = candidates.find(c => c.f.pos === pos);
        if (candidate) return candidate;
      }
      return standing;
    }
    const active = intercept(false, standing ? standing.index : last);
    // Leave the ground only to save a catch or beat an upright pickup after recovery.
    if (active && (!standing || active.air || (active.move ? active.move.end : active.t) < standing.t)) return active;
    return standing;
  }

  function fieldingPlan(fielder, point, standingOnly = false) {
    const dx = point.x - fielder.x, dy = point.y - fielder.y;
    const distance = Math.hypot(dx, dy);
    const ux = distance ? dx / distance : 0, uy = distance ? dy / distance : 1;
    const fp = fielder.fp;
    for (const kind of standingOnly ? [null] : [null, 'jump', 'dive']) {
      const move = kind ? motion.action(kind, point.t, fp.ability, ux, uy) : null;
      if (move && move.start < fp.react) continue;
      const pose = motion.pose(move, point.t, fp.height);
      const reach = motion.reach(pose, point.z);
      if (!motion.canReach(pose, ux * reach, uy * reach, point.z)) continue;
      const lunge = kind === 'dive' ? fp.ability.dive * Math.max(0, 1 - fp.ability.timing / 0.25) : 0;
      const feet = Math.max(0, distance - reach);
      const need = fp.react + fieldTime(fp, Math.max(0, feet - lunge));
      if (need > point.t) continue;
      const body = { x: fielder.x + ux * feet, y: fielder.y + uy * feet };
      return { need, body, move };
    }
    return null;
  }

  /* ------------------------------------------------------------ pitch model */

  const ZONE = { halfWidth: 0.83, bottom: 1.55, top: 3.45 };
  const PITCH_RADIUS = 0.125;
  const PITCH_TYPES = {
    FB: { name: 'Fastball', dv: 0, move: 0.6, timing: 1.0 },
    SL: { name: 'Slider', dv: -6, move: 1.2, timing: 1.06 },
    CH: { name: 'Changeup', dv: -9, move: 0.9, timing: 1.22 },
    CB: { name: 'Curveball', dv: -14, move: 1.5, timing: 1.14 }
  };
  const DEFAULT_MIX = { FB: 0.52, SL: 0.2, CH: 0.14, CB: 0.14 };

  // Signed ball-to-zone clearance (ft); zero includes a ball touching an edge or corner.
  function zoneDistance(x, z) {
    const dx = Math.abs(x) - ZONE.halfWidth;
    const dz = Math.max(ZONE.bottom - z, z - ZONE.top);
    const ox = Math.max(dx, 0);
    const oz = Math.max(dz, 0);
    const clearance = (ox > 0 || oz > 0 ? Math.hypot(ox, oz) : Math.max(dx, dz)) - PITCH_RADIUS;
    return Math.abs(clearance) < 1e-10 ? 0 : clearance;
  }

  const calledStrikeProb = (distance) => 1 / (1 + Math.exp(distance * 16));

  function pitchLimit(pitcher) {
    return pitcher.role === 'SP' ? 50 + pitcher.stamina : 20 + pitcher.stamina * 0.8;
  }

  function throwPitch(g, pitcher, batter) {
    const rng = g.rng;
    const { balls, strikes } = g.count;
    const limit = pitchLimit(pitcher);
    const fatigue = clamp((pitcher.stat.pc - 0.8 * limit) / (0.4 * limit), 0, 1);
    const weights = { ...(pitcher.mix || DEFAULT_MIX) };
    if (strikes === 2) {
      weights.FB *= 0.75;
      weights.SL *= 1.3;
      weights.CB *= 1.3;
    }
    let roll = rng.next() * Object.values(weights).reduce((sum, value) => sum + value, 0);
    let type = 'FB';
    for (const [key, weight] of Object.entries(weights)) {
      roll -= weight;
      if (roll <= 0) {
        type = key;
        break;
      }
    }
    const mph = pitcher.velo + PITCH_TYPES[type].dv - 3 * fatigue + rng.gauss() * 0.8;
    const chase = balls === 3 ? 0 : strikes === 2 ? 0.5 : 0.14;
    let tx;
    let tz;
    if (rng.chance(chase)) {
      if (rng.chance(0.5)) {
        tx = rng.between(-0.5, 0.5);
        tz = ZONE.bottom - rng.between(0.2, 0.9);
      } else {
        tx = (rng.chance(0.5) ? 1 : -1) * (ZONE.halfWidth + rng.between(0.15, 0.7));
        tz = rng.between(1.8, 3.2);
      }
    } else {
      tx = (rng.chance(0.5) ? 1 : -1) * rng.between(0.1, 0.8);
      tz = rng.between(1.85, 3.15);
    }
    const spread = Math.max(0.12, 0.46 - 0.004 * (pitcher.control - 50)) * (1 + 0.35 * fatigue);
    const x = tx + rng.gauss() * spread;
    const z = tz + rng.gauss() * spread * 0.9;
    return { type, mph, x, z, d: zoneDistance(x, z), hand: pitcher.throws };
  }

  // Typical miss distance (ft) for this pitcher right now, before any user accuracy modifier.
  function pitchSpread(pitcher) {
    const limit = pitchLimit(pitcher);
    const fatigue = clamp((pitcher.stat.pc - 0.8 * limit) / (0.4 * limit), 0, 1);
    return Math.max(0.12, 0.46 - 0.004 * (pitcher.control - 50)) * (1 + 0.35 * fatigue);
  }

  // A pitch the user chose: `aim` is { type, x, z, accuracy } where accuracy scales the miss spread.
  function userPitch(g, pitcher, aim) {
    const rng = g.rng;
    const limit = pitchLimit(pitcher);
    const fatigue = clamp((pitcher.stat.pc - 0.8 * limit) / (0.4 * limit), 0, 1);
    const type = PITCH_TYPES[aim.type] ? aim.type : 'FB';
    const mph = pitcher.velo + PITCH_TYPES[type].dv - 3 * fatigue + rng.gauss() * 0.8;
    const spread = pitchSpread(pitcher) * (aim.accuracy ?? 1);
    const x = aim.x + rng.gauss() * spread;
    const z = aim.z + rng.gauss() * spread * 0.9;
    return { type, mph, x, z, d: zoneDistance(x, z), hand: pitcher.throws, aimed: { x: aim.x, z: aim.z } };
  }

  /* ------------------------------------------------------------- swing model */

  const TIMING_WINDOW = 62;
  const LOC_WINDOW = 2.55;
  const MANUAL_SWINGS = {
    normal: { timing: 125, location: LOC_WINDOW },
    power: { timing: 100, location: 1.65 }
  };
  const manualSwingProfile = (swing) => MANUAL_SWINGS[swing && swing.power ? 'power' : 'normal'];

  // Random swing errors from the batter's contact rating against this pitch.
  function swingMechanics(rng, batter, pitcher, pitch) {
    const type = PITCH_TYPES[pitch.type];
    const speedFactor = Math.pow(pitch.mph / 92, 1.6);
    const sdTiming = Math.max(6, 40 - 0.3 * (batter.contact - 20)) * speedFactor * type.timing;
    const movement = Math.max(0.3, 1 + 0.012 * (pitcher.movement - 50) * type.move / 0.9);
    const sdLoc = Math.max(0.5, 1.6 - 0.011 * (batter.contact - 50)) * movement * (1 + 1.2 * Math.max(0, pitch.d));
    return { timing: rng.gauss() * sdTiming, loc: rng.gauss() * sdLoc };
  }

  function autoSwing(g, batter, pitcher, pitch) {
    const { balls, strikes } = g.count;
    let chance;
    if (pitch.d < 0) {
      chance = 0.67 + 0.06 * (batter.contact - 50) / 30;
      if (strikes === 2) chance += 0.2;
    } else {
      const eyeFactor = (80 - batter.eye) / 60;
      chance = (0.3 + 0.3 * eyeFactor) * Math.exp(-pitch.d * 3.2) * (1 + ((batter.risk || 50) - 50) / 100);
      if (strikes === 2) chance *= 1.3;
    }
    if (balls === 3 && strikes < 2) chance *= 0.35;
    if (balls === 0 && strikes === 0) chance *= 0.85;
    if (!g.rng.chance(clamp(chance, 0.02, 0.97))) return { swing: false };
    return { swing: true, ...swingMechanics(g.rng, batter, pitcher, pitch) };
  }

  const swingQuality = (swing, batter, pitcher, pitch) => {
    const prime = swing.offset && pitch ? primeContactTiming(batter, pitcher, pitch) : 0;
    if (swing.offset) {
      const profile = manualSwingProfile(swing);
      const location = Math.hypot(swing.offset.x, swing.offset.z) * 0.6;
      return 1 - Math.max(Math.abs(swing.timing - prime) / profile.timing, location / profile.location);
    }
    return 1 - Math.hypot((swing.timing - prime) / TIMING_WINDOW, swing.loc / LOC_WINDOW);
  };

  function batSide(batter, pitcher) {
    if (batter.bats === 'S') return pitcher.throws === 'L' ? 'R' : 'L';
    return batter.bats;
  }

  function primeContactTiming(batter, pitcher, pitch) {
    const side = batSide(batter, pitcher) === 'L' ? -1 : 1;
    // Approximate the contact-depth shift as 2.4 feet per lateral foot of pitch location.
    return side * pitch.x * 2.4 / (pitch.mph * 1.46667) * 1000;
  }

  function battedBallFrom(g, batter, pitcher, pitch, swing, quality) {
    const rng = g.rng;
    const pullSign = batSide(batter, pitcher) === 'L' ? 1 : -1;
    const batSpeed = 69 + 0.2 * (batter.power - 50);
    const evMax = 0.2 * pitch.mph + 1.2 * batSpeed;
    if (swing.offset) {
      const { x, z } = swing.offset;
      const profile = manualSwingProfile(swing);
      const centered = clamp(1 - Math.hypot(x, z) / (profile.location / 0.6), 0, 1);
      const timingError = swing.timing - primeContactTiming(batter, pitcher, pitch);
      const timed = Math.exp(-Math.pow(timingError / 90, 2));
      const manualMax = evMax + 9 + 0.05 * (batter.power - 50);
      const powerBoost = swing.power ? Math.exp(0.17 * Math.pow(centered, 0.75) * timed) : 1;
      return {
        ev: manualMax * (0.55 + 0.45 * Math.sqrt(centered)) * timed * powerBoost + rng.between(-2, 2),
        la: 12 - z * 18 + rng.between(-1, 1),
        dir: pullSign * 4 - pullSign * swing.timing * 0.48 - x * 8 + rng.between(-2, 2),
        pullSign
      };
    }
    const q = clamp(quality, 0, 1);
    const ev = evMax * (0.6 + 0.4 * Math.pow(q, 0.75));
    const la = (batter.loft ?? 12) + 12 * swing.loc + rng.gauss() * (8 + 10 * (1 - q));
    const spread = 5 + 14 * (1 - q);
    const dir = pullSign * 4 - pullSign * swing.timing * 1.8 + rng.gauss() * spread;
    return { ev, la, dir, pullSign };
  }

  /* ------------------------------------------------------------ running model */

  const seg = (player) => 3.3 - 0.012 * (player.speed - 50);
  const toFirst = (player) => 0.12 + runTime(90, 90 / seg(player), 0.15);
  const fieldingErrorP = (fielder, air) => 0.012 * Math.max(0.1, 1 + (50 - fielder.p.field) / 40) * (air ? 0.35 : 1);

  /* ---------------------------------------------------------------- game core */

  const DEFAULTS = { contact: 50, power: 50, eye: 50, speed: 50, arm: 50, field: 50, risk: 50 };

  /* Public ratings are 0 and up with no cap (about 50 = MLB average, best players near 100).
     The engine's formulas were tuned on the 20-80 scouting scale, so ratings convert on the way in:
     internal = 50 + (rating - 50) * 0.6. Pitcher velocity rating: 50 = 93 mph, 8 points per mph. */
  const toInternal = (rating) => 50 + (Math.max(0, rating) - 50) * 0.6;
  const veloToMph = (rating) => 93 + (Math.max(0, rating) - 50) / 8;
  const mphToVelo = (mph) => Math.max(0, Math.round(50 + (mph - 93) * 8));
  const rateOr = (value, fallback) => (value !== '' && value != null && Number.isFinite(Number(value)) ? Number(value) : fallback);

  function normalizePlayer(raw, isPitcher) {
    const player = { ...DEFAULTS, bats: 'R', throws: 'R', ...raw };
    player.height = playerHeight(raw);
    player.weight = playerWeight(raw);
    const rt = {};
    for (const key of Object.keys(DEFAULTS)) {
      rt[key] = rateOr(player[key], DEFAULTS[key]);
      player[key] = toInternal(rt[key]);
    }
    if (isPitcher) {
      rt.velo = rateOr(raw.velo, 50);
      rt.control = rateOr(raw.control, 50);
      rt.movement = rateOr(raw.movement, 50);
      rt.stamina = rateOr(raw.stamina, 50);
      rt.field = rateOr(raw.field, 40);
      player.velo = veloToMph(rt.velo);
      player.control = toInternal(rt.control);
      player.movement = toInternal(rt.movement);
      player.stamina = toInternal(rt.stamina);
      player.role = player.role || 'SP';
      player.field = toInternal(rt.field);
      player.stat = { outs: 0, h: 0, r: 0, bb: 0, k: 0, hr: 0, pc: 0, bf: 0 };
    } else {
      player.natural = raw.natural || raw.pos;
      player.stat = { pa: 0, ab: 0, h: 0, d: 0, t: 0, hr: 0, r: 0, rbi: 0, bb: 0, k: 0, sb: 0, cs: 0 };
    }
    player.rt = rt;
    return player;
  }

  function validateTeam(team) {
    const problems = [];
    const positions = team.lineup.map((player) => player.pos);
    for (const pos of POSITIONS) {
      const count = positions.filter((value) => value === pos).length;
      if (count !== 1) problems.push(`${team.name}: needs exactly one ${pos} (has ${count}).`);
    }
    if (positions.filter((value) => value === 'DH').length !== 1) problems.push(`${team.name}: needs exactly one DH.`);
    if (team.lineup.length !== 9) problems.push(`${team.name}: lineup must have 9 batters.`);
    if (!team.pitchers || team.pitchers.length === 0) problems.push(`${team.name}: needs at least one pitcher.`);
    return problems;
  }

  function buildTeam(raw) {
    const lineup = raw.lineup.map((player) => normalizePlayer(player, false));
    lineup.forEach(applyPositionPenalty);
    return {
      name: raw.name || 'Team',
      lineup,
      bench: (raw.bench || []).map((player) => normalizePlayer({ ...player, natural: player.natural || player.pos, pos: 'BN' }, false)),
      removed: [],
      pitchers: raw.pitchers.map((player, index) => normalizePlayer({ role: index === 0 ? 'SP' : 'RP', ...player }, true)),
      order: 0,
      pIdx: 0
    };
  }

  function createGame(config) {
    const problems = [...validateTeam(config.away), ...validateTeam(config.home)];
    if (problems.length) throw new Error(problems.join(' '));
    const rng = makeRng(config.seed);
    const park = parkById(config.park);
    const game = {
      rng,
      park,
      env: makeEnv(park, config.weather, rng),
      innings: config.innings || 9,
      ghost: config.ghost !== false,
      teams: [buildTeam(config.away), buildTeam(config.home)],
      coach: [config.coach && config.coach[0] === 'manual' ? 'manual' : 'sim', config.coach && config.coach[1] === 'manual' ? 'manual' : 'sim'],
      inning: 1,
      half: 0,
      outs: 0,
      bases: [null, null, null],
      count: { balls: 0, strikes: 0 },
      score: [0, 0],
      lineScore: [[], []],
      hits: [0, 0],
      errors: [0, 0],
      log: [],
      over: false,
      winner: null,
      needStart: true,
      pa: null,
      battedBalls: [],
      pitches: 0,
      doublePlays: 0,
      challenges: [{ abs: 2, field: 1 }, { abs: 2, field: 1 }],
      shifts: [{ preset: 'auto', custom: {}, mirror: false }, { preset: 'auto', custom: {}, mirror: false }],
      review: null,
      heldSteal: null
    };
    return game;
  }

  /* ------------------------------------------------------------ umpires and challenges
     Calls the umpire can get wrong: balls/strikes, fair/foul, and safe/out at a base (live plays
     and steals). Each reviewable call is a { id, kind, label, hurt, wrong, flip } entry in g.review.
     The team hurt by the ruling is the one that challenges. An ABS challenge costs a challenge
     only when it fails (2 per team per game); field challenges cost on a failure too (1 per game). */

  const challengeKey = (call) => (call.kind === 'abs' ? 'abs' : 'field');

  function setReview(g, kind, calls) {
    g.review = calls.length ? { kind, calls } : null;
    return g.review;
  }

  function humanHurt(g, call, opts) {
    return !!(opts && opts.human && opts.human[call.hurt] && g.challenges[call.hurt][challengeKey(call)] > 0);
  }

  function challengeCall(g, id) {
    const call = g.review && g.review.calls.find((c) => c.id === id);
    if (!call || call.challenged) return null;
    const left = g.challenges[call.hurt];
    const key = challengeKey(call);
    if (left[key] <= 0) return null;
    call.challenged = true;
    const team = g.teams[call.hurt].name;
    if (call.wrong) {
      call.flip();
      call.note = `${team} challenge ${call.label}: call overturned.`;
    } else {
      left[key] -= 1;
      call.note = `${team} challenge ${call.label}: call stands (${left[key]} ${key === 'abs' ? 'ABS' : 'field'} challenge${left[key] === 1 ? '' : 'es'} left).`;
    }
    call.overturned = !!call.wrong;
    return { overturned: call.overturned, left: { ...left }, note: call.note };
  }

  // The CPU only challenges calls that hurt it. It usually spots a bad call but sometimes misses
  // one, and sometimes burns a challenge on a call that was right.
  function cpuChallenges(g, opts) {
    if (!g.review) return;
    for (const call of g.review.calls) {
      if (call.challenged || (opts && opts.human && opts.human[call.hurt])) continue;
      const left = g.challenges[call.hurt];
      if (left[challengeKey(call)] <= 0) continue;
      const believes = call.wrong ? g.rng.chance(0.72) : g.rng.chance(call.doubt);
      if (believes && g.rng.chance(call.leverage)) challengeCall(g, call.id);
    }
  }

  function logReview(g) {
    if (!g.review) return [];
    const notes = g.review.calls.map((c) => c.note || (c.wrong && !c.challenged ? `Replay: the umpire got ${c.label} wrong.` : null)).filter(Boolean);
    notes.forEach((text) => emit(g, 'info', text));
    return notes;
  }

  function pendingReview(g, opts) {
    if (!g.review) return null;
    const calls = g.review.calls.filter((c) => !c.challenged && humanHurt(g, c, opts));
    if (!calls.length) return null;
    return {
      kind: g.review.kind,
      calls: calls.map((c) => ({ id: c.id, kind: c.kind, label: c.label, team: c.hurt })),
      left: g.challenges.map((c) => ({ ...c }))
    };
  }

  function rollUmp(g, pitch) {
    pitch.truth = pitch.d <= 0 ? 'strike' : 'ball';
    pitch.ump = g.rng.chance(calledStrikeProb(pitch.d)) ? 'strike' : 'ball';
  }

  function absCall(g, pitch) {
    const hurt = pitch.ump === 'strike' ? g.half : 1 - g.half;
    const atStake = pitch.ump === 'ball' ? g.count.balls >= 3 : g.count.strikes >= 2;
    return {
      id: 'abs', kind: 'abs', label: `the ${pitch.ump === 'strike' ? 'called strike' : 'ball'} (ABS)`, hurt,
      wrong: pitch.ump !== pitch.truth,
      flip: () => { pitch.ump = pitch.truth; },
      doubt: 0.04 + 0.25 * Math.exp(-Math.abs(pitch.d) / 0.06),
      leverage: atStake ? 0.9 : 0.4
    };
  }

  const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : Math.min(n % 10, 4) % 4]}`;

  function emit(g, kind, text, extra) {
    const entry = { kind, text, inning: g.inning, half: g.half, outs: g.outs, ...extra };
    g.log.push(entry);
    return entry;
  }

  function battingTeam(g) { return g.teams[g.half]; }
  function fieldingTeam(g) { return g.teams[1 - g.half]; }
  function currentPitcher(g) { const team = fieldingTeam(g); return team.pitchers[team.pIdx]; }
  function currentBatter(g) { const team = battingTeam(g); return team.lineup[team.order % 9]; }

  /* ----------------------------------------------------------------- defensive shifts */

  const SHIFT_PRESETS = {
    none: { name: 'Standard' },
    auto: { name: 'Auto (smart, like the CPU)' },
    infieldIn: { name: 'Infield in' },
    infieldBack: { name: 'Infield back' },
    pull: { name: 'Pull shift (infield)' },
    oppo: { name: 'Oppo shift (infield)' },
    ofDeep: { name: 'Outfield deep' },
    ofShallow: { name: 'Outfield shallow' },
    ofPull: { name: 'Outfield shade to pull' },
    noDoubles: { name: 'No-doubles (OF to lines, deep)' },
    custom: { name: 'Custom' }
  };

  // Feet to move a fielder from his standard spot. `pull` is +1 toward the batter's pull side.
  function presetOffset(preset, pos, pull) {
    const inf = ['1B', '2B', 'SS', '3B'].includes(pos);
    const of = ['LF', 'CF', 'RF'].includes(pos);
    const side = pos === 'LF' || pos === '3B' ? -1 : pos === 'RF' || pos === '1B' ? 1 : 0;
    switch (preset) {
      case 'infieldIn': return inf ? { x: 0, y: -16 } : { x: 0, y: 0 };
      case 'infieldBack': return inf ? { x: 0, y: 12 } : { x: 0, y: 0 };
      case 'pull': return inf ? { x: pull * (pos === 'SS' || pos === '2B' ? 22 : pos === '3B' || pos === '1B' ? 12 : 0), y: 0 } : { x: 0, y: 0 };
      case 'oppo': return inf ? { x: -pull * (pos === 'SS' || pos === '2B' ? 18 : 8), y: 0 } : { x: 0, y: 0 };
      case 'ofDeep': return of ? { x: 0, y: 25 } : { x: 0, y: 0 };
      case 'ofShallow': return of ? { x: 0, y: -22 } : { x: 0, y: 0 };
      case 'ofPull': return of ? { x: pull * 30, y: 0 } : { x: 0, y: 0 };
      case 'noDoubles': return of ? { x: side * 22, y: 18 } : { x: 0, y: 0 };
      default: return { x: 0, y: 0 };
    }
  }

  // CPU positioning from the batter's profile and the game situation.
  function autoOffset(g, pos, batter, hand, teamIdx) {
    const pull = hand === 'L' ? 1 : -1;
    const inf = ['1B', '2B', 'SS', '3B'].includes(pos);
    const of = ['LF', 'CF', 'RF'].includes(pos);
    const defLead = g.score[teamIdx] - g.score[1 - teamIdx];
    const late = g.inning >= g.innings - 2;
    const closeLate = late && defLead <= 1;
    const protect = late && defLead >= 1 && defLead <= 3;
    const pullPower = clamp((batter.power - 45) / 25, 0, 1) * clamp(0.6 + (50 - batter.contact) / 60, 0.3, 1);
    const fast = batter.speed >= 62;
    const o = { x: 0, y: 0 };
    if (inf) {
      const corner = pos === '1B' || pos === '3B';
      o.x += pull * pullPower * (corner ? 6 : 20);
      if (fast) o.y -= 6;
      if (g.bases[0] && g.outs < 2) {
        if (pos === '2B') o.x -= 8;
        if (pos === 'SS') o.x += 8;
        o.y -= 3;
      }
      if (g.bases[2] && g.outs < 2 && (closeLate || g.bases[1] || defLead <= 0)) o.y -= 16;
      else if (corner && (closeLate || protect)) o.x += pos === '1B' ? 8 : -8;
    } else if (of) {
      o.y += 22 * pullPower + (batter.power >= 60 ? 8 : 0) - (batter.power < 40 ? 8 : 0);
      o.x += pull * pullPower * 24;
      if (protect || (late && g.outs < 2 && (g.bases[1] || g.bases[0]))) {
        o.y += 14;
        o.x += pos === 'LF' ? -14 : pos === 'RF' ? 14 : 0;
      }
      if (g.bases[2] && g.outs < 2 && defLead <= 0 && closeLate) o.y -= 12;
    }
    return o;
  }

  function shiftedSpot(g, pos, teamIdx, batter) {
    const base = defaultSpot(pos, g.park);
    const shift = g.shifts && g.shifts[teamIdx];
    if (!shift || pos === 'P' || pos === 'C') return base;
    const hand = batter ? batSide(batter, currentPitcher(g)) : 'R';
    const pull = hand === 'L' ? 1 : -1;
    if (shift.preset === 'auto' && !shift.edited) {
      const a = batter ? autoOffset(g, pos, batter, hand, teamIdx) : { x: 0, y: 0 };
      return { x: base.x + a.x, y: Math.max(-3, base.y + a.y) };
    }
    const preset = presetOffset(shift.edited ? 'none' : shift.preset, pos, pull);
    const custom = (shift.preset === 'custom' || shift.edited) && shift.custom && shift.custom[pos] ? shift.custom[pos] : { x: 0, y: 0 };
    const mirror = (shift.preset === 'custom' || shift.edited) && shift.mirror ? (hand === 'L' ? -1 : 1) : 1;
    return {
      x: base.x + preset.x + (Number(custom.x) || 0) * mirror,
      y: Math.max(-3, base.y + preset.y + (Number(custom.y) || 0))
    };
  }

  function setShift(g, teamIdx, spec) {
    g.shifts[teamIdx] = { preset: SHIFT_PRESETS[spec.preset] ? spec.preset : 'none', custom: spec.custom || {}, mirror: !!spec.mirror, edited: !!spec.edited };
  }

  function defenseList(g) {
    const team = fieldingTeam(g);
    const batter = g.pa ? g.pa.batter : currentBatter(g);
    const make = (pos, player) => {
      const spot = shiftedSpot(g, pos, 1 - g.half, batter);
      return { pos, p: player, x: spot.x, y: spot.y, fp: fieldProfile(player) };
    };
    return [make('P', currentPitcher(g)), ...team.lineup.filter((player) => player.pos !== 'DH').map((player) => make(player.pos, player))];
  }

  function startHalf(g) {
    g.needStart = false;
    g.outs = 0;
    g.bases = [null, null, null];
    g.count = { balls: 0, strikes: 0 };
    g.lineScore[g.half][g.inning - 1] = 0;
    const team = battingTeam(g);
    emit(g, 'header', `${g.half === 0 ? 'Top' : 'Bottom'} of the ${ordinal(g.inning)} - ${team.name} batting`);
    if (g.inning > g.innings && g.ghost) {
      const runner = team.lineup[(team.order + 8) % 9];
      g.bases[1] = { p: runner, resp: currentPitcher(g) };
      emit(g, 'info', `Extra innings: ${runner.name} starts on second base.`);
    }
    simCoach(g, 'half');
    checkPitcher(g, true);
  }

  function checkPitcher(g, halfStart) {
    const team = fieldingTeam(g);
    if (g.coach && g.coach[g.half === 0 ? 1 : 0] === 'manual') return;
    const current = team.pitchers[team.pIdx];
    if (team.pIdx >= team.pitchers.length - 1) return;
    const tired = current.stat.pc >= pitchLimit(current);
    const shelled = current.stat.r >= (current.role === 'SP' ? 6 : 4);
    if (tired || shelled || (halfStart && current.role !== 'SP' && current.stat.pc > 0.7 * pitchLimit(current))) {
      team.pIdx += 1;
      const next = team.pitchers[team.pIdx];
      emit(g, 'info', `Pitching change for ${team.name}: ${next.name} replaces ${current.name}.`);
    }
  }

  /* ------------------------------------------------------------ bench and coaching
     Substitutions are permanent: a replaced player cannot return. A bench player takes the
     lineup slot and defensive position of the player he replaces; if that is not his natural
     position he fields a little worse (more at catcher). */

  const SUB_IF = ['1B', '2B', '3B', 'SS'];
  const SUB_OF = ['LF', 'CF', 'RF'];
  // FLD points lost when a player fields a position that isn't his own, by [natural][assigned].
  // Close neighbors (SS<->2B, LF<->RF) lose little; catcher and shortstop are the hardest to fake.
  const OOP_PENALTY = {
    C: { '1B': 12, '2B': 24, '3B': 22, SS: 28, LF: 20, CF: 28, RF: 20 },
    '1B': { C: 36, '2B': 16, '3B': 14, SS: 26, LF: 14, CF: 24, RF: 14 },
    '2B': { C: 36, '1B': 8, '3B': 10, SS: 10, LF: 14, CF: 18, RF: 14 },
    '3B': { C: 36, '1B': 8, '2B': 12, SS: 12, LF: 14, CF: 20, RF: 12 },
    SS: { C: 36, '1B': 8, '2B': 6, '3B': 7, LF: 12, CF: 14, RF: 12 },
    LF: { C: 36, '1B': 12, '2B': 24, '3B': 22, SS: 28, CF: 10, RF: 5 },
    CF: { C: 36, '1B': 10, '2B': 18, '3B': 18, SS: 22, LF: 4, RF: 4 },
    RF: { C: 36, '1B': 12, '2B': 24, '3B': 20, SS: 28, LF: 5, CF: 10 },
    DH: { C: 40, '1B': 14, '2B': 30, '3B': 28, SS: 34, LF: 22, CF: 30, RF: 20 }
  };
  // Positions a player can play without penalty: his own plus any he played regularly in the majors.
  const eligibleAt = (player, pos) => pos === 'DH' || (player.natural || pos) === pos || (player.alt || []).includes(pos);
  function positionPenalty(player, pos) {
    if (eligibleAt(player, pos)) return 0;
    const row = OOP_PENALTY[player.natural] || OOP_PENALTY.DH;
    return row[pos] === undefined ? 20 : row[pos];
  }

  // Lowers FLD (ratings only; ARM and everything else stay) for a player fielding out of position.
  function applyPositionPenalty(player) {
    if (player.fieldBase === undefined) player.fieldBase = player.rt.field;
    const penalty = positionPenalty(player, player.pos);
    player.rt.field = Math.max(0, player.fieldBase - penalty);
    player.field = toInternal(player.rt.field);
    player.oop = penalty;
    return penalty;
  }

  const rtOf = (player) => player.rt || player;
  const offenseOf = (player) => { const r = rtOf(player); return 0.32 * r.contact + 0.32 * r.power + 0.20 * r.eye + 0.16 * r.speed; };
  const defenseOf = (player) => { const r = rtOf(player); return 0.4 * r.arm + 0.6 * r.field; };
  const batterOverall = (player) => 0.75 * offenseOf(player) + 0.25 * defenseOf(player);
  const pitcherOverall = (player) => {
    const r = rtOf(player);
    return player.role === 'RP'
      ? 0.30 * r.velo + 0.30 * r.control + 0.33 * r.movement + 0.07 * r.stamina
      : 0.25 * r.velo + 0.30 * r.control + 0.30 * r.movement + 0.15 * r.stamina;
  };

  const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);

  // Team ratings from the nine hitters and the pitching staff (starter 50%, bullpen 50%).
  function teamRatings(team) {
    const hitters = team.lineup.map(rtOf);
    const avg = (key) => mean(hitters.map((r) => r[key]));
    const hit = { contact: avg('contact'), power: avg('power'), eye: avg('eye'), speed: avg('speed') };
    const field = { arm: avg('arm'), field: avg('field') };
    const off = mean(team.lineup.map(offenseOf));
    const def = mean(team.lineup.map(defenseOf));
    const staff = team.pitchers;
    const starter = staff.slice(0, 1);
    const pen = staff.slice(1);
    const blend = (fn) => (pen.length ? 0.5 * mean(starter.map(fn)) + 0.5 * mean(pen.map(fn)) : mean(starter.map(fn)));
    const pitch = {
      velo: blend((p) => rtOf(p).velo),
      control: blend((p) => rtOf(p).control),
      movement: blend((p) => rtOf(p).movement),
      stamina: blend((p) => rtOf(p).stamina)
    };
    const pit = blend(pitcherOverall);
    return { hit, field, pitch, off, def, pit, ovr: 0.40 * off + 0.15 * def + 0.45 * pit };
  }

  function removeFromLineup(g, teamIdx, slot, benchIdx, entry) {
    const team = g.teams[teamIdx];
    const incoming = team.bench[benchIdx];
    const outgoing = team.lineup[slot];
    if (!incoming || !outgoing) return null;
    team.bench.splice(benchIdx, 1);
    incoming.pos = outgoing.pos;
    const penalty = applyPositionPenalty(incoming);
    incoming.entry = entry;
    incoming.slot = slot;
    incoming.inn = `${g.half === 0 ? 'T' : 'B'}${g.inning}`;
    outgoing.slot = slot;
    team.removed.push(outgoing);
    team.lineup[slot] = incoming;
    return { incoming, outgoing, penalty };
  }

  const busy = (g) => g.over || g.pendingLive || g.pendingContact || g.heldSteal;

  function subText(info, label, team) {
    const oop = info.penalty ? ` (out of position at ${info.incoming.pos})` : '';
    return `${team.name}: ${info.incoming.name} ${label} ${info.outgoing.name}${oop}.`;
  }

  // Bench player bats for the batter now due up (only before his first pitch).
  function pinchHit(g, benchIdx) {
    if (busy(g)) return { ok: false, error: 'Not available right now.' };
    if (g.pa && g.pa.pitches > 0) return { ok: false, error: 'A plate appearance is in progress.' };
    const team = battingTeam(g);
    const info = removeFromLineup(g, g.half, team.order % 9, benchIdx, 'PH');
    if (!info) return { ok: false, error: 'No such bench player.' };
    g.pa = null;
    emit(g, 'info', subText(info, 'pinch hits for', team));
    return { ok: true };
  }

  // Bench player runs for the runner on `base` (0 = first).
  function pinchRun(g, base, benchIdx) {
    if (busy(g)) return { ok: false, error: 'Not available right now.' };
    const runner = g.bases[base];
    if (!runner) return { ok: false, error: 'No runner on that base.' };
    const team = battingTeam(g);
    const slot = team.lineup.indexOf(runner.p);
    if (slot < 0) return { ok: false, error: 'Runner not in the lineup.' };
    const info = removeFromLineup(g, g.half, slot, benchIdx, 'PR');
    if (!info) return { ok: false, error: 'No such bench player.' };
    runner.p = info.incoming;
    emit(g, 'info', subText(info, 'pinch runs for', team));
    return { ok: true };
  }

  // Defensive replacement for the fielding team in the given lineup slot.
  function defensiveSub(g, slot, benchIdx) {
    if (busy(g)) return { ok: false, error: 'Not available right now.' };
    if (g.pa && g.pa.pitches > 0) return { ok: false, error: 'A plate appearance is in progress.' };
    const teamIdx = 1 - g.half;
    const team = g.teams[teamIdx];
    const info = removeFromLineup(g, teamIdx, slot, benchIdx, 'DEF');
    if (!info) return { ok: false, error: 'No such player.' };
    g.pa = null;
    emit(g, 'info', subText(info, 'enters the game to replace', team));
    return { ok: true };
  }

  // Brings in an unused reliever (index into team.pitchers, after the current one).
  function pitchingChange(g, relieverIdx) {
    if (busy(g)) return { ok: false, error: 'Not available right now.' };
    const team = fieldingTeam(g);
    if (relieverIdx <= team.pIdx || relieverIdx >= team.pitchers.length) return { ok: false, error: 'No such reliever.' };
    const old = team.pitchers[team.pIdx];
    const [next] = team.pitchers.splice(relieverIdx, 1);
    team.pitchers.splice(team.pIdx + 1, 0, next);
    team.pIdx += 1;
    if (g.pa) {
      g.pa.pitcher = next;
      g.pa.runner.resp = next;
      g.pa.queued = null;
    }
    emit(g, 'info', `Pitching change for ${team.name}: ${next.name} replaces ${old.name}.`);
    return { ok: true };
  }

  // Simulated manager. Rules of thumb only: late and close games trigger bench moves.
  function simCoach(g, phase) {
    const batIdx = g.half;
    const fieldIdx = 1 - g.half;
    const diff = g.score[batIdx] - g.score[fieldIdx];
    const late = g.inning >= 7 && Math.abs(diff) <= 2;
    const mid = g.inning >= 6 && Math.abs(diff) <= 4;
    if (phase === 'half' && g.coach[fieldIdx] === 'sim' && g.inning >= 8 && -diff > 0 && -diff <= 3) {
      const team = g.teams[fieldIdx];
      team.lineup.forEach((player, slot) => {
        if (player.entry || player.pos === 'DH') return;
        let best = -1;
        let gain = 19;
        team.bench.forEach((cand, i) => {
          if (positionPenalty(cand, player.pos) > 0 || rtOf(cand).field - rtOf(player).field < gain + 1) return;
          if (offenseOf(cand) < offenseOf(player) - 25) return;
          best = i;
          gain = rtOf(cand).field - rtOf(player).field;
        });
        if (best >= 0) defensiveSub(g, slot, best);
      });
    }
    if (phase !== 'pa' || g.coach[batIdx] !== 'sim') return;
    const team = g.teams[batIdx];
    if (!team.bench.length) return;
    // Pinch runner for a slow runner on first or second in a tight late game.
    if (g.inning >= 7 && diff <= 0 && diff >= -1) {
      for (const base of [1, 0]) {
        const runner = g.bases[base];
        if (!runner || runner.p.entry) continue;
        let best = -1;
        let gain = 17;
        team.bench.forEach((cand, i) => {
          const value = rtOf(cand).speed - rtOf(runner.p).speed - 0.8 * positionPenalty(cand, runner.p.pos);
          if (value > gain) { gain = value; best = i; }
        });
        if (best >= 0) pinchRun(g, base, best);
      }
    }
    if (!late && !mid) return;
    const batter = currentBatter(g);
    if (batter.entry || (g.pa && g.pa.pitches > 0)) return;
    const risp = g.bases[1] || g.bases[2];
    const need = (late ? 12 : 22) - (risp ? 5 : 0);
    let best = -1;
    let top = need;
    team.bench.forEach((cand, i) => {
      if (batter.pos === 'C' && positionPenalty(cand, 'C') > 0) return;
      const net = offenseOf(cand) - offenseOf(batter)
        - 0.35 * Math.max(0, rtOf(batter).field - rtOf(cand).field)
        - 0.8 * positionPenalty(cand, batter.pos);
      if (net > top) { top = net; best = i; }
    });
    if (best >= 0) pinchHit(g, best);
  }

  function runnerObject(player, pitcher) { return { p: player, resp: pitcher }; }

  function scoreRun(g, runner, credit) {
    g.score[g.half] += 1;
    g.lineScore[g.half][g.inning - 1] += 1;
    runner.p.stat.r += 1;
    runner.resp.stat.r += 1;
    if (credit) credit.stat.rbi += 1;
  }

  function endHalf(g) {
    g.needStart = true;
    g.bases = [null, null, null];
    g.outs = 0;
    g.count = { balls: 0, strikes: 0 };
    if (g.half === 0) {
      if (g.inning >= g.innings && g.score[1] > g.score[0]) return finish(g);
      g.half = 1;
    } else {
      if (g.inning >= g.innings && g.score[0] !== g.score[1]) return finish(g);
      if (g.inning >= 25) return finish(g);
      g.inning += 1;
      g.half = 0;
    }
  }

  function finish(g) {
    g.over = true;
    g.winner = g.score[0] === g.score[1] ? null : g.score[0] > g.score[1] ? 0 : 1;
    emit(g, 'final', g.winner === null
      ? `Final: tie ${g.score[0]}-${g.score[1]}.`
      : `Final: ${g.teams[g.winner].name} win ${Math.max(...g.score)}-${Math.min(...g.score)}.`);
  }

  /* ----------------------------------------------------- batted-ball resolution */

  function contactWord(la) {
    return la < 10 ? 'ground ball' : la < 25 ? 'line drive' : la < 50 ? 'fly ball' : 'popup';
  }

  function resolveBattedBall(g, ball, batterRunner) {
    const rng = g.rng;
    const batter = batterRunner.p;
    const fielders = defenseList(g);
    const entries = [];
    g.bases.forEach((runner, index) => { if (runner) entries.push({ r: runner, start: index + 1, base: index + 1, out: false }); });
    entries.sort((a, b) => b.start - a.start);
    const batterEntry = { r: batterRunner, start: 0, base: 0, out: false, isBatter: true };
    entries.push(batterEntry);

    const result = { ball, entries, outs: 0, kind: 'hit', hitBases: 0, error: null, dp: false, thirdOutForce: false, text: '', fielder: null, spot: null, throws: [] };

    if (ball.hr) {
      for (const entry of entries) entry.base = 4;
      result.kind = 'hr';
      result.hitBases = 4;
      return result;
    }

    if (ball.grd) {
      const end = ball.pts[ball.pts.length - 1];
      for (const entry of entries) entry.base = Math.min(4, entry.start + 2);
      result.kind = 'hit';
      result.hitBases = 2;
      result.groundRule = true;
      result.spot = { x: end.x, y: end.y };
      // The nearest fielder chases the ball down at the wall; no throws are needed.
      const chase = fieldBall(ball, fielders, { park: g.park });
      result.fielder = chase.f;
      result.time = chase.t;
      result.fielding = { body: chase.body, move: chase.move, z: chase.z, route: chase.routes && chase.routes[chase.f.pos] };
      result.air = false;
      return result;
    }

    const fr = fieldBall(ball, fielders, { park: g.park });
    const F = { ...fr.f, x: fr.body.x, y: fr.body.y, pickup: fr.move ? null : fr.pickup, recovery: fr.move ? fr.move.end - fr.t : 0 };
    const isOF = !INFIELD.has(F.pos);
    result.fielder = F;
    result.spot = { x: fr.x, y: fr.y };
    result.time = fr.t;
    result.air = fr.air;
    result.fielding = { body: fr.body, move: fr.move, z: fr.z, route: fr.routes && fr.routes[F.pos] };
    const outsBefore = g.outs;
    const plannedThrows = new Map();
    function plannedThrow(base) {
      if (plannedThrows.has(base)) return plannedThrows.get(base);
      const target = baseXY(base);
      const receiver = fielders.find(f => f.pos === receiverFor(base, F.pos)) || F;
      const cut = !INFIELD.has(F.pos) ? cutoffPlan(F, target, fielders, receiver) : null;
      const useCut = cut && cut.saves > 0.12;
      const aim = useCut ? cut.mid : target;
      const first = resolvedThrow(g, F, aim, base, transferSecs(F, aim), useCut ? cut.man : receiver, ball.wind);
      const legs = [first];
      if (useCut && !first.escaped) {
        const relay = { ...cut.man, ...first.to, pickup: null, recovery: 0 };
        legs.push(resolvedThrow(g, relay, target, base, first.arrive + transferSecs(relay, target), receiver, ball.wind));
      }
      const result = { legs, ready: legs[legs.length - 1].ready, wild: legs.some(leg => leg.wild) };
      plannedThrows.set(base, result);
      return result;
    }
    const recordThrow = (base, time) => {
      for (const leg of plannedThrow(base).legs) result.throws.push({ ...leg, release: time + leg.release, arrive: time + leg.arrive });
      const escaped = result.throws.find(leg => leg.escaped);
      if (escaped) {
        const occupied = new Map(entries.map(entry => {
          let at = entry.start;
          while (at < 4) {
            const need = result.airOut ? fr.t + 0.15 + runTime((at + 1 - entry.start) * 90, 90 / seg(entry.r.p), 0.2)
              : entry.isBatter ? toFirst(entry.r.p) + at * (seg(entry.r.p) - 0.1)
              : (ball.la >= 10 && outsBefore < 2 ? 0.4 : 0) + runTime((at + 1 - entry.start) * 90, 90 / seg(entry.r.p), 0.45);
            if (need > escaped.release) break;
            at++;
          }
          return [entry, at];
        }));
        const fromPitch = INFIELD.has(F.pos) && result.throws[0] === escaped
          && !entries.every(entry => occupied.get(entry) > entry.start);
        for (const entry of entries) if (!entry.out) {
          entry.base = Math.min(4, Math.max(occupied.get(entry), (fromPitch ? entry.start : occupied.get(entry)) + 2));
        }
        result.error = escaped.thrower;
        result.throwOutOfPlay = true;
      }
    };

    /* caught in the air */
    if (fr.air && !rng.chance(fieldingErrorP(F, true))) {
      batterEntry.out = true;
      result.outs = 1;
      result.kind = 'out';
      result.airOut = true;
      if (outsBefore + 1 < 3) {
        let ceiling = 4;
        for (const entry of entries) {
          if (entry.isBatter) continue;
          let base = entry.start;
          if (base + 1 <= ceiling) {
            const target = base + 1;
            const need = 0.15 + runTime(90, 90 / seg(entry.r.p), 0.2);
            const arrive = fr.t + plannedThrow(target).ready;
            if (arrive - (fr.t + need) > 0.35 && (isOF || fr.t > 3)) {
              if (arrive + rng.gauss() * 0.15 > fr.t + need + rng.gauss() * 0.1) base = target;
              else {
                entry.out = true;
                result.outs += 1;
                result.tagOut = true;
                result.tagTarget = target;
                continue;
              }
            }
          }
          entry.base = base;
          ceiling = base >= 4 ? 4 : base - 1;
        }
      } else {
        for (const entry of entries) if (!entry.isBatter) entry.base = entry.start;
      }
      result.sacFly = entries.some((entry) => !entry.isBatter && !entry.out && entry.base === 4) && outsBefore < 2;
      if (result.tagTarget) {
        recordThrow(result.tagTarget, fr.t);
      }
      return result;
    }

    /* dropped fly ball, or a ball on the ground */
    let delay = 0;
    let bobbled = false;
    if (fr.air || (!fr.air && rng.chance(fieldingErrorP(F, false)))) {
      delay = fr.air ? 0.9 : 1.0;
      bobbled = true;
    }
    const T0 = fr.t;
    const T = T0 + delay;
    const startDelay = ball.la >= 10 && outsBefore < 2 ? 0.4 : 0;
    const arrive = (entry, base) => entry.start === 0
      ? toFirst(entry.r.p) + (base - 1) * (seg(entry.r.p) - 0.1)
      : startDelay + runTime((base - entry.start) * 90, 90 / seg(entry.r.p), 0.45);
    const throwAt = (base, time) => time + plannedThrow(base).ready;
    const forced = (entry) => entry.start === 0 || entry.start === 1 || (entry.start === 2 && g.bases[0]) || (entry.start === 3 && g.bases[0] && g.bases[1]);
    const noise = (sd) => rng.gauss() * sd;

    let forceOutAt = 0;
    let throwError = false;
    const forcedRunners = entries.filter((entry) => !entry.isBatter && forced(entry));
    for (const entry of forcedRunners) {
      const target = entry.start + 1;
      if (throwAt(target, T) < arrive(entry, target) - 0.02) {
        if (throwAt(target, T) + noise(0.1) < arrive(entry, target) + noise(0.08)) {
          if (plannedThrow(target).wild) throwError = true;
          else {
            entry.out = true;
            forceOutAt = target;
            result.outs += 1;
          }
        }
        break;
      }
    }
    if (!forceOutAt && !throwError) {
      if (throwAt(1, T) + noise(0.1) < arrive(batterEntry, 1) + noise(0.08)) {
        if (plannedThrow(1).wild) throwError = true;
        else {
          batterEntry.out = true;
          result.outs += 1;
        }
      }
    }
    if (forceOutAt && outsBefore + result.outs < 3) {
      const pivotPos = forceOutAt === 2 ? (F.pos === '2B' ? 'SS' : '2B') : forceOutAt === 3 ? (F.pos === '3B' ? 'SS' : '3B') : 'C';
      const pivot = fielders.find((fielder) => fielder.pos === pivotPos) || F;
      const pivotFielder = { ...pivot, ...baseXY(forceOutAt), pickup: null, recovery: 0 };
      const pivotThrow = resolvedThrow(g, pivotFielder, baseXY(1), 1,
        throwAt(forceOutAt, T) + transferSecs(pivotFielder, baseXY(1)), fielders.find(f => f.pos === '1B') || pivot, ball.wind);
      if (pivotThrow.ready + noise(0.1) < arrive(batterEntry, 1) + noise(0.08) && !pivotThrow.wild) {
        batterEntry.out = true;
        result.outs += 1;
        result.dp = true;
        result.dpPath = [F.pos, pivotPos, '1B'];
        result.pivotThrow = pivotThrow;
      }
    }
    const endsInning = outsBefore + result.outs >= 3;
    result.thirdOutForce = endsInning && (forceOutAt > 0 || batterEntry.out);

    // Everyone not out takes the base they were forced to.
    for (const entry of entries) {
      if (entry.out) continue;
      entry.base = forced(entry) ? entry.start + 1 : entry.start;
    }
    const batterSafe = !batterEntry.out;

    // Extra bases on balls the outfield has to chase.
    const noPlayMade = result.outs === 0 && !throwError;
    if (noPlayMade && (isOF || ball.wallHit >= 0) && !bobbled) {
      let ceiling = 4;
      for (const entry of entries) {
        let base = entry.base;
        while (base < ceiling) {
          const target = base + 1;
          const margin = throwAt(target, T) - arrive(entry, target);
          if (margin > (target === 4 ? 0.35 : 0.3)) {
            if (throwAt(target, T) + noise(0.12) > arrive(entry, target) + noise(0.1)) base = target;
            else {
              entry.out = true;
              result.outs += 1;
              result.stretchOut = true;
              result.stretchTarget = target;
              break;
            }
          } else break;
        }
        if (entry.out) {
          if (entry.isBatter) result.hitBases = Math.max(1, entry.base);
          ceiling = Math.max(ceiling - 1, 0) > 0 ? ceiling : ceiling;
          continue;
        }
        entry.base = base;
        ceiling = base >= 4 ? 4 : base - 1;
      }
    }

    if (batterSafe || (batterEntry.out && result.stretchOut)) {
      const gotBase = batterEntry.out ? Math.max(1, batterEntry.base) : batterEntry.base;
      const noForceOut = !forceOutAt && !result.dp;
      if (noForceOut && gotBase >= 1) {
        if (bobbled && throwAt(1, T0) + 0.0 < arrive(batterEntry, 1) && !throwError) {
          result.kind = 'error';
          result.error = F.pos;
        } else if (throwError) {
          result.kind = 'error';
          result.error = F.pos;
          if (batterEntry.base === 1) batterEntry.base = 2;
        } else {
          result.kind = 'hit';
          result.hitBases = gotBase;
        }
      } else {
        result.kind = 'fc';
      }
    } else {
      result.kind = result.dp ? 'dp' : 'out';
    }
    if (result.kind === 'out' || result.kind === 'dp') result.groundOut = true;

    let throwBase;
    if (forceOutAt) throwBase = forceOutAt;
    else if (result.stretchTarget) throwBase = result.stretchTarget;
    else if (batterEntry.out) throwBase = 1;
    else throwBase = isOF ? clamp(Math.max(1, batterEntry.base) + 1, 2, 3) : 1;
    recordThrow(throwBase, T);
    if (result.dp) {
      result.throws.push(result.pivotThrow);
      delete result.pivotThrow;
    }
    return result;
  }

  /* ------------------------------------------------------------ play application */

  // Where the ball first touches the ground (or would have, without the wall). Home runs keep
  // their full flight in fullPts so they can play out past the fence.
  function markTouch(ball, openFlight) {
    const walled = ball.hr || (ball.wallHit >= 0 && ball.wallHit < ball.firstLand);
    const open = walled ? openFlight() : null;
    const land = open ? open.landing : ball.landing;
    const at = open && !ball.hr ? ball.pts[ball.wallHit] : land;
    ball.touch = { x: at.x, y: at.y, t: at.t, d: land.d };
    if (open && !ball.hr) ball.airWall = open.landing;
    if (ball.hr) ball.fullPts = open.pts.slice(0, open.firstLand + 90);
  }

  // Hit distance: where the ball first touched down, or would have if the wall hadn't stopped it.
  function hitDistance(ball, result) {
    if (ball.touch) return ball.touch.d;
    if (ball.hr) return result.distance;
    const caught = result.airOut || (result.kind === 'out' && result.air);
    if (ball.la >= 10 && !caught) return ball.hitDist != null ? ball.hitDist : ball.landing.d;
    return result.spot ? Math.hypot(result.spot.x, result.spot.y) : ball.landing.d;
  }

  function describeBall(ball, result) {
    const distance = Math.round(hitDistance(result.ball, result));
    return `${Math.round(ball.ev)} mph, ${Math.round(ball.la)}°, ${distance} ft`;
  }

  function applyBattedBall(g, ball, batterRunner, pitcher, preset) {
    const batter = batterRunner.p;
    const result = preset || resolveBattedBall(g, ball, batterRunner);
    const team = battingTeam(g);
    const defTeamIdx = 1 - g.half;
    result.distance = ball.hr ? ball.hrDistance : null;
    const entries = result.entries;
    const rbiEligible = result.kind !== 'error' && !result.dp;
    const outsBefore = g.outs;
    g.outs += result.outs;
    const inningOver = g.outs >= 3;
    const newBases = [null, null, null];
    const scorers = [];
    for (const entry of entries) {
      if (entry.out) continue;
      if (entry.base >= 4) {
        if (result.thirdOutAt == null || entry.scoredAt < result.thirdOutAt) scorers.push(entry);
      }
      else if (entry.base >= 1) newBases[entry.base - 1] = entry.r;
    }
    const runsCount = !(inningOver && result.thirdOutForce) && !(inningOver && !result.airOut && !result.tagOut && !result.stretchOut);
    const allowRuns = result.kind === 'hr' || runsCount || (inningOver && (result.tagOut || result.stretchOut) && false);
    if (allowRuns || result.kind === 'hr') {
      for (const entry of scorers) scoreRun(g, entry.r, rbiEligible ? batter : null);
    }
    if (!inningOver) g.bases = newBases;

    const stat = batter.stat;
    stat.pa += 1;
    pitcher.stat.bf += 1;
    pitcher.stat.outs += result.outs;
    const countedAsHit = result.kind === 'hr' || (result.kind === 'hit' && result.hitBases >= 1);
    if (!result.sacFly) stat.ab += 1;
    if (countedAsHit) {
      const bases = result.hitBases;
      stat.h += 1;
      pitcher.stat.h += 1;
      g.hits[g.half] += 1;
      if (bases === 2) stat.d += 1;
      if (bases === 3) stat.t += 1;
      if (bases >= 4) {
        stat.hr += 1;
        pitcher.stat.hr += 1;
      }
    }
    if (result.error) g.errors[defTeamIdx] += 1;
    if (result.dp) g.doublePlays += 1;
    result.ab = !result.sacFly;
    result.hit = countedAsHit ? result.hitBases : 0;
    result.runs = allowRuns ? scorers.length : 0;
    result.outsAdded = result.outs;
    result.inningOver = inningOver;
    result.outsBefore = outsBefore;
    result.team = team.name;
    return result;
  }

  function playText(batter, result, ball) {
    const ballInfo = `(${Math.round(ball.ev)} mph, ${Math.round(ball.la)}°, ${Math.round(hitDistance(result.ball, result))} ft)`;
    const how = contactWord(ball.la);
    const pos = result.fielder ? result.fielder.pos : '';
    if (result.kind === 'hr') {
      const runs = result.runs;
      return `${batter.name} homers${runs > 1 ? ` (${runs} runs score)` : ''} ${ballInfo}.`;
    }
    if (result.kind === 'hit' && result.groundRule) {
      return `${batter.name} hits a ground-rule double ${ballInfo}.`;
    }
    if (result.kind === 'hit') {
      const word = ['', 'singles', 'doubles', 'triples', 'hits an inside-the-park homer'][result.hitBases];
      return `${batter.name} ${word} on a ${how} to ${pos} ${ballInfo}.${result.stretchOut ? ' Thrown out trying to stretch it.' : ''}`;
    }
    if (result.kind === 'error') return `${batter.name} reaches on an error by ${result.error} on a ${how} ${ballInfo}.`;
    if (result.kind === 'fc') {
      if (result.hitRunner) return `${batter.name} reaches first when the ball hits ${result.hitRunner}, who is out ${ballInfo}.`;
      return `${batter.name} reaches on a fielder's choice, ${pos} ${ballInfo}.`;
    }
    if (result.kind === 'dp') return `${batter.name} grounds into a double play, ${result.dpPath.join('-')} ${ballInfo}.`;
    const verb = result.airOut
      ? (how === 'popup' ? 'pops out' : how === 'fly ball' ? 'flies out' : 'lines out')
      : 'grounds out';
    return `${batter.name} ${verb} to ${pos} ${ballInfo}.${result.sacFly ? ' Sacrifice fly.' : ''}${result.tagOut ? ' A runner is thrown out advancing.' : ''}`;
  }

  /* ------------------------------------------------------------------ the pitch */

  function startPA(g) {
    const pitcher = currentPitcher(g);
    simCoach(g, 'pa');
    checkPitcher(g, false);
    const batter = currentBatter(g);
    const active = currentPitcher(g);
    g.pa = { batter, pitcher: active, runner: runnerObject(batter, active), pitches: 0 };
    g.count = { balls: 0, strikes: 0 };
    void pitcher;
  }

  function finishBall(g, pa, event, ball, result) {
    const { batter, pitcher } = pa;
    const text = playText(batter, result, ball);
    event.play = result;
    emit(g, 'pitch', event.text, { pitch: event.pitch });
    const entry = emit(g, 'pa', text + (result.runs && result.kind !== 'hr' ? ` ${result.runs} run${result.runs > 1 ? 's' : ''} score.` : ''), { scoring: result.runs > 0, ballIdx: g.battedBalls.length });
    g.battedBalls.push({ ball, result, batter, pitcher, team: g.half, park: g.park.id });
    event.pa = { text: entry.text, result };
    return finishPA(g, pa, event);
  }

  // Play the actual contact before opening its review; defer only the score/stat application.
  function playHeldContact(g, opts) {
    opts = opts || {};
    const pa = g.pa;
    const held = pa && pa.held;
    if (!held || held.stage !== 'ff') return null;
    const { event, ff } = held;
    const contact = held.ballInPlay || held.foulBall;
    const ball = flightSim(contact.ev, contact.la, contact.dir, g.park, flyOf(g, contact));
    ball.lineCall = foulLineCall(ball, g.park, ff.umpFair);
    markTouch(ball, () => flightSim(contact.ev, contact.la, contact.dir, g.park, flyOf(g, contact, { noFence: true })));
    held.shownFair = ff.umpFair;
    delete event.held;
    delete event.heldFlight;
    if (ff.umpFair) {
      if (ball.grd && fieldBall(ball, defenseList(g), { park: g.park }).index < ball.pts.length - 1) ball.grd = false;
      if (ball.hr) ball.hrDistance = ball.touch.d;
      ball.wind = contact.wind;
      ball.spin = contact.spin;
      event.ball = ball;
      event.call = 'in play';
      event.text = `${Math.round(held.pitch.mph)} mph ${PITCH_TYPES[held.pitch.type].name}: in play.`;
      if (opts.live && !ball.hr && !ball.grd) {
        event.live = createLivePlay(g, ball, pa.runner, opts.live);
        g.pendingLive = { event, pa, ball, live: event.live, heldContact: held };
        return event;
      }
      event.play = resolveBattedBall(g, ball, pa.runner);
    } else {
      event.call = 'foul';
      event.foul = ball;
      if (contact.la >= 25) {
        const caught = fieldBall(ball, defenseList(g), {
          park: g.park, airOnly: true, region: (p) => Math.hypot(p.x, p.y) <= 115 && p.y >= -50
        });
        if (caught && !g.rng.chance(fieldingErrorP(caught.f, true))) {
          event.call = 'foul popup caught';
          event.foul = { ...ball, pts: ball.pts.filter((p) => p.t < caught.t) };
          event.foulCatch = { pos: caught.f.pos, x: caught.x, y: caught.y, z: caught.z, t: caught.t, body: caught.body, move: caught.move, route: caught.routes && caught.routes[caught.f.pos] };
        }
      }
    }
    event.contactPending = true;
    g.pendingContact = { event, pa, held };
    return event;
  }

  function completeContact(g, opts) {
    const pending = g.pendingContact;
    if (!pending) return null;
    g.pendingContact = null;
    const { event, pa, held } = pending;
    g.review = held.review;
    cpuChallenges(g, opts);
    delete event.contactPending;
    if (held.ff.umpFair !== held.shownFair) {
      delete event.ball;
      delete event.play;
      delete event.foul;
      delete event.foulCatch;
      return stepPitch(g, undefined, { ...opts, hold: false });
    }
    logReview(g);
    g.review = null;
    pa.held = null;
    if (event.ball) {
      applyBattedBall(g, event.ball, pa.runner, pa.pitcher, event.play);
      return finishBall(g, pa, event, event.ball, event.play);
    }
    if (event.foulCatch) {
      const outcome = recordOut(g, pa, event, `${pa.batter.name} pops out to ${event.foulCatch.pos} in foul territory.`);
      return finishPA(g, pa, outcome);
    }
    if (g.count.strikes < 2) g.count.strikes += 1;
    event.text = `${Math.round(held.pitch.mph)} mph ${PITCH_TYPES[held.pitch.type].name}: foul.`;
    emit(g, 'pitch', `${event.text} (${g.count.balls}-${g.count.strikes})`, { pitch: held.pitch });
    return closePitch(g, pa, event);
  }

  // Applies a finished live play to the game and returns the completed pitch event.
  function completeLive(g, opts) {
    const pending = g.pendingLive;
    if (!pending) return null;
    g.pendingLive = null;
    const { event, pa, ball, live, heldContact } = pending;
    const calls = [...(heldContact ? heldContact.review.calls : []), ...live.prepare()];
    if (calls.length) {
      if (!g.review || g.review.kind !== 'live') setReview(g, 'live', calls);
      cpuChallenges(g, opts);
    }
    if (heldContact) {
      if (heldContact.ff.umpFair !== heldContact.shownFair) {
        delete event.ball;
        delete event.live;
        return stepPitch(g, undefined, { ...opts, hold: false });
      }
      pa.held = null;
    }
    logReview(g);
    g.review = null;
    const result = live.result();
    applyBattedBall(g, ball, pa.runner, pa.pitcher, result);
    event.liveDone = true;
    return finishBall(g, pa, event, ball, result);
  }

  // Opens a challenge window for any call that hurt a human-controlled team.
  function reviewLive(g, opts) {
    const pending = g.pendingLive;
    if (!pending) return null;
    const calls = [...(pending.heldContact ? pending.heldContact.review.calls : []), ...pending.live.prepare()];
    if (!calls.length) return null;
    setReview(g, 'live', calls);
    const open = pendingReview(g, opts);
    if (!open) return null;
    return open;
  }
  function finishPA(g, pa, outcome) {
    const team = battingTeam(g);
    team.order += 1;
    g.pa = null;
    g.count = { balls: 0, strikes: 0 };
    if (g.outs >= 3) endHalf(g);
    else if (g.half === 1 && g.inning >= g.innings && g.score[1] > g.score[0]) finish(g);
    return outcome;
  }

  // Click swings add offset {x,z} in inches; timing stays relative to plate crossing.
  // One pitch. `manual` may be { swing, timing, loc } or { swing: true, ball: {ev, la, dir} };
  // `preset` is a pitch previously made by nextPitch.
  function nextPitch(g, aim) {
    if (g.over) return null;
    if (g.needStart) startHalf(g);
    if (!g.pa) startPA(g);
    if (aim) g.pa.queued = userPitch(g, g.pa.pitcher, aim);
    else if (!g.pa.queued) g.pa.queued = throwPitch(g, g.pa.pitcher, g.pa.batter);
    return g.pa.queued;
  }

  function stepPitch(g, manual, opts) {
    if (g.over) return null;
    if (g.needStart) startHalf(g);
    if (!g.pa) startPA(g);
    const pa = g.pa;
    const { batter, pitcher } = pa;
    const rng = g.rng;
    opts = opts || {};
    const held = pa.held;
    pa.held = null;
    g.review = null;
    let pitch;
    let swing;
    let event;
    if (held) {
      ({ pitch, swing, event } = held);
      delete event.held;
    } else {
      pitch = pa.queued || throwPitch(g, pitcher, batter);
      pa.queued = null;
      swing = manual || autoSwing(g, batter, pitcher, pitch);
      pitcher.stat.pc += 1;
      pa.pitches += 1;
      g.pitches += 1;
      event = { pitch, swing: swing.swing, call: '', text: '', pa: null };
    }
    const label = `${Math.round(pitch.mph)} mph ${PITCH_TYPES[pitch.type].name}`;
    let ballInPlay = null;
    let foulBall = null;
    let ff = null;

    if (held && held.stage === 'ff') {
      ({ ballInPlay, foulBall, ff } = held);
    } else if (!swing.swing) {
      if (!pitch.ump) {
        rollUmp(g, pitch);
        const call = absCall(g, pitch);
        setReview(g, 'abs', [call]);
        if (opts.hold && humanHurt(g, call, opts)) {
          pa.held = { stage: 'abs', pitch, swing, event, review: g.review };
          event.held = 'abs';
          return event;
        }
      } else if (held) g.review = held.review;
      if (g.review) cpuChallenges(g, opts);
      if (pitch.ump === 'strike') {
        event.call = 'called strike';
        g.count.strikes += 1;
      } else {
        event.call = 'ball';
        g.count.balls += 1;
      }
    } else if (manual && manual.ball) {
      ballInPlay = { ev: manual.ball.ev, la: manual.ball.la, dir: ((manual.ball.dir + 180) % 360 + 360) % 360 - 180, q: 0.85 };
    } else {
      const quality = swingQuality(swing, batter, pitcher, pitch);
      if (quality <= 0) {
        event.call = 'swinging strike';
        g.count.strikes += 1;
      } else {
        const hit = battedBallFrom(g, batter, pitcher, pitch, swing, quality);
        ballInPlay = { ev: hit.ev, la: hit.la, dir: hit.dir, q: quality, pullSign: hit.pullSign };
      }
    }

    for (const c of [ballInPlay, foulBall]) if (c) prepBall(g, c, c.pullSign);

    // Fair means the ball lands on or inside the park's foul lines (or clips the pole); anything else is foul.
    const flightOf = (c, extra) => {
      const flight = flightSim(c.ev, c.la, c.dir, g.park, flyOf(g, c, extra));
      if (ff) flight.lineCall = foulLineCall(flight, g.park, ff.umpFair);
      return flight;
    };
    const isFair = (c) => { const f = flightOf(c); return f.fair || f.pole; };
    if (!(held && held.stage === 'ff')) {
      if (ballInPlay && !isFair(ballInPlay)) {
        foulBall = ballInPlay;
        ballInPlay = null;
      }
      const contact = ballInPlay || foulBall;
      if (contact) {
        const truthFair = isFair(contact);
        const probe = flightOf(contact);
        const edge = Math.abs(Math.abs(probe.landAngle) - foulLimit(g.park, probe.landAngle));
        const missed = !(manual && manual.ball) && rng.chance(0.3 * Math.exp(-edge / 0.8));
        ff = { truthFair, umpFair: missed ? !truthFair : truthFair };
        const call = {
          id: 'ff', kind: 'field', label: `the ${ff.umpFair ? 'fair' : 'foul'} ball call`, hurt: ff.umpFair ? 1 - g.half : g.half,
          wrong: ff.umpFair !== truthFair,
          flip: () => { ff.umpFair = ff.truthFair; },
          doubt: 0.03 + 0.2 * Math.exp(-edge / 0.5),
          leverage: 0.6
        };
        setReview(g, 'ff', [call]);
        if (opts.hold && humanHurt(g, call, opts)) {
          pa.held = { stage: 'ff', pitch, swing, event, ballInPlay, foulBall, ff, review: g.review };
          event.held = 'ff';
          event.heldFlight = markTouch(probe, () => flightOf(contact, { noFence: true })) || probe;
          event.heldFlight.lineCall = foulLineCall(probe, g.park, ff.umpFair);
          return event;
        }
      }
    } else g.review = held.review;
    if (ff) {
      cpuChallenges(g, opts);
      logReview(g);
      g.review = null;
      if (ff.umpFair) {
        if (!ballInPlay && foulBall) {
          ballInPlay = foulBall;
          foulBall = null;
        }
      } else if (ballInPlay) {
        foulBall = ballInPlay;
        ballInPlay = null;
      }
    }

    if (foulBall) {
      let caught = null;
      if (foulBall.la >= 25) {
        const flight = flightOf(foulBall);
        caught = fieldBall(flight, defenseList(g), {
          park: g.park, airOnly: true,
          region: (point) => Math.hypot(point.x, point.y) <= 115 && point.y >= -50
        });
        if (caught && rng.chance(fieldingErrorP(caught.f, true))) caught = null;
        if (caught) {
          markTouch(flight, () => flightOf(foulBall, { noFence: true }));
          event.call = 'foul popup caught';
          event.text = `${label}: foul popup caught by ${caught.f.pos}.`;
          event.foul = { ...flight, pts: flight.pts.filter((p) => p.t < caught.t) };
          event.foulCatch = { pos: caught.f.pos, x: caught.x, y: caught.y, z: caught.z, t: caught.t, body: caught.body, move: caught.move, route: caught.routes && caught.routes[caught.f.pos] };
          const outcome = recordOut(g, pa, event, `${batter.name} pops out to ${caught.f.pos} in foul territory.`);
          return finishPA(g, pa, outcome);
        }
      }
      event.call = 'foul';
      event.foul = flightOf(foulBall);
      markTouch(event.foul, () => flightOf(foulBall, { noFence: true }));
      event.foulEdge = Math.abs(Math.abs(event.foul.landAngle) - foulLimit(g.park, event.foul.landAngle));
      if (g.count.strikes < 2) g.count.strikes += 1;
    }

    if (ballInPlay) {
      const ball = flightOf(ballInPlay);
      if (ball.grd) {
        const grab = fieldBall(ball, defenseList(g), { park: g.park });
        if (grab.index < ball.pts.length - 1) ball.grd = false;
      }
      markTouch(ball, () => flightOf(ballInPlay, { noFence: true }));
      if (ball.hr) ball.hrDistance = ball.touch.d;
      else if (ball.airWall) ball.hitDist = ball.airWall.d;
      ball.wind = ballInPlay.wind;
      ball.spin = ballInPlay.spin;
      event.call = 'in play';
      event.text = `${label}: in play.`;
      event.ball = ball;
      if (opts && opts.live && !ball.hr && !ball.grd) {
        event.live = createLivePlay(g, ball, pa.runner, opts.live);
        g.pendingLive = { event, pa, ball, live: event.live };
        return event;
      }
      const result = applyBattedBall(g, ball, pa.runner, pitcher);
      return finishBall(g, pa, event, ball, result);
    }

    // Pitch ended in a ball, strike, or foul.
    event.text = `${label}: ${event.call}.`;
    emit(g, 'pitch', `${event.text} (${g.count.balls}-${g.count.strikes})`, { pitch });
    if (g.review) {
      logReview(g);
      g.review = null;
    }
    const struckOut = g.count.strikes >= 3;
    if (event.call !== 'foul' && g.count.balls < 4 && !(struckOut && g.outs >= 2)) {
      const requested = opts.steal !== undefined ? opts.steal : aiSteals(g);
      const calls = planSteals(g, pitch, requested);
      if (calls.length) {
        setReview(g, 'steal', calls);
        if (opts.hold && g.review.calls.some((c) => humanHurt(g, c, opts))) {
          g.heldSteal = { pa, pitch, event, calls, review: g.review };
          event.held = 'steal';
          return event;
        }
        const done = settleSteals(g, pa, event, calls, opts);
        if (done) return done;
      }
    }
    return closePitch(g, pa, event);
  }

  // Resumes a pitch that was held for a steal review.
  function resumeSteal(g, opts) {
    const held = g.heldSteal;
    if (!held) return null;
    g.heldSteal = null;
    g.review = held.review;
    const done = settleSteals(g, held.pa, held.event, held.calls, opts || {});
    return done || closePitch(g, held.pa, held.event);
  }

  function closePitch(g, pa, event) {
    const { batter, pitcher } = pa;
    if (g.count.strikes >= 3) {
      const looking = event.call === 'called strike';
      pitcher.stat.k += 1;
      batter.stat.k += 1;
      batter.stat.ab += 1;
      batter.stat.pa += 1;
      pitcher.stat.bf += 1;
      pitcher.stat.outs += 1;
      g.outs += 1;
      const entry = emit(g, 'pa', `${batter.name} strikes out ${looking ? 'looking' : 'swinging'}.`);
      event.pa = { text: entry.text, result: { kind: 'k', outs: 1 } };
      return finishPA(g, pa, event);
    }
    if (g.count.balls >= 4) {
      pitcher.stat.bb += 1;
      batter.stat.bb += 1;
      batter.stat.pa += 1;
      pitcher.stat.bf += 1;
      const runner = pa.runner;
      let scored = 0;
      if (g.bases[0]) {
        if (g.bases[1]) {
          if (g.bases[2]) {
            scoreRun(g, g.bases[2], batter);
            scored += 1;
          }
          g.bases[2] = g.bases[1];
        }
        g.bases[1] = g.bases[0];
      }
      g.bases[0] = runner;
      const entry = emit(g, 'pa', `${batter.name} walks.${scored ? ' A run scores.' : ''}`, { scoring: scored > 0 });
      event.pa = { text: entry.text, result: { kind: 'bb', outs: 0, runs: scored } };
      return finishPA(g, pa, event);
    }
    return event;
  }

  /* ------------------------------------------------------------- base stealing */

  const logistic = (x) => 1 / (1 + Math.exp(-x));
  const STEAL_NOISE = 0.22;

  // Seconds the defense has beyond the runner's time (positive = safe). `A` is the catcher's
  // throw-and-tag time after the catch, `R` the runner's remaining time at that moment.
  function stealMargin(runner, base, mph, pitcher, catcher) {
    const lead = base === 3 ? 15 : base === 2 ? 14 : 11;
    const runSecs = 0.2 + runTime(90 - lead, 90 / seg(runner), 0.5);
    const delivery = 1.3 + (pitcher.throws === 'L' && base === 1 ? 0 : 0.05);
    const flight = 60.5 / (Math.max(60, mph) * 1.46667);
    const fp = fieldProfile(catcher);
    const throwFt = base === 1 ? 127.3 : base === 2 ? 90 : 0;
    const A = base === 3 ? 0.45 : 0.6 + throwPlan(fp.armFps, throwFt).duration + 0.18;
    const margin = delivery + flight + A - runSecs;
    return { margin, A, R: Math.max(0.6, A - margin) };
  }

  function stealCatcher(g) { return fieldingTeam(g).lineup.find((player) => player.pos === 'C'); }

  // Can the runner on `base` (1-3) go, given who else is going?
  function canSteal(g, base, going = []) {
    if (!g.bases[base - 1]) return false;
    if (base === 3) return true;
    return !g.bases[base] || going.includes(base + 1);
  }

  // Chance the runner on `base` is safe against the current pitcher and catcher.
  function stealOdds(g, base, mph) {
    const runner = g.bases[base - 1];
    if (!runner) return 0;
    const pitcher = currentPitcher(g);
    const { margin } = stealMargin(runner.p, base, mph || pitcher.velo - 3, pitcher, stealCatcher(g));
    return logistic(1.7 * margin / STEAL_NOISE);
  }

  function aiSteals(g) {
    const out = [];
    const [first, second, third] = g.bases;
    const lead = g.score[g.half] - g.score[1 - g.half];
    const late = g.inning >= g.innings - 1;
    if (!(lead >= 5 || (late && lead <= -5) || (late && lead >= 3))) {
      const outsPenalty = g.outs === 2 ? 0.75 : 1;
      const go = (runner, base) => {
        const risk = runner.p.risk || 50;
        const tight = lead >= -1 && lead <= 1 ? (late ? 0.04 : 0) : 0;
        const needOdds = 0.78 - (risk - 50) * 0.006 - tight;
        if (stealOdds(g, base) < needOdds) return false;
        return g.rng.chance(clamp(0.013 + 0.003 * (runner.p.speed - 50) + 0.0018 * (risk - 50), 0.002, 0.15) * outsPenalty);
      };
      if (second && !third && go(second, 2)) out.push(2);
      if (first && !second && go(first, 1)) out.push(1);
    }
    return out;
  }

  // Rolls each steal attempt. Only the lead runner is thrown at; the umpire's call on that
  // play can be wrong, and the other runners simply advance.
  function planSteals(g, pitch, requested) {
    const going = [];
    [...new Set(requested)].sort((a, b) => b - a).forEach((base) => { if (canSteal(g, base, going)) going.push(base); });
    if (!going.length) return [];
    const pitcher = currentPitcher(g);
    const catcher = stealCatcher(g);
    return going.map((base, index) => {
      const runner = g.bases[base - 1];
      const calc = stealMargin(runner.p, base, pitch.mph, pitcher, catcher);
      const contested = index === 0;
      const m = calc.margin + g.rng.gauss() * STEAL_NOISE;
      const truthSafe = !contested || m > 0;
      const missed = contested && g.rng.chance(0.3 * Math.exp(-Math.abs(m) / 0.12));
      const plan = { base, runner, contested, truthSafe, safe: missed ? !truthSafe : truthSafe, A: calc.A, R: calc.R };
      const bag = ['', 'second', 'third', 'home'][base];
      const doubt = 0.04 + 0.25 * Math.exp(-Math.abs(m) / 0.1);
      return {
        id: `steal:${base}`, kind: 'field', label: `the ${plan.safe ? 'safe' : 'out'} call on ${runner.p.name} stealing ${bag}`,
        hurt: plan.safe ? 1 - g.half : g.half, plan, bag, runner,
        wrong: contested && plan.safe !== truthSafe, noCall: !contested,
        flip: () => { plan.safe = plan.truthSafe; }, doubt, leverage: 0.6
      };
    }).map((call) => (call.noCall ? { ...call, challenged: true } : call));
  }

  function settleSteals(g, pa, event, calls, opts) {
    cpuChallenges(g, opts);
    logReview(g);
    g.review = null;
    const pitcher = currentPitcher(g);
    event.steals = [];
    for (const call of calls) {
      if (g.outs >= 3) break;
      const { plan, bag, runner } = call;
      g.bases[plan.base - 1] = null;
      if (plan.safe) {
        runner.p.stat.sb += 1;
        if (plan.base === 3) scoreRun(g, runner, null);
        else g.bases[plan.base] = runner;
        emit(g, 'info', `${runner.p.name} steals ${bag}.`, { scoring: plan.base === 3 });
      } else {
        runner.p.stat.cs += 1;
        pitcher.stat.outs += 1;
        g.outs += 1;
        emit(g, 'info', `${runner.p.name} is caught stealing ${bag}.`);
      }
      event.steals.push({ base: plan.base, safe: plan.safe, name: runner.p.name, contested: plan.contested, A: plan.A, R: plan.R });
    }
    if (g.outs >= 3) {
      g.pa = null;
      endHalf(g);
      return event;
    }
    if (g.half === 1 && g.inning >= g.innings && g.score[1] > g.score[0]) {
      g.pa = null;
      finish(g);
      return event;
    }
    return null;
  }

  function recordOut(g, pa, event, text) {
    const { batter, pitcher } = pa;
    batter.stat.ab += 1;
    batter.stat.pa += 1;
    pitcher.stat.bf += 1;
    pitcher.stat.outs += 1;
    g.outs += 1;
    emit(g, 'pitch', event.text, { pitch: event.pitch });
    const entry = emit(g, 'pa', text);
    event.pa = { text: entry.text, result: { kind: 'out', outs: 1 } };
    return event;
  }

  function simPlateAppearance(g) {
    const start = g.log.length;
    if (g.over) return [];
    let event;
    do {
      event = stepPitch(g);
    } while (event && !event.pa && !g.over);
    return g.log.slice(start);
  }

  function simHalfInning(g) {
    const half = g.half;
    const inning = g.inning;
    while (!g.over && g.half === half && g.inning === inning) simPlateAppearance(g);
  }

  function simGame(g) {
    let guard = 0;
    while (!g.over && guard < 20000) {
      stepPitch(g);
      guard += 1;
    }
    return g;
  }

  function snapshot(g) {
    const bat = battingTeam(g);
    const fielding = fieldingTeam(g);
    return {
      inning: g.inning,
      half: g.half,
      outs: g.outs,
      count: { ...g.count },
      score: [...g.score],
      bases: g.bases.map((runner) => (runner ? runner.p.name : null)),
      batter: g.pa ? g.pa.batter : bat.lineup[bat.order % 9],
      pitcher: fielding.pitchers[fielding.pIdx],
      battingTeam: bat.name,
      fieldingTeam: fielding.name,
      over: g.over,
      winner: g.winner,
      challenges: g.challenges.map((c) => ({ ...c }))
    };
  }

  /* ---------------------------------------------------------- team generation */

  const FIRST_NAMES = ['Alex', 'Ben', 'Carlos', 'Dylan', 'Eli', 'Felix', 'Gabe', 'Hank', 'Isaac', 'Jorge', 'Kyle', 'Luis', 'Marco', 'Nate', 'Omar', 'Pedro', 'Quinn', 'Ray', 'Sam', 'Theo', 'Vic', 'Wes', 'Yuri', 'Zane', 'Andre', 'Brett', 'Cole', 'Diego', 'Evan', 'Finn'];
  const LAST_NAMES = ['Alvarez', 'Brooks', 'Castillo', 'Dawson', 'Ellis', 'Foster', 'Garza', 'Hayes', 'Ito', 'Jensen', 'Kim', 'Lopez', 'Morales', 'Nolan', 'Ortiz', 'Park', 'Quintero', 'Reyes', 'Sato', 'Turner', 'Underwood', 'Vega', 'Walsh', 'Xiong', 'Young', 'Zimmer', 'Baxter', 'Crane', 'Doyle', 'Fisher'];

  const STYLES = {
    balanced: { contact: 50, power: 50, eye: 50, speed: 50, arm: 50, field: 50, velo: 93, control: 50, movement: 50, stamina: 50 },
    sluggers: { contact: 44, power: 66, eye: 54, speed: 38, arm: 52, field: 44, velo: 93, control: 48, movement: 50, stamina: 50 },
    speed: { contact: 56, power: 38, eye: 50, speed: 68, arm: 50, field: 58, velo: 92, control: 52, movement: 50, stamina: 50 },
    pitching: { contact: 46, power: 45, eye: 48, speed: 50, arm: 54, field: 56, velo: 97, control: 62, movement: 62, stamina: 58 }
  };

  const POSITION_BONUS = {
    C: { arm: 8, field: 4, speed: -8, power: -2 },
    '1B': { power: 7, field: -4, speed: -6, arm: -6 },
    '2B': { speed: 2, field: 5, power: -4 },
    '3B': { arm: 6, power: 3 },
    SS: { field: 8, arm: 5, speed: 4, power: -6 },
    LF: { power: 3, field: -2 },
    CF: { speed: 8, field: 6, arm: 2, power: -2 },
    RF: { arm: 7, power: 3 },
    DH: { power: 8, contact: 2, field: -10, speed: -6, arm: -8 }
  };

  function generateTeam(name, style, seed) {
    const rng = makeRng(seed);
    const preset = STYLES[style] || STYLES.balanced;
    const usedNames = new Set();
    const makeName = () => {
      for (;;) {
        const full = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
        if (!usedNames.has(full)) {
          usedNames.add(full);
          return full;
        }
      }
    };
    const rate = (base, bonus = 0) => Math.max(20, Math.round(50 + (base + bonus - 50) / 0.6 + rng.gauss() * 13.3));
    const lineup = [...POSITIONS, 'DH'].map((pos) => {
      const bonus = POSITION_BONUS[pos] || {};
      return {
        name: makeName(),
        height: 72, weight: 200,
        pos,
        bats: rng.pick(['R', 'R', 'R', 'L', 'L', 'S']),
        contact: rate(preset.contact, bonus.contact),
        power: rate(preset.power, bonus.power),
        eye: rate(preset.eye, bonus.eye),
        speed: rate(preset.speed, bonus.speed),
        arm: rate(preset.arm, bonus.arm),
        field: rate(preset.field, bonus.field),
        risk: rate(50, bonus.risk || (preset === STYLES.speed ? 6 : 0))
      };
    });
    // Traditional order: best on-base/speed bats up top, power in the 3-5 spots, weakest hitters last.
    const value = (p) => p.contact + p.power + p.eye;
    const pool = [...lineup].sort((a, b) => value(b) - value(a));
    const leadoff = [...pool].sort((a, b) => (b.eye + b.contact + b.speed) - (a.eye + a.contact + a.speed))[0];
    pool.splice(pool.indexOf(leadoff), 1);
    const byPower = [...pool.slice(0, 5)].sort((a, b) => b.power - a.power);
    const second = pool.slice(0, 5).filter((p) => p !== byPower[0] && p !== byPower[1] && p !== byPower[2]).sort((a, b) => value(b) - value(a))[0] || pool[0];
    const middle = [byPower[0], byPower[1], byPower[2]];
    const top = [leadoff, second, middle[0], middle[1], middle[2]];
    const rest = pool.filter((p) => !top.includes(p)).sort((a, b) => value(b) - value(a));
    lineup.splice(0, lineup.length, ...top, ...rest);
    lineup.forEach((p, i) => { if (i === 0 || i === 1) p.risk += 5; });
    const mkPitcher = (role, veloBoost, ctl, sta) => ({
      name: makeName(), height: 72, weight: 200, role, throws: rng.pick(['R', 'R', 'L']),
      velo: mphToVelo(preset.velo + veloBoost + rng.gauss() * 1.5),
      control: rate(preset.control + ctl), movement: rate(preset.movement), stamina: rate(sta)
    });
    const pitchers = [
      mkPitcher('SP', 0, 0, preset.stamina + 4),
      ...[0, 1, 2, 3].map(() => mkPitcher('RP', 2, -2, 30))
    ];
    // Bench: backup catcher, middle infielder, outfielder, a bat, and a speed guy. Backups are a bit below starters.
    const benchSpec = [['C', -4], ['SS', -4], ['CF', -2], ['1B', -3], ['LF', -3]];
    const bench = benchSpec.map(([pos, drop], i) => {
      const bonus = POSITION_BONUS[pos] || {};
      const speedy = i === 4;
      return {
        name: makeName(), height: 72, weight: 200, pos, natural: pos,
        bats: rng.pick(['R', 'R', 'L', 'S']),
        contact: rate(preset.contact + drop, bonus.contact),
        power: rate(preset.power + drop, bonus.power),
        eye: rate(preset.eye + drop, bonus.eye),
        speed: rate(preset.speed + drop + (speedy ? 16 : 0), bonus.speed),
        arm: rate(preset.arm, bonus.arm),
        field: rate(preset.field + (speedy ? 4 : 0), bonus.field),
        risk: rate(50, speedy ? 8 : 0)
      };
    });
    return { name, style: STYLES[style] ? style : 'balanced', scale: 2, lineup, bench, pitchers };
  }

  function boxScore(g) {
    return g.teams.map((team) => {
      const batters = [];
      team.lineup.forEach((player, slot) => {
        for (const out of team.removed.filter((p) => p.slot === slot)) batters.push({ name: out.name, pos: out.entry ? `${out.entry}-${out.pos}` : out.pos, sub: !!out.entry, ...out.stat });
        batters.push({ name: player.name, pos: player.entry ? `${player.entry}-${player.pos}` : player.pos, sub: !!player.entry, ...player.stat });
      });
      return {
        name: team.name,
        batters,
        pitchers: team.pitchers.filter((player) => player.stat.pc > 0).map((player) => ({ name: player.name, ...player.stat }))
      };
    });
  }

  // Balls in play as Field Notes spray-chart entries (feet from home plate).
  function sprayChartEntries(g, dateText, only) {
    const date = dateText || new Date().toISOString().slice(0, 10);
    return g.battedBalls.map((item, index) => {
      if (only && !only.includes(index)) return null;
      const { ball, result, batter } = item;
      const point = ball.hr ? flightSim(ball.ev, ball.la, ball.dir, g.park, flyOf(g, ball, { noFence: true })).landing
        : ball.la >= 10 ? ((ball.airWall && !result.airOut) ? ball.airWall : ball.grd ? ball.pts[ball.firstLand] : ball.landing) : (result.spot || ball.landing);
      const fielded = !ball.hr && result.spot ? result.spot : null;
      const kind = result.kind;
      const label = kind === 'hr' ? 'home run' : kind === 'hit' ? ['out', 'single', 'double', 'triple', 'home run'][result.hitBases] : 'out';
      return {
        id: `game-${Date.now()}-${index}-${Math.floor(Math.random() * 1e6)}`,
        x: Math.round(point.x * 10) / 10,
        y: Math.round(point.y * 10) / 10,
        result: label,
        contact: contactWord(ball.la),
        exitVelo: Math.round(ball.ev * 10) / 10,
        launchAngle: Math.round(ball.la * 10) / 10,
        zone: null,
        fx: fielded ? Math.round(fielded.x * 10) / 10 : null,
        fy: fielded ? Math.round(fielded.y * 10) / 10 : null,
        batter: batter.name,
        date,
        stadiumId: g.park.id,
        altitude: Math.round(g.env.alt),
        temperature: g.env.temp,
        wind: ball.wind ? { x: Math.round(ball.wind.x * 10) / 10, y: Math.round(ball.wind.y * 10) / 10 } : null,
        coordSpace: 'feet'
      };
    }).filter(Boolean);
  }

  /* ------------------------------------------------------------ live play
     A time-stepped version of a ball in play. Fielders chase the ball, throw to bases, and
     runners run; either side can be steered with live.command(). Decisions the user does
     not make fall back to the same AI the instant model approximates.
  */

  const RAMP_TIME = 1.8;
  const LIVE_PATH = [BASE_XY[0], BASE_XY[1], BASE_XY[2], BASE_XY[3], BASE_XY[0]];

  function pathPoint(prog) {
    const p = clamp(prog, 0, 4);
    const i = Math.min(Math.floor(p), 3);
    const f = p - i;
    const a = LIVE_PATH[i];
    const b = LIVE_PATH[i + 1];
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  }

  const flightSecs = (fielder, distance, target) => distance <= 12 ? distance / fielder.fp.speed
    : throwPlan(fielder.fp.armFps * throwMotion(fielder, target).arm, distance).duration;

  function runDistance(time, vmax, ramp0) {
    const t = Math.max(0, time), ramp = Math.min(t, RAMP_TIME);
    return vmax * (ramp0 * ramp + (1 - ramp0) * ramp * ramp / (2 * RAMP_TIME) + Math.max(0, t - RAMP_TIME));
  }

  function runTime(feet, vmax, ramp0) {
    if (feet <= 0) return 0;
    const rampFeet = runDistance(RAMP_TIME, vmax, ramp0);
    if (feet >= rampFeet) return RAMP_TIME + (feet - rampFeet) / vmax;
    if (ramp0 >= 1) return feet / vmax;
    const a = vmax * (1 - ramp0) / (2 * RAMP_TIME), b = vmax * ramp0;
    return (Math.sqrt(b * b + 4 * a * feet) - b) / (2 * a);
  }

  function createLivePlay(g, ball, batterRunner, ctl) {
    const rng = g.rng;
    const batHuman = !!(ctl && ctl.batHuman);
    const fieldHuman = !!(ctl && ctl.fieldHuman);
    const defenders = defenseList(g);
    const fr = fieldBall(ball, defenders, { park: g.park });
    const fielders = defenders.map((d) => ({ pos: d.pos, p: d.p, fp: d.fp, x: d.x, y: d.y, holdT: 0, dest: null, run: null, thinkAt: 0 }));
    const F = fielders.find((f) => f.pos === fr.f.pos);
    const outsBefore = g.outs;
    const live = { t: 0, done: false, events: [] };
    const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const log = (text) => live.events.push({ t: live.t, text });

    // ---- the ball's fate at the first touch
    const airCatch = fr.air && !rng.chance(fieldingErrorP(F, true));
    const fumbleDelay = airCatch ? 0 : fr.air ? 0.9 : rng.chance(fieldingErrorP(F, false)) ? 1.0 : 0;
    const pickupAt = fr.t + fumbleDelay;
    F.move = fr.move;
    F.pickup = fr.pickup;
    if (!fr.routes) F.run = { t0: Math.min(F.fp.react, Math.max(0, fr.t - 0.05)), t1: fr.t, x0: F.x, y0: F.y, x1: fr.body.x, y1: fr.body.y };

    const ballState = { mode: 'flight', x: 0, y: 0, z: 3, holder: null, throwing: null, chaser: null, pickupAt: null };
    const throwsLog = [];
    const umpireCalls = [];
    let lineCallPending = ball.lineCall;
    const errors = [];
    let plan;
    let planRelay = false;
    let deadBall = false;
    let hitRunner = null;
    let airOut = false;
    let tagOut = false;
    let errBatter = false;
    let thirdOut = null;
    let nextAi = 0;
    let missedIntercept = false;

    // ---- who covers which base (kept current by replan)
    const covers = {};
    let nextPlan = 0;
    for (const f of fielders) { f.hx = f.x; f.hy = f.y; f.lastDest = null; }
    function replan() {
      const b = ballState;
      const carryingReceiver = b.holder && b.holder.playReceiver;
      const busy = (f) => !!(f.run || b.chaser === f || b.holder === f || f.relayTo != null || f.chase
        || carryingReceiver === f || (b.throwing && b.throwing.receiver === f) || (f === F && b.mode === 'flight'));
      const heading = [];
      for (const e of entries) {
        if (!alive(e)) continue;
        if (e.state === 'run') heading.push(e.target);
        else if (e.state === 'back') heading.push(e.retreat);
        else if (e.prog < 4) heading.push(Math.floor(e.prog + 1e-6) + 1);
      }
      if (b.holder && typeof b.holder.playBase === 'number') heading.push(b.holder.playBase);
      if (typeof plan === 'number') heading.push(plan);
      const bases = heading.filter((x) => x >= 1 && x <= 4);
      const free = new Set(fielders.filter((f) => !busy(f)).map((f) => f.pos));
      const ballPt = b.mode === 'flight' ? readTarget(observedBall(ball, Math.min(ball.pts.length - 1, Math.floor(live.t * 120)), F.fp), F, live.t, g.park) : { x: b.x, y: b.y };
      const holder = b.holder || (b.mode === 'flight' ? F : b.chaser);
      const assignments = supportPlan({
        park: g.park,
        fielders: fielders.map((f) => ({ pos: f.pos, x: f.x, y: f.y, hx: f.hx, hy: f.hy, speed: f.fp.speed })),
        free, ball: ballPt, thrower: holder ? { x: holder.x, y: holder.y } : null,
        bases, lead: bases.length ? Math.max(...bases) : 0,
        coveredBases: [
          ...(carryingReceiver ? [b.holder.playBase] : []),
          ...(b.throwing && !b.throwing.relay ? [b.throwing.base] : [])
        ]
      });
      for (const base of Object.keys(covers)) delete covers[base];
      if (carryingReceiver) covers[b.holder.playBase] = carryingReceiver;
      if (b.throwing && !b.throwing.relay) covers[b.throwing.base] = b.throwing.receiver;
      for (const f of fielders) {
        const p = assignments[f.pos];
        if (!p || !free.has(f.pos)) continue;
        if (!f.lastDest || Math.hypot(f.lastDest.x - p.x, f.lastDest.y - p.y) > 3
          || f.job !== p.job || (p.job === 'cover' && f.coverBase !== p.base)) {
          f.lastDest = { x: p.x, y: p.y };
          f.dest = Math.hypot(f.x - p.x, f.y - p.y) > 1.5 ? { x: p.x, y: p.y } : null;
        }
        f.job = p.job;
        f.coverBase = p.job === 'cover' ? p.base : null;
        if (p.job === 'cover' && !(b.throwing && b.throwing.base === p.base)) covers[p.base] = f;
      }
    }

    // ---- runners
    const entries = [];
    const mk = (r, start) => ({
      r, id: start, start, prog: start, from: start, state: 'hold', target: start, tau: 0, s0: 0.2, delay: 0,
      out: false, outBy: null, scored: false, scoredAt: null, reached: start, userCont: undefined,
      mustReturn: false, retreat: start, noise: rng.gauss() * 0.08, isBatter: start === 0,
      forcedInit: start <= 1 || (start === 2 && !!g.bases[0]) || (start === 3 && !!g.bases[0] && !!g.bases[1])
    });
    g.bases.forEach((runner, index) => { if (runner) entries.push(mk(runner, index + 1)); });
    entries.sort((a, b) => b.start - a.start);
    const batter = mk(batterRunner, 0);
    entries.push(batter);

    const vmaxOf = (e) => 90 / seg(e.r.p);
    const runEta = (e, feet) => Math.max(0, e.delay) + Math.max(0,
      runTime(runDistance(e.tau, vmaxOf(e), e.s0) + Math.max(0, feet), vmaxOf(e), e.s0) - e.tau);
    const alive = (e) => !e.out && !e.scored;
    const countOuts = () => entries.reduce((n, e) => n + (e.out ? 1 : 0), 0);
    const isForced = (e) => e.forcedInit && !entries.some((o) => o.start < e.start && o.out);
    const forcedAt = (e, base) => isForced(e) && base === e.start + 1 && e.prog < base - 1e-6;
    const blocked = (base) => base < 4 && entries.some((o) => alive(o) && o.state === 'hold' && Math.abs(o.prog - base) < 1e-6);
    const canBack = (e) => e.state === 'run' && (e.from >= 1 || !e.isBatter) && !(e.from === e.start && isForced(e));

    function startRun(e, nextBase, jump) {
      e.state = 'run';
      e.target = nextBase;
      e.from = Math.floor(e.prog + 1e-6);
      e.tau = 0;
      e.s0 = jump ? 0.45 : 0.2;
      e.userCont = undefined;
    }

    batter.state = 'run';
    batter.target = 1;
    batter.delay = 0.12;
    batter.s0 = 0.15;

    const twoOuts = outsBefore >= 2;
    for (const e of entries) {
      if (e.isBatter) continue;
      if (twoOuts || (e.forcedInit && !fr.air)) startRun(e, e.start + 1, true);
    }

    // ---- ETA helpers
    function deliverySecs(h, base) {
      const direct = flightSecs(h, dist2(h, baseXY(base)), baseXY(base));
      const cut = cutoffFor(h, base);
      return cut ? direct - Math.max(0, cut.saves) : direct;
    }

    function ballEta(base) {
      const target = baseXY(base);
      const b = ballState;
      if (b.mode === 'held') {
        const h = b.holder;
        return Math.max(0, h.transferAt - live.t) + Math.max(0, transferSecs(h, target) - h.holdT) + deliverySecs(h, base) + 0.1;
      }
      if (b.mode === 'thrown') {
        const th = b.throwing;
        const rest = th.t1 >= live.t ? th.t1 - live.t : dist2(th.receiver, b) / th.receiver.fp.speed + 0.15;
        if (th.base === base && !th.relay) return rest;
        const who = th.receiver || F;
        return rest + transferSecs(who, target) + flightSecs(who, dist2(th.to, target), target) + 0.1;
      }
      if (b.mode === 'loose') {
        const who = b.chaser || F;
        const wait = b.pickupAt != null ? Math.max(0, b.pickupAt - live.t, (who.move ? who.move.end : 0) - live.t) : 1;
        return wait + transferSecs(who, target) + flightSecs(who, dist2(b, target), target) + 0.1;
      }
      return Math.max(0, pickupAt - live.t, (F.move ? F.move.end : 0) - live.t) + transferSecs(F, target) + flightSecs(F, dist2({ x: fr.x, y: fr.y }, target), target) + 0.1;
    }

    function sitCtx() {
      const bat = g.half;
      const lead = g.score[bat] + entries.filter((e) => e.scored).length - g.score[1 - bat];
      const final = g.inning >= g.innings;
      return {
        lead, final, outs: outsBefore + countOuts(),
        late: g.inning >= g.innings - 1,
        walkoff: g.half === 1 && final,
        needed: 1 - lead
      };
    }

    // Base-running choice: weighs the situation (outs, score, inning) and the runner's RISK rating.
    function aiGo(e, nextBase) {
      if (nextBase > 4 || blocked(nextBase)) return false;
      const need = e.state === 'run' ? runEta(e, (nextBase - e.prog) * 90) : runTime((nextBase - e.prog) * 90, vmaxOf(e), 0.2);
      const s = sitCtx();
      let margin = nextBase === 4 ? 0.4 : 0.3;
      if (s.outs >= 2) margin -= 0.2;
      else if (nextBase === 3) margin += s.outs === 0 ? 0.2 : 0.1;
      margin -= ((e.r.p.risk || 50) - 50) * 0.008;
      if (nextBase === 4) {
        if (s.walkoff && s.needed <= 1) margin -= 0.5;
        else if (s.late && s.lead >= -1 && s.lead <= 0) margin -= 0.15;
      }
      if (s.lead >= 5) margin += 0.12;
      else if (s.late && s.lead <= -3) margin -= 0.05;
      return need + margin + e.noise < ballEta(nextBase);
    }

    // ---- ball and fielder handling
    function pickUp(h) {
      const b = ballState;
      const pose = motion.pose(h.move, live.t, h.fp.height);
      h.pickup = {
        vx: h.move ? 0 : h.vx || 0, vy: h.move ? 0 : h.vy || 0,
        backhand: (b.x - h.x) * (h.p.throws === 'L' ? -1 : 1) > 0.8 ? 1 : 0
      };
      if (pose.z || pose.tilt) h.pickup = null;
      h.throwTarget = baseXY(typeof plan === 'number' ? plan : 1);
      h.playBase = null;
      h.playReceiver = null;
      h.caughtAt = live.t;
      h.carryPickup = b.mode !== 'thrown';
      b.mode = 'held';
      b.holder = h;
      h.dest = null;
      b.throwing = null;
      b.chaser = null;
      b.pickupAt = null;
      h.holdT = 0;
      h.transferAt = Math.max(live.t, h.move ? h.move.end : 0);
      h.run = null;
      h.thinkAt = 0;
      h.chase = false;
      b.x = h.x;
      b.y = h.y;
      b.z = 3 + motion.pose(h.move, live.t).z;
    }

    function looseBall(x, y, chaser, wait) {
      const b = ballState;
      b.mode = 'loose';
      b.x = x;
      b.y = y;
      b.z = 0;
      b.holder = null;
      b.throwing = null;
      b.chaser = chaser;
      chaser.run = null;
      chaser.dest = { x, y };
      b.pickupAt = live.t + wait;
    }

    function nearestFielder(point) {
      let best = null;
      let bestEta = Infinity;
      for (const f of fielders) {
        const eta = dist2(f, point) / f.fp.speed;
        if (eta < bestEta) {
          bestEta = eta;
          best = f;
        }
      }
      return { f: best, eta: bestEta };
    }

    function batterEta() {
      return toFirst(batterRunner.p);
    }

    function catchInAir() {
      pickUp(F);
      airOut = true;
      batter.out = true;
      batter.outBy = 'air';
      batter.outAt = live.t;
      umpireCalls.push({ t: live.t, out: true, x: ballState.x, y: ballState.y });
      log('Caught by ' + F.pos);
      for (const e of entries) {
        if (e.isBatter || !alive(e) || e.state !== 'run' || e.prog <= e.start + 0.02) continue;
        e.mustReturn = true;
        e.state = 'back';
        e.retreat = e.start;
        e.tau = 0;
        e.s0 = 0.35;
      }
      checkThird('air', true);
    }

    function checkThird(how, force) {
      if (!thirdOut && outsBefore + countOuts() >= 3) thirdOut = { how, force, t: live.t };
    }

    function ruleRunner(e, c) {
      const missed = rng.chance(0.3 * Math.exp(-c.sec / 0.3));
      c.t = live.t;
      c.ruledOut = missed ? !c.truthOut : c.truthOut;
      const spot = c.how === 'tag' ? pathPoint(e.prog) : baseXY(c.base);
      umpireCalls.push({ t: live.t, out: c.ruledOut, x: spot.x, y: spot.y });
      e.call = c;
      e.rulings = e.rulings || [];
      e.rulings.push(c);
      const id = `live:${e.id}${e.rulings.length > 1 ? ':' + e.rulings.length : ''}`;
      live.calls.push({
        id, kind: 'field', hurt: c.ruledOut ? g.half : 1 - g.half, wrong: missed,
        label: `the ${c.ruledOut ? 'out' : 'safe'} call on ${e.r.p.name} at ${bagName(c.base)}`,
        flip: () => { c.ruledOut = c.truthOut; },
        doubt: 0.03 + 0.2 * Math.exp(-c.sec / 0.25), leverage: 0.6, window: missed || c.sec < 0.6
      });
      if (!c.ruledOut) {
        e.safeBase = c.base;
        log(`${e.r.p.name} called safe at ${bagName(c.base)}`);
        return false;
      }
      e.out = true;
      e.state = 'out';
      e.outBy = c.how;
      e.outBase = c.base;
      e.outAt = live.t;
      e.scored = false;
      if (c.how === 'tag') tagOut = true;
      log(`${e.r.p.name} called out at ${bagName(c.base)}`);
      checkThird(c.how, c.how === 'force' || (e.isBatter && e.reached < 1));
      return true;
    }

    function putOut(e, how, base) {
      base = Math.max(1, Math.min(4, Math.round(base)));
      if (e.safeBase === base) return;
      ruleRunner(e, { truthOut: true, base, sec: how === 'tag' ? 0.2 : Math.max(0, e.target - e.prog) * seg(e.r.p), how });
    }

    // A batted ball that strikes a runner off a base kills the play: he is out and the batter gets first.
    function hitByBall(e) {
      deadBall = true;
      hitRunner = e;
      const spot = pathPoint(e.prog);
      umpireCalls.push({ t: live.t, out: true, x: spot.x, y: spot.y });
      e.out = true;
      e.outBy = 'hit';
      e.outAt = live.t;
      e.outBase = Math.max(1, Math.floor(e.prog));
      e.call = null;
      e.state = 'hold';
      log(`The ball hits ${e.r.p.name}`);
      for (const o of entries) {
        if (o === e || !alive(o)) continue;
        o.state = 'hold';
        o.userCont = undefined;
        if (o.isBatter) {
          o.prog = 1;
          o.reached = 1;
        } else {
          o.prog = isForced(o) ? o.start + 1 : o.start;
          o.reached = Math.max(o.reached, o.prog);
        }
        o.target = o.prog;
        o.from = o.prog;
        if (o.prog >= 4) {
          o.scored = true;
          o.scoredAt = live.t;
          o.state = 'scored';
        }
      }
      const near = nearestFielder(ballState);
      looseBall(ballState.x, ballState.y, near.f, near.eta);
      checkThird('hit', false);
    }

    function ballFlow() {
      const b = ballState;
      if (b.mode === 'flight') {
        if (live.t >= fr.t) {
          if (missedIntercept || !canFieldAt(F, { x: fr.x, y: fr.y, z: fr.z })) {
            missedIntercept = true;
            const point = ball.pts[Math.min(ball.pts.length - 1, Math.round(live.t * 120))];
            b.x = point.x; b.y = point.y; b.z = point.z;
            F.dest = { x: point.x, y: point.y };
            if (canFieldAt(F, point)) {
              if (airCatch && live.t < ball.pts[ball.firstLand].t && (ball.wallHit < 0 || live.t < ball.pts[ball.wallHit].t)) catchInAir();
              else pickUp(F);
            } else if (live.t >= ball.pts[ball.pts.length - 1].t) {
              const near = nearestFielder(point);
              looseBall(point.x, point.y, near.f, near.eta);
            }
            return;
          }
          if (airCatch) catchInAir();
          else if (fumbleDelay > 0) {
            looseBall(fr.x, fr.y, F, fumbleDelay);
            b.pickupAt = pickupAt;
            if (fr.air) {
              errors.push({ pos: F.pos });
              errBatter = true;
              log(F.pos + ' drops it');
            } else if (fr.t + transferSecs(F) + flightSecs(F, dist2({ x: fr.x, y: fr.y }, baseXY(1))) < batterEta()) {
              errors.push({ pos: F.pos });
              errBatter = true;
              log(F.pos + ' bobbles it');
            }
          } else pickUp(F);
          return;
        }
        const idx = Math.min(ball.pts.length - 1, Math.round(live.t * 120));
        const point = ball.pts[idx];
        b.x = point.x;
        b.y = point.y;
        b.z = point.z;
        if (!deadBall && b.z < 5) {
          const struck = entries.find((e) => !e.isBatter && alive(e) && (e.state === 'run' || e.state === 'back' || e.state === 'hold')
            && e.delay <= 0 && Math.abs(e.prog - Math.round(e.prog)) > 0.03 && dist2(pathPoint(e.prog), b) < 2.5);
          if (struck) hitByBall(struck);
        }
      } else if (b.mode === 'loose') {
        if (b.pickupAt != null && live.t >= b.pickupAt) {
          if (canFieldAt(b.chaser, b)) pickUp(b.chaser);
          else b.chaser.dest = { x: b.x, y: b.y };
        }
      } else if (b.mode === 'thrown') {
        const th = b.throwing;
        const elapsed = live.t - th.t0;
        const point = trajectoryPoint(th.flight.pts, elapsed);
        b.x = point.x; b.y = point.y; b.z = point.z;
        const catcher = fielders.find(f => (f !== th.thrower || elapsed > 0.3)
          && elapsed > 0.05 && canFieldAt(f, point));
        if (catcher) {
          th.record.t1 = live.t;
          th.record.to = { x: point.x, y: point.y };
          th.record.receiver = catcher.pos;
          const distance = dist2(th.from, th.target);
          const lateral = Math.abs((point.x - th.from.x) * (th.target.y - th.from.y)
            - (point.y - th.from.y) * (th.target.x - th.from.x)) / distance;
          if (lateral > 16 || (elapsed > th.flight.duration + 0.5 && dist2(point, th.target) > 16)) {
            th.record.wild = true;
            errors.push({ pos: th.thrower.pos });
            if (th.base === 1) errBatter = true;
          }
          if (th.relay && catcher === th.receiver) catcher.relayTo = th.relayBase;
          pickUp(catcher);
          if (!th.relay && dist2(catcher, th.target) > 2.2 && dist2(catcher, th.target) <= 12) catcher.dest = { ...th.target };
          return;
        }
        if (live.t >= th.nextRead) {
          th.nextRead = live.t + 0.12;
          const index = Math.min(th.flight.pts.length - 1, Math.floor(elapsed * 120));
          const read = observedBall(th.flight, index, th.receiver.fp);
          const v2 = read.vx ** 2 + read.vy ** 2;
          const along = v2 > 1 ? ((th.target.x - read.x) * read.vx + (th.target.y - read.y) * read.vy) / v2 : 0;
          const ahead = clamp(along, read.age + 0.1, 1.5);
          const predicted = read.z > 0 ? projectRead(read, ahead)
            : { x: read.x + read.vx * ahead, y: read.y + read.vy * ahead };
          th.receiver.dest = along > 1.5 && elapsed < th.flight.duration
            ? { ...th.target } : keepInside(g.park, predicted.x, predicted.y);
          if (elapsed > th.flight.duration + 0.25) {
            const near = nearestFielder(b);
            near.f.dest = keepInside(g.park, read.x + read.vx * 0.2, read.y + read.vy * 0.2);
          }
        }
        const last = th.flight.pts[th.flight.pts.length - 1];
        if (elapsed >= last.t) {
          if (th.flight.escaped) {
            deadBall = true;
            for (const e of entries) {
              if (!alive(e)) continue;
              const award = th.awards.get(e.id);
              e.mustReturn = false;
              if (award > e.prog) startRun(e, award, true);
            }
            log('Throw out of play — two-base award');
          }
          th.record.t1 = live.t;
          th.record.to = { x: b.x, y: b.y };
          th.record.wild = true;
          errors.push({ pos: th.thrower.pos });
          if (th.base === 1) errBatter = true;
          const rest = keepInside(g.park, b.x, b.y);
          const near = nearestFielder(rest);
          looseBall(rest.x, rest.y, near.f, near.eta);
        }
      } else {
        b.x = b.holder.x;
        b.y = b.holder.y;
        b.z = 3 + motion.pose(b.holder.move, live.t).z;
      }
    }

    function canFieldAt(f, point) {
      return motion.canReach(motion.pose(f.move, live.t, f.fp.height), point.x - f.x, point.y - f.y, point.z);
    }

    function inPark(f) {
      const p = keepInside(g.park, f.x, f.y);
      f.x = p.x;
      f.y = p.y;
    }

    function moveFielders(dt) {
      for (const f of fielders) {
        const x0 = f.x, y0 = f.y;
        if (f === F && fr.routes && ballState.mode === 'flight' && live.t <= fr.t) {
          const at = fieldingPosition({ ...fr, route: fr.routes[F.pos] }, live.t);
          f.x = at.x; f.y = at.y;
        } else if (f === F && fr.routes && ballState.mode === 'flight' && !missedIntercept) {
          f.dest = { x: fr.body.x, y: fr.body.y };
          const d = dist2(f, f.dest), step = Math.min(d, f.fp.speed * dt);
          if (d) { f.x += (f.dest.x - f.x) / d * step; f.y += (f.dest.y - f.y) / d * step; }
        } else if (ballState.holder === f && f.playBase == null && f.carryPickup && f.pickup && live.t - f.caughtAt < 1.2 && !f.move) {
          const carry = Math.exp(-(live.t - f.caughtAt) / 0.75);
          f.x += f.pickup.vx * carry * dt;
          f.y += f.pickup.vy * carry * dt;
        } else if (f.run) {
          const u = clamp((live.t - f.run.t0) / Math.max(0.05, f.run.t1 - f.run.t0), 0, 1);
          const k = runEase(u);
          f.x = f.run.x0 + (f.run.x1 - f.run.x0) * k;
          f.y = f.run.y0 + (f.run.y1 - f.run.y0) * k;
          if (u >= 1) f.run = null;
        } else if (f.dest) {
          const dx = f.dest.x - f.x;
          const dy = f.dest.y - f.y;
          const d = Math.hypot(dx, dy);
          const step = f.fp.speed * dt;
          if (d <= step) {
            f.x = f.dest.x;
            f.y = f.dest.y;
            f.dest = null;
          } else {
            f.x += dx / d * step;
            f.y += dy / d * step;
          }
        }
        inPark(f);
        f.vx = (f.x - x0) / dt; f.vy = (f.y - y0) / dt;
      }
    }

    // Throw choice: a walk-off run must be thrown at no matter the odds; with two outs any sure out
    // ends the inning (a force also erases runs); a big lead means only sure plays.
    function aiThrow(h) {
      const s = sitCtx();
      const defLead = -s.lead;
      const riskAdj = ((h.p.risk || 50) - 50) * 0.004;
      const cands = [];
      for (const e of entries) {
        if (!alive(e)) continue;
        if (e.state === 'back') {
          // A runner who turned around is still live: go after him at the base he is heading back to.
          const base = e.retreat;
          if (base < 1 || e.prog <= base + 0.02) continue;
          const tb = deliverySecs(h, base) + 0.1;
          const need = runEta(e, (e.prog - base) * 90);
          cands.push({ e, base, tb, forced: false, slack: need + e.noise - (tb + 0.05 - riskAdj), feasible: need + e.noise > tb + 0.05 - riskAdj, back: true });
          continue;
        }
        if (e.state !== 'run' || e.prog >= e.target) continue;
        const base = e.target;
        const tb = deliverySecs(h, base) + 0.1;
        const need = runEta(e, (base - e.prog) * 90);
        const forced = forcedAt(e, base);
        let margin = forced ? 0 : 0.12;
        if (defLead >= 3 && !s.walkoff) margin += 0.12;
        margin -= riskAdj;
        const slack = need + e.noise - (tb + margin);
        cands.push({ e, base, tb, forced, slack, feasible: slack > 0 });
      }
      if (!cands.length) return returnBase(h);
      const winning = cands.find((c) => s.walkoff && s.needed <= 1 && c.base === 4);
      if (s.outs >= 2) {
        const scoresFirst = (c) => entries.some((o) => o !== c.e && alive(o) && o.state === 'run' && o.target === 4
          && runEta(o, (4 - o.prog) * 90) + o.noise < c.tb);
        const ok = cands.filter((c) => c.feasible && (c.forced || c.base === 4 || !scoresFirst(c)));
        if (ok.length) return ok.sort((a, b) => (b.slack + (b.forced ? 0.15 : 0)) - (a.slack + (a.forced ? 0.15 : 0)))[0].base;
        if (winning) return 4;
        if (INFIELD.has(h.pos)) return 'hold';
      }
      if (winning) return 4;
      const feasible = cands.filter((c) => c.feasible);
      if (feasible.length) return Math.max(...feasible.map((c) => c.base));
      // Nobody is a sure out, but a throw still holds runners and gets the ball back to the infield.
      // Go at the closest play; if every runner is easily safe, keep the lead runner honest.
      const ranked = cands.slice().sort((a, b) => b.slack - a.slack);
      const closest = ranked[0];
      const outfield = !INFIELD.has(h.pos);
      const farOut = dist2(h, { x: 0, y: 60 }) > 130;
      if (closest.slack > -0.5 || ((outfield || farOut) && closest.slack > -2.5)) {
        return outfield && closest.slack <= -0.5 ? Math.max(...cands.map((c) => c.base)) : closest.base;
      }
      return 'hold';
    }

    // With no runner moving, an outfielder still throws the ball back in at the lead runner's next base.
    function returnBase(h) {
      if (INFIELD.has(h.pos) || dist2(h, { x: 0, y: 60 }) < 130) return 'hold';
      const lead = entries.filter((e) => alive(e) && e.state === 'hold' && e.prog >= 1 && e.prog < 4);
      if (!lead.length) return 'hold';
      return Math.min(4, Math.max(...lead.map((e) => e.prog)) + 1);
    }

    function receiverFor(base, thrower) {
      const cover = covers[base];
      if (cover && cover !== thrower && !cover.chase && ballState.chaser !== cover && !cover.relayTo) return cover;
      let best = null;
      let bestEta = Infinity;
      for (const f of fielders) {
        if (f === thrower || f === ballState.chaser || f.relayTo != null || f.chase) continue;
        const reserved = Object.entries(covers).some(([bag, man]) => man === f && Number(bag) !== base);
        const eta = dist2(f, baseXY(base)) / f.fp.speed + (reserved ? 5 : 0)
          + (INFIELD.has(f.pos) ? 0 : 3);
        if (eta < bestEta) {
          bestEta = eta;
          best = f;
        }
      }
      covers[base] = best;
      return best;
    }

    // A relay man cuts the throw off when the arm is weak or the distance is long.
    function cutoffFor(h, base) {
      return cutoffPlan(h, baseXY(base), fielders, receiverFor(base, h));
    }

    function doThrow(h, base, relay) {
      const target = baseXY(base);
      const d = dist2(h, target);
      h.throwTarget = target;
      const cut = relay ? cutoffFor(h, base) : null;
      const aim = cut ? cut.mid : target;
      const receiver = cut ? cut.man : receiverFor(base, h);
      const duration = flightSecs(h, dist2(h, aim), aim);
      const receiverTime = Math.max(0, dist2(receiver, aim) - receiver.fp.reach) / receiver.fp.speed;
      if (d <= 12 || receiverTime > Math.max(0, duration - 0.08)) {
        h.playBase = base;
        h.playReceiver = receiver;
        h.dest = { x: target.x, y: target.y };
        receiver.dest = { ...aim };
        receiver.lastDest = null;
        return;
      }
      h.playBase = null;
      h.playReceiver = null;
      plan = undefined;
      const flight = throwFlight(h, aim, g.park, rng, { wind: ball.wind, rho: g.env ? g.env.rho : 1 });
      const from = { x: h.x, y: h.y }, to = trajectoryPoint(flight.pts, flight.duration);
      receiver.dest = { ...aim };
      const record = {
        from, to, t0: live.t, t1: live.t + flight.duration, base,
        receiver: receiver.pos, thrower: h.pos, wild: false, relay: !!cut,
        points: flight.pts,
        speed: flight.speed, directionError: flight.directionError, angleError: flight.angleError, perfect: flight.perfect
      };
      ballState.mode = 'thrown';
      ballState.holder = null;
      ballState.x = flight.pts[0].x;
      ballState.y = flight.pts[0].y;
      ballState.z = flight.pts[0].z;
      const fromPitch = INFIELD.has(h.pos) && throwsLog.length === 0
        && !entries.every(e => e.reached > e.start);
      ballState.throwing = {
        from, to, t0: live.t, t1: record.t1, base: cut ? -1 : base, receiver, thrower: h,
        target: { ...aim }, flight, record, nextRead: live.t + 0.15, relay: !!cut, relayBase: base,
        awards: new Map(entries.filter(alive).map(e => [e.id, Math.min(4, (fromPitch ? e.start : Math.floor(e.prog)) + 2)]))
      };
      throwsLog.push(record);
      log(cut ? `${h.pos} throws to the cutoff man, ${cut.man.pos}` : `${h.pos} throws to ${base === 4 ? 'home' : base + 'B'}`);
    }

    function holderLogic() {
      const b = ballState;
      if (b.mode !== 'held') return;
      const h = b.holder;
      h.holdT = Math.max(0, live.t - h.transferAt);
      if (live.t - h.caughtAt >= 1.2) h.pickup = null;
      if (typeof plan === 'number') h.throwTarget = baseXY(plan);
      if (h.move && live.t < h.move.end) return;
      if (deadBall || thirdOut) {
        h.dest = null;
        h.chase = false;
        h.relayTo = null;
        h.playBase = null;
        h.playReceiver = null;
        return;
      }
      if (fieldHuman && plan === 'hold') {
        if (h.playBase != null) h.dest = null;
        h.playBase = null;
        h.playReceiver = null;
      }
      if (h.playBase != null && dist2(h, baseXY(h.playBase)) <= 1.5) {
        h.dest = null;
        h.playBase = null;
        h.playReceiver = null;
        if (fieldHuman) plan = 'hold';
      }
      if (h.relayTo != null) {
        if (h.holdT >= transferSecs(h, baseXY(h.relayTo))) {
          const next = h.relayTo;
          h.relayTo = null;
          doThrow(h, next, false);
        }
        return;
      }
      if (h.dest && !h.chase && h.playBase == null) return;
      if (h.holdT < transferSecs(h) || live.t < h.thinkAt) return;
      h.thinkAt = live.t + 0.1;
      let choice;
      let relay = false;
      if (fieldHuman && plan === 'hold') choice = 'hold';
      else if (fieldHuman && typeof plan === 'number') {
        choice = plan;
        relay = planRelay;
      } else if (h.playBase != null) choice = h.playBase;
      else {
        choice = aiThrow(h);
        if (choice !== 'hold') {
          const cut = cutoffFor(h, choice);
          relay = !!cut && cut.saves > 0.12;
        }
      }
      if (choice !== 'hold') {
        const cut = relay ? cutoffFor(h, choice) : null;
        h.throwTarget = cut ? cut.mid : baseXY(choice);
        if (h.holdT < transferSecs(h, h.throwTarget)) return;
        h.chase = false;
        h.dest = null;
        doThrow(h, choice, relay);
        return;
      }
      // Nothing to throw to: run down any runner caught between bases until everyone is stopped.
      const prey = entries.find((e) => alive(e) && e.state === 'back' && e.delay <= 0);
      if (prey && !(fieldHuman && plan === 'hold')) {
        h.chase = true;
        h.dest = pathPoint(prey.prog);
      } else h.chase = false;
    }

    function runnersTick(dt) {
      for (const e of entries) {
        if (!alive(e) || (e.state !== 'run' && e.state !== 'back')) continue;
        if (e.delay > 0) {
          e.delay -= dt;
          continue;
        }
        const before = runDistance(e.tau, vmaxOf(e), e.s0);
        e.tau += dt;
        const step = (runDistance(e.tau, vmaxOf(e), e.s0) - before) / 90;
        if (e.state === 'run') {
          e.prog += step;
          if (e.prog >= e.target) arrive(e);
        } else {
          e.prog -= step;
          if (e.prog <= e.retreat) {
            e.prog = e.retreat;
            e.state = 'hold';
            e.target = e.retreat;
            e.mustReturn = false;
            e.tau = 0;
            e.s0 = 0.2;
          }
        }
      }
    }

    function arrive(e) {
      const base = e.target;
      e.prog = base;
      e.reached = Math.max(e.reached, base);
      e.from = base;
      const th = ballState.mode === 'thrown' ? ballState.throwing : null;
      if (e.safeBase !== base && th && !th.relay && dist2(th.to, baseXY(base)) < 8
        && th.t1 >= live.t - 0.05 && th.t1 - live.t < 1.5) {
        const how = isForced(e) && base === e.start + 1 ? 'force' : 'tag';
        if (ruleRunner(e, { truthOut: false, base, sec: Math.max(0, th.t1 - live.t), how })) return;
      }
      if (!deadBall && !thirdOut && (!e.call || e.call.base !== base || e.call.t !== live.t) && e.safeBase !== base) {
        const spot = baseXY(base);
        umpireCalls.push({ t: live.t, out: false, x: spot.x, y: spot.y });
      }
      if (base >= 4) {
        e.scored = true;
        e.scoredAt = live.t;
        e.state = 'scored';
        return;
      }
      const want = !thirdOut && !deadBall && (e.userCont !== undefined ? e.userCont : aiGo(e, base + 1));
      e.userCont = undefined;
      if (want && !blocked(base + 1)) e.target = base + 1;
      else {
        e.state = 'hold';
        e.tau = 0;
        e.s0 = 0.2;
      }
    }

    function outChecks() {
      if (deadBall) return;
      const b = ballState;
      if (b.mode !== 'held') return;
      const h = b.holder;
      for (const e of entries) {
        if (thirdOut) return;
        if (!alive(e)) continue;
        if (e.state === 'run' && forcedAt(e, e.target) && dist2(h, baseXY(e.target)) <= 2.2) {
          putOut(e, 'force', e.target);
          continue;
        }
        if (e.mustReturn && e.state === 'back' && e.prog > e.retreat + 0.001 && dist2(h, baseXY(e.retreat)) <= 2.2) {
          putOut(e, 'force', e.retreat);
          continue;
        }
        if ((e.state === 'run' || e.state === 'back') && e.delay <= 0 && dist2(h, pathPoint(e.prog)) <= 3) {
          putOut(e, 'tag', Math.max(1, Math.round(e.prog)));
        }
      }
    }

    function aiRunners() {
      if (thirdOut || deadBall) return;
      if (live.t < nextAi) return;
      nextAi = live.t + 0.2;
      if (ballState.mode === 'flight' && fr.air && !twoOuts) return;
      for (const e of entries) {
        if (!alive(e) || e.state !== 'hold' || e.prog >= 4 || batHuman) continue;
        if (aiGo(e, e.prog + 1)) startRun(e, e.prog + 1, false);
      }
    }

    function endCheck() {
      const stopped = entries.every((e) => !alive(e) || (e.state === 'hold' && Math.abs(e.prog - Math.round(e.prog)) < 1e-6));
      const b = ballState;
      const settled = b.mode === 'held' && live.t - b.holder.caughtAt >= 1.5
        && !b.holder.dest && b.holder.holdT >= transferSecs(b.holder) + 0.15
        && (!b.holder.move || live.t >= b.holder.move.end);
      if (stopped && settled) finish();
    }

    function finish() {
      live.done = true;
    }

    live.step = (dt) => {
      if (live.done) return;
      live.t += dt;
      if (lineCallPending && live.t >= lineCallPending.t) {
        if (ballState.mode === 'flight') umpireCalls.push({ ...lineCallPending });
        lineCallPending = null;
      }
      moveFielders(dt);
      ballFlow();
      if (live.t >= nextPlan) {
        nextPlan = live.t + 0.15;
        replan();
      }
      holderLogic();
      runnersTick(dt);
      outChecks();
      aiRunners();
      if (live.t > 0.2) endCheck();
    };

    live.command = (cmd) => {
      if (!cmd) return;
      if (cmd.kind === 'throw') {
        if (fieldHuman) {
          const holder = ballState.holder;
          if (holder && holder.playBase != null && cmd.target !== holder.playBase) {
            holder.playBase = null;
            holder.playReceiver = null;
            holder.dest = null;
          }
          plan = cmd.target;
          planRelay = !!cmd.relay;
        }
        return;
      }
      if (cmd.kind !== 'runner' || !batHuman) return;
      if (thirdOut) return;
      const e = entries.find((x) => x.id === cmd.id);
      if (!e || !alive(e)) return;
      if (cmd.action === 'go') {
        if (e.state === 'hold' && e.prog < 4 && !blocked(e.prog + 1)) startRun(e, e.prog + 1, false);
        else if (e.state === 'run') e.userCont = true;
      } else if (cmd.action === 'stop') {
        if (e.state === 'run') e.userCont = false;
      } else if (cmd.action === 'back') {
        if (canBack(e)) {
          e.state = 'back';
          e.retreat = e.from;
          e.target = e.from;
          e.tau = 0;
          e.s0 = 0.3;
        }
      }
    };

    live.pending = () => {
      if (live.done) return null;
      const movers = entries.filter((e) => alive(e) && (e.state === 'run' || e.state === 'back'));
      if (!movers.length) return null;
      if (batHuman) {
        const e = movers.find((m) => m.state === 'run' && m.target < 4 && m.userCont === undefined && m.target - m.prog <= 0.6 && !blocked(m.target + 1));
        if (e) return { type: 'runner', id: e.id };
      }
      if (fieldHuman && plan === undefined) {
        const b = ballState;
        if (b.mode === 'flight' && !airCatch && fr.t - live.t < 0.9) return { type: 'throw' };
        if (b.mode === 'held' && b.holder.holdT < 0.1 && b.holder.relayTo == null && !deadBall) return { type: 'throw' };
      }
      return null;
    };

    live.snapshot = () => {
      const b = ballState;
      return {
        t: live.t,
        done: live.done,
        batHuman,
        fieldHuman,
        plan,
        pending: live.pending(),
        relay: fieldHuman && b.mode === 'held'
          ? [1, 2, 3, 4].map((base) => { const c = cutoffFor(b.holder, base); return c ? { base, pos: c.man.pos, suggest: c.saves > 0.12 } : null; }).filter(Boolean)
          : [],
        planRelay,
        umpireCalls: umpireCalls.slice(),
        ball: { x: b.x, y: b.y, z: b.z, mode: b.mode, heldFor: b.mode === 'held' ? live.t - b.holder.caughtAt : 0 },
        fielders: fielders.map((f) => ({ pos: f.pos, name: shortName(f.p.name), height: f.p.height, weight: f.p.weight, x: f.x, y: f.y, job: f.job, coverBase: f.coverBase, pose: motion.pose(f.move, live.t, f.fp.height), has: b.mode === 'held' && b.holder === f })),
        runners: entries.map((e) => {
          const p = pathPoint(e.prog);
          const approaching = e.state === 'run' && e.target < 4 && e.target - e.prog <= 0.9;
          return {
            id: e.id, isBatter: e.isBatter, height: e.r.p.height, weight: e.r.p.weight, x: p.x, y: p.y, state: e.state, out: e.out, scored: e.scored, name: e.r.p.name,
            base: e.state === 'run' ? e.target : Math.round(e.prog),
            decide: approaching ? { base: e.target, cont: e.userCont, ai: aiGo(e, e.target + 1), blocked: blocked(e.target + 1) } : null,
            canGo: e.state === 'hold' && e.prog < 4 && !blocked(e.prog + 1),
            canBack: canBack(e)
          };
        }),
        throws: throwsLog.map((th) => ({
          from: th.from, to: th.to, t0: th.t0,
          t1: b.mode === 'thrown' && b.throwing.record === th ? Math.max(live.t, th.t1) : th.t1,
          wild: th.wild, relay: !!th.relay, points: th.points, speed: th.speed
        })),
        events: live.events
      };
    };

    const bagName = (base) => (base >= 4 ? 'home' : ['', 'first', 'second', 'third'][base]);
    const ruled = (e) => e.rulings ? e.rulings.some((c) => c.ruledOut) : e.out;
    const reachedOf = (e) => {
      const outCall = e.rulings && e.rulings.find((c) => c.ruledOut);
      if (outCall) return outCall.base - 1;
      return e.out && e.call ? Math.max(e.reached, e.call.base) : e.reached;
    };
    live.calls = [];
    live.prepare = () => live.calls;

    live.result = () => {
      const outs = entries.reduce((n, e) => n + (ruled(e) ? 1 : 0), 0);
      const finalOuts = entries.filter(ruled).map((e) => {
        const call = e.rulings && e.rulings.find((c) => c.ruledOut);
        return call ? { t: call.t, force: call.how === 'force' || (e.isBatter && call.base === 1) }
          : { t: e.outAt || 0, force: e.outBy === 'air' || (e.isBatter && e.reached < 1) };
      }).sort((a, b) => a.t - b.t);
      const finalThird = finalOuts[2 - outsBefore];
      const result = {
        ball, entries: [], outs, kind: 'hit', hitBases: 0, error: errors.length ? errors[0].pos : null, dp: false,
        thirdOutForce: !!(finalThird && finalThird.force), thirdOutAt: finalThird ? finalThird.t : null,
        text: '', fielder: F, spot: { x: fr.x, y: fr.y }, time: fr.t,
        air: fr.air, fielding: { body: fr.body, move: fr.move, z: fr.z, route: fr.routes && fr.routes[F.pos] }, throws: [], live: true, airOut,
        tagOut: tagOut || entries.some((e) => e.rulings && e.rulings.some((c) => c.ruledOut && c.how === 'tag'))
      };
      for (const e of entries) {
        let base = e.scored ? 4 : e.state === 'back' ? e.retreat : Math.floor(e.prog + 1e-6);
        const out = ruled(e);
        if (out) base = reachedOf(e);
        else if (e.out && e.call) base = e.call.base;
        result.entries.push({ r: e.r, start: e.start, base, out, isBatter: e.isBatter,
          scoredAt: e.scoredAt == null && base >= 4 && e.call ? e.call.t : e.scoredAt });
      }
      const others = entries.filter((e) => !e.isBatter);
      if (airOut) {
        result.kind = 'out';
        result.sacFly = outsBefore < 2 && others.some((e) => e.scored);
      } else if (hitRunner) {
        result.kind = 'fc';
        result.hitRunner = hitRunner.r.p.name;
      } else if (ruled(batter) && reachedOf(batter) < 1) {
        result.kind = outs >= 2 ? 'dp' : 'out';
        result.dp = outs >= 2;
        result.groundOut = true;
        if (result.dp) {
          const chain = [F.pos, ...throwsLog.filter((th) => !th.wild).map((th) => th.receiver)];
          result.dpPath = chain.filter((pos, i) => i === 0 || pos !== chain[i - 1]).slice(0, 3);
        }
      } else if (ruled(batter)) {
        result.kind = 'hit';
        result.hitBases = Math.max(1, reachedOf(batter));
        result.stretchOut = true;
      } else {
        const reached = Math.max(1, batter.out && batter.call ? batter.call.base : batter.reached);
        if (others.some((e) => ruled(e) && (e.outBy === 'force' || !e.out))) result.kind = 'fc';
        else if (errBatter) {
          result.kind = 'error';
          result.error = result.error || F.pos;
        } else {
          result.kind = 'hit';
          result.hitBases = reached;
        }
      }
      if (result.kind === 'fc') result.groundOut = false;
      return result;
    };

    return live;
  }

  const GameEngine = {
    PARK_LIST, POSITIONS, STYLES, PITCH_TYPES, DEFAULT_MIX, pitchSpread, ZONE, PITCH_RADIUS, TIMING_WINDOW, LOC_WINDOW, manualSwingProfile, primeContactTiming, playerHeight, playerWeight,
    settings, parkById, fenceAt, boundaryAt, wallAt, flightSim, parkEnv, makeEnv, windNow, windText, windVector, airDensity, tempFactor, PARK_TEMP, defaultSpot, shiftedSpot, setShift, SHIFT_PRESETS,
    createGame, validateTeam, stepPitch, nextPitch, playHeldContact, completeContact, completeLive, reviewLive, resumeSteal, challengeCall, pendingReview,
    simPlateAppearance, simHalfInning, simGame, stealOdds, canSteal,
    snapshot, boxScore, sprayChartEntries, generateTeam, makeRng, contactWord, currentBatter, currentPitcher, batSide,
    batterOverall, pitcherOverall, offenseOf, defenseOf, teamRatings, mphToVelo, veloToMph, positionPenalty, eligibleAt,
    pinchHit, pinchRun, defensiveSub, pitchingChange, shortName, supportPlan, fieldTracks, fieldSpeed, keepInside, hitDistance,
    runDistance, runTime, runningSegment: seg, RUN_RAMP: RAMP_TIME
      };
  if (typeof module !== 'undefined' && module.exports) module.exports = GameEngine;
  else root.GameEngine = GameEngine;
})(typeof window !== 'undefined' ? window : globalThis);
