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
    const data = {
        best: {},
        wins: {},
        level: {},
        chips: 1000,
        race: { cash: 0, xp: 0, stage: 1, pick: 1, parts: {} },
        f1: { round: 0, points: {}, tyre: 1, titles: 0 },
        ...read()
    };
    const save = () => {
        try { localStorage.setItem(STORE, JSON.stringify(data)); } catch (e) { /* Без хранилища игра работает до закрытия страницы */ }
    };
    const record = (key, value) => {
        if (value <= (data.best[key] || 0)) return false;
        data.best[key] = value;
        save();
        return true;
    };
    // Для времени: чем меньше, тем лучше
    const fastest = (key, value) => {
        if (data.best[key] !== undefined && value >= data.best[key]) return false;
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
            finish: (title, text, button = 'Ещё раз') => {
                mode = 'over';
                cancelAnimationFrame(frame);
                draw();
                show(title, text, button, begin);
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
            game.release?.();
            shell.setPaused(true);
            show('Пауза', 'Игра ждёт тебя', 'Продолжить', run);
        };
        const show = (title, text, button, action) => {
            const options = game.options?.(mode);
            overlay.innerHTML = `<div class="game-dialog glass">
                <h2>${title}</h2>
                <p>${text}</p>
                ${options ? `<div class="game-options" data-options>${options}</div>` : ''}
                <button type="button" class="btn btn-primary" data-go>${button}</button>
            </div>`;
            overlay.hidden = false;
            overlay.querySelector('[data-go]').onclick = action;
            overlay.onclick = (e) => game.pick?.(e.target, overlay, () => {
                overlay.querySelector('[data-options]').innerHTML = game.options(mode);
            });
            overlay.querySelector('[data-go]').focus({ preventScroll: true });
        };

        const point = (e) => {
            const rect = canvas.getBoundingClientRect();
            return [(e.clientX - rect.left) / rect.width * game.width, (e.clientY - rect.top) / rect.height * game.height];
        };
        for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
            canvas.addEventListener(type, (e) => {
                if (type === 'pointerdown') canvas.setPointerCapture(e.pointerId);
                if (mode === 'run') game.pointer?.(type, ...point(e), e.pointerId);
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
                const key = { arrowleft: 'left', a: 'left', ф: 'left', arrowright: 'right', d: 'right', в: 'right', arrowup: 'up', w: 'up', ц: 'up', arrowdown: 'down', s: 'down', ы: 'down', ' ': 'space', p: 'pause', з: 'pause' }[e.key?.toLowerCase()];
                if (!key) return;
                const vertical = key === 'up' || key === 'down';
                if (vertical && !game.vertical) return; // В остальных играх стрелки листают страницу
                if (vertical || key === 'left' || key === 'right') held[key] = down; // Отпускание важно и под окном паузы
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

    // --- Графика гонок ---
    // Детальные картинки рисуются один раз в запасной холст, а в кадре только копируются
    const SPRITE_SCALE = 2;
    const sprites = new Map();
    const sprite = (key, w, h, paint) => {
        if (!sprites.has(key)) {
            const canvas = document.createElement('canvas');
            canvas.width = w * SPRITE_SCALE;
            canvas.height = h * SPRITE_SCALE;
            const c = canvas.getContext('2d');
            c.scale(SPRITE_SCALE, SPRITE_SCALE);
            paint(c, w, h);
            canvas.logical = { w, h };
            sprites.set(key, canvas);
        }
        return sprites.get(key);
    };
    const stamp = (c, image, x, y) => c.drawImage(image, x - image.logical.w / 2, y - image.logical.h / 2, image.logical.w, image.logical.h);
    const probe = document.createElement('canvas').getContext('2d');
    // Положительное значение осветляет цвет, отрицательное затемняет
    const shade = (color, amount) => {
        probe.fillStyle = color;
        const hex = probe.fillStyle;
        if (hex[0] !== '#') return color;
        const to = amount > 0 ? 255 : 0;
        const part = (from) => Math.round(parseInt(hex.slice(from, from + 2), 16) * (1 - Math.abs(amount)) + to * Math.abs(amount));
        return `rgb(${part(1)}, ${part(3)}, ${part(5)})`;
    };
    // Одинаковый результат при каждой сборке: сцена не меняется от кадра к кадру
    const noise = (seed) => {
        const value = Math.sin(seed * 127.1 + 11.7) * 43758.5453;
        return value - Math.floor(value);
    };
    const blob = (c, x, y, r, color) => {
        const fill = c.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
        fill.addColorStop(0, shade(color, 0.28));
        fill.addColorStop(0.65, color);
        fill.addColorStop(1, shade(color, -0.3));
        c.fillStyle = fill;
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.fill();
    };
    const particles = (limit = 140) => {
        let list = [];
        return {
            add(x, y, vx, vy, life, size, color, grow = 0) {
                if (list.length < limit) list.push({ x, y, vx, vy, life, max: life, size, color, grow });
            },
            step(dt, driftX = 0, driftY = 0) {
                for (const item of list) {
                    item.x += (item.vx + driftX) * dt;
                    item.y += (item.vy + driftY) * dt;
                    item.size += item.grow * dt;
                    item.life -= dt;
                }
                list = list.filter((item) => item.life > 0);
            },
            draw(c) {
                for (const item of list) {
                    c.globalAlpha = item.life / item.max;
                    c.fillStyle = item.color;
                    c.beginPath();
                    c.arc(item.x, item.y, item.size, 0, Math.PI * 2);
                    c.fill();
                }
                c.globalAlpha = 1;
            },
            clear() {
                list = [];
            }
        };
    };

    // Машины сверху: нос смотрит вверх, у спрайта запас по краям под тень
    const TOP_CARS = {
        sport: { w: 36, h: 66 },
        sedan: { w: 36, h: 64 },
        taxi: { w: 36, h: 64 },
        van: { w: 38, h: 76 },
        truck: { w: 40, h: 104 }
    };
    const paintBody = (c, w, h, r, color) => {
        const fill = c.createLinearGradient(0, 0, w, 0);
        fill.addColorStop(0, shade(color, -0.42));
        fill.addColorStop(0.2, color);
        fill.addColorStop(0.5, shade(color, 0.2));
        fill.addColorStop(0.8, color);
        fill.addColorStop(1, shade(color, -0.42));
        c.fillStyle = fill;
        roundRect(c, 0, 0, w, h, r);
        c.fill();
        c.strokeStyle = 'rgba(0, 0, 0, 0.3)';
        c.lineWidth = 1;
        c.stroke();
    };
    const paintGlass = (c, x, y, w, h, r) => {
        const fill = c.createLinearGradient(x, y, x + w, y + h);
        fill.addColorStop(0, '#9fc4e8');
        fill.addColorStop(0.45, '#2b3a50');
        fill.addColorStop(1, '#111824');
        c.fillStyle = fill;
        roundRect(c, x, y, w, h, r);
        c.fill();
    };
    const paintLights = (c, w, h) => {
        c.fillStyle = '#fff6c9';
        roundRect(c, 4, 1.5, 8, 3.5, 1.5);
        c.fill();
        roundRect(c, w - 12, 1.5, 8, 3.5, 1.5);
        c.fill();
        c.fillStyle = '#ff2436';
        roundRect(c, 4, h - 4.5, 9, 3, 1.5);
        c.fill();
        roundRect(c, w - 13, h - 4.5, 9, 3, 1.5);
        c.fill();
    };
    const topCar = (kind, color) => {
        const { w, h } = TOP_CARS[kind];
        return sprite(`car-${kind}-${color}`, w + 20, h + 20, (c) => {
            c.translate(10, 10);
            c.fillStyle = 'rgba(0, 0, 0, 0.32)';
            roundRect(c, 3, 5, w, h, 10);
            c.fill();
            c.fillStyle = '#0f0f13';
            const wheels = kind === 'truck' ? [10, 58, 84] : [11, h - 22];
            for (const y of wheels) {
                c.fillRect(-2, y, 5, 13);
                c.fillRect(w - 3, y, 5, 13);
            }
            if (kind === 'truck') {
                paintBody(c, w, 28, 7, color);
                paintGlass(c, 4, 9, w - 8, 9, 3);
                c.fillStyle = '#d9dde3';
                roundRect(c, 1, 31, w - 2, h - 31, 3);
                c.fill();
                c.fillStyle = 'rgba(0, 0, 0, 0.13)';
                for (let y = 37; y < h - 3; y += 7) c.fillRect(3, y, w - 6, 2);
                c.fillStyle = color;
                c.fillRect(1, h - 12, w - 2, 5);
                paintLights(c, w, h);
                return;
            }
            paintBody(c, w, h, kind === 'van' ? 7 : 10, color);
            if (kind === 'van') {
                paintGlass(c, 4, 9, w - 8, 12, 3);
                c.fillStyle = 'rgba(255, 255, 255, 0.14)';
                roundRect(c, 5, 25, w - 10, h - 33, 4);
                c.fill();
                c.fillStyle = 'rgba(0, 0, 0, 0.14)';
                for (let y = 31; y < h - 12; y += 8) c.fillRect(7, y, w - 14, 1.5);
            } else {
                c.strokeStyle = 'rgba(0, 0, 0, 0.22)';
                c.lineWidth = 1;
                c.beginPath();
                c.moveTo(8, 5);
                c.lineTo(10, 15);
                c.moveTo(w - 8, 5);
                c.lineTo(w - 10, 15);
                c.stroke();
                paintGlass(c, 5, 16, w - 10, 11, 4);
                c.fillStyle = shade(color, 0.1);
                roundRect(c, 6, 28, w - 12, 17, 3);
                c.fill();
                paintGlass(c, 6, 46, w - 12, 8, 3);
                c.fillStyle = 'rgba(20, 28, 40, 0.75)';
                c.fillRect(3.5, 29, 2, 15);
                c.fillRect(w - 5.5, 29, 2, 15);
                c.fillStyle = shade(color, -0.25);
                c.fillRect(-1.5, 22, 3, 3);
                c.fillRect(w - 1.5, 22, 3, 3);
            }
            if (kind === 'taxi') {
                c.fillStyle = '#17131f';
                for (let i = 0; i < 5; i++) c.fillRect(4 + i * 6, 34 + (i % 2) * 3, 3, 3);
                c.fillStyle = '#fff6c9';
                roundRect(c, 12, 33, w - 24, 7, 2);
                c.fill();
            }
            if (kind === 'sport') {
                c.fillStyle = 'rgba(255, 255, 255, 0.86)';
                c.fillRect(w / 2 - 6, 0.5, 4, 15);
                c.fillRect(w / 2 + 2, 0.5, 4, 15);
                c.fillRect(w / 2 - 6, 28, 4, 17);
                c.fillRect(w / 2 + 2, 28, 4, 17);
                c.fillRect(w / 2 - 6, 54, 4, h - 55);
                c.fillRect(w / 2 + 2, 54, 4, h - 55);
                c.fillStyle = '#17131f';
                roundRect(c, 2, h - 9, w - 4, 4, 2);
                c.fill();
            }
            paintLights(c, w, h);
        });
    };

    // Предметы у дороги сверху
    const topProp = (kind) => sprite(`prop-${kind}`, 44, 44, (c) => {
        c.translate(22, 22);
        c.fillStyle = 'rgba(0, 0, 0, 0.24)';
        c.beginPath();
        c.arc(3, 4, kind === 'bush' || kind === 'rock' ? 11 : 16, 0, Math.PI * 2);
        c.fill();
        if (kind === 'tree') {
            blob(c, -6, 4, 11, '#2e7a3e');
            blob(c, 6, 3, 11, '#357f45');
            blob(c, 0, -6, 13, '#3d9150');
        } else if (kind === 'bush') {
            blob(c, -4, 1, 7, '#4a9a55');
            blob(c, 4, -1, 8, '#3f8e4b');
        } else if (kind === 'pine') {
            for (const [r, tone] of [[18, '#1f5a3e'], [13, '#2c7251'], [8, '#d7e6ec'], [4, '#ffffff']]) blob(c, 0, 0, r, tone);
        } else if (kind === 'rock') {
            blob(c, -3, 2, 8, '#8f8678');
            blob(c, 5, -2, 7, '#a59b8b');
        } else if (kind === 'cactus') {
            c.strokeStyle = '#35794a';
            c.lineCap = 'round';
            c.lineWidth = 7;
            c.beginPath();
            c.moveTo(-12, 0);
            c.lineTo(12, 0);
            c.moveTo(0, -12);
            c.lineTo(0, 12);
            c.stroke();
            blob(c, 0, 0, 5, '#4a9a60');
        } else if (kind === 'lamp') {
            c.fillStyle = 'rgba(255, 214, 120, 0.22)';
            c.beginPath();
            c.arc(0, 0, 21, 0, Math.PI * 2);
            c.fill();
            blob(c, 0, 0, 5, '#fff0b8');
        } else {
            c.fillStyle = '#2c3044';
            c.fillRect(-18, -18, 36, 36);
            c.fillStyle = '#3e4460';
            c.fillRect(-14, -14, 28, 28);
            c.fillStyle = '#ffd23f';
            for (let i = 0; i < 9; i++) if (noise(i + 3) > 0.45) c.fillRect(-11 + (i % 3) * 8, -11 + Math.floor(i / 3) * 8, 5, 5);
        }
    });

    // Болид сзади
    const F1_SPRITE = { w: 200, h: 112 };
    const f1Sprite = (color) => sprite(`f1-${color}`, F1_SPRITE.w, F1_SPRITE.h, (c, w, h) => {
        const mid = w / 2;
        c.fillStyle = 'rgba(0, 0, 0, 0.42)';
        c.beginPath();
        c.ellipse(mid, h - 6, w * 0.49, 7, 0, 0, Math.PI * 2);
        c.fill();
        // Передние колёса и антикрыло видны из-за кузова
        c.fillStyle = '#15151b';
        c.fillRect(30, h - 28, 140, 7);
        c.fillStyle = color;
        c.fillRect(22, h - 30, 22, 5);
        c.fillRect(w - 44, h - 30, 22, 5);
        c.fillStyle = '#111116';
        roundRect(c, 42, h - 54, 20, 28, 5);
        c.fill();
        roundRect(c, w - 62, h - 54, 20, 28, 5);
        c.fill();
        // Днище и диффузор
        c.fillStyle = '#17171d';
        c.fillRect(40, h - 34, 120, 22);
        c.fillStyle = '#2d2e38';
        for (let x = 52; x < 150; x += 12) c.fillRect(x, h - 30, 3, 16);
        // Понтоны
        const pod = c.createLinearGradient(0, h - 66, 0, h - 26);
        pod.addColorStop(0, shade(color, 0.22));
        pod.addColorStop(1, shade(color, -0.45));
        c.fillStyle = pod;
        c.beginPath();
        c.moveTo(36, h - 30);
        c.quadraticCurveTo(44, h - 66, 74, h - 70);
        c.lineTo(126, h - 70);
        c.quadraticCurveTo(156, h - 66, 164, h - 30);
        c.closePath();
        c.fill();
        // Задние колёса
        for (const x of [4, w - 50]) {
            const tyre = c.createLinearGradient(x, 0, x + 46, 0);
            tyre.addColorStop(0, '#08080b');
            tyre.addColorStop(0.5, '#2a2a31');
            tyre.addColorStop(1, '#08080b');
            c.fillStyle = tyre;
            roundRect(c, x, h - 60, 46, 54, 9);
            c.fill();
            c.fillStyle = 'rgba(255, 255, 255, 0.12)';
            for (let y = h - 54; y < h - 10; y += 8) c.fillRect(x + 3, y, 40, 1.5);
            c.fillStyle = '#ffd23f';
            c.fillRect(x + (x < mid ? 40 : 3), h - 50, 3, 34);
        }
        // Капот и воздухозаборник
        const cover = c.createLinearGradient(66, 0, 134, 0);
        cover.addColorStop(0, shade(color, -0.4));
        cover.addColorStop(0.5, shade(color, 0.26));
        cover.addColorStop(1, shade(color, -0.4));
        c.fillStyle = cover;
        c.beginPath();
        c.moveTo(66, h - 26);
        c.lineTo(86, h - 92);
        c.lineTo(114, h - 92);
        c.lineTo(134, h - 26);
        c.closePath();
        c.fill();
        c.fillStyle = '#101015';
        roundRect(c, 91, h - 94, 18, 10, 3);
        c.fill();
        // Дуга безопасности и шлем
        c.strokeStyle = '#17171d';
        c.lineWidth = 3;
        c.beginPath();
        c.arc(mid, h - 90, 15, Math.PI, 0);
        c.stroke();
        blob(c, mid, h - 96, 7, '#f4f4f6');
        // Заднее антикрыло
        c.fillStyle = '#1a1a21';
        c.fillRect(52, h - 110, 7, 42);
        c.fillRect(w - 59, h - 110, 7, 42);
        c.fillRect(mid - 2, h - 96, 4, 20);
        c.fillStyle = shade(color, -0.2);
        c.fillRect(59, h - 108, 82, 7);
        c.fillStyle = color;
        c.fillRect(59, h - 100, 82, 11);
        c.fillStyle = 'rgba(255, 255, 255, 0.9)';
        c.fillRect(82, h - 97, 36, 5);
        // Выхлоп и стоп-сигнал
        c.fillStyle = '#44444f';
        c.beginPath();
        c.arc(mid, h - 42, 7, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#0d0d11';
        c.beginPath();
        c.arc(mid, h - 42, 4, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#ff2436';
        c.fillRect(mid - 6, h - 28, 12, 7);
    });

    // Окружение трасс Гран-при: высота задана в полуширинах дороги
    const crowd = (c, x, y, w, h) => {
        for (let row = 0; row < h / 7; row++) {
            for (let col = 0; col < w / 6; col++) {
                c.fillStyle = ['#e63946', '#f4f4f6', '#2f6bff', '#ffd23f', '#ff8c1a'][Math.floor(noise(row * 31 + col) * 5)];
                c.fillRect(x + col * 6 + noise(col + row) * 2, y + row * 7, 3.5, 4);
            }
        }
    };
    const GP_PROPS = {
        tree: { w: 120, h: 170, size: 1.25, near: 2, spread: 2, gap: 5, paint(c, w, h) {
            c.fillStyle = '#5a3f2b';
            c.fillRect(w / 2 - 6, h - 62, 12, 62);
            blob(c, 36, 88, 34, '#2e7a3e');
            blob(c, 84, 84, 34, '#357f45');
            blob(c, 60, 48, 42, '#3d9150');
        } },
        pine: { w: 90, h: 190, size: 1.5, near: 2, spread: 2.4, gap: 4, paint(c, w, h) {
            c.fillStyle = '#4c3626';
            c.fillRect(w / 2 - 5, h - 36, 10, 36);
            for (const [y, half, tone] of [[h - 28, 44, '#1d5238'], [h - 74, 36, '#246146'], [h - 118, 26, '#2c7251']]) {
                c.fillStyle = tone;
                c.beginPath();
                c.moveTo(w / 2 - half, y);
                c.lineTo(w / 2, y - 76);
                c.lineTo(w / 2 + half, y);
                c.closePath();
                c.fill();
            }
        } },
        palm: { w: 140, h: 190, size: 1.45, near: 1.9, spread: 1.6, gap: 7, paint(c, w, h) {
            c.strokeStyle = '#7b5b3d';
            c.lineWidth = 9;
            c.beginPath();
            c.moveTo(w / 2 - 6, h);
            c.quadraticCurveTo(w / 2 + 12, 100, w / 2, 48);
            c.stroke();
            c.strokeStyle = '#2f8a4c';
            c.lineWidth = 7;
            c.lineCap = 'round';
            for (const [x, y] of [[-62, 58], [-52, 16], [-16, 2], [24, 2], [56, 18], [64, 60]]) {
                c.beginPath();
                c.moveTo(w / 2, 48);
                c.quadraticCurveTo(w / 2 + x * 0.6, 12, w / 2 + x, y + 16);
                c.stroke();
            }
        } },
        stand: { w: 320, h: 150, size: 1.25, near: 2.15, spread: 0.2, gap: 12, paint(c, w, h) {
            c.fillStyle = '#7d8493';
            c.fillRect(8, 26, 10, h - 26);
            c.fillRect(w - 18, 26, 10, h - 26);
            c.fillStyle = '#c9ced8';
            c.beginPath();
            c.moveTo(0, 22);
            c.lineTo(w, 22);
            c.lineTo(w - 22, 4);
            c.lineTo(22, 4);
            c.closePath();
            c.fill();
            c.fillStyle = '#2b2f3c';
            c.fillRect(18, 26, w - 36, h - 44);
            crowd(c, 22, 32, w - 44, h - 58);
            c.fillStyle = '#e63946';
            c.fillRect(0, h - 18, w, 18);
            c.fillStyle = '#fff';
            for (let x = 8; x < w; x += 40) c.fillRect(x, h - 12, 22, 5);
        } },
        board: { w: 220, h: 110, size: 0.62, near: 1.9, spread: 0.3, gap: 16, paint(c, w, h) {
            c.fillStyle = '#50545f';
            c.fillRect(26, 68, 8, 42);
            c.fillRect(w - 34, 68, 8, 42);
            const panel = c.createLinearGradient(0, 0, w, 0);
            panel.addColorStop(0, '#2f6bff');
            panel.addColorStop(1, '#8e5cf6');
            c.fillStyle = panel;
            c.fillRect(0, 0, w, 72);
            c.fillStyle = '#fff';
            c.font = '900 34px system-ui, sans-serif';
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillText('ГРАН-ПРИ', w / 2, 37);
        } },
        tyres: { w: 200, h: 58, size: 0.28, near: 1.7, spread: 0.1, gap: 6, paint(c, w) {
            for (let row = 0; row < 3; row++) {
                for (let col = 0; col < 11; col++) {
                    c.fillStyle = (row + col) % 3 ? '#17171d' : '#e8343f';
                    c.beginPath();
                    c.arc(10 + col * (w - 20) / 10, 11 + row * 18, 10, 0, Math.PI * 2);
                    c.fill();
                }
            }
        } },
        block: { w: 150, h: 300, size: 3.1, near: 2.6, spread: 2.4, gap: 7, paint(c, w, h) {
            const wall = c.createLinearGradient(0, 0, w, 0);
            wall.addColorStop(0, '#3c4258');
            wall.addColorStop(1, '#232738');
            c.fillStyle = wall;
            c.fillRect(0, 0, w, h);
            for (let y = 10; y < h - 8; y += 15) {
                for (let x = 9; x < w - 12; x += 15) {
                    c.fillStyle = noise(x * 3 + y) > 0.46 ? '#ffd98a' : '#171a28';
                    c.fillRect(x, y, 9, 9);
                }
            }
        } },
        villa: { w: 170, h: 190, size: 1.9, near: 2.2, spread: 1.4, gap: 8, paint(c, w, h) {
            c.fillStyle = '#efdcc0';
            c.fillRect(6, 24, w - 12, h - 24);
            c.fillStyle = '#c86a4e';
            c.fillRect(0, 12, w, 14);
            c.fillStyle = '#5c8fb0';
            for (let y = 40; y < h - 26; y += 42) {
                for (let x = 22; x < w - 30; x += 44) c.fillRect(x, y, 26, 26);
            }
        } },
        yacht: { w: 240, h: 110, size: 0.9, near: 2.5, spread: 1.6, gap: 13, paint(c, w, h) {
            c.fillStyle = '#f5f6f8';
            c.beginPath();
            c.moveTo(0, h - 46);
            c.lineTo(w, h - 54);
            c.lineTo(w - 34, h - 8);
            c.lineTo(22, h - 8);
            c.closePath();
            c.fill();
            c.fillStyle = '#e4e7ec';
            c.fillRect(56, h - 76, 120, 26);
            c.fillStyle = '#26364b';
            c.fillRect(66, h - 70, 100, 11);
            c.fillStyle = '#7a8699';
            c.fillRect(116, 0, 4, h - 76);
        } },
        tower: { w: 110, h: 240, size: 2.4, near: 1.95, spread: 0.4, gap: 15, paint(c, w, h) {
            c.fillStyle = '#5e6371';
            c.fillRect(w / 2 - 5, 34, 10, h - 34);
            c.fillStyle = '#2b2f3c';
            c.fillRect(0, 0, w, 38);
            for (let x = 7; x < w - 12; x += 19) {
                for (let y = 5; y < 26; y += 15) {
                    c.fillStyle = '#fff4c9';
                    c.fillRect(x, y, 14, 11);
                }
            }
        } },
        wheel: { w: 220, h: 240, size: 2.8, near: 3.2, spread: 0.8, gap: 90, paint(c, w, h) {
            const mid = w / 2;
            c.strokeStyle = '#d7dbe8';
            c.lineWidth = 5;
            c.beginPath();
            c.arc(mid, 108, 96, 0, Math.PI * 2);
            c.stroke();
            c.lineWidth = 2;
            for (let i = 0; i < 12; i++) {
                const a = i / 12 * Math.PI * 2;
                c.beginPath();
                c.moveTo(mid, 108);
                c.lineTo(mid + Math.cos(a) * 96, 108 + Math.sin(a) * 96);
                c.stroke();
                c.fillStyle = ['#ff5fa2', '#ffd23f', '#2ec4b6'][i % 3];
                c.fillRect(mid + Math.cos(a) * 96 - 7, 108 + Math.sin(a) * 96 - 6, 14, 12);
            }
            c.lineWidth = 7;
            c.beginPath();
            c.moveTo(mid - 54, h);
            c.lineTo(mid, 108);
            c.lineTo(mid + 54, h);
            c.stroke();
        } },
        dune: { w: 280, h: 70, size: 0.5, near: 2.4, spread: 2.6, gap: 11, paint(c, w, h) {
            const fill = c.createLinearGradient(0, 0, w, 0);
            fill.addColorStop(0, '#e2bf85');
            fill.addColorStop(1, '#a98752');
            c.fillStyle = fill;
            c.beginPath();
            c.moveTo(0, h);
            c.quadraticCurveTo(w * 0.42, -h * 0.7, w, h);
            c.fill();
        } },
        arch: { w: 480, h: 170, size: 1.5, near: 0, spread: 0, gap: 0, paint(c, w, h) {
            c.fillStyle = '#2a2d38';
            c.fillRect(0, 0, 18, h);
            c.fillRect(w - 18, 0, 18, h);
            c.fillRect(0, 0, w, 56);
            c.fillStyle = '#fff';
            c.font = '900 34px system-ui, sans-serif';
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillText('ГРАН-ПРИ', w / 2, 29);
            for (let i = 0; i < 30; i++) {
                c.fillStyle = i % 2 ? '#fff' : '#111';
                c.fillRect(18 + i * 15, 48, 15, 8);
            }
        } }
    };
    const gpProp = (key) => sprite(`gp-${key}`, GP_PROPS[key].w, GP_PROPS[key].h, (c, w, h) => GP_PROPS[key].paint(c, w, h));

    // --- Гонки ---
    const PARTS = [
        { id: 'steer', title: 'Руль', text: 'Машина быстрее смещается', price: 120 },
        { id: 'armor', title: 'Броня', text: 'Выдерживает лишний удар', price: 220 },
        { id: 'magnet', title: 'Магнит', text: 'Притягивает монеты', price: 110 },
        { id: 'nitro', title: 'Нитро', text: 'Рывок сквозь машины', price: 180 },
        { id: 'sponsor', title: 'Спонсор', text: 'Больше денег за заезд', price: 150 }
    ];
    const PART_MAX = 4;
    const partLevel = (id) => data.race.parts[id] || 0;
    const partPrice = (part) => Math.round(part.price * (partLevel(part.id) + 1) ** 1.5 / 10) * 10;
    // Каждый следующий уровень гонщика требует больше опыта
    const driverLevel = (xp = data.race.xp) => {
        let level = 1;
        let need = 500;
        while (xp >= need) {
            xp -= need;
            level++;
            need = 500 * level;
        }
        return { level, xp, need };
    };

    const racing = arcade(({ hud, held, finish }) => {
        const W = 360;
        const H = 480;
        const ROAD = 44;
        const LANE = 68;
        const LANES = 4;
        const CAR = { w: 36, h: 66, y: H - 96 };
        const TILE = 240;
        const ZONES = [
            { key: 'highway', ground: '#4a9a55', spot: ['#55a860', '#3f8c4b'], road: '#3a3b44', edge: '#f2f2f4', line: '#f2f2f4', props: ['tree', 'tree', 'bush'] },
            { key: 'desert', ground: '#d9b477', spot: ['#e4c288', '#c8a266'], road: '#4b4642', edge: '#efe4cb', line: '#ffd23f', props: ['cactus', 'rock', 'cactus'] },
            { key: 'city', ground: '#20222e', spot: ['#2a2d3c', '#1a1c27'], road: '#2b2c36', edge: '#ffd23f', line: '#d7dbe8', props: ['block', 'lamp', 'block'], night: true },
            { key: 'winter', ground: '#e6eef5', spot: ['#f6fafd', '#d3dfea'], road: '#565e6a', edge: '#ffffff', line: '#e4e9ef', props: ['pine', 'pine', 'rock'] }
        ];
        const TRAFFIC_COLORS = ['#e63946', '#2f6bff', '#f4f4f6', '#2ec4b6', '#7a8699', '#ff8c1a', '#8e5cf6'];
        const dust = particles();
        const COIN_CASH = 5;
        const COIN_SCORE = 25;
        const NITRO_TIME = 2.2;
        const SHIELD_TIME = 1.2;
        const NITRO_BTN = { x: W - 24, y: H - 34, r: 22 };
        const lanePos = (lane) => ROAD + LANE * (lane + 0.5);
        const limit = (x) => clamp(x, ROAD + CAR.w / 2 + 2, W - ROAD - CAR.w / 2 - 2);
        const stageLength = (stage) => 500 + stage * 140;
        const stageReward = (stage) => 60 + stage * 30;
        const sponsored = (cash) => Math.round(cash * (1 + partLevel('sponsor') * 0.25));
        let x, target, cars, coins, props, meters, money, speed, road, gap, stage, length, armor, nitro, boost, shield, tilt, shake, propGap, zone, tab = 'race';

        const total = () => Math.floor(meters) + money * COIN_SCORE;
        const paintHud = () => hud(stage ? `Этап ${stage} · ${Math.min(length, Math.floor(meters))} из ${length} м` : `Счёт ${total()} · Рекорд ${data.best.racing || 0}`);
        const spawn = () => {
            // Хотя бы одна полоса всегда свободна
            const lanes = shuffle([0, 1, 2, 3]);
            const count = speed > 460 && Math.random() < 0.4 ? 3 : Math.random() < 0.5 ? 2 : 1;
            lanes.slice(0, count).forEach((lane) => {
                const roll = Math.random();
                const kind = roll < 0.45 ? 'sedan' : roll < 0.62 ? 'taxi' : roll < 0.84 ? 'van' : 'truck';
                const { w, h } = TOP_CARS[kind];
                cars.push({ x: lanePos(lane), y: -h - 16, w, h, kind, color: kind === 'taxi' ? '#ffc42e' : pick(TRAFFIC_COLORS) });
            });
            if (Math.random() < 0.6) coins.push({ x: lanePos(lanes[LANES - 1]), y: -40 });
            gap = (170 + Math.random() * 130) * Math.max(0.65, 1 - stage * 0.025);
        };
        const hits = (item, w, h) => Math.abs(item.x - x) < (w + CAR.w) / 2 - 5 && Math.abs(item.y + h / 2 - (CAR.y + CAR.h / 2)) < (h + CAR.h) / 2 - 5;
        const burst = (px, py, count, color) => {
            for (let i = 0; i < count; i++) dust.add(px, py, (Math.random() - 0.5) * 300, (Math.random() - 0.5) * 300, 0.45, 1.5 + Math.random() * 2.5, color);
        };
        const tile = () => sprite(`race-${zone.key}`, W, TILE, (c) => {
            c.fillStyle = zone.ground;
            c.fillRect(0, 0, W, TILE);
            for (let i = 0; i < 200; i++) {
                c.fillStyle = zone.spot[i % 2];
                const px = noise(i + 0.2) * W;
                c.fillRect(px, noise(i + 0.6) * TILE, 2 + noise(i) * 4, 2 + noise(i + 0.9) * 4);
            }
            const fill = c.createLinearGradient(ROAD, 0, W - ROAD, 0);
            fill.addColorStop(0, shade(zone.road, -0.18));
            fill.addColorStop(0.5, shade(zone.road, 0.07));
            fill.addColorStop(1, shade(zone.road, -0.18));
            c.fillStyle = fill;
            c.fillRect(ROAD, 0, W - ROAD * 2, TILE);
            for (let i = 0; i < 700; i++) {
                c.fillStyle = i % 2 ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.09)';
                c.fillRect(ROAD + noise(i + 0.4) * (W - ROAD * 2), noise(i + 0.8) * TILE, 1.5, 1.5);
            }
            // Следы шин на полосах
            c.fillStyle = 'rgba(0, 0, 0, 0.1)';
            for (let lane = 0; lane < LANES; lane++) {
                c.fillRect(lanePos(lane) - 15, 0, 7, TILE);
                c.fillRect(lanePos(lane) + 8, 0, 7, TILE);
            }
            c.fillStyle = zone.line;
            for (let lane = 1; lane < LANES; lane++) {
                for (let y = 0; y < TILE; y += 60) c.fillRect(ROAD + LANE * lane - 1.5, y, 3, 30);
            }
            c.fillStyle = zone.edge;
            c.fillRect(ROAD + 3, 0, 3, TILE);
            c.fillRect(W - ROAD - 6, 0, 3, TILE);
            for (let y = 0; y < TILE; y += 40) {
                c.fillStyle = '#e8343f';
                c.fillRect(ROAD - 7, y, 7, 20);
                c.fillRect(W - ROAD, y, 7, 20);
                c.fillStyle = '#f4f4f6';
                c.fillRect(ROAD - 7, y + 20, 7, 20);
                c.fillRect(W - ROAD, y + 20, 7, 20);
            }
        });
        const paintGlow = (c, px, py, radius, color) => {
            const fill = c.createRadialGradient(px, py, 0, px, py, radius);
            fill.addColorStop(0, color);
            fill.addColorStop(1, 'rgba(0, 0, 0, 0)');
            c.fillStyle = fill;
            c.fillRect(px - radius, py - radius, radius * 2, radius * 2);
        };
        const useNitro = () => {
            if (!nitro || boost > 0) return;
            nitro--;
            boost = NITRO_TIME;
            shake = 0.2;
        };
        // Деньги и опыт начисляются и за аварию, а награда только за финиш
        const payOut = (reward) => {
            const earned = sponsored(money * COIN_CASH + reward);
            const before = driverLevel().level;
            data.race.cash += earned;
            data.race.xp += Math.floor(meters);
            const after = driverLevel().level;
            let bonus = 0;
            for (let level = before + 1; level <= after; level++) bonus += level * 100;
            data.race.cash += bonus;
            save();
            return `Монеты +${earned}${bonus ? `, уровень гонщика ${after}, бонус +${bonus}` : ''}`;
        };
        const crash = () => {
            if (!stage) {
                const fresh = record('racing', total());
                paintHud();
                return finish('Авария', `Счёт ${total()}${fresh ? ', новый рекорд' : ''}. ${payOut(0)}`);
            }
            paintHud();
            finish('Авария', `До финиша ${length - Math.floor(meters)} м. ${payOut(0)}`);
        };
        const reachFinish = () => {
            const text = payOut(stageReward(stage));
            if (stage === data.race.stage) data.race.stage++;
            data.race.pick = stage + 1;
            save();
            finish(`Этап ${stage} пройден`, text, 'Следующий этап');
        };

        return {
            width: W,
            height: H,
            hintKeys: 'Мышь или стрелки, пробел включает нитро. Доезжай до финиша и трать монеты в гараже',
            hintTouch: 'Веди пальцем по дороге, нитро в углу. Доезжай до финиша и трать монеты в гараже',
            options(mode) {
                if (mode === 'pause') return '';
                const { race } = data;
                const info = driverLevel();
                const tabs = chipsRow('tab', ['Заезд', 'Гараж'], tab === 'race' ? 0 : 1);
                if (tab === 'race') {
                    return `${tabs}
                        <div class="stage-pick">
                            <button type="button" class="round-btn" data-step="-1" aria-label="Предыдущий этап" ${race.pick ? '' : 'disabled'}>‹</button>
                            <b>${race.pick ? `Этап ${race.pick}` : 'Без конца'}</b>
                            <button type="button" class="round-btn" data-step="1" aria-label="Следующий этап" ${race.pick < race.stage ? '' : 'disabled'}>›</button>
                        </div>
                        <p class="game-note">${race.pick ? `${stageLength(race.pick)} м · награда ${sponsored(stageReward(race.pick))}` : 'Заезд до первой аварии на рекорд'}</p>
                        <p class="game-note">Гонщик ${info.level} ур. · опыт ${info.xp} из ${info.need}</p>`;
                }
                return `${tabs}
                    <p class="game-note">Монеты: <b>${race.cash}</b></p>
                    <div class="shop">${PARTS.map((part) => {
                        const level = partLevel(part.id);
                        const full = level >= PART_MAX;
                        const price = partPrice(part);
                        return `<div class="shop-row">
                            <span><b>${part.title} ${level}/${PART_MAX}</b><small>${part.text}</small></span>
                            <button type="button" class="chip small" data-buy="${part.id}" ${full || price > race.cash ? 'disabled' : ''}>${full ? 'Макс.' : price}</button>
                        </div>`;
                    }).join('')}</div>`;
            },
            pick(target, overlay, refresh) {
                const chip = target.closest('[data-tab], [data-step], [data-buy]');
                if (!chip) return;
                const { race } = data;
                if (chip.dataset.tab) tab = chip.dataset.tab === '0' ? 'race' : 'garage';
                else if (chip.dataset.step) race.pick = clamp(race.pick + Number(chip.dataset.step), 0, race.stage);
                else {
                    const part = PARTS.find((item) => item.id === chip.dataset.buy);
                    race.cash -= partPrice(part);
                    race.parts[part.id] = partLevel(part.id) + 1;
                }
                save();
                refresh();
                this.reset(); // Новый этап и детали должны сразу попасть в заезд
            },
            reset() {
                stage = data.race.pick;
                length = stage ? stageLength(stage) : Infinity;
                zone = ZONES[stage ? (stage - 1) % ZONES.length : 0];
                x = target = lanePos(1);
                cars = [];
                coins = [];
                props = [];
                for (let y = -20; y < H; y += 64) props.push({ x: Math.random() < 0.5 ? 20 : W - 20, y, kind: pick(zone.props) });
                propGap = 40;
                tilt = 0;
                shake = 0;
                dust.clear();
                meters = 0;
                money = 0;
                speed = 240 + Math.min(120, stage * 10);
                road = 0;
                gap = 120;
                armor = partLevel('armor');
                nitro = partLevel('nitro');
                boost = 0;
                shield = 0;
                paintHud();
            },
            action() {
                useNitro();
                return true;
            },
            pointer(type, px, py) {
                if (type === 'pointerdown' && nitro && Math.hypot(px - NITRO_BTN.x, py - NITRO_BTN.y) < NITRO_BTN.r + 8) return useNitro();
                target = limit(px);
            },
            update(dt) {
                const steer = partLevel('steer');
                const was = x;
                if (held.left || held.right) {
                    x = limit(x + (held.right ? 1 : -1) * (340 + steer * 50) * dt);
                    target = x;
                } else x += clamp(target - x, -(560 + steer * 70) * dt, (560 + steer * 70) * dt);

                boost = Math.max(0, boost - dt);
                shield = Math.max(0, shield - dt);
                const move = speed * (boost ? 1.6 : 1) * dt;
                meters += move / 10;
                speed = Math.min(640, 240 + Math.min(120, stage * 10) + meters * 0.3);
                road = (road + move) % TILE;
                gap -= move;
                propGap -= move;
                tilt += (clamp((x - was) / dt / 900, -0.22, 0.22) - tilt) * Math.min(1, 12 * dt);
                shake = Math.max(0, shake - dt);
                if (gap <= 0 && meters * 10 < length * 10 - H) spawn();
                if (propGap <= 0) {
                    props.push({ x: Math.random() < 0.5 ? 20 + Math.random() * 6 : W - 20 - Math.random() * 6, y: -30, kind: pick(zone.props) });
                    propGap = 46 + Math.random() * 40;
                }
                for (const item of [...cars, ...coins, ...props]) item.y += move;
                props = props.filter((item) => item.y < H + 30);
                dust.step(dt, 0, move / dt);
                if (boost) {
                    for (const side of [-8, 8]) dust.add(x + side, CAR.y + CAR.h + 2, (Math.random() - 0.5) * 30, 40, 0.28, 5, Math.random() < 0.5 ? '#ffd23f' : '#ff7a1a', -12);
                }
                const reach = partLevel('magnet') * 34;
                coins = coins.filter((coin) => {
                    if (reach && Math.hypot(coin.x - x, coin.y - CAR.y) < reach * 2) coin.x += clamp(x - coin.x, -420 * dt, 420 * dt);
                    if (hits(coin, 22, 22)) {
                        money++;
                        burst(coin.x, coin.y + 11, 8, '#ffd23f');
                        return false;
                    }
                    return coin.y < H;
                });
                cars = cars.filter((car) => {
                    if (car.y >= H) return false;
                    if (!hits(car, car.w, car.h)) return true;
                    if (boost) {
                        money++; // Рывок разбрасывает машины
                        burst(car.x, car.y + car.h / 2, 18, '#ffd23f');
                        shake = 0.2;
                        return false;
                    }
                    if (shield) return true;
                    if (armor) {
                        armor--;
                        shield = SHIELD_TIME;
                        burst(car.x, car.y + car.h, 20, '#ff9b3d');
                        shake = 0.3;
                        return false;
                    }
                    car.crash = true;
                    burst((car.x + x) / 2, CAR.y, 30, '#ff9b3d');
                    return true;
                });
                paintHud();
                if (cars.some((car) => car.crash)) crash();
                else if (meters >= length) reachFinish();
            },
            draw(c, theme) {
                c.save();
                if (shake) c.translate((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
                const ground = tile();
                for (let y = Math.round(road) - TILE; y < H; y += TILE) c.drawImage(ground, 0, y, W, TILE + 1);
                for (const item of props) stamp(c, topProp(item.kind), item.x, item.y);
                if (stage) {
                    const line = CAR.y - (length - meters) * 10;
                    if (line > -40) {
                        const step = (W - ROAD * 2) / 16;
                        for (let i = 0; i < 16; i++) {
                            for (let row = 0; row < 3; row++) {
                                c.fillStyle = (i + row) % 2 ? '#fff' : '#111';
                                c.fillRect(ROAD + i * step, line + row * 11, step, 11);
                            }
                        }
                    }
                }
                for (const coin of coins) {
                    const turn = Math.abs(Math.cos((coin.y + coin.x) * 0.03));
                    c.fillStyle = 'rgba(0, 0, 0, 0.25)';
                    c.beginPath();
                    c.ellipse(coin.x + 2, coin.y + 14, 10, 9, 0, 0, Math.PI * 2);
                    c.fill();
                    c.fillStyle = '#d69a12';
                    c.beginPath();
                    c.ellipse(coin.x, coin.y + 11, 3 + turn * 9, 11, 0, 0, Math.PI * 2);
                    c.fill();
                    c.fillStyle = '#ffd23f';
                    c.beginPath();
                    c.ellipse(coin.x, coin.y + 11, 2 + turn * 6.5, 8, 0, 0, Math.PI * 2);
                    c.fill();
                }
                for (const car of cars) stamp(c, topCar(car.kind, car.color), car.x, car.y + car.h / 2);
                if (zone.night) {
                    for (const car of cars) {
                        paintGlow(c, car.x - car.w / 2 + 8, car.y + car.h, 14, 'rgba(255, 36, 54, 0.7)');
                        paintGlow(c, car.x + car.w / 2 - 8, car.y + car.h, 14, 'rgba(255, 36, 54, 0.7)');
                    }
                    const beam = c.createLinearGradient(0, CAR.y, 0, CAR.y - 170);
                    beam.addColorStop(0, 'rgba(255, 244, 200, 0.42)');
                    beam.addColorStop(1, 'rgba(255, 244, 200, 0)');
                    c.fillStyle = beam;
                    c.beginPath();
                    c.moveTo(x - 15, CAR.y + 2);
                    c.lineTo(x - 62, CAR.y - 170);
                    c.lineTo(x + 62, CAR.y - 170);
                    c.lineTo(x + 15, CAR.y + 2);
                    c.closePath();
                    c.fill();
                }
                dust.draw(c);
                if (boost) {
                    paintGlow(c, x - 8, CAR.y + CAR.h + 8, 22, 'rgba(255, 150, 40, 0.8)');
                    paintGlow(c, x + 8, CAR.y + CAR.h + 8, 22, 'rgba(255, 150, 40, 0.8)');
                    c.strokeStyle = 'rgba(255, 255, 255, 0.5)';
                    c.lineWidth = 1.5;
                    for (let i = 0; i < 7; i++) {
                        const px = ROAD + noise(i + Math.floor(road / 18)) * (W - ROAD * 2);
                        const py = (noise(i * 3 + 1) * H + road * 3) % H;
                        c.beginPath();
                        c.moveTo(px, py);
                        c.lineTo(px, py + 42);
                        c.stroke();
                    }
                }
                if (!shield || Math.floor(shield * 10) % 2) {
                    c.save();
                    c.translate(x, CAR.y + CAR.h / 2);
                    c.rotate(tilt);
                    stamp(c, topCar('sport', theme.accent), 0, 0);
                    c.restore();
                }
                c.restore();

                if (stage) {
                    c.fillStyle = 'rgba(12, 12, 20, 0.45)';
                    c.fillRect(0, 0, W, 5);
                    c.fillStyle = theme.accent;
                    c.fillRect(0, 0, W * Math.min(1, meters / length), 5);
                }
                c.fillStyle = theme.accent;
                for (let i = 0; i < armor; i++) {
                    roundRect(c, 8, H - 18 - i * 14, 14, 10, 3);
                    c.fill();
                }
                if (partLevel('nitro')) {
                    c.globalAlpha = nitro && !boost ? 0.95 : 0.4;
                    c.fillStyle = 'rgba(12, 12, 20, 0.72)';
                    c.beginPath();
                    c.arc(NITRO_BTN.x, NITRO_BTN.y, NITRO_BTN.r, 0, Math.PI * 2);
                    c.fill();
                    c.strokeStyle = '#ffd23f';
                    c.lineWidth = 2.5;
                    c.stroke();
                    c.globalAlpha = 1;
                    c.fillStyle = '#ffd23f';
                    c.font = '800 12px system-ui, sans-serif';
                    c.textAlign = 'center';
                    c.textBaseline = 'middle';
                    c.fillText(`N ${nitro}`, NITRO_BTN.x, NITRO_BTN.y + 1);
                }
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

    // --- Гран-при ---
    // Вид из-за болида: дорога собирается из коротких сегментов, у каждого своя кривизна и высота
    const GP_ROUNDS = [
        { name: 'Монца', sky: ['#4f9fe0', '#dff2ff'], hills: '#7fa6a8', grass: ['#3f9a58', '#378c4e'], props: ['tree', 'tree', 'stand', 'board', 'tyres'], plan: [[150, 0], [12, 7], [12, -7], [170, 0], [50, 3], [90, 0], [14, 5.5], [14, -5.5], [120, 0], [60, 3.2], [140, 0]] },
        { name: 'Манама', sky: ['#17153b', '#e88a55'], hills: '#5b3a4c', grass: ['#c9a66b', '#bd9a60'], sun: '#ffd9a0', props: ['palm', 'dune', 'tower', 'stand', 'tyres', 'dune'], plan: [[170, 0], [16, 8], [60, 0], [40, -3], [20, 6], [130, 0], [18, -7], [90, 0], [50, 3.4], [16, 7], [150, 0]] },
        { name: 'Монако', sky: ['#49aee0', '#eafaff'], hills: '#6f9a8e', grass: ['#7c8894', '#737f8b'], props: ['villa', 'yacht', 'palm', 'stand', 'villa'], plan: [[60, 0], [16, 6], [50, 0, 900], [14, -9], [24, 9], [50, 0, -900], [14, 7], [70, 0], [12, -6], [12, 6], [50, 0], [14, -9], [80, 0], [16, 6]] },
        { name: 'Спа', sky: ['#8ea6ba', '#e6edf2'], hills: '#54786a', grass: ['#2f7f4b', '#2a7344'], props: ['pine', 'pine', 'pine', 'stand', 'board'], plan: [[60, 0], [14, 9], [90, 0, -1800], [16, -3.5], [16, 3.5], [130, 0, 2600], [24, 5.5], [70, 0, -800], [30, -6], [60, 3], [90, 0], [14, -8], [90, 0]] },
        { name: 'Сузука', sky: ['#62b6dc', '#ffe6d2'], hills: '#7d9fa5', grass: ['#47a267', '#3f945c'], props: ['tree', 'wheel', 'stand', 'board', 'tree'], plan: [[120, 0], [24, 5], [10, -4.5], [10, 4.5], [10, -4.5], [60, 0, 1000], [18, 6.5], [80, 0], [14, -8], [130, 0, -1000], [40, -3.2], [100, 0], [12, 6]] },
        { name: 'Сингапур', sky: ['#080a22', '#3a2a66'], hills: '#232846', grass: ['#1d3446', '#1a2f40'], night: true, props: ['block', 'block', 'tower', 'stand', 'board'], plan: [[110, 0], [12, 7], [12, -6], [80, 0], [14, 8], [120, 0], [14, -7], [40, 0], [12, 7], [12, -7], [60, 0], [14, 9], [100, 0], [14, -6]] }
    ];
    const GP_TYRES = [
        { name: 'Мягкие', mark: 'С', color: '#ff3b4e', pace: 1, grip: 1.1, life: 2.3 },
        { name: 'Средние', mark: 'М', color: '#ffd23f', pace: 0.985, grip: 1, life: 3.3 },
        { name: 'Жёсткие', mark: 'Т', color: '#f2f2f7', pace: 0.97, grip: 0.94, life: 5 }
    ];
    const GP_RIVALS = [
        { name: 'Вектор', color: '#2ec4b6', skill: 0.985 },
        { name: 'Кобальт', color: '#2f6bff', skill: 0.975 },
        { name: 'Сирокко', color: '#e63946', skill: 0.97 },
        { name: 'Аврора', color: '#ff8c1a', skill: 0.96 },
        { name: 'Полярис', color: '#d7dbe8', skill: 0.95 },
        { name: 'Феникс', color: '#ff5fa2', skill: 0.94 },
        { name: 'Гранит', color: '#7a8699', skill: 0.93 },
        { name: 'Вихрь', color: '#8e5cf6', skill: 0.92 },
        { name: 'Титан', color: '#3fbf5f', skill: 0.905 }
    ];
    const GP_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
    const gpStandings = () => Object.entries(data.f1.points).map(([name, points]) => ({ name, points })).sort((a, b) => b.points - a.points);

    const grandprix = arcade(({ hud, held, finish }) => {
        const W = 360;
        const H = 480;
        const SEG = 200;
        const ROAD = 2000;
        const CAM_H = 1000;
        const DEPTH = 0.84;
        const NEAR = CAM_H * DEPTH;
        const VIEW = 110;
        const HORIZON = H * 0.4;
        const TOP = 9000;
        const KMH = 340;
        const BEND = 20;
        const LAPS = 4;
        const PIT_TIME = 3.2;
        const LIGHTS_TIME = 3.4;
        const SKILL = [0.82, 0.88, 0.93];
        const SLIDE = [0.8, 1, 1.1]; // На лёгком в поворотах держит лучше
        const SLOT = [5, 7, 9];
        const SEAM = 0.7; // Нахлёст сегментов, чтобы между ними не просвечивал фон
        const WALL = 1.75; // За стеной трасса заканчивается
        const smoke = particles(70);
        const BOX_BTN = { x: W - 34, y: H - 150, r: 27 };
        const ERS_BTN = { x: 34, y: H - 150, r: 27 };
        const CAR_LEN = 300;
        const wrap = (z, size) => ((z % size) + size) % size;
        const lerp = (from, to, t) => from + (to - from) * t;
        const smooth = (t) => t * t * (3 - 2 * t);
        let round, segs, length, cars, me, slide, lightsLeft, tyre, wear, ers, ersOn, pitAsked, pitLeft, pitChoice, steer, braking, sky, drawId = 0, table = null, sceneKey, shake, revs, map;
        const touches = new Map();

        // Самая быстрая скорость (доля от максимума), на которой руль ещё пересиливает снос
        const cornerLimit = (curve, grip) => {
            const a = 0.6 * Math.abs(curve) * slide / grip;
            return a ? Math.min(1, (1.4 + Math.sqrt(1.96 + 2.4 * a)) / (2 * a)) : 1;
        };
        const buildTrack = ({ plan }) => {
            const list = [];
            let y = 0;
            for (const [hold, curve, rise = 0] of plan) {
                const total = hold + BEND * 2;
                const from = y;
                for (let n = 0; n < total; n++) {
                    const edge = Math.min(1, n / BEND, (total - 1 - n) / BEND);
                    const next = from + rise * smooth((n + 1) / total);
                    list.push({ i: list.length, curve: curve * smooth(edge), y1: y, y2: next });
                    y = next;
                }
            }
            const lift = y / list.length; // Круг должен сойтись по высоте
            for (const seg of list) {
                seg.y1 -= lift * seg.i;
                seg.y2 -= lift * (seg.i + 1);
            }
            list.forEach((seg, i) => {
                let limit = 1;
                for (let n = 0; n <= 30; n += 2) limit = Math.min(limit, cornerLimit(list[(i + n) % list.length].curve, 1));
                seg.limit = limit;
                seg.props = [];
            });
            const seed = GP_ROUNDS.findIndex((item) => item.plan === plan) * 97;
            for (const side of [-1, 1]) {
                let i = 12;
                while (i < list.length) {
                    const key = round.props[Math.floor(noise(seed + i + side * 0.5) * round.props.length)];
                    const prop = GP_PROPS[key];
                    const run = key === 'wheel' ? 1 : 3 + Math.floor(noise(i * 2 + side) * 5);
                    for (let n = 0; n < run && i < list.length; n++) {
                        list[i].props.push({ key, x: side * (prop.near + noise(i + side * 0.3) * prop.spread) });
                        i += prop.gap;
                    }
                    i += 8;
                }
            }
            list[5].props.push({ key: 'arch', x: 0 });
            list[Math.floor(list.length / 2)].props.push({ key: 'arch', x: 0 });
            list.forEach((seg, i) => {
                const prev = list[(i + list.length - 1) % list.length];
                if (Math.abs(seg.curve) < 4 || Math.abs(prev.curve) >= 4) return;
                for (let n = 6; n <= 30; n += 8) list[(i + list.length - n) % list.length].warn = Math.sign(seg.curve);
            });
            // Схема трассы: круг принудительно замыкается
            const turn = list.reduce((sum, seg) => sum + seg.curve, 0) * 0.0035;
            let angle = 0;
            let mapX = 0;
            let mapY = 0;
            map = list.map((seg) => {
                angle += seg.curve * 0.0035 + (Math.PI * 2 - turn) / list.length;
                mapX += Math.sin(angle);
                mapY -= Math.cos(angle);
                return [mapX, mapY];
            });
            const xs = map.map((point) => point[0]);
            const ys = map.map((point) => point[1]);
            const [left, top] = [Math.min(...xs), Math.min(...ys)];
            const size = Math.max(Math.max(...xs) - left, Math.max(...ys) - top);
            map = map.map(([px, py]) => [(px - left) / size * 54 + 5, (py - top) / size * 54 + 5]);
            return list;
        };
        const segAt = (dist) => segs[Math.floor(wrap(dist, length) / SEG)];
        const paintHud = () => {
            const place = [...cars, me].sort((a, b) => b.dist - a.dist).indexOf(me) + 1;
            hud(`P${place} · Круг ${clamp(Math.floor(me.dist / length) + 1, 1, LAPS)}/${LAPS}`);
        };
        const grip = () => GP_TYRES[tyre].grip * (1 - 0.3 * Math.min(1.2, wear) ** 2);
        const topSpeed = (boost) => TOP * GP_TYRES[tyre].pace * (1 - 0.1 * Math.min(1.2, wear) ** 2) * (boost ? 1.07 : 1);

        const finishRace = () => {
            const order = [...cars, me].sort((a, b) => b.dist - a.dist);
            const place = order.indexOf(me) + 1;
            const { f1 } = data;
            order.forEach((car, i) => {
                f1.points[car.name] = (f1.points[car.name] || 0) + (GP_POINTS[i] || 0);
            });
            const earned = GP_POINTS[place - 1] || 0;
            const stageName = round.name;
            table = gpStandings();
            f1.round++;
            const over = f1.round >= GP_ROUNDS.length;
            let title = `${stageName}: P${place}`;
            let text = earned ? `Ты получаешь ${earned} очков` : 'Без очков, в зачёт идёт топ-10';
            if (place === 1) title = `${stageName}: победа`;
            if (over) {
                const champion = table[0].name === me.name;
                if (champion) f1.titles++;
                tally('grandprix', champion ? 'win' : 'lose');
                title = champion ? 'Ты чемпион' : `Чемпион: ${table[0].name}`;
                text = `Сезон окончен. У тебя ${f1.points[me.name] || 0} очков`;
                f1.round = 0;
                f1.points = {};
            }
            save();
            finish(title, text, over ? 'Новый сезон' : 'Следующий этап');
        };

        const moveRival = (car, dt) => {
            if (car.stop > 0) {
                car.stop -= dt;
                car.speed = 0;
                return;
            }
            let want = TOP * Math.min(car.pace, segAt(car.dist).limit * 0.92);
            for (const other of [...cars, me]) {
                const gap = other.dist - car.dist;
                if (other === car || gap <= 0 || gap > 700 || Math.abs(other.x - car.x) > 0.42) continue;
                if (gap < CAR_LEN) want = Math.min(want, other.speed * 0.98);
                car.aim = car.x > 0 ? -0.55 : 0.55; // Обгон по другой стороне
            }
            car.speed += clamp(want - car.speed, -TOP * 1.3 * dt, TOP * 0.28 * dt);
            car.x += clamp(car.aim - car.x, -0.8 * dt, 0.8 * dt);
            const before = Math.floor(car.dist / length);
            car.dist += car.speed * dt;
            if (Math.floor(car.dist / length) === before || car.dist < length) return;
            car.pace = car.base * (0.985 + Math.random() * 0.03);
            if (before + 1 === car.pitLap) car.stop = PIT_TIME + 0.6;
        };

        const movePlayer = (dt) => {
            if (pitLeft > 0) {
                pitLeft -= dt;
                if (pitLeft <= 0) {
                    tyre = pitChoice;
                    wear = 0;
                }
                return;
            }
            const sides = [...touches.values()];
            const left = held.left || sides.includes('left');
            const right = held.right || sides.includes('right');
            const pinch = sides.includes('left') && sides.includes('right');
            braking = held.down || pinch;
            const want = pinch ? 0 : (right ? 1 : 0) - (left ? 1 : 0);
            steer += clamp(want - steer, -7 * dt, 7 * dt);

            const boost = (ersOn || held.up) && ers > 0 && !braking;
            if (boost) ers = Math.max(0, ers - 0.22 * dt);
            else if (braking) ers = Math.min(1, ers + 0.35 * dt);
            if (!ers) ersOn = false;

            const top = topSpeed(boost);
            const ratio = me.speed / TOP;
            if (braking) me.speed = Math.max(0, me.speed - TOP * 1.15 * dt);
            else if (me.speed < top) me.speed = Math.min(top, me.speed + TOP * 0.34 * (1 - ratio * 0.6) * dt);
            else me.speed -= TOP * 0.2 * dt;

            const seg = segAt(me.dist);
            const offRoad = Math.abs(me.x) > 1.08;
            if (offRoad && me.speed > TOP * 0.35) me.speed -= TOP * 0.95 * dt;
            revs = (ratio * 8) % 1;
            shake = offRoad && me.speed > 600 ? 2.5 : 0;
            if (offRoad && me.speed > 600) for (const side of [-30, 30]) smoke.add(W / 2 + side, H - 48, side * 2, 70, 0.55, 7, 'rgba(160, 130, 90, 0.55)', 34);
            if (braking && me.speed > TOP * 0.3) for (const side of [-30, 30]) smoke.add(W / 2 + side, H - 42, side * 0.8, 50, 0.4, 5, 'rgba(235, 235, 240, 0.4)', 26);
            me.x += steer * 2 * (0.3 + 0.7 * ratio) * dt;
            me.x -= 0.6 * ratio * ratio * seg.curve * slide / grip() * dt;
            me.x = clamp(me.x, -1.6, 1.6);
            sky += seg.curve * ratio * dt * 7;

            smoke.step(dt);
            const move = me.speed * dt;
            wear += move / length / GP_TYRES[tyre].life * (offRoad ? 2 : 1);
            const before = Math.floor(me.dist / length);
            me.dist += move;
            for (const car of cars) {
                const gap = car.dist - me.dist;
                if (gap > 0 && gap < CAR_LEN && Math.abs(car.x - me.x) < 0.42 && me.speed > car.speed) {
                    me.speed = car.speed * 0.93;
                    me.x += me.x > car.x ? 0.08 : -0.08;
                }
            }
            const after = Math.floor(me.dist / length);
            if (after === before || me.dist < length) return;
            if (after >= LAPS) return finishRace();
            if (pitAsked) {
                pitAsked = false;
                pitLeft = PIT_TIME;
                pitChoice = tyre;
                me.speed = 0;
            }
        };

        const quad = (c, x1, y1, w1, x2, y2, w2) => {
            c.beginPath();
            c.moveTo(x1 - w1, y1);
            c.lineTo(x2 - w2, y2);
            c.lineTo(x2 + w2, y2);
            c.lineTo(x1 + w1, y1);
            c.closePath();
            c.fill();
        };
        const side = (c, a, b, from, to, color) => {
            c.fillStyle = color;
            c.beginPath();
            c.moveTo(a.x + a.w * from, a.y + SEAM);
            c.lineTo(b.x + b.w * from, b.y);
            c.lineTo(b.x + b.w * to, b.y);
            c.lineTo(a.x + a.w * to, a.y + SEAM);
            c.closePath();
            c.fill();
        };
        const paintGround = (c, seg) => {
            c.fillStyle = round.grass[Math.floor(seg.i / 3) % 2];
            c.fillRect(0, seg.b.y, W, seg.a.y - seg.b.y + 1);
        };
        const paintRoad = (c, seg, fog) => {
            const { a, b } = seg;
            const stripe = Math.floor(seg.i / 3) % 2;
            const low = a.y + SEAM;
            const bend = Math.abs(seg.curve);
            const near = a.w > 12; // Вдали мелочи всё равно не видно
            if (bend > 2.5 && near) {
                c.fillStyle = stripe ? '#cdb987' : '#c4b07e';
                quad(c, a.x, low, a.w * 1.42, b.x, b.y, b.w * 1.42);
            }
            if (bend > 1.2) {
                c.fillStyle = stripe ? '#e8343f' : '#f6f6f8';
                quad(c, a.x, low, a.w * 1.1, b.x, b.y, b.w * 1.1);
            }
            c.fillStyle = stripe ? '#3b3c46' : '#373842';
            quad(c, a.x, low, a.w, b.x, b.y, b.w);
            if (near) {
                side(c, a, b, -0.97, -0.92, '#eeeef2');
                side(c, a, b, 0.92, 0.97, '#eeeef2');
                const line = clamp(seg.curve * 0.08, -0.45, 0.45);
                side(c, a, b, line - 0.2, line + 0.2, 'rgba(0, 0, 0, 0.12)');
            }
            if (seg.i < 3) {
                for (let n = 0; n < 12; n++) {
                    const from = -1 + n / 6;
                    side(c, a, b, from, from + 1 / 6, (n + seg.i) % 2 ? '#111' : '#f4f4f6');
                }
            } else if (seg.i > round.gridFrom && near) {
                const slot = (segs.length - seg.i) % 9;
                if (slot === 0) side(c, a, b, 0.1, 0.72, '#eeeef2');
                if (slot === 4) side(c, a, b, -0.72, -0.1, '#eeeef2');
            }
            if (fog) {
                c.globalAlpha = fog;
                c.fillStyle = round.sky[1];
                c.fillRect(0, b.y, W, a.y - b.y);
                c.globalAlpha = 1;
            }
        };
        const place = (seg, ratio, lateral) => ({
            x: lerp(seg.a.x, seg.b.x, ratio) + lateral * lerp(seg.a.w, seg.b.w, ratio),
            y: lerp(seg.a.y, seg.b.y, ratio),
            w: lerp(seg.a.w, seg.b.w, ratio)
        });
        const paintWall = (c, seg, dir) => {
            const { a, b } = seg;
            const [ax, bx] = [a.x + dir * WALL * a.w, b.x + dir * WALL * b.w];
            if ((ax < -40 && bx < -40) || (ax > W + 40 && bx > W + 40)) return;
            c.fillStyle = Math.floor(seg.i / 2) % 2 ? '#e4e7ec' : '#b9bfca';
            c.beginPath();
            c.moveTo(ax, a.y);
            c.lineTo(bx, b.y);
            c.lineTo(bx, b.y - b.w * 0.14);
            c.lineTo(ax, a.y - a.w * 0.14);
            c.closePath();
            c.fill();
            c.fillStyle = '#e8343f';
            c.beginPath();
            c.moveTo(ax, a.y - a.w * 0.09);
            c.lineTo(bx, b.y - b.w * 0.09);
            c.lineTo(bx, b.y - b.w * 0.14);
            c.lineTo(ax, a.y - a.w * 0.14);
            c.closePath();
            c.fill();
        };
        const paintScenery = (c, seg, fade) => {
            if (seg.a.w > 3) {
                paintWall(c, seg, -1);
                paintWall(c, seg, 1);
            }
            for (const item of seg.props) {
                const prop = GP_PROPS[item.key];
                const spot = place(seg, 0, item.x);
                const height = spot.w * prop.size;
                const width = height * prop.w / prop.h;
                if (height < 3 || spot.x + width / 2 < 0 || spot.x - width / 2 > W) continue;
                const narrow = item.key === 'arch' ? spot.w * 2.2 * 2 : width; // Арка стоит над всей трассой
                c.globalAlpha = fade;
                c.drawImage(gpProp(item.key), spot.x - narrow / 2, spot.y - height, narrow, height);
                c.globalAlpha = 1;
            }
            if (seg.warn) {
                const spot = place(seg, 0, -seg.warn * 1.3);
                const w = spot.w * 0.3;
                if (w > 3) {
                    c.fillStyle = '#50545f';
                    c.fillRect(spot.x - 1, spot.y - w * 0.3, 2, w * 0.3);
                    c.fillStyle = '#ffd23f';
                    c.fillRect(spot.x - w / 2, spot.y - w * 0.95, w, w * 0.65);
                    if (w > 10) {
                        c.fillStyle = '#17131f';
                        c.font = `800 ${w * 0.55}px system-ui, sans-serif`;
                        c.textAlign = 'center';
                        c.textBaseline = 'middle';
                        c.fillText(seg.warn > 0 ? '›' : '‹', spot.x, spot.y - w * 0.62);
                    }
                }
            }
        };
        const hillsLayer = () => sprite(`gp-hills-${round.name}`, 720, 120, (c, w, h) => {
            if (round.night || round.name === 'Монако') {
                for (let x = 0; x < w; x += 22) {
                    const top = 22 + noise(x + 1) * 62;
                    c.fillStyle = shade(round.hills, -0.1 + noise(x) * 0.2);
                    c.fillRect(x, top, 20, h - top);
                    if (!round.night) continue;
                    c.fillStyle = '#ffd98a';
                    for (let y = top + 5; y < h - 6; y += 9) if (noise(x * y) > 0.6) c.fillRect(x + 4 + (y % 3) * 4, y, 3, 3);
                }
                return;
            }
            for (const [tone, base, amp, turns] of [[shade(round.hills, 0.25), 58, 24, 3], [round.hills, 80, 20, 5]]) {
                c.fillStyle = tone;
                c.beginPath();
                c.moveTo(0, h);
                for (let x = 0; x <= w; x += 8) c.lineTo(x, base - Math.sin(x / w * Math.PI * 2 * turns) * amp - Math.sin(x / w * Math.PI * 2 * (turns + 4)) * amp * 0.35);
                c.lineTo(w, h);
                c.closePath();
                c.fill();
            }
        });
        const cloudLayer = () => sprite(`gp-clouds-${round.name}`, 720, 90, (c, w) => {
            if (round.night) {
                c.fillStyle = '#fff';
                for (let i = 0; i < 90; i++) c.fillRect(noise(i) * w, noise(i + 0.5) * 90, 1.2, 1.2);
                return;
            }
            for (let i = 0; i < 7; i++) {
                const x = 50 + i * 100 + noise(i) * 40;
                const y = 18 + noise(i + 0.4) * 44;
                c.fillStyle = 'rgba(255, 255, 255, 0.7)';
                for (let n = 0; n < 5; n++) {
                    c.beginPath();
                    c.ellipse(x + n * 15 - 30, y - Math.sin(n / 4 * Math.PI) * 9, 17, 9, 0, 0, Math.PI * 2);
                    c.fill();
                }
            }
        });
        const scroll = (c, layer, offset, y) => {
            const from = -wrap(offset, layer.logical.w);
            c.drawImage(layer, from, y, layer.logical.w, layer.logical.h);
            c.drawImage(layer, from + layer.logical.w, y, layer.logical.w, layer.logical.h);
        };
        const paintSky = (c) => {
            const gradient = c.createLinearGradient(0, 0, 0, HORIZON + 24);
            gradient.addColorStop(0, round.sky[0]);
            gradient.addColorStop(1, round.sky[1]);
            c.fillStyle = gradient;
            c.fillRect(0, 0, W, H);
            scroll(c, cloudLayer(), sky * 0.35, 12);
            if (round.sun) {
                const glow = c.createRadialGradient(250, HORIZON - 34, 4, 250, HORIZON - 34, 90);
                glow.addColorStop(0, round.sun);
                glow.addColorStop(1, 'rgba(255, 200, 140, 0)');
                c.fillStyle = glow;
                c.fillRect(150, HORIZON - 130, 200, 180);
            }
            scroll(c, hillsLayer(), sky, HORIZON - 108);
            c.fillStyle = round.grass[0];
            c.fillRect(0, HORIZON + 10, W, H - HORIZON);
        };
        const paintPlayer = (c, theme) => {
            const lean = steer * 10;
            const bump = shake ? (Math.random() - 0.5) * shake * 2 : Math.sin(me.dist * 0.01) * 0.5;
            c.save();
            c.translate(W / 2 + lean, H - 24 + bump);
            c.rotate(steer * 0.03);
            const image = f1Sprite(theme.accent);
            const w = 108;
            const h = w * F1_SPRITE.h / F1_SPRITE.w;
            // Передние колёса смещаются при повороте руля
            c.fillStyle = '#111116';
            for (const dir of [-1, 1]) {
                roundRect(c, dir * 28 - 6 + steer * 5, -h * 0.5, 12, 15, 3);
                c.fill();
            }
            c.drawImage(image, -w / 2, -h, w, h);
            if (braking) {
                c.fillStyle = '#ff2436';
                c.fillRect(-4, -15, 8, 4);
                for (const dir of [-1, 1]) {
                    const glow = c.createRadialGradient(dir * 41, -14, 1, dir * 41, -14, 13);
                    glow.addColorStop(0, 'rgba(255, 150, 40, 0.8)');
                    glow.addColorStop(1, 'rgba(255, 90, 20, 0)');
                    c.fillStyle = glow;
                    c.fillRect(dir * 41 - 13, -27, 26, 26);
                }
            }
            c.restore();
        };
        const paintMap = (c, theme) => {
            const size = 64;
            const left = W - size - 8;
            const top = 8;
            c.fillStyle = 'rgba(12, 12, 20, 0.6)';
            roundRect(c, left, top, size, size, 12);
            c.fill();
            c.strokeStyle = 'rgba(255, 255, 255, 0.72)';
            c.lineWidth = 2;
            c.lineJoin = 'round';
            c.beginPath();
            for (let i = 0; i < map.length; i += 10) {
                const [px, py] = map[i];
                if (i) c.lineTo(left + px, top + py);
                else c.moveTo(left + px, top + py);
            }
            c.closePath();
            c.stroke();
            for (const car of [...cars, me]) {
                const [px, py] = map[segAt(car.dist).i];
                c.fillStyle = car === me ? theme.accent : car.color;
                c.beginPath();
                c.arc(left + px, top + py, car === me ? 4 : 2.2, 0, Math.PI * 2);
                c.fill();
            }
        };

        const paintButton = (c, btn, text, active, color) => {
            c.fillStyle = active ? color : 'rgba(12, 12, 20, 0.6)';
            c.beginPath();
            c.arc(btn.x, btn.y, btn.r, 0, Math.PI * 2);
            c.fill();
            c.fillStyle = active ? '#17131f' : '#fff';
            c.font = '800 12px system-ui, sans-serif';
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillText(text, btn.x, btn.y + 1);
        };
        const paintBar = (c, x, y, label, value, color) => {
            c.fillStyle = '#fff';
            c.font = '700 11px system-ui, sans-serif';
            c.textAlign = 'left';
            c.textBaseline = 'middle';
            c.fillText(label, x, y + 3);
            c.fillStyle = 'rgba(255, 255, 255, 0.25)';
            roundRect(c, x + 36, y, 62, 6, 3);
            c.fill();
            c.fillStyle = color;
            if (value > 0.02) {
                roundRect(c, x + 36, y, 62 * Math.min(1, value), 6, 3);
                c.fill();
            }
        };
        const paintPanel = (c) => {
            c.fillStyle = 'rgba(12, 12, 20, 0.6)';
            roundRect(c, 8, 8, 120, 76, 12);
            c.fill();
            const lit = Math.round(revs * 10);
            for (let i = 0; i < 10; i++) {
                c.fillStyle = i >= lit ? 'rgba(255, 255, 255, 0.14)' : i < 4 ? '#4cd97b' : i < 8 ? '#ff2436' : '#5a8cff';
                c.beginPath();
                c.arc(21 + i * 10.4, 18, 3.2, 0, Math.PI * 2);
                c.fill();
            }
            c.fillStyle = '#fff';
            c.font = '800 16px system-ui, sans-serif';
            c.textAlign = 'left';
            c.textBaseline = 'middle';
            c.fillText(`${Math.round(me.speed / TOP * KMH)} км/ч`, 18, 37);
            c.textAlign = 'right';
            c.fillStyle = '#ffd23f';
            c.fillText(me.speed < 50 ? 'N' : String(clamp(Math.ceil(me.speed / TOP * 8), 1, 8)), 116, 37);
            const left = 1 - Math.min(1, wear);
            paintBar(c, 18, 53, 'ШИНЫ', left, left < 0.25 ? '#ff3b4e' : GP_TYRES[tyre].color);
            paintBar(c, 18, 67, 'ERS', ers, ersOn || held.up ? '#ffd23f' : '#4cd97b');
        };
        const paintStart = (c) => {
            const lit = lightsLeft <= 0.4 ? 5 : Math.floor((LIGHTS_TIME - lightsLeft) / 0.6) + 1;
            c.fillStyle = 'rgba(12, 12, 20, 0.8)';
            roundRect(c, W / 2 - 92, 90, 184, 44, 12);
            c.fill();
            for (let i = 0; i < 5; i++) {
                c.fillStyle = i < lit ? '#ff2436' : '#3a3b45';
                c.beginPath();
                c.arc(W / 2 - 68 + i * 34, 112, 12, 0, Math.PI * 2);
                c.fill();
            }
        };
        const paintPit = (c) => {
            c.fillStyle = 'rgba(12, 12, 20, 0.8)';
            roundRect(c, W / 2 - 120, 84, 240, 118, 16);
            c.fill();
            c.fillStyle = '#fff';
            c.font = '800 16px system-ui, sans-serif';
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillText(`Пит-стоп ${pitLeft.toFixed(1)}`, W / 2, 106);
            GP_TYRES.forEach((item, i) => {
                const x = W / 2 - 76 + i * 76;
                c.fillStyle = i === pitChoice ? item.color : 'rgba(255, 255, 255, 0.14)';
                c.beginPath();
                c.arc(x, 150, 26, 0, Math.PI * 2);
                c.fill();
                c.fillStyle = i === pitChoice ? '#17131f' : '#fff';
                c.font = '800 16px system-ui, sans-serif';
                c.fillText(item.mark, x, 151);
            });
            c.fillStyle = '#fff';
            c.font = '500 12px system-ui, sans-serif';
            c.fillText(GP_TYRES[pitChoice].name, W / 2, 187);
        };

        return {
            width: W,
            height: H,
            vertical: true,
            hintKeys: 'Стрелки: влево и вправо руль, вниз тормоз, вверх ERS. Пробел заказывает пит-стоп. Газ нажат сам',
            hintTouch: 'Держи левую или правую часть экрана, обе сразу это тормоз. Газ нажат сам',
            options(mode) {
                if (mode === 'pause') return '';
                const { f1 } = data;
                const rows = (table || gpStandings()).slice(0, 3);
                const own = (table || gpStandings()).find((row) => row.name === 'Ты');
                if (own && !rows.includes(own)) rows.push(own);
                return `${rows.length ? `<ol class="gp-table">${rows.map((row) => `<li class="${row.name === 'Ты' ? 'own' : ''}"><span>${row.name}</span><b>${row.points}</b></li>`).join('')}</ol>` : ''}
                    <p class="game-note">Этап ${f1.round + 1} из ${GP_ROUNDS.length} · ${GP_ROUNDS[f1.round].name} · ${LAPS} круга</p>
                    ${chipsRow('tyre', GP_TYRES.map((item) => item.name), f1.tyre)}
                    ${chipsRow('level', LEVELS, data.level.grandprix ?? 1)}`;
            },
            pick(target, overlay, refresh) {
                const chip = target.closest('[data-tyre], [data-level]');
                if (!chip) return;
                if (chip.dataset.tyre) data.f1.tyre = Number(chip.dataset.tyre);
                else data.level.grandprix = Number(chip.dataset.level);
                save();
                refresh();
            },
            reset() {
                round = GP_ROUNDS[data.f1.round];
                const level = data.level.grandprix ?? 1;
                slide = SLIDE[level];
                segs = buildTrack(round);
                round.gridFrom = segs.length - 36;
                shake = 0;
                revs = 0;
                smoke.clear();
                length = segs.length * SEG;
                const grid = GP_RIVALS.map((rival) => ({ ...rival }));
                me = { name: 'Ты', me: true, x: 0, speed: 0 };
                grid.splice(SLOT[level], 0, me);
                grid.forEach((car, slot) => {
                    car.dist = -(slot + 1) * SEG * 3;
                    car.x = slot % 2 ? 0.4 : -0.4;
                    car.aim = car.x;
                    car.speed = 0;
                    car.base = (car.skill || 0) * SKILL[level];
                    car.pace = car.base;
                    car.stop = 0;
                    car.pitLap = 2 + (slot % 2);
                });
                cars = grid.filter((car) => car !== me);
                tyre = data.f1.tyre;
                wear = 0;
                ers = 1;
                ersOn = false;
                pitAsked = false;
                pitLeft = 0;
                steer = 0;
                braking = false;
                sky = 0;
                lightsLeft = LIGHTS_TIME;
                touches.clear();
                paintHud();
            },
            release() {
                touches.clear();
            },
            // Пробел: заказать пит-стоп, а в боксах сменить шины
            action() {
                if (pitLeft > 0) pitChoice = (pitChoice + 1) % GP_TYRES.length;
                else pitAsked = !pitAsked;
                return true;
            },
            pointer(type, x, y, id) {
                if (type === 'pointerup' || type === 'pointercancel') return touches.delete(id);
                if (type !== 'pointerdown') return;
                if (pitLeft > 0) {
                    const index = GP_TYRES.findIndex((item, i) => Math.hypot(x - (W / 2 - 76 + i * 76), y - 150) < 34);
                    if (index >= 0) pitChoice = index;
                    return;
                }
                if (Math.hypot(x - BOX_BTN.x, y - BOX_BTN.y) < BOX_BTN.r + 6) {
                    pitAsked = !pitAsked;
                    return;
                }
                if (Math.hypot(x - ERS_BTN.x, y - ERS_BTN.y) < ERS_BTN.r + 6) {
                    ersOn = !ersOn && ers > 0;
                    return;
                }
                touches.set(id, x < W / 2 ? 'left' : 'right');
            },
            update(dt) {
                if (lightsLeft > 0) {
                    lightsLeft -= dt;
                    return;
                }
                cars.forEach((car) => moveRival(car, dt));
                movePlayer(dt);
                paintHud();
            },
            draw(c, theme) {
                const camZ = wrap(me.dist - NEAR, length);
                const base = segs[Math.floor(camZ / SEG)];
                const own = segAt(me.dist);
                const camX = me.x * ROAD;
                const camY = CAM_H + lerp(own.y1, own.y2, wrap(me.dist, SEG) / SEG);
                paintSky(c);

                const id = ++drawId;
                const ratio = wrap(camZ, SEG) / SEG;
                const bands = [];
                let maxY = H;
                let shift = 0;
                let turn = -base.curve * ratio;
                const project = (z, height, offset) => {
                    const scale = DEPTH / z;
                    return {
                        x: W / 2 + scale * (offset - camX) * W / 2,
                        y: HORIZON - scale * (height - camY) * H / 2,
                        w: scale * ROAD * W / 2
                    };
                };
                for (let n = 0; n < VIEW; n++) {
                    const seg = segs[(base.i + n) % segs.length];
                    const z = seg.i * SEG + (seg.i < base.i ? length : 0) - camZ;
                    const nextShift = shift + turn;
                    const from = shift;
                    shift = nextShift;
                    turn += seg.curve;
                    seg.drawn = 0;
                    if (z <= 20) continue;
                    seg.a = project(z, seg.y1, from);
                    seg.b = project(z + SEG, seg.y2, nextShift);
                    seg.clip = maxY;
                    seg.z = z;
                    seg.drawn = id;
                    if (seg.b.y >= seg.a.y || seg.b.y >= maxY) continue;
                    seg.fog = (n / VIEW) ** 2.4 * 0.8;
                    bands.push(seg);
                    maxY = seg.b.y;
                }
                // Трава отдельным проходом, иначе её край ложится полосой на соседний сегмент дороги
                for (const seg of bands) paintGround(c, seg);
                for (const seg of bands) paintRoad(c, seg, seg.fog);

                const bySeg = new Map();
                for (const car of cars) {
                    const seg = segAt(car.dist);
                    if (seg.drawn !== id) continue;
                    if (!bySeg.has(seg.i)) bySeg.set(seg.i, []);
                    bySeg.get(seg.i).push(car);
                }
                for (let n = VIEW - 1; n >= 0; n--) {
                    const seg = segs[(base.i + n) % segs.length];
                    if (seg.drawn !== id) continue;
                    c.save();
                    c.beginPath();
                    c.rect(0, 0, W, seg.clip);
                    c.clip();
                    paintScenery(c, seg, clamp((VIEW - n) / 18, 0, 1));
                    for (const car of bySeg.get(seg.i) || []) {
                        if (seg.z < NEAR - SEG) continue; // Позади игрока
                        const spot = place(seg, wrap(car.dist, SEG) / SEG, car.x);
                        const w = spot.w * 0.5;
                        const h = w * F1_SPRITE.h / F1_SPRITE.w;
                        if (w > 5 && spot.x > -w && spot.x < W + w) c.drawImage(f1Sprite(car.color), spot.x - w / 2, spot.y - h, w, h);
                    }
                    c.restore();
                }

                smoke.draw(c);
                paintPlayer(c, theme);
                paintMap(c, theme);
                paintPanel(c);
                if (lightsLeft > 0) paintStart(c);
                else if (pitLeft > 0) paintPit(c);
                else {
                    let need = 1;
                    for (let n = 0; n <= 34; n += 3) need = Math.min(need, cornerLimit(segs[(own.i + n) % segs.length].curve, grip()));
                    if (me.speed / TOP > need + 0.04) {
                        c.fillStyle = '#ff2436';
                        roundRect(c, W / 2 - 58, 84, 116, 30, 12);
                        c.fill();
                        c.fillStyle = '#fff';
                        c.font = '800 13px system-ui, sans-serif';
                        c.textAlign = 'center';
                        c.textBaseline = 'middle';
                        c.fillText('ТОРМОЗИ', W / 2, 100);
                    }
                    paintButton(c, BOX_BTN, 'BOX', pitAsked, '#4cd97b');
                    paintButton(c, ERS_BTN, 'ERS', ersOn || held.up, '#ffd23f');
                }
            }
        };
    });

    // --- Старт ---
    const lights = (shell) => {
        const COUNT = 5;
        const STEP = 900;
        const HOLD = [300, 2600]; // Сколько огни горят после зажигания последнего
        const SERIES = 5;
        const ANTICIPATE = 80; // Быстрее человек не реагирует, значит нажал заранее
        const el = make(`<div class="start-pad glass" role="button" tabindex="0" aria-label="Нажать на старте">
            <div class="start-lamps">${'<span class="start-lamp"><i></i><i></i></span>'.repeat(COUNT)}</div>
            <b class="start-time">Старт</b>
            <p class="start-note"></p>
        </div>`);
        const lamps = el.querySelectorAll('.start-lamp');
        const time = el.querySelector('.start-time');
        const note = el.querySelector('.start-note');
        let phase = 'idle'; // idle, arm, go, done
        let timer = 0;
        let goAt = 0;
        let series = [];

        const light = (count) => lamps.forEach((lamp, i) => lamp.classList.toggle('on', i < count));
        const paintHud = () => shell.hud(data.best.lights === undefined ? 'Рекорда пока нет' : `Рекорд ${data.best.lights} мс`);
        const say = (head, text) => {
            time.textContent = head;
            note.textContent = text;
        };
        const verdict = (ms) => (ms < 180 ? 'Реакция чемпиона' : ms < 230 ? 'Отличный старт' : ms < 300 ? 'Хороший старт' : ms < 400 ? 'Средний старт' : 'Соперники уже уехали');
        const stop = () => {
            clearTimeout(timer);
            light(0);
        };
        const idle = () => {
            stop();
            phase = 'idle';
            say('Старт', touchScreen() ? 'Коснись экрана, чтобы зажечь огни. Как только погаснут, жми снова' : 'Жми пробел, чтобы зажечь огни. Как только погаснут, жми снова');
        };
        const foul = () => {
            stop();
            phase = 'done';
            series = [];
            say('Фальстарт', 'Огни ещё не погасли. Коснись, чтобы попробовать снова');
        };
        const arm = () => {
            phase = 'arm';
            say('Жди', 'Огни загораются');
            let count = 0;
            const next = () => {
                light(++count);
                if (count < COUNT) timer = setTimeout(next, STEP);
                else timer = setTimeout(go, HOLD[0] + Math.random() * (HOLD[1] - HOLD[0]));
            };
            timer = setTimeout(next, 500);
        };
        const go = () => {
            light(0);
            requestAnimationFrame(() => {
                if (phase !== 'arm') return;
                phase = 'go';
                goAt = performance.now();
            });
        };
        const stopClock = (stamp) => {
            const ms = Math.round(stamp - goAt);
            if (ms < ANTICIPATE) return foul();
            phase = 'done';
            series = [...series, ms].slice(-SERIES);
            const fresh = fastest('lights', ms);
            paintHud();
            const average = Math.round(series.reduce((sum, value) => sum + value, 0) / series.length);
            say(`${ms} мс`, `${verdict(ms)}${fresh ? ', новый рекорд' : ''}. Среднее за ${series.length}: ${average} мс`);
        };
        const press = (stamp) => {
            if (phase === 'idle' || phase === 'done') arm();
            else if (phase === 'arm') foul();
            else stopClock(stamp);
        };

        // Нажатие ловим в момент касания: отпускание добавило бы к результату лишнее время
        el.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            press(e.timeStamp);
        });
        paintHud();
        idle();
        return {
            el,
            restart: () => {
                series = [];
                idle();
            },
            pause: () => {
                if (phase === 'arm' || phase === 'go') idle();
            },
            key(e, down) {
                if (e.key !== ' ') return;
                e.preventDefault();
                if (down && !e.repeat) press(e.timeStamp);
            }
        };
    };

    // --- Дрифт ---
    const drift = arcade(({ hud, held, finish }) => {
        const W = 360;
        const H = 480;
        const CAR_Y = H * 0.72;
        const START_SPEED = 270;
        const TOP_SPEED = 380;
        const STEER = 3.4;
        const GRIP = 1.8;
        const MIN_SLIP = 0.16; // Меньший занос дрифтом не считается
        const smoke = particles(90);
        const touches = new Map();
        let x, y, heading, course, speed, points, combo, chain, slip, camX, skids, grace;

        const wave = (at) => Math.min(80, 42 + at * 0.004);
        const centre = (at) => wave(at) * (Math.sin(at * 0.0034) + 0.6 * Math.sin(at * 0.0085 + 1));
        const half = (at) => Math.max(58, 76 - at * 0.0015);
        const offRoad = () => Math.abs(x - centre(y)) > half(y);
        const wrapTile = (value) => ((value % 240) + 240) % 240;
        const toX = (wx) => W / 2 + wx - camX;
        const toY = (wy) => CAR_Y - (wy - y);
        const paintHud = () => hud(`Очки ${Math.floor(points)} · x${combo}`);
        const grass = () => sprite('drift-grass', 240, 240, (c, w, h) => {
            c.fillStyle = '#3f8f50';
            c.fillRect(0, 0, w, h);
            for (let i = 0; i < 260; i++) {
                c.fillStyle = noise(i) > 0.5 ? '#4a9c5a' : '#378246';
                c.fillRect(noise(i + 0.3) * w, noise(i + 0.7) * h, 2, 4);
            }
        });
        const edge = (side) => {
            const line = [];
            for (let sy = -30; sy <= H + 30; sy += 12) {
                const at = y + CAR_Y - sy;
                line.push([toX(centre(at) + side * half(at)), sy]);
            }
            return line;
        };
        const trace = (c, line) => {
            c.beginPath();
            line.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py)));
        };

        return {
            width: W,
            height: H,
            hintKeys: 'Стрелки влево и вправо. Заноси машину в поворотах и не вылетай с трассы',
            hintTouch: 'Держи левую или правую часть экрана. Заноси машину в поворотах и не вылетай с трассы',
            reset() {
                x = centre(0);
                y = 0;
                heading = 0;
                course = 0;
                speed = START_SPEED;
                points = 0;
                combo = 1;
                chain = 0;
                slip = 0;
                camX = x;
                skids = [];
                grace = 0;
                smoke.clear();
                touches.clear();
                paintHud();
            },
            release() {
                touches.clear();
            },
            pointer(type, px, py, id) {
                if (type === 'pointerup' || type === 'pointercancel') touches.delete(id);
                else if (type === 'pointerdown') touches.set(id, px < W / 2 ? -1 : 1);
            },
            update(dt) {
                const sides = [...touches.values()];
                const left = held.left || sides.includes(-1);
                const right = held.right || sides.includes(1);
                const want = (right ? 1 : 0) - (left ? 1 : 0);
                heading += want * STEER * dt;
                if (!want) heading += (course - heading) * Math.min(1, 3.5 * dt);
                heading = clamp(heading, course - 0.95, course + 0.95);
                course = clamp(course + clamp(heading - course, -GRIP * dt, GRIP * dt), -1.2, 1.2);
                x += Math.sin(course) * speed * dt;
                y += Math.cos(course) * speed * dt;
                slip = Math.abs(heading - course);
                camX += (x - camX) * Math.min(1, 6 * dt);

                const out = offRoad();
                if (out) {
                    speed -= 260 * dt;
                    grace += dt;
                    combo = 1;
                    chain = 0;
                } else {
                    speed = Math.min(TOP_SPEED, speed + 22 * dt);
                    grace = 0;
                    if (slip > MIN_SLIP) {
                        chain += dt;
                        combo = Math.min(5, 1 + Math.floor(chain / 1.1));
                        points += slip * speed * dt * 0.12 * combo;
                    } else {
                        chain = Math.max(0, chain - dt * 0.7);
                        if (!chain) combo = 1;
                    }
                }
                points += speed * dt * 0.01;

                if (slip > MIN_SLIP || out) {
                    const back = Math.sin(heading) * 26;
                    const rear = Math.cos(heading) * 26;
                    for (const side of [-1, 1]) {
                        const wx = x - back + Math.cos(heading) * 13 * side;
                        const wy = y - rear - Math.sin(heading) * 13 * side;
                        if (!out) skids.push({ x: wx, y: wy, side });
                        smoke.add(toX(wx), toY(wy), Math.random() * 40 - 20, Math.random() * 30, 0.7, 5, out ? 'rgba(146, 110, 66, 0.55)' : 'rgba(235, 235, 240, 0.5)', 24);
                    }
                    if (skids.length > 260) skids.splice(0, 40);
                }
                smoke.step(dt, -Math.sin(course) * speed, Math.cos(course) * speed);
                paintHud();
                if (speed < 110 || grace > 1.5) {
                    const score = Math.floor(points);
                    const fresh = record('drift', score);
                    finish('Вылет с трассы', `Очки ${score}${fresh ? ', новый рекорд' : ''}`);
                }
            },
            draw(c, theme) {
                const tile = grass();
                const fromX = -wrapTile(camX);
                const fromY = wrapTile(y) - 240;
                for (let px = fromX - 240; px < W; px += 240) {
                    for (let py = fromY; py < H; py += 240) c.drawImage(tile, px, py, 241, 241);
                }

                const firstBlock = Math.floor((y - H) / 90);
                for (let block = firstBlock; block < firstBlock + 12; block++) {
                    for (const side of [-1, 1]) {
                        const at = block * 90 + noise(block + side) * 60;
                        const px = toX(centre(at) + side * (half(at) + 42 + noise(block * 3 + side) * 90));
                        stamp(c, topProp(noise(block * 5 + side) > 0.35 ? 'tree' : 'bush'), px, toY(at));
                    }
                }

                const left = edge(-1);
                const right = edge(1);
                c.fillStyle = '#c8b582';
                trace(c, [...left.map(([px, py]) => [px - 16, py]), ...right.reverse().map(([px, py]) => [px + 16, py])]);
                c.fill();
                c.fillStyle = '#35363f';
                trace(c, [...left, ...right]);
                c.fill();
                right.reverse();
                c.lineWidth = 7;
                for (const [color, offset] of [['#e8343f', 0], ['#fff', 18]]) {
                    c.strokeStyle = color;
                    c.setLineDash([18, 18]);
                    c.lineDashOffset = -y + offset;
                    trace(c, left);
                    c.stroke();
                    trace(c, right);
                    c.stroke();
                }
                c.setLineDash([]);

                c.strokeStyle = 'rgba(10, 10, 14, 0.5)';
                c.lineWidth = 3.5;
                for (const side of [-1, 1]) {
                    let open = false;
                    let last = null;
                    c.beginPath();
                    for (const mark of skids) {
                        if (mark.side !== side) continue;
                        const gap = last && Math.hypot(mark.x - last.x, mark.y - last.y) > 34;
                        if (open && !gap) c.lineTo(toX(mark.x), toY(mark.y));
                        else c.moveTo(toX(mark.x), toY(mark.y));
                        open = true;
                        last = mark;
                    }
                    c.stroke();
                }

                smoke.draw(c);
                c.save();
                c.translate(toX(x), CAR_Y);
                c.rotate(heading);
                stamp(c, topCar('sport', theme.accent), 0, 0);
                c.restore();

                if (combo > 1) {
                    c.fillStyle = 'rgba(12, 12, 20, 0.6)';
                    roundRect(c, W / 2 - 54, 12, 108, 36, 14);
                    c.fill();
                    c.fillStyle = '#ffd23f';
                    c.font = '800 19px system-ui, sans-serif';
                    c.textAlign = 'center';
                    c.textBaseline = 'middle';
                    c.fillText(`ДРИФТ x${combo}`, W / 2, 31);
                }
            }
        };
    });

    // --- Раздел ---
    const CATALOG = {
        racing: { title: 'Гонки', text: 'Этапы, гараж и прокачка', icon: 'car', create: racing, note: () => `Этап ${data.race.stage} · Гонщик ${driverLevel().level} ур.` },
        grandprix: { title: 'Гран-при', text: 'Сезон из 6 этапов, шины и пит-стопы', icon: 'f1', create: grandprix, note: () => `Этап ${data.f1.round + 1} из ${GP_ROUNDS.length} · Очки ${data.f1.points['Ты'] || 0}${data.f1.titles ? ` · Титулы ${data.f1.titles}` : ''}` },
        lights: { title: 'Старт', text: 'Поймай момент, когда погаснут огни', icon: 'lights', create: lights, note: () => (data.best.lights === undefined ? 'Рекорда пока нет' : `Рекорд ${data.best.lights} мс`) },
        drift: { title: 'Дрифт', text: 'Заноси машину на извилистой трассе', icon: 'wheel', create: drift, note: () => `Рекорд ${data.best.drift || 0}` },
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
