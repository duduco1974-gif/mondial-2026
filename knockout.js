// ============================================================
// מבנה שלבי הנוקאוט — מונדיאל 2026
// 48 נבחרות → 32 → 16 → 8 → 4 → 2 → אלוף
// ============================================================

// placeholder: { type: 'group', group, rank } | { type: 'best3', label }
//              | { type: 'winner', matchId } | { type: 'team', name }

const KNOCKOUT_BRACKET = {
  // ---- שמינית-גמר (32 נבחרות → 16) ----
  r32: [
    { id: 'r32_1',  home: { type:'group', group:'A', rank:1 }, away: { type:'group', group:'B', rank:2 } },
    { id: 'r32_2',  home: { type:'group', group:'B', rank:1 }, away: { type:'group', group:'A', rank:2 } },
    { id: 'r32_3',  home: { type:'group', group:'C', rank:1 }, away: { type:'group', group:'D', rank:2 } },
    { id: 'r32_4',  home: { type:'group', group:'D', rank:1 }, away: { type:'group', group:'C', rank:2 } },
    { id: 'r32_5',  home: { type:'group', group:'E', rank:1 }, away: { type:'group', group:'F', rank:2 } },
    { id: 'r32_6',  home: { type:'group', group:'F', rank:1 }, away: { type:'group', group:'E', rank:2 } },
    { id: 'r32_7',  home: { type:'group', group:'G', rank:1 }, away: { type:'group', group:'H', rank:2 } },
    { id: 'r32_8',  home: { type:'group', group:'H', rank:1 }, away: { type:'group', group:'G', rank:2 } },
    { id: 'r32_9',  home: { type:'group', group:'I', rank:1 }, away: { type:'group', group:'J', rank:2 } },
    { id: 'r32_10', home: { type:'group', group:'J', rank:1 }, away: { type:'group', group:'I', rank:2 } },
    { id: 'r32_11', home: { type:'group', group:'K', rank:1 }, away: { type:'group', group:'L', rank:2 } },
    { id: 'r32_12', home: { type:'group', group:'L', rank:1 }, away: { type:'group', group:'K', rank:2 } },
    { id: 'r32_13', home: { type:'best3', label:'מיקום 3 — טוב ביותר 1' }, away: { type:'best3', label:'מיקום 3 — טוב ביותר 2' } },
    { id: 'r32_14', home: { type:'best3', label:'מיקום 3 — טוב ביותר 3' }, away: { type:'best3', label:'מיקום 3 — טוב ביותר 4' } },
    { id: 'r32_15', home: { type:'best3', label:'מיקום 3 — טוב ביותר 5' }, away: { type:'best3', label:'מיקום 3 — טוב ביותר 6' } },
    { id: 'r32_16', home: { type:'best3', label:'מיקום 3 — טוב ביותר 7' }, away: { type:'best3', label:'מיקום 3 — טוב ביותר 8' } },
  ],
  // ---- שישית-גמר (16 → 8) ----
  r16: [
    { id: 'r16_1', home: { type:'winner', matchId:'r32_1'  }, away: { type:'winner', matchId:'r32_2'  } },
    { id: 'r16_2', home: { type:'winner', matchId:'r32_3'  }, away: { type:'winner', matchId:'r32_4'  } },
    { id: 'r16_3', home: { type:'winner', matchId:'r32_5'  }, away: { type:'winner', matchId:'r32_6'  } },
    { id: 'r16_4', home: { type:'winner', matchId:'r32_7'  }, away: { type:'winner', matchId:'r32_8'  } },
    { id: 'r16_5', home: { type:'winner', matchId:'r32_9'  }, away: { type:'winner', matchId:'r32_10' } },
    { id: 'r16_6', home: { type:'winner', matchId:'r32_11' }, away: { type:'winner', matchId:'r32_12' } },
    { id: 'r16_7', home: { type:'winner', matchId:'r32_13' }, away: { type:'winner', matchId:'r32_14' } },
    { id: 'r16_8', home: { type:'winner', matchId:'r32_15' }, away: { type:'winner', matchId:'r32_16' } },
  ],
  // ---- רבע-גמר (8 → 4) ----
  qf: [
    { id: 'qf_1', home: { type:'winner', matchId:'r16_1' }, away: { type:'winner', matchId:'r16_2' } },
    { id: 'qf_2', home: { type:'winner', matchId:'r16_3' }, away: { type:'winner', matchId:'r16_4' } },
    { id: 'qf_3', home: { type:'winner', matchId:'r16_5' }, away: { type:'winner', matchId:'r16_6' } },
    { id: 'qf_4', home: { type:'winner', matchId:'r16_7' }, away: { type:'winner', matchId:'r16_8' } },
  ],
  // ---- חצי-גמר (4 → 2) ----
  sf: [
    { id: 'sf_1', home: { type:'winner', matchId:'qf_1' }, away: { type:'winner', matchId:'qf_2' } },
    { id: 'sf_2', home: { type:'winner', matchId:'qf_3' }, away: { type:'winner', matchId:'qf_4' } },
  ],
  // ---- משחק המקום השלישי ----
  third: [
    { id: 'third_1', home: { type:'loser', matchId:'sf_1' }, away: { type:'loser', matchId:'sf_2' } },
  ],
  // ---- גמר ----
  final: [
    { id: 'final_1', home: { type:'winner', matchId:'sf_1' }, away: { type:'winner', matchId:'sf_2' } },
  ]
};

const STAGE_LABELS = {
  r32:   'שלב 32 — שמינית הגמר',
  r16:   'שלב 16 — שישית הגמר',
  qf:    'רבע גמר',
  sf:    'חצי גמר',
  third: 'משחק המקום השלישי',
  final: 'גמר'
};

// ---- state ----
// knockoutResults[matchId] = { homeGoals, awayGoals, winner, loser }
let knockoutResults = JSON.parse(localStorage.getItem('ko_results') || '{}');

// groupStandings[groupKey] = ['team1', 'team2', 'team3', 'team4'] (sorted by points)
let groupStandings = JSON.parse(localStorage.getItem('group_standings') || '{}');

function saveKnockoutResults() {
  localStorage.setItem('ko_results', JSON.stringify(knockoutResults));
}

function saveGroupStandings() {
  localStorage.setItem('group_standings', JSON.stringify(groupStandings));
}

// ---- resolve a slot to a team name (or placeholder label) ----
function resolveSlot(slot) {
  if (slot.type === 'team') return { name: slot.name, isKnown: true };

  if (slot.type === 'group') {
    // Only show a team name if at least one match in this group has been played
    const hasResults = typeof groupResults !== 'undefined' &&
      Object.keys(groupResults).some(k => k.startsWith(slot.group + '-'));
    if (!hasResults) {
      const rankLabel = slot.rank === 1 ? '1' : slot.rank === 2 ? '2' : '3';
      return { name: `בית ${slot.group} — מקום ${rankLabel}`, isKnown: false };
    }
    const standings = groupStandings[slot.group];
    const team = standings && standings[slot.rank - 1];
    if (team) return { name: team, isKnown: true };
    const rankLabel = slot.rank === 1 ? '1' : slot.rank === 2 ? '2' : '3';
    return { name: `בית ${slot.group} — מקום ${rankLabel}`, isKnown: false };
  }

  if (slot.type === 'best3') {
    return { name: slot.label, isKnown: false };
  }

  if (slot.type === 'winner' || slot.type === 'loser') {
    const res = knockoutResults[slot.matchId];
    if (res) {
      const team = slot.type === 'winner' ? res.winner : res.loser;
      if (team) return { name: team, isKnown: true };
    }
    const stageLabel = matchIdToLabel(slot.matchId);
    return { name: `מנצח — ${stageLabel}`, isKnown: false };
  }

  return { name: '?', isKnown: false };
}

function matchIdToLabel(matchId) {
  const [stage, num] = matchId.split('_');
  const stageNames = { r32:'שמינית', r16:'שישית', qf:'רבע', sf:'חצי', third:'3' };
  return `${stageNames[stage] || stage} ${num}`;
}

// ---- set result and propagate winner ----
function setKnockoutResult(matchId, homeGoals, awayGoals, homeName, awayName) {
  const winner = homeGoals > awayGoals ? homeName : awayName;
  const loser  = homeGoals > awayGoals ? awayName : homeName;
  knockoutResults[matchId] = { homeGoals, awayGoals, winner, loser, homeName, awayName };
  saveKnockoutResults();
}
