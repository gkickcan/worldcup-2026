(function () {
  "use strict";

  const API_URL = "https://en.wikipedia.org/w/api.php?action=parse&page=2026_FIFA_World_Cup&prop=text&format=json&formatversion=2&origin=*&maxlag=5";
  const CACHE_KEY = "wc26-wikipedia-results-v1";
  const EXPECTED_MATCHES = 104;

  const TEAM_CODES = new Map(Object.entries({
    "mexico":"MEX", "czech republic":"CZE", "czechia":"CZE", "south korea":"KOR", "south africa":"RSA",
    "canada":"CAN", "bosnia and herzegovina":"BIH", "bosnia herzegovina":"BIH", "switzerland":"SUI", "qatar":"QAT",
    "brazil":"BRA", "scotland":"SCO", "haiti":"HAI", "morocco":"MAR",
    "paraguay":"PAR", "turkiye":"TUR", "turkey":"TUR", "australia":"AUS", "united states":"USA",
    "ecuador":"ECU", "germany":"GER", "ivory coast":"CIV", "curacao":"CUW",
    "netherlands":"NED", "sweden":"SWE", "japan":"JPN", "tunisia":"TUN",
    "belgium":"BEL", "iran":"IRN", "egypt":"EGY", "new zealand":"NZL",
    "spain":"ESP", "uruguay":"URU", "saudi arabia":"KSA", "cape verde":"CPV",
    "norway":"NOR", "france":"FRA", "senegal":"SEN", "iraq":"IRQ",
    "argentina":"ARG", "austria":"AUT", "algeria":"ALG", "jordan":"JOR",
    "colombia":"COL", "portugal":"POR", "uzbekistan":"UZB", "dr congo":"COD", "congo dr":"COD",
    "england":"ENG", "croatia":"CRO", "panama":"PAN", "ghana":"GHA"
  }));

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeName(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ı/g, "i")
      .replace(/[^a-zA-Z0-9]+/g, " ")
      .trim()
      .toLowerCase();
  }

  function teamCode(name) {
    return TEAM_CODES.get(normalizeName(name)) || null;
  }

  function isAllowedParticipantName(name) {
    return Boolean(teamCode(name)) ||
      /^(Winner|Runner-up) Group [A-L]$/i.test(name) ||
      /^3rd Group [A-L](\/[A-L])*$/i.test(name) ||
      /^(Winner|Loser) Match \d+$/i.test(name);
  }

  function cleanText(node) {
    return node ? node.textContent.replace(/\s+/g, " ").trim() : "";
  }

  function parseKickoff(dateText, timeText) {
    const match = timeText.replace(/\u00a0/g, " ").match(/(\d+):(\d+)\s*([ap])\.m\.\s*UTC([−+-])(\d{1,2})/i);
    if (!match || !/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
      throw new Error("日時形式を確認できません");
    }
    const hour = Number(match[1]) % 12 + (match[3].toLowerCase() === "p" ? 12 : 0);
    const offset = match[4] === "−" || match[4] === "-" ? -Number(match[5]) : Number(match[5]);
    const [year, month, day] = dateText.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day, hour - offset, Number(match[2]))).toISOString();
  }

  function parseScore(text) {
    const match = text.match(/(\d+)\s*[–-]\s*(\d+)/);
    if (!match) return null;
    const score = { home: Number(match[1]), away: Number(match[2]) };
    return score.home <= 30 && score.away <= 30 ? score : null;
  }

  function parseMatchNumber(scoreText, box, index) {
    const match = scoreText.match(/\bMatch\s+(\d+)\b/i);
    if (match) return Number(match[1]);
    if (index < 72) return null;

    const reportCell = [...box.querySelectorAll("tr.fgoals")]
      .map(row => cleanText(row.children[1]))
      .find(text => /\bReport\s+\d+\b/i.test(text));
    const report = reportCell?.match(/\bReport\s+(\d+)\b/i);
    return report ? Number(report[1]) : index + 1;
  }

  function parsePenaltyScore(box) {
    const rows = [...box.querySelectorAll("tr")];
    const headingIndex = rows.findIndex(row => cleanText(row).toLowerCase() === "penalties");
    if (headingIndex < 0) return null;
    const scoreCell = rows.slice(headingIndex + 1)
      .find(row => row.classList.contains("fgoals"))
      ?.children[1];
    return parseScore(cleanText(scoreCell));
  }

  function parseBoxes(html) {
    const documentNode = new DOMParser().parseFromString(html, "text/html");
    const boxes = [...documentNode.querySelectorAll(".footballbox")];
    if (boxes.length !== EXPECTED_MATCHES) {
      throw new Error(`試合数が${boxes.length}件でした`);
    }

    return boxes.map((box, index) => {
      const scoreText = cleanText(box.querySelector(".fscore"));
      const result = parseScore(scoreText);
      return {
        number: parseMatchNumber(scoreText, box, index),
        date: parseKickoff(
          cleanText(box.querySelector(".bday")),
          cleanText(box.querySelector(".ftime"))
        ),
        homeName: cleanText(box.querySelector(".fhome")),
        awayName: cleanText(box.querySelector(".faway")),
        result,
        penalties: result ? parsePenaltyScore(box) : null,
        extraTime: /a\.e\.t\./i.test(scoreText)
      };
    });
  }

  function sameKickoff(left, right) {
    return Math.abs(new Date(left).getTime() - new Date(right).getTime()) <= 60000;
  }

  function isGroupTeamMatch(remote, local) {
    return teamCode(remote.homeName) === local.competitors.find(team => team.homeAway === "home")?.abbreviation &&
      teamCode(remote.awayName) === local.competitors.find(team => team.homeAway === "away")?.abbreviation;
  }

  function matchRemoteEvents(remoteEvents, baselineEvents) {
    const baselineByNumber = new Map(baselineEvents.map(event => [Number(event.number), event]));
    const usedNumbers = new Set();

    const matched = remoteEvents.map(remote => {
      let baseline = remote.number ? baselineByNumber.get(remote.number) : null;
      if (!baseline) {
        const candidates = baselineEvents.filter(event =>
          !usedNumbers.has(Number(event.number)) &&
          sameKickoff(remote.date, event.date) &&
          isGroupTeamMatch(remote, event)
        );
        if (candidates.length !== 1) throw new Error("終了試合を一意に照合できません");
        baseline = candidates[0];
      }

      const number = Number(baseline.number);
      if (usedNumbers.has(number)) {
        throw new Error(`MATCH ${number} の重複を確認できません`);
      }
      if (baseline.slug === "group-stage" && !isGroupTeamMatch(remote, baseline)) {
        throw new Error(`MATCH ${number} の対戦国が一致しません`);
      }
      if (!isAllowedParticipantName(remote.homeName) || !isAllowedParticipantName(remote.awayName)) {
        throw new Error(`MATCH ${number} の国名を確認できません`);
      }
      if (remote.result && baseline.slug !== "group-stage" &&
          remote.result.home === remote.result.away && !remote.penalties) {
        throw new Error(`MATCH ${number} の勝者を確認できません`);
      }

      usedNumbers.add(number);
      return { ...remote, number };
    });

    if (usedNumbers.size !== EXPECTED_MATCHES ||
        [...usedNumbers].some(number => number < 1 || number > EXPECTED_MATCHES)) {
      throw new Error("全104試合を照合できません");
    }
    return matched.sort((a, b) => a.number - b.number);
  }

  function applyRemoteTeam(localTeam, remoteName) {
    const code = teamCode(remoteName);
    if (code) {
      localTeam.abbreviation = code;
      localTeam.displayName = remoteName;
    } else if (!TEAM_CODES.has(normalizeName(localTeam.displayName))) {
      localTeam.displayName = remoteName;
    }
  }

  function mergeResults(baselineEvents, remoteEvents) {
    const output = clone(baselineEvents);
    const outputByNumber = new Map(output.map(event => [Number(event.number), event]));

    remoteEvents.forEach(remote => {
      const event = outputByNumber.get(remote.number);
      const home = event.competitors.find(team => team.homeAway === "home");
      const away = event.competitors.find(team => team.homeAway === "away");
      applyRemoteTeam(home, remote.homeName);
      applyRemoteTeam(away, remote.awayName);
      event.date = remote.date;

      if (!remote.result) return;
      home.score = String(remote.result.home);
      away.score = String(remote.result.away);
      home.winner = false;
      away.winner = false;
      event.penalties = remote.penalties || null;
      event.extraTime = remote.extraTime;
      event.status = { state: "post", completed: true, detail: "試合終了" };

      if (remote.result.home !== remote.result.away) {
        home.winner = remote.result.home > remote.result.away;
        away.winner = remote.result.away > remote.result.home;
        if (remote.extraTime) event.status.detail = "試合終了（延長）";
      } else if (remote.penalties && remote.penalties.home !== remote.penalties.away) {
        home.winner = remote.penalties.home > remote.penalties.away;
        away.winner = remote.penalties.away > remote.penalties.home;
        event.status.detail = `試合終了（PK ${remote.penalties.home}-${remote.penalties.away}）`;
      }
    });
    return output;
  }

  function validateSnapshot(snapshot, baselineSnapshot) {
    if (!snapshot || !Array.isArray(snapshot.events) || snapshot.events.length !== EXPECTED_MATCHES) return false;
    const baselineByNumber = new Map(baselineSnapshot.events.map(event => [Number(event.number), event]));
    const numbers = new Set();
    const tournamentStart = Date.UTC(2026, 5, 10);
    const tournamentEnd = Date.UTC(2026, 6, 21);
    return snapshot.events.every(event => {
      const number = Number(event.number);
      const baseline = baselineByNumber.get(number);
      const kickoff = new Date(event.date).getTime();
      if (!baseline || numbers.has(number) || !Number.isFinite(kickoff) ||
          kickoff < tournamentStart || kickoff > tournamentEnd ||
          !Array.isArray(event.competitors) || event.competitors.length !== 2) return false;
      if (event.status?.completed && event.competitors.some(team =>
        !Number.isInteger(Number(team.score)) || Number(team.score) < 0 || Number(team.score) > 30
      )) return false;
      numbers.add(number);
      return true;
    });
  }

  function readCache(baselineSnapshot) {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
      return validateSnapshot(cached, baselineSnapshot) ? cached : null;
    } catch {
      return null;
    }
  }

  function writeCache(snapshot) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot));
    } catch {
      // Private browsing and file URLs may disable storage.
    }
  }

  function getInitialSnapshot(baselineSnapshot) {
    const cached = readCache(baselineSnapshot);
    if (cached && new Date(cached.updatedAt) > new Date(baselineSnapshot.updatedAt)) {
      return { ...clone(cached), sourceState: "cache" };
    }
    return { ...clone(baselineSnapshot), sourceState: "static" };
  }

  async function refresh(baselineSnapshot, previousSnapshot) {
    const response = await fetch(API_URL, {
      method: "GET",
      headers: { "Api-User-Agent": "WC26MatchCenter/1.0 (read-only fan project)" },
      cache: "no-cache",
      credentials: "omit"
    });
    if (!response.ok) throw new Error(`Wikipedia応答: ${response.status}`);
    const payload = await response.json();
    if (!payload.parse?.text) throw new Error("大会ページを取得できません");

    const parsed = parseBoxes(payload.parse.text);
    const matched = matchRemoteEvents(parsed, baselineSnapshot.events);
    const previousEvents = previousSnapshot?.events || baselineSnapshot.events;
    const previousByNumber = new Map(previousEvents.map(event => [Number(event.number), event]));
    const missingPreviousResult = matched.find(remote =>
      previousByNumber.get(remote.number)?.status.completed && !remote.result
    );
    if (missingPreviousResult) {
      throw new Error(`MATCH ${missingPreviousResult.number} の既存結果を確認できません`);
    }
    const snapshot = {
      updatedAt: new Date().toISOString(),
      source: "Wikipedia (CC BY-SA 4.0), schedule cross-checked against FIFA",
      revisionId: payload.parse.revid || null,
      events: mergeResults(previousEvents, matched)
    };
    if (!validateSnapshot(snapshot, baselineSnapshot)) throw new Error("更新データの検証に失敗しました");
    writeCache(snapshot);
    return snapshot;
  }

  window.WC26_LIVE = {
    getInitialSnapshot,
    refresh
  };
})();
