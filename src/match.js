// 對戰流程：計時、記分板、結算畫面。
// 這裡只管流程和畫面；得分規則在 game.js（score()），這裡只讀每個角色的 score。
import { P, TEAMS } from './config.js';
import { sfx } from './audio.js';

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class Match {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.dom = {
      time: $('match-time'),
      timeBox: $('match-time-box'),
      board: $('scoreboard'),
      over: $('over'),
      overTitle: $('over-title'),
      overText: $('over-text'),
      overBoard: $('over-board'),
    };
    this.mode = 'practice';
    this.overlay = null;
    this.timeLeft = 0;
    this.boardText = '';
    this.timeText = '';
    this.onAgain = null; // main.js 設定：再玩一次
    this.onQuit = null; // main.js 設定：回到開始畫面
    $('over-again').onclick = () => {
      this.hideOverlays();
      if (this.onAgain) this.onAgain();
    };
    $('over-back').onclick = () => {
      this.hideOverlays();
      if (this.onQuit) this.onQuit();
    };
  }

  // mode：'match'＝對戰（限時，跟 AI 比分數），'practice'＝練習（沒有對手、不限時），'soccer'＝足球 2 打 2
  start(mode) {
    this.mode = mode;
    this.goals = [0, 0];
    this.timeLeft = mode === 'soccer' ? P.soccerTime : P.matchTime;
    this.timed = mode === 'match' || mode === 'survival' || mode === 'egg' || mode === 'soccer';
    this.boardText = '';
    this.timeText = '';
    this.hideOverlays();
    this.dom.timeBox.style.display = this.timed ? '' : 'none';
  }

  // 時間到時回傳 true，讓 game.js 收掉蓄力和特寫
  update(realDt, fighters) {
    this.renderBoard(fighters);
    if (this.overlay || !this.timed) return false;
    this.timeLeft -= realDt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.finish(fighters);
      return true;
    }
    const text = fmtTime(Math.ceil(this.timeLeft));
    if (text !== this.timeText) {
      this.timeText = text;
      this.dom.time.textContent = text;
      this.dom.time.classList.toggle('hurry', this.timeLeft < 15);
    }
    return false;
  }

  // 分數一樣時，擊落數多的排前面。最後存活：還活著的排前面（命多的先），淘汰的照淘汰順序
  ranking(fighters) {
    if (this.mode === 'survival') {
      return [...fighters].sort((a, b) => (a.eliminated - b.eliminated) || (b.eliminated ? b.outAt - a.outAt : b.stocks - a.stocks) || b.kos - a.kos);
    }
    return [...fighters].sort((a, b) => b.score - a.score || b.kos - a.kos);
  }

  // 小遊戲結束
  finishMini(title, text, lines, heading = '每一格') {
    this.overlay = 'over';
    this.dom.overTitle.textContent = title;
    this.dom.overText.textContent = text;
    this.dom.overBoard.innerHTML = '';
    if (lines.length) {
      const ol = document.createElement('ol');
      for (const l of lines) {
        const li = document.createElement('li');
        li.textContent = l;
        ol.appendChild(li);
      }
      this.dom.overBoard.innerHTML = `<b>${heading}</b>`;
      this.dom.overBoard.appendChild(ol);
    }
    this.dom.over.classList.add('on');
  }

  renderBoard(fighters) {
    if (this.mode === 'soccer') {
      const text = this.goals.join(':');
      if (text === this.boardText) return;
      this.boardText = text;
      this.dom.board.innerHTML = '';
      TEAMS.forEach((t, i) => {
        const cell = document.createElement('div');
        cell.className = `cell${i === 0 ? ' me' : ''}`;
        cell.style.borderColor = t.css;
        const names = fighters.filter((f) => f.team === i).map((f) => f.name).join('＋');
        cell.innerHTML = `<div class="k" style="color:${t.css}">${t.name}（${names}）</div><div class="v">${this.goals[i]}</div>`;
        this.dom.board.appendChild(cell);
      });
      return;
    }
    const mini = this.game && this.game.mini;
    if (mini) {
      const cells = mini.hudCells();
      const text = cells.map((c) => `${c.k}:${c.v}`).join('|');
      if (text === this.boardText) return;
      this.boardText = text;
      this.dom.board.innerHTML = '';
      for (const c of cells) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.innerHTML = `<div class="k">${c.k}</div><div class="v">${c.v}</div>`;
        this.dom.board.appendChild(cell);
      }
      return;
    }
    const list = this.mode === 'practice' ? fighters.slice(0, 1) : this.ranking(fighters);
    const survival = this.mode === 'survival';
    const egg = this.game && this.game.egg;
    const valueOf = (f) => (survival ? (f.eliminated ? '淘汰' : '♥'.repeat(f.stocks)) : String(f.score));
    const text = list.map((f) => `${f.name}:${valueOf(f)}:${f.state === 'out'}:${egg && egg.carrier === f}`).join('|');
    if (text === this.boardText) return;
    this.boardText = text;
    this.dom.board.innerHTML = '';
    for (const f of list) {
      const cell = document.createElement('div');
      cell.className = `cell${f.isHuman ? ' me' : ''}${f.state === 'out' ? ' out' : ''}`;
      cell.style.borderColor = f.css;
      const star = egg && egg.carrier === f ? ' ★' : '';
      cell.innerHTML = `<div class="k" style="color:${f.css}">${f.name}${star}</div><div class="v">${valueOf(f)}</div>`;
      this.dom.board.appendChild(cell);
    }
  }

  finish(fighters) {
    this.overlay = 'over';
    if (this.mode === 'soccer') {
      const [a, b] = this.goals;
      if (a > b) sfx.stageClear();
      else sfx.fail();
      this.dom.overTitle.textContent = a > b ? '藍隊贏了！' : a < b ? '紅隊贏了…' : '平手！';
      this.dom.overText.textContent = `藍隊 ${a} : ${b} 紅隊`;
      const ol = document.createElement('ol');
      for (const f of [...fighters].sort((x, y) => y.score - x.score)) {
        const li = document.createElement('li');
        li.innerHTML = `<b style="color:${f.css}">${f.name}</b>（${TEAMS[f.team].name}）　進球 ${f.score}`;
        if (f.isHuman) li.className = 'me';
        ol.appendChild(li);
      }
      this.dom.overBoard.innerHTML = '<b>進球紀錄</b>';
      this.dom.overBoard.appendChild(ol);
      this.dom.over.classList.add('on');
      return;
    }
    const rank = this.ranking(fighters);
    const me = rank.findIndex((f) => f.isHuman);
    if (me === 0) sfx.stageClear();
    else sfx.fail();
    const human = rank[me];
    if (this.mode === 'survival') {
      this.dom.overTitle.textContent = me === 0 ? '你活到最後！' : `你是第 ${me + 1} 名`;
      this.dom.overText.textContent = `擊落對手 ${human.kos} 次　剩 ${human.stocks} 條命`;
    } else {
      this.dom.overTitle.textContent = me === 0 ? '你贏了！第 1 名' : `時間到！你是第 ${me + 1} 名`;
      this.dom.overText.textContent = this.mode === 'egg'
        ? `拿著金蛋 ${human.score} 秒`
        : `得分 ${human.score}　擊落對手 ${human.kos} 次　被打出場 ${human.falls} 次`;
    }
    const ol = document.createElement('ol');
    for (const f of rank) {
      const li = document.createElement('li');
      li.innerHTML = this.mode === 'survival'
        ? `<b style="color:${f.css}">${f.name}</b>　${f.eliminated ? '淘汰' : `剩 ${f.stocks} 條命`}（擊落 ${f.kos}）`
        : `<b style="color:${f.css}">${f.name}</b>　${f.score} 分（擊落 ${f.kos}、出場 ${f.falls}）`;
      if (f.isHuman) li.className = 'me';
      ol.appendChild(li);
    }
    this.dom.overBoard.innerHTML = '<b>最終排名</b>';
    this.dom.overBoard.appendChild(ol);
    this.dom.over.classList.add('on');
  }

  // 守超市：每清完一波選一個強化（遊戲暫停到選完）
  showUpgrade(title, choices, onPick) {
    this.overlay = 'upgrade';
    const box = document.getElementById('upgrade');
    document.getElementById('upgrade-title').textContent = title;
    const list = document.getElementById('upgrade-items');
    list.innerHTML = '';
    for (const c of choices) {
      const card = document.createElement('button');
      card.className = 'upgrade-card';
      card.innerHTML = `<b>${c.name}</b><span>${c.desc}</span>`;
      card.onclick = () => {
        box.classList.remove('on');
        this.overlay = null;
        onPick(c.id);
      };
      list.appendChild(card);
    }
    box.classList.add('on');
  }

  hideOverlays() {
    this.overlay = null;
    this.dom.over.classList.remove('on');
    document.getElementById('upgrade').classList.remove('on');
  }
}
