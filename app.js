// ===== タスケくん アプリケーションエンジン =====
(function() {
  'use strict';

  // ===== 状態管理 =====
  const state = {
    userName: '',
    route: '',          // 'death' or 'life'
    currentGenre: 0,
    currentSub: -1,
    completedGenres: {},  // { genreId: [subIndex, ...] }
    confirmedTopics: [],  // [{genre, sub, reportItems}]
    helpfulCount: 0,
    topicCount: 0,
    fontSize: 'medium',
    history: [],          // for back navigation
    phase: 'welcome',     // welcome, disclaimer, name, step2, step3, deepdive, answer, loop, bridge, fallback, closing
    deathDate: null,      // { year, month } - 任意入力
    heirCount: 0,         // 相続人数 - 任意入力
    deadlineInfo: null    // 計算された期限情報
  };

  // ===== クロスリファレンス（テーマ間の関連メッセージ） =====
  const CROSS_REF = {
    1: { 2: 'さっき確認した手続きの話と、お金・税金の話は密接に関わっているんだよ。', 3: '手続きの進め方と揉め事は切り離せない関係だからね。', 4: '実家の問題も手続きと一緒に考えておくと安心だよ。' },
    2: { 1: 'お金・税金の話と手続きは連動しているから、一緒に確認しておくと安心だよ。', 3: 'お金の問題は揉め事の原因になりやすいから、両方知っておくのが大事だよ。', 4: '実家の評価額は相続税に大きく関わるからね。' },
    3: { 1: '揉め事を防ぐには手続きの流れも知っておくと強いよ。', 2: '揉め事の背景にはお金の問題があることが多いんだ。', 4: '実家をめぐる揉め事は本当に多いから、両方知っておこう。' },
    4: { 1: '実家の手続きも相続全体の流れの中で考えると効率的だよ。', 2: '実家の評価額は相続税に直結するから大事だよ。', 3: '実家の分け方は揉め事になりやすいポイントだからね。' },
    5: { 1: '全体像を踏まえて、具体的な手続きも確認しておこう。', 2: '全体を知った上で、お金の部分も深掘りしてみよう。', 3: '全体を見た上で、揉め事の予防策も見ておくと安心だよ。' }
  };

  // スマートレコメンド（次の最適テーマ提案）
  const SMART_REC = {
    1: { to: 2, msg: '手続きを確認したなら、次は「お金・税金」も見ておくと安心だよ' },
    2: { to: 3, msg: 'お金の話を確認したなら、「揉め事・トラブル」の備えも大事だよ' },
    3: { to: 1, msg: '揉め事を防ぐには「手続き」の全体像も把握しておこう' },
    4: { to: 2, msg: '実家の問題は「お金・税金」にも直結するから確認してみよう' },
    5: { to: 1, msg: '全体を見たなら、次は具体的な「手続き」から始めるのがおすすめ' }
  };

  // ===== DOM要素 =====
  const $ = id => document.getElementById(id);
  const screens = {
    welcome: $('screen-welcome'),
    disclaimer: $('screen-disclaimer'),
    chat: $('screen-chat'),
    report: $('screen-report')
  };
  const chatMessages = $('chat-messages');
  const chatArea = $('chat-area');
  const choicesArea = $('choices-area');
  const inputArea = $('input-area');
  const inputName = $('input-name');
  const statusSwitch = $('status-switch');

  // ===== LINE版タスケくん APIサーバー =====
  const API_BASE = 'https://tasuke-bot.fly.dev';  // 本番サーバー

  // ===== 引き継ぎコード生成 =====
  function generateSessionCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 紛らわしい文字除外
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return 'WEB-' + code;
  }

  // ===== セッション内容をサーバーに保存 =====
  async function saveSessionToServer(code) {
    // 確認内容の要約を生成
    const summaryParts = [];
    state.confirmedTopics.forEach(t => {
      const genreLabel = GENRE_LABELS[t.genre] || `テーマ${t.genre}`;
      summaryParts.push(`【${genreLabel}】`);
      if (t.reportItems) t.reportItems.forEach(item => summaryParts.push(`・${item}`));
    });
    const summary = summaryParts.join('\n');

    const payload = {
      session_code: code,
      user_name: state.userName,
      route: state.route,
      confirmed_topics: state.confirmedTopics.map(t => t.genre),
      death_date: state.deathDate,
      heir_count: state.heirCount,
      deadline_info: state.deadlineInfo,
      topic_count: state.topicCount,
      summary: summary
    };
    try {
      const resp = await fetch(API_BASE + '/api/web-session/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await resp.json();
      return data.ok;
    } catch (e) {
      console.warn('[WEB-SESSION] Save failed:', e);
      return false;
    }
  }

  // ===== 画面切替 =====
  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  // ===== メッセージ表示 =====
  function addBotMessage(text, extraClass) {
    const row = document.createElement('div');
    row.className = 'message-row bot';
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble' + (extraClass ? ' ' + extraClass : '');
    // カード本文をbubble-bodyで包む（CSSの::beforeがヘッダーを生成）
    const body = document.createElement('div');
    body.className = 'bubble-body';
    body.innerHTML = replaceName(text);
    bubble.appendChild(body);
    row.appendChild(bubble);
    chatMessages.appendChild(row);
    scrollToBottom();
    return row;
  }

  function addUserMessage(text) {
    const row = document.createElement('div');
    row.className = 'message-row user';
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = text;
    row.appendChild(bubble);
    chatMessages.appendChild(row);
    scrollToBottom();
  }

  function addTypingIndicator() {
    const row = document.createElement('div');
    row.className = 'message-row bot';
    row.id = 'typing-row';
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble no-header';
    bubble.innerHTML = '<div class="typing-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>';
    row.appendChild(bubble);
    chatMessages.appendChild(row);
    scrollToBottom();
    return row;
  }

  function removeTypingIndicator() {
    const el = $('typing-row');
    if (el) el.remove();
  }

  async function showBotMessages(messages, extraClass) {
    for (let i = 0; i < messages.length; i++) {
      const typing = addTypingIndicator();
      await delay(600 + Math.random() * 400);
      removeTypingIndicator();
      addBotMessage(messages[i], extraClass);
      await delay(200);
    }
  }

  function addHelpfulButton() {
    const row = document.createElement('div');
    row.className = 'helpful-row';
    const btn = document.createElement('button');
    btn.className = 'btn-helpful';
    btn.textContent = '👍 参考になった';
    btn.addEventListener('click', function() {
      if (!this.classList.contains('pressed')) {
        this.classList.add('pressed');
        this.textContent = '👍 ありがとう！';
        state.helpfulCount++;
        triggerHaptic();
      }
    });
    row.appendChild(btn);
    chatMessages.appendChild(row);
    scrollToBottom();
  }

  // ===== 選択肢表示（LINE「タスケくんの提案」カード型） =====
  function showChoices(choices, callback, headerTitle) {
    choicesArea.innerHTML = '';
    choicesArea.style.display = 'flex';
    // ヘッダー（コンテキスト対応）
    const header = document.createElement('div');
    header.className = 'choices-header';
    header.textContent = headerTitle || 'タスケくんの提案';
    choicesArea.appendChild(header);
    // 説明テキスト
    const desc = document.createElement('div');
    desc.className = 'choices-desc';
    desc.textContent = '気になるものを選んでね。';
    choicesArea.appendChild(desc);
    choices.forEach((choice, idx) => {
      const btn = document.createElement('button');
      btn.className = 'btn-choice' + (choice.className ? ' ' + choice.className : '');
      btn.innerHTML = choice.label;
      if (choice.completed) {
        btn.classList.add('completed');
      }
      btn.addEventListener('click', () => {
        choicesArea.style.display = 'none';
        callback(idx, choice);
      });
      choicesArea.appendChild(btn);
    });
    scrollToBottom();
  }

  function hideChoices() {
    choicesArea.style.display = 'none';
    choicesArea.innerHTML = '';
  }

  // ===== ユーティリティ =====
  function replaceName(text) {
    return text.replace(/\{name\}/g, state.userName || 'あなた');
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      chatArea.scrollTop = chatArea.scrollHeight;
    });
  }

  function triggerHaptic() {
    if (navigator.vibrate) navigator.vibrate(30);
  }

  // ===== セッション保存・復元 =====
  function saveSession() {
    try {
      localStorage.setItem('tasuke_state', JSON.stringify(state));
    } catch(e) {}
  }

  function loadSession() {
    try {
      const saved = localStorage.getItem('tasuke_state');
      if (saved) return JSON.parse(saved);
    } catch(e) {}
    return null;
  }

  function clearSession() {
    try { localStorage.removeItem('tasuke_state'); } catch(e) {}
  }
  // ===== 会話フロー =====

  // Step 1: 名前入力
  async function startNameInput() {
    state.phase = 'name';
    await showBotMessages([
      "こんにちは！タスケくんだよ。相続の悩み、一人で抱え込むと大変だよね。これから一緒に、一番良い進め方を確認していこうね。",
      "少しでも親しみを持ってお話ししたいから、まずは<strong>あなたのお名前（ニックネームでもOK）</strong>を教えてもらってもいいかな？"
    ]);
    // プライバシーノート
    const note = document.createElement('div');
    note.className = 'privacy-note';
    note.innerHTML = '📝 入力いただいたニックネームは、この会話の中でお呼びするためだけに使うよ。外部に送信したり、保存したりすることはないから安心してね。';
    chatMessages.appendChild(note);
    scrollToBottom();
    inputArea.style.display = 'flex';
    inputName.focus();
  }

  // Step 2: 状況確認
  async function startStep2() {
    state.phase = 'step2';
    await showBotMessages([
      "{name}さんだね！教えてくれてありがとう。",
      "それじゃあ{name}さん、まずは今の状況を教えてもらってもいいかな？"
    ]);
    showChoices([
      { label: "① まだご家族は元気（今後のための事前準備）", value: "life" },
      { label: "② すでに亡くなっている（手続きや対応中）", value: "death" }
    ], async (idx, choice) => {
      state.route = idx === 0 ? 'life' : 'death';
      addUserMessage(choice.label);
      if (state.route === 'death') {
        document.body.classList.add('route-death');
      }
      saveSession();
      const scenario = SCENARIOS[state.route];
      await showBotMessages([scenario.reaction]);
      if (state.route === 'death') {
        await startOptionalInput();
      }
      startStep3();
    });
  }

  // オプション入力（死後ルート限定：亡くなった時期・相続人数）
  async function startOptionalInput() {
    await showBotMessages([
      "ちなみに{name}さん、もしよければ少し教えてくれるかな？期限の計算や税金の目安をお伝えできるよ。",
      "もちろん任意だから、分からなければスキップしても大丈夫！"
    ]);
    const card = document.createElement('div');
    card.className = 'optional-input-card';
    const curYear = new Date().getFullYear();
    let yearOpts = '<option value="">年</option>';
    for (let y = curYear; y >= curYear - 5; y--) yearOpts += '<option value="'+y+'">'+y+'年</option>';
    let monthOpts = '<option value="">月</option>';
    for (let m = 1; m <= 12; m++) monthOpts += '<option value="'+m+'">'+m+'月</option>';
    card.innerHTML = '<div class="choices-header">📅 任意入力</div>' +
      '<div style="background:white;padding:1rem;">' +
      '<label style="font-size:0.85rem;color:#555;display:block;margin-bottom:0.3rem;">亡くなった時期（だいたいでOK）</label>' +
      '<div style="display:flex;gap:0.5rem;margin-bottom:0.8rem;"><select id="death-year" style="flex:1;padding:0.5rem;border:1px solid #ddd;border-radius:8px;">'+yearOpts+'</select>' +
      '<select id="death-month" style="flex:1;padding:0.5rem;border:1px solid #ddd;border-radius:8px;">'+monthOpts+'</select></div>' +
      '<label style="font-size:0.85rem;color:#555;display:block;margin-bottom:0.3rem;">相続人の人数（だいたいでOK）</label>' +
      '<input type="number" id="heir-count" min="1" max="20" placeholder="例）3" style="width:100%;padding:0.5rem;border:1px solid #ddd;border-radius:8px;margin-bottom:0.8rem;box-sizing:border-box;">' +
      '<div style="display:flex;gap:0.5rem;">' +
      '<button id="btn-opt-submit" class="btn-choice" style="flex:1;background:#06C755;color:white;border:none;">次へ</button>' +
      '<button id="btn-opt-skip" class="btn-choice" style="flex:1;">スキップ</button></div></div>';
    chatMessages.appendChild(card);
    scrollToBottom();
    return new Promise(resolve => {
      card.querySelector('#btn-opt-submit').addEventListener('click', async () => {
        const y = card.querySelector('#death-year').value;
        const m = card.querySelector('#death-month').value;
        const h = parseInt(card.querySelector('#heir-count').value) || 0;
        card.remove();
        if (y && m) state.deathDate = { year: parseInt(y), month: parseInt(m) };
        if (h > 0) state.heirCount = h;
        if (state.deathDate || state.heirCount > 0) {
          addUserMessage((state.deathDate ? y+'年'+m+'月' : '') + (h > 0 ? ' / 相続人'+h+'人' : ''));
          await showDeadlineInfo();
        }
        saveSession();
        resolve();
      });
      card.querySelector('#btn-opt-skip').addEventListener('click', () => {
        card.remove();
        addUserMessage('スキップする');
        resolve();
      });
    });
  }

  // 期限計算＆表示＋手遅れセーフティネット
  async function showDeadlineInfo() {
    const msgs = [];
    if (state.deathDate) {
      const now = new Date();
      const dd = new Date(state.deathDate.year, state.deathDate.month - 1);
      const diff = (now.getFullYear() - dd.getFullYear()) * 12 + (now.getMonth() - dd.getMonth());
      const ab = 3 - diff, tx = 10 - diff, rg = 36 - diff;
      state.deadlineInfo = { abandonMonths: ab, inheritTaxMonths: tx, registryMonths: rg, monthsDiff: diff };
      let dl = "📅 {name}さんの期限を計算したよ：<br><br>";
      dl += ab > 0 ? "• <strong>相続放棄</strong> → あと約<strong>"+ab+"ヶ月</strong><br>" : "• <strong>相続放棄</strong> → ⚠️ <strong>超過の可能性あり</strong><br>";
      dl += tx > 0 ? "• <strong>相続税申告</strong> → あと約<strong>"+tx+"ヶ月</strong><br>" : "• <strong>相続税申告</strong> → ⚠️ <strong>超過の可能性あり</strong><br>";
      dl += "• <strong>相続登記</strong> → あと約<strong>"+Math.max(0,rg)+"ヶ月</strong>";
      msgs.push(dl);
      if (ab <= 0 || tx <= 0) {
        msgs.push("あ！もしかして期限が過ぎちゃってるかもしれない！<br><br>でも大丈夫、<strong>特別な事情があれば裁判所に認めてもらえるケース</strong>（上申書など）もあるから、<strong>絶対に諦めないで！</strong><br><br>今すぐ専門家にSOSを出そう。タスケくんがLINEで一緒に対応を考えるよ！");
      }
    }
    if (state.heirCount > 0) {
      const ded = 3000 + (600 * state.heirCount);
      msgs.push("💰 相続人が"+state.heirCount+"人の場合、<strong>基礎控除額は"+ded.toLocaleString()+"万円</strong>だよ。<br><br>遺産総額がこの金額以下なら、相続税の申告は不要になるよ。");
    }
    if (msgs.length > 0) await showBotMessages(msgs);
  }

  // Step 3: ジャンル選択
  async function startStep3() {
    state.phase = 'step3';
    if (state.route === 'death') {
      statusSwitch.style.display = 'block';
    }
    await showBotMessages([
      "今、{name}さんが一番気になっていることや、不安に感じていることを教えてもらえるかな？"
    ]);
    showGenreChoices();
  }

  function showGenreChoices() {
    const choices = [];
    for (let i = 1; i <= 5; i++) {
      const completed = state.completedGenres[i] && state.completedGenres[i].length > 0;
      choices.push({
        label: GENRE_LABELS[i],
        value: i,
        completed: completed
      });
    }
    showChoices(choices, async (idx, choice) => {
      state.currentGenre = idx + 1;
      addUserMessage(choice.label);
      saveSession();
      startDeepDive();
    });
  }

  // Step 4: 深掘り（サブ選択肢表示）
  async function startDeepDive() {
    state.phase = 'deepdive';
    const scenario = SCENARIOS[state.route];
    const genre = scenario.genres[state.currentGenre];
    const extraClass = state.route === 'death' ? '' : '';
    await showBotMessages([genre.deepDive]);

    const choices = genre.subs.map((sub, idx) => {
      const completed = state.completedGenres[state.currentGenre] &&
                         state.completedGenres[state.currentGenre].includes(idx);
      return {
        label: sub.label,
        value: idx,
        completed: completed
      };
    });

    showChoices(choices, async (idx, choice) => {
      state.currentSub = idx;
      addUserMessage(choice.label);
      saveSession();
      showAnswer(idx);
    }, 'お悩みの内容');
  }

  // 回答表示
  async function showAnswer(subIdx) {
    state.phase = 'answer';
    const scenario = SCENARIOS[state.route];
    const genre = scenario.genres[state.currentGenre];
    const sub = genre.subs[subIdx];

    await showBotMessages(sub.messages);

    // 完了記録
    if (!state.completedGenres[state.currentGenre]) {
      state.completedGenres[state.currentGenre] = [];
    }
    if (!state.completedGenres[state.currentGenre].includes(subIdx)) {
      state.completedGenres[state.currentGenre].push(subIdx);
      triggerHaptic();
    }

    // 確認済みトピック記録
    state.confirmedTopics.push({
      genre: state.currentGenre,
      sub: subIdx,
      reportItems: sub.reportItems || []
    });
    state.topicCount++;

    // 感情バリデーション
    await delay(300);
    const validation = state.route === 'death'
      ? "大変なことだけど、知っておくだけで全然違うからね。"
      : "今のうちに知っておくだけで、将来全然違ってくるからね。";
    await showBotMessages([validation]);

    // クロスリファレンス（前テーマとの関連メッセージ）
    if (state.topicCount > 1) {
      const prevGenres = state.confirmedTopics.slice(0, -1).map(t => t.genre);
      const curGenre = state.currentGenre;
      for (const pg of prevGenres) {
        if (CROSS_REF[pg] && CROSS_REF[pg][curGenre]) {
          await delay(300);
          await showBotMessages(['💡 ' + CROSS_REF[pg][curGenre]]);
          break;
        }
      }
    }

    addHelpfulButton();
    await delay(500);

    // 進捗メッセージ（2テーマ目以降）
    if (state.topicCount === 2) {
      await delay(300);
      const progressMsg = state.route === 'death'
        ? "{name}さん、2つ目のテーマも確認できたね。大変な中、しっかり確認してくれてありがとう。"
        : "{name}さん、もう2つも確認できたね！すごいよ！";
      await showBotMessages([progressMsg]);
    }

    // 休憩インサート（3テーマ連続確認時）
    if (state.topicCount === 3) {
      await delay(300);
      await showBotMessages([
        "{name}さん、いろんな情報を見て頭がパンパンになってない？ ちょっとお茶でも飲んで深呼吸してね🍵"
      ]);
      await delay(800);
    }

    saveSession();
    showLoopChoices();
  }

  // ループ選択（スマートレコメンド付き）
  function showLoopChoices() {
    state.phase = 'loop';
    const rec = SMART_REC[state.currentGenre];
    const recDone = rec && state.completedGenres[rec.to] && state.completedGenres[rec.to].length > 0;
    const choices = [
      { label: "🔄 他のテーマも確認する", className: "btn-choice" },
      { label: "✅ 十分確認できた！", className: "btn-choice-primary" }
    ];
    // スマートレコメンド（未確認のおすすめテーマがあれば挿入）
    if (rec && !recDone) {
      choices.splice(1, 0, { label: '💡 ' + rec.msg, className: 'btn-choice btn-recommend' });
    }
    showChoices(choices, async (idx) => {
      if (idx === 0) {
        addUserMessage("🔄 他のテーマも確認する");
        await showBotMessages(["{name}さん、他にも確認しておきたいテーマはあるかな？"]);
        showGenreChoices();
      } else if (rec && !recDone && idx === 1) {
        addUserMessage(rec.msg);
        state.currentGenre = rec.to;
        saveSession();
        startDeepDive();
      } else {
        addUserMessage("✅ 十分確認できた！");
        startBridge();
      }
    });
  }

  // ===== ブリッジ（LINE誘導）===== 
  async function startBridge() {
    state.phase = 'bridge';
    const lastGenre = state.currentGenre;
    const bridgeMsg = BRIDGE_MESSAGES[lastGenre] || BRIDGE_MESSAGES[5];
    // 複数ジャンル探索時の専用ブリッジ
    const isMultiGenre = state.topicCount >= 3;
    const msgs = ["ここまで{name}さんと一緒に確認できて、僕もうれしいよ。"];
    if (isMultiGenre) {
      msgs.push("今日は" + state.topicCount + "つのテーマを確認したよね。ただ、これらは実は全部つながっていて、{name}さんのご家庭でどう組み合わせれば一番いいのかは、本当にご家庭ごとに全く変わってくるんだよ。");
    } else {
      msgs.push("ただ、ここまでお伝えしたのはあくまで一般的なお話なんだけど、{name}さんのご家庭の場合、" + bridgeMsg);
    }
    msgs.push("それに、相続の手続きや話し合いは数ヶ月から1年がかりの<strong>長期戦</strong>なんだよね。");
    // 家族会議用レポートの生成約束（最強のLINE移行動機）
    msgs.push("LINEの方で今日{name}さんが確認した内容をまとめた<strong>『家族会議用の図解付きレポート』</strong>をプレゼントするね。それをそのまま<strong>ご家族のLINEグループに転送</strong>すれば、話し合いがすごくスムーズになるよ！");
    msgs.push("下のボタンからLINEの友だち追加をしてもらえれば、相談内容を全部引き継いだ状態で、すぐに続きを進めていけるからね！");
    await showBotMessages(msgs);
    showChoices([
      { label: "👉 LINEで相談を続ける", className: "btn-choice-line" },
      { label: "まずはここでの確認だけにする", className: "btn-choice-subtle" }
    ], async (idx) => {
      if (idx === 0) {
        addUserMessage("👉 LINEで相談を続ける");
        // セッション内容をサーバーに保存して引き継ぎコードを生成
        const code = generateSessionCode();
        const saved = await saveSessionToServer(code);
        window.open(LINE_URL, '_blank');
        if (saved) {
          await showBotMessages([
            "LINEの友だち追加画面が開いたよ！",
            "友だち追加が完了したら、LINEのトーク画面で下の引き継ぎコードを送ってね。{name}さんの確認内容をそのまま引き継いで、タスケくんが待ってるよ 🐻",
            "📋 引き継ぎコード：\n\n<strong>" + code + "</strong>\n\n↑ このコードをLINEのトーク画面にコピペしてね！"
          ]);
        } else {
          await showBotMessages([
            "LINEの友だち追加画面が開いたよ！友だち追加が完了したら、LINEのタスケくんが{name}さんを待ってるからね 🐻",
            "もしうまく開かなかった場合は、LINEアプリで「タスケくん」を検索してね！"
          ]);
        }
      } else {
        addUserMessage("まずはここでの確認だけにする");
        startFallback();
      }
    });
  }

  // ===== フォールバック（簡易レポート） =====
  async function startFallback() {
    state.phase = 'fallback';
    await showBotMessages([
      "もちろんだよ！{name}さんのペースで大丈夫。",
      "それじゃあ、今日{name}さんが確認してくれた内容をもとに、<strong>絶対に忘れないでほしい「{name}さん専用の最重要ポイント」</strong>をまとめたよ！"
    ]);

    // レポート表示
    generateReport();
    await delay(500);

    // 感情的クロージング
    await showBotMessages([
      "今日ここまで確認できただけで、{name}さんはもう大きな一歩を踏み出しているよ。",
      "もし今後、いざ手続きを進める中で「やっぱり誰かに相談したいな」「うちの場合、具体的にどう動けばいいか分からない」と迷うことがあったら、いつでも僕を頼ってね。",
      "{name}さんのこと、これからもずっと応援しているからね！"
    ]);

    // レビュー誘導（helpfulを押した人のみ）
    if (state.helpfulCount > 0) {
      await delay(500);
      await showBotMessages([
        "もしタスケくんが役に立っていたら、同じように悩んでいる人のためにレビューで教えてもらえると嬉しいな 🐻"
      ]);
    }

    // セーフティネットボタン
    showChoices([
      { label: "🟢 いつでも相談できるようにタスケくんをLINEに追加しておく", className: "btn-choice-line" },
      { label: "今日はここまでにする", className: "btn-choice-subtle" }
    ], async (idx) => {
      if (idx === 0) {
        addUserMessage("LINEに追加する");
        const code = generateSessionCode();
        const saved = await saveSessionToServer(code);
        window.open(LINE_URL, '_blank');
        if (saved) {
          await showBotMessages([
            "LINEの友だち追加画面が開いたよ！",
            "友だち追加したら、LINEのトーク画面で下のコードを送ってね。{name}さんの今日の確認内容を引き継げるよ 🐻",
            "📋 引き継ぎコード：\n\n<strong>" + code + "</strong>"
          ]);
        } else {
          await showBotMessages([
            "LINEの友だち追加画面が開いたよ！タスケくんが{name}さんを待ってるからね 🐻"
          ]);
        }
      } else {
        addUserMessage("今日はここまでにする");
      }
      // お別れ
      await showBotMessages([
        "{name}さん、今日は本当にお疲れさまでした。いつでもまたタスケくんに会いに来てね！ 🐻✨"
      ]);
      state.phase = 'closing';
      saveSession();
    });
  }

  // ===== レポート生成 =====
  function generateReport() {
    const container = document.createElement('div');
    container.className = 'report-card';

    // ヘッダー
    const header = document.createElement('div');
    header.className = 'report-header';
    header.innerHTML = '<img src="assets/tasuke-icon.png" alt="タスケくん"><div class="report-header-text"><h3>📋 ' + state.userName + 'さんの確認まとめ</h3><p>' + new Date().toLocaleDateString('ja-JP') + '</p></div>';
    container.appendChild(header);

    // レポートアイテム
    state.confirmedTopics.forEach(topic => {
      const genreLabel = GENRE_LABELS[topic.genre];
      const sectionTitle = document.createElement('div');
      sectionTitle.style.cssText = 'font-weight:700;color:#4A7C59;margin:0.8rem 0 0.4rem;font-size:0.9rem;';
      sectionTitle.textContent = '▶ ' + genreLabel;
      container.appendChild(sectionTitle);

      topic.reportItems.forEach(item => {
        const div = document.createElement('div');
        div.className = 'report-item';
        const icon = item.startsWith('❌') || item.startsWith('⚠') ? '' : '✅';
        div.innerHTML = '<span class="icon">' + icon + '</span><span>' + item + '</span>';
        container.appendChild(div);
      });
    });

    // タイムライン（死後ルートの場合）
    if (state.route === 'death') {
      const timeline = document.createElement('div');
      timeline.className = 'timeline-container';
      timeline.innerHTML = '<div style="font-weight:700;margin-bottom:0.8rem;">📅 重要な期限タイムライン</div>' +
        '<div class="timeline-bar">' +
        '<div class="timeline-marker current" style="left:5%"></div>' +
        '<div class="timeline-label" style="left:5%"><strong>今ここ</strong></div>' +
        '<div class="timeline-marker" style="left:25%"></div>' +
        '<div class="timeline-label" style="left:25%"><strong>3ヶ月</strong>放棄</div>' +
        '<div class="timeline-marker" style="left:60%"></div>' +
        '<div class="timeline-label" style="left:60%"><strong>10ヶ月</strong>税申告</div>' +
        '<div class="timeline-marker" style="left:90%"></div>' +
        '<div class="timeline-label" style="left:90%"><strong>3年</strong>登記</div>' +
        '</div>';
      container.appendChild(timeline);
    }

    // 準備度スコア（生前ルートの場合）
    if (state.route === 'life') {
      const score = document.createElement('div');
      score.className = 'score-container';
      const stars = Math.min(5, Math.max(1, state.topicCount));
      const filled = '★'.repeat(stars);
      const empty = '☆'.repeat(5 - stars);
      score.innerHTML = '<div style="font-weight:700;">🐻 ' + state.userName + 'さんの相続準備度</div>' +
        '<div class="score-stars">' + filled + empty + '</div>' +
        '<div style="font-size:0.85rem;color:#666;">確認テーマ数に応じて準備度がアップ！LINEでさらに具体的に進めよう</div>';
      container.appendChild(score);
    }

    chatMessages.appendChild(container);
    scrollToBottom();

    // レポート画面にもコピー
    const reportContainer = $('report-container');
    reportContainer.innerHTML = '';
    reportContainer.appendChild(container.cloneNode(true));
  }

  // ===== イベントハンドラ =====

  // ウェルカム画面 → 免責事項
  $('btn-start').addEventListener('click', () => {
    showScreen('disclaimer');
  });

  // 免責事項 → チャット開始
  $('btn-disclaimer-ok').addEventListener('click', () => {
    showScreen('chat');
    startNameInput();
  });

  // 名前入力送信
  $('btn-send').addEventListener('click', submitName);
  inputName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitName();
  });

  function submitName() {
    const name = inputName.value.trim();
    if (!name) return;
    state.userName = name;
    addUserMessage(name);
    inputArea.style.display = 'none';
    inputName.value = '';
    saveSession();
    startStep2();
  }

  // 文字サイズ変更
  $('btn-font-size').addEventListener('click', () => {
    $('modal-font').style.display = 'flex';
  });

  $('btn-font-close').addEventListener('click', () => {
    $('modal-font').style.display = 'none';
  });

  document.querySelectorAll('.font-option').forEach(btn => {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.font-option').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      const size = this.dataset.size;
      document.body.className = document.body.className.replace(/font-\w+/g, '');
      document.body.classList.add('font-' + size);
      state.fontSize = size;
      const preview = $('font-preview');
      preview.style.fontSize = getComputedStyle(document.documentElement).getPropertyValue('--font-size-base');
      saveSession();
    });
  });

  // ℹ️ 免責事項再表示
  $('btn-info').addEventListener('click', () => {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = '<div class="modal-content"><h3>ℹ️ タスケくんについて</h3><div class="disclaimer-text"><p>タスケくんは、相続について「まず何を知っておくべきか」「どう進めればいいか」を一緒に確認していくナビゲーターです。</p><p>実際の書類作成や申告が必要になった時は、あなたの状況に合った専門家の選び方もタスケくんがお伝えします。</p></div><button class="btn-primary" onclick="this.closest(\'.modal-overlay\').remove()">閉じる</button></div>';
    document.body.appendChild(modal);
  });

  // ステータス切替
  $('btn-status-switch').addEventListener('click', async () => {
    statusSwitch.style.display = 'none';
    document.body.classList.remove('route-death');
    state.route = 'life';
    state.completedGenres = {};
    state.confirmedTopics = [];
    state.topicCount = 0;
    addUserMessage("状況が変わった（まだ元気）");
    const scenario = SCENARIOS[state.route];
    await showBotMessages([
      "了解だよ！それじゃあ事前準備の方向で一緒に確認していこうね。",
      scenario.reaction
    ]);
    startStep3();
  });

  // 戻るボタン
  $('btn-back').addEventListener('click', () => {
    // 簡易的に直前のジャンル選択に戻す
    if (state.phase === 'deepdive' || state.phase === 'answer') {
      hideChoices();
      startStep3();
    }
  });

  // レポート画像保存
  $('btn-save-report').addEventListener('click', () => {
    alert('レポートを長押し（または右クリック）でスクリーンショットとして保存できます。');
  });

  // レポート共有
  $('btn-share-report').addEventListener('click', () => {
    if (navigator.share) {
      navigator.share({
        title: 'タスケくん - 相続確認レポート',
        text: state.userName + 'さんの相続確認まとめレポート',
        url: window.location.href
      }).catch(() => {});
    } else {
      alert('お使いのブラウザでは共有機能がサポートされていません。スクリーンショットをご利用ください。');
    }
  });

  // レポート画面の戻るボタン
  $('btn-report-back').addEventListener('click', () => {
    showScreen('chat');
  });

  // モーダル外クリックで閉じる
  $('modal-font').addEventListener('click', (e) => {
    if (e.target === $('modal-font')) {
      $('modal-font').style.display = 'none';
    }
  });

  // ===== 初期化 =====
  function init() {
    const saved = loadSession();
    if (saved && saved.userName && saved.phase !== 'welcome') {
      // 前回の続きを再開するか確認
      showScreen('chat');
      Object.assign(state, saved);
      document.body.classList.add('font-' + state.fontSize);
      if (state.route === 'death') {
        document.body.classList.add('route-death');
      }
      addBotMessage("{name}さん、また来てくれたんだね！前回の続きから始めることもできるし、最初からやり直すこともできるよ。どうする？");
      showChoices([
        { label: "前回の続きから始める", className: "btn-choice-primary" },
        { label: "最初からやり直す", className: "btn-choice-subtle" }
      ], async (idx) => {
        if (idx === 0) {
          addUserMessage("前回の続きから始める");
          await showBotMessages([
            "{name}さん、おかえり！前回は" + (state.topicCount > 0 ? state.topicCount + "つのテーマを確認したよね。" : "お話の途中だったね。") + "今日も一緒に確認していこうね。"
          ]);
          startStep3();
        } else {
          addUserMessage("最初からやり直す");
          clearSession();
          Object.assign(state, {
            userName: '', route: '', currentGenre: 0, currentSub: -1,
            completedGenres: {}, confirmedTopics: [], helpfulCount: 0,
            topicCount: 0, fontSize: 'medium', history: [], phase: 'welcome'
          });
          document.body.className = '';
          chatMessages.innerHTML = '';
          showScreen('welcome');
        }
      });
    }
    // 新規ユーザーはウェルカム画面のまま
  }

  init();

})();
