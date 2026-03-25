/**
 * Elite Infographic Slide Builder
 * "Analyzing Your Niche to Find Your Positioning" — 10 Slides
 *
 * Design language:
 *   - Near-black backgrounds with deep navy warmth
 *   - Amber/gold as the single accent color (hierarchy + emphasis)
 *   - Inter Bold for statements, Regular for supporting text
 *   - Geometric shapes as structural—not decorative—elements
 *   - Restraint: let the speaker fill the gaps
 */

const SERVER = 'http://localhost:3333';

// ─── Color tokens ──────────────────────────────────────────────────────────────
const C = {
  BG:        '#0A0A13',
  BG_CARD:   '#111119',
  BG_CARD2:  '#16161F',
  LINE:      '#252535',
  GOLD:      '#C8A356',
  GOLD_DIM:  '#7A6135',
  WHITE:     '#EDE8DE',
  MUTED:     '#5C5C72',
  GHOST:     '#131322',
  RED:       '#D4544A',
  BLUE:      '#3E6ED4',
  BLUE_DIM:  '#1A2540',
};

// ─── Bridge helper ─────────────────────────────────────────────────────────────
async function cmd(type: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const res = await fetch(`${SERVER}/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, params }),
  });
  if (!res.ok) throw new Error(`Bridge ${res.status}: ${await res.text()}`);
  const { result } = await res.json() as { result: unknown };
  return result;
}

const slide  = (p: Record<string, unknown>) => cmd('CREATE_SLIDE', p);
const text   = (p: Record<string, unknown>) => cmd('ADD_TEXT', p);
const shape  = (p: Record<string, unknown>) => cmd('ADD_SHAPE', p);

// ─── Reusable primitives ───────────────────────────────────────────────────────

/** Gold accent bar across the top of a slide */
async function topBar(si: number, w = 1280) {
  await shape({ slideIndex: si, shape: 'rectangle', x: 0, y: 0, width: w, height: 3, color: C.GOLD });
}

/** Ghost slide number — huge, nearly invisible, bottom-left */
async function ghostNum(si: number, num: string) {
  await text({
    slideIndex: si, text: num,
    x: 56, y: 460, width: 300, height: 220,
    fontSize: 180, fontWeight: 'Bold', color: C.GHOST,
  });
}

/** Small section / eyebrow label */
async function eyebrow(si: number, label: string, x = 80, y = 52) {
  await text({
    slideIndex: si, text: label,
    x, y, width: 700, height: 28,
    fontSize: 11, fontWeight: 'Regular', color: C.MUTED,
    textAlign: 'LEFT',
  });
}

/** Slide number pill in top-right */
async function slideNum(si: number, label: string) {
  await text({
    slideIndex: si, text: label,
    x: 1160, y: 48, width: 60, height: 26,
    fontSize: 12, fontWeight: 'Regular', color: C.MUTED, textAlign: 'RIGHT',
  });
}

/** Thin horizontal rule */
async function rule(si: number, x: number, y: number, w: number) {
  await shape({ slideIndex: si, shape: 'rectangle', x, y, width: w, height: 1, color: C.LINE });
}

/** Vertical accent line (used as dividers) */
async function vLine(si: number, x: number, y: number, h: number, color = C.LINE) {
  await shape({ slideIndex: si, shape: 'rectangle', x, y, width: 2, height: h, color });
}

/** Bold gold accent line (short, left of a title block) */
async function leftAccent(si: number, x: number, y: number, h = 56) {
  await shape({ slideIndex: si, shape: 'rectangle', x, y, width: 4, height: h, color: C.GOLD });
}

/** Filled card rectangle */
async function card(si: number, x: number, y: number, w: number, h: number, color = C.BG_CARD, r = 0) {
  await shape({ slideIndex: si, shape: 'rectangle', x, y, width: w, height: h, color, cornerRadius: r });
}

/** Dot / circle indicator */
async function dot(si: number, x: number, y: number, size: number, color = C.GOLD) {
  await shape({ slideIndex: si, shape: 'ellipse', x, y, width: size, height: size, color });
}

// ─── SLIDES ───────────────────────────────────────────────────────────────────

async function buildAll() {
  process.stdout.write('\n🧹  Clearing canvas…\n');
  await cmd('CLEAR_ALL');

  // ════════════════════════════════════════════════════════════════════════════
  // SLIDE 1 — The Problem
  // ════════════════════════════════════════════════════════════════════════════
  process.stdout.write('🎨  Slide 01 — The Problem\n');
  await slide({ title: '01 — The Problem', backgroundColor: C.BG });
  const s1 = 0;
  await topBar(s1);
  await ghostNum(s1, '01');
  await eyebrow(s1, 'SECTION ONE  ·  THE FOUNDATION');
  await slideNum(s1, '01 / 10');

  // Left: the statement
  await leftAccent(s1, 80, 130, 140);
  await text({
    slideIndex: s1, text: 'Every Framework\nYou\'ve Seen\nIs Incomplete.',
    x: 100, y: 118, width: 520, height: 260,
    fontSize: 58, fontWeight: 'Bold', color: C.WHITE,
  });
  await text({
    slideIndex: s1, text: 'No diagnosis = no truth.',
    x: 100, y: 394, width: 480, height: 44,
    fontSize: 22, fontWeight: 'Regular', color: C.GOLD,
  });
  await text({
    slideIndex: s1, text: '— Porter\'s Competitive Strategy · Harvard MBA',
    x: 100, y: 450, width: 500, height: 28,
    fontSize: 13, fontWeight: 'Regular', color: C.MUTED,
  });

  // Right: broken sequence diagram
  // Box A — DIAGNOSIS (missing / grayed)
  await card(s1, 690, 220, 220, 80, C.BG_CARD, 6);
  await text({
    slideIndex: s1, text: 'DIAGNOSE',
    x: 690, y: 244, width: 220, height: 36,
    fontSize: 18, fontWeight: 'Bold', color: C.MUTED, textAlign: 'CENTER',
  });
  // × over it
  await text({
    slideIndex: s1, text: '×',
    x: 690, y: 216, width: 220, height: 50,
    fontSize: 36, fontWeight: 'Bold', color: C.RED, textAlign: 'CENTER',
  });
  await text({
    slideIndex: s1, text: 'SKIPPED',
    x: 690, y: 308, width: 220, height: 24,
    fontSize: 11, fontWeight: 'Regular', color: C.RED, textAlign: 'CENTER',
  });

  // Arrow
  await shape({ slideIndex: s1, shape: 'rectangle', x: 910, y: 258, width: 70, height: 2, color: C.MUTED });
  await text({
    slideIndex: s1, text: '›',
    x: 968, y: 240, width: 30, height: 36,
    fontSize: 28, fontWeight: 'Regular', color: C.MUTED, textAlign: 'CENTER',
  });

  // Box B — FRAMEWORK (where everyone starts)
  await card(s1, 980, 220, 230, 80, C.BG_CARD2, 6);
  await shape({ slideIndex: s1, shape: 'rectangle', x: 980, y: 220, width: 4, height: 80, color: C.GOLD });
  await text({
    slideIndex: s1, text: 'POSITION',
    x: 984, y: 244, width: 226, height: 36,
    fontSize: 18, fontWeight: 'Bold', color: C.GOLD, textAlign: 'CENTER',
  });
  await text({
    slideIndex: s1, text: 'WHERE EVERYONE STARTS',
    x: 980, y: 308, width: 230, height: 24,
    fontSize: 11, fontWeight: 'Regular', color: C.MUTED, textAlign: 'CENTER',
  });

  // Label: "The gap"
  await text({
    slideIndex: s1, text: 'The gap no one talks about',
    x: 680, y: 170, width: 540, height: 30,
    fontSize: 14, fontWeight: 'Regular', color: C.MUTED, textAlign: 'CENTER',
  });
  await rule(s1, 690, 165, 520);

  // Bottom quote
  await vLine(s1, 690, 430, 100);
  await text({
    slideIndex: s1, text: '"Niche structure changes how\nyou play the game."',
    x: 710, y: 430, width: 500, height: 80,
    fontSize: 20, fontWeight: 'Regular', color: C.WHITE,
  });

  // ════════════════════════════════════════════════════════════════════════════
  // SLIDE 2 — Niche = Market
  // ════════════════════════════════════════════════════════════════════════════
  process.stdout.write('🎨  Slide 02 — Niche = Market\n');
  await slide({ title: '02 — Niche = Market', backgroundColor: C.BG });
  const s2 = 1;
  await topBar(s2);
  await ghostNum(s2, '02');
  await eyebrow(s2, 'SECTION ONE  ·  THE FOUNDATION');
  await slideNum(s2, '02 / 10');

  // Central equation
  await text({
    slideIndex: s2, text: 'NICHE  =  MARKET',
    x: 80, y: 200, width: 1120, height: 130,
    fontSize: 88, fontWeight: 'Bold', color: C.GOLD, textAlign: 'CENTER',
  });

  // Divider
  await rule(s2, 200, 348, 880);

  // Two columns below
  // Left — Creator World
  await text({
    slideIndex: s2, text: 'CREATOR WORLD',
    x: 120, y: 368, width: 460, height: 30,
    fontSize: 11, fontWeight: 'Regular', color: C.MUTED, textAlign: 'CENTER',
  });
  await text({
    slideIndex: s2, text: 'Attention\nViews · Clicks · Subs',
    x: 120, y: 406, width: 460, height: 100,
    fontSize: 26, fontWeight: 'Regular', color: C.WHITE, textAlign: 'CENTER',
  });

  // Center vertical divider
  await vLine(s2, 638, 358, 160);

  // Right — Business World
  await text({
    slideIndex: s2, text: 'BUSINESS WORLD',
    x: 700, y: 368, width: 460, height: 30,
    fontSize: 11, fontWeight: 'Regular', color: C.MUTED, textAlign: 'CENTER',
  });
  await text({
    slideIndex: s2, text: 'Customers\nMarket Share · Revenue',
    x: 700, y: 406, width: 460, height: 100,
    fontSize: 26, fontWeight: 'Regular', color: C.WHITE, textAlign: 'CENTER',
  });

  // Bottom reframe
  await text({
    slideIndex: s2, text: 'You are not picking a topic.  You are entering a competitive market.',
    x: 120, y: 600, width: 1040, height: 44,
    fontSize: 18, fontWeight: 'Regular', color: C.MUTED, textAlign: 'CENTER',
  });

  // ════════════════════════════════════════════════════════════════════════════
  // SLIDE 3 — Structure First, Strategy Second
  // ════════════════════════════════════════════════════════════════════════════
  process.stdout.write('🎨  Slide 03 — Structure First\n');
  await slide({ title: '03 — Structure First', backgroundColor: C.BG });
  const s3 = 2;
  await topBar(s3);
  await ghostNum(s3, '03');
  await eyebrow(s3, 'SECTION ONE  ·  THE FOUNDATION');
  await slideNum(s3, '03 / 10');

  await text({
    slideIndex: s3, text: 'The Diagnostic\nPrinciple',
    x: 80, y: 100, width: 600, height: 160,
    fontSize: 68, fontWeight: 'Bold', color: C.WHITE,
  });

  // Two large numbered cards
  // Card 1 — STRUCTURE
  await card(s3, 80, 300, 500, 240, C.BG_CARD, 8);
  await shape({ slideIndex: s3, shape: 'rectangle', x: 80, y: 300, width: 500, height: 4, color: C.GOLD });
  await text({
    slideIndex: s3, text: '01',
    x: 100, y: 316, width: 80, height: 60,
    fontSize: 44, fontWeight: 'Bold', color: C.GOLD_DIM,
  });
  await text({
    slideIndex: s3, text: 'STRUCTURE',
    x: 100, y: 378, width: 440, height: 52,
    fontSize: 38, fontWeight: 'Bold', color: C.WHITE,
  });
  await text({
    slideIndex: s3, text: 'Saturation · Norms · Players · Audience',
    x: 100, y: 434, width: 440, height: 32,
    fontSize: 16, fontWeight: 'Regular', color: C.MUTED,
  });
  await text({
    slideIndex: s3, text: 'Read the land first.',
    x: 100, y: 476, width: 440, height: 44,
    fontSize: 20, fontWeight: 'Regular', color: C.GOLD,
  });

  // Arrow between cards
  await text({
    slideIndex: s3, text: '→',
    x: 600, y: 380, width: 80, height: 80,
    fontSize: 40, fontWeight: 'Regular', color: C.MUTED, textAlign: 'CENTER',
  });

  // Card 2 — STRATEGY
  await card(s3, 700, 300, 500, 240, C.BG_CARD, 8);
  await shape({ slideIndex: s3, shape: 'rectangle', x: 700, y: 300, width: 500, height: 4, color: C.LINE });
  await text({
    slideIndex: s3, text: '02',
    x: 720, y: 316, width: 80, height: 60,
    fontSize: 44, fontWeight: 'Bold', color: C.MUTED,
  });
  await text({
    slideIndex: s3, text: 'STRATEGY',
    x: 720, y: 378, width: 440, height: 52,
    fontSize: 38, fontWeight: 'Bold', color: C.MUTED,
  });
  await text({
    slideIndex: s3, text: 'Your positioning — built on evidence.',
    x: 720, y: 434, width: 440, height: 32,
    fontSize: 16, fontWeight: 'Regular', color: C.MUTED,
  });
  await text({
    slideIndex: s3, text: 'Earned, not assumed.',
    x: 720, y: 476, width: 440, height: 44,
    fontSize: 20, fontWeight: 'Regular', color: C.MUTED,
  });

  // ════════════════════════════════════════════════════════════════════════════
  // SLIDE 4 — Category 1: Production
  // ════════════════════════════════════════════════════════════════════════════
  process.stdout.write('🎨  Slide 04 — Production\n');
  await slide({ title: '04 — Production', backgroundColor: C.BG });
  const s4 = 3;
  await topBar(s4);
  await ghostNum(s4, '04');
  await eyebrow(s4, 'SECTION TWO  ·  3 CATEGORIES OF COMPETITIVE ADVANTAGE');
  await slideNum(s4, '04 / 10');

  await text({
    slideIndex: s4, text: 'Category 01\nProduction',
    x: 80, y: 96, width: 700, height: 150,
    fontSize: 60, fontWeight: 'Bold', color: C.WHITE,
  });
  await text({
    slideIndex: s4, text: 'How you make content is itself a competitive strategy.',
    x: 80, y: 256, width: 700, height: 44,
    fontSize: 20, fontWeight: 'Regular', color: C.GOLD,
  });

  // Three model cards
  const models = [
    { label: 'THE FERRARI', desc: 'High production\nDeep research\nHard to replicate', note: 'Lower volume. Moat is craft.', x: 80 },
    { label: 'McDONALD\'S', desc: 'Low lift\nHigh volume\nGrip it and rip it', note: 'Moat is consistency.', x: 490 },
    { label: 'THE HYBRID', desc: 'Ebb and flow\nFormat variety\nCohesion through range', note: 'Moat is range.', x: 900 },
  ];

  for (const m of models) {
    await card(s4, m.x, 320, 340, 300, C.BG_CARD, 8);
    await shape({ slideIndex: s4, shape: 'rectangle', x: m.x, y: 320, width: 340, height: 3, color: C.GOLD });
    await text({
      slideIndex: s4, text: m.label,
      x: m.x + 20, y: 340, width: 300, height: 36,
      fontSize: 18, fontWeight: 'Bold', color: C.GOLD,
    });
    await text({
      slideIndex: s4, text: m.desc,
      x: m.x + 20, y: 386, width: 300, height: 120,
      fontSize: 20, fontWeight: 'Regular', color: C.WHITE,
    });
    await text({
      slideIndex: s4, text: m.note,
      x: m.x + 20, y: 556, width: 300, height: 44,
      fontSize: 14, fontWeight: 'Regular', color: C.MUTED,
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SLIDE 5 — Counter Positioning
  // ════════════════════════════════════════════════════════════════════════════
  process.stdout.write('🎨  Slide 05 — Counter Positioning\n');
  await slide({ title: '05 — Counter Positioning', backgroundColor: C.BG });
  const s5 = 4;
  await topBar(s5);
  await ghostNum(s5, '05');
  await eyebrow(s5, 'SECTION TWO  ·  3 CATEGORIES OF COMPETITIVE ADVANTAGE');
  await slideNum(s5, '05 / 10');

  await text({
    slideIndex: s5, text: 'Category 02\nCounter Positioning',
    x: 80, y: 96, width: 700, height: 150,
    fontSize: 60, fontWeight: 'Bold', color: C.WHITE,
  });
  await text({
    slideIndex: s5, text: 'Your lane. Meaningfully yours.',
    x: 80, y: 256, width: 600, height: 44,
    fontSize: 22, fontWeight: 'Regular', color: C.GOLD,
  });

  // Five levers — two column layout
  const levers = [
    { num: '01', title: 'Go Deeper', example: 'Sub-skill is the counter position\n"Curry + shooting mechanics"' },
    { num: '02', title: 'Shift Price Point', example: 'Up-market or down-market\nJeremy Haynes → upstream' },
    { num: '03', title: 'Target a Demo', example: 'Gender · Age · Geography\nShelby Sapp → women in sales' },
    { num: '04', title: 'Overlap Two Niches', example: 'AI + newsletters\nBrand + only Asian companies' },
    { num: '05', title: 'Own a Subset', example: 'David Kyle Choe → brand breakdowns\nbut only Asian companies' },
  ];

  const col1 = levers.slice(0, 3);
  const col2 = levers.slice(3);

  let y = 320;
  for (const l of col1) {
    await dot(s5, 80, y + 8, 10);
    await text({
      slideIndex: s5, text: l.title,
      x: 104, y, width: 280, height: 32,
      fontSize: 18, fontWeight: 'Bold', color: C.WHITE,
    });
    await text({
      slideIndex: s5, text: l.example,
      x: 104, y: y + 32, width: 460, height: 48,
      fontSize: 14, fontWeight: 'Regular', color: C.MUTED,
    });
    y += 96;
  }

  y = 320;
  for (const l of col2) {
    await dot(s5, 700, y + 8, 10);
    await text({
      slideIndex: s5, text: l.title,
      x: 724, y, width: 280, height: 32,
      fontSize: 18, fontWeight: 'Bold', color: C.WHITE,
    });
    await text({
      slideIndex: s5, text: l.example,
      x: 724, y: y + 32, width: 460, height: 48,
      fontSize: 14, fontWeight: 'Regular', color: C.MUTED,
    });
    y += 96;
  }

  await vLine(s5, 664, 310, 300);

  await text({
    slideIndex: s5, text: 'Counter positioning is not gimmick — it is strategic identity.',
    x: 80, y: 650, width: 1100, height: 40,
    fontSize: 16, fontWeight: 'Regular', color: C.MUTED,
  });

  // ════════════════════════════════════════════════════════════════════════════
  // SLIDE 6 — Focus / The Long Game
  // ════════════════════════════════════════════════════════════════════════════
  process.stdout.write('🎨  Slide 06 — Focus / The Long Game\n');
  await slide({ title: '06 — Focus', backgroundColor: C.BG });
  const s6 = 5;
  await topBar(s6);
  await ghostNum(s6, '06');
  await eyebrow(s6, 'SECTION TWO  ·  3 CATEGORIES OF COMPETITIVE ADVANTAGE');
  await slideNum(s6, '06 / 10');

  await text({
    slideIndex: s6, text: 'Category 03\nFocus',
    x: 80, y: 96, width: 700, height: 150,
    fontSize: 60, fontWeight: 'Bold', color: C.WHITE,
  });

  // Central quote — the statement IS the slide
  await card(s6, 80, 290, 1120, 200, C.BG_CARD, 8);
  await shape({ slideIndex: s6, shape: 'rectangle', x: 80, y: 290, width: 4, height: 200, color: C.GOLD });
  await text({
    slideIndex: s6, text: 'One niche.  Every day.  Ten years.',
    x: 104, y: 340, width: 1076, height: 70,
    fontSize: 52, fontWeight: 'Bold', color: C.WHITE,
  });
  await text({
    slideIndex: s6, text: 'That is the strategy.',
    x: 104, y: 416, width: 600, height: 50,
    fontSize: 28, fontWeight: 'Regular', color: C.GOLD,
  });

  // Three threat labels at the bottom
  const threats = [
    { label: 'Shiny Object\nSyndrome', sub: 'Kills compounding' },
    { label: 'Pigeonhole\nFear', sub: 'Mostly ego' },
    { label: 'Passion vs.\nCommitment', sub: 'Both required' },
  ];
  let tx = 80;
  for (const t of threats) {
    await card(s6, tx, 518, 340, 120, C.BG_CARD2, 6);
    await text({
      slideIndex: s6, text: t.label,
      x: tx + 20, y: 532, width: 300, height: 56,
      fontSize: 18, fontWeight: 'Bold', color: C.WHITE,
    });
    await text({
      slideIndex: s6, text: t.sub,
      x: tx + 20, y: 596, width: 300, height: 28,
      fontSize: 14, fontWeight: 'Regular', color: C.MUTED,
    });
    tx += 360;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SLIDE 7 — Audit Part 1
  // ════════════════════════════════════════════════════════════════════════════
  process.stdout.write('🎨  Slide 07 — Audit Part 1\n');
  await slide({ title: '07 — Niche Structure Audit', backgroundColor: C.BG });
  const s7 = 6;
  await topBar(s7);
  await ghostNum(s7, '07');
  await eyebrow(s7, 'SECTION THREE  ·  DIAGNOSTIC HOMEWORK');
  await slideNum(s7, '07 / 10');

  await text({
    slideIndex: s7, text: 'The Niche\nStructure Audit',
    x: 80, y: 96, width: 700, height: 160,
    fontSize: 60, fontWeight: 'Bold', color: C.WHITE,
  });
  await text({
    slideIndex: s7, text: 'You cannot strategize what you haven\'t studied.',
    x: 80, y: 264, width: 700, height: 44,
    fontSize: 20, fontWeight: 'Regular', color: C.GOLD,
  });

  // Research inputs → three lenses
  // Input row: "20 creators" → "90 days" → "3 lenses"
  const inputs = [
    { val: '20', label: 'creators\nin your niche' },
    { val: '90', label: 'days of\ncontent' },
    { val: '3', label: 'lenses\nto analyze' },
  ];

  let ix = 80;
  for (const inp of inputs) {
    await text({
      slideIndex: s7, text: inp.val,
      x: ix, y: 320, width: 200, height: 110,
      fontSize: 90, fontWeight: 'Bold', color: C.GOLD,
    });
    await text({
      slideIndex: s7, text: inp.label,
      x: ix, y: 436, width: 200, height: 56,
      fontSize: 17, fontWeight: 'Regular', color: C.MUTED,
    });
    if (ix < 480) {
      await text({
        slideIndex: s7, text: '×',
        x: ix + 196, y: 344, width: 80, height: 80,
        fontSize: 40, fontWeight: 'Regular', color: C.LINE, textAlign: 'CENTER',
      });
    }
    ix += 280;
  }

  // Three lenses — right side
  await vLine(s7, 700, 300, 360);

  const lenses = [
    { num: '01', title: 'Visual Formats', desc: 'What formats repeat across creators?' },
    { num: '02', title: 'Keywords & Topics', desc: 'What does this niche talk about?' },
    { num: '03', title: 'Vibe & Personality', desc: 'The Lunchroom Table Test' },
  ];

  let ly = 300;
  for (const lens of lenses) {
    await dot(s7, 724, ly + 10, 8, C.GOLD_DIM);
    await text({
      slideIndex: s7, text: lens.title,
      x: 748, y: ly, width: 460, height: 34,
      fontSize: 20, fontWeight: 'Bold', color: C.WHITE,
    });
    await text({
      slideIndex: s7, text: lens.desc,
      x: 748, y: ly + 34, width: 460, height: 28,
      fontSize: 15, fontWeight: 'Regular', color: C.MUTED,
    });
    await rule(s7, 724, ly + 74, 480);
    ly += 88;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SLIDE 8 — The Lunchroom Table Test (the "reading the room" bridge slide)
  // ════════════════════════════════════════════════════════════════════════════
  process.stdout.write('🎨  Slide 08 — The Lunchroom Table Test\n');
  await slide({ title: '08 — The Lunchroom Table Test', backgroundColor: C.BG });
  const s8 = 7;
  await topBar(s8);
  await ghostNum(s8, '08');
  await eyebrow(s8, 'SECTION THREE  ·  DIAGNOSTIC HOMEWORK');
  await slideNum(s8, '08 / 10');

  await text({
    slideIndex: s8, text: 'The Lunchroom\nTable Test',
    x: 80, y: 96, width: 700, height: 180,
    fontSize: 64, fontWeight: 'Bold', color: C.WHITE,
  });
  await text({
    slideIndex: s8, text: 'What table in the cafeteria does this creator sit at?',
    x: 80, y: 288, width: 700, height: 60,
    fontSize: 22, fontWeight: 'Regular', color: C.GOLD,
  });

  // Four vibe archetypes
  const vibes = [
    { label: 'THE PROFESSOR', desc: 'Authoritative · Dense · Educational\nThinks in frameworks' },
    { label: 'THE ENTERTAINER', desc: 'High energy · Personality-first\nContent is the experience' },
    { label: 'THE PEER', desc: 'Relatable · On-the-journey\n"We\'re figuring this out together"' },
    { label: 'THE ADVISOR', desc: 'Direct · Practical · Prescriptive\nTells you what to do' },
  ];

  const v1 = vibes.slice(0, 2);
  const v2 = vibes.slice(2);

  let vx1 = 80, vx2 = 700, vy = 380;
  for (let i = 0; i < 2; i++) {
    for (const [xi, vibe] of [[vx1, v1[i]], [vx2, v2[i]]] as Array<[number, typeof vibes[0]]>) {
      await card(s8, xi, vy, 560, 120, C.BG_CARD, 6);
      await shape({ slideIndex: s8, shape: 'rectangle', x: xi, y: vy, width: 3, height: 120, color: C.GOLD });
      await text({
        slideIndex: s8, text: vibe.label,
        x: xi + 20, y: vy + 16, width: 520, height: 32,
        fontSize: 16, fontWeight: 'Bold', color: C.GOLD,
      });
      await text({
        slideIndex: s8, text: vibe.desc,
        x: xi + 20, y: vy + 52, width: 520, height: 56,
        fontSize: 15, fontWeight: 'Regular', color: C.MUTED,
      });
    }
    vy += 136;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SLIDE 9 — Positioning Worksheet
  // ════════════════════════════════════════════════════════════════════════════
  process.stdout.write('🎨  Slide 09 — Positioning Worksheet\n');
  await slide({ title: '09 — Positioning Worksheet', backgroundColor: C.BG });
  const s9 = 8;
  await topBar(s9);
  await ghostNum(s9, '09');
  await eyebrow(s9, 'SECTION THREE  ·  DIAGNOSTIC HOMEWORK');
  await slideNum(s9, '09 / 10');

  await text({
    slideIndex: s9, text: 'Positioning\nWorksheet',
    x: 80, y: 96, width: 700, height: 160,
    fontSize: 64, fontWeight: 'Bold', color: C.WHITE,
  });
  await text({
    slideIndex: s9, text: 'The audit earns you the right to the strategy.',
    x: 80, y: 264, width: 700, height: 44,
    fontSize: 20, fontWeight: 'Regular', color: C.GOLD,
  });

  // Three-column matrix
  const cols = [
    { cat: 'PRODUCTION', q1: 'Dominant pattern\nin your niche?', q2: 'How do\nyou differ?' },
    { cat: 'POSITIONING', q1: 'Who owns\nthe main lane?', q2: 'What lane\nis open for you?' },
    { cat: 'FOCUS', q1: 'What do you\nreturn to always?', q2: 'Can you commit\nto it for 10 years?' },
  ];

  let cx = 80;
  for (const col of cols) {
    await card(s9, cx, 326, 354, 320, C.BG_CARD, 8);
    await shape({ slideIndex: s9, shape: 'rectangle', x: cx, y: 326, width: 354, height: 3, color: C.GOLD });
    await text({
      slideIndex: s9, text: col.cat,
      x: cx + 20, y: 344, width: 314, height: 32,
      fontSize: 14, fontWeight: 'Bold', color: C.GOLD,
    });
    await rule(s9, cx + 20, 382, 314);
    await text({
      slideIndex: s9, text: col.q1,
      x: cx + 20, y: 394, width: 314, height: 60,
      fontSize: 18, fontWeight: 'Regular', color: C.WHITE,
    });
    await rule(s9, cx + 20, 464, 314);
    await text({
      slideIndex: s9, text: col.q2,
      x: cx + 20, y: 476, width: 314, height: 60,
      fontSize: 18, fontWeight: 'Regular', color: C.WHITE,
    });
    await rule(s9, cx + 20, 548, 314);
    await text({
      slideIndex: s9, text: '→',
      x: cx + 20, y: 566, width: 314, height: 60,
      fontSize: 28, fontWeight: 'Regular', color: C.LINE,
    });
    cx += 374;
  }

  await text({
    slideIndex: s9, text: 'Living document — not a one-time exercise.',
    x: 80, y: 666, width: 1100, height: 36,
    fontSize: 16, fontWeight: 'Regular', color: C.MUTED,
  });

  // ════════════════════════════════════════════════════════════════════════════
  // SLIDE 10 — The Only Rule
  // ════════════════════════════════════════════════════════════════════════════
  process.stdout.write('🎨  Slide 10 — The Only Rule\n');
  await slide({ title: '10 — The Only Rule', backgroundColor: C.BG });
  const s10 = 9;
  await topBar(s10);
  await eyebrow(s10, 'SECTION FOUR  ·  THE CLOSE');
  await slideNum(s10, '10 / 10');

  // Three-word framework — centered, large
  await text({
    slideIndex: s10, text: 'Diagnose.',
    x: 80, y: 140, width: 1120, height: 110,
    fontSize: 96, fontWeight: 'Bold', color: C.MUTED, textAlign: 'CENTER',
  });
  await text({
    slideIndex: s10, text: 'Differentiate.',
    x: 80, y: 252, width: 1120, height: 110,
    fontSize: 96, fontWeight: 'Bold', color: C.WHITE, textAlign: 'CENTER',
  });
  await text({
    slideIndex: s10, text: 'Stay.',
    x: 80, y: 364, width: 1120, height: 110,
    fontSize: 96, fontWeight: 'Bold', color: C.GOLD, textAlign: 'CENTER',
  });

  // Closing line
  await rule(s10, 200, 502, 880);
  await text({
    slideIndex: s10, text: '"The market rewards the people who showed up\nthe longest with the clearest point of view."',
    x: 120, y: 518, width: 1040, height: 120,
    fontSize: 22, fontWeight: 'Regular', color: C.MUTED, textAlign: 'CENTER',
  });

  process.stdout.write('\n✅  All 10 slides complete.\n\n');

  // Verify
  const info = await cmd('GET_SLIDES_INFO') as { slides: Array<{ index: number; name: string }> };
  process.stdout.write(`Slides created: ${info.slides.length}\n`);
  info.slides.forEach((s) => process.stdout.write(`  ${s.index + 1}. ${s.name}\n`));
}

buildAll().catch((err) => {
  console.error('\n❌ ', err.message);
  process.exit(1);
});
