(function () {
  "use strict";

  const GROUP_LETTERS = [..."ABCDEFGHIJKL"];

  function homeOf(event) {
    return event.competitors.find(team => team.homeAway === "home") || event.competitors[0];
  }

  function awayOf(event) {
    return event.competitors.find(team => team.homeAway === "away") || event.competitors[1];
  }

  function createRow(team) {
    return {
      abbreviation: team.abbreviation,
      displayName: team.displayName,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      points: 0
    };
  }

  function applyResult(table, event) {
    const home = homeOf(event);
    const away = awayOf(event);
    const homeRow = table.get(home.abbreviation);
    const awayRow = table.get(away.abbreviation);
    const homeScore = Number(home.score);
    const awayScore = Number(away.score);

    homeRow.played += 1;
    awayRow.played += 1;
    homeRow.goalsFor += homeScore;
    homeRow.goalsAgainst += awayScore;
    awayRow.goalsFor += awayScore;
    awayRow.goalsAgainst += homeScore;

    if (homeScore === awayScore) {
      homeRow.draws += 1;
      awayRow.draws += 1;
      homeRow.points += 1;
      awayRow.points += 1;
    } else if (homeScore > awayScore) {
      homeRow.wins += 1;
      awayRow.losses += 1;
      homeRow.points += 3;
    } else {
      awayRow.wins += 1;
      homeRow.losses += 1;
      awayRow.points += 3;
    }
  }

  function miniTable(codes, completedEvents) {
    const allowed = new Set(codes);
    const mini = new Map(codes.map(code => [code, { points:0, goalsFor:0, goalsAgainst:0 }]));
    completedEvents.filter(event =>
      event.competitors.every(team => allowed.has(team.abbreviation))
    ).forEach(event => {
      const home = homeOf(event);
      const away = awayOf(event);
      const homeScore = Number(home.score);
      const awayScore = Number(away.score);
      const homeRow = mini.get(home.abbreviation);
      const awayRow = mini.get(away.abbreviation);
      homeRow.goalsFor += homeScore;
      homeRow.goalsAgainst += awayScore;
      awayRow.goalsFor += awayScore;
      awayRow.goalsAgainst += homeScore;
      if (homeScore === awayScore) {
        homeRow.points += 1;
        awayRow.points += 1;
      } else if (homeScore > awayScore) {
        homeRow.points += 3;
      } else {
        awayRow.points += 3;
      }
    });
    return mini;
  }

  function rankRows(rows, completedEvents) {
    const pointBuckets = new Map();
    rows.forEach(row => {
      if (!pointBuckets.has(row.points)) pointBuckets.set(row.points, []);
      pointBuckets.get(row.points).push(row);
    });

    return [...pointBuckets.keys()].sort((a, b) => b - a).flatMap(points => {
      const tied = pointBuckets.get(points);
      if (tied.length === 1) return tied;
      const mini = miniTable(tied.map(row => row.abbreviation), completedEvents);
      return tied.sort((a, b) => {
        const miniA = mini.get(a.abbreviation);
        const miniB = mini.get(b.abbreviation);
        return miniB.points - miniA.points ||
          (miniB.goalsFor - miniB.goalsAgainst) - (miniA.goalsFor - miniA.goalsAgainst) ||
          miniB.goalsFor - miniA.goalsFor ||
          (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst) ||
          b.goalsFor - a.goalsFor ||
          a.displayName.localeCompare(b.displayName);
      });
    });
  }

  function buildGroupState(allEvents, letter) {
    const fixtures = allEvents.filter(event => event.slug === "group-stage" && event.group === letter);
    const table = new Map();
    fixtures.flatMap(event => event.competitors).forEach(team => {
      if (!table.has(team.abbreviation)) table.set(team.abbreviation, createRow(team));
    });
    const completedEvents = fixtures.filter(event => event.status.completed);
    completedEvents.forEach(event => applyResult(table, event));
    const entries = rankRows([...table.values()], completedEvents).map((entry, index) => ({
      ...entry,
      rank: index + 1,
      goalDifference: entry.goalsFor - entry.goalsAgainst,
      stats: {
        rank: String(index + 1),
        gamesPlayed: String(entry.played),
        wins: String(entry.wins),
        ties: String(entry.draws),
        losses: String(entry.losses),
        pointDifferential: `${entry.goalsFor - entry.goalsAgainst > 0 ? "+" : ""}${entry.goalsFor - entry.goalsAgainst}`,
        points: String(entry.points)
      }
    }));
    return {
      letter,
      name: `Group ${letter}`,
      fixtures,
      completedEvents,
      remainingEvents: fixtures.filter(event => !event.status.completed),
      entries,
      completed: completedEvents.length === fixtures.length && fixtures.length === 6
    };
  }

  function enumerateRanks(group, forcedOutcomes = {}) {
    const codes = group.entries.map(entry => entry.abbreviation);
    const basePoints = new Map(group.entries.map(entry => [entry.abbreviation, entry.points]));
    const possible = new Map(codes.map(code => [code, new Set()]));
    const remaining = group.remainingEvents;

    function record(points) {
      codes.forEach(code => {
        const value = points.get(code);
        const better = codes.filter(other => points.get(other) > value).length;
        const equalOrBetter = codes.filter(other => points.get(other) >= value).length;
        for (let rank = better + 1; rank <= equalOrBetter; rank += 1) {
          possible.get(code).add(rank);
        }
      });
    }

    function walk(index, points) {
      if (index === remaining.length) {
        record(points);
        return;
      }
      const event = remaining[index];
      const home = homeOf(event).abbreviation;
      const away = awayOf(event).abbreviation;
      const forced = forcedOutcomes[Number(event.number)];
      const outcomes = forced ? [forced] : ["home", "draw", "away"];
      outcomes.forEach(outcome => {
        const next = new Map(points);
        if (outcome === "home") next.set(home, next.get(home) + 3);
        if (outcome === "away") next.set(away, next.get(away) + 3);
        if (outcome === "draw") {
          next.set(home, next.get(home) + 1);
          next.set(away, next.get(away) + 1);
        }
        walk(index + 1, next);
      });
    }

    walk(0, basePoints);
    return Object.fromEntries([...possible].map(([code, ranks]) => [code, [...ranks].sort()]));
  }

  function knownTeam(team, knownCodes) {
    return team && knownCodes.has(team.abbreviation);
  }

  function teamRef(entry) {
    if (!entry) return null;
    return { abbreviation: entry.abbreviation, displayName: entry.displayName };
  }

  function project(allEvents, baselineEvents) {
    const groupList = GROUP_LETTERS.map(letter => buildGroupState(allEvents, letter));
    const groups = Object.fromEntries(groupList.map(group => [group.letter, group]));
    const knownCodes = new Set(groupList.flatMap(group => group.entries.map(entry => entry.abbreviation)));
    const eventByNumber = new Map(allEvents.map(event => [Number(event.number), event]));
    const baselineByNumber = new Map(baselineEvents.map(event => [Number(event.number), event]));

    groupList.forEach(group => {
      group.possibleRanks = enumerateRanks(group);
      group.teamStatus = Object.fromEntries(group.entries.map(entry => {
        const ranks = group.possibleRanks[entry.abbreviation];
        return [entry.abbreviation, {
          ranks,
          topTwoGuaranteed: ranks.length > 0 && Math.max(...ranks) <= 2,
          topTwoPossible: ranks.some(rank => rank <= 2)
        }];
      }));
      group.possibleByRank = {
        1: group.entries.filter(entry => group.possibleRanks[entry.abbreviation].includes(1)),
        2: group.entries.filter(entry => group.possibleRanks[entry.abbreviation].includes(2)),
        3: group.entries.filter(entry => group.possibleRanks[entry.abbreviation].includes(3))
      };
    });

    const thirdTable = groupList.map(group => ({ group:group.letter, team:group.entries[2] }))
      .sort((a, b) => b.team.points - a.team.points ||
        b.team.goalDifference - a.team.goalDifference ||
        b.team.goalsFor - a.team.goalsFor || a.group.localeCompare(b.group));
    const provisionalThirdGroups = new Set(thirdTable.slice(0, 8).map(item => item.group));

    function projectParticipant(matchNumber, homeAway) {
      const event = eventByNumber.get(matchNumber);
      const baseline = baselineByNumber.get(matchNumber);
      const currentTeam = event?.competitors.find(team => team.homeAway === homeAway);
      const baselineTeam = baseline?.competitors.find(team => team.homeAway === homeAway);
      const placeholder = baselineTeam?.displayName || currentTeam?.displayName || "";

      if (knownTeam(currentTeam, knownCodes) && !knownTeam(baselineTeam, knownCodes)) {
        return { kind:"confirmed", label:"確定", primary:teamRef(currentTeam), candidates:[] };
      }

      let match = placeholder.match(/^(Winner|Runner-up) Group ([A-L])$/i);
      if (match) {
        const rank = match[1].toLowerCase() === "winner" ? 1 : 2;
        const group = groups[match[2]];
        const primary = group.entries[rank - 1];
        if (group.completed) {
          return { kind:"confirmed", label:"確定", primary:teamRef(primary), candidates:[] };
        }
        return {
          kind:"provisional",
          label:`${match[2]}組${rank}位`,
          primary:teamRef(primary),
          qualified:group.teamStatus[primary.abbreviation].topTwoGuaranteed,
          candidates:group.possibleByRank[rank]
            .filter(entry => entry.abbreviation !== primary.abbreviation)
            .map(teamRef)
        };
      }

      match = placeholder.match(/^3rd Group (.+)$/i);
      if (match) {
        const eligible = match[1].split("/");
        const candidates = eligible.map(letter => ({
          ...teamRef(groups[letter]?.entries[2]),
          group:letter,
          provisionalTopEight:provisionalThirdGroups.has(letter)
        })).filter(team => team.abbreviation);
        return {
          kind:"third",
          label:`3位通過 ${eligible.join("/")}`,
          primary:null,
          candidates:candidates.sort((a, b) => Number(b.provisionalTopEight) - Number(a.provisionalTopEight))
        };
      }

      if (knownTeam(currentTeam, knownCodes)) {
        return { kind:"confirmed", label:"確定", primary:teamRef(currentTeam), candidates:[] };
      }
      return { kind:"placeholder", label:placeholder, primary:teamRef(currentTeam), candidates:[] };
    }

    const byMatch = {};
    for (let number = 73; number <= 88; number += 1) {
      byMatch[number] = {
        home:projectParticipant(number, "home"),
        away:projectParticipant(number, "away")
      };
    }

    const japanGroup = groups.F;
    const japanEntry = japanGroup.entries.find(entry => entry.abbreviation === "JPN");
    const japanMatch = japanGroup.remainingEvents.find(event =>
      event.competitors.some(team => team.abbreviation === "JPN")
    );
    const japanOutcomes = {};
    if (japanEntry && japanMatch) {
      const japanIsHome = homeOf(japanMatch).abbreviation === "JPN";
      [["win", japanIsHome ? "home" : "away"], ["draw", "draw"], ["loss", japanIsHome ? "away" : "home"]]
        .forEach(([key, result]) => {
          japanOutcomes[key] = enumerateRanks(japanGroup, { [Number(japanMatch.number)]:result }).JPN;
        });
    }

    function slotContains(slot, code) {
      return slot?.primary?.abbreviation === code || slot?.candidates?.some(team => team.abbreviation === code);
    }

    return {
      groupList,
      groups,
      thirdTable,
      provisionalThirdGroups,
      byMatch,
      japan: {
        entry:japanEntry,
        match:japanMatch,
        outcomes:japanOutcomes,
        routes:[
          { rank:1, match:75, opponent:byMatch[75].away, active:slotContains(byMatch[75].home, "JPN") },
          { rank:2, match:76, opponent:byMatch[76].home, active:slotContains(byMatch[76].away, "JPN") }
        ]
      }
    };
  }

  window.WC26_ADVANCEMENT = {
    buildGroups(allEvents) {
      return GROUP_LETTERS.map(letter => buildGroupState(allEvents, letter));
    },
    project
  };
})();
