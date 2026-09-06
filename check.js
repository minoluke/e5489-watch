#!/usr/bin/env node
'use strict';

/*
 * e5489 サンライズ出雲・瀬戸 空席ウォッチャー
 *
 * ■ なぜこの作りなのか
 *   - e5489 の空席照会は「ログイン不要」で通る。予約を確定する直前まで会員登録なしで見られる。
 *     （キャンペーンページに「会員ログインせず予約」ルートがあり、そのURLを叩いている）
 *   - ただし curl 等の素のHTTPは必ず「混雑中です【20100946】」で弾かれる。実 Google Chrome なら通る。
 *     木人と違い Cloudflare ではないので headless で問題なし＝画面が出ない。
 *   - 実Chromeでも数回に1回は本当に「混雑中」が返るので、リトライは必須。
 *
 * ■ 取得しているもの
 *   table.seat-facility の thead(設備アイコンのalt) と tbody(空席アイコンのalt) を突き合わせる。
 *   前回状態(state.json)と比べ、× → ○/△ に変わった設備だけメール通知する。
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('patchright');
const nodemailer = require('nodemailer');
const S = require('./sunrise.js');

const DIR = __dirname;
const CONFIG_PATH = path.join(DIR, 'config.json');
const STATE_PATH = path.join(DIR, 'state.json');
const LOG_PATH = path.join(DIR, 'watch.log');

const ARGS = process.argv.slice(2);
const FLAG_TEST_EMAIL = ARGS.includes('--test-email');
const FLAG_NO_EMAIL = ARGS.includes('--no-email');
const FLAG_FORCE = ARGS.includes('--force'); // 営業時間外でも実行する

// 空席アイコンのalt → 表示記号 / 予約できるか
/*
 * e5489 の空席記号は席数の幅を表す。minSeats は「最低でも何席ある」と言い切れる数。
 *   ○ 空席あり       … 11席以上
 *   △ 空席残りわずか … 1〜10席（1席しかない可能性がある）
 * 必要席数（人数 ÷ 1室あたりの定員）と突き合わせて、確実に足りる場合だけ通知する。
 */
const STATUS = {
  '空席あり':                   { mark: '○', minSeats: 11 },
  '空席残りわずか':             { mark: '△', minSeats: 1 },
  '残席なし':                   { mark: '×', minSeats: 0 },
  '座席の設定なし':             { mark: '－', minSeats: 0 },
  '空席状況のご案内ができません': { mark: '?', minSeats: 0 },
};

// ---------- ユーティリティ ----------
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_PATH, line + '\n'); } catch (_) {}
}

function loadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return fallback; }
}

function saveJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (base) => base + Math.floor(Math.random() * base * 0.5);

// 日本時間の「今」を {hhmm, ymd} で返す（マシンのTZに依存しない）
function nowJst() {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date()).reduce((a, x) => (a[x.type] = x.value, a), {});
  return { ymd: `${p.year}${p.month}${p.day}`, hhmm: Number(p.hour) * 60 + Number(p.minute) };
}

function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

// ---------- メール ----------
/*
 * メール設定の置き場所は3通り。上から順に探す。
 *   1. 環境変数 GMAIL_USER / MAIL_TO / GMAIL_APP_PASSWORD … GitHub Actions ではこれ（Secrets から渡す）
 *   2. secrets.json … ローカル実行用。gitignore 済み
 *   3. config.json の email … 旧形式との互換
 * メールアドレスもアプリパスワードもリポジトリには置かない（公開リポジトリのため）。
 */
function resolveMail(cfg) {
  const sec = loadJson(path.join(DIR, 'secrets.json'), {}) || {};
  const legacy = (cfg && cfg.email) || {};
  const pick = (env, key) => process.env[env] ? process.env[env].trim() : (sec[key] || legacy[key]);

  const user = pick('GMAIL_USER', 'gmailUser');
  const to = pick('MAIL_TO', 'to') || user;
  const pass = pick('GMAIL_APP_PASSWORD', 'gmailAppPassword');

  const missing = [];
  if (!user) missing.push('送信元Gmail (GMAIL_USER)');
  if (!pass) missing.push('アプリパスワード (GMAIL_APP_PASSWORD)');
  if (missing.length) {
    throw new Error(`${missing.join(' / ')} が見つかりません。環境変数か secrets.json に設定してください`);
  }
  return { user, to, from: sec.from || legacy.from || user, pass };
}

async function sendMail(cfg, subject, text) {
  const m = resolveMail(cfg);
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: m.user, pass: m.pass },
  });
  await transporter.sendMail({ from: m.from, to: m.to, subject, text });
}

// ---------- 1ページぶんの空席を取る ----------
async function scrapeOnce(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1200);
  return await page.evaluate(() => {
    const err = document.querySelector('.error-message');
    if (err) return { error: err.innerText.replace(/\s+/g, ' ').trim() };
    const rows = [];
    document.querySelectorAll('.route-train-list__section-body').forEach((sec) => {
      const name = ((sec.querySelector('.route-train-list__train-name p') || {}).textContent || '').trim();
      const ths = [...sec.querySelectorAll('table.seat-facility thead th')];
      const tds = [...sec.querySelectorAll('table.seat-facility tbody td')];
      rows.push({
        name,
        cols: ths.map((th, i) => ({
          alts: [...th.querySelectorAll('img')].map((im) => im.alt),
          status: tds[i] && tds[i].querySelector('img') ? tds[i].querySelector('img').alt : '',
        })),
      });
    });
    const hdr = (document.querySelector('.route-options-header__detail') || {}).innerText || '';
    return { header: hdr.replace(/\s+/g, ' ').trim(), rows };
  });
}

// ---------- メイン ----------
async function main() {
  const cfg = loadJson(CONFIG_PATH, null);
  if (!cfg) { log('ERROR: config.json が読めません'); process.exit(1); }

  if (FLAG_TEST_EMAIL) {
    log('テストメールを送信します…');
    await sendMail(cfg, '【テスト】e5489 サンライズ空席ウォッチャー', 'これはテストメールです。届いていれば設定OKです。');
    log('テストメール送信完了。受信を確認してください。');
    return;
  }

  const date = cfg.date.replace(/-/g, '');            // 20260927
  const dateLabel = cfg.date;
  const now = nowJst();

  if (date < now.ymd) { log(`乗車日 ${dateLabel} は過去です。監視を終了してください。`); return; }

  const [from, to] = [toMinutes(cfg.serviceHours.start), toMinutes(cfg.serviceHours.end)];
  if (!FLAG_FORCE && (now.hhmm < from || now.hhmm >= to)) {
    log(`e5489 の営業時間外（${cfg.serviceHours.start}〜${cfg.serviceHours.end} JST）なのでスキップ`);
    return;
  }

  // 監視したい設備から、開くべきページの種類を逆引きする
  const kinds = [...new Set(cfg.watchFacilities.map((f) => {
    const k = S.FACILITY_KIND[f];
    if (!k) throw new Error(`設備「${f}」は未対応です（対応: ${Object.keys(S.FACILITY_KIND).join(' / ')}）`);
    return k;
  }))];

  const partySize = Number(cfg.partySize) > 0 ? Number(cfg.partySize) : 1;

  const params = {
    date, departStName: cfg.departStName, arriveStName: cfg.arriveStName,
    hour: cfg.searchHour, minute: cfg.searchMinute,
  };

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    // GitHub Actions の Linux ランナーはコンテナ内で動くため sandbox を切らないと起動しない
    args: process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : [],
  });
  const observed = {};   // key -> {mark, bookable, facility, train, kind}
  const failures = [];
  let suspended = false; // e5489 が受付停止中（23:50〜0:05）
  try {
    const ctx = await browser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await ctx.newPage();

    // 開くべきページの一覧
    const targets = [];
    for (const train of cfg.trains) {
      for (const kind of kinds) targets.push({ train, kind, label: `${S.TRAIN_NAME[train]}/${kind}` });
    }

    // 取れたページから設備の空席状況を拾う
    const collect = (t, rows) => {
      for (const row of rows) {
        for (const col of row.cols) {
          const car = col.alts[0] || '';
          const facility = (S.CAR_TO_FACILITY[t.kind] || {})[car];
          if (!facility) continue;                       // このページの本命でない列は無視
          if (!cfg.watchFacilities.includes(facility)) continue;
          const smoking = (col.alts[1] || '').includes('喫煙') ? '喫煙' : '禁煙';
          const st = STATUS[col.status] || { mark: col.status || '?', minSeats: 0 };
          const capacity = S.FACILITY_CAPACITY[facility] || 1;
          const roomsNeeded = Math.ceil(partySize / capacity);
          observed[`${S.TRAIN_NAME[t.train]}|${facility}(${smoking})`] = {
            ...st, facility, smoking, train: t.train, kind: t.kind,
            capacity, roomsNeeded,
            enough: st.minSeats >= roomsNeeded,   // 人数分を確実に押さえられるか
          };
        }
      }
    };

    /*
     * 「混雑中です【20100946】」は e5489 側の一時的な断り。同じページに粘るより、
     * いったん全ページを一巡してから未取得のぶんだけ間を空けて再挑戦するほうが
     * 速く終わり、サイトへの連打にもならない。
     */
    let pending = targets;
    for (let round = 1; round <= 4 && pending.length && !suspended; round++) {
      if (round > 1) {
        const wait = jitter(8000 * (round - 1));
        log(`混雑中で ${pending.length} ページ未取得。${Math.round(wait / 1000)} 秒あけて再試行`);
        await sleep(wait);
      }
      const retry = [];
      for (const t of pending) {
        const r = await scrapeOnce(page, S.searchUrl({ ...params, train: t.train, kind: t.kind }));
        if (r.error && /混雑中/.test(r.error)) retry.push(t);
        else if (r.error && /受付を停止|20100306/.test(r.error)) {
          // 23:50〜0:05 の受付停止。異常ではないので静かに切り上げる
          log(`e5489 が受付停止中のため中断: ${r.error}`);
          suspended = true;
          break;
        }
        else if (r.error) { log(`WARN: ${t.label} 取得できず: ${r.error}`); failures.push(t.label); }
        else if (!r.rows.length) { log(`WARN: ${t.label} 経路が見つかりません（運休・区間外の可能性）`); failures.push(t.label); }
        else { collect(t, r.rows); log(`${t.label}: ${r.header}`); }
        await sleep(jitter(2000));
      }
      pending = retry;
    }
    for (const t of pending) {
      log(`WARN: ${t.label} 混雑中が続くため今回は取得できませんでした`);
      failures.push(t.label);
    }
  } finally {
    await browser.close();
  }

  // config の watchFacilities の並び順を優先度とみなして並べる（本命が件名の先頭に来るように）
  const rank = (k) => {
    const o = observed[k];
    const i = cfg.watchFacilities.indexOf(o.facility);
    return [i < 0 ? 99 : i, o.train, o.smoking === '禁煙' ? 0 : 1];
  };
  if (suspended) { log('受付停止中のため今回はスキップしました（state は変更しません）'); return; }

  const keys = Object.keys(observed).sort((a, b) => {
    const [x, y] = [rank(a), rank(b)];
    return x[0] - y[0] || String(x[1]).localeCompare(String(y[1])) || x[2] - y[2];
  });
  if (!keys.length) {
    log('ERROR: 空席情報を1件も取得できませんでした（サイト構造の変更、または全ページが混雑中）');
    process.exitCode = 1;
    return;
  }
  log(`${partySize}名で照会。現在の空席: ` + keys.map((k) => {
    const o = observed[k];
    return `${k}=${o.mark}${o.enough ? '(確保可)' : ''}`;
  }).join('  '));

  // 前回 × → 今回 ○/△ になったものだけ通知する。
  // 乗車日や区間を変えたら過去の状態は無関係になるので、その場合は前回値を捨てる
  const scope = `${dateLabel}|${cfg.departStName}→${cfg.arriveStName}`;
  const state = loadJson(STATE_PATH, {});
  const prev = state.scope === scope ? (state.statuses || {}) : {};
  const newly = keys.filter((k) => observed[k].enough && !(prev[k] && prev[k].enough));

  if (newly.length && !FLAG_NO_EMAIL) {
    const lines = newly.map((k) => {
      const o = observed[k];
      const [train, fac] = k.split('|');
      const how = o.capacity >= partySize
        ? `1室で${partySize}名`
        : `${o.roomsNeeded}席（1席あたり${o.capacity}名）`;
      return `  ${o.mark} ${train}　${fac}　${how}\n     予約 → ${S.loginBookingUrl({ ...params, train: o.train, kind: o.kind })}`;
    }).join('\n\n');
    const subject = `🚆 サンライズ ${partySize}名確保できます ${dateLabel}: ` + newly.map((k) => k.replace('|', ' ')).join(' / ');
    const body =
      `${dateLabel} ${cfg.departStName} → ${cfg.arriveStName}\n` +
      `${partySize}名ぶんを確実に確保できる設備が空きました。\n\n${lines}\n\n` +
      `── 現在の全体状況（${partySize}名で判定）──\n` +
      keys.map((k) => {
        const o = observed[k];
        const need = o.roomsNeeded > 1 ? `${o.roomsNeeded}席必要` : '1室で足りる';
        return `  ${o.mark} ${k.replace('|', '　')}　${need}${o.enough ? ' → 確保可' : ''}`;
      }).join('\n') +
      `\n\n※ △ は1〜10席のため、2席以上必要な設備では「確保可」と判定していません。\n` +
      `寝台は数分で埋まります。すぐ確保してください。\n` +
      (failures.length ? `\n※ 取得できなかったページ: ${failures.join(', ')}\n` : '') +
      `\n（同じ設備が確保可のあいだは繰り返し通知しません）`;
    try {
      await sendMail(cfg, subject, body);
      log(`★ メール通知: ${newly.join(', ')}`);
    } catch (e) {
      log(`ERROR: メール送信失敗: ${e.message}`);
      process.exitCode = 1;
      return; // 送れていないので state は更新しない（次回また通知させる）
    }
  } else if (newly.length) {
    log(`[--no-email] 新規空席 ${newly.length} 件: ${newly.join(', ')}`);
  } else {
    log('新規の空席なし（通知なし）');
  }

  // 取得できたキーだけ更新する。取りこぼしたページの状態は前回値を残す
  saveJson(STATE_PATH, { scope, statuses: { ...prev, ...observed }, lastRun: new Date().toISOString() });
}

main().catch((e) => {
  log(`ERROR: ${e.stack || e.message}`);
  process.exit(1);
});
