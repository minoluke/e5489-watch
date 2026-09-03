'use strict';

/*
 * サンライズ出雲・瀬戸のキャンペーンページ
 * https://www.jr-odekake.net/goyoyaku/campaign/sunriseseto_izumo/form.html
 * が内部で使っている変換テーブル（assets/js/scripts.js より）。
 *
 * e5489 の検索URLは駅名も列車略称も「Shift-JIS を %エンコードした文字列」で渡す。
 * 非ログイン版(No)とログイン版(Yes = 二重エンコード)の2系統がある。
 */

// 駅名 → Shift-JIS %エンコード（非ログイン版）
const ST_NO = {
  '東京': '%93%8C%8B%9E', '横浜': '%89%A1%95l', '熱海': '%94M%8AC', '沼津': '%8F%C0%92%C3',
  '富士': '%95x%8Em', '静岡': '%90%C3%89%AA', '浜松≪くだり≫': '%95l%8F%BC',
  '大阪≪のぼり≫': '%91%E5%8D%E3', '三ノ宮≪のぼり≫': '%8EO%83m%8B%7B', '姫路': '%95P%98H',
  '岡山': '%89%AA%8ER', '児島': '%8E%99%93%87', '坂出': '%8D%E2%8Fo',
  '高松（香川県）': '%8D%82%8F%BC%81i%8D%81%90%EC%8C%A7%81j',
  '多度津≪延長運転≫': '%91%BD%93x%92%C3', '善通寺≪延長運転≫': '%91P%92%CA%8E%9B',
  '琴平≪延長運転≫': '%8B%D5%95%BD', '倉敷': '%91q%95~', '備中高梁': '%94%F5%92%86%8D%82%97%C0',
  '新見': '%90V%8C%A9', '米子': '%95%C4%8Eq', '安来': '%88%C0%97%88', '松江': '%8F%BC%8D%5D',
  '宍道': '%8E%B3%93%B9', '出雲市': '%8Fo%89_%8Es',
};

// 駅名 → 二重エンコード（ログイン版）
const ST_YES = {
  '東京': '%2593%258C%258B%259E', '横浜': '%2589%25A1%2595l', '熱海': '%2594M%258AC',
  '沼津': '%258F%25C0%2592%25C3', '富士': '%2595x%258Em', '静岡': '%2590%25C3%2589%25AA',
  '浜松≪くだり≫': '%2595l%258F%25BC', '大阪≪のぼり≫': '%2591%25E5%258D%25E3',
  '三ノ宮≪のぼり≫': '%258EO%2583m%258B%257B', '姫路': '%2595P%2598H', '岡山': '%2589%25AA%258ER',
  '児島': '%258E%2599%2593%2587', '坂出': '%258D%25E2%258Fo',
  '高松（香川県）': '%258D%2582%258F%25BC%2581i%258D%2581%2590%25EC%258C%25A7%2581j',
  '多度津≪延長運転≫': '%2591%25BD%2593x%2592%25C3', '善通寺≪延長運転≫': '%2591P%2592%25CA%258E%259B',
  '琴平≪延長運転≫': '%258B%25D5%2595%25BD', '倉敷': '%2591q%2595~',
  '備中高梁': '%2594%25F5%2592%2586%258D%2582%2597%25C0', '新見': '%2590V%258C%25A9',
  '米子': '%2595%25C4%258Eq', '安来': '%2588%25C0%2597%2588', '松江': '%258F%25BC%258D%255D',
  '宍道': '%258E%25B3%2593%25B9', '出雲市': '%258Fo%2589_%258Es',
};

/*
 * 列車 × 「検索の種類」→ 略カナコード（inputSpecificBriefTrainKana1）
 *
 * std  … 標準編成のページ。ノビノビ座席 / シングルツイン / シングルデラックス が1枚で出る
 * single … シングル専用ページ
 * solo   … ソロ専用ページ
 * twin   … サンライズツイン専用ページ
 */
const KANA_NO = {
  seto:  { std: '%BB%BE%C4%20%20000', single: '%BB%BE%C4%BC%20000', solo: '%BB%BE%C4%BF%20000', twin: '%BB%BE%C4%BB%20000' },
  izumo: { std: '%BB%B2%BD%D3%20000', single: '%BB%B2%BD%D3%BC000', solo: '%BB%B2%BD%D3%BF000', twin: '%BB%B2%BD%D3%BB000' },
};
const KANA_YES = {
  seto:  { std: '%25BB%25BE%25C4%2520%2520000', single: '%25BB%25BE%25C4%25BC%2520000', solo: '%25BB%25BE%25C4%25BF%2520000', twin: '%25BB%25BE%25C4%25BB%2520000' },
  izumo: { std: '%25BB%25B2%25BD%25D3%2520000', single: '%25BB%25B2%25BD%25D3%25BC000', solo: '%25BB%25B2%25BD%25D3%25BF000', twin: '%25BB%25B2%25BD%25D3%25BB000' },
};

const TRAIN_NAME = { seto: 'サンライズ瀬戸', izumo: 'サンライズ出雲' };

// 設備名 → どのページを開けば載っているか
const FACILITY_KIND = {
  'ノビノビ座席': 'std',
  'シングルツイン': 'std',
  'シングルデラックス': 'std',
  'シングル': 'single',
  'ソロ': 'solo',
  'サンライズツイン': 'twin',
};

// ページ上の車種アイコン(alt) → 設備名。ページの種類ごとに意味が変わる
const CAR_TO_FACILITY = {
  std:    { '普通車指定席': 'ノビノビ座席', 'B寝台': 'シングルツイン', 'A寝台': 'シングルデラックス' },
  single: { 'B寝台': 'シングル' },
  solo:   { 'B寝台': 'ソロ' },
  twin:   { 'B寝台': 'サンライズツイン' },
};

const RETURN_PATH = 'goyoyaku/campaign/sunriseseto_izumo/form.html';
const RETURN_URL = 'https://www.jr-odekake.net/' + RETURN_PATH;

function assertKnown(map, key, what) {
  if (!(key in map)) throw new Error(`${what}「${key}」は未対応です（対応: ${Object.keys(map).join(' / ')}）`);
  return map[key];
}

// 非ログインの検索URL（ウォッチャーが叩くのはこれ）
function searchUrl({ train, kind, date, departStName, arriveStName, hour, minute }) {
  const dep = assertKnown(ST_NO, departStName, '乗車駅');
  const arr = assertKnown(ST_NO, arriveStName, '降車駅');
  const kana = assertKnown(KANA_NO, train, '列車')[kind];
  return 'https://e5489.jr-odekake.net/e5489/cspc/CBDayTimeArriveSelRsvMyDiaPC?'
    + `inputDepartStName=${dep}&inputArriveStName=${arr}&inputType=0`
    + `&inputDate=${date}&inputHour=${hour}&inputMinute=${minute}`
    + '&inputUniqueDepartSt=1&inputUniqueArriveSt=1&inputSearchType=2'
    + `&inputTransferDepartStName1=${dep}&inputTransferArriveStName1=${arr}`
    + '&inputTransferDepartStUnique1=1&inputTransferArriveStUnique1=1&inputTransferTrainType1=0001'
    + `&inputSpecificTrainType1=2&inputSpecificBriefTrainKana1=${kana}`
    + `&SequenceType=0&inputReturnUrl=${RETURN_PATH}`;
}

// J-WEST ログインを挟んでそのまま予約に入れるURL（通知メールに貼る用）
function loginBookingUrl({ train, kind, date, departStName, arriveStName, hour, minute }) {
  const dep = assertKnown(ST_YES, departStName, '乗車駅');
  const arr = assertKnown(ST_YES, arriveStName, '降車駅');
  const kana = assertKnown(KANA_YES, train, '列車')[kind];
  const e = encodeURIComponent;
  const action = 'https://clubj.jr-odekake.net/shared/pc/login2.do?JRSSID=0409&NTURL='
    + e('https://e5489.jr-odekake.net/e5489/cspc/CBDayTimeArriveSelRsvMyDiaPC?');
  const p = e('inputDepartStName=') + dep
    + e('&inputArriveStName=') + arr
    + e('&inputType=') + '0'
    + e('&inputDate=') + date
    + e('&inputHour=') + hour
    + e('&inputMinute=') + minute
    + e('&inputUniqueDepartSt=') + '1'
    + e('&inputUniqueArriveSt=') + '1'
    + e('&inputSearchType=') + '2'
    + e('&inputTransferDepartStName1=') + dep
    + e('&inputTransferArriveStName1=') + arr
    + e('&inputTransferDepartStUnique1=') + '1'
    + e('&inputTransferArriveStUnique1=') + '1'
    + e('&inputTransferTrainType1=') + '0001'
    + e('&inputSpecificTrainType1=') + '2'
    + e('&inputSpecificBriefTrainKana1=') + kana
    + e('&SequenceType=') + '0'
    + e('&inputReturnUrl=' + RETURN_PATH)
    + '&RTURL=' + e(RETURN_URL);
  return action + p;
}

module.exports = {
  ST_NO, TRAIN_NAME, FACILITY_KIND, CAR_TO_FACILITY, searchUrl, loginBookingUrl,
};
