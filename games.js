// Мини-игры. Партии живут, пока открыта страница; рекорды и фишки хранятся только на этом устройстве
window.Games = (() => {
    const STORE = 'manhwa-games';
    const DPR_LIMIT = 2; // Выше разницы не видно, а рисовать заметно дороже
    const LEVELS = ['Лёгкий', 'Средний', 'Сложный'];
    const ICON_HREF = (name) => `<svg class="icon"><use href="#i-${name}"/></svg>`;

    // --- Сохранения ---
    const read = () => {
        try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; }
    };
    const data = { best: {}, wins: {}, level: {}, chips: 1000, ...read() };
    const save = () => {
        try { localStorage.setItem(STORE, JSON.stringify(data)); } catch (e) { /* Без хранилища игра работает до закрытия страницы */ }
    };
    const record = (key, value) => {
        if (value <= (data.best[key] || 0)) return false;
        data.best[key] = value;
        save();
        return true;
    };
    const tally = (key, result) => {
        const row = data.wins[key] || (data.wins[key] = { win: 0, lose: 0, draw: 0 });
        row[result]++;
        save();
    };

    // --- Утилиты ---
    const make = (html) => {
        const box = document.createElement('div');
        box.innerHTML = html.trim();
        return box.firstElementChild;
    };
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    const shuffle = (list) => {
        for (let i = list.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [list[i], list[j]] = [list[j], list[i]];
        }
        return list;
    };
    const dialogOpen = () => Boolean(document.querySelector('dialog[open]'));
    const touchScreen = () => matchMedia('(pointer: coarse)').matches;
    const chipsRow = (name, options, active) => `<div class="chips game-chips">${options.map((label, i) =>
        `<button type="button" class="chip small ${i === active ? 'active' : ''}" data-${name}="${i}">${label}</button>`).join('')}</div>`;
    const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    const score = (row) => row ? `${row.win} побед, ${row.lose} поражений` : 'Партий ещё не было';

    // Цвета берём из темы; после её смены кэш сбрасывается
    let palette = null;
    const colors = () => {
        if (palette) return palette;
        const style = getComputedStyle(document.documentElement);
        const get = (name) => style.getPropertyValue(name).trim();
        palette = {
            text: get('--text'),
            faint: get('--text-3'),
            tint: get('--tint'),
            strong: get('--tint-strong'),
            accent: get('--accent'),
            star: get('--star'),
            danger: get('--danger'),
            rows: ['--s-dropped', '--s-planned', '--s-on-hold', '--s-completed', '--s-reading', '--accent'].map(get)
        };
        return palette;
    };

    const roundRect = (c, x, y, w, h, r) => {
        c.beginPath();
        c.moveTo(x + r, y);
        c.arcTo(x + w, y, x + w, y + h, r);
        c.arcTo(x + w, y + h, x, y + h, r);
        c.arcTo(x, y + h, x, y, r);
        c.arcTo(x, y, x + w, y, r);
        c.closePath();
    };

    // --- Карты ---
    const SUITS = [
        { mark: '♠︎', name: 'пик', red: false },
        { mark: '♥︎', name: 'червей', red: true },
        { mark: '♦︎', name: 'бубен', red: true },
        { mark: '♣︎', name: 'треф', red: false }
    ];
    const RANKS = { 11: 'В', 12: 'Д', 13: 'К', 14: 'Т' };
    const rankName = (rank) => RANKS[rank] || String(rank);
    const cardName = (card) => `${rankName(card.rank)} ${SUITS[card.suit].name}`;

    const newDeck = (lowest, copies = 1) => {
        const deck = [];
        for (let copy = 0; copy < copies; copy++) {
            for (let suit = 0; suit < 4; suit++) {
                for (let rank = lowest; rank <= 14; rank++) deck.push({ rank, suit, id: `${rank}-${suit}-${copy}` });
            }
        }
        return shuffle(deck);
    };

    // Анимация раздачи только у карт, которых ещё не было на экране
    const cardPainter = () => {
        const seen = new Set();
        const paint = (card, { tag = 'span', attrs = 'role="img"', extra = '' } = {}) => {
            const fresh = seen.has(card.id) ? '' : 'fresh';
            seen.add(card.id);
            const { mark, red } = SUITS[card.suit];
            return `<${tag} class="pcard ${red ? 'red' : ''} ${fresh} ${extra}" aria-label="${cardName(card)}" ${attrs}>
                <b>${rankName(card.rank)}</b><i>${mark}</i>
            </${tag}>`;
        };
        paint.reset = () => seen.clear();
        return paint;
    };
    const cardBack = (extra = '') => `<span class="pcard back ${extra}" aria-hidden="true"></span>`;
    // Сжимаются все колонки, кроме последней: крайняя карта видна целиком
    const handRow = (cards, extra = '') => {
        const rest = cards.length > 1 ? `repeat(${cards.length - 1}, minmax(0, calc(var(--cw) + 5px))) ` : '';
        return `<div class="card-hand ${extra}" style="grid-template-columns:${rest}var(--cw)">${cards.join('')}</div>`;
    };

    // --- Каркас игр на холсте ---
    const arcade = (build) => (shell) => {
        const held = { left: false, right: false };
        const el = make(`<div class="game-stage">
            <canvas class="game-canvas"></canvas>
            <div class="game-overlay" hidden></div>
        </div>`);
        const canvas = el.querySelector('canvas');
        const c = canvas.getContext('2d');
        const overlay = el.querySelector('.game-overlay');
        let mode = 'idle'; // idle, run, pause, over
        let frame = 0;
        let last = 0;
        let scale = 1;

        const game = build({
            hud: shell.hud,
            held,
            finish: (title, text) => {
                mode = 'over';
                cancelAnimationFrame(frame);
                draw();
                show(title, text, 'Ещё раз', begin);
            }
        });
        el.style.setProperty('--ratio', game.width / game.height);

        const draw = () => {
            if (!canvas.width) return;
            c.setTransform(scale, 0, 0, scale, 0, 0);
            c.clearRect(0, 0, game.width, game.height);
            game.draw(c, colors());
        };
        const tick = (now) => {
            if (document.hidden || dialogOpen()) return pause();
            game.update(Math.min(0.05, (now - last) / 1000));
            last = now;
            if (mode !== 'run') return;
            draw();
            frame = requestAnimationFrame(tick);
        };
        const run = () => {
            mode = 'run';
            overlay.hidden = true;
            shell.setPaused(false);
            document.activeElement?.blur?.();
            last = performance.now();
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(tick);
        };
        const begin = () => {
            game.reset();
            run();
        };
        const pause = () => {
            if (mode !== 'run') return;
            mode = 'pause';
            cancelAnimationFrame(frame);
            shell.setPaused(true);
            show('Пауза', 'Игра ждёт тебя', 'Продолжить', run);
        };
        const show = (title, text, button, action) => {
            overlay.innerHTML = `<div class="game-dialog glass">
                <h2>${title}</h2>
                <p>${text}</p>
                ${game.options ? game.options(mode) : ''}
                <button type="button" class="btn btn-primary" data-go>${button}</button>
            </div>`;
            overlay.hidden = false;
            overlay.querySelector('[data-go]').onclick = action;
            overlay.onclick = (e) => game.pick?.(e.target, overlay);
            overlay.querySelector('[data-go]').focus({ preventScroll: true });
        };

        const point = (e) => {
            const rect = canvas.getBoundingClientRect();
            return [(e.clientX - rect.left) / rect.width * game.width, (e.clientY - rect.top) / rect.height * game.height];
        };
        for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
            canvas.addEventListener(type, (e) => {
                if (type === 'pointerdown') canvas.setPointerCapture(e.pointerId);
                if (mode === 'run') game.pointer?.(type, ...point(e));
            });
        }

        new ResizeObserver(() => {
            const rect = canvas.getBoundingClientRect();
            if (!rect.width) return;
            const dpr = Math.min(devicePixelRatio || 1, DPR_LIMIT);
            canvas.width = Math.round(rect.width * dpr);
            canvas.height = Math.round(rect.height * dpr);
            scale = canvas.width / game.width;
            draw();
        }).observe(canvas);

        game.reset();
        show(shell.title, touchScreen() ? game.hintTouch : game.hintKeys, 'Начать', begin);

        return {
            el,
            arcade: true,
            restart: begin,
            pause,
            togglePause: () => (mode === 'run' ? pause() : mode === 'pause' && run()),
            redraw: draw,
            key(e, down) {
                const key = { arrowleft: 'left', a: 'left', ф: 'left', arrowright: 'right', d: 'right', в: 'right', ' ': 'space', p: 'pause', з: 'pause' }[e.key?.toLowerCase()];
                if (!key) return;
                if (key === 'left' || key === 'right') held[key] = down; // Отпускание важно и под окном паузы
                if (!overlay.hidden) return;
                e.preventDefault();
                if (!down || e.repeat) return;
                if (key === 'pause' || (key === 'space' && !game.action?.())) pause();
            }
        };
    };

    // --- Арканоид ---
    const breakout = arcade(({ hud, held, finish }) => {
        const W = 360;
        const H = 480;
        const COLS = 8;
        const ROWS = 6;
        const BRICK_W = 42;
        const BRICK_H = 16;
        const GAP = 2;
        const LEFT = (W - COLS * (BRICK_W + GAP) + GAP) / 2;
        const TOP = 44;
        const PADDLE = { w: 78, h: 12, y: H - 34 };
        const R = 6;
        const LAYOUTS = [
            () => true,
            (r, c) => (r + c) % 2 === 0,
            (r, c) => Math.abs(c - 3.5) <= r * 0.8 + 0.5,
            (r) => r % 2 === 0,
            (r, c) => c < 3 || c > 4
        ];
        let bricks, ball, paddleX, lives, level, points, stuck, speed;

        const paintHud = () => hud(`Счёт ${points} · Жизни ${lives} · Уровень ${level}`);
        const loadLevel = () => {
            const layout = LAYOUTS[(level - 1) % LAYOUTS.length];
            const armor = Math.floor((level - 1) / LAYOUTS.length) + (level > 3 ? 1 : 0);
            bricks = [];
            for (let r = 0; r < ROWS; r++) {
                for (let c = 0; c < COLS; c++) {
                    if (layout(r, c)) bricks.push({ x: LEFT + c * (BRICK_W + GAP), y: TOP + r * (BRICK_H + GAP), row: r, hp: 1 + (r < 2 ? armor : 0) });
                }
            }
            speed = Math.min(430, 290 + level * 18);
            stick();
        };
        const stick = () => {
            stuck = true;
            ball = { x: paddleX, y: PADDLE.y - R, vx: 0, vy: 0 };
        };
        const launch = () => {
            if (!stuck) return false;
            stuck = false;
            const angle = (Math.random() - 0.5) * 0.7;
            ball.vx = speed * Math.sin(angle);
            ball.vy = -speed * Math.cos(angle);
            return true;
        };
        const hitBricks = () => {
            for (const brick of bricks) {
                const nearX = clamp(ball.x, brick.x, brick.x + BRICK_W);
                const nearY = clamp(ball.y, brick.y, brick.y + BRICK_H);
                if ((ball.x - nearX) ** 2 + (ball.y - nearY) ** 2 > R * R) continue;
                const overlapX = Math.min(ball.x + R - brick.x, brick.x + BRICK_W - ball.x + R);
                const overlapY = Math.min(ball.y + R - brick.y, brick.y + BRICK_H - ball.y + R);
                if (overlapX < overlapY) ball.vx = Math.abs(ball.vx) * Math.sign(ball.x - (brick.x + BRICK_W / 2));
                else ball.vy = Math.abs(ball.vy) * Math.sign(ball.y - (brick.y + BRICK_H / 2));
                brick.hp--;
                if (!brick.hp) {
                    bricks.splice(bricks.indexOf(brick), 1);
                    points += 10 * level;
                    paintHud();
                }
                return;
            }
        };
        const moveBall = (dt) => {
            ball.x += ball.vx * dt;
            ball.y += ball.vy * dt;
            if (ball.x < R) { ball.x = R; ball.vx = Math.abs(ball.vx); }
            if (ball.x > W - R) { ball.x = W - R; ball.vx = -Math.abs(ball.vx); }
            if (ball.y < R) { ball.y = R; ball.vy = Math.abs(ball.vy); }
            const onPaddle = ball.vy > 0 && ball.y + R >= PADDLE.y && ball.y - R <= PADDLE.y + PADDLE.h && Math.abs(ball.x - paddleX) <= PADDLE.w / 2 + R;
            if (onPaddle) {
                const angle = clamp((ball.x - paddleX) / (PADDLE.w / 2), -1, 1) * 1.05;
                ball.y = PADDLE.y - R;
                ball.vx = speed * Math.sin(angle);
                ball.vy = -speed * Math.cos(angle);
            }
            hitBricks();
        };

        return {
            width: W,
            height: H,
            hintKeys: 'Мышь или стрелки, пробел запускает мяч',
            hintTouch: 'Веди пальцем по полю, тап запускает мяч',
            reset() {
                paddleX = W / 2;
                lives = 3;
                level = 1;
                points = 0;
                loadLevel();
                paintHud();
            },
            action: launch,
            pointer(type, x) {
                paddleX = clamp(x, PADDLE.w / 2, W - PADDLE.w / 2);
                if (type === 'pointerup') launch();
            },
            update(dt) {
                if (held.left || held.right) paddleX = clamp(paddleX + (held.right ? 1 : -1) * 420 * dt, PADDLE.w / 2, W - PADDLE.w / 2);
                if (stuck) {
                    ball.x = paddleX;
                    return;
                }
                const steps = Math.ceil(speed * dt / 4);
                for (let i = 0; i < steps; i++) moveBall(dt / steps);
                if (ball.y > H + R) {
                    lives--;
                    paintHud();
                    if (!lives) {
                        const fresh = record('breakout', points);
                        return finish('Конец игры', `Счёт ${points}, уровень ${level}${fresh ? ', новый рекорд!' : ''}`);
                    }
                    stick();
                }
                if (!bricks.length) {
                    level++;
                    loadLevel();
                    paintHud();
                }
            },
            draw(c, theme) {
                for (const brick of bricks) {
                    c.fillStyle = theme.rows[brick.row];
                    roundRect(c, brick.x, brick.y, BRICK_W, BRICK_H, 4);
                    c.fill();
                    if (brick.hp > 1) {
                        c.strokeStyle = '#fff';
                        c.lineWidth = 2;
                        roundRect(c, brick.x + 2, brick.y + 2, BRICK_W - 4, BRICK_H - 4, 3);
                        c.stroke();
                    }
                }
                c.fillStyle = theme.accent;
                roundRect(c, paddleX - PADDLE.w / 2, PADDLE.y, PADDLE.w, PADDLE.h, 6);
                c.fill();
                c.fillStyle = theme.text;
                c.beginPath();
                c.arc(ball.x, ball.y, R, 0, Math.PI * 2);
                c.fill();
            }
        };
    });

    // --- Pong ---
    const pong = arcade(({ hud, held, finish }) => {
        const W = 360;
        const H = 480;
        const R = 6;
        const PADDLE = { w: 74, h: 10 };
        const MY_Y = H - 26;
        const AI_Y = 16;
        const GOAL = 7;
        const SKILL = [
            { speed: 150, miss: 60, ball: 250 },
            { speed: 235, miss: 30, ball: 290 },
            { speed: 340, miss: 10, ball: 330 }
        ];
        let me, ai, ball, wins, losses, serve, aim, skill;

        const paintHud = () => hud(`Ты ${wins} : ${losses} Компьютер`);
        const serveBall = (down) => {
            const angle = (Math.random() - 0.5) * 0.9;
            ball = { x: W / 2, y: H / 2, speed: skill.ball, vx: skill.ball * Math.sin(angle), vy: skill.ball * Math.cos(angle) * (down ? 1 : -1) };
            serve = 0.8;
            aim = W / 2;
        };
        // Куда придёт мяч с учётом отскоков от стен, плюс ошибка компьютера
        const predict = () => {
            const span = W - R * 2;
            const flight = (ball.y - AI_Y) / -ball.vy;
            const raw = ((ball.x - R + ball.vx * flight) % (span * 2) + span * 2) % (span * 2);
            aim = (raw > span ? span * 2 - raw : raw) + R + (Math.random() - 0.5) * skill.miss * 2;
        };
        const bounce = (paddleX, down) => {
            const angle = clamp((ball.x - paddleX) / (PADDLE.w / 2), -1, 1) * 0.95;
            ball.speed = Math.min(620, ball.speed * 1.05);
            ball.vx = ball.speed * Math.sin(angle);
            ball.vy = ball.speed * Math.cos(angle) * (down ? 1 : -1);
            if (!down) predict();
        };
        const goal = (mine) => {
            if (mine) wins++;
            else losses++;
            paintHud();
            if (wins < GOAL && losses < GOAL) return serveBall(!mine);
            const won = wins >= GOAL;
            tally('pong', won ? 'win' : 'lose');
            finish(won ? 'Победа' : 'Поражение', `Счёт ${wins} : ${losses}`);
        };

        return {
            width: W,
            height: H,
            hintKeys: 'Мышь или стрелки. Игра идёт до 7 очков',
            hintTouch: 'Веди пальцем по полю. Игра идёт до 7 очков',
            options: (mode) => (mode === 'pause' ? '' : chipsRow('level', LEVELS, data.level.pong ?? 1)),
            pick(target, overlay) {
                const chip = target.closest('[data-level]');
                if (!chip) return;
                data.level.pong = Number(chip.dataset.level);
                save();
                overlay.querySelectorAll('[data-level]').forEach((el) => el.classList.toggle('active', el === chip));
            },
            reset() {
                skill = SKILL[data.level.pong ?? 1];
                me = W / 2;
                ai = W / 2;
                wins = 0;
                losses = 0;
                serveBall(true);
                paintHud();
            },
            pointer(type, x) {
                me = clamp(x, PADDLE.w / 2, W - PADDLE.w / 2);
            },
            update(dt) {
                if (held.left || held.right) me = clamp(me + (held.right ? 1 : -1) * 430 * dt, PADDLE.w / 2, W - PADDLE.w / 2);
                ai = clamp(ai + clamp(aim - ai, -skill.speed * dt, skill.speed * dt), PADDLE.w / 2, W - PADDLE.w / 2);
                if (serve > 0) {
                    serve -= dt;
                    if (serve <= 0 && ball.vy < 0) predict();
                    return;
                }
                const before = ball.y; // На большой скорости мяч за кадр может проскочить ракетку
                ball.x += ball.vx * dt;
                ball.y += ball.vy * dt;
                if (ball.x < R) { ball.x = R; ball.vx = Math.abs(ball.vx); }
                if (ball.x > W - R) { ball.x = W - R; ball.vx = -Math.abs(ball.vx); }
                if (ball.vy > 0 && before + R <= MY_Y + PADDLE.h && ball.y + R >= MY_Y && Math.abs(ball.x - me) <= PADDLE.w / 2 + R) {
                    ball.y = MY_Y - R;
                    bounce(me, false);
                }
                if (ball.vy < 0 && before - R >= AI_Y && ball.y - R <= AI_Y + PADDLE.h && Math.abs(ball.x - ai) <= PADDLE.w / 2 + R) {
                    ball.y = AI_Y + PADDLE.h + R;
                    bounce(ai, true);
                    aim = W / 2;
                }
                if (ball.y < -R) goal(true);
                else if (ball.y > H + R) goal(false);
            },
            draw(c, theme) {
                c.strokeStyle = theme.strong;
                c.lineWidth = 2;
                c.setLineDash([10, 10]);
                c.beginPath();
                c.moveTo(0, H / 2);
                c.lineTo(W, H / 2);
                c.stroke();
                c.setLineDash([]);
                c.fillStyle = theme.faint;
                roundRect(c, ai - PADDLE.w / 2, AI_Y, PADDLE.w, PADDLE.h, 5);
                c.fill();
                c.fillStyle = theme.accent;
                roundRect(c, me - PADDLE.w / 2, MY_Y, PADDLE.w, PADDLE.h, 5);
                c.fill();
                c.fillStyle = theme.text;
                c.beginPath();
                c.arc(ball.x, ball.y, R, 0, Math.PI * 2);
                c.fill();
            }
        };
    });

    // --- Гонки ---
    const racing = arcade(({ hud, held, finish }) => {
        const W = 360;
        const H = 480;
        const ROAD = 30;
        const LANE = 75;
        const LANES = 4;
        const CAR = { w: 36, h: 62, y: H - 92 };
        const COIN_VALUE = 25;
        const lanePos = (lane) => ROAD + LANE * (lane + 0.5);
        const limit = (x) => clamp(x, ROAD + CAR.w / 2 + 2, W - ROAD - CAR.w / 2 - 2);
        let x, target, cars, coins, meters, money, speed, road, gap;

        const total = () => Math.floor(meters) + money * COIN_VALUE;
        const paintHud = () => hud(`Счёт ${total()} · Рекорд ${data.best.racing || 0}`);
        const spawn = () => {
            // Хотя бы одна полоса всегда свободна
            const lanes = shuffle([0, 1, 2, 3]);
            const count = speed > 460 && Math.random() < 0.4 ? 3 : Math.random() < 0.5 ? 2 : 1;
            lanes.slice(0, count).forEach((lane) => cars.push({ x: lanePos(lane), y: -70, color: Math.floor(Math.random() * 5) }));
            if (Math.random() < 0.5) coins.push({ x: lanePos(lanes[LANES - 1]), y: -40 });
            gap = 170 + Math.random() * 130;
        };
        const hits = (item, w, h) => Math.abs(item.x - x) < (w + CAR.w) / 2 - 5 && Math.abs(item.y + h / 2 - (CAR.y + CAR.h / 2)) < (h + CAR.h) / 2 - 5;
        const paintCar = (c, cx, y, color, glass) => {
            c.fillStyle = color;
            roundRect(c, cx - CAR.w / 2, y, CAR.w, CAR.h, 9);
            c.fill();
            c.fillStyle = glass;
            roundRect(c, cx - CAR.w / 2 + 6, y + 13, CAR.w - 12, 13, 4);
            c.fill();
            roundRect(c, cx - CAR.w / 2 + 6, y + 42, CAR.w - 12, 9, 3);
            c.fill();
        };

        return {
            width: W,
            height: H,
            hintKeys: 'Мышь или стрелки. Объезжай машины и собирай монеты',
            hintTouch: 'Веди пальцем по дороге. Объезжай машины и собирай монеты',
            reset() {
                x = target = lanePos(1);
                cars = [];
                coins = [];
                meters = 0;
                money = 0;
                speed = 240;
                road = 0;
                gap = 120;
                paintHud();
            },
            pointer(type, px) {
                target = limit(px);
            },
            update(dt) {
                if (held.left || held.right) {
                    x = limit(x + (held.right ? 1 : -1) * 380 * dt);
                    target = x;
                } else x += clamp(target - x, -620 * dt, 620 * dt);

                const move = speed * dt;
                meters += move / 10;
                speed = Math.min(640, 240 + meters * 0.3);
                road = (road + move) % 60;
                gap -= move;
                if (gap <= 0) spawn();
                for (const item of [...cars, ...coins]) item.y += move;
                cars = cars.filter((car) => car.y < H);
                coins = coins.filter((coin) => {
                    if (hits(coin, 22, 22)) {
                        money++;
                        return false;
                    }
                    return coin.y < H;
                });
                paintHud();
                if (cars.some((car) => hits(car, CAR.w, CAR.h))) {
                    const fresh = record('racing', total());
                    paintHud();
                    finish('Авария', `Счёт ${total()}${fresh ? ', новый рекорд!' : ''}`);
                }
            },
            draw(c, theme) {
                c.fillStyle = theme.tint;
                c.fillRect(ROAD, 0, W - ROAD * 2, H);
                c.fillStyle = theme.strong;
                c.fillRect(ROAD - 4, 0, 4, H);
                c.fillRect(W - ROAD, 0, 4, H);
                c.fillStyle = theme.faint;
                for (let lane = 1; lane < LANES; lane++) {
                    for (let y = road - 60; y < H; y += 60) c.fillRect(ROAD + LANE * lane - 1.5, y, 3, 30);
                }
                c.fillStyle = theme.star;
                for (const coin of coins) {
                    c.beginPath();
                    c.arc(coin.x, coin.y + 11, 11, 0, Math.PI * 2);
                    c.fill();
                }
                for (const car of cars) paintCar(c, car.x, car.y, theme.rows[car.color], 'rgba(15, 12, 25, 0.55)');
                paintCar(c, x, CAR.y, theme.accent, 'rgba(255, 255, 255, 0.72)');
            }
        };
    });

    // --- Башня ---
    const tower = arcade(({ hud, finish }) => {
        const W = 360;
        const H = 480;
        const BLOCK = 26;
        const START = 170;
        const SNAP = 5; // Почти точное попадание считается точным
        let blocks, moving, falling, view, floors;

        const paintHud = () => hud(`Этажи ${floors} · Рекорд ${data.best.tower || 0}`);
        const nextBlock = () => {
            const top = blocks[blocks.length - 1];
            const fromLeft = blocks.length % 2 === 0;
            moving = { x: fromLeft ? 0 : W - top.w, w: top.w, dir: fromLeft ? 1 : -1 }; // Из-за края блок не выезжает, иначе быстрый тап сразу проигрывает
        };
        const screenY = (index) => H - 44 - index * BLOCK + view;
        const drop = () => {
            const top = blocks[blocks.length - 1];
            if (Math.abs(moving.x - top.x) <= SNAP) moving.x = top.x;
            const left = Math.max(moving.x, top.x);
            const width = Math.min(moving.x + moving.w, top.x + top.w) - left;
            if (width <= 0) {
                const fresh = record('tower', floors);
                paintHud();
                finish('Башня упала', `Этажей ${floors}${fresh && floors ? ', новый рекорд!' : ''}`);
                return true;
            }
            if (width < moving.w) {
                const cutLeft = moving.x < top.x;
                falling.push({ x: cutLeft ? moving.x : left + width, w: moving.w - width, y: screenY(blocks.length) - view, speed: 0, index: blocks.length });
            }
            blocks.push({ x: left, w: width });
            floors++;
            paintHud();
            nextBlock();
            return true;
        };

        return {
            width: W,
            height: H,
            hintKeys: 'Пробел или клик ставит блок',
            hintTouch: 'Тапни, чтобы поставить блок точно на предыдущий',
            action: drop,
            reset() {
                blocks = [{ x: (W - START) / 2, w: START }];
                falling = [];
                view = 0;
                floors = 0;
                nextBlock();
                paintHud();
            },
            pointer(type) {
                if (type === 'pointerdown') drop();
            },
            update(dt) {
                const speed = Math.min(430, 170 + floors * 9);
                moving.x += moving.dir * speed * dt;
                if (moving.x > W - moving.w) moving.dir = -1;
                if (moving.x < 0) moving.dir = 1;
                const wanted = Math.max(0, blocks.length - 8) * BLOCK;
                view += (wanted - view) * Math.min(1, dt * 7);
                for (const piece of falling) {
                    piece.speed += 900 * dt;
                    piece.y += piece.speed * dt;
                }
                falling = falling.filter((piece) => piece.y < H + view);
            },
            draw(c, theme) {
                const paint = (x, y, w, index) => {
                    c.fillStyle = theme.rows[index % theme.rows.length];
                    roundRect(c, x, y, w, BLOCK - 2, Math.min(5, w / 2));
                    c.fill();
                };
                blocks.forEach((block, i) => {
                    const y = screenY(i);
                    if (y < H) paint(block.x, y, block.w, i);
                });
                paint(moving.x, screenY(blocks.length), moving.w, blocks.length);
                for (const piece of falling) paint(piece.x, piece.y + view, piece.w, piece.index);
            }
        };
    });

    // --- 2048 ---
    const merge = (shell) => {
        const SIZE = 4;
        const SWIPE = 24;
        const SLIDE = 130;
        const LETTERS = { arrowleft: 'left', a: 'left', ф: 'left', arrowright: 'right', d: 'right', в: 'right', arrowup: 'up', w: 'up', ц: 'up', arrowdown: 'down', s: 'down', ы: 'down' };
        const el = make(`<div class="merge">
            <div class="merge-board">${'<i class="merge-cell"></i>'.repeat(SIZE * SIZE)}</div>
            <p class="game-status" role="status"></p>
        </div>`);
        const board = el.querySelector('.merge-board');
        const status = el.querySelector('.game-status');
        let grid, points, nextId, over, won, start;

        const tiles = () => grid.flat().filter(Boolean);
        const paintHud = () => shell.hud(`Счёт ${points} · Рекорд ${data.best.merge || 0}`);
        const place = (node, tile) => {
            node.style.setProperty('--r', tile.r);
            node.style.setProperty('--c', tile.c);
        };
        const paint = () => {
            const alive = new Set();
            for (const tile of tiles()) {
                alive.add(String(tile.id));
                let node = board.querySelector(`[data-id="${tile.id}"]`);
                if (!node) {
                    node = make(`<span class="merge-tile fresh" data-id="${tile.id}"><b></b></span>`);
                    place(node, tile);
                    board.append(node);
                }
                place(node, tile);
                const face = node.firstChild;
                face.textContent = tile.v;
                face.style.setProperty('--p', Math.min(100, Math.log2(tile.v) * 9));
                node.classList.toggle('bright', tile.v >= 32);
                node.classList.toggle('long', tile.v >= 1024);
            }
            board.querySelectorAll('.merge-tile').forEach((node) => {
                if (!alive.has(node.dataset.id) && !node.dataset.gone) {
                    node.dataset.gone = '1';
                    setTimeout(() => node.remove(), SLIDE);
                }
            });
            paintHud();
        };
        const addTile = () => {
            const free = [];
            grid.forEach((row, r) => row.forEach((tile, c) => { if (!tile) free.push([r, c]); }));
            if (!free.length) return;
            const [r, c] = pick(free);
            grid[r][c] = { id: nextId++, v: Math.random() < 0.9 ? 2 : 4, r, c };
        };
        const stuck = () => {
            for (let r = 0; r < SIZE; r++) {
                for (let c = 0; c < SIZE; c++) {
                    const tile = grid[r][c];
                    if (!tile || grid[r][c + 1]?.v === tile.v || grid[r + 1]?.[c]?.v === tile.v) return false;
                }
            }
            return true;
        };
        // Каждая линия читается от края, к которому едут плитки
        const lineOf = (direction, i) => Array.from({ length: SIZE }, (_, j) => {
            const k = direction === 'left' || direction === 'up' ? j : SIZE - 1 - j;
            return direction === 'left' || direction === 'right' ? [i, k] : [k, i];
        });
        const move = (direction) => {
            if (over) return;
            const next = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
            const gone = [];
            let moved = false;
            for (let i = 0; i < SIZE; i++) {
                const line = lineOf(direction, i);
                let spot = 0;
                let last = null;
                for (const [r, c] of line) {
                    const tile = grid[r][c];
                    if (!tile) continue;
                    if (last && last.v === tile.v && !last.merged) {
                        last.v *= 2;
                        last.merged = true;
                        points += last.v;
                        tile.r = last.r;
                        tile.c = last.c;
                        gone.push(tile);
                        moved = true;
                        continue;
                    }
                    const [nr, nc] = line[spot++];
                    if (nr !== r || nc !== c) moved = true;
                    tile.r = nr;
                    tile.c = nc;
                    next[nr][nc] = tile;
                    last = tile;
                }
            }
            if (!moved) return;
            for (const tile of gone) {
                const node = board.querySelector(`[data-id="${tile.id}"]`);
                if (node) place(node, tile);
            }
            grid = next;
            tiles().forEach((tile) => { tile.merged = false; });
            addTile();
            record('merge', points);
            paint();
            if (!won && tiles().some((tile) => tile.v >= 2048)) {
                won = true;
                status.textContent = 'Есть 2048! Можно играть дальше';
            }
            if (stuck()) {
                over = true;
                status.textContent = `Ходов больше нет. Счёт ${points}`;
            }
        };
        const restart = () => {
            grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
            points = 0;
            nextId = 1;
            over = false;
            won = false;
            board.querySelectorAll('.merge-tile').forEach((node) => node.remove());
            status.textContent = touchScreen() ? 'Проводи пальцем, чтобы сдвинуть плитки' : 'Стрелки или WASD сдвигают плитки';
            addTile();
            addTile();
            paint();
        };

        board.addEventListener('pointerdown', (e) => {
            board.setPointerCapture(e.pointerId);
            start = [e.clientX, e.clientY];
        });
        board.addEventListener('pointerup', (e) => {
            if (!start) return;
            const dx = e.clientX - start[0];
            const dy = e.clientY - start[1];
            start = null;
            if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE) return;
            if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 'right' : 'left');
            else move(dy > 0 ? 'down' : 'up');
        });

        restart();
        return {
            el,
            restart,
            key(e, down) {
                const direction = LETTERS[e.key?.toLowerCase()];
                if (!direction) return;
                e.preventDefault();
                if (down) move(direction);
            }
        };
    };

    // --- Повтори цвета ---
    const simon = (shell) => {
        const PADS = 4;
        const el = make(`<div class="simon">
            <div class="simon-board">${Array.from({ length: PADS }, (_, i) => `<button type="button" class="simon-pad" data-pad="${i}" aria-label="Цвет ${i + 1}"></button>`).join('')}</div>
            <p class="game-status" role="status"></p>
            <div class="game-buttons"><button type="button" class="btn btn-primary" data-begin>Начать</button></div>
        </div>`);
        const pads = [...el.querySelectorAll('.simon-pad')];
        const status = el.querySelector('.game-status');
        const begin = el.querySelector('[data-begin]');
        let order, step, phase, timer; // Фазы: idle, show, input

        const paintHud = () => shell.hud(`Серия ${order.length ? order.length - (phase === 'input' ? 0 : 1) : 0} · Рекорд ${data.best.simon || 0}`);
        const flash = (index, ms) => {
            pads[index].classList.add('lit');
            setTimeout(() => pads[index].classList.remove('lit'), ms);
        };
        const nextRound = () => {
            order.push(Math.floor(Math.random() * PADS));
            step = 0;
            phase = 'show';
            paintHud();
            status.textContent = 'Смотри и запоминай';
            const beat = Math.max(280, 620 - order.length * 25);
            const showAt = (i) => {
                if (i === order.length) {
                    phase = 'input';
                    status.textContent = 'Повтори';
                    paintHud();
                    return;
                }
                flash(order[i], beat * 0.65);
                timer = setTimeout(() => showAt(i + 1), beat);
            };
            timer = setTimeout(() => showAt(0), 500);
        };
        const restart = () => {
            clearTimeout(timer);
            order = [];
            step = 0;
            phase = 'idle';
            begin.hidden = false;
            begin.textContent = 'Начать';
            status.textContent = 'Запоминай цвета и повторяй их по порядку';
            paintHud();
        };

        el.addEventListener('click', (e) => {
            const target = e.target.closest('button');
            if (!target) return;
            if ('begin' in target.dataset) {
                restart();
                begin.hidden = true;
                nextRound();
                return;
            }
            if (phase !== 'input') return;
            const index = Number(target.dataset.pad);
            flash(index, 180);
            if (index !== order[step]) {
                const done = order.length - 1;
                const fresh = record('simon', done);
                phase = 'idle';
                status.textContent = `Ошибка. Серия ${done}${fresh ? ', новый рекорд!' : ''}`;
                begin.hidden = false;
                begin.textContent = 'Ещё раз';
                paintHud();
                return;
            }
            step++;
            if (step < order.length) return;
            record('simon', order.length);
            phase = 'show';
            status.textContent = 'Верно';
            timer = setTimeout(nextRound, 650);
        });

        restart();
        return { el, restart };
    };

    // --- Сапёр ---
    const mines = (shell) => {
        const BOARDS = [
            { label: 'Лёгкий', cols: 9, rows: 9, mines: 10 },
            { label: 'Средний', cols: 12, rows: 14, mines: 26 },
            { label: 'Сложный', cols: 12, rows: 20, mines: 50 }
        ];
        const HOLD = 400;
        const el = make(`<div class="mines">
            <div class="mines-tools"></div>
            <div class="mines-board"></div>
            <p class="game-status" role="status"></p>
        </div>`);
        const tools = el.querySelector('.mines-tools');
        const grid = el.querySelector('.mines-board');
        const status = el.querySelector('.game-status');
        let board, cells, phase, seconds, timer, flagMode, holdTimer, held;

        const neighbors = (i) => {
            const { cols, rows } = board;
            const col = i % cols;
            const row = Math.floor(i / cols);
            const list = [];
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const x = col + dx;
                    const y = row + dy;
                    if ((dx || dy) && x >= 0 && y >= 0 && x < cols && y < rows) list.push(y * cols + x);
                }
            }
            return list;
        };
        const paintHud = () => {
            const flags = cells.filter((cell) => cell.flag).length;
            shell.hud(`Мин ${board.mines - flags} · ${clock(seconds)}`);
        };
        const paintCell = (cell, i, button) => {
            let label = 'закрыта';
            let content = '';
            button.className = 'mine-cell';
            if (cell.open) {
                button.classList.add('open');
                if (cell.mine) {
                    button.classList.add('boom');
                    content = ICON_HREF('mine');
                    label = 'мина';
                } else {
                    content = cell.count || '';
                    label = cell.count ? `рядом ${cell.count}` : 'пусто';
                    button.dataset.count = cell.count;
                }
            } else if (cell.flag) {
                content = ICON_HREF('flag');
                label = 'флажок';
                button.classList.add('flagged');
            } else if (phase === 'lost' && cell.mine) {
                content = ICON_HREF('mine');
                label = 'мина';
            }
            button.innerHTML = content;
            button.setAttribute('aria-label', `Ряд ${Math.floor(i / board.cols) + 1}, столбец ${i % board.cols + 1}: ${label}`);
        };
        const paint = () => {
            cells.forEach((cell, i) => paintCell(cell, i, grid.children[i]));
            paintHud();
        };
        const paintTools = () => {
            tools.innerHTML = `${chipsRow('board', BOARDS.map((b) => b.label), data.level.mines ?? 0)}
                <button type="button" class="chip small ${flagMode ? 'active' : ''}" data-flag-mode aria-pressed="${flagMode}">${ICON_HREF('flag')}Флажок</button>`;
        };
        const stopClock = () => {
            clearInterval(timer);
            timer = 0;
        };
        const reset = () => {
            stopClock();
            board = BOARDS[data.level.mines ?? 0];
            cells = Array.from({ length: board.cols * board.rows }, () => ({ mine: false, open: false, flag: false, count: 0 }));
            phase = 'ready';
            seconds = 0;
            flagMode = false;
            grid.style.setProperty('--cols', board.cols);
            grid.innerHTML = cells.map(() => '<button type="button" class="mine-cell"></button>').join('');
            status.textContent = 'Первый ход всегда безопасен';
            paintTools();
            paint();
        };
        // Мины ставятся после первого хода, чтобы он не попал на мину
        const plant = (first) => {
            const safe = new Set([first, ...neighbors(first)]);
            const spots = shuffle(cells.map((_, i) => i).filter((i) => !safe.has(i)));
            spots.slice(0, board.mines).forEach((i) => { cells[i].mine = true; });
            cells.forEach((cell, i) => { cell.count = neighbors(i).filter((n) => cells[n].mine).length; });
            phase = 'play';
            timer = setInterval(() => {
                if (document.hidden || !el.isConnected) return;
                seconds++;
                paintHud();
            }, 1000);
        };
        const reveal = (start) => {
            const stack = [start];
            while (stack.length) {
                const i = stack.pop();
                const cell = cells[i];
                if (cell.open || cell.flag) continue;
                cell.open = true;
                if (!cell.mine && !cell.count) stack.push(...neighbors(i));
            }
        };
        const settle = () => {
            if (cells.some((cell) => cell.open && cell.mine)) {
                phase = 'lost';
                stopClock();
                status.textContent = 'Подорвался. Кнопка справа вверху начнёт заново';
            } else if (cells.every((cell) => cell.mine || cell.open)) {
                phase = 'won';
                stopClock();
                const key = `mines${data.level.mines ?? 0}`;
                const best = data.best[key];
                const fresh = best === undefined || seconds < best;
                if (fresh) {
                    data.best[key] = seconds;
                    save();
                }
                status.textContent = `Поле очищено за ${clock(seconds)}${fresh ? ', новый рекорд!' : ''}`;
            }
            paint();
        };
        const flag = (i) => {
            if (phase === 'won' || phase === 'lost' || cells[i].open) return;
            cells[i].flag = !cells[i].flag;
            paint();
        };
        const open = (i) => {
            if (phase === 'won' || phase === 'lost') return;
            const cell = cells[i];
            if (cell.flag) return;
            if (phase === 'ready') {
                plant(i);
                status.textContent = 'Удержи клетку или включи «Флажок», чтобы пометить мину';
            }
            if (!cell.open) reveal(i);
            else if (neighbors(i).filter((n) => cells[n].flag).length === cell.count) neighbors(i).forEach(reveal); // Открываем соседей числа
            settle();
        };

        grid.addEventListener('pointerdown', (e) => {
            const cell = e.target.closest('.mine-cell');
            held = false;
            if (!cell || e.button) return;
            holdTimer = setTimeout(() => {
                held = true;
                flag([...grid.children].indexOf(cell));
            }, HOLD);
        });
        for (const type of ['pointerup', 'pointerleave', 'pointercancel']) grid.addEventListener(type, () => clearTimeout(holdTimer));
        grid.addEventListener('click', (e) => {
            const cell = e.target.closest('.mine-cell');
            if (!cell || held) {
                held = false;
                return;
            }
            const i = [...grid.children].indexOf(cell);
            if (flagMode && !cells[i].open) flag(i);
            else open(i);
        });
        grid.addEventListener('contextmenu', (e) => {
            const cell = e.target.closest('.mine-cell');
            if (!cell) return;
            e.preventDefault();
            if (!held) flag([...grid.children].indexOf(cell)); // На Android удержание уже поставило флажок
        });
        grid.addEventListener('keydown', (e) => {
            const cell = e.target.closest('.mine-cell');
            if (cell && e.key.toLowerCase() === 'f') flag([...grid.children].indexOf(cell));
        });
        tools.addEventListener('click', (e) => {
            const level = e.target.closest('[data-board]');
            if (level) {
                data.level.mines = Number(level.dataset.board);
                save();
                reset();
            }
            if (e.target.closest('[data-flag-mode]')) {
                flagMode = !flagMode;
                paintTools();
            }
        });

        reset();
        return { el, restart: reset };
    };

    // --- Блэкджек ---
    const blackjack = (shell) => {
        const COINS = [10, 50, 100, 500];
        const START_CHIPS = 1000;
        const DECKS = 4;
        const DEALER_DELAY = 620;
        const el = make('<div class="table-game"></div>');
        const paintCard = cardPainter();
        // В памяти фишки списываются при раздаче, а на диск попадают по итогу: перезагрузка просто отменяет раздачу
        let chips = data.chips;
        let shoe = [];
        let bet = Math.min(50, chips);
        let phase = 'bet'; // bet, play, dealer, done
        let hands = [];
        let dealer = [];
        let active = 0;
        let message = '';
        let timer = 0;

        const value = (cards) => {
            let total = 0;
            let aces = 0;
            for (const { rank } of cards) {
                total += rank === 14 ? 11 : Math.min(rank, 10);
                if (rank === 14) aces++;
            }
            while (total > 21 && aces--) total -= 10;
            return total;
        };
        const worth = (card) => (card.rank === 14 ? 11 : Math.min(card.rank, 10));
        const isBlackjack = (cards) => cards.length === 2 && value(cards) === 21;
        const draw = () => {
            if (shoe.length < 52) shoe = newDeck(2, DECKS);
            return shoe.pop();
        };

        const paintHud = () => shell.hud(`Фишки ${chips}`);
        const paint = () => {
            paintHud();
            const hideHole = phase === 'play';
            const dealerCards = dealer.map((card, i) => (hideHole && i === 1 ? cardBack() : paintCard(card)));
            const dealerScore = hideHole ? worth(dealer[0]) : value(dealer);
            const hand = hands[active];
            const canDouble = phase === 'play' && hand.cards.length === 2 && chips >= hand.bet;
            const canSplit = canDouble && hands.length === 1 && worth(hand.cards[0]) === worth(hand.cards[1]);

            el.innerHTML = `
                <section class="felt glass">
                    <div class="felt-side">
                        <span class="felt-label">Дилер${dealer.length ? ` · ${dealerScore}` : ''}</span>
                        ${handRow(dealerCards)}
                    </div>
                    ${hands.length ? hands.map((item, i) => `
                        <div class="felt-side ${hands.length > 1 && i === active && phase === 'play' ? 'current' : ''}">
                            <span class="felt-label">${hands.length > 1 ? `Рука ${i + 1}` : 'Ты'} · ${value(item.cards)} · ставка ${item.bet}</span>
                            ${handRow(item.cards.map((card) => paintCard(card)))}
                        </div>`).join('') : `<div class="felt-side"><span class="felt-label">Ты</span>${handRow([])}</div>`}
                </section>
                <p class="game-status" role="status">${message || { bet: 'Сделай ставку', play: 'Твой ход', dealer: 'Дилер берёт карты' }[phase]}</p>
                <div class="game-actions">
                    ${phase === 'bet' ? `
                        <div class="coins">${COINS.map((coin) => `<button type="button" class="coin" data-coin="${coin}" ${bet + coin > chips ? 'disabled' : ''}>${coin}</button>`).join('')}</div>
                        <div class="game-buttons">
                            <button type="button" class="btn" data-clear ${bet ? '' : 'disabled'}>Сбросить</button>
                            <button type="button" class="btn btn-primary" data-deal ${bet ? '' : 'disabled'}>Раздать · ${bet}</button>
                            ${chips < COINS[0] ? `<button type="button" class="btn" data-refill>Взять ещё ${START_CHIPS}</button>` : ''}
                        </div>` : ''}
                    ${phase === 'play' ? `
                        <div class="game-buttons">
                            <button type="button" class="btn btn-primary" data-hit>Ещё</button>
                            <button type="button" class="btn" data-stand>Хватит</button>
                            ${canDouble ? '<button type="button" class="btn" data-double>Удвоить</button>' : ''}
                            ${canSplit ? '<button type="button" class="btn" data-split>Разделить</button>' : ''}
                        </div>` : ''}
                    ${phase === 'done' ? '<div class="game-buttons"><button type="button" class="btn btn-primary" data-again>Новая раздача</button></div>' : ''}
                </div>`;
        };

        const deal = () => {
            chips -= bet;
            paintCard.reset();
            hands = [{ cards: [draw(), draw()], bet }];
            dealer = [draw(), draw()];
            active = 0;
            phase = 'play';
            message = '';
            if (isBlackjack(hands[0].cards) || isBlackjack(dealer)) return settle();
            paint();
        };
        const nextHand = () => {
            active++;
            if (active < hands.length) {
                if (value(hands[active].cards) === 21) return nextHand();
                return paint();
            }
            active = hands.length - 1;
            if (hands.every((hand) => value(hand.cards) > 21)) return settle();
            phase = 'dealer';
            dealerTurn();
        };
        const dealerTurn = () => {
            paint();
            if (value(dealer) >= 17) return settle();
            timer = setTimeout(() => {
                dealer.push(draw());
                dealerTurn();
            }, DEALER_DELAY);
        };
        const settle = () => {
            const house = value(dealer);
            const split = hands.length > 1;
            const lines = hands.map((hand, i) => {
                const mine = value(hand.cards);
                const natural = !split && isBlackjack(hand.cards);
                const prefix = split ? `Рука ${i + 1}: ` : '';
                if (mine > 21) return `${prefix}перебор`;
                if (natural && isBlackjack(dealer)) { chips += hand.bet; return `${prefix}ничья`; }
                if (natural) { chips += Math.floor(hand.bet * 2.5); return `${prefix}блэкджек, выигрыш ${Math.floor(hand.bet * 1.5)}`; }
                if (isBlackjack(dealer)) return `${prefix}у дилера блэкджек`;
                if (house > 21 || mine > house) { chips += hand.bet * 2; return `${prefix}выигрыш ${hand.bet}`; }
                if (mine === house) { chips += hand.bet; return `${prefix}ничья`; }
                return `${prefix}дилер выиграл`;
            });
            phase = 'done';
            message = lines.join(' · ');
            data.chips = chips;
            record('blackjack', chips);
            save();
            paint();
        };

        el.addEventListener('click', (e) => {
            const target = e.target.closest('button');
            if (!target) return;
            const hand = hands[active];
            if (target.dataset.coin) {
                bet += Number(target.dataset.coin);
                paint();
            } else if ('clear' in target.dataset) {
                bet = 0;
                paint();
            } else if ('deal' in target.dataset) {
                deal();
            } else if ('refill' in target.dataset) {
                chips += START_CHIPS;
                data.chips = chips;
                save();
                paint();
            } else if ('again' in target.dataset) {
                hands = [];
                dealer = [];
                message = '';
                bet = Math.min(bet, chips);
                phase = 'bet';
                paint();
            } else if ('hit' in target.dataset) {
                hand.cards.push(draw());
                if (value(hand.cards) >= 21) nextHand();
                else paint();
            } else if ('stand' in target.dataset) {
                nextHand();
            } else if ('double' in target.dataset) {
                chips -= hand.bet;
                hand.bet *= 2;
                hand.cards.push(draw());
                nextHand();
            } else if ('split' in target.dataset) {
                chips -= hand.bet;
                const other = { cards: [hand.cards.pop(), draw()], bet: hand.bet };
                hand.cards.push(draw());
                hands.push(other);
                if (hand.cards[0].rank === 14) { // После деления тузов берут только по одной карте
                    active = 1;
                    return nextHand();
                }
                if (value(hand.cards) === 21) return nextHand();
                paint();
            }
        });

        const restart = () => {
            clearTimeout(timer);
            if (phase === 'play' || phase === 'dealer') chips = data.chips; // Сброс посреди раздачи возвращает ставку
            hands = [];
            dealer = [];
            message = '';
            bet = Math.min(bet || 50, chips);
            phase = 'bet';
            paint();
        };

        paint();
        return { el, restart };
    };

    // --- Дурак ---
    const durak = (shell) => {
        const HAND = 6;
        const TABLE_LIMIT = 6;
        const AI_DELAY = 750;
        const MODES = ['Подкидной', 'Переводной'];
        const el = make('<div class="table-game"></div>');
        const paintCard = cardPainter();
        let g = null;
        let timer = 0;

        const other = (who) => (who === 'me' ? 'ai' : 'me');
        const defender = () => other(g.attacker);
        const uncovered = () => g.table.filter((pair) => !pair.d);
        const beats = (attack, card) => (card.suit === attack.suit ? card.rank > attack.rank : card.suit === g.trump);
        const power = (card) => card.rank + (card.suit === g.trump ? 13 : 0);
        const sorted = (cards) => cards.slice().sort((a, b) => power(a) - power(b) || a.suit - b.suit);
        const take = (who, card) => g.hands[who].splice(g.hands[who].indexOf(card), 1);
        const onTable = (rank) => g.table.some((pair) => pair.a.rank === rank || pair.d?.rank === rank);
        const room = () => g.table.length < TABLE_LIMIT && uncovered().length < g.hands[defender()].length;
        const canTransfer = (who) => g.mode === 1 && who === defender() && !g.taking && g.table.length > 0 && g.table.length < TABLE_LIMIT
            && g.table.every((pair) => !pair.d) && g.hands[other(who)].length > g.table.length;

        // --- Ходы ---
        const attack = (who, card) => {
            take(who, card);
            g.table.push({ a: card, d: null });
        };
        const transfer = (who, card) => {
            attack(who, card);
            g.attacker = who;
        };
        const refill = () => {
            for (const who of [g.attacker, defender()]) {
                while (g.hands[who].length < HAND && g.talon.length) g.hands[who].push(g.talon.pop());
            }
        };
        const checkEnd = () => {
            if (g.talon.length) return;
            const meOut = !g.hands.me.length;
            const aiOut = !g.hands.ai.length;
            if (!meOut && !aiOut) return;
            g.over = meOut && aiOut ? 'draw' : meOut ? 'win' : 'lose';
            tally('durak', g.over);
        };
        const closeRound = () => {
            g.taking = false;
            g.picked = null;
            refill();
            checkEnd();
        };
        const pickUp = () => {
            const loser = defender();
            for (const pair of g.table) g.hands[loser].push(pair.a, ...(pair.d ? [pair.d] : []));
            g.log = loser === 'me' ? 'Ты забрал карты' : 'Компьютер забрал карты';
            g.table = [];
            closeRound();
        };
        const clearTable = () => {
            for (const pair of g.table) g.discard.push(pair.a, pair.d);
            g.table = [];
            g.log = 'Бито';
            closeRound();
            g.attacker = other(g.attacker);
        };

        // --- Решения компьютера ---
        const lowest = (cards) => sorted(cards)[0];
        const unseen = () => {
            const known = new Set([...g.hands.ai, ...g.discard, ...g.table.flatMap((pair) => [pair.a, pair.d])].filter(Boolean).map((card) => card.id));
            return g.all.filter((card) => !known.has(card.id));
        };
        const chooseAttack = () => {
            const hand = g.hands.ai;
            if (g.level === 0) return pick(hand);
            if (g.level === 2) {
                // Колода кончилась: по вышедшим картам понятно, что на руках у игрока
                if (!g.talon.length) {
                    const rival = unseen();
                    const safe = hand.filter((card) => !rival.some((c) => beats(card, c)));
                    if (safe.length) return lowest(safe);
                }
                const paired = sorted(hand).find((card) => card.suit !== g.trump && hand.some((c) => c !== card && c.rank === card.rank));
                if (paired && power(paired) <= power(lowest(hand)) + 3) return paired;
            }
            return lowest(hand);
        };
        const chooseToss = () => {
            if (!room()) return null;
            const options = g.hands.ai.filter((card) => onTable(card.rank));
            if (!options.length) return null;
            if (g.level === 0) return Math.random() < 0.5 ? pick(options) : null;
            if (g.talon.length <= (g.level === 2 ? 4 : 0)) return lowest(options);
            const cap = (g.level === 2 ? 13 : 11) + (g.taking ? 1 : 0);
            const cheap = options.filter((card) => card.suit !== g.trump && card.rank <= cap);
            return cheap.length ? lowest(cheap) : null;
        };
        const chooseTransfer = () => {
            if (!canTransfer('ai')) return null;
            const same = g.hands.ai.filter((card) => card.rank === g.table[0].a.rank);
            const cheap = same.filter((card) => card.suit !== g.trump || !g.talon.length);
            if (!cheap.length || (g.level === 0 && Math.random() < 0.5)) return null;
            return lowest(cheap);
        };
        const chooseDefense = (target) => {
            const options = g.hands.ai.filter((card) => beats(target, card));
            if (!options.length) return null;
            if (g.level === 0) return Math.random() < 0.2 ? null : pick(options);
            const card = lowest(options);
            // В начале партии не тратим старший козырь на мелочь, но и карты копить нельзя
            const costly = card.suit === g.trump && target.suit !== g.trump && g.talon.length > 6 && g.hands.ai.length <= HAND;
            if (costly && card.rank >= (g.level === 2 ? 13 : 12) && target.rank <= 9) return null;
            return card;
        };

        const later = (run) => {
            g.busy = true;
            const game = g;
            timer = setTimeout(() => {
                if (game !== g) return;
                g.busy = false;
                run();
                advance();
            }, AI_DELAY);
        };
        const aiToss = () => {
            const card = chooseToss();
            if (card) {
                attack('ai', card);
                g.log = 'Компьютер подкинул карту';
            } else if (g.taking) pickUp();
            else clearTable();
        };
        const aiDefend = () => {
            const moved = chooseTransfer();
            if (moved) {
                transfer('ai', moved);
                g.log = 'Компьютер перевёл на тебя';
                return;
            }
            const target = uncovered()[0];
            const card = chooseDefense(target);
            if (card) {
                take('ai', card);
                target.d = card;
                g.log = 'Компьютер отбился';
            } else {
                g.taking = true;
                g.log = 'Компьютер забирает';
            }
        };
        const myMoves = (card) => {
            if (g.busy || g.over) return null;
            if (g.attacker === 'me') {
                const allowed = !g.table.length || (room() && onTable(card.rank));
                return allowed ? { attack: true, targets: [], transfer: false } : null;
            }
            if (g.taking || !uncovered().length) return null;
            const targets = uncovered().filter((pair) => beats(pair.a, card));
            const moved = canTransfer('me') && g.table[0].a.rank === card.rank;
            return targets.length || moved ? { attack: false, targets, transfer: moved } : null;
        };

        // Кто ходит дальше решается заново после каждого действия
        const advance = () => {
            g.picked = null;
            if (!g.over) {
                const open = uncovered().length;
                if (g.attacker === 'ai') {
                    if (!g.table.length) {
                        later(() => {
                            attack('ai', chooseAttack());
                            g.log = 'Компьютер ходит, отбивайся';
                        });
                    } else if (g.taking || !open) later(aiToss);
                } else if (open && !g.taking) later(aiDefend);
                else if (g.table.length && !g.hands.me.some((card) => myMoves(card))) later(g.taking ? pickUp : clearTable); // Подкинуть нечего
            }
            paint();
        };

        const start = () => {
            clearTimeout(timer);
            paintCard.reset();
            const deck = newDeck(6);
            const all = deck.slice();
            const hands = { me: deck.splice(-HAND), ai: deck.splice(-HAND) };
            const trump = deck[0].suit;
            const lowestTrump = (who) => Math.min(...hands[who].filter((card) => card.suit === trump).map((card) => card.rank), 99);
            const mine = lowestTrump('me');
            const theirs = lowestTrump('ai');
            g = {
                mode: data.level.durakMode ?? 0,
                level: data.level.durak ?? 1,
                all,
                hands,
                talon: deck,
                trump,
                trumpCard: deck[0],
                table: [],
                discard: [],
                attacker: mine === theirs ? pick(['me', 'ai']) : mine < theirs ? 'me' : 'ai',
                taking: false,
                busy: false,
                picked: null,
                over: null,
                log: ''
            };
            g.log = g.attacker === 'me' ? 'Твой ход первым' : 'Первым ходит компьютер';
            advance();
        };

        // --- Отрисовка ---
        const paintSetup = () => {
            shell.hud(score(data.wins.durak));
            g = null;
            el.innerHTML = `<section class="setup glass">
                <h2>Новая партия</h2>
                <p>Колода 36 карт, ты против компьютера</p>
                <span class="label">Правила</span>
                ${chipsRow('mode', MODES, data.level.durakMode ?? 0)}
                <span class="label">Сложность</span>
                ${chipsRow('level', LEVELS, data.level.durak ?? 1)}
                <button type="button" class="btn btn-primary btn-block" data-start>Играть</button>
            </section>`;
        };
        const statusText = () => {
            if (g.busy) return g.log;
            if (g.attacker === 'me') {
                if (!g.table.length) return `${g.log}. Выбери карту`;
                return g.taking ? 'Компьютер забирает, можно подкинуть' : 'Можно подкинуть или нажать «Бито»';
            }
            return g.log;
        };
        const paint = () => {
            if (!g) return;
            shell.hud(`${MODES[g.mode]} · ${LEVELS[g.level]}`);
            const picked = g.picked;
            const pickedMoves = picked && myMoves(picked);
            const hand = sorted(g.hands.me).map((card) => {
                const moves = myMoves(card);
                return paintCard(card, {
                    tag: 'button',
                    attrs: `type="button" data-card="${card.id}" ${moves ? '' : 'disabled'}`,
                    extra: `${!moves && !g.busy && !g.over ? 'dim' : ''} ${card === picked ? 'picked' : ''}`
                });
            });
            const pairs = g.table.map((pair, i) => {
                const target = pickedMoves?.targets.includes(pair);
                return `<div class="card-pair">
                    ${paintCard(pair.a, target ? { tag: 'button', attrs: `type="button" data-pair="${i}"`, extra: 'target' } : {})}
                    ${pair.d ? paintCard(pair.d, { extra: 'cover' }) : ''}
                </div>`;
            });
            const ready = !g.busy && !g.over;
            const open = uncovered().length;
            const iDefend = g.attacker === 'ai' && ready && open && !g.taking;
            const iClose = g.attacker === 'me' && ready && g.table.length && (!open || g.taking);

            el.innerHTML = `
                <section class="felt glass">
                    <div class="felt-side">
                        <span class="felt-label">Компьютер · ${g.hands.ai.length}</span>
                        ${handRow(g.hands.ai.map(() => cardBack()), 'small')}
                    </div>
                    <div class="durak-middle">
                        <div class="talon">
                            ${g.talon.length ? `<span class="talon-trump">${paintCard(g.trumpCard)}</span>${g.talon.length > 1 ? cardBack() : ''}` : ''}
                            <span class="felt-label">Колода ${g.talon.length}<br>Козырь ${SUITS[g.trump].mark}</span>
                        </div>
                        <div class="durak-table">${pairs.join('') || '<span class="felt-label">Стол пуст</span>'}</div>
                    </div>
                    <div class="felt-side">
                        <span class="felt-label">Ты · ${g.hands.me.length}</span>
                        ${handRow(hand)}
                    </div>
                </section>
                <p class="game-status" role="status">${g.over ? { win: 'Победа! Дурак сегодня компьютер', lose: 'Поражение: ты остался дураком', draw: 'Ничья' }[g.over] : statusText()}</p>
                <div class="game-buttons">
                    ${iDefend ? '<button type="button" class="btn" data-take>Беру</button>' : ''}
                    ${pickedMoves?.transfer ? '<button type="button" class="btn btn-primary" data-transfer>Перевести</button>' : ''}
                    ${iClose ? `<button type="button" class="btn btn-primary" data-close>${g.taking ? 'Пусть забирает' : 'Бито'}</button>` : ''}
                    ${g.over ? '<button type="button" class="btn btn-primary" data-start>Ещё партию</button><button type="button" class="btn" data-setup>Сменить правила</button>' : ''}
                </div>`;
        };

        const beat = (pair, card) => {
            take('me', card);
            pair.d = card;
            g.log = 'Отбито';
            advance();
        };
        const playCard = (card) => {
            const moves = myMoves(card);
            if (!moves) return;
            if (moves.attack) {
                attack('me', card);
                g.log = 'Ты сходил';
                return advance();
            }
            if (moves.targets.length === 1 && !moves.transfer) return beat(moves.targets[0], card);
            if (!moves.targets.length) {
                transfer('me', card);
                g.log = 'Ты перевёл на компьютер';
                return advance();
            }
            g.picked = g.picked === card ? null : card;
            g.log = moves.transfer ? 'Выбери карту, которую бьёшь, или переведи' : 'Выбери карту, которую бьёшь';
            paint();
        };

        el.addEventListener('click', (e) => {
            const target = e.target.closest('button');
            if (!target) return;
            const set = target.dataset;
            if (set.mode !== undefined || set.level !== undefined) {
                if (set.mode !== undefined) data.level.durakMode = Number(set.mode);
                else data.level.durak = Number(set.level);
                save();
                paintSetup();
            } else if ('start' in set) start();
            else if ('setup' in set) paintSetup();
            else if (!g) return;
            else if (set.card) playCard(g.hands.me.find((card) => card.id === set.card));
            else if (set.pair !== undefined) beat(g.table[Number(set.pair)], g.picked);
            else if ('transfer' in set) {
                transfer('me', g.picked);
                g.log = 'Ты перевёл на компьютер';
                advance();
            } else if ('take' in set) {
                g.taking = true;
                g.log = 'Ты забираешь карты';
                advance();
            } else if ('close' in set) {
                if (g.taking) pickUp();
                else clearTable();
                advance();
            }
        });

        const restart = () => {
            clearTimeout(timer);
            paintSetup();
        };

        paintSetup();
        return { el, restart };
    };

    // --- Раздел ---
    const CATALOG = {
        racing: { title: 'Гонки', text: 'Объезжай машины на трассе', icon: 'car', create: racing, note: () => `Рекорд ${data.best.racing || 0}` },
        merge: { title: '2048', text: 'Складывай плитки без спешки', icon: 'grid', create: merge, note: () => `Рекорд ${data.best.merge || 0}` },
        tower: { title: 'Башня', text: 'Ставь блоки в один тап', icon: 'stack', create: tower, note: () => `Рекорд ${data.best.tower || 0}` },
        simon: { title: 'Повтори цвета', text: 'Запомни и повтори цепочку', icon: 'sparkles', create: simon, note: () => `Рекорд ${data.best.simon || 0}` },
        mines: { title: 'Сапёр', text: 'Открой поле и не подорвись', icon: 'mine', create: mines, note: () => {
            const best = data.best[`mines${data.level.mines ?? 0}`];
            return best === undefined ? 'Рекорда пока нет' : `Рекорд ${clock(best)}`;
        } },
        breakout: { title: 'Арканоид', text: 'Разбей все блоки мячом', icon: 'bricks', create: breakout, note: () => `Рекорд ${data.best.breakout || 0}` },
        pong: { title: 'Pong', text: 'Дуэль с компьютером до 7 очков', icon: 'pong', create: pong, note: () => score(data.wins.pong) },
        blackjack: { title: 'Блэкджек', text: 'Набери 21 и обыграй дилера', icon: 'cards', create: blackjack, note: () => `Фишки ${data.chips}` },
        durak: { title: 'Дурак', text: 'Подкидной и переводной', icon: 'cards', create: durak, note: () => score(data.wins.durak) }
    };

    const root = make('<div class="games"></div>');
    const made = {};
    let current = null;
    let bar = null; // Строка над открытой игрой

    // Игра держит свой счёт и паузу, а строка показывает их только у открытой игры
    const shellFor = (title) => {
        let text = '';
        let paused = false;
        const shell = {
            title,
            hud: (value) => {
                text = value;
                shell.paint();
            },
            setPaused: (value) => {
                paused = value;
                shell.paint();
            },
            paint: () => {
                if (bar?.shell !== shell) return;
                bar.hud.textContent = text;
                bar.pause.querySelector('use').setAttribute('href', `#i-${paused ? 'play' : 'pause'}`);
            }
        };
        return shell;
    };

    const paintMenu = () => {
        current = null;
        bar = null;
        root.innerHTML = `
            <div class="page-head">
                <h1 class="page-title">Игры</h1>
                <p class="page-sub">Перерыв между главами</p>
            </div>
            <div class="game-grid">${Object.entries(CATALOG).map(([id, game]) => `
                <button type="button" class="game-card glass" data-game="${id}">
                    <span class="brand-mark">${ICON_HREF(game.icon)}</span>
                    <span class="game-card-text">
                        <b>${game.title}</b>
                        <span>${game.text}</span>
                        <small>${game.note()}</small>
                    </span>
                </button>`).join('')}
            </div>`;
    };

    const openGame = (id) => {
        const game = CATALOG[id];
        root.innerHTML = `<div class="game-bar glass">
            <button type="button" class="round-btn" data-back aria-label="Все игры" title="Все игры">${ICON_HREF('back')}</button>
            <b class="game-title">${game.title}</b>
            <span class="game-hud" aria-live="off"></span>
            <button type="button" class="round-btn" data-pause aria-label="Пауза" title="Пауза" hidden>${ICON_HREF('pause')}</button>
            <button type="button" class="round-btn" data-restart aria-label="Начать заново" title="Начать заново">${ICON_HREF('repeat')}</button>
        </div>`;
        const pause = root.querySelector('[data-pause]');
        // Партия сохраняется при выходе в меню: заново создаётся только игра, которой ещё не было
        const shell = made[id]?.shell || shellFor(game.title);
        bar = { shell, pause, hud: root.querySelector('.game-hud') };
        if (!made[id]) made[id] = { shell, ...game.create(shell) };
        current = made[id];
        pause.hidden = !current.arcade;
        root.append(current.el);
        shell.paint();
        current.redraw?.();
        window.scrollTo({ top: 0 });
    };

    root.addEventListener('click', (e) => {
        const target = e.target.closest('button');
        if (!target) return;
        if (target.dataset.game) openGame(target.dataset.game);
        else if ('back' in target.dataset) {
            current?.pause?.();
            paintMenu();
        } else if ('restart' in target.dataset) current?.restart();
        else if ('pause' in target.dataset) current?.togglePause();
    });

    for (const type of ['keydown', 'keyup']) {
        document.addEventListener(type, (e) => {
            if (!current?.key || !root.isConnected || dialogOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
            current.key(e, type === 'keydown');
        });
    }

    new MutationObserver(() => {
        palette = null;
        current?.redraw?.();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent'] });

    paintMenu();

    return {
        // Перерисовка трекера не должна сбрасывать партию, поэтому узел один и тот же
        render(view) {
            if (root.parentNode !== view) view.replaceChildren(root);
            if (!current) paintMenu();
        },
        leave() {
            current?.pause?.();
        }
    };
})();
